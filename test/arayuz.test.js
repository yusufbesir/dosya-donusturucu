'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const D = require('../dogrulama');

const KOK = path.join(__dirname, '..');
const okuMetin = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');

function gecici() {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'arayuz-test-'));
  const dosya = path.join(k, 'a.pdf');
  fs.writeFileSync(dosya, '%PDF-1.4');
  return { k, dosya, temizle: () => fs.rmSync(k, { recursive: true, force: true }) };
}

const hedeflerSahte = (u) => ({
  mp3: [{ hedef: 'wav' }, { hedef: 'mpg' }],
  pdf: [{ hedef: 'docx' }, { hedef: 'txt' }],
  png: [{ hedef: 'jpg' }, { hedef: 'pdf' }]
}[u] || []);

test('sabit indirme adresi yalnız LibreOffice resmi sayfası', () => {
  assert.equal(D.SABIT_INDIRME_URL, 'https://www.libreoffice.org/download/download/');
  const main = okuMetin('main.js');
  const cagrilar = main.match(/shell\.openExternal\([^)]*\)/g) || [];
  assert.deepEqual(cagrilar, ['shell.openExternal(D.SABIT_INDIRME_URL)']);
});

test('izinli yol kümesi: yalnız eklenen mutlak yollar', () => {
  const k = new D.YolKumesi();
  const t = gecici();
  try {
    assert.equal(k.var(t.dosya), false);
    k.ekle(t.dosya);
    assert.equal(k.var(t.dosya), true);
    assert.equal(k.var(path.join(t.k, '.', 'a.pdf')), true, 'normalize edilmeli');
    assert.equal(k.var(path.join(t.k, 'b.pdf')), false);
    k.ekle('goreli/yol.pdf');
    k.ekle(42);
    k.ekle('/x\0y');
    assert.equal(k.boyut, 1, 'geçersiz yollar eklenmez');
  } finally { t.temizle(); }
});

test('girdi yolu: mutlak, izinli ve var olan dosya olmalı', () => {
  const t = gecici();
  try {
    const k = new D.YolKumesi();
    assert.throws(() => D.girdiYoluDogrula(t.dosya, k), /seçilmemiş/);
    k.ekle(t.dosya);
    assert.equal(D.girdiYoluDogrula(t.dosya, k), t.dosya);
    assert.throws(() => D.girdiYoluDogrula('a.pdf', k), /Geçersiz/);
    assert.throws(() => D.girdiYoluDogrula(42, k), /Geçersiz/);
    assert.throws(() => D.girdiYoluDogrula(t.dosya + '\0.txt', k), /Geçersiz/);
    // klasör dosya sayılmaz
    k.ekle(t.k);
    assert.throws(() => D.girdiYoluDogrula(t.k, k), /bulunamadı/);
    // silinmiş dosya
    fs.unlinkSync(t.dosya);
    assert.throws(() => D.girdiYoluDogrula(t.dosya, k), /bulunamadı/);
  } finally { t.temizle(); }
});

test('çıktı klasörü: var olan mutlak klasör', () => {
  const t = gecici();
  try {
    const iz = new D.YolKumesi();
    iz.ekle(t.k); iz.ekle(t.dosya); iz.ekle(path.join(t.k, 'yok'));
    assert.equal(D.ciktiKlasoruDogrula(t.k, iz), t.k);
    assert.throws(() => D.ciktiKlasoruDogrula(t.dosya, iz), /bulunamadı/);
    assert.throws(() => D.ciktiKlasoruDogrula(path.join(t.k, 'yok'), iz), /bulunamadı/);
    assert.throws(() => D.ciktiKlasoruDogrula('goreli', iz), /Geçersiz/);
    assert.throws(() => D.ciktiKlasoruDogrula('', iz), /Geçersiz/);
  } finally { t.temizle(); }
});

test('hedef doğrulama: katalogdaki izinli biçimler ve bilinen işlemler', () => {
  const islemler = D.islemAdlari([{ id: 'gif', hedef: 'gif' }, { id: 'kirp' }]);
  assert.equal(D.hedefDogrula('wav', ['mp3'], hedeflerSahte, islemler), 'wav');
  assert.throws(() => D.hedefDogrula('exe', ['mp3'], hedeflerSahte, islemler), /izinli değil/);
  assert.throws(() => D.hedefDogrula('docx', ['mp3'], hedeflerSahte, islemler), /izinli değil/);
  assert.throws(() => D.hedefDogrula('txt', ['pdf', 'mp3'], hedeflerSahte, islemler), /izinli değil/, 'her girdi için izinli olmalı');
  assert.equal(D.hedefDogrula('birlestir', ['pdf'], hedeflerSahte, islemler), 'birlestir');
  assert.equal(D.hedefDogrula('gif', ['mp4'], hedeflerSahte, islemler), 'gif');
  assert.ok(!islemler.has('kirp'), 'hedefi olmayan işlem adı hedef olarak kabul edilmez');
  for (const kotu of ['../x', 'A', '', 'a b', 'x'.repeat(40), null, 5]) {
    assert.throws(() => D.hedefDogrula(kotu, ['mp3'], hedeflerSahte, islemler), /Geçersiz/);
  }
});

