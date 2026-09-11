import fs from 'fs';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { JobCancelledError, isJobCancelled, trackJobProcess, terminateProcessTree } from '../jobCancellation';
import { getCurrentJobId } from '../jobContext';
import { runMavenPackage } from './mavenService';
import { getProcessEnv, resolveCommand } from './processEnv';
import { spawnCommand } from './spawnUtil';

const SKIP_DIRS = new Set(['node_modules', 'target', 'build', '.git', '.idea', 'dist', 'out']);

export type StartupRunMode = 'auto' | 'jar' | 'maven';

export interface SpringBootRunTarget {
  modulePath: string;
  displayName: string;
}

export interface StartupRunOptions {
  profile?: string;
  timeoutSeconds: number;
  runMode?: StartupRunMode;
  /** Başarılı start sonrası ek izleme süresi (geç runtime hataları için). 0 = hemen kapat. */
  postSuccessSeconds?: number;
  jobId?: string;
}

export interface StartupRunResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  output: string;
  target?: SpringBootRunTarget;
  runMethod?: 'jar' | 'maven';
}

const STARTUP_SUCCESS_PATTERNS = [
  /Started\s+[\w$.]+\s+in\s+\d/i,
  /Tomcat started on port/i,
  /Netty started on port/i,
  /Undertow started on port/i,
  /JVM running for/i,
];

