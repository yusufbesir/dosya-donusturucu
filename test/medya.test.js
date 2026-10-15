'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { donustur } = require('../src/donustur');
const y = require('./yardimci');

function is(girdiler, hedef, ciktiKlasoru, secenekler = {}) {
  return { id: 'x', girdiler: Array.isArray(girdiler) ? girdiler : [girdiler], hedef, ciktiKlasoru, secenekler };
}

test('ffmpeg: ses/video uçtan uca dönüştürmeler', { timeout: 180000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const mp3 = path.join(g, 'ses.mp3');
  y.sesUret(mp3, 3);

  await t.test('mp3 -> mpg (siyah ekran, mpeg2video + mp2)', async () => {
    const yuzdeler = [];
    const { ciktilar } = await donustur(is(mp3, 'mpg', c), y.ortam({ ilerleme: (p) => yuzdeler.push(p) }));
    assert.equal(path.basename(ciktilar[0]), 'ses.mpg');
    const b = y.bilgi(ciktilar[0]);
    assert.match(b, /Video: mpeg2video/);
    assert.match(b, /Audio: mp2/);
    assert.ok(Math.abs(y.sureSn(ciktilar[0]) - 3) < 0.6, `süre ${y.sureSn(ciktilar[0])}`);
    assert.ok(y.cozulebilir(ciktilar[0]));
    assert.equal(yuzdeler[yuzdeler.length - 1], 100);
  });

  await t.test('mp3 -> mp2 (MPEG ses)', async () => {
    const { ciktilar } = await donustur(is(mp3, 'mp2', c), y.ortam());
    assert.match(y.bilgi(ciktilar[0]), /Audio: mp2/);
    assert.ok(!/Video:/.test(y.bilgi(ciktilar[0])));
  });

  await t.test('mp3 -> mp4 kapak görseliyle', async () => {
    const kapak = path.join(g, 'kapak.png');
    await y.pngUret(kapak, 301, 199); // tek sayı boyutlar
    const { ciktilar } = await donustur(is(mp3, 'mp4', c, { kapakGorseli: kapak }), y.ortam());
    const b = y.bilgi(ciktilar[0]);
    assert.match(b, /Video: h264.*1280x720/);
    assert.match(b, /Audio: aac/);
    assert.ok(y.cozulebilir(ciktilar[0]));
  });

  await t.test('wav -> mp3, kırpma ve kalite', async () => {
    const wav = path.join(g, 'ses.wav');
    y.sesUret(wav, 3);
    const { ciktilar } = await donustur(is(wav, 'mp3', c, { kalite: 'kucuk', baslangic: '00:00:01', bitis: '00:00:02' }), y.ortam());
    assert.match(y.bilgi(ciktilar[0]), /Audio: mp3/);
    assert.ok(Math.abs(y.sureSn(ciktilar[0]) - 1) < 0.2, `süre ${y.sureSn(ciktilar[0])}`);
  });

  await t.test('mp4 -> gif (iki geçişli palet), mp4 -> mp3 (ses çıkar), mp4 -> webm genişlik', async () => {
    const mp4 = path.join(g, 'video.mp4');
    y.videoUret(mp4, 2);
    const gif = await donustur(is(mp4, 'gif', c, { fps: 8, genislik: 160 }), y.ortam());
    assert.equal(fs.readFileSync(gif.ciktilar[0]).subarray(0, 6).toString('latin1'), 'GIF89a');
    assert.match(y.bilgi(gif.ciktilar[0]), /Video: gif.*160x120/);
    const mp3o = await donustur(is(mp4, 'mp3', c), y.ortam());
    assert.match(y.bilgi(mp3o.ciktilar[0]), /Audio: mp3/);
    const webm = await donustur(is(mp4, 'webm', c, { genislik: 160, kalite: 'kucuk' }), y.ortam());
    assert.match(y.bilgi(webm.ciktilar[0]), /Video: vp9.*160x120/);
    assert.ok(y.cozulebilir(webm.ciktilar[0]));
  });

  await t.test('çalışma sonrası klasörde geçici dosya kalmaz', () => {
    assert.ok(y.ls(c).every((d) => !d.startsWith('.~')), y.ls(c).join(','));
  });
});

test('ffmpeg: aynı dönüştürme iki kez ve paralel -> benzersiz adlar, eskisi bozulmaz', { timeout: 120000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const wav = path.join(g, 'a.wav');
  y.sesUret(wav, 1);
  fs.writeFileSync(path.join(c, 'a.mp3'), 'ESKI-DOSYA');
  const sonuclar = await Promise.all([1, 2, 3].map(() => donustur(is(wav, 'mp3', c), y.ortam())));
  const adlar = sonuclar.map((s) => path.basename(s.ciktilar[0])).sort();
  assert.deepEqual(adlar, ['a (1).mp3', 'a (2).mp3', 'a (3).mp3']);
  assert.equal(fs.readFileSync(path.join(c, 'a.mp3'), 'utf8'), 'ESKI-DOSYA');
  assert.ok(y.ls(c).every((d) => !d.startsWith('.~')));
});

test('ffmpeg: protokol benzeri / "-" ile başlayan dosya adları güvenle işlenir', { timeout: 60000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const tuhaf = path.join(g, '-i concat_x.wav');
  y.sesUret(tuhaf, 1);
  const { ciktilar } = await donustur(is(tuhaf, 'mp3', c), y.ortam());
  assert.ok(fs.statSync(ciktilar[0]).size > 0);
  // göreli '-' yolu cwd'ye göre çözülür
  const eski = process.cwd();
  process.chdir(g);
  try {
    fs.copyFileSync(tuhaf, path.join(g, '-x.wav'));
    const r = await donustur(is('-x.wav', 'mp3', c), y.ortam());
    assert.ok(fs.statSync(r.ciktilar[0]).size > 0);
  } finally { process.chdir(eski); }
});

