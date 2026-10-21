'use strict';
// Ne: Calibre'yi programın içine gömmek için hazırlayan betik (Dosya Dönüştürücü'ye gömülü e-kitap paketinin üreticisi).
// Sahibi: Dosya dönüştürücü işi.
// Değiştirme kuralı: değişiklik implementer -> verifier sırasıyla yapılır; silme yalnız Yusuf'un kararıyla,
// çöp kutusuna taşıyarak olur.
// Calibre'yi (yalnız ebook-convert için) programın içine gömer.
// Kullanım: node scripts/calibre-hazirla.js <calibre-64bit-X.msi>   (ya da CALIBRE_MSI ortam değişkeni)
// 1) MSI'nın boyutu ve SHA-256'sı scripts/calibre-surum.json içindeki sabit değerlerle aynı olmalı.
// 2) Authenticode imzası geçerli ve imzacı "Kovid Goyal" olmalı (Linux: osslsigncode, Windows: PowerShell).
//    Ağı kısıtlı ortamlar için isteğe bağlı CALIBRE_CRL ve CALIBRE_TSA_CRL (yerel CRL dosya yolu) osslsigncode'a
//    -CRLfile / -TSA-CRLfile olarak geçilir; denetimi atlatan bir bayrak yoktur.
// 3) MSI vendor altındaki geçici bir klasöre açılır (Linux: msiextract, Windows: msiexec /a). Açılan paketteki
//    Calibre2 klasörünün İÇERİĞİ doğrudan vendor/calibre/ altına gelir (ebook-convert.exe, app/, LICENSE ...).
// 4) Paketteki tüm .exe/.dll/.pyd dosyalarının PE Machine değeri 0x8664 (x64) olmalıdır, değilse hata verilir.
//    LICENSE (GPL-3.0) dosyası pakette bulunmalıdır; yoksa hata verilir.
// 5) Doğrulamalar bittikten sonra klasör yerinde yeniden adlandırılarak vendor/calibre yapılır ve GOMULU-SURUM.txt yazılır.
//    Herhangi bir doğrulama başarısızsa vendor/calibre oluşturulmaz.
// "Zaten hazır" dalı: vendor/calibre/ebook-convert.exe varsa GOMULU-SURUM.txt sabit değerle karşılaştırılır.
// Lisans: Calibre GPL-3.0; ayrı program olarak çağrılır. Kaynak: https://github.com/kovidgoyal/calibre
// Modül require edilirse main() çalışmaz; yalnız yardımcı fonksiyonlar dışa aktarılır (test/calibre-hazirla.test.js).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { imzaciDogruMu, peMakine } = require('./libreoffice-hazirla');

const KOK = path.join(__dirname, '..');
const VENDOR = path.join(KOK, 'vendor');
const HEDEF = path.join(VENDOR, 'calibre');
const MAKINE_X64 = 0x8664;
const PE_UZANTILARI = Object.freeze(['.exe', '.dll', '.pyd']);

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

const surumOku = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'calibre-surum.json'), 'utf8'));

// Ortam değişkenlerinden osslsigncode CRL bağımsız değişkenlerini üretir (atlama bayrağı yoktur).
function crlArgumanlari(env = process.env) {
  const a = [];
  if (env.CALIBRE_CRL) a.push('-CRLfile', env.CALIBRE_CRL);
  if (env.CALIBRE_TSA_CRL) a.push('-TSA-CRLfile', env.CALIBRE_TSA_CRL);
  return a;
}

// GOMULU-SURUM.txt metnini sürüm kaydıyla karşılaştırır: "MSI SHA-256: <64 hex>" ve "Sürüm: Calibre X" satırları.
function kayitDogrula(metin, surum) {
  const m = String(metin || '');
  const sh = m.match(/^[ \t]*(?:MSI[ \t]+)?SHA-256:[ \t]*([0-9A-Fa-f]{64})(?![0-9A-Za-z])/m);
  if (!sh) return { tamam: false, neden: 'kayıtta geçerli (64 hex) SHA-256 satırı yok' };
  const sv = m.match(/^[ \t]*(?:Sürüm:[ \t]*)?Calibre[ \t]+([0-9][0-9A-Za-z.\-]*)/m);
  if (!sv) return { tamam: false, neden: 'kayıtta sürüm satırı yok' };
  if (sh[1].toLowerCase() !== String(surum.sha256).toLowerCase()) return { tamam: false, neden: `kayıttaki SHA-256 (${sh[1]}) sabit değerle uyuşmuyor` };
  if (sv[1] !== String(surum.surum)) return { tamam: false, neden: `kayıttaki sürüm (${sv[1]}) beklenen ${surum.surum} değil` };
  return { tamam: true, neden: '' };
}

