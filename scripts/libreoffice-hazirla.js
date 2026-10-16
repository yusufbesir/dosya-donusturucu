'use strict';
// Ne: LibreOffice'i programın içine gömmek için hazırlayan betik (Dosya Dönüştürücü'ye gömülü paketin üreticisi).
// Sahibi: Yusuf Beşir (dosya-donusturucu projesi).
// Değiştirme kuralları: değişiklik implementer -> verifier sırasıyla yapılır; silme yalnız Yusuf'un kararıyla,
// çöp kutusuna taşıyarak olur.
// LibreOffice'i programın içine gömmek için hazırlar.
// Kullanım: node scripts/libreoffice-hazirla.js <LibreOffice_..._Win_x86-64.msi>
// 1) Dosyanın SHA-256'sı scripts/libreoffice-surum.json içindeki sabit değerle aynı olmalı.
// 2) Authenticode imzası "The Document Foundation" adına geçerli olmalı.
// 3) MSI vendor/libreoffice altına açılır (Linux: msiextract, Windows: msiexec /a).
// 4) Paketteki System64 klasöründen VC++ DLL'leri program/ altına, Fonts klasöründen yazı tipleri
//    share/fonts/truetype/ altına eklenir (System/ 32 bit klasörü kullanılmaz; sistem klasörlerine hiçbir şey yazılmaz).
// Linux'ta imza denetimi osslsigncode ile yapılır ("Signature verification: ok" şart). Ağı kısıtlı ortamlar için
// isteğe bağlı LIBREOFFICE_CRL ve LIBREOFFICE_TSA_CRL (yerel CRL dosya yolu) osslsigncode'a -CRLfile / -TSA-CRLfile olarak geçilir.
// 5) Geçici kopyada (vendor'a yazmadan önce) Python betik bileşenleri (pyuno, Python çalışma zamanı, LibreLogo) çıkarılır:
//    Windows'ta Writer belgesi yüklenirken Python yükleyicisi başka iş parçacığında başlayıp locale kilidinde
//    Writer dönüşümlerini sonsuza kadar kilitliyor (2026-10-16, gerçek kurulumda görüldü); makrolar zaten kapalı.
//    Liste PYTHON_BILESENLERI'dir; yalnız betiğin kendi geçici klasöründen kaldırılır.
// Herhangi bir doğrulama başarısızsa hiçbir şey yazılmadan durur.
// Modül require edilirse main() çalışmaz; yalnız yardımcı fonksiyonlar dışa aktarılır (test/libreoffice-hazirla.test.js).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const HEDEF = path.join(KOK, 'vendor', 'libreoffice');
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

const surumOku = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'libreoffice-surum.json'), 'utf8'));

// Ortam değişkenlerinden osslsigncode CRL bağımsız değişkenlerini üretir (atlama bayrağı yoktur).
function crlArgumanlari(env = process.env) {
  const a = [];
  if (env.LIBREOFFICE_CRL) a.push('-CRLfile', env.LIBREOFFICE_CRL);
  if (env.LIBREOFFICE_TSA_CRL) a.push('-TSA-CRLfile', env.LIBREOFFICE_TSA_CRL);
  return a;
}

// Sertifika konusunu (Windows "CN=a, O=b" ya da OpenSSL "/C=DE/O=b/CN=a") alan -> değer listesi olarak ayrıştırır.
// Tırnaklı değerleri ve ters bölü kaçışlarını tanır; anahtarlar büyük harfe çevrilir.
function konuAyristir(konu) {
  const metin = String(konu || '').trim();
  const parcalar = [];
  if (metin.startsWith('/')) {
    parcalar.push(...metin.split(/\/(?=[A-Za-z][A-Za-z0-9.]*=)/).filter(Boolean));
  } else {
    let su = ''; let tirnak = false;
    for (let i = 0; i < metin.length; i++) {
      const c = metin[i];
      if (c === '\\' && i + 1 < metin.length) { su += c + metin[++i]; continue; }
      if (c === '"') { tirnak = !tirnak; su += c; continue; }
      if (c === ',' && !tirnak) { parcalar.push(su); su = ''; continue; }
      su += c;
    }
    parcalar.push(su);
  }
  const alanlar = {};
  for (const p of parcalar) {
    const e = p.indexOf('=');
    if (e < 1) continue;
    const anahtar = p.slice(0, e).trim().toUpperCase();
    let deger = p.slice(e + 1).trim();
    if (deger.length >= 2 && deger.startsWith('"') && deger.endsWith('"')) deger = deger.slice(1, -1);
    deger = deger.replace(/\\(.)/g, '$1').trim();
    (alanlar[anahtar] = alanlar[anahtar] || []).push(deger);
  }
  return alanlar;
}

