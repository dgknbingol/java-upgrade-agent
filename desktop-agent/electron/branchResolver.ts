import { getAppConfig } from './config/appConfig';
import { branchExists } from './services/gitService';

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function buildUpgradeBranchBase(version: string): string {
  const config = getAppConfig();
  return config.renderTemplate(config.upgradeBranchPattern, { version });
}

export function validateBranchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Upgrade branch adı boş olamaz.');
  }

  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('//')) {
    throw new Error('Geçersiz branch adı.');
  }

  if (!BRANCH_NAME_PATTERN.test(trimmed)) {
    throw new Error(
      'Branch adı yalnızca harf, rakam, nokta, tire, alt çizgi ve slash içerebilir.'
    );
  }

  return trimmed;
}

export async function resolveWorkBranchName(
  cwd: string,
  version: string,
  customBranch?: string
): Promise<string> {
  if (customBranch?.trim()) {
    return validateBranchName(customBranch);
  }
  return resolveAvailableUpgradeBranch(cwd, version);
}

export async function resolveAvailableUpgradeBranch(
  cwd: string,
  version: string,
  customBranch?: string
): Promise<string> {
  const base = customBranch?.trim()
    ? validateBranchName(customBranch)
    : buildUpgradeBranchBase(version);

  const candidates = [base];
  for (let suffix = 2; suffix <= 999; suffix++) {
    candidates.push(`${base}-${suffix}`);
  }

  for (const name of candidates) {
    if (!(await branchExists(cwd, name))) {
      return name;
    }
  }

  throw new Error('Kullanılabilir upgrade branch adı bulunamadı');
}
