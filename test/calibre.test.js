'use strict';
// Ne: Gömülü Calibre (ebook-convert) motoru ve e-kitap kataloğu testleri. Sahibi: Dosya dönüştürücü işi.
// Değiştirme kuralı: biçim listesi değişirse kullanıcı kararıyla ve bu testler güncellenerek yapılır.
// Gerçek dönüşüm testi yalnız ebook-convert bulunursa (vendor/calibre Windows'ta ya da PATH'te) çalışır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const katalog = require('../src/katalog');
const cal = require('../src/motorlar/calibre');
const { donustur } = require('../src/donustur');
const y = require('./yardimci');

const EKITAP = ['epub', 'mobi', 'azw3', 'fb2'];
const HEDEFLER = ['epub', 'mobi', 'azw3', 'fb2', 'pdf', 'docx', 'txt', 'htmlz', 'rtf'];
const ebookConvert = cal.ebookConvertBul({ gomuluKlasor: path.join(__dirname, '..', 'vendor') });

test('calibre: e-kitap biçimleri katalogda ve ekitap kategorisinde', () => {
  for (const u of [...EKITAP, 'htmlz']) assert.equal(katalog.BICIMLER[u].kategori, 'ekitap', u);
  assert.deepEqual(katalog.EKITAP_HEDEF, HEDEFLER);
});

test('calibre: epub/mobi/azw3/fb2 -> diğer hedefler calibre motoruyla, hepsi ekitap kategorisinde, kaynak hedef değil', () => {
  for (const k of EKITAP) {
    const h = katalog.hedefler(k);
    assert.deepEqual(h.map((x) => x.hedef), HEDEFLER.filter((x) => x !== k), k);
    for (const x of h) { assert.equal(x.motor, 'calibre'); assert.equal(x.kategori, 'ekitap'); assert.ok(x.etiket); }
  }
});

test('calibre: belgeden mobi/azw3/fb2 calibre ile, epub LibreOffice ile kalır; .doc, md ve pdf Calibre\'ye gitmez', () => {
  for (const k of ['docx', 'odt', 'rtf', 'txt', 'html', 'htm']) {
    const h = katalog.hedefler(k);
    for (const hd of ['mobi', 'azw3', 'fb2']) {
      const o = h.find((x) => x.hedef === hd);
      assert.ok(o, `${k} -> ${hd}`); assert.equal(o.motor, 'calibre'); assert.equal(o.kategori, 'ekitap');
    }
    assert.equal(h.find((x) => x.hedef === 'epub').motor, 'libreoffice');
  }
  assert.ok(!katalog.hedefler('doc').some((x) => x.motor === 'calibre'));
  for (const k of ['md', 'pdf', 'xlsx', 'pptx', 'mp3', 'png']) assert.ok(!katalog.hedefler(k).some((x) => x.motor === 'calibre'), k);
  assert.equal(katalog.islemler('ekitap').length, 0);
});

test('calibre: argümanlar girdi/çıktı + hedefe özel seçenekler, kabuk kullanılmaz', () => {
  assert.deepEqual(cal.argumanlar('/a/girdi.epub', '/a/cikti.mobi', 'mobi'), ['/a/girdi.epub', '/a/cikti.mobi']);
  const pdf = cal.argumanlar('g.epub', 'c.pdf', 'pdf', { baslik: 'Ad; rm -rf /', yazar: 'Y' });
  assert.deepEqual(pdf.slice(0, 2), ['g.epub', 'c.pdf']);
  assert.ok(pdf.includes('--title') && pdf.includes('Ad; rm -rf /') && pdf.includes('--paper-size'));
  assert.ok(cal.argumanlar('g.epub', 'c.txt', 'txt').includes('--txt-output-encoding'));
});

test('calibre: iş ortamı ayar/geçici/önbellek klasörlerini işe yönlendirir ve ağı kapatır', () => {
  const o = cal.isOrtami('/is/k', { PATH: '/bin', CALIBRE_CONFIG_DIRECTORY: '/kullanici/calibre' });
  assert.equal(o.PATH, '/bin');
  assert.equal(o.CALIBRE_CONFIG_DIRECTORY, path.join('/is/k', 'ayar'));
  assert.equal(o.CALIBRE_TEMP_DIR, path.join('/is/k', 'gecici'));
  assert.equal(o.CALIBRE_CACHE_DIRECTORY, path.join('/is/k', 'onbellek'));
  assert.equal(o.HTTPS_PROXY, 'http://127.0.0.1:9');
});

