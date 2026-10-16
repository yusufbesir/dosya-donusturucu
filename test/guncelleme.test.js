'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eskiSurumuTemizle, goreliGecerli, fsSec, varsayilanFs } = require('../src/guncelleme');
const { manifestUret } = require('../scripts/manifest-uret');

const kokler = [];
function gecici() {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-guncelleme-'));
  kokler.push(k);
  return fs.realpathSync(k);
}
test.after(() => { for (const k of kokler) fs.rmSync(k, { recursive: true, force: true }); });

function yaz(kok, goreli, icerik) {
  const t = path.join(kok, ...goreli.split('/'));
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, icerik);
}
const var_ = (kok, goreli) => fs.existsSync(path.join(kok, ...goreli.split('/')));
const oncekiYol = (kok) => path.join(kok, '.surum', 'onceki-manifest.json');
const oncekiOku = (kok) => JSON.parse(fs.readFileSync(oncekiYol(kok), 'utf8'));
const calistir = (kok, ek = {}) => eskiSurumuTemizle({ kurulumKoku: kok, resourcesYolu: path.join(kok, 'resources'), korunacakKokler: [], calisanExe: 'app.exe', ...ek });

// Sahte v1 kurulumu + manifest; v1 manifesti "önceki" olarak kaydedilir
async function v1Kur(kok) {
  yaz(kok, 'app.exe', 'EXE1');
  yaz(kok, 'resources/app.asar', 'ASAR1');
  yaz(kok, 'resources/eski/eski.dll', 'ESKI-DLL');
  yaz(kok, 'resources/eski/derin/eski2.txt', 'ESKI2');
  yaz(kok, 'resources/ortak.txt', 'ORTAK');
  await manifestUret(kok, '1.0.0');
  const m = fs.readFileSync(path.join(kok, 'resources', 'surum-manifest.json'));
  fs.mkdirSync(path.join(kok, '.surum'), { recursive: true });
  fs.writeFileSync(oncekiYol(kok), m);
}
// v2: temiz bir paketten manifest üretilir (afterPack gibi); dosyalar eskilerin üzerine kopyalanır
// ve v1'den kalan dosyalar yerinde bırakılır (NSIS güncellemede silmez)
async function v2Kur(kok) {
  const paket = gecici();
  yaz(paket, 'app.exe', 'EXE2-yeni');
  yaz(paket, 'resources/app.asar', 'ASAR2-yeni');
  yaz(paket, 'resources/ortak.txt', 'ORTAK');
  yaz(paket, 'resources/yeni.txt', 'YENI');
  await manifestUret(paket, '2.0.0');
  fs.cpSync(paket, kok, { recursive: true });
}

test('ilk kurulumda hiçbir şey silinmez ve manifest kaydedilir', async () => {
  const kok = gecici();
  yaz(kok, 'app.exe', 'E'); yaz(kok, 'resources/app.asar', 'A'); yaz(kok, 'resources/baska.dat', 'B');
  yaz(kok, 'kullanici-notu.txt', 'dokunma');
  await manifestUret(kok, '1.0.0');
  const r = await calistir(kok);
  assert.equal(r.durum, 'ilk-kurulum');
  assert.deepEqual(r.silinen, []);
  assert.ok(var_(kok, 'kullanici-notu.txt') && var_(kok, 'resources/baska.dat'));
  assert.equal(oncekiOku(kok).surum, '1.0.0');
  assert.ok(fs.readFileSync(path.join(kok, '.surum', 'temizlik-gunlugu.txt'), 'utf8').length > 0);
});

test('manifest yoksa ya da uygulama alanı tutmuyorsa hiçbir şey yapılmaz', async () => {
  const kok = gecici();
  yaz(kok, 'app.exe', 'E');
  assert.equal((await calistir(kok)).durum, 'manifest-yok');
  yaz(kok, 'resources/surum-manifest.json', JSON.stringify({ uygulama: 'baska', dosyalar: [] }));
  assert.equal((await calistir(kok)).durum, 'manifest-yok');
  assert.ok(!var_(kok, '.surum'));
});