test('seçenekler: bilinmeyen anahtar atılır, değerler denetlenir', () => {
  const k = new D.YolKumesi();
  const c = D.secenekTemizle({ kalite: 'orta', genislik: '1280', baslangic: '00:00:05', bitis: '1:02:03.5', fps: 12, aci: 90, sayfalar: '1-3, 5', zararli: 'x' }, k);
  assert.deepEqual(c, { kalite: 'orta', genislik: 1280, baslangic: '00:00:05', bitis: '1:02:03.5', fps: 12, aci: 90, sayfalar: '1-3, 5' });
  assert.throws(() => D.secenekTemizle({ kalite: 'ultra' }, k));
  assert.throws(() => D.secenekTemizle({ genislik: -5 }, k));
  assert.throws(() => D.secenekTemizle({ aci: 45 }, k));
  assert.throws(() => D.secenekTemizle({ sayfalar: '1; rm -rf' }, k));
  assert.throws(() => D.secenekTemizle({ baslangic: '-ss 5' }, k));
  assert.throws(() => D.secenekTemizle([], k));
  assert.throws(() => D.secenekTemizle({ kapakGorseli: '/etc/passwd' }, k), /seçilmemiş/);
});

test('iş doğrulama: tam akış ve ret durumları', () => {
  const t = gecici();
  try {
    const izinli = new D.YolKumesi();
    const izinliKlasorler = new D.YolKumesi();
    izinliKlasorler.ekle(t.k);
    const ctx = { izinli, izinliKlasorler, id: 'kimlik-1', hedeflerFn: hedeflerSahte, islemKumesi: D.islemAdlari([]) };
    const ham = { girdiler: [t.dosya], hedef: 'docx', ciktiKlasoru: t.k, secenekler: { kalite: 'orta', yabanci: 1 } };
    assert.throws(() => D.isDogrula(ham, ctx), /seçilmemiş/, 'seçilmemiş dosya reddedilir');
    izinli.ekle(t.dosya);
    const is = D.isDogrula(ham, ctx);
    assert.deepEqual(is, { id: 'kimlik-1', girdiler: [t.dosya], hedef: 'docx', ciktiKlasoru: t.k, secenekler: { kalite: 'orta' } });
    assert.throws(() => D.isDogrula({ ...ham, hedef: 'wav' }, ctx), /izinli değil/);
    izinliKlasorler.ekle(path.join(t.k, 'yok'));
    assert.throws(() => D.isDogrula({ ...ham, ciktiKlasoru: path.join(t.k, 'yok') }, ctx), /bulunamadı/);
    assert.throws(() => D.isDogrula({ ...ham, girdiler: [] }, ctx), /girdi/i);
    assert.throws(() => D.isDogrula({ ...ham, girdiler: 'x' }, ctx), /girdi/i);
    assert.throws(() => D.isDogrula(null, ctx), /Geçersiz/);
  } finally { t.temizle(); }
});

test('ayar doğrulama', () => {
  const t = gecici();
  try {
    const izinli = new D.YolKumesi();
    const izinliKlasorler = new D.YolKumesi();
    const ctx = { izinli, izinliKlasorler };
    assert.throws(() => D.ayarDogrula('ciktiKlasoru', t.k, ctx), /seçilmemiş/);
    izinliKlasorler.ekle(t.k);
    assert.equal(D.ayarDogrula('ciktiKlasoru', t.k, ctx), t.k);
    assert.equal(D.ayarDogrula('tema', 'koyu', ctx), 'koyu');
    assert.throws(() => D.ayarDogrula('tema', 'pembe', ctx));
    assert.equal(D.ayarDogrula('esZamanli', 3, ctx), 3);
    assert.throws(() => D.ayarDogrula('esZamanli', 99, ctx));
    assert.equal(D.ayarDogrula('sofficeYolu', '', ctx), '');
    assert.throws(() => D.ayarDogrula('sofficeYolu', t.dosya, ctx), /soffice/);
    const so = path.join(t.k, 'soffice.exe');
    fs.writeFileSync(so, '');
    assert.throws(() => D.ayarDogrula('sofficeYolu', so, ctx), /seçilmemiş/);
    izinli.ekle(so);
    assert.equal(D.ayarDogrula('sofficeYolu', so, ctx), so);
    assert.throws(() => D.ayarDogrula('bilinmeyen', 1, ctx), /Bilinmeyen/);
  } finally { t.temizle(); }
});

