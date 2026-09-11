import {
  getJavaInstallHint,
  javaMajorMeetsTarget,
  parseJavaMajor,
  parseJavaMajorFromVersionOutput,
} from '../javaVersionUtils';
import { getAppConfig } from '../config/appConfig';
import { runCommand } from './commandRunner';
import { isCopilotCliAvailable } from './processEnv';

export interface HealthToolStatus {
  name: string;
  available: boolean;
  version: string;
  installHint: string;
  /** Hedef migration için gereksinim (ör. JDK 25+). */
  requirement?: string;
}

const BASE_TOOL_CHECKS: Array<{
  name: string;
  command: string;
  args: string[];
  installHint: string;
}> = [
  {
    name: 'Git',
    command: 'git',
    args: ['--version'],
    installHint: 'https://git-scm.com/download/win',
  },
  {
    name: 'Maven',
    command: 'mvn',
    args: ['-version'],
    installHint: 'choco install maven -y',
  },
  {
    name: 'GitHub CLI',
    command: 'gh',
    args: ['--version'],
    installHint: 'winget install GitHub.cli',
  },
];

async function checkTool(tool: (typeof BASE_TOOL_CHECKS)[number]): Promise<HealthToolStatus> {
  try {
    const result = await runCommand(tool.command, tool.args);
    const output = `${result.stdout}${result.stderr}`.trim();
    const available = result.exitCode === 0;
    const firstLine = output.split(/\r?\n/).find((l) => l.trim()) ?? '';

    return {
      name: tool.name,
      available,
      version: available ? firstLine : '',
      installHint: tool.installHint,
    };
  } catch {
    return {
      name: tool.name,
      available: false,
      version: '',
      installHint: tool.installHint,
    };
  }
}

async function checkJavaTool(targetJavaVersion: string): Promise<HealthToolStatus> {
  const targetMajor = parseJavaMajor(targetJavaVersion) ?? 21;
  const requirement = `Hedef: JDK ${targetMajor}+`;
  const installHint = getJavaInstallHint(targetJavaVersion);

  try {
    const result = await runCommand('java', ['-version']);
    const output = `${result.stdout}${result.stderr}`.trim();
    const firstLine = output.split(/\r?\n/).find((l) => l.trim()) ?? '';
    const commandOk = result.exitCode === 0 && firstLine.length > 0;

    if (!commandOk) {
      return {
        name: 'Java',
        available: false,
        version: 'Kurulu değil',
        installHint,
        requirement,
      };
    }

    const installedMajor = parseJavaMajorFromVersionOutput(output);
    const meetsTarget =
      installedMajor !== null && javaMajorMeetsTarget(installedMajor, targetMajor);

    const installedLabel =
      installedMajor !== null ? `Kurulu: JDK ${installedMajor}` : 'Kurulu: (sürüm okunamadı)';

    const version = meetsTarget
      ? `${installedLabel} — ${firstLine}`
      : installedMajor !== null
        ? `${installedLabel} — hedef JDK ${targetMajor}+ için yetersiz`
        : `${installedLabel} — hedef JDK ${targetMajor}+ doğrulanamadı`;

    return {
      name: 'Java',
      available: meetsTarget,
      version,
      installHint,
      requirement,
    };
  } catch {
    return {
      name: 'Java',
      available: false,
      version: 'Kurulu değil',
      installHint,
      requirement,
    };
  }
}

async function checkCopilotCli(): Promise<HealthToolStatus> {
  const available = await isCopilotCliAvailable();
  const model = getAppConfig().copilotModel || 'auto';
  return {
    name: 'Copilot CLI',
    available,
    version: available ? `model: ${model}` : '',
    installHint: 'npm install -g @github/copilot (Node.js 22+)',
    requirement: `Seçili model: ${model}`,
  };
}

export async function checkHealth(targetJavaVersion = '21'): Promise<HealthToolStatus[]> {
  const [git, maven, gh] = await Promise.all(BASE_TOOL_CHECKS.map(checkTool));
  const java = await checkJavaTool(targetJavaVersion);
  const copilot = await checkCopilotCli();
  return [git, java, maven, gh, copilot];
}

export async function assertHealth(targetJavaVersion = '21'): Promise<void> {
  const tools = await checkHealth(targetJavaVersion);
  const missing = tools.filter((t) => !t.available);
  if (missing.length === 0) return;

  const lines = missing.map((t) => {
    if (t.name === 'Java') {
      const req = t.requirement ?? `JDK ${targetJavaVersion}+`;
      return `  • ${t.name} — ${req}. ${t.version || t.installHint}`;
    }
    return `  • ${t.name} — ${t.installHint}`;
  });
  throw new Error(`Gerekli araçlar eksik:\n${lines.join('\n')}`);
}