test('güncellemede yalnız eski manifestte olup yenide olmayan dosyalar silinir; boşalan klasörler kalkar', async () => {
  const kok = gecici();
  await v1Kur(kok);
  await v2Kur(kok);
  yaz(kok, 'kullanici-notu.txt', 'manifestte yok');
  yaz(kok, 'resources/eski/kullanici.txt', 'manifestte yok');
  const r = await calistir(kok);
  assert.equal(r.durum, 'temizlendi');
  assert.deepEqual(r.silinen.sort(), ['resources/eski/derin/eski2.txt', 'resources/eski/eski.dll']);
  assert.ok(!var_(kok, 'resources/eski/eski.dll'));
  assert.ok(!var_(kok, 'resources/eski/derin'), 'boşalan klasör kaldırılmalı');
  assert.ok(var_(kok, 'resources/eski'), 'içinde kullanıcı dosyası olan klasör kalmalı');
  assert.ok(var_(kok, 'resources/eski/kullanici.txt'));
  assert.ok(var_(kok, 'kullanici-notu.txt'));
  assert.ok(var_(kok, 'resources/ortak.txt') && var_(kok, 'resources/yeni.txt') && var_(kok, 'app.exe'));
  assert.equal(oncekiOku(kok).surum, '2.0.0');
  // ikinci çalıştırma: aynı sürüm, işlem yok
  assert.equal((await calistir(kok)).durum, 'guncel');
});

test('yeni manifestteki dosya eksikse, boyutu bozuksa ya da exe/asar sha256 tutmuyorsa hiçbir şey silinmez', async () => {
  for (const bozma of [
    (k) => fs.rmSync(path.join(k, 'resources/yeni.txt')),
    (k) => yaz(k, 'resources/yeni.txt', 'YENI-BOZUK-BOYUT'),
    (k) => yaz(k, 'resources/app.asar', 'ASAR2-yeni'.replace('2', '3')), // aynı boyut, farklı içerik
    (k) => yaz(k, 'app.exe', 'EXE2-yeni'.replace('E', 'X')),
  ]) {
    const kok = gecici();
    await v1Kur(kok); await v2Kur(kok);
    bozma(kok);
    const r = await calistir(kok);
    assert.equal(r.durum, 'dogrulanamadi');
    assert.ok(var_(kok, 'resources/eski/eski.dll') && var_(kok, 'resources/eski/derin/eski2.txt'));
    assert.equal(oncekiOku(kok).surum, '1.0.0', 'önceki manifest güncellenmemeli');
  }
});

test('kurulum dışına çıkan yollar reddedilir', async () => {
  const kok = gecici(); const dis = gecici();
  yaz(dis, 'hedef.txt', 'DIS');
  await v1Kur(kok);
  await v2Kur(kok);
  const onceki = oncekiOku(kok);
  const kotu = ['../' + path.basename(dis) + '/hedef.txt', path.join(dis, 'hedef.txt'), 'C:\\Windows\\x.dll', 'C:/x', '\\\\sunucu\\paylasim\\x', 'a/../../' + path.basename(dis) + '/hedef.txt', '/etc/passwd', 'a\\..\\b', '.surum/onceki-manifest.json'];
  for (const y of kotu) onceki.dosyalar.push({ yol: y, boyut: 3 });
  fs.writeFileSync(oncekiYol(kok), JSON.stringify(onceki));
  const r = await calistir(kok);
  assert.equal(r.durum, 'temizlendi');
  for (const y of kotu) assert.ok(r.atlanan.some((a) => a.yol === y && a.neden === 'gecersiz-yol'), y);
  assert.equal(fs.readFileSync(path.join(dis, 'hedef.txt'), 'utf8'), 'DIS');
  assert.ok(var_(kok, '.surum/onceki-manifest.json'));
});

