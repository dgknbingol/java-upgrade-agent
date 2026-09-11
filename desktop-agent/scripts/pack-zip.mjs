import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'release', 'win-unpacked');
const zipPath = path.join(root, 'release', 'Paytion-Java-Upgrade-Agent-win-x64.zip');

if (!fs.existsSync(sourceDir)) {
  console.error('release/win-unpacked bulunamadı. Önce: npm run dist:dir');
  process.exit(1);
}

const exeName = 'Paytion Java Upgrade Desktop Agent.exe';
if (!fs.existsSync(path.join(sourceDir, exeName))) {
  console.error(`${exeName} bulunamadı — eksik build.`);
  process.exit(1);
}

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -LiteralPath '${sourceDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit', shell: true },
  );
} else {
  execSync(`zip -r "${zipPath}" "${path.basename(sourceDir)}"`, {
    cwd: path.join(root, 'release'),
    stdio: 'inherit',
  });
}

const mb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(1);
console.log(`\nDağıtım zip hazır (${mb} MB):`);
console.log(zipPath);
console.log('\nKullanım: zip açıldığında win-unpacked klasörünün TAMAMINI kullanın; sadece .exe yetmez.');
