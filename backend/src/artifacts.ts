import fs from 'fs';
import path from 'path';
import { spawnCommand } from './spawnUtil';
import { getProcessEnv, resolveCommand } from './processEnv';
import { Job } from './types';

function readProcessOutput(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(resolveCommand(command), args, {
      cwd,
      env: getProcessEnv(),
    });
    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('error', reject);
    child.on('close', () => resolve(output));
  });
}

async function collectDiff(job: Job): Promise<string> {
  const cwd = job.workspacePath;
  const attempts = [
    ['diff', `${job.sourceBranch}...HEAD`],
    ['diff', `${job.sourceBranch}..HEAD`],
    ['diff'],
    ['diff', '--cached'],
  ];

  for (const args of attempts) {
    const output = await readProcessOutput('git', args, cwd);
    if (output.trim().length > 0) {
      return output;
    }
  }

  return '';
}

async function listChangedFiles(job: Job): Promise<string> {
  const output = await readProcessOutput(
    'git',
    ['diff', '--name-only', `${job.sourceBranch}...HEAD`],
    job.workspacePath
  );
  return output.trim();
}

function buildFallbackReport(job: Job, changedFiles: string): string {
  const filesSection =
    changedFiles.length > 0
      ? changedFiles
          .split(/\r?\n/)
          .map((file) => `- ${file}`)
          .join('\n')
      : '- (Kaynak branch ile dosya farkı yok)';

  const diffSection =
    job.diff.trim().length > 0
      ? 'Detaylar Git Diff panelinde gösterilir.'
      : 'Git diff boş — commit edilmemiş veya branch arası dosya değişikliği yok.';

  return `# Migration Report

## Source Java version
${job.sourceJavaVersion || 'bilinmiyor'}

## Target Java version
${job.targetJavaVersion}

## Source branch
${job.sourceBranch}

## Upgrade branch
${job.upgradeBranch}

## Job status
${job.status}

## Changed files
${filesSection}

## Git diff
${diffSection}

## Notlar
- Copilot CLI migration prompt ile çalıştırıldı (-p tam prompt, --allow-all-tools --no-ask-user --autopilot).
- Copilot MIGRATION_REPORT.md oluşturmadıysa bu rapor uygulama tarafından otomatik üretilmiştir.
- Diff boşsa: repo zaten hedef Java sürümünde olabilir (ör. spring-petclinic-ai-java-upgrade zaten Java 21) veya Copilot dosya düzenlememiş olabilir.
- Java 17→21 testi için kaynak branch'in gerçekten Java 17 olduğu bir repo deneyin.
${job.error ? `\n## Hata\n${job.error}` : ''}
`;
}

export async function saveArtifacts(job: Job): Promise<void> {
  job.diff = await collectDiff(job);

  const reportPath = path.join(job.workspacePath, 'MIGRATION_REPORT.md');
  if (fs.existsSync(reportPath)) {
    job.report = fs.readFileSync(reportPath, 'utf-8');
    return;
  }

  const changedFiles = await listChangedFiles(job);
  const report = buildFallbackReport(job, changedFiles);
  fs.writeFileSync(reportPath, report, 'utf-8');
  job.report = report;
}