// MSI dosyasının boyutunu ve SHA-256'sını sürüm kaydıyla karşılaştırır. Dönüş: { tamam, neden }
function msiKimligiDogrula(boyut, ozet, surum) {
  if (Number(boyut) !== Number(surum.boyut)) return { tamam: false, neden: `boyut uyuşmuyor. Beklenen ${surum.boyut}, bulunan ${boyut}` };
  if (String(ozet).toLowerCase() !== String(surum.sha256).toLowerCase()) return { tamam: false, neden: `SHA-256 uyuşmuyor. Beklenen ${surum.sha256}, bulunan ${ozet}` };
  return { tamam: true, neden: '' };
}

function imzaDogrula(msi, beklenen) {
  if (process.platform === 'win32') {
    const betik = '$s = Get-AuthenticodeSignature -LiteralPath $args[0]; "$($s.Status)|$($s.SignerCertificate.Subject)"';
    const r = calistir('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', betik, msi]);
    const cikti = String(r.stdout).trim();
    const ayrac = cikti.indexOf('|');
    const durum = ayrac < 0 ? cikti : cikti.slice(0, ayrac);
    const konu = ayrac < 0 ? '' : cikti.slice(ayrac + 1);
    if (durum !== 'Valid' || !imzaciDogruMu(konu, beklenen)) hata(`imza geçersiz (${durum}, ${konu})`);
    return konu;
  }
  const crl = crlArgumanlari();
  for (let i = 1; i < crl.length; i += 2) if (!fs.existsSync(crl[i])) hata(`CRL dosyası yok: ${crl[i]}`);
  const r = calistir('osslsigncode', ['verify', ...crl, '-in', msi]);
  const cikti = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || !/Signature verification: ok/i.test(cikti)) hata('imza doğrulanamadı (osslsigncode)');
  const konu = (cikti.match(/Signer's certificate:[\s\S]*?Subject:\s*(.+)/) || [])[1] || '';
  if (!imzaciDogruMu(konu, beklenen)) hata(`imzacı beklenen değil: ${konu}`);
  return konu.trim();
}

// kok altında ebook-convert.exe içeren ilk klasörü bulur (genişlik öncelikli); yoksa null.
function ebookConvertKlasoruBul(kok) {
  const kuyruk = [kok];
  while (kuyruk.length) {
    const d = kuyruk.shift();
    let girdiler;
    try { girdiler = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    if (girdiler.some((g) => g.isFile() && g.name.toLowerCase() === 'ebook-convert.exe')) return d;
    for (const g of girdiler) if (g.isDirectory()) kuyruk.push(path.join(d, g.name));
  }
  return null;
}

// klasör altındaki tüm .exe/.dll/.pyd dosyalarının x64 PE olduğunu denetler; bağlar (symlink) sorun sayılır.
// Dönüş: { sayi: denetlenen PE sayısı, sorunlar: [açıklamalar] }
function peTara(klasor) {
  const sorunlar = []; let sayi = 0;
  const yigin = [klasor];
  while (yigin.length) {
    const d = yigin.pop();
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (g.isSymbolicLink()) { sorunlar.push(`${path.relative(klasor, y)}: sembolik bağ, reddedildi`); continue; }
      if (g.isDirectory()) { yigin.push(y); continue; }
      if (!g.isFile() || !PE_UZANTILARI.includes(path.extname(g.name).toLowerCase())) continue;
      sayi += 1;
      try {
        const m = peMakine(y);
        if (m !== MAKINE_X64) sorunlar.push(`${path.relative(klasor, y)}: Machine 0x${m.toString(16).toUpperCase()} (beklenen 0x8664)`);
      } catch (e) { sorunlar.push(`${path.relative(klasor, y)}: ${e.message}`); }
    }
  }
  return { sayi, sorunlar };
}

function surumMetni(surum, konu) {
  return `Ne: Dosya Dönüştürücü'ye gömülü Calibre paketinin kimlik kartı. Sahibi: Dosya dönüştürücü işi. ` +
    `Değiştirme kuralı: yalnız scripts/calibre-hazirla.js ya da aynı adımlarla yeni resmi sürüm hazırlanırken yeniden yazılır; ` +
    `silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak olur.\n` +
    `Sürüm: Calibre ${surum.surum} (dosyaları değiştirilmemiş; yalnız ebook-convert.exe çağrılır)\n` +
    `Kaynak: ${surum.kaynak}\n` +
    `MSI SHA-256: ${surum.sha256}\n` +
    `MSI boyutu: ${surum.boyut} bayt\n` +
    `İmzacı konusu: ${konu}\n` +
    `Yerleşim: MSI içindeki Calibre2 klasörünün içeriği olduğu gibi bu klasöre konur; tüm .exe/.dll/.pyd dosyaları x64 (0x8664) olarak denetlendi.\n` +
    `Lisans: Calibre GPL-3.0 (LICENSE dosyası bu klasörde); ayrı program olarak çağrılır, değiştirilmemiştir.\n` +
    `Kaynak kod: https://github.com/kovidgoyal/calibre\n`;
}

// Açılmış paketi doğrular ve vendor/calibre olarak yerleştirir. Hata olursa Error fırlatır, HEDEF'e dokunmaz.
// acilanKok: msiextract / msiexec çıktısının bulunduğu klasör (HEDEF ile aynı dosya sisteminde olmalı: yeniden adlandırılır).
function paketiYerlestir(acilanKok, hedef, surum, konu) {
  const kaynak = ebookConvertKlasoruBul(acilanKok);
  if (!kaynak) throw new Error('Açılan pakette ebook-convert.exe bulunamadı.');
  if (!fs.existsSync(path.join(kaynak, 'app'))) throw new Error('Açılan pakette app/ klasörü yok.');
  if (!fs.existsSync(path.join(kaynak, 'LICENSE'))) throw new Error('Açılan pakette LICENSE (GPL-3.0) dosyası yok.');
  const tara = peTara(kaynak);
  if (tara.sorunlar.length) throw new Error(`PE mimarisi x64 değil ya da dosya geçersiz (${tara.sorunlar.length}): ${tara.sorunlar.slice(0, 5).join('; ')}`);
  if (tara.sayi === 0) throw new Error('Pakette hiç PE dosyası bulunamadı.');
  if (fs.existsSync(hedef)) throw new Error(`Hedef zaten var, üzerine yazılmaz: ${hedef}`);
  fs.writeFileSync(path.join(kaynak, 'GOMULU-SURUM.txt'), surumMetni(surum, konu), { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(kaynak, hedef);
  return tara.sayi;
}

// MSI'yı vendor altındaki geçici bir klasöre açıp paketiYerlestir ile yerleştirir.
async function hazirla(msi, surum, konu) {
  await fsp.mkdir(VENDOR, { recursive: true });
  const gecici = await fsp.mkdtemp(path.join(VENDOR, '.calibre-ac-'));
  try {
    if (process.platform === 'win32') {
      const r = calistir('msiexec.exe', ['/a', path.resolve(msi), '/qn', `TARGETDIR=${gecici}`]);
      if (r.status !== 0) hata(`msiexec /a başarısız (${r.status})`);
    } else {
      const r = calistir('msiextract', ['-C', gecici, path.resolve(msi)]);
      if (r.status !== 0) hata(`msiextract başarısız: ${r.stderr}`);
    }
    return paketiYerlestir(gecici, HEDEF, surum, konu);
  } finally {
    await fsp.rm(gecici, { recursive: true, force: true });
  }
}

async function main() {
  const SURUM = surumOku();
  const msi = process.argv[2] || process.env.CALIBRE_MSI;
  if (fs.existsSync(path.join(HEDEF, 'ebook-convert.exe'))) {
    const kayitYolu = path.join(HEDEF, 'GOMULU-SURUM.txt');
    const yonerge = 'vendor/calibre farklı sürümde ya da doğrulanamıyor; elle, Yusuf\'un kararıyla çöp kutusuna taşınmalı (silinmemeli).';
    if (!fs.existsSync(kayitYolu)) hata(`GOMULU-SURUM.txt yok. ${yonerge}`);
    const k = kayitDogrula(fs.readFileSync(kayitYolu, 'utf8'), SURUM);
    if (!k.tamam) hata(`${k.neden}. ${yonerge}`);
    if (msi) {
      if (!fs.existsSync(msi)) hata('MSI dosyası yok.');
      const d = msiKimligiDogrula(fs.statSync(msi).size, await sha256(msi), SURUM);
      if (!d.tamam) hata(`MSI ${d.neden}`);
    }
    const tara = peTara(HEDEF);
    if (tara.sorunlar.length) hata(`PE dosyaları x64 değil ya da geçersiz: ${tara.sorunlar.slice(0, 5).join('; ')}. ${yonerge}`);
    if (!fs.existsSync(path.join(HEDEF, 'LICENSE'))) hata(`LICENSE dosyası yok. ${yonerge}`);
    console.log('Calibre zaten hazır ve sürüm kaydı eşleşiyor: ' + HEDEF);
    return;
  }
  if (!msi || !fs.existsSync(msi)) hata('MSI dosyası verilmedi ya da yok.');
  const d = msiKimligiDogrula(fs.statSync(msi).size, await sha256(msi), SURUM);
  if (!d.tamam) hata(`MSI ${d.neden}`);
  const konu = imzaDogrula(msi, SURUM.imzalayan);
  console.log(`Doğrulandı: Calibre ${SURUM.surum}, boyut ve SHA-256 eşleşti, imzacı: ${konu}`);
  try {
    const sayi = await hazirla(msi, SURUM, konu);
    console.log(`Calibre hazırlandı: ${HEDEF} (${sayi} PE dosyası x64)`);
  } catch (e) { hata(e.message); }
}

if (require.main === module) main().catch((e) => hata(e.message));

module.exports = { crlArgumanlari, kayitDogrula, msiKimligiDogrula, ebookConvertKlasoruBul, peTara, surumMetni, paketiYerlestir, hazirla, sha256, surumOku, HEDEF, VENDOR };
