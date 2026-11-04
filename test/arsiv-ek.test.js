// Açıklama: TaaDön arşiv motoru ek testleri (zip bombası sınırı, ZIP64 sınır denetimi). Sahip: Claude; yalnız ekleme/düzeltme ile değiştirin.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { donustur } = require('../src/donustur');
const arsiv = require('../src/motorlar/arsiv');
const y = require('./yardimci');

test('arsiv: zip64Gerekli sınırları', () => {
  const k = (n, ad = 'a') => ({ ad, st: { size: n } });
  assert.equal(arsiv.zip64Gerekli([k(10), k(20)]), null);
  assert.equal(arsiv.zip64Gerekli(Array.from({ length: 65535 }, () => k(0))), null);
  assert.match(arsiv.zip64Gerekli(Array.from({ length: 65536 }, () => k(0))), /girdi/);
  assert.match(arsiv.zip64Gerekli([k(0xFFFFFFFF, 'buyuk.bin')]), /buyuk\.bin/);
  assert.match(arsiv.zip64Gerekli([k(0x80000000), k(0x80000000)]), /toplam/);
  assert.equal(arsiv.zip64Gerekli([{ ad: 'd/', dizin: true, st: { size: 4096 } }]), null);
  assert.equal(arsiv.VARSAYILAN_MAKS_DOSYA, 65535);
});

test('arsiv: yüklü dizin girdisi toplam boyut sınırına sayılır', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const zip = path.join(g, 'dizin-bomba.zip');
  fs.writeFileSync(zip, zipSync({ 'd/': [strToU8('x'.repeat(5000)), { level: 0 }], 'a.txt': strToU8('merhaba') }));
  await assert.rejects(
    donustur({ id: 'x', girdiler: [zip], hedef: 'zip-ac', ciktiKlasoru: c, secenekler: { maksToplamBoyut: 100 } }, y.ortam()),
    /sınırı aşıyor/,
  );
  assert.ok(y.ls(c).every((d) => !d.startsWith('.~')));
});
