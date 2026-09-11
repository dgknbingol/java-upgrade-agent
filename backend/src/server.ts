import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runBuild, runPush, runUpgradeJob } from './jobRunner';
import { createJob, getJob } from './jobStore';
import { buildUpgradeBranchBase } from './branchResolver';
import { checkPrerequisites } from './prerequisites';
import { AppConfig, initAppConfig } from './config/appConfig';
import { pickFolder } from './folderPicker';
import { analyzeRepository } from './repoAnalyzer';
import { resolveJobWorkspacePath } from './workspacePaths';
import { AnalyzeRequest, Job, SourceMode, StartJobRequest } from './types';

const workspacesDir = path.join(__dirname, '..', 'workspaces');
fs.mkdirSync(workspacesDir, { recursive: true });

function registerRoutes(app: Express, config: AppConfig): void {
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      serverPort: config.serverPort,
      corsOrigin: config.corsOrigin,
      maxBuildFixAttempts: config.maxBuildFixAttempts,
      upgradeBranchPattern: config.upgradeBranchPattern,
      sources: config.configSources,
    });
  });

  app.get('/api/prerequisites', async (_req: Request, res: Response) => {
    const tools = await checkPrerequisites();
    res.json({ tools, ready: tools.every((tool) => tool.available) });
  });

  app.post('/api/pick-folder', async (req: Request, res: Response) => {
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : 'Klasör seçin';

    try {
      const selected = await pickFolder(title);
      if (!selected) {
        res.json({ cancelled: true });
        return;
      }

      res.json({ path: selected });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Klasör seçilemedi';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/analyze', async (req: Request, res: Response) => {
    const body = req.body as AnalyzeRequest;
    const sourceMode: SourceMode = body.sourceMode === 'local' ? 'local' : 'remote';
    const { sourceBranch, repoUrl, localRepoPath } = body;

    if (!sourceBranch) {
      res.status(400).json({ error: 'sourceBranch is required' });
      return;
    }

    if (sourceMode === 'local' && !localRepoPath?.trim()) {
      res.status(400).json({ error: 'localRepoPath is required for local source' });
      return;
    }

    if (sourceMode === 'remote' && !repoUrl?.trim()) {
      res.status(400).json({ error: 'repoUrl is required for remote source' });
      return;
    }

    try {
      const result = await analyzeRepository(sourceMode, sourceBranch, {
        repoUrl,
        localRepoPath,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analiz başarısız oldu';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/jobs/start', (req: Request, res: Response) => {
    const body = req.body as StartJobRequest;
    const sourceMode: SourceMode = body.sourceMode === 'local' ? 'local' : 'remote';
    const {
      repoUrl,
      localRepoPath,
      sourceBranch,
      targetJavaVersion,
      sourceJavaVersion,
      workspaceRoot,
    } = body;

    if (!sourceBranch) {
      res.status(400).json({ error: 'sourceBranch is required' });
      return;
    }

    if (sourceMode === 'local' && !localRepoPath?.trim()) {
      res.status(400).json({ error: 'localRepoPath is required for local source' });
      return;
    }

    if (sourceMode === 'remote' && !repoUrl?.trim()) {
      res.status(400).json({ error: 'repoUrl is required for remote source' });
      return;
    }

    const jobId = uuidv4();
    const version = targetJavaVersion || '21';
    const upgradeBranch = buildUpgradeBranchBase(version);

    const job: Job = {
      id: jobId,
      sourceMode,
      repoUrl: repoUrl?.trim() || '',
      localRepoPath: localRepoPath?.trim() || '',
      workspaceRoot: workspaceRoot?.trim() || '',
      sourceBranch,
      sourceJavaVersion: sourceJavaVersion?.trim() || '',
      targetJavaVersion: version,
      status: 'pending',
      logs: [],
      diff: '',
      report: null,
      workspacePath: resolveJobWorkspacePath(jobId, workspaceRoot),
      upgradeBranch,
      listeners: new Set(),
    };

    createJob(job);
    res.status(201).json({ jobId, upgradeBranch });

    runUpgradeJob(jobId).catch((err) => {
      console.error(`Job ${jobId} failed:`, err);
    });
  });

  app.get('/api/jobs/:jobId/events', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: { type: string; data: string }) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    sendEvent({ type: 'status', data: job.status });
    sendEvent({ type: 'branch', data: job.upgradeBranch });
    for (const line of job.logs) {
      sendEvent({ type: 'log', data: line });
    }

    const listener = (event: { type: string; data: string }) => {
      sendEvent(event);
    };

    job.listeners.add(listener);

    req.on('close', () => {
      job.listeners.delete(listener);
    });
  });

  app.get('/api/jobs/:jobId/report', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const reportPath = path.join(job.workspacePath, 'MIGRATION_REPORT.md');
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, 'utf-8');
      job.report = content;
      res.json({ content });
      return;
    }

    if (job.report) {
      res.json({ content: job.report });
      return;
    }

    res.status(404).json({ error: 'MIGRATION_REPORT.md not found' });
  });

  app.get('/api/jobs/:jobId/diff', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({ diff: job.diff || '' });
  });

  app.post('/api/jobs/:jobId/build', async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({ message: 'Build started' });

    runBuild(jobId).catch((err) => {
      console.error(`Build for job ${jobId} failed:`, err);
    });
  });

  app.post('/api/jobs/:jobId/push', async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({ message: 'Push started' });

    runPush(jobId).catch((err) => {
      console.error(`Push for job ${jobId} failed:`, err);
    });
  });
}

async function startServer(): Promise<void> {
  const config = await initAppConfig();
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());
  registerRoutes(app, config);

  app.listen(config.serverPort, () => {
    console.log(`java-upgrade-agent backend listening on port ${config.serverPort}`);
    console.log(`[config] Kaynaklar: ${config.configSources.join(', ')}`);
  });
}

startServer().catch((err) => {
  console.error('Backend başlatılamadı:', err);
  process.exit(1);
});