// O ve CN alanlarının tamamı tam olarak beklenen imzacı olmalı (alt dize eşleşmesi yok).
function imzaciDogruMu(konu, beklenen = IMZACI) {
  const a = konuAyristir(konu);
  const tam = (l) => Array.isArray(l) && l.length > 0 && l.every((v) => v === beklenen);
  return tam(a.O) && tam(a.CN);
}

// GOMULU-SURUM.txt metnini sürüm kaydıyla karşılaştırır. Hem "SHA-256: <hex>" hem "MSI SHA-256: <hex>" biçimini,
// hex'in ardındaki parantezli ek metni ve "Sürüm: LibreOffice X" / "LibreOffice X" biçimlerini tanır.
function kayitDogrula(metin, surum) {
  const m = String(metin || '');
  const sh = m.match(/^[ \t]*(?:MSI[ \t]+)?SHA-256:[ \t]*([0-9A-Fa-f]{64})(?![0-9A-Za-z])/m);
  if (!sh) return { tamam: false, neden: 'kayıtta geçerli (64 hex) SHA-256 satırı yok' };
  const sv = m.match(/^[ \t]*(?:Sürüm:[ \t]*)?LibreOffice[ \t]+([0-9][0-9A-Za-z.\-]*)/m);
  if (!sv) return { tamam: false, neden: 'kayıtta sürüm satırı yok' };
  if (sh[1].toLowerCase() !== String(surum.sha256).toLowerCase()) return { tamam: false, neden: `kayıttaki SHA-256 (${sh[1]}) sabit değerle uyuşmuyor` };
  if (sv[1] !== String(surum.surum)) return { tamam: false, neden: `kayıttaki sürüm (${sv[1]}) beklenen ${surum.surum} değil` };
  return { tamam: true, neden: '' };
}

