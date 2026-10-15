'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { zipSync, strToU8 } = require('fflate');
const sharp = require('sharp');
const D = require('../dogrulama');
const lo = require('../src/motorlar/libreoffice');
const ffmpeg = require('../src/motorlar/ffmpeg');
const { donustur } = require('../src/donustur');
const y = require('./yardimci');

const KOK = path.join(__dirname, '..');
const okuMetin = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');
const is = (girdiler, hedef, ciktiKlasoru, secenekler = {}) => ({
  id: 'x', girdiler: Array.isArray(girdiler) ? girdiler : [girdiler], hedef, ciktiKlasoru, secenekler,
});

// ---- 1. Çıktı klasörü izinli küme ----
test('çıktı klasörü izinli kümede olmalı (isDogrula ve main.js kanalları)', () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'gvn-'));
  try {
    const dosya = path.join(k, 'a.pdf');
    fs.writeFileSync(dosya, '%PDF');
    const izinli = new D.YolKumesi(); izinli.ekle(dosya);
    const izinliKlasorler = new D.YolKumesi();
    const hedeflerFn = () => [{ hedef: 'txt' }];
    const ctx = { izinli, izinliKlasorler, id: 'i', hedeflerFn, islemKumesi: D.islemAdlari([]) };
    const ham = { girdiler: [dosya], hedef: 'txt', ciktiKlasoru: k };
    assert.throws(() => D.isDogrula(ham, ctx), /çıktı klasörü/i);
    assert.throws(() => D.isDogrula(ham, { ...ctx, izinliKlasorler: undefined }), /çıktı klasörü/i);
    izinliKlasorler.ekle(k);
    assert.equal(D.isDogrula(ham, ctx).ciktiKlasoru, k);
    assert.throws(() => D.ciktiKlasoruDogrula(k), /çıktı klasörü/i, 'küme verilmezse reddedilir');
  } finally { fs.rmSync(k, { recursive: true, force: true }); }

  const main = okuMetin('main.js');
  assert.equal((main.match(/D\.ciktiKlasoruDogrula\(o\.ciktiKlasoru, izinliKlasorler\)/g) || []).length, 2, 'pdf-sayfa-kaydet ve metin-kaydet');
  assert.match(main, /islemKumesi: islemKumesi\(\), izinliKlasorler/);
  // istemciden gelen klasör kümeye otomatik eklenmez
  assert.ok(!/izinliKlasorler\.ekle\((is\.ciktiKlasoru|klasor)\)/.test(main));
  assert.match(main, /izinliKlasorler\.ekle\(varsayilanCikti\(\)\)/);
  assert.match(main, /izinliKlasorler\.ekle\(ayarlar\.ciktiKlasoru\)/);
});

// ---- 2. file:// kısıtı ----
test('dosyaUrlIzinli: yalnız arayuz/ ve pdfjs klasörleri (POSIX)', () => {
  const app = '/opt/uyg';
  const kokler = D.izinliDosyaKokleri(app);
  const izin = (u) => D.istekIzinli(u, kokler, 'linux');
  assert.ok(izin('file:///opt/uyg/arayuz/index.html'));
  assert.ok(izin('file:///opt/uyg/arayuz/index.html?x=1#h'));
  assert.ok(izin('file:///opt/uyg/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs'));
  assert.ok(izin('file:///opt/uyg/node_modules/pdfjs-dist/standard_fonts/a.pfb'));
  assert.ok(izin('file:///opt/uyg/node_modules/pdfjs-dist/cmaps/a.bcmap'));
  assert.ok(izin('file:///opt/uyg/node_modules/pdfjs-dist/wasm/a.wasm'));
  assert.ok(izin('file:///opt/uyg/node_modules/pdfjs-dist/iccs/a.icc'));
  assert.ok(izin('blob:file:///x') && izin('data:image/png;base64,AA'));
  for (const kotu of [
    'file:///etc/passwd', 'file:///opt/uyg/main.js', 'file:///opt/uyg/arayuz/../main.js',
    'file:///opt/uyg/arayuz/%2e%2e/main.js', 'file:///opt/uyg/arayuz/..%2fmain.js',
    'file:///opt/uyg/arayuz-x/a', 'file:///opt/uyg/arayuz', 'file:///opt/uyg/node_modules/pdfjs-dist/legacy/web/viewer.mjs',
    'file:///opt/uyg/node_modules/pdfjs-dist/package.json', 'file://sunucu/paylasim/a.txt',
    'http://127.0.0.1/', 'https://example.com/a', 'ftp://x/y', 'ws://x', 'file:///opt/uyg/arayuz/a%00.txt', 'not a url',
  ]) assert.ok(!izin(kotu), `reddedilmeli: ${kotu}`);
});

