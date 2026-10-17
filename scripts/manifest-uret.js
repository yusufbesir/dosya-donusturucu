'use strict';
// electron-builder afterPack kancası: appOutDir içindeki dosyaların manifestini
// resources/surum-manifest.json olarak yazar (bağlar atlanır, manifest kendini listelemez).
// Ayrıca NSIS kaldırıcısı için resources/surum-dosyalar.txt düz metin listesini üretir:
// "F|göreli\\yol" (dosya) ve "D|göreli\\klasör" satırları, Windows ters bölü ayraçlı, CRLF.
// Önce tüm dosyalar, sonra klasörler EN DERİNDEN başlayarak yazılır; liste kendisini ve manifesti de içerir.
// Dosya UTF-16LE (BOM'lu) yazılır: ana exe adı "Dosya Dönüştürücü.exe" ASCII dışı olduğundan NSIS'in
// Unicode okuması (FileReadUTF16LE) gerekir. İlk satır "H|..." başlığıdır; BOM okunursa yalnız onu etkiler.
// Windows'ta manifestten önce exe'ye ikon/sürüm bilgisi gömülür (scripts/exe-kaynak.js).
// Kaldırıcı (build/kurulum.nsh) yalnız bu listedekileri siler; kullanıcının eklediği dosyalar kalır.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exeKaynaklariniGom } = require('./exe-kaynak');

const MANIFEST_GORELI = 'resources/surum-manifest.json';
const LISTE_GORELI = 'resources/surum-dosyalar.txt';

function sha256Dosya(yol) {
  return new Promise((coz, red) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(yol);
    s.on('error', red);
    s.on('data', (b) => h.update(b));
    s.on('end', () => coz(h.digest('hex')));
  });
}

async function dosyalariTopla(kok, klasorler) {
  const sonuc = [];
  async function gez(klasor, onek) {
    const girdiler = await fs.promises.readdir(klasor, { withFileTypes: true });
    girdiler.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const g of girdiler) {
      const tam = path.join(klasor, g.name);
      const goreli = onek ? onek + '/' + g.name : g.name;
      const st = await fs.promises.lstat(tam);
      if (st.isSymbolicLink()) continue; // bağlar dahil edilmez, izlenmez
      if (!onek && g.name === '.surum') continue; // çalışma zamanı kayıt klasörü (varsa) listelenmez
      if (st.isDirectory()) {
        if (klasorler) klasorler.push(goreli);
        await gez(tam, goreli);
      }
      else if (st.isFile()) {
        if (goreli.toLowerCase() === MANIFEST_GORELI || goreli.toLowerCase() === LISTE_GORELI) continue;
        sonuc.push({ yol: goreli, boyut: st.size, sha256: await sha256Dosya(tam) });
      }
    }
  }
  await gez(kok, '');
  return sonuc;
}

// NSIS kaldırıcı listesi içeriği: önce F satırları, sonra D satırları (derinlik azalan, sonra ada göre)
function listeMetni(dosyaYollari, klasorYollari) {
  const gecerli = (y) => {
    if (/[\r\n\0]/.test(y)) throw new Error(`Listeye alınamayan yol: ${JSON.stringify(y)}`);
    return y.split('/').join('\\');
  };
  const dosyalar = [...new Set(dosyaYollari)].sort();
  const klasorler = new Set(klasorYollari);
  for (const d of dosyalar) {
    const p = d.split('/');
    for (let i = 1; i < p.length; i++) klasorler.add(p.slice(0, i).join('/'));
  }
  const derinlik = (y) => y.split('/').length;
  const siraliK = [...klasorler].sort((a, b) => derinlik(b) - derinlik(a) || (a < b ? -1 : a > b ? 1 : 0));
  return ['H|surum-dosyalar', ...dosyalar.map((d) => `F|${gecerli(d)}`), ...siraliK.map((d) => `D|${gecerli(d)}`)].join('\r\n') + '\r\n';
}

const listeBayt = (metin) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(metin, 'utf16le')]);

async function manifestUret(klasor, surum) {
  const klasorler = [];
  const dosyalar = await dosyalariTopla(klasor, klasorler);
  const manifest = { uygulama: 'dosya-donusturucu', surum, olusturma: new Date().toISOString(), dosyalar };
  const hedef = path.join(klasor, 'resources', 'surum-manifest.json');
  await fs.promises.mkdir(path.dirname(hedef), { recursive: true });
  await fs.promises.writeFile(hedef, JSON.stringify(manifest, null, 1));
  // NSIS kaldırıcı listesi (liste kendini ve manifesti de içerir)
  const listeYolu = path.join(klasor, 'resources', 'surum-dosyalar.txt');
  await fs.promises.writeFile(listeYolu, listeBayt(listeMetni(
    [...dosyalar.map((d) => d.yol), MANIFEST_GORELI, LISTE_GORELI], klasorler.filter((k) => k !== '.surum'))));
  return manifest;
}

// build/uretilen/liste-sha.nsh: kaldırıcının (build/kurulum.nsh) silmeden önce doğruladığı liste özeti.
// afterPack, NSIS derlemesinden önce çalışır (platformPackager.doPack: afterPack -> hedeflerin build'i).
async function listeShaYaz(klasor, hedefKlasor) {
  const sha = (await sha256Dosya(path.join(klasor, 'resources', 'surum-dosyalar.txt'))).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('liste SHA-256 hesaplanamadı');
  await fs.promises.mkdir(hedefKlasor, { recursive: true });
  await fs.promises.writeFile(path.join(hedefKlasor, 'liste-sha.nsh'), `!define DD_LISTE_SHA256 "${sha}"\r\n`);
  return sha;
}

// electron-builder: package.json build.afterPack
module.exports = async function afterPack(context) {
  const surum = (context.packager && context.packager.appInfo && context.packager.appInfo.version) ||
    require('../package.json').version;
  // Windows: ikon ve sürüm bilgisini manifestten ÖNCE göm (exe sonradan değişirse hash bayatlar)
  if (context.electronPlatformName === 'win32') {
    const ad = context.packager.appInfo.productFilename;
    exeKaynaklariniGom(path.join(context.appOutDir, `${ad}.exe`), {
      ikonYolu: path.join(__dirname, '..', 'build', 'ikon.ico'),
      surum,
      urunAdi: context.packager.appInfo.productName,
      dosyaAdi: `${ad}.exe`,
    });
  }
  await manifestUret(context.appOutDir, surum);
  await listeShaYaz(context.appOutDir, path.join(__dirname, '..', 'build', 'uretilen'));
};
module.exports.listeShaYaz = listeShaYaz;
module.exports.manifestUret = manifestUret;
module.exports.dosyalariTopla = dosyalariTopla;
module.exports.listeMetni = listeMetni;
module.exports.listeBayt = listeBayt;