test('görsel/metin kaydı yardımcıları', () => {
  assert.ok(D.gorselBicimiGecerli(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0]), 'png'));
  assert.ok(!D.gorselBicimiGecerli(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0]), 'jpg'));
  assert.ok(D.gorselBicimiGecerli(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'jpg'));
  assert.ok(!D.gorselBicimiGecerli(Uint8Array.from([1, 2, 3, 4]), 'png'));
  assert.throws(() => D.veriBaytlari('metin', 10), /Geçersiz/);
  assert.throws(() => D.veriBaytlari(new Uint8Array(0), 10), /boş/);
  assert.throws(() => D.veriBaytlari(new Uint8Array(11), 10), /sınır/);
  assert.equal(D.veriBaytlari(new Uint8Array(5), 10).length, 5);
  const ad = D.guvenliAd('/x/y/../rapor:*?.pdf', '-sayfa-001');
  assert.ok(!/[\\/:*?"<>|]/.test(ad), ad);
  assert.ok(ad.endsWith('-sayfa-001'));
});

test('IPC gönderen denetimi yalnız arayüz sayfasına izin verir', () => {
  const beklenen = 'file:///uygulama/arayuz/index.html';
  assert.ok(D.gonderenGecerli(beklenen, beklenen));
  assert.ok(!D.gonderenGecerli('https://kotu.example/', beklenen));
  assert.ok(!D.gonderenGecerli(undefined, beklenen));
});

test('main.js güvenlik ayarları ve preload yüzeyi', () => {
  const main = okuMetin('main.js');
  for (const s of ['nodeIntegration: false', 'contextIsolation: true', 'sandbox: true', 'devTools: false', 'webSecurity: true',
    'setWindowOpenHandler', "'will-navigate'", 'requestSingleInstanceLock', 'setPermissionRequestHandler', 'onBeforeRequest', 'Menu.setApplicationMenu(null)']) {
    assert.ok(main.includes(s), `main.js içinde ${s} olmalı`);
  }
  assert.ok(!/shell:\s*true|child_process|\bexec\(/.test(main));
  const preload = okuMetin('preload.js');
  const beklenen = ['kategoriler', 'hedefler', 'dosyaSec', 'klasorSec', 'yolAl', 'isEkle', 'iptal', 'tumunuIptal', 'klasordeGoster', 'ayarlarAl',
    'ayarKaydet', 'libreofficeDurumu', 'calibreDurumu', 'libreofficeIndirmeSayfasi', 'pdfOku', 'pdfSayfaKaydet', 'metinKaydet', 'durumDinle'];
  for (const a of beklenen) assert.ok(new RegExp(`\\b${a}:`).test(preload), `preload ${a} sunmalı`);
  assert.ok(!/exposeInMainWorld\('[^']+',\s*(ipcRenderer|require)/.test(preload));
});

test('index.html: satır içi script/stil yok, CSP var', () => {
  const html = okuMetin('arayuz', 'index.html');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp, 'CSP meta bulunmalı');
  assert.equal(csp[1], "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'");
  const scriptler = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scriptler.length >= 1);
  for (const [, nitelik, govde] of scriptler) {
    assert.match(nitelik, /\bsrc="[^"]+"/, 'script dış dosyadan yüklenmeli');
    assert.equal(govde.trim(), '', 'satır içi script yok');
  }
  assert.ok(!/<style\b/i.test(html), '<style> bloğu yok');
  assert.ok(!/\sstyle\s*=/i.test(html), 'style niteliği yok');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'satır içi olay yok');
  assert.ok(!/https?:\/\//i.test(html), 'harici adres yok');
  assert.ok(!/javascript:/i.test(html));
  const css = okuMetin('arayuz', 'stil.css');
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(css), 'CSS harici kaynak yüklememeli');
});

