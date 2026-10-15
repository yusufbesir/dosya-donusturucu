'use strict';
// LibreOffice'i programın içine gömmek için hazırlar.
// Kullanım: node scripts/libreoffice-hazirla.js <LibreOffice_..._Win_x86-64.msi>
// 1) Dosyanın SHA-256'sı scripts/libreoffice-surum.json içindeki sabit değerle aynı olmalı.
// 2) Authenticode imzası "The Document Foundation" adına geçerli olmalı.
// 3) MSI vendor/libreoffice altına açılır (Linux: msiextract, Windows: msiexec /a).
// Herhangi bir doğrulama başarısızsa hiçbir şey yazılmadan durur.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const HEDEF = path.join(KOK, 'vendor', 'libreoffice');
const SURUM = JSON.parse(fs.readFileSync(path.join(__dirname, 'libreoffice-surum.json'), 'utf8'));
const IMZACI = 'The Document Foundation';

function hata(m) { console.error('HATA: ' + m); process.exit(1); }

function calistir(komut, args) {
  const r = spawnSync(komut, args, { shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) hata(`${komut} çalıştırılamadı: ${r.error.message}`);
  return r;
}

function sha256(dosya) {
  return new Promise((coz, red) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(dosya).on('data', (p) => h.update(p)).on('end', () => coz(h.digest('hex'))).on('error', red);
  });
}

function imzaDogrula(msi) {
  if (process.platform === 'win32') {
    const betik = '$s = Get-AuthenticodeSignature -LiteralPath $args[0]; "$($s.Status)|$($s.SignerCertificate.Subject)"';
    const r = calistir('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', betik, msi]);
    const [durum, konu] = String(r.stdout).trim().split('|');
    if (durum !== 'Valid' || !konu.includes(`O=${IMZACI}`)) hata(`imza geçersiz (${durum}, ${konu})`);
    return konu;
  }
  const r = calistir('osslsigncode', ['verify', '-in', msi]);
  const cikti = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || !/Signature verification: ok/i.test(cikti)) hata('imza doğrulanamadı (osslsigncode)');
  const konu = (cikti.match(/Signer's certificate:[\s\S]*?Subject:\s*(.+)/) || [])[1] || '';
  if (!konu.includes(IMZACI)) hata(`imzacı beklenen değil: ${konu}`);
  return konu.trim();
}

function sofficeKlasoruBul(kok) {
  const yigin = [kok];
  while (yigin.length) {
    const d = yigin.pop();
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (!g.isDirectory()) continue;
      if (g.name.toLowerCase() === 'program' && fs.existsSync(path.join(y, 'soffice.exe'))) return d;
      yigin.push(y);
    }
  }
  return null;
}

async function main() {
  const msi = process.argv[2] || process.env.LIBREOFFICE_MSI;
  if (!msi || !fs.existsSync(msi)) hata('MSI dosyası verilmedi ya da yok.');
  if (fs.existsSync(path.join(HEDEF, 'program', 'soffice.exe'))) {
    console.log('LibreOffice zaten hazır: ' + HEDEF);
    return;
  }
  const ozet = await sha256(msi);
  if (ozet !== SURUM.sha256) hata(`SHA-256 uyuşmuyor. Beklenen ${SURUM.sha256}, bulunan ${ozet}`);
  const konu = imzaDogrula(msi);
  console.log(`Doğrulandı: LibreOffice ${SURUM.surum}, SHA-256 eşleşti, imzacı: ${konu}`);

  const gecici = await fsp.mkdtemp(path.join(os.tmpdir(), 'lo-ac-'));
  try {
    if (process.platform === 'win32') {
      const r = calistir('msiexec.exe', ['/a', path.resolve(msi), '/qn', `TARGETDIR=${gecici}`]);
      if (r.status !== 0) hata(`msiexec /a başarısız (${r.status})`);
    } else {
      const r = calistir('msiextract', ['-C', gecici, path.resolve(msi)]);
      if (r.status !== 0) hata(`msiextract başarısız: ${r.stderr}`);
    }
    const kaynak = sofficeKlasoruBul(gecici);
    if (!kaynak) hata('Açılan pakette program/soffice.exe bulunamadı.');
    await fsp.mkdir(path.dirname(HEDEF), { recursive: true });
    await fsp.cp(kaynak, HEDEF, { recursive: true, errorOnExist: true, force: false });
    await fsp.writeFile(path.join(HEDEF, 'GOMULU-SURUM.txt'),
      `LibreOffice ${SURUM.surum} (değiştirilmemiş)\nKaynak: ${SURUM.kaynak}\nSHA-256: ${SURUM.sha256}\n` +
      `Lisans: MPL-2.0 (ayrıntı: program içindeki LICENSE.html / license.txt)\nKaynak kod: https://www.libreoffice.org/about-us/source-code/\n`, 'utf8');
    console.log('LibreOffice hazırlandı: ' + HEDEF);
  } finally {
    await fsp.rm(gecici, { recursive: true, force: true });
  }
}

main().catch((e) => hata(e.message));
