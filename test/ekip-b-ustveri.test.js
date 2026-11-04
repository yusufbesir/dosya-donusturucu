'use strict';
// Ne: "Üst veriyi temizle" (gizlilik) testleri: görsel EXIF kanıtı, PDF Info/XMP temizliği, ayar doğrulaması,
//     LibreOffice RemovePersonalInfo anahtarı ve (soffice varsa) gerçek docx -> docx denemesi.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-ekip-b 2026-11-04]
// Değiştirme kuralı: davranış değişikliğinde kaynakla birlikte güncellenir; silme yalnız Yusuf'un kararıyla (çöp kutusu).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument, PDFName } = require('pdf-lib');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { donustur } = require('../src/donustur');
const pdfMotor = require('../src/motorlar/pdf');
const lo = require('../src/motorlar/libreoffice');
const { ayarDogrula } = require('../dogrulama');
const y = require('./yardimci');
const SOFFICE = y.sofficeYolu || lo.sofficeBul({ gomuluKlasor: path.join(__dirname, '..', 'vendor') });

test('gorsel: sharp çıktıda EXIF taşımaz (withMetadata çağrılmıyor)', async (t) => {
  const d = y.gecici();
  t.after(() => y.temizle(d));
  const kaynak = path.join(d, 'a.jpg');
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#a33' } })
    .withExif({ IFD0: { Copyright: 'GIZLI-TELIF', Artist: 'GIZLI-YAZAR' } }).jpeg().toFile(kaynak);
  const once = await sharp(kaynak).metadata();
  assert.ok(once.exif && once.exif.length > 0, 'örnek EXIF içermeli');
  assert.ok(fs.readFileSync(kaynak).includes('GIZLI-YAZAR'));
  const cikti = path.join(d, 'cikti');
  const s = await donustur({ id: 'x', girdiler: [kaynak], hedef: 'png', ciktiKlasoru: cikti, secenekler: {}, ustVeriTemizle: true }, y.ortam());
  const sonra = await sharp(s.ciktilar[0]).metadata();
  assert.equal(sonra.exif, undefined);
  assert.ok(!fs.readFileSync(s.ciktilar[0]).includes('GIZLI-YAZAR'));
  const s2 = await donustur({ id: 'y', girdiler: [kaynak], hedef: 'webp', ciktiKlasoru: cikti, secenekler: {} }, y.ortam());
  assert.equal((await sharp(s2.ciktilar[0]).metadata()).exif, undefined);
});

async function ornekPdf(yol) {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]); doc.addPage([200, 200]);
  doc.setTitle('Gizli Başlık'); doc.setAuthor('Gizli Yazar'); doc.setSubject('Gizli Konu');
  doc.setKeywords(['gizli', 'anahtar']); doc.setCreator('KalemX'); doc.setProducer('UreticiX');
  const xmp = doc.context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/">GIZLI-XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
  fs.writeFileSync(yol, await doc.save());
}

test('pdf: ustVeriTemizle Info ve XMP bilgisini siler, sayfa sayısı korunur', async (t) => {
  const d = y.gecici();
  t.after(() => y.temizle(d));
  const p = path.join(d, 'a.pdf');
  await ornekPdf(p);
  const oncekiTarih = (await PDFDocument.load(fs.readFileSync(p), { updateMetadata: false })).getCreationDate();
  await pdfMotor.ustVeriTemizle(p);
  const b = fs.readFileSync(p);
  assert.equal(b.subarray(0, 4).toString(), '%PDF');
  const doc = await PDFDocument.load(b, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getTitle() || '', '');
  assert.equal(doc.getAuthor() || '', '');
  assert.equal(doc.getSubject() || '', '');
  assert.equal(doc.getKeywords() || '', '');
  assert.equal(doc.getProducer(), 'TaaDön');
  assert.equal(doc.getCreator(), 'TaaDön');
  assert.equal(doc.catalog.get(PDFName.of('Metadata')), undefined);
  assert.equal(doc.getCreationDate()?.getTime(), oncekiTarih?.getTime());
  assert.ok(!b.includes(Buffer.from('GIZLI-XMP')));
  assert.deepEqual(fs.readdirSync(d), ['a.pdf']); // geçici dosya kalmadı
});

