'use strict';
// Ne: E-kitap kategorisi ve EPUB yazma (LibreOffice Writer "EPUB" süzgeci) testleri. Sahibi: Dosya dönüştürücü işi.
// Değiştirme kuralı: EPUB girdi, MOBI/AZW3/FB2 eklenirse kullanıcı kararıyla ve bu testler güncellenerek yapılır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const katalog = require('../src/katalog');
const lo = require('../src/motorlar/libreoffice');
const { donustur } = require('../src/donustur');
const { unzipSync, strFromU8 } = require('fflate');
const y = require('./yardimci');

const KAYNAKLAR = ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm'];

test('ekitap: kategori listede ve epub biçimi e-kitap kategorisinde', () => {
  assert.ok(katalog.KATEGORILER.some((k) => k.id === 'ekitap' && k.ad === 'E-kitap'));
  assert.equal(katalog.BICIMLER.epub.kategori, 'ekitap');
});

test('ekitap: docx, doc, odt, rtf, txt, html, htm -> epub (libreoffice motoru)', () => {
  for (const u of KAYNAKLAR) {
    const o = katalog.hedefler(u).find((x) => x.hedef === 'epub');
    assert.ok(o, `${u} -> epub olmalı`);
    assert.equal(o.motor, 'libreoffice');
    assert.equal(o.kategori, 'ekitap');
  }
});

test('ekitap: kapsam dışı dönüşümler eklenmedi (epub girdi, mobi/azw3/fb2, md, pdf)', () => {
  assert.deepEqual(katalog.hedefler('epub'), []);
  for (const u of ['mobi', 'azw3', 'fb2']) assert.equal(katalog.BICIMLER[u], undefined);
  for (const u of ['md', 'xlsx', 'pptx', 'mp3', 'pdf']) {
    assert.ok(!katalog.hedefler(u).some((x) => ['epub', 'mobi', 'azw3', 'fb2'].includes(x.hedef)), `${u} e-kitap hedefi sunmamalı`);
  }
  assert.ok(katalog.islemler('ekitap').length === 0);
});

test('ekitap: dışa aktarma süzgeci epub:EPUB, diğer hedefler değişmedi', () => {
  for (const k of ['belge', 'tablo']) assert.equal(lo.disaAktarmaFiltresi('epub', k), 'epub:EPUB');
  assert.equal(lo.disaAktarmaFiltresi('pdf', 'belge'), 'pdf');
  assert.equal(lo.disaAktarmaFiltresi('docx', 'belge'), 'docx:MS Word 2007 XML');
  assert.equal(lo.iceAktarmaFiltresi('txt'), 'Text (encoded):UTF8');
});

test('ekitap: gömülü LibreOffice kayıt defterinde EPUB süzgeci var (varsa)', (t) => {
  const xcd = path.join(__dirname, '..', 'vendor', 'libreoffice', 'share', 'registry', 'writer.xcd');
  if (!fs.existsSync(xcd)) return t.skip('gömülü LibreOffice yok');
  assert.match(fs.readFileSync(xcd, 'utf8'), /<node oor:name="EPUB" oor:op="replace">/);
});

test('ekitap: soffice yoksa anlaşılır hata (txt -> epub)', async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const txt = path.join(g, 'k.txt');
  fs.writeFileSync(txt, 'merhaba');
  await assert.rejects(
    donustur({ id: 'x', girdiler: [txt], hedef: 'epub', ciktiKlasoru: g, secenekler: {} }, y.ortam({ sofficeYolu: null, sofficeAramaYok: true })),
    /LibreOffice/);
});

test('ekitap: txt -> epub geçerli EPUB üretir', { timeout: 240000, skip: !y.sofficeYolu }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const txt = path.join(g, 'kitap.txt');
  fs.writeFileSync(txt, 'Merhaba dünya, şğüöçı İ\nİkinci satır\n');
  const { ciktilar } = await donustur({ id: 'x', girdiler: [txt], hedef: 'epub', ciktiKlasoru: c, secenekler: { zamanAsimi: 240000 } }, y.ortam({}));
  assert.equal(path.basename(ciktilar[0]), 'kitap.epub');
  const dosyalar = unzipSync(new Uint8Array(fs.readFileSync(ciktilar[0])));
  assert.equal(strFromU8(dosyalar.mimetype), 'application/epub+zip');
  assert.ok(dosyalar['META-INF/container.xml']);
});
