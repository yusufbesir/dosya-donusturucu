'use strict';
// Ne: 1.12.0 testleri — ad çakışma kuralı doğrulaması, tarihli alt klasör (önce izin denetimi), boyut tahmini.
// Sahibi: TaaDön işi. yazan: [Claude#taadon-1.12 2026-11-05]. Değiştirme: davranış değişince birlikte; silme yalnız Yusuf kararıyla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../dogrulama');

test('ayarDogrula: cakisma, tarihliKlasor, ozBoyutTahmini', () => {
  assert.equal(D.ayarDogrula('cakisma', 'numara', {}), 'numara');
  assert.equal(D.ayarDogrula('cakisma', 'cop', {}), 'cop');
  assert.throws(() => D.ayarDogrula('cakisma', 'sil', {}), /çakışma/);
  assert.equal(D.ayarDogrula('tarihliKlasor', true, {}), true);
  assert.throws(() => D.ayarDogrula('tarihliKlasor', 'evet', {}));
  assert.equal(D.ayarDogrula('ozBoyutTahmini', false, {}), false);
});

test('tarihKlasorAdi: YYYY-AA-GG', () => {
  const ad = D.tarihKlasorAdi(new Date(2026, 10, 5));
  assert.equal(ad, '2026-11-05');
  assert.ok(D.TARIH_KLASOR_DESENI.test(ad));
});

test('boyutTahmini: oran, bilinmeyen hedef ve prototip anahtarları', () => {
  assert.equal(D.boyutTahmini('gorsel', 'jpg', 1000), 350);
  assert.equal(D.boyutTahmini('gorsel', 'JPG', 1000), 350);
  assert.equal(D.boyutTahmini('gorsel', 'xyz', 1000), null);
  assert.equal(D.boyutTahmini('constructor', 'jpg', 1000), null);
  assert.equal(D.boyutTahmini('gorsel', 'toString', 1000), null);
  assert.equal(D.boyutTahmini('gorsel', 'jpg', 0), null);
});

function ctxKur(kok, izinliKlasor) {
  const izinliKlasorler = new D.YolKumesi();
  if (izinliKlasor) izinliKlasorler.ekle(izinliKlasor);
  const girdi = path.join(kok, 'a.png');
  fs.writeFileSync(girdi, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  const izinli = new D.YolKumesi();
  izinli.ekle(girdi);
  return {
    id: 'is1', izinli, izinliKlasorler, hedeflerFn: () => [{ hedef: 'jpg' }], islemKumesi: null, simdi: new Date(2026, 10, 5),
    girdi
  };
}

test('isHazirla: tarihliKlasor izinli klasör altında YYYY-AA-GG oluşturur', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-112-'));
  const cikti = path.join(kok, 'cikti');
  fs.mkdirSync(cikti);
  const ctx = ctxKur(kok, cikti);
  ctx.ayarlar = { ciktiYeri: 'klasor', tarihliKlasor: true };
  const is = D.isHazirla({ girdiler: [ctx.girdi], hedef: 'jpg', ciktiKlasoru: cikti, secenekler: {} }, ctx);
  assert.equal(is.ciktiKlasoru, path.resolve(path.join(cikti, '2026-11-05')));
  assert.ok(fs.statSync(is.ciktiKlasoru).isDirectory());
  assert.ok(ctx.izinliKlasorler.var(is.ciktiKlasoru));
});

test('isHazirla: tarihliKlasor izinsiz klasörde alt klasör oluşturmaz', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-112-'));
  const izinli = path.join(kok, 'izinli');
  const yabanci = path.join(kok, 'yabanci');
  fs.mkdirSync(izinli); fs.mkdirSync(yabanci);
  const ctx = ctxKur(kok, izinli);
  ctx.ayarlar = { ciktiYeri: 'klasor', tarihliKlasor: true };
  assert.throws(() => D.isHazirla({ girdiler: [ctx.girdi], hedef: 'jpg', ciktiKlasoru: yabanci, secenekler: {} }, ctx), /seçilmemiş/);
  assert.equal(fs.readdirSync(yabanci).length, 0, 'izinsiz klasörde alt klasör açılmamalı');
  assert.ok(!ctx.izinliKlasorler.var(path.join(yabanci, '2026-11-05')));
});
