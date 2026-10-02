import path from 'path';
import type { SourceMode } from '../jobRunner';

/**
 * Derive the short repository name used in Jira "Code Repo Name" filters.
 * Remote: last path segment of the Git URL (strip .git).
 * Local: directory basename.
 */
export function deriveRepoName(input: {
  sourceMode?: SourceMode;
  repoUrl?: string;
  localRepoPath?: string;
}): string {
  const sourceMode: SourceMode = input.sourceMode === 'local' ? 'local' : 'remote';

  if (sourceMode === 'local') {
    const localPath = (input.localRepoPath || '').trim().replace(/[/\\]+$/, '');
    if (!localPath) {
      throw new Error('Yerel repo yolu gerekli.');
    }
    return path.basename(localPath);
  }

  const repoUrl = (input.repoUrl || '').trim().replace(/\/+$/, '');
  if (!repoUrl) {
    throw new Error('Git Repository URL gerekli.');
  }

  let pathname = repoUrl;
  try {
    const parsed = new URL(repoUrl);
    pathname = parsed.pathname;
  } catch {
    // SSH / scp-style: git@host:org/repo.git
    const sshMatch = repoUrl.match(/[:/]([^:/]+?)(?:\.git)?$/);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }
  }

  const segment = pathname.split('/').filter(Boolean).pop() || '';
  return segment.replace(/\.git$/i, '') || segment;
}
