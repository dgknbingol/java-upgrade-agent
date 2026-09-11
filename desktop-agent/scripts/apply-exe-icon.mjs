import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const rcedit = require('rcedit');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const iconIco = path.join(root, 'build', 'icon.ico');
const productName = 'Paytion Java Upgrade Desktop Agent';

if (!fs.existsSync(iconIco)) {
  console.error(`ICO bulunamadı: ${iconIco} — önce "npm run prepare:icons" çalıştırın.`);
  process.exit(1);
}

// Sadece unpacked Electron exe — NSIS installer/portable üzerinde rcedit dosyayı bozar.
const unpackedExe = path.join(releaseDir, 'win-unpacked', `${productName}.exe`);

if (!fs.existsSync(unpackedExe)) {
  console.warn('win-unpacked exe bulunamadı — ikon atlandı.');
  process.exit(0);
}

await rcedit(unpackedExe, {
  icon: iconIco,
  'version-string': {
    FileDescription: productName,
    ProductName: productName,
    InternalFilename: productName,
    OriginalFilename: `${productName}.exe`,
  },
});
fs.utimesSync(unpackedExe, new Date(), new Date());
console.log(`Exe ikonu güncellendi: ${path.relative(root, unpackedExe)}`);

if (process.platform === 'win32') {
  try {
    const ie4uinit = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'ie4uinit.exe');
    if (fs.existsSync(ie4uinit)) {
      execSync(`"${ie4uinit}" -show`, { stdio: 'ignore' });
    }
    execSync(
      'powershell -NoProfile -Command "Add-Type -Namespace Win32 -Name Shell -MemberDefinition \'[DllImport(\\\"shell32.dll\\\")] public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);\'; [Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)"',
      { stdio: 'ignore', shell: true },
    );
  } catch {
    // optional
  }
}