test('sembolik bağlar (klasör ve dosya) izlenmez ve silinmez; hedef sağlam kalır', async () => {
  const kok = gecici(); const dis = gecici();
  yaz(dis, 'klasor/gizli.txt', 'GIZLI');
  yaz(dis, 'dosya.txt', 'DOSYA');
  await v1Kur(kok);
  // v1 manifestine bağlar üzerinden adaylar ekle
  fs.symlinkSync(path.join(dis, 'klasor'), path.join(kok, 'resources', 'baglantili'), 'junction');
  fs.symlinkSync(path.join(dis, 'dosya.txt'), path.join(kok, 'resources', 'bag-dosya.txt'));
  const onceki = oncekiOku(kok);
  onceki.dosyalar.push({ yol: 'resources/baglantili/gizli.txt', boyut: 5 }, { yol: 'resources/bag-dosya.txt', boyut: 5 });
  fs.writeFileSync(oncekiYol(kok), JSON.stringify(onceki));
  await v2Kur(kok);
  const r = await calistir(kok);
  assert.equal(r.durum, 'temizlendi');
  assert.equal(fs.readFileSync(path.join(dis, 'klasor/gizli.txt'), 'utf8'), 'GIZLI');
  assert.equal(fs.readFileSync(path.join(dis, 'dosya.txt'), 'utf8'), 'DOSYA');
  assert.ok(fs.lstatSync(path.join(kok, 'resources', 'baglantili')).isSymbolicLink());
  assert.ok(fs.lstatSync(path.join(kok, 'resources', 'bag-dosya.txt')).isSymbolicLink());
  assert.ok(!r.silinen.includes('resources/baglantili/gizli.txt') && !r.silinen.includes('resources/bag-dosya.txt'));
  assert.ok(r.atlanan.filter((a) => a.neden === 'bag').length >= 2);
});

test('korunacak kök kurulum içinde olsa bile silinmez', async () => {
  const kok = gecici();
  await v1Kur(kok); await v2Kur(kok);
  const r = await calistir(kok, { korunacakKokler: [path.join(kok, 'resources', 'eski')] });
  assert.equal(r.silinen.length, 0);
  assert.ok(r.atlanan.every((a) => a.neden === 'korunan'));
  assert.ok(var_(kok, 'resources/eski/eski.dll') && var_(kok, 'resources/eski/derin/eski2.txt'));
});

test('boyutu değişmiş (kullanıcının değiştirdiği) dosya silinmez', async () => {
  const kok = gecici();
  await v1Kur(kok);
  yaz(kok, 'resources/eski/eski.dll', 'KULLANICI-DEGISTIRDI-UZUN');
  await v2Kur(kok);
  const r = await calistir(kok);
  assert.ok(var_(kok, 'resources/eski/eski.dll'));
  assert.ok(r.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'boyut-degisti'));
  assert.deepEqual(r.silinen, ['resources/eski/derin/eski2.txt']);
});

test('hata ortasında silme durur, istisna fırlatmaz ve onceki-manifest güncellenmez', async () => {
  const kok = gecici();
  await v1Kur(kok); await v2Kur(kok);
  const gercek = Object.assign({}, fs.promises, { createReadStream: fs.createReadStream });
  let silme = 0;
  const fsImpl = Object.assign({}, gercek, {
    unlink: async (p) => { if (++silme === 2) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return fs.promises.unlink(p); }
  });
  const r = await calistir(kok, { fsImpl });
  assert.equal(r.durum, 'hata');
  assert.equal(r.silinen.length, 1);
  assert.equal(oncekiOku(kok).surum, '1.0.0');
  // sonraki açılışta yeniden denenir ve tamamlanır
  const r2 = await calistir(kok);
  assert.equal(r2.durum, 'temizlendi');
  assert.equal(oncekiOku(kok).surum, '2.0.0');
  assert.ok(!var_(kok, 'resources/eski/derin/eski2.txt') && !var_(kok, 'resources/eski/eski.dll'));
});

test('önceki manifest yoksa (ya da bozuksa) manifestsiz bilinmeyen dosyalara dokunulmaz', async () => {
  const kok = gecici();
  await v1Kur(kok); await v2Kur(kok);
  fs.writeFileSync(oncekiYol(kok), '{bozuk');
  const r = await calistir(kok);
  assert.equal(r.durum, 'ilk-kurulum');
  assert.ok(var_(kok, 'resources/eski/eski.dll'));
});