test('dosyaUrlIzinli: Windows yolları, büyük/küçük harf duyarsız, UNC reddi', () => {
  const kokler = D.izinliDosyaKokleri('C:\\Program Files\\App\\resources\\app.asar');
  const izin = (u) => D.istekIzinli(u, kokler, 'win32');
  assert.ok(izin('file:///C:/Program%20Files/App/resources/app.asar/arayuz/index.html'));
  assert.ok(izin('file:///c:/program%20files/APP/resources/app.asar/ARAYUZ/stil.css'));
  assert.ok(izin('file:///C:/Program%20Files/App/resources/app.asar/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'));
  for (const kotu of [
    'file:///C:/Windows/win.ini', 'file://sunucu/paylasim/a.txt', 'file:////sunucu/paylasim/a.txt',
    'file://sunucu/C:/Program%20Files/App/resources/app.asar/arayuz/index.html',
    'file:///C:/Program%20Files/App/resources/app.asar/arayuz/..%5C..%5Cx.txt',
    'file:///C:/Program%20Files/App/resources/app.asar/main.js', 'file:///D:/arayuz/index.html',
  ]) assert.ok(!izin(kotu), `reddedilmeli: ${kotu}`);
  assert.match(okuMetin('main.js'), /D\.istekIzinli\(d\.url, kokler\)/);
});

// ---- 3. LibreOffice ağ ----
test('libreoffice: htmlTemizle uzak adresleri, link/script etiketlerini temizler', () => {
  const h = lo.htmlTemizle([
    '<img src=http://x/a.png><img src="HTTPS://x/b"><img src=\'//h/a\'><a href="\\\\srv\\paylasim\\a">k</a>',
    '<link rel=stylesheet href=a.css><link rel="icon" href="y.ico"><script src=x.js></script><script>alert(1)</script>',
    '<body background="ftp://a/b"><video poster="file:///etc/passwd"><img srcset="http://a/1.png 1x, yerel.png 2x">',
    '<style>@import url(http://e/x.css); @import "ftp://z/q.css"; p{background:url("file:///etc/x")} q{background:url(//h/i.png)} r{background:url(yerel.png)}</style>',
    '<img src="&#104;ttp://z/a"><img src="ht&#x74;ps://z/a"><img src=yerel.png>',
  ].join('\n'));
  assert.ok(!/https?:|ftp:|file:|\/\/h\/|srv|<script|stylesheet|alert|passwd|ttp:/i.test(h), h);
  assert.match(h, /yerel\.png 2x/);
  assert.match(h, /url\(yerel\.png\)/);
  assert.match(h, /rel="icon"/);
  assert.match(h, /<img src=yerel\.png>/);
});

test('libreoffice: profil xcu ağı (proxy 127.0.0.1:9) keser', () => {
  const x = lo.agKapatXcu();
  assert.match(x, /oor:path="\/org\.openoffice\.Inet\/Settings"/);
  assert.match(x, /ooInetProxyType"[^>]*><value>1</);
  for (const a of ['HTTP', 'HTTPS', 'FTP']) {
    assert.match(x, new RegExp(`ooInet${a}ProxyName"[^>]*><value>127\\.0\\.0\\.1<`));
    assert.match(x, new RegExp(`ooInet${a}ProxyPort"[^>]*><value>9<`));
  }
  assert.match(x, /ooInetNoProxy"[^>]*><value><\/value>/);
});

test('libreoffice: html -> docx uzak kaynağa hiç istek atmaz', { timeout: 300000, skip: !y.sofficeYolu }, async (t) => {
  const istekler = [];
  const sunucu = http.createServer((q, r) => { istekler.push(q.url); r.statusCode = 404; r.end(); });
  await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
  const port = sunucu.address().port;
  const g = y.gecici(); const c = y.gecici();
  t.after(() => { sunucu.close(); y.temizle(g, c); });
  const html = path.join(g, 'sayfa.html');
  fs.writeFileSync(html, `<html><head><link rel=stylesheet href="http://127.0.0.1:${port}/s.css">` +
    `<style>@import url(http://127.0.0.1:${port}/i.css); p{background:url(http://127.0.0.1:${port}/bg.png)}</style></head>` +
    `<body><p>Merhaba</p><img src=http://127.0.0.1:${port}/x.png><img src="//127.0.0.1:${port}/y.png"></body></html>`);
  const r = await donustur(is(html, 'docx', c, { zamanAsimi: 240000 }), y.ortam());
  assert.ok(fs.existsSync(r.ciktilar[0]));
  await new Promise((s) => setTimeout(s, 500));
  assert.deepEqual(istekler, [], 'sunucuya istek gelmemeli');
  assert.ok(fs.readFileSync(html, 'utf8').includes('http://127.0.0.1'), 'özgün dosya değişmez');
});

// ---- 4. CSP ----
test('index.html CSP: base-uri, form-action, frame-src, object-src kapalı', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(okuMetin('arayuz', 'index.html'))[1];
  for (const d of ["base-uri 'none'", "form-action 'none'", "frame-src 'none'", "object-src 'none'"]) assert.ok(csp.includes(d), d);
});

// ---- 5. sofficeYolu adı ----
test('main.js: ayarlar.json sofficeYolu ad denetiminden geçer', () => {
  assert.ok(D.sofficeAdiGecerli('C:\\Program Files\\LibreOffice\\program\\soffice.exe'));
  assert.ok(D.sofficeAdiGecerli('/usr/bin/soffice'));
  assert.ok(!D.sofficeAdiGecerli('C:\\Windows\\System32\\cmd.exe'));
  assert.ok(!D.sofficeAdiGecerli('/bin/sh'));
  assert.match(okuMetin('main.js'), /D\.sofficeAdiGecerli\(k\.sofficeYolu\)/);
  assert.throws(() => D.ayarDogrula('sofficeYolu', '/bin/sh', { izinli: new D.YolKumesi() }), /soffice/);
});

// ---- 6. ffmpeg-indir ----
test('ffmpeg-indir: kullanıcı bilgisi reddi, curl doğrulanmış href alır', () => {
  const { adresiDenetle } = require('../scripts/ffmpeg-indir');
  assert.throws(() => adresiDenetle('https://kullanici:parola@github.com/x'), /Kullanıcı bilgisi/);
  assert.throws(() => adresiDenetle('https://kullanici@github.com/x'), /Kullanıcı bilgisi/);
  assert.equal(adresiDenetle('https://github.com/a/b').href, 'https://github.com/a/b');
  const kod = okuMetin('scripts', 'ffmpeg-indir.js');
  assert.match(kod, /dogrulanmis\.href\]/);
  assert.ok(!/redirect_url\}', simdiki\]/.test(kod));
});

