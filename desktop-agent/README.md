# Paytion Java Upgrade Desktop Agent

Windows desktop proof-of-concept for upgrading Maven Java projects using **GitHub Copilot CLI** (`gh copilot`).

Independent from the existing `frontend/` and `backend/` projects. Everything lives under `desktop-agent/`.

## Architecture

See [architecture.md](./architecture.md) for module design, IPC contract, execution flows, and packaging.

## Required Software

Install on the Windows host (not bundled in the `.exe`):

| Tool | Check | Install |
|------|-------|---------|
| Git | `git --version` | [git-scm.com](https://git-scm.com/download/win) |
| Java JDK 21+ | `java -version` | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Maven | `mvn -version` | `choco install maven -y` |
| GitHub CLI | `gh --version` | `winget install GitHub.cli` |
| Copilot extension | `gh copilot --help` | `gh extension install github/gh-copilot` |
| **Copilot CLI (migration)** | `copilot --version` | `npm install -g @github/copilot` |

### Git setup

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@company.com"
```

Ensure SSH keys or HTTPS credentials are configured for target repositories.

### GitHub CLI setup

```powershell
gh auth login
gh extension install github/gh-copilot
gh copilot --help
```

### Copilot CLI setup

The app uses **`@github/copilot` CLI** (`copilot -p ...`) for migration and build-fix steps — the same tool as the web backend, not `gh copilot suggest`.

## Project Structure

```
desktop-agent/
├── electron/           # Main process, IPC, job runner, services
├── src/                # React renderer UI
├── workspaces/         # Per-job clones (gitignored)
├── architecture.md
├── electron-builder.yml
└── package.json
```

## Development

```bash
cd desktop-agent
npm install
npm run dev
```

Opens an Electron window with hot-reload via Vite (port 5174).

## Build

Compile renderer + main process:

```bash
npm run build
```

## Package Windows executable

```bash
npm run dist
```

Output:
- `release/Paytion Java Upgrade Desktop Agent Setup *.exe` (NSIS installer)
- `release/Paytion Java Upgrade Desktop Agent *.exe` (portable)

Sadece klasör (installer olmadan):

```bash
npm run dist:dir
```

Çıktı: `release/win-unpacked/Paytion Java Upgrade Desktop Agent.exe`

### `npm run dist` symlink hatası (Windows)

`Cannot create symbolic link : Gereken ayrıcalık...` hatası alırsanız:

1. Projede imzalama kapalıdır (`signAndEditExecutable: false`); önce cache temizleyin:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -ErrorAction SilentlyContinue
   npm run dist
   ```
2. Hâlâ olmazsa **Windows Ayarlar → Geliştirici seçenekleri → Geliştirici Modu** açın (symlink izni).
3. Veya PowerShell'i **Yönetici olarak** çalıştırıp `npm run dist` deneyin.
4. Acil POC için `npm run dist:dir` yeterli — `release/win-unpacked/` altındaki `.exe` doğrudan çalışır.

## Usage

1. Launch the app — **Health Check** validates Git, Java, Maven, GitHub CLI, Copilot CLI.
2. Enter **Repository URL**, **Source Branch**, **Target Java Version** (default 21).
3. **Analyze** — clones repo, detects Java / Maven / Spring Boot versions.
4. **Start Upgrade** — clones, creates `java-{version}-upgrade` branch, runs `gh copilot`, then `mvn clean install` with up to 4 fix attempts.
5. Review **Live Logs**, **Migration Report**, **Visual Diff Summary**, **Raw Diff** tabs.
6. **Run Build Again** — re-runs Maven on the existing workspace.
7. **Push Branch** — pushes upgrade branch to origin (never automatic).

Workspaces:
- **Development:** `desktop-agent/workspaces/{jobId}/`
- **Packaged .exe:** `%APPDATA%\java-upgrade-desktop-agent\workspaces\{jobId}\`

## POC Limitations

- Job state is in-memory; restarting the app clears active job handles (workspace folders remain on disk).
- `gh copilot suggest` may not edit files as extensively as the standalone `@github/copilot` CLI; the Maven fix loop partially compensates.
- Windows-focused tooling paths in spawn/health checks.
- No OpenShift, external backend, database, or Docker integration.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Electron + Vite development |
| `npm run build` | Production compile |
| `npm run dist` | Windows `.exe` installer |