test('calibre: DRM hatası Türkçe, diğer hatalar özetlenir', () => {
  assert.equal(cal.hataMetni(1, '', 'calibre.ebooks.DRMError: This book is locked by DRM'), cal.DRM_HATASI);
  const m = cal.hataMetni(2, '', 'Traceback (most recent call last):\n  File "x.py"\nValueError: bozuk dosya');
  assert.match(m, /^Calibre dönüştüremedi \(kod 2\): /);
  assert.ok(m.includes('ValueError: bozuk dosya') && !m.includes('Traceback'));
});

test('calibre: ebook-convert adayları yalnız gömülü klasörden (Windows) ya da PATH\'ten; yoksa boş', () => {
  const g = y.gecici();
  assert.deepEqual(cal.ebookConvertAdaylari({ platform: 'win32', env: { PATH: '' }, gomuluKlasor: g }), []);
  fs.mkdirSync(path.join(g, 'calibre'));
  fs.writeFileSync(path.join(g, 'calibre', 'ebook-convert.exe'), 'x');
  assert.deepEqual(cal.ebookConvertAdaylari({ platform: 'win32', env: { PATH: '' }, gomuluKlasor: g }), [path.join(g, 'calibre', 'ebook-convert.exe')]);
  y.temizle(g);
});

test('calibre: ebook-convert yoksa anlaşılır hata (epub -> mobi), doğrulanamadıysa imza açıklaması', async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const epub = path.join(g, 'k.epub');
  fs.writeFileSync(epub, 'PK');
  await assert.rejects(
    donustur({ id: 'x', girdiler: [epub], hedef: 'mobi', ciktiKlasoru: g, secenekler: {} }, y.ortam({ ebookConvertYolu: null, calibreAramaYok: true })),
    (e) => e.message === cal.CALIBRE_BULUNAMADI);
  await assert.rejects(
    donustur({ id: 'x', girdiler: [epub], hedef: 'azw3', ciktiKlasoru: g, secenekler: {} }, y.ortam({ ebookConvertYolu: null, calibreAramaYok: true, calibreDurumu: 'dogrulanamadi' })),
    (e) => e.message === cal.CALIBRE_DOGRULANAMADI);
});

test('calibre: desteklenmeyen çift reddedilir (epub -> mp3, png -> mobi)', async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const epub = path.join(g, 'k.epub'); fs.writeFileSync(epub, 'PK');
  const png = path.join(g, 'r.png'); fs.writeFileSync(png, 'x');
  await assert.rejects(donustur({ id: 'x', girdiler: [epub], hedef: 'mp3', ciktiKlasoru: g, secenekler: {} }, y.ortam({})), /desteklenmiyor/);
  await assert.rejects(donustur({ id: 'x', girdiler: [png], hedef: 'mobi', ciktiKlasoru: g, secenekler: {} }, y.ortam({})), /desteklenmiyor/);
});

test('calibre: txt -> mobi -> azw3 gerçek dönüşüm (ebook-convert varsa)', { timeout: 600000, skip: !ebookConvert }, async (t) => {
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const txt = path.join(g, 'kitap.txt');
  fs.writeFileSync(txt, 'Merhaba dünya, şğüöçı İ\n\nİkinci paragraf\n');
  const r1 = await donustur({ id: 'x', girdiler: [txt], hedef: 'mobi', ciktiKlasoru: c, secenekler: {} }, y.ortam({ ebookConvertYolu: ebookConvert }));
  assert.equal(path.basename(r1.ciktilar[0]), 'kitap.mobi');
  const r2 = await donustur({ id: 'x', girdiler: [r1.ciktilar[0]], hedef: 'azw3', ciktiKlasoru: c, secenekler: {} }, y.ortam({ ebookConvertYolu: ebookConvert }));
  assert.equal(path.basename(r2.ciktilar[0]), 'kitap.azw3');
  assert.ok(fs.statSync(r2.ciktilar[0]).size > 0);
});
