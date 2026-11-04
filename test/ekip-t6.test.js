'use strict';
// Ne: T6 (tur 1.6.0 hız) testleri: gorsel.js tembel sharp/pdf-lib yükleme ve png→jpg hâlâ çalışır.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-t6]
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const y = require('./yardimci');

const kok = path.join(__dirname, '..');

test('gorsel.js: sharp ve pdf-lib modül yüklenince require.cache içinde yok (tembel)', () => {
  // Temiz süreçte ölçülür: diğer testlerin yüklediği önbellek sonucu bozmasın
  const kod = `require('./src/motorlar/gorsel');
    const anahtarlar = Object.keys(require.cache);
    const var_ = (ad) => anahtarlar.some((k) => k.split(require('path').sep).join('/').includes('/node_modules/' + ad + '/'));
    console.log(JSON.stringify({ sharp: var_('sharp'), pdfLib: var_('pdf-lib') }));`;
  const r = spawnSync(process.execPath, ['-e', kod], { cwd: kok, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(o.sharp, false);
  assert.equal(o.pdfLib, false);
});

test('gorsel.js: küçük png→jpg ve jpg→pdf hâlâ çalışır', async (t) => {
  const sharp = require('sharp');
  const { donustur } = require('../src/donustur');
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const png = path.join(g, 'k.png');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3366cc' } }).png().toFile(png);
  const r = await donustur({ id: 't6', girdiler: [png], hedef: 'jpg', ciktiKlasoru: c, secenekler: {} }, y.ortam());
  assert.equal(path.basename(r.ciktilar[0]), 'k.jpg');
  const m = await sharp(r.ciktilar[0]).metadata();
  assert.equal(m.format, 'jpeg');
  assert.equal(m.width, 64);
  const p = await donustur({ id: 't6b', girdiler: [r.ciktilar[0]], hedef: 'pdf', ciktiKlasoru: c, secenekler: {} }, y.ortam());
  assert.ok(fs.readFileSync(p.ciktilar[0]).subarray(0, 4).toString() === '%PDF');
});
