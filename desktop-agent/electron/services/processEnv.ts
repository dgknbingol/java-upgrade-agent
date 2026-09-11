import fs from 'fs';
import path from 'path';

function getChocolateyMavenBins(): string[] {
  const bins: string[] = [];
  const mavenRoot = 'C:\\ProgramData\\chocolatey\\lib\\maven';
  if (!fs.existsSync(mavenRoot)) return bins;

  for (const entry of fs.readdirSync(mavenRoot)) {
    if (!entry.startsWith('apache-maven')) continue;
    const bin = path.join(mavenRoot, entry, 'bin');
    if (fs.existsSync(bin)) bins.push(bin);
  }
  return bins;
}

function getWindowsExtraPaths(): string[] {
  const extra: string[] = [];

  const chocolateyBin = 'C:\\ProgramData\\chocolatey\\bin';
  if (fs.existsSync(chocolateyBin)) extra.push(chocolateyBin);

  for (const gitDir of ['C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\Git\\bin']) {
    if (fs.existsSync(gitDir)) extra.push(gitDir);
  }

  extra.push(...getChocolateyMavenBins());

  const adoptiumRoot = 'C:\\Program Files\\Eclipse Adoptium';
  if (fs.existsSync(adoptiumRoot)) {
    for (const entry of fs.readdirSync(adoptiumRoot)) {
      const bin = path.join(adoptiumRoot, entry, 'bin');
      if (fs.existsSync(bin)) extra.push(bin);
    }
  }

  const programFilesJava = 'C:\\Program Files\\Java';
  if (fs.existsSync(programFilesJava)) {
    for (const entry of fs.readdirSync(programFilesJava)) {
      const bin = path.join(programFilesJava, entry, 'bin');
      if (fs.existsSync(bin)) extra.push(bin);
    }
  }

  if (process.env.JAVA_HOME) {
    extra.push(path.join(process.env.JAVA_HOME, 'bin'));
  }

  if (process.env.MAVEN_HOME) {
    extra.push(path.join(process.env.MAVEN_HOME, 'bin'));
  }

  const npmGlobal = path.join(process.env.APPDATA || '', 'npm');
  if (fs.existsSync(npmGlobal)) extra.push(npmGlobal);

  return extra;
}

export function getProcessEnv(): NodeJS.ProcessEnv {
  const pathKey = 'Path';
  const extra = process.platform === 'win32' ? getWindowsExtraPaths() : [];
  const currentPath = process.env[pathKey] || '';
  const merged = [...extra, ...currentPath.split(path.delimiter).filter(Boolean)];

  return {
    ...process.env,
    [pathKey]: [...new Set(merged)].join(path.delimiter),
  };
}

function findExecutableInDir(dir: string, command: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command]
      : [command];

  for (const name of candidates) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

export function resolveCommand(command: string): string {
  if (process.platform !== 'win32') return command;

  const env = getProcessEnv();
  const dirs = (env.Path || '').split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    const found = findExecutableInDir(dir, command);
    if (found) return found;
  }

  if (command === 'mvn') {
    for (const bin of getChocolateyMavenBins()) {
      const found = findExecutableInDir(bin, 'mvn');
      if (found) return found;
    }
  }

  return command;
}

export function resolveCopilotSpawn(): { executable: string; prefixArgs: string[] } {
  const npmGlobal = path.join(process.env.APPDATA || '', 'npm');
  const bundledNode = path.join(npmGlobal, 'node.exe');
  const loader = path.join(npmGlobal, 'node_modules', '@github', 'copilot', 'npm-loader.js');

  if (fs.existsSync(loader)) {
    const nodeExecutable = fs.existsSync(bundledNode)
      ? bundledNode
      : resolveCommand('node');
    return { executable: nodeExecutable, prefixArgs: [loader] };
  }

  return { executable: resolveCommand('copilot'), prefixArgs: [] };
}

export async function isCopilotCliAvailable(): Promise<boolean> {
  const { spawn } = await import('child_process');
  const { executable, prefixArgs } = resolveCopilotSpawn();

  return new Promise((resolve) => {
    const child = spawn(executable, [...prefixArgs, '--version'], {
      env: getProcessEnv(),
      shell: false,
      windowsHide: true,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