test('donustur: ustVeriTemizle bayrağı (is ya da ortam) PDF çıktısını temizler, kapalıyken dokunmaz', async (t) => {
  const d = y.gecici();
  t.after(() => y.temizle(d));
  const p = path.join(d, 'k.pdf');
  await ornekPdf(p);
  const calistir = async (ad, isEk, ortEk) => {
    const s = await donustur({ id: ad, girdiler: [p], hedef: 'dondur', ciktiKlasoru: path.join(d, ad), secenekler: { aci: 90 }, ...isEk }, y.ortam(ortEk));
    return PDFDocument.load(fs.readFileSync(s.ciktilar[0]), { updateMetadata: false });
  };
  assert.equal((await calistir('kapali', {}, {})).getAuthor(), 'Gizli Yazar');
  assert.equal((await calistir('is', { ustVeriTemizle: true }, {})).getAuthor() || '', '');
  const o = await calistir('ortam', {}, { ustVeriTemizle: true });
  assert.equal(o.getAuthor() || '', '');
  assert.equal(o.catalog.get(PDFName.of('Metadata')), undefined);
  assert.equal(o.getPageCount(), 2);
  assert.equal((await calistir('metin', { ustVeriTemizle: 'true' }, {})).getAuthor(), 'Gizli Yazar'); // yalnız === true geçerli
});

test('ayarDogrula: ustVeriTemizle yalnız boolean kabul eder', () => {
  assert.equal(ayarDogrula('ustVeriTemizle', true, {}), true);
  assert.equal(ayarDogrula('ustVeriTemizle', false, {}), false);
  for (const k of ['true', 1, 0, null, undefined, 'false']) assert.throws(() => ayarDogrula('ustVeriTemizle', k, {}), /Geçersiz değer/);
});

test('libreoffice: RemovePersonalInfo anahtarı yalnız bayrak açıkken profile yazılır', () => {
  assert.ok(!/RemovePersonalInfo/.test(lo.agKapatXcu()));
  assert.ok(!/RemovePersonalInfo/.test(lo.agKapatXcu({ ustVeriTemizle: false })));
  const x = lo.agKapatXcu({ ustVeriTemizle: true });
  assert.match(x, /oor:path="\/org\.openoffice\.Office\.Common\/Security\/Scripting"><prop oor:name="RemovePersonalInfoOnSaving" oor:op="fuse"><value>true<\/value>/);
});

test('libreoffice: gerçek soffice docx -> docx, ustVeriTemizle ile dc:creator boş', { timeout: 240000, skip: !SOFFICE }, async (t) => {
  const d = y.gecici();
  t.after(() => y.temizle(d));
  const txt = path.join(d, 'm.txt');
  fs.writeFileSync(txt, 'Merhaba dünya');
  const s = await donustur({ id: 'x', girdiler: [txt], hedef: 'docx', ciktiKlasoru: path.join(d, 'o1'), secenekler: {} }, y.ortam({ sofficeYolu: SOFFICE }));
  const dosyalar = unzipSync(fs.readFileSync(s.ciktilar[0]));
  const core = dosyalar['docProps/core.xml'];
  dosyalar['docProps/core.xml'] = strToU8(strFromU8(core).replace(/<dc:creator>[^<]*<\/dc:creator>|<dc:creator\/>/, '<dc:creator>GIZLI-YAZAR</dc:creator>')
    .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>GIZLI-YAZAR</cp:lastModifiedBy>'));
  const kaynak = path.join(d, 'kaynak.docx');
  fs.writeFileSync(kaynak, zipSync(dosyalar));
  const coz = async (ustVeriTemizle, ad) => {
    const ctx = { girdiler: [kaynak], hedef: 'docx', ciktiKlasoru: path.join(d, ad), sofficeYolu: SOFFICE, geciciKlasor: d, ustVeriTemizle };
    const cikis = await lo.calistir(ctx);
    return strFromU8(unzipSync(fs.readFileSync(cikis))['docProps/core.xml']);
  };
  const acik = await coz(true, 'o2');
  assert.ok(!acik.includes('GIZLI-YAZAR'), acik);
  const kapali = await coz(false, 'o3');
  assert.ok(kapali.includes('GIZLI-YAZAR'), 'bayrak kapalıyken özgün yazar korunur (kontrol)');
});
