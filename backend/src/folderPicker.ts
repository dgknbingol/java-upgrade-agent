import { spawn } from 'child_process';
import { platform } from 'os';

export async function pickFolder(title = 'Klasör seçin'): Promise<string | null> {
  if (platform() !== 'win32') {
    throw new Error('Klasör seçici şu an yalnızca Windows üzerinde desteklenir.');
  }

  const safeTitle = title.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$dialog.Description = '${safeTitle}'`,
    '$dialog.ShowNewFolderButton = $true',
    '$result = $dialog.ShowDialog()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('; ');

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { windowsHide: false }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0 && stderr.trim()) {
        reject(new Error(stderr.trim()));
        return;
      }

      const selected = stdout.trim();
      resolve(selected || null);
    });
  });
}
