'use strict';
// Ne: donustur.js planlama/denetim ekleri (karışık seçim, işlem kaynak denetimi, tekilleştirme), PDF birleştirme
//     toplam boyut sınırı, hata metinleri ve görselden PDF gömme (boyut sınırı, JPEG gömme) testleri.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-inceleme]
// Değiştirme kuralı: davranış değişikliğinde kaynakla birlikte güncellenir; silme yalnız Yusuf'un kararıyla (çöp kutusu).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { donustur, planla, tekillestir, FFMPEG_BULUNAMADI } = require('../src/donustur');
const { toplamBoyutDenetle } = require('../src/motorlar/pdf');
const y = require('./yardimci');

function is(girdiler, hedef, ciktiKlasoru = 'C:\\cikti', secenekler = {}) {
  return { id: 'x', girdiler: Array.isArray(girdiler) ? girdiler : [girdiler], hedef, ciktiKlasoru, secenekler };
}

test('planla: karışık seçim (docx + jpg -> pdf) Türkçe hatayla reddedilir', () => {
  assert.throws(() => planla(is(['a.docx', 'b.jpg'], 'pdf')),
    { message: '"b.jpg" dosyasının biçimi (JPG) seçilen kaynak biçimle (DOCX) uyuşmuyor.' });
  assert.throws(() => planla(is(['a.md', 'b.docx'], 'pdf')), /uyuşmuyor/); // markdown ve libreoffice motoru farklı
  // Aynı motora giden farklı uzantılar kabul edilir
  assert.equal(planla(is(['a.docx', 'b.odt'], 'pdf')).motor, 'libreoffice');
  assert.equal(planla(is(['a.png', 'b.jpeg', 'c.webp'], 'pdf')).motor, 'gorsel');
  assert.equal(planla(is(['a.png', 'b.jpg'], 'jpg')).motor, 'gorsel'); // b.jpg aynı biçim yolu
});

test('planla: işlem hedefleri kaynak uzantısını denetler', () => {
  assert.throws(() => planla(is('rapor.docx', 'bol')), { message: 'Bu işlem yalnız PDF dosyaları için: rapor.docx' });
  assert.throws(() => planla(is(['a.pdf', 'b.png'], 'birlestir')), /yalnız PDF dosyaları için: b\.png/);
  assert.throws(() => planla(is('a.png', 'dondur')), /yalnız PDF/);
  assert.throws(() => planla(is(['a.png', 'b.pdf'], 'gorsel-pdf')), /yalnız görsel .* için: b\.pdf/);
  assert.throws(() => planla(is('a.gz', 'zip-ac')), /yalnız ZIP dosyaları için: a\.gz/);
  assert.throws(() => planla(is('a.zip', 'gz-ac')), /yalnız GZIP/);
  assert.equal(planla(is(['A.PDF', 'b.pdf'], 'birlestir')).motor, 'pdf');
  assert.equal(planla(is(['a.png', 'b.JPEG', 'c.bmp'], 'gorsel-pdf')).motor, 'gorsel');
  assert.equal(planla(is(['a.docx', 'b.exe'], 'zip')).motor, 'arsiv'); // zip/gz her dosyayı alır
  assert.equal(planla(is('a.docx', 'gz')).motor, 'arsiv');
});

test('planla: tekil işlemlerde aynı dosya tekilleştirilir, toplu işlemlerde dokunulmaz', () => {
  const p = path.resolve('x', 'a.png');
  const ayni = process.platform === 'win32' ? p.toUpperCase().replace(/\.PNG$/, '.png') : p;
  assert.deepEqual(planla(is([p, ayni, path.resolve('x', 'b.png')], 'jpg')).girdiler, [p, path.resolve('x', 'b.png')]);
  assert.deepEqual(planla(is(['a.pdf', 'a.pdf'], 'bol')).girdiler, ['a.pdf']);
  assert.deepEqual(planla(is(['a.pdf', 'a.pdf'], 'birlestir')).girdiler, ['a.pdf', 'a.pdf']);
  assert.deepEqual(planla(is(['a.png', 'a.png'], 'gorsel-pdf')).girdiler, ['a.png', 'a.png']);
  assert.deepEqual(planla(is(['a.png', 'a.png'], 'pdf', undefined, { tekPdf: true })).girdiler, ['a.png', 'a.png']);
  assert.deepEqual(tekillestir(['a', './a', 'b']), ['a', 'b']);
});