test('manifest-uret gerçek klasörden doğru manifest üretir', async () => {
  const kok = gecici(); const dis = gecici();
  yaz(kok, 'a.exe', 'abc');
  yaz(kok, 'resources/alt/b.bin', Buffer.alloc(200000, 7));
  yaz(dis, 'x.txt', 'dis');
  fs.symlinkSync(path.join(dis, 'x.txt'), path.join(kok, 'bag.txt'));
  fs.symlinkSync(dis, path.join(kok, 'bagk'), 'junction');
  await manifestUret(kok, '9.9.9');
  await manifestUret(kok, '9.9.9'); // ikinci kez: manifest kendini listelememeli
  const m = JSON.parse(fs.readFileSync(path.join(kok, 'resources', 'surum-manifest.json'), 'utf8'));
  assert.equal(m.uygulama, 'dosya-donusturucu');
  assert.equal(m.surum, '9.9.9');
  assert.ok(!Number.isNaN(Date.parse(m.olusturma)));
  assert.deepEqual(m.dosyalar.map((d) => d.yol), ['a.exe', 'resources/alt/b.bin']);
  const crypto = require('node:crypto');
  assert.equal(m.dosyalar[0].boyut, 3);
  assert.equal(m.dosyalar[0].sha256, crypto.createHash('sha256').update('abc').digest('hex'));
  assert.equal(m.dosyalar[1].boyut, 200000);
  assert.equal(m.dosyalar[1].sha256, crypto.createHash('sha256').update(Buffer.alloc(200000, 7)).digest('hex'));
});

// ---- Denetçi bulguları: boş/eksik manifest, korunan dosyalar, son denetim, SHA-256, bağsız günlük ----
const gercekFs = () => Object.assign({}, fs.promises, { createReadStream: fs.createReadStream });
const silinmediMi = (kok) => var_(kok, 'resources/eski/eski.dll') && var_(kok, 'resources/eski/derin/eski2.txt');

test('yeni manifest boşsa ya da app.asar/çalışan exe girdisi yoksa dogrulanamadi döner, hiçbir şey silinmez', async () => {
  const bozmalar = [
    ['bos', (m) => { m.dosyalar = []; }],
    ['asar yok', (m) => { m.dosyalar = m.dosyalar.filter((d) => d.yol !== 'resources/app.asar'); }],
    ['exe yok', (m) => { m.dosyalar = m.dosyalar.filter((d) => d.yol !== 'app.exe'); }],
    ['başka exe', (m) => { m.dosyalar.find((d) => d.yol === 'app.exe').yol = 'baska.exe'; }],
  ];
  for (const [ad, boz] of bozmalar) {
    const kok = gecici();
    await v1Kur(kok); await v2Kur(kok);
    const yolM = path.join(kok, 'resources', 'surum-manifest.json');
    const m = JSON.parse(fs.readFileSync(yolM, 'utf8'));
    boz(m);
    fs.writeFileSync(yolM, JSON.stringify(m));
    const r = await calistir(kok);
    assert.equal(r.durum, 'dogrulanamadi', ad);
    assert.deepEqual(r.silinen, [], ad);
    assert.ok(silinmediMi(kok), ad);
    assert.equal(oncekiOku(kok).surum, '1.0.0', ad);
  }
});

