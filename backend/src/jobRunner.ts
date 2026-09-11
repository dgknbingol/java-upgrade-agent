import fs from 'fs';
import path from 'path';
import { saveArtifacts } from './artifacts';
import { resolveAvailableUpgradeBranch } from './branchResolver';
import { detectJavaVersion } from './javaVersionAnalyzer';
import { javaVersionsDiffer } from './javaVersionUtils';
import { applyPomJavaUpgrade, writeUpgradePromptFile } from './pomUpgrader';
import { buildMavenFixPrompt } from './prompts/javaUpgradePrompt';
import {
  analyzeMigrationScope,
  writeMigrationAnalysisFile,
} from './migrationAnalyzer';
import {
  MIGRATION_PHASES,
  buildMigrationContinuationPrompt,
  buildPhasePrompt,
} from './migrationPrompts';
import {
  validateMigration,
  writeValidationReport,
} from './migrationValidator';
import { assertPrerequisites } from './prerequisites';
import { getProcessEnv, resolveCommand, resolveCopilotSpawn } from './processEnv';
import { getAppConfig } from './config/appConfig';
import { getJob } from './jobStore';
import { spawnCommand } from './spawnUtil';
import { Job, JobStatus, SSEEvent } from './types';

function emit(job: Job, event: SSEEvent): void {
  const line =
    event.type === 'log'
      ? event.data
      : event.type === 'branch'
        ? `[branch] ${event.data}`
        : `[status] ${event.data}`;
  job.logs.push(line);
  for (const listener of job.listeners) {
    listener(event);
  }
}

function setUpgradeBranch(job: Job, branchName: string): void {
  job.upgradeBranch = branchName;
  emit(job, { type: 'branch', data: branchName });
}

function setStatus(job: Job, status: JobStatus): void {
  job.status = status;
  emit(job, { type: 'status', data: status });
}

function appendLog(job: Job, line: string): void {
  emit(job, { type: 'log', data: line });
}

function attachProcessListeners(
  job: Job,
  command: string,
  child: ReturnType<typeof spawnCommand>,
  resolve: (code: number) => void,
  reject: (err: Error) => void
): void {
  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    text.split(/\r?\n/).forEach((line) => {
      if (line.length > 0) appendLog(job, line);
    });
  });

  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    text.split(/\r?\n/).forEach((line) => {
      if (line.length > 0) appendLog(job, `[stderr] ${line}`);
    });
  });

  child.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      reject(
        new Error(
          `'${command}' komutu bulunamadı. PATH'e eklendiğinden ve backend'in çalıştığı terminalden erişilebildiğinden emin olun.`
        )
      );
    } else {
      reject(new Error(`${command} başlatılamadı: ${err.message}`));
    }
  });

  child.on('close', (code) => {
    resolve(code ?? 1);
  });
}

function streamProcessOutput(
  job: Job,
  stream: NodeJS.ReadableStream | null,
  options: { prefix?: string; onChunk?: (text: string) => void } = {}
): void {
  if (!stream) return;

  let buffer = '';
  const prefix = options.prefix ?? '';

  const flush = (force = false) => {
    if (!buffer) return;

    const lines = buffer.split(/\r?\n/);
    if (!force && !buffer.endsWith('\n') && !buffer.endsWith('\r')) {
      buffer = lines.pop() ?? '';
    } else {
      buffer = '';
    }

    for (const line of lines) {
      if (line.length > 0) {
        appendLog(job, `${prefix}${line}`);
      }
    }

    if (force && buffer.length > 0) {
      appendLog(job, `${prefix}${buffer}`);
      buffer = '';
    }
  };

  stream.on('data', (data: Buffer) => {
    const text = data.toString();
    options.onChunk?.(text);
    buffer += text;
    flush(false);

    if (buffer.length > 500) {
      flush(true);
    }
  });

  stream.on('end', () => flush(true));
}

