import { getProcessEnv, resolveCommand } from './processEnv';
import { spawnCommand } from './spawnUtil';

export interface PrerequisiteStatus {
  name: string;
  available: boolean;
  installHint: string;
}

const TOOLS: Omit<PrerequisiteStatus, 'available'>[] = [
  {
    name: 'git',
    installHint: 'https://git-scm.com/download/win',
  },
  {
    name: 'mvn',
    installHint: 'choco install maven -y (yönetici PowerShell)',
  },
  {
    name: 'copilot',
    installHint: 'npm install -g @github/copilot (Node.js 22+ gerekir)',
  },
  {
    name: 'java',
    installHint: 'winget install EclipseAdoptium.Temurin.21.JDK',
  },
];

const VERSION_ARGS: Record<string, string[]> = {
  git: ['--version'],
  mvn: ['-version'],
  java: ['-version'],
  copilot: ['--version'],
};

function checkCommand(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    const args = VERSION_ARGS[command] ?? ['--version'];
    const executable = resolveCommand(command);
    const child = spawnCommand(executable, args, {
      env,
      windowsHide: true,
    });

    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export async function checkPrerequisites(): Promise<PrerequisiteStatus[]> {
  const env = getProcessEnv();

  return Promise.all(
    TOOLS.map(async (tool) => ({
      ...tool,
      available: await checkCommand(tool.name, env),
    }))
  );
}

export async function assertPrerequisites(): Promise<void> {
  const status = await checkPrerequisites();
  const missing = status.filter((item) => !item.available);

  if (missing.length === 0) return;

  const lines = missing.map(
    (item) => `  • ${item.name} — ${item.installHint}`
  );

  throw new Error(
    `Gerekli araçlar bulunamadı:\n${lines.join('\n')}\n\nCMD'de çalışıyorsa Cursor'u tamamen kapatıp yeniden açın veya backend'i CMD terminalinden başlatın.`
  );
}