test('çalışan exe, resources/app.asar ve surum-manifest.json eski manifestte aday olsa da silinmez', async () => {
  const kok = gecici();
  await v1Kur(kok); await v2Kur(kok);
  const crypto = require('node:crypto');
  const manifestIcerik = fs.readFileSync(path.join(kok, 'resources', 'surum-manifest.json'));
  const onceki = oncekiOku(kok);
  // eski manifest, yenide bulunmayan farklı bir ada (büyük harf) ve manifest dosyasına işaret eder
  onceki.dosyalar.push({ yol: 'resources/surum-manifest.json', boyut: manifestIcerik.length, sha256: crypto.createHash('sha256').update(manifestIcerik).digest('hex') });
  onceki.dosyalar = onceki.dosyalar.filter((d) => d.yol !== 'app.exe' && d.yol !== 'resources/app.asar');
  const exe = fs.readFileSync(path.join(kok, 'app.exe'));
  const asar = fs.readFileSync(path.join(kok, 'resources', 'app.asar'));
  onceki.dosyalar.push({ yol: 'APP.EXE', boyut: exe.length, sha256: crypto.createHash('sha256').update(exe).digest('hex') });
  onceki.dosyalar.push({ yol: 'Resources/App.Asar', boyut: asar.length, sha256: crypto.createHash('sha256').update(asar).digest('hex') });
  fs.writeFileSync(oncekiYol(kok), JSON.stringify(onceki));
  const r = await calistir(kok, { calisanExe: 'App.exe' });
  assert.equal(r.durum, 'temizlendi');
  assert.ok(var_(kok, 'app.exe') && var_(kok, 'resources/app.asar') && var_(kok, 'resources/surum-manifest.json'));
  assert.ok(r.atlanan.filter((a) => a.neden === 'korunan-dosya').length >= 1, JSON.stringify(r.atlanan)); // exe/asar yenide zorunlu olduğundan aday olamaz; manifest dosyası korunur
});

test('silmeden önce SHA-256 karşılaştırılır: aynı boyutlu ama içeriği değişmiş dosyaya dokunulmaz', async () => {
  const kok = gecici();
  await v1Kur(kok);
  yaz(kok, 'resources/eski/eski.dll', 'ESKI-DLX'); // aynı boyut ('ESKI-DLL'), farklı içerik
  await v2Kur(kok);
  const r = await calistir(kok);
  assert.equal(r.durum, 'temizlendi');
  assert.ok(var_(kok, 'resources/eski/eski.dll'));
  assert.ok(r.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'sha256-degisti'));
  assert.deepEqual(r.silinen, ['resources/eski/derin/eski2.txt']);
  // sha256'sı olmayan eski manifest girdisi de silinmez
  const kok2 = gecici();
  await v1Kur(kok2); await v2Kur(kok2);
  const o = oncekiOku(kok2);
  o.dosyalar.forEach((d) => { delete d.sha256; });
  fs.writeFileSync(oncekiYol(kok2), JSON.stringify(o));
  const r2 = await calistir(kok2);
  assert.deepEqual(r2.silinen, []);
  assert.ok(silinmediMi(kok2));
});

test('silmeden hemen önceki denetim: hash sırasında klasör bağa çevrilirse ya da dosya değişirse silinmez', async () => {
  // A) ara klasör hash'ten sonra junction/bağ ile değiştirilir
  const kokA = gecici();
  await v1Kur(kokA); await v2Kur(kokA);
  const fsA = Object.assign(gercekFs(), {
    createReadStream: (p) => {
      const s = fs.createReadStream(p);
      if (p.endsWith('eski.dll')) s.on('end', () => {
        const d = path.join(kokA, 'resources', 'eski');
        fs.renameSync(d, d + '-yedek');
        fs.symlinkSync(d + '-yedek', d, 'junction');
      });
      return s;
    }
  });
  const rA = await calistir(kokA, { fsImpl: fsA });
  assert.ok(rA.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'bag'), JSON.stringify(rA));
  assert.ok(fs.existsSync(path.join(kokA, 'resources', 'eski-yedek', 'eski.dll')), 'dosya silinmemeli');
  // B) dosya hash'ten sonra (aynı boyutta) yeniden yazılır
  const kokB = gecici();
  await v1Kur(kokB); await v2Kur(kokB);
  const fsB = Object.assign(gercekFs(), {
    createReadStream: (p) => {
      const s = fs.createReadStream(p);
      if (p.endsWith('eski.dll')) s.on('end', () => {
        fs.writeFileSync(p, 'ESKI-DLL');
        const t = new Date(Date.now() + 20000);
        fs.utimesSync(p, t, t);
      });
      return s;
    }
  });
  const rB = await calistir(kokB, { fsImpl: fsB });
  assert.ok(rB.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'degisti'), JSON.stringify(rB));
  assert.ok(var_(kokB, 'resources/eski/eski.dll'));
  // C) realpath ikinci denetimde farklı dönerse
  const kokC = gecici();
  await v1Kur(kokC); await v2Kur(kokC);
  const hedefDll = path.join(kokC, 'resources', 'eski', 'eski.dll');
  let n = 0;
  const fsC = Object.assign(gercekFs(), {
    realpath: async (p) => { const r = await fs.promises.realpath(p); if (p === hedefDll && ++n === 2) return path.join(kokC, 'baska'); return r; }
  });
  const rC = await calistir(kokC, { fsImpl: fsC });
  assert.ok(rC.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'yol-degisti'), JSON.stringify(rC));
  assert.ok(var_(kokC, 'resources/eski/eski.dll'));
});