// ---- 7. ffmpeg girdi güvenliği, sharp SVG ----
test('ffmpeg: her -i öncesine protocol_whitelist ve format_whitelist eklenir; concat yok', () => {
  const a = ffmpeg.girdiGuvenligi(['-loop', '1', '-i', 'file:a.png', '-f', 'lavfi', '-i', 'anullsrc', '-i', 'file:b.mp3', 'cikti']);
  assert.deepEqual(a.slice(0, 2), ['-loop', '1']);
  assert.equal(a.filter((x) => x === '-protocol_whitelist').length, 3);
  assert.equal(a.filter((x) => x === '-format_whitelist').length, 2, 'lavfi girdisi hariç');
  for (let i = 0; i < a.length; i += 1) if (a[i] === '-i') assert.equal(a[i - 2] === '-format_whitelist' || a[i - 2] === '-f' || a[i - 2] === '-protocol_whitelist', true);
  assert.ok(!ffmpeg.IZINLI_DEMUXERLAR.split(',').some((d) => /concat/.test(d)));
});

test('ffmpeg: ffconcat içerikli sahte .mp4 dış dosyayı okutmaz', { timeout: 60000, skip: !y.ffmpegYolu }, async (t) => {
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const gercek = path.join(g, 'gizli.wav');
  y.ffmpegCalistir(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', gercek]);
  const sahte = path.join(g, 'sahte.mp4');
  fs.writeFileSync(sahte, 'ffconcat version 1.0\nfile gizli.wav\n');
  await assert.rejects(donustur(is(sahte, 'mp3', c), y.ortam()), /FFmpeg hatası/);
  assert.deepEqual(y.ls(c), []);
  // Karşılaştırma: korumasız FFmpeg bu dosyayı concat olarak açar (davranış belgesi)
  const korumasiz = require('node:child_process').spawnSync(y.ffmpegYolu, ['-hide_banner', '-i', `file:${sahte}`, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.match(korumasiz.stderr, /Input #0, concat/);
});

test('sharp: SVG Buffer üzerinden açılır, göreli kardeş dosya yüklenmez', { timeout: 60000 }, async (t) => {
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const kirmizi = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ff0000' } }).png().toBuffer();
  fs.writeFileSync(path.join(g, 'kardes.png'), kirmizi);
  const svg = path.join(g, 'a.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40">' +
    '<rect width="40" height="40" fill="#ffffff"/><image href="kardes.png" width="40" height="40"/></svg>');
  const r = await donustur(is(svg, 'png', c), y.ortam());
  const { data } = await sharp(r.ciktilar[0]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240, `kardeş görsel yüklenmemeli, piksel ${[...data.slice(0, 3)]}`);
  assert.match(okuMetin('src', 'motorlar', 'gorsel.js'), /sharp\(fs\.readFileSync\(girdi\), secenek\)/);
});

// ---- 8. arşiv ----
test('arşiv: klasör girişleri dosya sayısına dahil, varsayılan boyut sınırı 2 GB', async (t) => {
  const g = y.gecici(); const a = y.gecici();
  t.after(() => y.temizle(g, a));
  const zip = path.join(g, 'klasorler.zip');
  fs.writeFileSync(zip, zipSync({ 'k1/': new Uint8Array(0), 'k2/': new Uint8Array(0), 'k3/': new Uint8Array(0) }));
  await assert.rejects(donustur(is(zip, 'zip-ac', path.join(a, 'out'), { maksDosya: 2 }), y.ortam()), /fazla dosya/);
  const ok = fs.mkdtempSync(path.join(a, 'ok-'));
  await donustur(is(zip, 'zip-ac', ok, { maksDosya: 3 }), y.ortam());
  assert.match(okuMetin('src', 'motorlar', 'arsiv.js'), /VARSAYILAN_MAKS_BOYUT = 2 \* 1024 \* 1024 \* 1024/);
  assert.equal(strToU8('x').length, 1);
});
