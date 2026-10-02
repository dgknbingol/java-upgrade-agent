import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import {
  getPublicAppConfig,
  initAppConfig,
  saveCopilotModel,
  saveJiraSettings,
  savePipelineSettings,
  type JiraSettings,
  type PipelineSettings,
} from './config/appConfig';
import fs from 'fs';
import path from 'path';
import { checkHealth } from './services/healthService';
import { listCopilotModelOptions } from './services/copilotModelService';
import {
  analyzeRepository,
  getArtifacts,
  getActiveJobId,
  getLiveMigrationDiff,
  getLiveMigrationReport,
  pushUpgradeBranch,
  rollbackUpgrade,
  runBuildAgain,
  runBuildJob,
  runStartupAgain,
  runStartupJob,
  startSecurityRemediation,
  startUpgrade,
  stopJob,
} from './jobRunner';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function resolveAppIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [path.join(__dirname, '..', 'build', 'icon.png')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function sendLog(line: string): void {
  mainWindow?.webContents.send('job:log', line);
}

function sendStatus(status: string): void {
  mainWindow?.webContents.send('job:status', status);
}

function createWindow(): void {
  const icon = resolveAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Paytion Java Upgrade Desktop Agent',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle('app:getConfig', async () => getPublicAppConfig());

  ipcMain.handle('app:savePipelineConfig', async (_event, input: Partial<PipelineSettings>) =>
    savePipelineSettings(input)
  );

  ipcMain.handle(
    'app:saveTextFile',
    async (
      _event,
      options: { content: string; defaultFilename: string; title?: string }
    ) => {
      const saveOptions: SaveDialogOptions = {
        title: options.title || 'Dosyayı kaydet',
        defaultPath: options.defaultFilename,
        filters: [
          { name: 'Metin dosyaları', extensions: ['txt', 'md', 'log', 'diff', 'patch'] },
          { name: 'Tüm dosyalar', extensions: ['*'] },
        ],
      };

      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);

      if (result.canceled || !result.filePath) {
        return { saved: false, path: null };
      }

      fs.writeFileSync(result.filePath, options.content, 'utf-8');
      return { saved: true, path: result.filePath };
    }
  );

  ipcMain.handle('app:pickFolder', async (_event, title?: string) => {
    const dialogOptions: OpenDialogOptions = {
      title: title || 'Klasör seçin',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { path: null };
    }

    return { path: result.filePaths[0] };
  });

  ipcMain.handle('app:pickFile', async (_event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const dialogOptions: OpenDialogOptions = {
      title: options?.title || 'Dosya seçin',
      properties: ['openFile'],
      filters: options?.filters ?? [
        { name: 'Properties', extensions: ['properties'] },
        { name: 'Tüm dosyalar', extensions: ['*'] },
      ],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { path: null };
    }

    return { path: result.filePaths[0] };
  });

  ipcMain.handle('health:check', async (_event, targetJavaVersion?: string) =>
    checkHealth(targetJavaVersion)
  );

  ipcMain.handle('copilot:listModels', async () => listCopilotModelOptions());

  ipcMain.handle('app:saveCopilotModel', async (_event, model: string) => saveCopilotModel(model));

  ipcMain.handle('app:saveJiraConfig', async (_event, input: Partial<JiraSettings>) =>
    saveJiraSettings(input)
  );

  ipcMain.handle('job:analyze', async (_event, input) => {
    return analyzeRepository(input, sendLog);
  });

  ipcMain.handle('job:start', async (_event, input) => {
    return startUpgrade(input, sendLog, sendStatus);
  });

  ipcMain.handle('job:startSecurityFix', async (_event, input) => {
    return startSecurityRemediation(input, sendLog, sendStatus);
  });

  ipcMain.handle('job:runBuild', async (_event, jobId: string, options?: { skipTests?: boolean }) => {
    return runBuildAgain(jobId, sendLog, sendStatus, options);
  });

  ipcMain.handle('job:runBuildJob', async (_event, input) => {
    return runBuildJob(input, sendLog, sendStatus);
  });

  ipcMain.handle('job:runStartup', async (_event, jobId: string) => {
    return runStartupAgain(jobId, sendLog, sendStatus);
  });

  ipcMain.handle('job:runStartupJob', async (_event, input) => {
    return runStartupJob(input, sendLog, sendStatus);
  });

  ipcMain.handle('job:push', async (_event, jobId: string) => {
    await pushUpgradeBranch(jobId, sendLog, sendStatus);
    return { ok: true };
  });

  ipcMain.handle('job:rollback', async (_event, jobId: string) => {
    await rollbackUpgrade(jobId, sendLog, sendStatus);
    return { ok: true };
  });

  ipcMain.handle('job:stop', async (_event, jobId: string) => {
    return stopJob(jobId, sendLog, sendStatus);
  });

  ipcMain.handle('job:getLiveReport', async (_event, jobId: string) =>
    getLiveMigrationReport(jobId)
  );

  ipcMain.handle('job:getLiveDiff', async (_event, jobId: string) =>
    getLiveMigrationDiff(jobId)
  );

  ipcMain.handle('job:getArtifacts', async (_event, jobId: string) => {
    return getArtifacts(jobId);
  });

  ipcMain.handle('job:getActiveId', async () => getActiveJobId());
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.paytion.java-upgrade-desktop-agent');
  }

  initAppConfig();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