test('planla: SVG/ICO/BMP aynı biçim hata metni', () => {
  for (const u of ['svg', 'ico', 'bmp']) {
    assert.throws(() => planla(is(`a.${u}`, u)),
      { message: `${u.toUpperCase()} üzerinde boyutlandırma/sıkıştırma desteklenmiyor; önce PNG ya da JPG'ye dönüştürün.` });
  }
});

test('donustur: FFmpeg yoksa net hata (ses ve BMP/ICO hedefi)', async () => {
  const g = y.gecici();
  try {
    const png = path.join(g, 'a.png');
    await y.pngUret(png);
    const mp3 = path.join(g, 'a.mp3');
    fs.writeFileSync(mp3, 'x');
    const ortam = { ffmpegYolu: null };
    // ffmpegYolunuBul gerçek kurulumu bulabilir; o yüzden yalnız sabitin metnini ve bulunamazsa davranışı sınarız
    assert.match(FFMPEG_BULUNAMADI, /programı yeniden kurun/);
    assert.doesNotMatch(FFMPEG_BULUNAMADI, /npm/);
    if (!y.ffmpegYolu) {
      await assert.rejects(donustur(is(mp3, 'wav', g), ortam), { message: FFMPEG_BULUNAMADI });
      await assert.rejects(donustur(is(png, 'ico', g), ortam), { message: FFMPEG_BULUNAMADI });
    }
  } finally { y.temizle(g); }
});

test('pdf: birleştirme toplam boyut sınırı (parametreli)', async () => {
  const g = y.gecici();
  try {
    const a = path.join(g, 'a.pdf');
    const b = path.join(g, 'b.pdf');
    fs.writeFileSync(a, Buffer.alloc(6));
    fs.writeFileSync(b, Buffer.alloc(6));
    assert.equal(await toplamBoyutDenetle([a, b], 12), 12);
    await assert.rejects(toplamBoyutDenetle([a, b], 10), /toplam boyutu çok büyük/);
    assert.equal(await toplamBoyutDenetle([a, b]), 12); // varsayılan 512 MB sınırı
  } finally { y.temizle(g); }
});

test('pdf: bozuk PDF için anlaşılır hata', async () => {
  const g = y.gecici();
  const c = y.gecici();
  try {
    const bozuk = path.join(g, 'bozuk.pdf');
    fs.writeFileSync(bozuk, 'bu bir pdf degil');
    await assert.rejects(donustur(is(bozuk, 'bol', c), y.ortam()), /PDF okunamadı; dosya bozuk ya da tamamlanmamış olabilir\. \(bozuk\.pdf: /);
  } finally { y.temizle(g, c); }
});

test('gorsel-pdf: büyük görsel 4000 piksele küçültülür, saydamsız görsel JPEG gömülür', { timeout: 60000 }, async () => {
  const g = y.gecici();
  const c = y.gecici();
  try {
    const webp = path.join(g, 'buyuk.webp');
    await sharp({ create: { width: 5000, height: 1000, channels: 3, background: { r: 10, g: 120, b: 200 } } }).webp().toFile(webp);
    const saydam = path.join(g, 'saydam.png');
    await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } })
      .png({ progressive: true }).toFile(saydam);
    const r = await donustur(is([webp, saydam], 'gorsel-pdf', c), y.ortam());
    const veri = fs.readFileSync(r.ciktilar[0]);
    const pdf = await PDFDocument.load(veri);
    assert.equal(pdf.getPageCount(), 2);
    const [s1] = pdf.getPages();
    assert.equal(Math.round(s1.getWidth()), 3000); // 4000 px * 0.75
    const metin = veri.toString('latin1');
    assert.match(metin, /\/DCTDecode/); // webp (saydamsız) JPEG olarak
    assert.match(metin, /\/SMask/); // saydam PNG maske ile
  } finally { y.temizle(g, c); }
});