test('temizlik-gunlugu.txt ve onceki-manifest sembolik bağ izlemez; geçici dosya wx ile açılır', async () => {
  const kok = gecici(); const dis = gecici();
  yaz(dis, 'gunluk-hedef.txt', 'DIS-GUNLUK');
  yaz(dis, 'manifest-hedef.json', 'DIS-MANIFEST');
  await v1Kur(kok); await v2Kur(kok);
  fs.symlinkSync(path.join(dis, 'gunluk-hedef.txt'), path.join(kok, '.surum', 'temizlik-gunlugu.txt'));
  fs.rmSync(oncekiYol(kok));
  fs.symlinkSync(path.join(dis, 'manifest-hedef.json'), oncekiYol(kok));
  const bayraklar = [];
  const fsi = Object.assign(gercekFs(), {
    writeFile: (p, v, o) => { bayraklar.push(o && o.flag); return fs.promises.writeFile(p, v, o); }
  });
  const r = await calistir(kok, { fsImpl: fsi });
  assert.ok(['ilk-kurulum', 'temizlendi'].includes(r.durum), r.durum);
  assert.equal(fs.readFileSync(path.join(dis, 'gunluk-hedef.txt'), 'utf8'), 'DIS-GUNLUK');
  assert.equal(fs.readFileSync(path.join(dis, 'manifest-hedef.json'), 'utf8'), 'DIS-MANIFEST');
  assert.ok(fs.lstatSync(path.join(kok, '.surum', 'temizlik-gunlugu.txt')).isSymbolicLink(), 'bağ yerinde kalır, izlenmez');
  assert.ok(fs.lstatSync(oncekiYol(kok)).isFile() && !fs.lstatSync(oncekiYol(kok)).isSymbolicLink(), 'manifest bağın üzerine normal dosya olarak yazılır');
  assert.equal(oncekiOku(kok).surum, '2.0.0');
  assert.deepEqual(bayraklar, ['wx']);
  assert.deepEqual(fs.readdirSync(path.join(kok, '.surum')).filter((d) => d.endsWith('.tmp')), []);
});

// ---- NSIS kaldırıcı listesi ve betik ----
function listeOku(kok) {
  const b = fs.readFileSync(path.join(kok, 'resources', 'surum-dosyalar.txt'));
  assert.equal(b[0], 0xff); assert.equal(b[1], 0xfe, 'UTF-16LE BOM');
  return b.subarray(2).toString('utf16le').split('\r\n').filter(Boolean);
}

