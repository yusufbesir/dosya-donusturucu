'use strict';
// TaaDön veri motoru ek testleri (ayraç tanıma, UTF-16, formül nötrleme, Türkçe hata). Sahip: Claude (TaaDön projesi).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { donustur } = require('../src/donustur');
const veri = require('../src/motorlar/veri');
const y = require('./yardimci');

const is = (girdi, hedef, ciktiKlasoru) => ({ id: 'x', girdiler: [girdi], hedef, ciktiKlasoru, secenekler: {} });

test('veri: noktalı virgül ayraçlı CSV doğru sütunlara ayrılır', () => {
  assert.deepEqual(veri.oku('ad;yas\nAli;30\nVeli;25', 'csv'), [{ ad: 'Ali', yas: '30' }, { ad: 'Veli', yas: '25' }]);
  assert.equal(veri.ayiriciTani('a|b|c\n1,2'), '|');
  assert.equal(veri.ayiriciTani('"a;b;c",d\n1,2'), ',');
});

test('veri: UTF-16LE ve BE BOM\'lu CSV okunur', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const metin = 'ad;şehir\r\nŞükrü;İzmir\r\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(metin, 'utf16le')]);
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(metin, 'utf16le').swap16()]);
  assert.equal(veri.tamponuCoz(be), metin);
  const csv = path.join(g, 'u16.csv');
  fs.writeFileSync(csv, le);
  const j = (await donustur(is(csv, 'json', c), y.ortam())).ciktilar[0];
  assert.deepEqual(JSON.parse(fs.readFileSync(j, 'utf8')), [{ ad: 'Şükrü', şehir: 'İzmir' }]);
});

test('veri: formül ile başlayan hücre nötrlenir', () => {
  const cikti = veri.csvYaz([['a'], ['=1+1'], ['@SUM(A1)'], ['-2+3'], ['+x'], ['\tx'], ['normal']]);
  assert.equal(cikti, 'a\r\n"\'=1+1"\r\n"\'@SUM(A1)"\r\n"\'-2+3"\r\n"\'+x"\r\n"\'\tx"\r\nnormal\r\n');
  assert.match(veri.yaz([{ k: '=cmd|x' }], 'csv', { bom: false }), /"'=cmd\|x"/);
  assert.match(veri.yaz([{ k: -5 }], 'csv', { bom: false }), /\r\n-5\r\n/);
});

test('veri: bozuk JSON Türkçe hata verir, teknik ayrıntı kısa kalır', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const f = path.join(g, 'bozuk.json');
  fs.writeFileSync(f, '{"a": [1, 2,, }');
  await assert.rejects(donustur(is(f, 'csv', c), y.ortam()), (e) => {
    assert.match(e.message, /JSON dosyası hatalı biçimlendirilmiş; söz dizimini kontrol edin\./);
    assert.ok(e.message.length < 200);
    return true;
  });
});
