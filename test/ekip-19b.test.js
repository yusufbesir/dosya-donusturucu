'use strict';
// Ne: TaaDön 1.9.0 paket B testleri: KEPUB hedefi, LibreOffice ısıtma (isit), önizleme (onizleme.js). Sahibi: Dosya dönüştürücü işi.
// yazan: [Claude#taadon-1.9-paket-b 2026-11-04]. Değiştirme kuralı: yalnız kendi mkdtemp klasörlerinde çalışır; silme yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const katalog = require('../src/katalog');
const cal = require('../src/motorlar/calibre');
const lo = require('../src/motorlar/libreoffice');
const { onizle } = require('../src/motorlar/onizleme');
const { donustur } = require('../src/donustur');
const y = require('./yardimci');

const ebookConvert = cal.ebookConvertBul({ gomuluKlasor: path.join(__dirname, '..', 'vendor') });
const SOFFICE = y.sofficeYolu || lo.sofficeBul({ gomuluKlasor: path.join(__dirname, '..', 'vendor') });
const OPS = { skip: !ebookConvert && 'ebook-convert yok' };

test('kepub: argümanlar kobo profili, katalogda hedef ve etiket', () => {
  const a = cal.argumanlar('g.epub', 'c.epub', 'kepub', {}, 'x.epub');
  assert.deepEqual(a.slice(0, 2), ['g.epub', 'c.epub']);
  assert.ok(a.join(' ').includes('--output-profile kobo'));
  assert.ok(!cal.argumanlar('g.epub', 'c.epub', 'epub', {}, 'x.epub').includes('--output-profile'));
  assert.equal(cal.ciktiUzantisi('kepub'), 'epub');
  assert.ok(cal.CIKTILAR.includes('kepub'));
  const h = katalog.hedefler('epub').find((x) => x.hedef === 'kepub');
  assert.ok(h); assert.equal(h.etiket, 'KEPUB (Kobo)'); assert.equal(h.motor, 'calibre'); assert.equal(h.kategori, 'ekitap');
});

test('kepub: mobi -> ad.kepub.epub üretilir ve PK imzalıdır', OPS, async () => {
  const k = y.gecici();
  try {
    const kaynak = path.join(k, 'kitap.txt'); fs.writeFileSync(kaynak, 'Merhaba.\n\nIkinci.\n');
    const [epub] = (await donustur({ girdiler: [kaynak], hedef: 'mobi', ciktiKlasoru: k }, y.ortam({ ebookConvertYolu: ebookConvert }))).ciktilar;
    const r = await donustur({ girdiler: [epub], hedef: 'kepub', ciktiKlasoru: path.join(k, 'cikti') }, y.ortam({ ebookConvertYolu: ebookConvert }));
    assert.equal(r.ciktilar.length, 1);
    assert.ok(r.ciktilar[0].endsWith('.kepub.epub'), r.ciktilar[0]);
    assert.deepEqual([...fs.readFileSync(r.ciktilar[0]).subarray(0, 2)], [0x50, 0x4b]);
  } finally { y.temizle(k); }
});

test('isit: şablon yoksa üretir, varsa dokunmaz (soffice varsa)', { skip: !SOFFICE && 'soffice yok', timeout: 240000 }, async () => {
  const k = y.gecici();
  try {
    const sablon = path.join(k, 'sablon');
    const gecici = path.join(k, 'gecici'); fs.mkdirSync(gecici);
    const ilk = await lo.isit({ sofficeYolu: SOFFICE, profilSablonu: sablon, geciciKlasor: gecici });
    assert.equal(ilk.durum, 'hazirlandi');
    assert.ok(lo.sablonHazirMi(sablon));
    assert.equal((await lo.isit({ sofficeYolu: SOFFICE, profilSablonu: sablon, geciciKlasor: gecici })).durum, 'zaten');
    assert.equal((await lo.isit({})).durum, 'atlandi');
  } finally { y.temizle(k); }
});

test('onizle: png/jpg küçülür, pdf sayfa metni, epub kapağı, diğerleri null', async () => {
  const k = y.gecici();
  try {
    const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#d33' } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#3a3' } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(k, 'a.png'), png); fs.writeFileSync(path.join(k, 'b.jpg'), jpg);
    const p = await onizle(path.join(k, 'a.png'), { enBuyukKenar: 160 });
    const pm = await sharp(p.veri).metadata();
    assert.equal(p.mime, 'image/png'); assert.equal(pm.width, 160); assert.equal(pm.height, 80);
    const j = await onizle(path.join(k, 'b.jpg'));
    assert.equal((await sharp(j.veri).metadata()).height, 160);

    const doc = await PDFDocument.create(); doc.addPage(); doc.addPage(); doc.addPage();
    fs.writeFileSync(path.join(k, 'c.pdf'), await doc.save());
    assert.deepEqual(await onizle(path.join(k, 'c.pdf')), { metin: '3 sayfa' });

    const opf = '<package><metadata><meta name="cover" content="kapak"/></metadata><manifest><item id="kapak" href="img/on.png" media-type="image/png"/></manifest></package>';
    fs.writeFileSync(path.join(k, 'd.epub'), zipSync({
      mimetype: strToU8('application/epub+zip'), 'OEBPS/content.opf': strToU8(opf), 'OEBPS/img/on.png': new Uint8Array(png),
    }));
    const e = await onizle(path.join(k, 'd.epub'));
    assert.equal((await sharp(e.veri).metadata()).width, 160);
    fs.writeFileSync(path.join(k, 'e.epub'), zipSync({ 'x/cover.jpg': new Uint8Array(jpg) }));
    assert.ok((await onizle(path.join(k, 'e.epub'))).veri);
    fs.writeFileSync(path.join(k, 'f.epub'), zipSync({ 'x.txt': strToU8('yok') }));
    assert.equal(await onizle(path.join(k, 'f.epub')), null);

    fs.writeFileSync(path.join(k, 'g.docx'), 'x');
    assert.equal(await onizle(path.join(k, 'g.docx')), null);
    assert.equal(await onizle(path.join(k, 'yok.png')), null);
    fs.writeFileSync(path.join(k, 'bozuk.png'), 'degil');
    assert.equal(await onizle(path.join(k, 'bozuk.png')), null);
  } finally { y.temizle(k); }
});