test('manifest-uret: surum-dosyalar.txt (F|/D| satırları, ters bölü, derin klasör önce, kendini ve manifesti içerir)', async () => {
  const kok = gecici();
  yaz(kok, 'Dosya Dönüştürücü.exe', 'E');
  yaz(kok, 'resources/app.asar', 'A');
  yaz(kok, 'resources/ffmpeg/bin/ffmpeg.exe', 'F');
  yaz(kok, 'locales/tr.pak', 'T');
  fs.mkdirSync(path.join(kok, 'bos', 'alt'), { recursive: true });
  fs.mkdirSync(path.join(kok, '.surum')); fs.writeFileSync(path.join(kok, '.surum', 'onceki-manifest.json'), '{}');
  await manifestUret(kok, '1.2.3');
  await manifestUret(kok, '1.2.3'); // yinelemede liste kendini manifeste katmamalı
  const satirlar = listeOku(kok);
  const F = satirlar.filter((s) => s.startsWith('F|')).map((s) => s.slice(2));
  const D = satirlar.filter((s) => s.startsWith('D|')).map((s) => s.slice(2));
  assert.deepEqual(F.sort(), ['Dosya Dönüştürücü.exe', 'locales\\tr.pak', 'resources\\app.asar', 'resources\\ffmpeg\\bin\\ffmpeg.exe',
    'resources\\surum-dosyalar.txt', 'resources\\surum-manifest.json']);
  assert.deepEqual(D, ['resources\\ffmpeg\\bin', 'bos\\alt', 'resources\\ffmpeg', 'bos', 'locales', 'resources'].sort((a, b) => b.split('\\').length - a.split('\\').length || (a < b ? -1 : 1)));
  assert.ok(satirlar.findIndex((s) => s.startsWith('D|')) > satirlar.map((s) => s[0]).lastIndexOf('F'), 'önce dosyalar, sonra klasörler');
  assert.ok(!satirlar.some((s) => s.includes('/') || s.includes('.surum')), 'ters bölü ayraç, .surum yok');
  const m = JSON.parse(fs.readFileSync(path.join(kok, 'resources', 'surum-manifest.json'), 'utf8'));
  assert.ok(!m.dosyalar.some((d) => d.yol.endsWith('surum-dosyalar.txt')));
  assert.throws(() => require('../scripts/manifest-uret').listeMetni(['a\nb'], []), /alınamayan/);
});

