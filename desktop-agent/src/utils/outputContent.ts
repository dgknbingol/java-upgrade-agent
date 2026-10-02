import { formatDiffSummaryText } from './diffParser';

export type OutputTabId = 'logs' | 'mend' | 'fortify' | 'report' | 'summary' | 'diff';

export interface OutputTabContent {
  content: string;
  defaultFilename: string;
  saveTitle: string;
  isEmpty: boolean;
}

function isPlaceholderDiff(diff: string): boolean {
  const trimmed = diff.trim();
  return (
    !trimmed ||
    trimmed.startsWith('Kaynak branch') ||
    trimmed.startsWith('Henüz')
  );
}

export function getOutputTabContent(
  tab: OutputTabId,
  data: {
    logs: string[];
    report: string;
    diff: string;
    mendFindings: string;
    fortifyFindings: string;
  }
): OutputTabContent {
  switch (tab) {
    case 'logs': {
      const content = data.logs.join('\n');
      return {
        content,
        defaultFilename: 'upgrade-logs.log',
        saveTitle: 'Log dosyasını kaydet',
        isEmpty: !content.trim(),
      };
    }
    case 'mend': {
      const content = data.mendFindings.trim();
      return {
        content,
        defaultFilename: '.java-upgrade/MEND_FINDINGS.md',
        saveTitle: 'Mend bulgularını kaydet',
        isEmpty: !content,
      };
    }
    case 'fortify': {
      const content = data.fortifyFindings.trim();
      return {
        content,
        defaultFilename: '.java-upgrade/FORTIFY_FINDINGS.md',
        saveTitle: 'Fortify bulgularını kaydet',
        isEmpty: !content,
      };
    }
    case 'report': {
      const content = data.report.trim();
      return {
        content,
        defaultFilename: '.java-upgrade/MIGRATION_REPORT.md',
        saveTitle: 'Migration report kaydet',
        isEmpty: !content,
      };
    }
    case 'summary': {
      const content = formatDiffSummaryText(data.diff);
      return {
        content,
        defaultFilename: 'diff-summary.txt',
        saveTitle: 'Diff özeti kaydet',
        isEmpty: !content.trim(),
      };
    }
    case 'diff': {
      const content = data.diff.trim();
      return {
        content,
        defaultFilename: 'upgrade.diff',
        saveTitle: 'Raw diff kaydet',
        isEmpty: isPlaceholderDiff(data.diff),
      };
    }
  }
}