test('görsel: sharp, bmp/ico (FFmpeg), pdf', { timeout: 120000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const png = path.join(g, 'r.png');
  await y.pngUret(png, 400, 300);

  await t.test('png -> webp / jpg / avif / tiff / gif', async () => {
    const w = await donustur(is(png, 'webp', c, { genislik: 200 }), y.ortam());
    const m = await sharp(w.ciktilar[0]).metadata();
    assert.equal(m.format, 'webp');
    assert.equal(m.width, 200);
    for (const [h, f] of [['jpg', 'jpeg'], ['avif', 'heif'], ['tiff', 'tiff'], ['gif', 'gif']]) {
      const r = await donustur(is(png, h, c), y.ortam());
      assert.equal((await sharp(r.ciktilar[0]).metadata()).format, f, h);
    }
  });

  await t.test('png -> ico (en çok 256 px) ve bmp', async () => {
    const buyuk = path.join(g, 'buyuk.png');
    await y.pngUret(buyuk, 600, 300);
    const r = await donustur(is(buyuk, 'ico', c), y.ortam());
    const b = fs.readFileSync(r.ciktilar[0]);
    assert.deepEqual([...b.subarray(0, 4)], [0, 0, 1, 0]);
    assert.ok(b[6] === 0 || b[6] <= 256); // genişlik 0 = 256
    assert.match(y.bilgi(r.ciktilar[0]), /256x128/);
    const bmp = await donustur(is(png, 'bmp', c), y.ortam());
    assert.equal(fs.readFileSync(bmp.ciktilar[0]).subarray(0, 2).toString('latin1'), 'BM');
    // bmp girdi -> png
    const geri = await donustur(is(bmp.ciktilar[0], 'png', c), y.ortam());
    assert.equal((await sharp(geri.ciktilar[0]).metadata()).width, 400);
  });

  await t.test('svg girdi -> png', async () => {
    const svg = path.join(g, 'f.svg');
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>');
    const r = await donustur(is(svg, 'png', c), y.ortam());
    assert.ok((await sharp(r.ciktilar[0]).metadata()).width >= 40);
  });

  await t.test('png -> pdf; birden çok görsel tekPdf ile tek PDF; webp -> pdf', async () => {
    const r = await donustur(is(png, 'pdf', c), y.ortam());
    const pdf = await PDFDocument.load(fs.readFileSync(r.ciktilar[0]));
    assert.equal(pdf.getPageCount(), 1);
    const jpg = await donustur(is(png, 'jpg', c), y.ortam());
    const webp = await donustur(is(png, 'webp', c), y.ortam());
    const tek = await donustur(is([png, jpg.ciktilar[0], webp.ciktilar[0]], 'pdf', c, { tekPdf: true }), y.ortam());
    assert.equal(tek.ciktilar.length, 1);
    assert.equal((await PDFDocument.load(fs.readFileSync(tek.ciktilar[0]))).getPageCount(), 3);
    const ayri = await donustur(is([png, jpg.ciktilar[0]], 'pdf', c), y.ortam());
    assert.equal(ayri.ciktilar.length, 2);
    const gp = await donustur(is([png, png], 'gorsel-pdf', c, { sayfa: 'a4' }), y.ortam());
    assert.equal((await PDFDocument.load(fs.readFileSync(gp.ciktilar[0]))).getPageCount(), 2);
  });

  await t.test('piksel sınırı korunur (sharp limitInputPixels)', async () => {
    const { PIKSEL_SINIRI } = require('../src/motorlar/gorsel');
    assert.ok(PIKSEL_SINIRI > 0 && PIKSEL_SINIRI < 1e10);
  });
});

test('pdf: birleştir, böl, döndür', { timeout: 60000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const yap = async (ad, n) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < n; i += 1) d.addPage([200 + i, 300]);
    const yol = path.join(g, ad);
    fs.writeFileSync(yol, await d.save());
    return yol;
  };
  const a = await yap('a.pdf', 3);
  const b = await yap('b.pdf', 2);
  const birl = await donustur(is([a, b], 'birlestir', c), y.ortam());
  assert.equal((await PDFDocument.load(fs.readFileSync(birl.ciktilar[0]))).getPageCount(), 5);
  const bol = await donustur(is(birl.ciktilar[0], 'bol', c, { sayfalar: '1-2,5' }), y.ortam());
  assert.equal(bol.ciktilar.length, 1);
  assert.equal((await PDFDocument.load(fs.readFileSync(bol.ciktilar[0]))).getPageCount(), 3);
  const hepsi = await donustur(is(a, 'bol', c), y.ortam());
  assert.equal(hepsi.ciktilar.length, 3);
  const don = await donustur(is(a, 'dondur', c, { aci: 90, sayfalar: '2' }), y.ortam());
  const dp = await PDFDocument.load(fs.readFileSync(don.ciktilar[0]));
  assert.deepEqual(dp.getPages().map((s) => s.getRotation().angle), [0, 90, 0]);
  await assert.rejects(donustur(is(a, 'bol', c, { sayfalar: '9' }), y.ortam()), /Sayfa aralığı/);
  await assert.rejects(donustur(is(a, 'dondur', c, { aci: 45 }), y.ortam()), /90/);
  assert.ok(y.ls(c).every((d) => !d.startsWith('.~')));
});
