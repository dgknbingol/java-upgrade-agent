# Desktop Agent — Architecture

## Purpose

Standalone Windows desktop proof-of-concept that upgrades Maven Java projects using GitHub Copilot CLI (`gh copilot`). No external backend, OpenShift, database, or Docker.

Lives entirely in `desktop-agent/` and does not modify the existing `frontend/` or `backend/` projects.

## High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)          src/                      │
│  • Health UI, repo form, action buttons, output tabs        │
│  • IPC via window.electronAPI (preload bridge)              │
└───────────────────────────┬─────────────────────────────────┘
                            │ contextBridge / IPC
┌───────────────────────────▼─────────────────────────────────┐
│  Main Process (Electron)          electron/                 │
│  • main.ts        — window, IPC handlers, log streaming     │
│  • preload.ts     — typed bridge to renderer                │
│  • jobRunner.ts   — analyze / upgrade / build / push flows  │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  gitService.ts      mavenService.ts    copilotService.ts
  healthService.ts   commandRunner.ts   javaUpgradePrompt.ts
        │                   │                   │
        └───────────────────┴───────────────────┘
                            │
                    child_process.spawn
                    (git, mvn, gh, gh copilot)
                            │
                            ▼
              desktop-agent/workspaces/{jobId}/
```

## Module Responsibilities

### Renderer (`src/`)

| Module | Responsibility |
|--------|----------------|
| `App.tsx` | Layout: health, repo form, actions, tabs |
| `pages/` | Page-level composition (single main view) |
| `components/` | HealthCheck, RepositoryForm, OutputTabs, DiffSummary |
| `hooks/useJob.ts` | IPC invoke + log event subscription |
| `types/` | Job state, analysis result, health status types |
| `utils/diffParser.ts` | Parse unified diff for visual summary |

### Main Process (`electron/`)

| Module | Responsibility |
|--------|----------------|
| `main.ts` | Create `BrowserWindow`, register IPC, push log events |
| `preload.ts` | Expose safe `electronAPI` to renderer |
| `jobRunner.ts` | Orchestrate clone → branch → copilot → mvn → artifacts |
| `prompts/javaUpgradePrompt.ts` | Build migration and Maven-fix prompts |
| `services/commandRunner.ts` | Reusable `spawn` wrapper with stdout/stderr capture |
| `services/healthService.ts` | Validate git, java, mvn, gh, gh copilot |
| `services/gitService.ts` | clone, checkout, branch, diff, push |
| `services/mavenService.ts` | `mvn clean install`, version detection helpers |
| `services/copilotService.ts` | Invoke `gh copilot` with migration prompt |

### Workspaces

- Path: `desktop-agent/workspaces/{jobId}/`
- Each job gets an isolated clone
- Gitignored; not bundled in the executable
- Reports and diffs read from workspace after job completion

## Execution Flows

### Health Check

1. Renderer calls `health:check` IPC
2. `healthService` runs version/help commands via `commandRunner`
3. Returns availability per tool with install hints

### Analyze

1. Generate `jobId`, clone repo into `workspaces/{jobId}`
2. Checkout source branch
3. Parse `pom.xml` for Java, Maven compiler plugin, Spring Boot parent
4. Return summary; cleanup analyze workspace optional (kept for POC inspection)

### Start Upgrade

1. Clone (or reuse) workspace
2. Checkout source branch
3. Create branch `java-{version}-upgrade` (suffix `-2`, `-3` if exists)
4. Write `JAVA_UPGRADE_TASK.md` with prompt
5. Run `gh copilot` with Java upgrade prompt
6. Run `mvn clean install` (up to 4 attempts with copilot fix on failure)
7. Capture logs, `git diff`, `MIGRATION_REPORT.md`
8. Stream logs to UI via `job:log` events

### Run Build Again

Re-run Maven build (+ fix loop) on existing workspace without re-cloning or re-running initial migration.

### Push Branch

Explicit `git push -u origin {upgradeBranch}` — never automatic.

## IPC Contract

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `health:check` | invoke | Tool prerequisites |
| `job:analyze` | invoke | Clone + detect versions |
| `job:start` | invoke | Full upgrade pipeline |
| `job:runBuild` | invoke | Maven rebuild |
| `job:push` | invoke | Push upgrade branch |
| `job:getArtifacts` | invoke | report, diff, status |
| `job:log` | event → renderer | Live log lines |
| `job:status` | event → renderer | Status changes |

## Security Model

- `contextIsolation: true`, `nodeIntegration: false` in renderer
- All `child_process` access only in main process
- Preload exposes a minimal typed API

## Packaging Strategy

- **Dev:** Vite serves React on port 5174; Electron loads dev URL; main/preload compiled with `tsc -w`
- **Build:** `vite build` → `dist/`; `tsc` electron → `dist-electron/`
- **Dist:** `electron-builder` packages Windows NSIS `.exe`
- `workspaces/` excluded from asar via `extraResources` / ignore patterns
- Native tools (git, java, mvn, gh) are **not** bundled — must exist on host PATH

## Dependencies on Host Machine

| Tool | Used for |
|------|----------|
| Git | clone, branch, diff, push |
| Java JDK | Maven runtime |
| Maven | build verification |
| GitHub CLI (`gh`) | auth, copilot extension |
| `gh copilot` | AI migration step |

## Limitations (POC)

- Job state is in-memory; restarting the app loses active job handles (workspace folders remain)
- `gh copilot suggest` may not edit files as extensively as `@github/copilot` CLI; Maven fix loop compensates partially
- Windows-focused; spawn uses platform shell rules where needed
- No multi-user or central prompt distribution (local prompts only)