function runCopilot(job: Job, prompt: string): Promise<number> {
  const { copilotCommand, copilotIdleHeartbeatSeconds } = getAppConfig();

  return new Promise((resolve, reject) => {
    const { executable, prefixArgs } = resolveCopilotSpawn();
    const args = [
      ...prefixArgs,
      '-p',
      prompt,
      '--allow-all-tools',
      '--allow-all-paths',
      '--no-ask-user',
      '--autopilot',
      '--stream',
      'on',
    ];

    appendLog(
      job,
      '> copilot -p "<migration prompt>" --allow-all-tools --stream on --autopilot'
    );
    appendLog(job, 'Copilot dosya düzenlemeleri yapacak; Maven build pipeline tarafından çalıştırılacak.');

    const child = spawnCommand(executable, args, {
      cwd: job.workspacePath,
      env: getProcessEnv(),
      shell: false,
    });

    let stderrTail = '';
    let lastOutputAt = Date.now();

    const heartbeatMs = copilotIdleHeartbeatSeconds * 1000;
    const heartbeat = setInterval(() => {
      const idleSeconds = Math.round((Date.now() - lastOutputAt) / 1000);
      if (idleSeconds >= copilotIdleHeartbeatSeconds) {
        appendLog(job, `[Copilot] Migration devam ediyor... (${idleSeconds}s)`);
      }
    }, heartbeatMs);

    streamProcessOutput(job, child.stdout, {
      onChunk: () => {
        lastOutputAt = Date.now();
      },
    });

    streamProcessOutput(job, child.stderr, {
      prefix: '[stderr] ',
      onChunk: (text) => {
        lastOutputAt = Date.now();
        stderrTail = (stderrTail + text).slice(-2000);
      },
    });

    child.on('error', (err) => {
      clearInterval(heartbeat);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(
          new Error(
            `'${copilotCommand}' komutu bulunamadı. PATH'e eklendiğinden ve backend'in çalıştığı terminalden erişilebildiğinden emin olun.`
          )
        );
      } else {
        reject(new Error(`${copilotCommand} başlatılamadı: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      clearInterval(heartbeat);
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        job.error = stderrTail.trim() || `Copilot exit code ${exitCode}`;
      }
      resolve(exitCode);
    });
  });
}

async function workspaceHasChanges(job: Job): Promise<boolean> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawnCommand(resolveCommand('git'), ['status', '--porcelain'], {
      cwd: job.workspacePath,
      env: getProcessEnv(),
    });
    let text = '';
    child.stdout?.on('data', (data: Buffer) => {
      text += data.toString();
    });
    child.on('error', reject);
    child.on('close', () => resolve(text));
  });
  return output.trim().length > 0;
}

function runProcessCapture(
  job: Job,
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const executable = resolveCommand(command);
    appendLog(job, `> ${command} ${args.join(' ')}`.trim());

    const child = spawnCommand(executable, args, {
      cwd: options.cwd,
      env: getProcessEnv(),
    });

    let output = '';

    const appendOutput = (text: string) => {
      output += text;
      if (output.length > 80000) {
        output = output.slice(-80000);
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      appendOutput(text);
      text.split(/\r?\n/).forEach((line) => {
        if (line.length > 0) appendLog(job, line);
      });
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      appendOutput(text);
      text.split(/\r?\n/).forEach((line) => {
        if (line.length > 0) appendLog(job, `[stderr] ${line}`);
      });
    });

    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(
          new Error(
            `'${command}' komutu bulunamadı. PATH'e eklendiğinden ve backend'in çalıştığı terminalden erişilebildiğinden emin olun.`
          )
        );
      } else {
        reject(new Error(`${command} başlatılamadı: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

interface MavenBuildLoopResult {
  success: boolean;
  lastOutput: string;
}

async function runMavenBuildWithFixLoop(
  job: Job,
  options: { throwOnExhausted?: boolean; roundLabel?: string } = {}
): Promise<MavenBuildLoopResult> {
  const { maxBuildFixAttempts } = getAppConfig();
  const throwOnExhausted = options.throwOnExhausted ?? true;
  const roundPrefix = options.roundLabel ? `${options.roundLabel} ` : '';
  let lastOutput = '';

  for (let attempt = 1; attempt <= maxBuildFixAttempts; attempt++) {
    setStatus(job, 'building');
    appendLog(
      job,
      `${roundPrefix}Maven build denemesi ${attempt}/${maxBuildFixAttempts}...`
    );

    const { code, output } = await runProcessCapture(
      job,
      'mvn',
      ['clean', 'install'],
      { cwd: job.workspacePath }
    );
    lastOutput = output;

    if (code === 0) {
      appendLog(job, `${roundPrefix}Maven build başarılı.`);
      return { success: true, lastOutput };
    }

    if (attempt >= maxBuildFixAttempts) {
      if (throwOnExhausted) {
        throw new Error(
          `mvn clean install ${maxBuildFixAttempts} denemeden sonra başarısız oldu.`
        );
      }
      appendLog(
        job,
        `${roundPrefix}Inner build loop tükendi — sonraki migration turuna geçilebilir.`
      );
      return { success: false, lastOutput };
    }

    appendLog(
      job,
      `${roundPrefix}Build başarısız. Copilot fix (${attempt}/${maxBuildFixAttempts - 1})...`
    );
    setStatus(job, 'running-copilot');

    const fixPrompt = buildMavenFixPrompt(
      job.targetJavaVersion,
      job.sourceJavaVersion || 'unknown',
      output,
      {
        springBootVersion: analyzeMigrationScope(job.workspacePath, job.targetJavaVersion)
          .springBootVersion,
      }
    );
    writeUpgradePromptFile(job.workspacePath, fixPrompt);

    const copilotCode = await runCopilot(job, fixPrompt);
    if (copilotCode !== 0) {
      const detail = job.error?.trim();
      throw new Error(
        detail
          ? `Copilot build düzeltmesi başarısız: ${detail}`
          : 'Copilot build düzeltmesi başarısız oldu.'
      );
    }
  }

  return { success: false, lastOutput };
}

function runProcess(
  job: Job,
  command: string,
  args: string[],
  options: { cwd?: string; input?: string } = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const executable = resolveCommand(command);
    appendLog(job, `> ${command} ${args.join(' ')}`.trim());

    const child = spawnCommand(executable, args, {
      cwd: options.cwd,
      env: getProcessEnv(),
    });

    if (options.input) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }

    attachProcessListeners(job, command, child, resolve, reject);
  });
}

async function runMigrationPhases(
  job: Job,
  analysis: ReturnType<typeof analyzeMigrationScope>
): Promise<void> {
  for (const phase of MIGRATION_PHASES) {
    appendLog(job, `=== Migration fazı: ${phase} ===`);
    setStatus(job, 'running-copilot');

    const prompt = buildPhasePrompt(
      phase,
      job.targetJavaVersion,
      job.sourceJavaVersion || analysis.sourceJavaVersion,
      analysis
    );
    writeUpgradePromptFile(job.workspacePath, prompt);

    const copilotCode = await runCopilot(job, prompt);
    if (copilotCode !== 0) {
      appendLog(
        job,
        `UYARI: Faz "${phase}" Copilot exit ${copilotCode} — sonraki faza devam ediliyor`
      );
    }
  }
}

async function runMigrationOrchestration(
  job: Job,
  baselineAnalysis: ReturnType<typeof analyzeMigrationScope>
): Promise<void> {
  const { maxMigrationRounds } = getAppConfig();
  let lastValidation: Awaited<ReturnType<typeof validateMigration>> | null = null;
  let lastBuildLog = '';

  for (let round = 1; round <= maxMigrationRounds; round++) {
    const roundLabel = `Tur ${round}/${maxMigrationRounds}`;
    appendLog(job, `========== Migration ${roundLabel} ==========`);

    const analysis = analyzeMigrationScope(job.workspacePath, job.targetJavaVersion);
    writeMigrationAnalysisFile(job.workspacePath, analysis);
    appendLog(
      job,
      `${roundLabel} analiz: ${analysis.compatibilityFindings.length} uyumluluk sinyali`
    );

    setStatus(job, 'running-copilot');

    if (round === 1) {
      if (javaVersionsDiffer(job.sourceJavaVersion, job.targetJavaVersion)) {
        appendLog(job, 'Temel pom.xml Java ayarları (baseline)...');
        if (applyPomJavaUpgrade(job.workspacePath, job.targetJavaVersion)) {
          appendLog(job, `pom.xml Java ${job.targetJavaVersion} baseline olarak ayarlandı.`);
        }
      }
      await runMigrationPhases(job, analysis);
      await ensureMigrationChanges(job, { round });
    } else {
      const prompt = buildMigrationContinuationPrompt(
        job.targetJavaVersion,
        job.sourceJavaVersion || analysis.sourceJavaVersion,
        analysis,
        {
          round,
          maxRounds: maxMigrationRounds,
          validation: lastValidation ?? undefined,
          buildLog: lastBuildLog || undefined,
        }
      );
      writeUpgradePromptFile(job.workspacePath, prompt);
      const copilotCode = await runCopilot(job, prompt);
      if (copilotCode !== 0) {
        appendLog(job, `UYARI: ${roundLabel} Copilot exit ${copilotCode} — build denenecek`);
      }
      await ensureMigrationChanges(job, { round });
    }

    const buildResult = await runMavenBuildWithFixLoop(job, {
      throwOnExhausted: false,
      roundLabel,
    });
    lastBuildLog = buildResult.lastOutput;

    if (!buildResult.success) {
      if (round >= maxMigrationRounds) {
        throw new Error(
          `mvn clean install ${maxMigrationRounds} migration turu sonunda başarısız.`
        );
      }
      appendLog(job, `${roundLabel} build tamamlanamadı — sonraki turda devam edilecek.`);
      continue;
    }

    lastValidation = await validateMigration(
      job.workspacePath,
      job.targetJavaVersion,
      job.sourceBranch,
      baselineAnalysis
    );
    writeValidationReport(job.workspacePath, lastValidation);

    if (lastValidation.passed) {
      appendLog(job, `${roundLabel}: validation geçti — migration tamam.`);
      lastValidation.warnings.forEach((w) => appendLog(job, `[uyarı] ${w.message}`));
      return;
    }

    appendLog(
      job,
      `${roundLabel}: validation başarısız (${lastValidation.errors.length} hata).`
    );
    lastValidation.errors.forEach((e) => appendLog(job, `[validation] ${e.message}`));

    if (round >= maxMigrationRounds) {
      const softCodes = new Set(['NO_COMPATIBILITY_PROGRESS', 'NO_SOURCE_CHANGES']);
      const blocking = lastValidation.errors.filter((e) => !softCodes.has(e.code));
      if (blocking.length === 0) {
        appendLog(
          job,
          `${maxMigrationRounds} tur: Maven build başarılı — migration tamam (validation uyarıları logda).`
        );
        lastValidation.warnings.forEach((w) => appendLog(job, `[uyarı] ${w.message}`));
        return;
      }
      const summary = blocking.map((e) => e.message).join('; ');
      throw new Error(`Migration validation ${maxMigrationRounds} tur sonunda başarısız: ${summary}`);
    }

    appendLog(job, `${roundLabel} tamamlanmadı — sonraki turda analyze + copilot devam edecek.`);
  }
}

async function ensureMigrationChanges(
  job: Job,
  options: { round?: number } = {}
): Promise<void> {
  const upgradeNeeded = javaVersionsDiffer(
    job.sourceJavaVersion,
    job.targetJavaVersion
  );

  if (!upgradeNeeded) {
    appendLog(
      job,
      `Proje zaten Java ${job.targetJavaVersion} üzerinde görünüyor; migration atlanabilir.`
    );
    return;
  }

  let hasChanges = await workspaceHasChanges(job);

  if (!hasChanges) {
    appendLog(
      job,
      'UYARI: Copilot dosya değiştirmedi. Otomatik pom.xml güncellemesi deneniyor...'
    );
    const applied = applyPomJavaUpgrade(job.workspacePath, job.targetJavaVersion);
    if (applied) {
      appendLog(job, 'pom.xml otomatik güncellendi (yedek mekanizma).');
      hasChanges = true;
    }
  }

  if (options.round && options.round > 1) {
    appendLog(
      job,
      `UYARI: Tur ${options.round} yeni dosya değişikliği üretmedi — önceki tur değişiklikleri korunuyor.`
    );
    return;
  }

  if (!hasChanges) {
    throw new Error(
      `Migration yapılmadı: kaynak Java ${job.sourceJavaVersion}, hedef Java ${job.targetJavaVersion}. ` +
        'Copilot dosya düzenlemedi. Copilot CLI oturumunu ve --allow-all-tools izinlerini kontrol edin.'
    );
  }
}

export async function runUpgradeJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  try {
    await assertPrerequisites();

    fs.mkdirSync(path.dirname(job.workspacePath), { recursive: true });

    const cloneSource =
      job.sourceMode === 'local' ? job.localRepoPath : job.repoUrl;

    setStatus(job, 'cloning');
    appendLog(
      job,
      `Workspace: ${job.workspacePath}${job.workspaceRoot ? '' : ' (varsayılan)'}`
    );
    appendLog(
      job,
      job.sourceMode === 'local'
        ? `Yerel kaynak klonlanıyor: ${cloneSource}`
        : `Uzak repo klonlanıyor: ${cloneSource}`
    );

    const cloneCode = await runProcess(job, 'git', ['clone', cloneSource, job.workspacePath]);
    if (cloneCode !== 0) {
      throw new Error('git clone failed');
    }

    setStatus(job, 'checking-out');
    const checkoutCode = await runProcess(
      job,
      'git',
      ['checkout', job.sourceBranch],
      { cwd: job.workspacePath }
    );
    if (checkoutCode !== 0) {
      throw new Error(`git checkout ${job.sourceBranch} failed`);
    }

    await runProcess(job, 'git', ['fetch', 'origin'], { cwd: job.workspacePath });

    const detected = detectJavaVersion(job.workspacePath);
    job.sourceJavaVersion = detected.currentJavaVersion;
    appendLog(
      job,
      `Tespit edilen Java sürümü: ${detected.displayVersion} (${detected.detectedFrom})`
    );

    setStatus(job, 'creating-branch');
    const resolvedBranch = await resolveAvailableUpgradeBranch(
      job.workspacePath,
      job.targetJavaVersion
    );
    setUpgradeBranch(job, resolvedBranch);
    appendLog(job, `Oluşturulan branch: ${resolvedBranch}`);

    const branchCode = await runProcess(
      job,
      'git',
      ['checkout', '-b', resolvedBranch],
      { cwd: job.workspacePath }
    );
    if (branchCode !== 0) {
      throw new Error(`failed to create branch ${resolvedBranch}`);
    }

    setStatus(job, 'running-copilot');
    const baselineAnalysis = analyzeMigrationScope(
      job.workspacePath,
      job.targetJavaVersion
    );
    await runMigrationOrchestration(job, baselineAnalysis);

    await saveArtifacts(job);
    setStatus(job, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.error = message;
    appendLog(job, `ERROR: ${message}`);
    try {
      await saveArtifacts(job);
    } catch {
      // ignore artifact save errors on failure path
    }
    setStatus(job, 'failed');
  }
}

export async function runBuild(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');

  try {
    setStatus(job, 'building-only');
    await assertPrerequisites();

    const buildResult = await runMavenBuildWithFixLoop(job);
    if (!buildResult.success) {
      throw new Error('mvn clean install başarısız oldu.');
    }
    await saveArtifacts(job);
    setStatus(job, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.error = message;
    appendLog(job, `ERROR: ${message}`);
    try {
      await saveArtifacts(job);
    } catch {
      // ignore
    }
    setStatus(job, 'failed');
    throw err;
  }
}

export async function runPush(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');

  try {
    setStatus(job, 'pushing');
    const pushCode = await runProcess(
      job,
      'git',
      ['push', '-u', 'origin', job.upgradeBranch],
      { cwd: job.workspacePath }
    );
    if (pushCode !== 0) {
      throw new Error('git push failed');
    }
    appendLog(job, `Branch ${job.upgradeBranch} pushed to origin.`);
    setStatus(job, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.error = message;
    appendLog(job, `ERROR: ${message}`);
    setStatus(job, 'failed');
    throw err;
  }
}
