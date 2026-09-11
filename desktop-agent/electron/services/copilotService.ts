import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { JobCancelledError, isJobCancelled, trackJobProcess } from '../jobCancellation';
import { getCurrentJobId } from '../jobContext';
import {
  isCopilotModelUnavailableMessage,
  resolveCopilotModel,
} from './copilotModelService';
import { getProcessEnv, resolveCopilotSpawn } from './processEnv';
import {
  ensureMigrationOutputDir,
  MIGRATION_FILE_NAMES,
  migrationOutputRelPath,
  resolveMigrationFilePath,
} from './migrationOutputPaths';

export interface CopilotRunOptions {
  model?: string;
}

export type CopilotTaskKind = 'migration' | 'build-fix' | 'runtime-fix';

const TASK_FILE_BY_KIND: Record<CopilotTaskKind, string> = {
  migration: MIGRATION_FILE_NAMES.promptTask,
  'build-fix': MIGRATION_FILE_NAMES.buildFixTask,
  'runtime-fix': MIGRATION_FILE_NAMES.runtimeFixTask,
};

export function writeTaskFile(
  workspacePath: string,
  taskKind: CopilotTaskKind,
  prompt: string
): string {
  ensureMigrationOutputDir(workspacePath);
  const fileName = TASK_FILE_BY_KIND[taskKind];
  const absPath = resolveMigrationFilePath(workspacePath, fileName);
  fs.writeFileSync(absPath, prompt, 'utf-8');
  return migrationOutputRelPath(fileName);
}

/** @deprecated use writeTaskFile */
export function writePromptFile(workspacePath: string, prompt: string): void {
  writeTaskFile(workspacePath, 'migration', prompt);
}

function buildShortCliPrompt(taskRelPath: string, taskKind: CopilotTaskKind): string {
  if (taskKind === 'build-fix') {
    return [
      `Open ${taskRelPath}. It contains a Maven failure log (same as pasting into Copilot Chat).`,
      'Fix that error by editing the project source/config/tests now. Do not only explain. Do not ask questions.',
    ].join(' ');
  }

  if (taskKind === 'runtime-fix') {
    return [
      `Open ${taskRelPath}. It contains an application startup failure log.`,
      'Fix that error by editing the project now. Do not only explain. Do not ask questions.',
    ].join(' ');
  }

  return [
    `Open and follow the instructions in ${taskRelPath} exactly.`,
    'This is a Java migration task.',
    'You MUST edit project source files and configuration.',
    'Do not only explain or suggest — apply the changes now with your editing tools.',
    'Do not ask questions. Start immediately.',
  ].join(' ');
}

interface CopilotCliResult {
  exitCode: number;
  outputTail: string;
}

function runCopilotCliOnce(
  workspacePath: string,
  cliPrompt: string,
  label: string,
  model: string,
  onLog?: (line: string) => void
): Promise<CopilotCliResult> {
  const jobId = getCurrentJobId() ?? undefined;
  if (jobId && isJobCancelled(jobId)) {
    return Promise.reject(new JobCancelledError());
  }

  return new Promise((resolve, reject) => {
    const { executable, prefixArgs } = resolveCopilotSpawn();
    const args = [
      ...prefixArgs,
      '-p',
      cliPrompt,
      '--model',
      model,
      '--allow-all-tools',
      '--allow-all-paths',
      '--no-ask-user',
      '--autopilot',
      '--stream',
      'on',
    ];

    onLog?.(`> copilot --model ${model} -p "<${label}>" --allow-all-tools --autopilot`);
    if (model === 'auto') {
      onLog?.('Copilot model: auto (hesabınızda kullanılabilir en iyi model seçilir).');
    }
    onLog?.('Copilot task dosyasını okuyup dosya düzenlemeleri yapacak.');

    const child: ChildProcess = spawn(executable, args, {
      cwd: workspacePath,
      env: getProcessEnv(),
      shell: false,
      windowsHide: true,
    });

    if (jobId) {
      trackJobProcess(jobId, child);
    }

    let outputTail = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      outputTail = (outputTail + text).slice(-4000);
      logLines(text, onLog);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      outputTail = (outputTail + text).slice(-4000);
      logLines(text, onLog, '[stderr] ');
    });

    child.on('error', (err) => {
      reject(new Error(`Copilot CLI başlatılamadı: ${err.message}`));
    });

    child.on('close', (code) => {
      if (jobId && isJobCancelled(jobId)) {
        reject(new JobCancelledError());
        return;
      }
      const exitCode = code ?? 1;
      if (exitCode !== 0 && outputTail.trim()) {
        onLog?.(`[copilot] ${outputTail.trim().split(/\r?\n/).slice(-3).join(' ')}`);
      }
      resolve({ exitCode, outputTail });
    });
  });
}

async function runCopilotCli(
  workspacePath: string,
  cliPrompt: string,
  label: string,
  onLog?: (line: string) => void,
  options: CopilotRunOptions = {}
): Promise<number> {
  const model = resolveCopilotModel(options.model);
  let result = await runCopilotCliOnce(workspacePath, cliPrompt, label, model, onLog);

  if (
    result.exitCode !== 0 &&
    model !== 'auto' &&
    isCopilotModelUnavailableMessage(result.outputTail)
  ) {
    onLog?.(
      `UYARI: "${model}" bu Copilot hesabında kullanılamıyor — auto ile yeniden deneniyor. ` +
        'Kalıcı çözüm: Copilot Model panelinden auto veya erişiminiz olan bir model seçip kaydedin.'
    );
    result = await runCopilotCliOnce(workspacePath, cliPrompt, label, 'auto', onLog);
  }

  return result.exitCode;
}

async function runCopilotTask(
  workspacePath: string,
  taskKind: CopilotTaskKind,
  promptBody: string,
  label: string,
  onLog?: (line: string) => void,
  model?: string
): Promise<number> {
  const taskRel = writeTaskFile(workspacePath, taskKind, promptBody);
  onLog?.(`Copilot task yazıldı: ${taskRel}`);
  const cliPrompt = buildShortCliPrompt(taskRel, taskKind);
  return runCopilotCli(workspacePath, cliPrompt, label, onLog, { model });
}

export async function runCopilotMigration(
  workspacePath: string,
  prompt: string,
  onLog?: (line: string) => void,
  model?: string
): Promise<number> {
  onLog?.(`Copilot migration başlatılıyor (model: ${resolveCopilotModel(model)})...`);
  return runCopilotTask(
    workspacePath,
    'migration',
    prompt,
    'migration prompt',
    onLog,
    model
  );
}

export async function runCopilotFix(
  workspacePath: string,
  prompt: string,
  onLog?: (line: string) => void,
  model?: string,
  label = 'fix prompt',
  taskKind: CopilotTaskKind = 'build-fix'
): Promise<number> {
  return runCopilotTask(workspacePath, taskKind, prompt, label, onLog, model);
}

function logLines(text: string, onLog?: (line: string) => void, prefix = ''): void {
  if (!onLog) return;
  text.split(/\r?\n/).forEach((line) => {
    if (line.length > 0) onLog(`${prefix}${line}`);
  });
}