test('kurulum.nsh: normal kaldırmada RMDir /r $INSTDIR yok; listeyle tek tek silme, korumalar, isUpdated kolu değişmedi', () => {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'kurulum.nsh'), 'utf8');
  const kod = nsh.split(/\r?\n/).filter((l) => !l.trim().startsWith(';')).join('\n');
  assert.ok(!/RMDir\s+\/r\s+\$INSTDIR/i.test(kod), 'RMDir /r $INSTDIR kalmamalı');
  assert.ok(!/RMDir\s+\/r/i.test(kod));
  assert.match(kod, /\$\{if\} \$\{isUpdated\}\s+DetailPrint "Güncelleme: eski dosyalar silinmiyor, üzerine yazılacak\."\s+\$\{else\}/);
  assert.match(kod, /\$\{FileExists\} "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/);
  assert.match(kod, /\$R0 <= 3/); // sürücü kökü
  assert.match(kod, /Delete "\$INSTDIR\\\$R5"/);
  assert.match(kod, /RMDir "\$INSTDIR\\\$R5"/);
  assert.match(kod, /onceki-manifest\.json"/);
  assert.match(kod, /temizlik-gunlugu\.txt"/);
  assert.match(kod, /RMDir "\$INSTDIR"\s+ddKaldirmaBitti:/);
  assert.match(kod, /FileReadUTF16LE/);
  assert.match(kod, /Function un\.DDYolGuvenli/);
  // bağ/junction denetimi
  assert.match(kod, /kernel32::GetFileAttributesW\(w "\$R0"\) i \.r0/);
  assert.match(kod, /\$0 == -1/);
  assert.match(kod, /IntOp \$1 \$0 & 0x400/);
  assert.match(kod, /Function un\.DDZincirGuvenli/);
  assert.match(kod, /Push "\$INSTDIR"\s+Call un\.DDDokunulmazMi/);
  assert.match(kod, /Call un\.DDZincirGuvenli[\s\S]*?Delete "\$INSTDIR\\\$R5"/);
  // liste bütünlüğü
  assert.match(kod, /!include "uretilen\/liste-sha\.nsh"/);
  assert.match(kod, /certutil\.exe" -hashfile "\$R0" SHA256/);
  assert.match(kod, /\$\{DD_LISTE_SHA256\}/);
  assert.match(kod, /nsExec::ExecToStack/);
  // ayrılmış adlar ve yalnız-kullanıcı kurulumu
  assert.match(kod, /Function un\.DDAdAyrilmisMi/);
  assert.match(kod, /"NUL"/);
  assert.match(kod, /!macro customInstallMode\s+StrCpy \$isForceCurrentInstall "1"/);
});

test('goreliGecerli: Windows ayrılmış adlarını (uzantılı, büyük/küçük harf duyarsız) reddeder', () => {
  for (const y of ['con', 'CON', 'a/nul.txt', 'a/Prn.tar.gz', 'AUX', 'x/aux.dll', 'com1', 'COM9.txt', 'lpt1', 'a/LPT9.x/b.txt', 'a/con /b', 'COM\u00b9']) {
    assert.equal(goreliGecerli(y), false, y);
  }
  for (const y of ['a/console.txt', 'resources/com10.txt', 'com0', 'lpt', 'a/connect', 'a/b.con', 'resources/app.asar']) {
    assert.equal(goreliGecerli(y), true, y);
  }
});

test('kurulum.nsh: ayrılmış ad kontrolü NSIS dilinde de var; liste-sha.nsh afterPack ile üretilir', async () => {
  const { listeShaYaz } = require('../scripts/manifest-uret');
  const crypto = require('node:crypto');
  const kok = gecici(); const hedef = path.join(gecici(), 'uretilen');
  await manifestUret(kok, '1.0.0');
  const sha = await listeShaYaz(kok, hedef);
  assert.equal(sha, crypto.createHash('sha256').update(fs.readFileSync(path.join(kok, 'resources', 'surum-dosyalar.txt'))).digest('hex'));
  assert.equal(fs.readFileSync(path.join(hedef, 'liste-sha.nsh'), 'utf8'), `!define DD_LISTE_SHA256 "${sha}"\r\n`);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^build\/uretilen\/$/m);
});

test('sabit bağ (hardlink, nlink > 1) olan aday silinmez; dış dosya bozulmaz', async () => {
  const kok = gecici(); const dis = gecici();
  await v1Kur(kok); await v2Kur(kok);
  const hedef = path.join(kok, 'resources', 'eski', 'eski.dll');
  fs.linkSync(hedef, path.join(dis, 'dis-kopya.dll'));
  const r = await calistir(kok);
  assert.equal(r.durum, 'temizlendi');
  assert.ok(var_(kok, 'resources/eski/eski.dll'), 'hardlinkli dosya silinmemeli');
  assert.ok(r.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'sabit-bag'), JSON.stringify(r.atlanan));
  assert.equal(fs.readFileSync(path.join(dis, 'dis-kopya.dll'), 'utf8'), 'ESKI-DLL');
  assert.deepEqual(r.silinen, ['resources/eski/derin/eski2.txt']);
  // son denetim: hash sırasında hardlink oluşturulursa da silinmez
  const kok2 = gecici(); const dis2 = gecici();
  await v1Kur(kok2); await v2Kur(kok2);
  const fs2 = Object.assign(gercekFs(), {
    createReadStream: (p) => {
      const s = fs.createReadStream(p);
      if (p.endsWith('eski.dll')) s.on('end', () => fs.linkSync(p, path.join(dis2, 'sonradan.dll')));
      return s;
    }
  });
  const r2 = await calistir(kok2, { fsImpl: fs2 });
  assert.ok(r2.atlanan.some((a) => a.yol === 'resources/eski/eski.dll' && a.neden === 'sabit-bag'), JSON.stringify(r2));
  assert.ok(var_(kok2, 'resources/eski/eski.dll'));
  assert.equal(fs.readFileSync(path.join(dis2, 'sonradan.dll'), 'utf8'), 'ESKI-DLL');
});

test('fs seçimi: Electron altında original-fs, değilse node:fs (sahte require ile)', () => {
  const sahte = { promises: { lstat: 'o' }, createReadStream: 'o-stream' };
  const istenen = [];
  const gerek = (ad) => { istenen.push(ad); return sahte; };
  assert.equal(fsSec({ electron: '30.0.0' }, gerek), sahte);
  assert.deepEqual(istenen, ['original-fs']);
  const f = varsayilanFs({ electron: '30.0.0' }, gerek);
  assert.equal(f.lstat, 'o');
  assert.equal(f.createReadStream, 'o-stream');
  istenen.length = 0;
  assert.equal(fsSec({}, gerek), fs);
  assert.equal(varsayilanFs({}, gerek).createReadStream, fs.createReadStream);
  assert.deepEqual(istenen, []);
});