test('menüde tüm kategoriler ve alt öğeler var', () => {
  const html = okuMetin('arayuz', 'index.html');
  const menu = [...html.matchAll(/data-kategori="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(menu, ['video', 'ses', 'gorsel', 'belge', 'ekitap', 'tablo', 'sunum', 'pdf', 'veri', 'arsiv']);
  for (const ad of ['Video', 'Ses', 'Görsel', 'Belge', 'E-kitap', 'Tablo', 'Sunum', 'PDF Araçları', 'Veri', 'Arşiv', 'Geçmiş', 'Ayarlar', 'Hakkında ve Lisanslar']) {
    assert.ok(html.includes(`<span>${ad}</span>`), `${ad} menüde olmalı`);
  }
  for (const s of ['gecmis', 'ayarlar', 'hakkinda']) assert.ok(html.includes(`data-sayfa="${s}"`));
  // Çekirdek katalogla uyum (katalog yazılmışsa)
  let katalog = null;
  try { katalog = require('../src/katalog'); } catch { /* çekirdek yok */ }
  if (katalog) {
    assert.deepEqual(katalog.KATEGORILER.map((k) => k.id), menu);
  }
});

test('arayüz betikleri yazım denetiminden geçer ve harici ağ kullanmaz', () => {
  for (const d of ['uygulama.js', 'pdf-araclari.js']) {
    const kaynak = okuMetin('arayuz', d);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(kaynak), `${d} güvensiz HTML/eval kullanmamalı`);
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(kaynak), `${d} ağ çağrısı yapmamalı`);
  }
  const r = spawnSync(process.execPath, ['--check', path.join(KOK, 'arayuz', 'uygulama.js')]);
  assert.equal(r.status, 0, String(r.stderr));
});

test('pdf-araclari.js: sayfa aralığı ayrıştırma', async () => {
  // Modül tarayıcı için yazıldı; yalnız saf işlevi, import.meta.url ile birlikte yüklenebilir.
  const m = await import(pathToFileUrl(path.join(KOK, 'arayuz', 'pdf-araclari.js')));
  assert.deepEqual(m.sayfaListesi('', 3), [1, 2, 3]);
  assert.deepEqual(m.sayfaListesi('1-3, 5', 6), [1, 2, 3, 5]);
  assert.deepEqual(m.sayfaListesi('5,1,1', 6), [1, 5]);
  assert.throws(() => m.sayfaListesi('0', 6), /içinde olmalı/);
  assert.throws(() => m.sayfaListesi('4-9', 6), /içinde olmalı/);
  assert.throws(() => m.sayfaListesi('3-1', 6), /içinde olmalı/);
  assert.throws(() => m.sayfaListesi('a', 6), /Geçersiz/);
});
function pathToFileUrl(p) { return require('url').pathToFileURL(p).href; }

// Electron'u gerçek ekranda (xvfb) açar; pdf.js ile örnek PDF çizer.
const xvfb = spawnSync('which', ['xvfb-run']);
const electronVar = fs.existsSync(path.join(KOK, 'node_modules', 'electron', 'dist')) || fs.existsSync(path.join(KOK, 'node_modules', '.bin', 'electron'));
const cekirdekHazir = ['katalog'].every((d) => fs.existsSync(path.join(KOK, 'src', d + '.js')));
test('Electron açılış denemesi (xvfb)', { skip: xvfb.status !== 0 ? 'xvfb-run yok' : !electronVar ? 'electron kurulu değil' : !cekirdekHazir ? 'src/ çekirdeği henüz tamam değil' : false, timeout: 60000 }, () => {
  const electron = require(path.join(KOK, 'node_modules', 'electron'));
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'arayuz-smoke-'));
  try {
    const r = spawnSync('xvfb-run', ['-a', electron, '--no-sandbox', `--user-data-dir=${veri}`, KOK], {
      env: { ...process.env, DONUSTURUCU_SMOKE: '1' }, encoding: 'utf8', timeout: 45000
    });
    const cikti = (r.stdout || '') + (r.stderr || '');
    const satir = cikti.split('\n').find((s) => s.startsWith('SMOKE_SONUC '));
    assert.ok(satir, 'açılış sonucu alınamadı:\n' + cikti.slice(-1500));
    const { sonuc, mesajlar } = JSON.parse(satir.slice('SMOKE_SONUC '.length));
    assert.equal(sonuc.api, 'object');
    assert.equal(sonuc.menu, 10);
    assert.equal(sonuc.pdfHata, undefined, 'pdf.js: ' + sonuc.pdfHata);
    assert.equal(sonuc.pdf.sayfa, 1);
    assert.ok(sonuc.metin.includes('Merhaba'));
    const hatalar = mesajlar.filter((m) => /^(error|3)\b|Content Security Policy|Refused/i.test(m));
    assert.deepEqual(hatalar, []);
  } finally { fs.rmSync(veri, { recursive: true, force: true }); }
});