const STARTUP_FAILURE_PATTERNS = [
  /APPLICATION FAILED TO START/i,
  /Application run failed/i,
  /Error starting ApplicationContext/i,
  /BeanCreationException/i,
  /BeanInstantiationException/i,
  /ApplicationContextException/i,
  /UnsatisfiedDependencyException/i,
  /ClassNotFoundException/i,
  /NoClassDefFoundError/i,
  /IllegalStateException/i,
  /Failed to configure a DataSource/i,
  /Error creating bean with name/i,
  /BUILD FAILURE/i,
  /Process terminated with exit code/i,
  /Exception in thread "main"/i,
  /Caused by:/i,
];

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]+)\\s*</${tag}>`, 'i'));
  return m?.[1]?.trim() ?? null;
}

function listModulePoms(workspacePath: string): { relPath: string; absPath: string }[] {
  const results: { relPath: string; absPath: string }[] = [];

  function walk(dir: string, rel: string, depth: number): void {
    if (depth > 5) return;
    const pomPath = path.join(dir, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      results.push({ relPath: rel || '.', absPath: pomPath });
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      walk(path.join(dir, entry.name), childRel, depth + 1);
    }
  }

  walk(workspacePath, '', 0);
  return results;
}

export function detectSpringBootRunTarget(workspacePath: string): SpringBootRunTarget | null {
  const candidates: SpringBootRunTarget[] = [];

  for (const { relPath, absPath } of listModulePoms(workspacePath)) {
    const xml = fs.readFileSync(absPath, 'utf-8');
    if (!/spring-boot-maven-plugin/i.test(xml)) continue;

    const packaging = extractTag(xml, 'packaging') ?? 'jar';
    if (packaging === 'pom') continue;

    candidates.push({
      modulePath: relPath === '.' ? '.' : relPath.replace(/\\/g, '/'),
      displayName: relPath === '.' ? 'root' : relPath.replace(/\\/g, '/'),
    });
  }

  if (candidates.length === 0) return null;

  const withStarter = candidates.filter((c) => {
    const pomPath =
      c.modulePath === '.'
        ? path.join(workspacePath, 'pom.xml')
        : path.join(workspacePath, c.modulePath.replace(/\//g, path.sep), 'pom.xml');
    const xml = fs.readFileSync(pomPath, 'utf-8');
    return /spring-boot-starter(?!-parent)/i.test(xml) || /<start-class>/i.test(xml);
  });

  const pool = withStarter.length > 0 ? withStarter : candidates;
  pool.sort((a, b) => a.modulePath.split('/').length - b.modulePath.split('/').length);
  return pool[0] ?? null;
}

function moduleDirectory(workspacePath: string, target: SpringBootRunTarget): string {
  if (target.modulePath === '.') return workspacePath;
  return path.join(workspacePath, target.modulePath.replace(/\//g, path.sep));
}

export function findRunnableJar(workspacePath: string, target: SpringBootRunTarget): string | null {
  const targetDir = path.join(moduleDirectory(workspacePath, target), 'target');
  if (!fs.existsSync(targetDir)) return null;

  const jars = fs
    .readdirSync(targetDir)
    .filter((name) => name.endsWith('.jar'))
    .filter(
      (name) =>
        !name.includes('-sources') &&
        !name.includes('-javadoc') &&
        !name.includes('-original') &&
        !name.includes('-tests')
    )
    .map((name) => {
      const fullPath = path.join(targetDir, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (jars.length === 0) return null;

  const executable = jars.filter((j) => !j.name.endsWith('-plain.jar'));
  const pick = executable[0] ?? jars[0];
  return pick?.fullPath ?? null;
}

function isStartupSuccess(output: string): boolean {
  return STARTUP_SUCCESS_PATTERNS.some((re) => re.test(output));
}

function isStartupFailure(output: string): boolean {
  if (isStartupSuccess(output)) {
    return false;
  }
  return STARTUP_FAILURE_PATTERNS.some((re) => re.test(output));
}

function resolveStartupOutcome(
  output: string,
  started: boolean,
  exitCode: number | null
): { success: boolean; reason?: string } {
  if (isStartupFailure(output)) {
    return { success: false, reason: 'startup-failed' };
  }
  if (started || isStartupSuccess(output)) {
    return { success: true };
  }
  if (exitCode !== 0 && exitCode !== null) {
    return { success: false, reason: `exit-${exitCode}` };
  }
  if (output.trim().length > 0 && !isStartupSuccess(output)) {
    return { success: false, reason: 'startup-failed' };
  }
  return { success: false, reason: 'no-startup-signal' };
}

function logLines(text: string, onLog?: (line: string) => void, prefix = ''): void {
  if (!onLog) return;
  text.split(/\r?\n/).forEach((line) => {
    if (line.length > 0) onLog(`${prefix}${line}`);
  });
}

interface ManagedRunParams {
  executable: string;
  args: string[];
  cwd: string;
  label: string;
  options: StartupRunOptions;
  target: SpringBootRunTarget;
  runMethod: 'jar' | 'maven';
  onLog?: (line: string) => void;
}

function runManagedStartup(params: ManagedRunParams): Promise<StartupRunResult> {
  const { executable, args, cwd, label, options, target, runMethod, onLog } = params;
  const jobId = options.jobId ?? getCurrentJobId() ?? undefined;
  const postSuccessMs = Math.max(0, (options.postSuccessSeconds ?? 15) * 1000);

  if (jobId && isJobCancelled(jobId)) {
    return Promise.reject(new JobCancelledError());
  }

  onLog?.(`${label} (timeout ${options.timeoutSeconds}s, modül ${target.displayName})`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    let child: ChildProcess;
    let postSuccessTimer: ReturnType<typeof setTimeout> | null = null;
    let started = false;

    const finish = (result: StartupRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (postSuccessTimer) clearTimeout(postSuccessTimer);
      resolve(result);
    };

    const fail = (reason: string) => {
      terminateProcessTree(child);
      finish({
        success: false,
        skipped: false,
        output,
        target,
        runMethod,
        reason,
      });
    };

    const succeed = () => {
      terminateProcessTree(child);
      finish({
        success: true,
        skipped: false,
        output,
        target,
        runMethod,
      });
    };

    const append = (text: string) => {
      output = (output + text).slice(-40000);

      if (!started && isStartupFailure(output)) {
        fail('startup-failed');
        return;
      }

      if (!started && isStartupSuccess(output)) {
        started = true;
        if (postSuccessMs <= 0) {
          succeed();
          return;
        }
        onLog?.(
          `Uygulama başladı — ${options.postSuccessSeconds ?? 15}s daha izleniyor (geç hatalar için)...`
        );
        postSuccessTimer = setTimeout(() => {
          if (!settled) succeed();
        }, postSuccessMs);
        return;
      }

      if (started && isStartupFailure(output)) {
        fail('runtime-failed');
      }
    };

    try {
      child = spawnCommand(executable, args, {
        cwd,
        env: getProcessEnv(),
      });
    } catch (err) {
      reject(err);
      return;
    }

    if (jobId) {
      trackJobProcess(jobId, child);
    }

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      logLines(text, onLog);
      append(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      logLines(text, onLog, '[stderr] ');
      append(text);
    });

    child.on('error', (err) => {
      if (!settled) reject(err);
    });

    const timer = setTimeout(() => {
      if (settled) return;
      terminateProcessTree(child);
      finish({
        success: started,
        skipped: false,
        output,
        target,
        runMethod,
        reason: started ? undefined : 'timeout',
      });
    }, options.timeoutSeconds * 1000);

    child.on('close', (code) => {
      if (settled) return;
      if (jobId && isJobCancelled(jobId)) {
        reject(new JobCancelledError());
        return;
      }
      const outcome = resolveStartupOutcome(output, started, code);
      finish({
        success: outcome.success,
        skipped: false,
        output,
        target,
        runMethod,
        reason: outcome.reason,
      });
    });
  });
}

function buildMavenRunArgs(target: SpringBootRunTarget, profile?: string): string[] {
  const args: string[] = [];
  if (target.modulePath !== '.') {
    args.push('-pl', target.modulePath, '-am');
  }
  args.push(
    'spring-boot:run',
    '-DskipTests',
    '-Dspring-boot.run.jvmArguments=-Dspring.main.lazy-initialization=false'
  );
  if (profile?.trim()) {
    args.push(`-Dspring-boot.run.profiles=${profile.trim()}`);
  }
  return args;
}

function buildJavaJarArgs(jarPath: string, profile?: string): string[] {
  const args: string[] = [];
  if (profile?.trim()) {
    args.push(`-Dspring.profiles.active=${profile.trim()}`);
  }
  args.push('-jar', jarPath);
  return args;
}

export async function runStartupForWorkspace(
  workspacePath: string,
  options: StartupRunOptions,
  onLog?: (line: string) => void
): Promise<StartupRunResult> {
  const target = detectSpringBootRunTarget(workspacePath);
  if (!target) {
    onLog?.('Startup run atlandı: Spring Boot uygulaması bulunamadı.');
    return { success: true, skipped: true, reason: 'not-spring-boot', output: '' };
  }

  const mode = options.runMode ?? 'jar';
  onLog?.(`Spring Boot modülü: ${target.displayName} (run mode: ${mode})`);

  let jarPath = findRunnableJar(workspacePath, target);
  const tryJar = mode === 'jar' || mode === 'auto';
  const tryMaven = mode === 'maven' || mode === 'auto';
  let priorOutput = '';

  if (tryJar && !jarPath) {
    onLog?.('Jar bulunamadı — mvn package ile derleniyor...');
    const packaged = await runMavenPackage(workspacePath, onLog, {
      modulePath: target.modulePath,
    });
    if (!packaged.success) {
      return {
        success: false,
        skipped: false,
        reason: 'jar-build-failed',
        output: packaged.output,
        target,
      };
    }
    jarPath = findRunnableJar(workspacePath, target);
    if (!jarPath) {
      return {
        success: false,
        skipped: false,
        reason: 'jar-not-found',
        output: packaged.output,
        target,
      };
    }
  }

  if (tryJar && jarPath) {
    onLog?.(`Normal run: java -jar ${path.basename(jarPath)}`);
    const result = await runManagedStartup({
      executable: resolveCommand('java'),
      args: buildJavaJarArgs(jarPath, options.profile),
      cwd: moduleDirectory(workspacePath, target),
      label: `> java ${buildJavaJarArgs(jarPath, options.profile).join(' ')}`,
      options,
      target,
      runMethod: 'jar',
      onLog,
    });
    if (result.success || mode === 'jar') {
      return result;
    }
    priorOutput = result.output;
    if (mode === 'auto') {
      onLog?.('Jar run başarısız — spring-boot:run deneniyor...');
    }
  } else if (mode === 'jar') {
    return {
      success: false,
      skipped: false,
      reason: 'jar-not-found',
      output: priorOutput,
      target,
    };
  }

  if (tryMaven) {
    const mvnArgs = buildMavenRunArgs(target, options.profile);
    onLog?.(`Maven run: mvn ${mvnArgs.join(' ')}`);
    const mavenResult = await runManagedStartup({
      executable: resolveCommand('mvn'),
      args: mvnArgs,
      cwd: workspacePath,
      label: `> mvn ${mvnArgs.join(' ')}`,
      options,
      target,
      runMethod: 'maven',
      onLog,
    });
    if (priorOutput.trim()) {
      return {
        ...mavenResult,
        output: `${priorOutput}\n--- jar run sonrası spring-boot:run ---\n${mavenResult.output}`,
      };
    }
    return mavenResult;
  }

  return { success: false, skipped: false, reason: 'no-run-method', output: priorOutput, target };
}

/** @deprecated use runStartupForWorkspace */
export const runSmokeForWorkspace = runStartupForWorkspace;

export type SmokeRunOptions = StartupRunOptions;
export type SmokeRunResult = StartupRunResult;