function imzaDogrula(msi) {
  if (process.platform === 'win32') {
    const betik = '$s = Get-AuthenticodeSignature -LiteralPath $args[0]; "$($s.Status)|$($s.SignerCertificate.Subject)"';
    const r = calistir('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', betik, msi]);
    const cikti = String(r.stdout).trim();
    const ayrac = cikti.indexOf('|');
    const durum = ayrac < 0 ? cikti : cikti.slice(0, ayrac);
    const konu = ayrac < 0 ? '' : cikti.slice(ayrac + 1);
    if (durum !== 'Valid' || !imzaciDogruMu(konu)) hata(`imza geçersiz (${durum}, ${konu})`);
    return konu;
  }
  const crl = crlArgumanlari();
  for (let i = 1; i < crl.length; i += 2) if (!fs.existsSync(crl[i])) hata(`CRL dosyası yok: ${crl[i]}`);
  const r = calistir('osslsigncode', ['verify', ...crl, '-in', msi]);
  const cikti = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || !/Signature verification: ok/i.test(cikti)) hata('imza doğrulanamadı (osslsigncode)');
  const konu = (cikti.match(/Signer's certificate:[\s\S]*?Subject:\s*(.+)/) || [])[1] || '';
  if (!imzaciDogruMu(konu)) hata(`imzacı beklenen değil: ${konu}`);
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

// kok altında adı (büyük/küçük harf duyarsız) adlar listesinde olan ilk klasörü bulur (genişlik öncelikli).
// haric: taranmayacak klasör (ör. LibreOffice'in kendi klasörü; içindeki share/fonts karışmasın).
function ekKlasorBul(kok, adlar, haric) {
  const aranan = adlar.map((a) => a.toLowerCase());
  const yok = haric ? path.resolve(haric) : null;
  const kuyruk = [kok];
  while (kuyruk.length) {
    const d = kuyruk.shift();
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      if (!g.isDirectory()) continue;
      const y = path.join(d, g.name);
      if (yok && path.resolve(y) === yok) continue;
      if (aranan.includes(g.name.toLowerCase())) return y;
      kuyruk.push(y);
    }
  }
  return null;
}

const icindeMi = (kok, yol) => { const g = path.relative(kok, yol); return g !== '' && !g.startsWith('..') && !path.isAbsolute(g); };

// Kopyalama planı: kaynakKlasor içindeki (yalnız üst düzey) uzantıya uyan dosyalar -> hedefKok/altYol.
// Yalnız normal dosya (lstat); symlink/junction vb. reddedilir. Hedefte aynı ad varsa ya da hedef kökün dışına çıkarsa hata verir.
function kopyaPlani(kaynakKlasor, hedefKok, altYol, uzantilar) {
  const hedefKlasor = path.resolve(hedefKok, altYol);
  if (!icindeMi(path.resolve(hedefKok), hedefKlasor)) throw new Error(`Hedef yol dışarı taşıyor: ${altYol}`);
  const plan = [];
  const gorulen = new Set();
  for (const ad of fs.readdirSync(kaynakKlasor).sort()) {
    if (!uzantilar.includes(path.extname(ad).toLowerCase())) continue;
    const kaynak = path.join(kaynakKlasor, ad);
    if (!fs.lstatSync(kaynak).isFile()) throw new Error(`Normal dosya değil, reddedildi: ${kaynak}`);
    const hedef = path.resolve(hedefKlasor, ad);
    if (path.dirname(hedef) !== hedefKlasor || !icindeMi(path.resolve(hedefKok), hedef)) throw new Error(`Hedef yol dışarı taşıyor: ${ad}`);
    if (gorulen.has(ad.toLowerCase())) throw new Error(`Pakette aynı ad iki kez var: ${ad}`);
    gorulen.add(ad.toLowerCase());
    let varMi = true;
    try { fs.lstatSync(hedef); } catch (e) { if (e.code === 'ENOENT') varMi = false; else throw e; }
    if (varMi) throw new Error(`Hedefte aynı adlı dosya var, üzerine yazılmaz: ${hedef}`);
    plan.push({ kaynak, hedef });
  }
  return plan;
}

// Planı uygular; üzerine yazmaz (COPYFILE_EXCL). Hedef klasör gerçek yolu kökün içinde kalmalı.
function planiUygula(plan, hedefKok) {
  const kokGercek = fs.realpathSync(hedefKok);
  for (const { kaynak, hedef } of plan) {
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    if (!icindeMi(kokGercek, fs.realpathSync(path.dirname(hedef)))) throw new Error(`Hedef klasör dışarı taşıyor: ${hedef}`);
    fs.copyFileSync(kaynak, hedef, fs.constants.COPYFILE_EXCL);
  }
  return plan.length;
}

// Pakete alınmayacak Python betik bileşenleri (LibreOffice köküne göre, "/" ayraçlı, büyük/küçük harf duyarsız).
// "*" yalnız tek yol parçası içinde eşleşir; klasör deseni altındaki her şeyi kapsar.
const PYTHON_BILESENLERI = Object.freeze([
  'program/pythonloaderlo.dll',
  'program/pythonloader.uno.ini',
  'program/pythonloader.py',
  'program/pythonscript.py',
  'program/pyuno.pyd',
  'program/python.exe',
  'program/python3*.dll',
  'program/python-core-*',
  'program/__pycache__',
  'share/Scripts/python',
  'share/registry/librelogo.xcd',
]);
const KRITIK_PYTHON_BILESENI = 'program/pythonloaderlo.dll';

const desenRegex = (d) => new RegExp('^' + d.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
const PYTHON_REGEXLERI = PYTHON_BILESENLERI.map(desenRegex);

// Saf eşleştirme: göreli yol (LibreOffice köküne göre) bir Python bileşeni mi ya da onun altında mı?
// Mutlak yol, ".." parçası ya da kök dışına taşan yol her zaman false döner.
function pythonBilesenMi(goreli) {
  if (typeof goreli !== 'string' || goreli === '') return false;
  if (goreli.includes('\0') || path.win32.isAbsolute(goreli) || path.posix.isAbsolute(goreli)) return false;
  const parcalar = goreli.split(/[\\/]+/).filter((x) => x !== '' && x !== '.');
  if (parcalar.length === 0 || parcalar.includes('..')) return false;
  for (let i = 1; i <= parcalar.length; i++) {
    const on = parcalar.slice(0, i).join('/').toLowerCase();
    if (PYTHON_REGEXLERI.some((r) => r.test(on))) return true;
  }
  return false;
}

// kok (LibreOffice klasörü, geçici kopya) altından Python bileşenlerini kaldırır; symlink izlenmez.
// Dönüş: { cikarilan: [göreli yollar], kritikVar: pythonloaderlo.dll bulundu mu }
function pythonBilesenleriCikar(kok) {
  const kokYol = path.resolve(kok);
  const cikarilan = [];
  const yigin = [''];
  while (yigin.length) {
    const ust = yigin.pop();
    for (const g of fs.readdirSync(path.join(kokYol, ust), { withFileTypes: true })) {
      const goreli = ust ? ust + '/' + g.name : g.name;
      if (pythonBilesenMi(goreli)) {
        const tam = path.resolve(kokYol, goreli);
        if (!icindeMi(kokYol, tam)) throw new Error(`Yol kök dışına taşıyor: ${goreli}`);
        fs.rmSync(tam, { recursive: true, force: true });
        cikarilan.push(goreli);
      } else if (g.isDirectory()) yigin.push(goreli);
    }
  }
  cikarilan.sort();
  return { cikarilan, kritikVar: cikarilan.some((c) => c.toLowerCase() === KRITIK_PYTHON_BILESENI) };
}

function surumMetni(surum, konu) {
  return `Ne: Dosya Dönüştürücü'ye gömülü LibreOffice paketinin kimlik kartı. Sahibi: Yusuf Beşir (dosya-donusturucu projesi). ` +
    `Değiştirme kuralı: yalnız scripts/libreoffice-hazirla.js ya da aynı adımlarla yeni resmi sürüm hazırlanırken yeniden yazılır; ` +
    `silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak olur.\n` +
    `Sürüm: LibreOffice ${surum.surum} (dosyaları değiştirilmemiş; yalnız Python betik bileşenleri çıkarıldı)\n` +
    `Python: Python betik desteği (pyuno, Python çalışma zamanı, LibreLogo) Windows'ta Writer dönüşümlerini kilitlediği ve gerekmediği için pakete alınmadı.\n` +
    `Kaynak: ${surum.kaynak}\n` +
    `MSI SHA-256: ${surum.sha256}\n` +
    `İmzacı konusu: ${konu}\n` +
    `Yerleşim: VC++ çalışma zamanı DLL'leri program/ altına, yazı tipleri share/fonts/truetype/ altına konur; sistem klasörlerine hiçbir şey yazılmaz.\n` +
    `Lisans: LibreOffice MPL-2.0 (ayrıntı: program içindeki LICENSE.html / license.txt); yazı tipleri kendi lisanslarıyla; ` +
    `VC++ çalışma zamanı Microsoft yeniden dağıtım izniyle.\n` +
    `Kaynak kod: https://www.libreoffice.org/about-us/source-code/\n`;
}

async function main() {
  const SURUM = surumOku();
  const msi = process.argv[2] || process.env.LIBREOFFICE_MSI;
  if (fs.existsSync(path.join(HEDEF, 'program', 'soffice.exe'))) {
    const kayitYolu = path.join(HEDEF, 'GOMULU-SURUM.txt');
    const yonerge = 'vendor/libreoffice farklı sürümde ya da doğrulanamıyor; elle, Yusuf\'un kararıyla çöp kutusuna taşınmalı (silinmemeli).';
    if (!fs.existsSync(kayitYolu)) hata(`GOMULU-SURUM.txt yok. ${yonerge}`);
    const k = kayitDogrula(fs.readFileSync(kayitYolu, 'utf8'), SURUM);
    if (!k.tamam) hata(`${k.neden}. ${yonerge}`);
    if (msi) {
      if (!fs.existsSync(msi)) hata('MSI dosyası yok.');
      const o = await sha256(msi);
      if (o !== SURUM.sha256) hata(`SHA-256 uyuşmuyor. Beklenen ${SURUM.sha256}, bulunan ${o}`);
    }
    console.log('LibreOffice zaten hazır ve sürüm kaydı eşleşiyor: ' + HEDEF);
    return;
  }
  if (!msi || !fs.existsSync(msi)) hata('MSI dosyası verilmedi ya da yok.');
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
    // Ekler önce geçici kopya üzerinde planlanır/uygulanır; hata olursa HEDEF'e hiçbir şey yazılmaz.
    const dllKlasoru = ekKlasorBul(gecici, ['System64', 'System64Folder'], kaynak);
    const yaziKlasoru = ekKlasorBul(gecici, ['Fonts', 'FontsFolder'], kaynak);
    const zatenIcerde = (k) => k && icindeMi(path.resolve(kaynak), path.resolve(k));
    if (!dllKlasoru || zatenIcerde(dllKlasoru)) console.warn('UYARI: !!! System64 (VC++ DLL) klasörü pakette bulunamadı; DLL\'ler EKLENMEDİ, LibreOffice hedef bilgisayarda çalışmayabilir !!!');
    if (!yaziKlasoru || zatenIcerde(yaziKlasoru)) console.warn('UYARI: Fonts (yazı tipi) klasörü pakette bulunamadı; yazı tipleri eklenmedi.');
    try {
      let dll = 0; let yazi = 0;
      if (dllKlasoru && !zatenIcerde(dllKlasoru)) dll = planiUygula(kopyaPlani(dllKlasoru, kaynak, 'program', ['.dll']), kaynak);
      if (yaziKlasoru && !zatenIcerde(yaziKlasoru)) yazi = planiUygula(kopyaPlani(yaziKlasoru, kaynak, path.join('share', 'fonts', 'truetype'), ['.ttf', '.otf']), kaynak);
      console.log(`Eklendi: ${dll} DLL, ${yazi} yazı tipi`);
    } catch (e) { hata(e.message); }
    const py = pythonBilesenleriCikar(kaynak);
    if (!py.kritikVar) console.warn(`UYARI: ${KRITIK_PYTHON_BILESENI} pakette bulunamadı; yine de devam ediliyor.`);
    console.log(`Python bileşenleri çıkarıldı (${py.cikarilan.length}): ${py.cikarilan.join(', ') || '-'}`);
    await fsp.mkdir(path.dirname(HEDEF), { recursive: true });
    await fsp.cp(kaynak, HEDEF, { recursive: true, errorOnExist: true, force: false });
    await fsp.writeFile(path.join(HEDEF, 'GOMULU-SURUM.txt'), surumMetni(SURUM, konu), 'utf8');
    console.log('LibreOffice hazırlandı: ' + HEDEF);
  } finally {
    await fsp.rm(gecici, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((e) => hata(e.message));

module.exports = { PYTHON_BILESENLERI, pythonBilesenMi, pythonBilesenleriCikar, konuAyristir, imzaciDogruMu, kayitDogrula, crlArgumanlari, ekKlasorBul, kopyaPlani, planiUygula, surumMetni, sofficeKlasoruBul };
