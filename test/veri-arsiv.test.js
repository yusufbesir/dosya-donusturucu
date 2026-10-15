'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { zipSync, unzipSync, strToU8 } = require('fflate');
const { donustur } = require('../src/donustur');
const veri = require('../src/motorlar/veri');
const y = require('./yardimci');

const is = (girdiler, hedef, ciktiKlasoru, secenekler = {}) => ({
  id: 'x', girdiler: Array.isArray(girdiler) ? girdiler : [girdiler], hedef, ciktiKlasoru, secenekler,
});

test('veri: csv ayrıştırıcı (tırnak, kaçışlı tırnak, satır içi yeni satır, BOM)', () => {
  const metin = '﻿id,not\r\n1,"merhaba, ""dünya"""\r\n2,"satır\niçi"\r\n3,\r\n\r\n';
  assert.deepEqual(veri.csvAyristir(metin), [['id', 'not'], ['1', 'merhaba, "dünya"'], ['2', 'satır\niçi'], ['3', '']]);
  assert.deepEqual(veri.csvAyristir('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.throws(() => veri.csvAyristir('a,"kapanmamis'), /tırnak/);
  assert.equal(veri.csvYaz([['a', 'b,c'], ['"x"', 'y\nz']]), 'a,"b,c"\r\n"""x""","y\nz"\r\n');
});

test('veri: csv -> json -> yaml -> xml -> csv gidiş-dönüş', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const csv = path.join(g, 'tablo.csv');
  const satirlar = [
    ['id', 'ad', 'not'],
    ['007', 'Şükrü Çağlar', 'virgül, tırnak "x" ve & <etiket>'],
    ['2', 'İlk\nİkinci satır', ''],
    ['3', 'ğüşıöç', 'düz'],
  ];
  fs.writeFileSync(csv, '﻿' + veri.csvYaz(satirlar));
  const j = (await donustur(is(csv, 'json', c), y.ortam())).ciktilar[0];
  const json = JSON.parse(fs.readFileSync(j, 'utf8'));
  assert.equal(json.length, 3);
  assert.equal(json[0].id, '007');
  assert.equal(json[1].ad, 'İlk\nİkinci satır');
  const ym = (await donustur(is(j, 'yaml', c), y.ortam())).ciktilar[0];
  const x = (await donustur(is(ym, 'xml', c), y.ortam())).ciktilar[0];
  assert.match(fs.readFileSync(x, 'utf8'), /<kayitlar>/);
  const son = (await donustur(is(x, 'csv', c), y.ortam())).ciktilar[0];
  const geri = veri.csvAyristir(fs.readFileSync(son, 'utf8'));
  assert.deepEqual(geri, satirlar);
  // tsv de
  const tsv = (await donustur(is(son, 'tsv', c), y.ortam())).ciktilar[0];
  assert.deepEqual(veri.csvAyristir(fs.readFileSync(tsv, 'utf8'), '\t'), satirlar);
  assert.ok(y.ls(c).every((d) => !d.startsWith('.~')));
});

test('veri: json nesne dizisi <-> tablo, yaml güvenliği', () => {
  const csv = veri.donusturMetin('[{"a":1,"b":{"x":2}},{"a":3,"c":true}]', 'json', 'csv', { bom: false });
  assert.deepEqual(veri.csvAyristir(csv), [['a', 'b', 'c'], ['1', '{"x":2}', ''], ['3', '', 'true']]);
  // takma ad (alias) bombası reddedilir
  const bomba = ['a: &a [x,x,x,x,x,x,x,x,x,x]', 'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]', 'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]', 'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]'].join('\n');
  assert.throws(() => veri.donusturMetin(bomba, 'yaml', 'json'));
  // __proto__ anahtarı prototipi kirletmez
  const o = veri.oku('__proto__,b\n1,2', 'csv');
  assert.equal(Object.getPrototypeOf(o[0]), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.throws(() => veri.donusturMetin('{bozuk', 'json', 'csv'));
});

test('arsiv: zip oluştur / aç, klasör, boş dosya, benzersiz ad', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  const a = y.gecici();
  t.after(() => y.temizle(g, c, a));
  fs.mkdirSync(path.join(g, 'klasör', 'alt'), { recursive: true });
  fs.writeFileSync(path.join(g, 'klasör', 'merhaba.txt'), 'selam '.repeat(1000));
  fs.writeFileSync(path.join(g, 'klasör', 'alt', 'boş.txt'), '');
  fs.mkdirSync(path.join(g, 'klasör', 'bosdizin'));
  fs.writeFileSync(path.join(g, 'klasör', 'alt', 'ikili.bin'), Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 7) & 255)));
  fs.writeFileSync(path.join(g, 'tek.txt'), 'tek');

  const z = (await donustur(is([path.join(g, 'klasör'), path.join(g, 'tek.txt')], 'zip', c), y.ortam())).ciktilar[0];
  assert.equal(path.basename(z), 'arsiv.zip');
  const ic = unzipSync(new Uint8Array(fs.readFileSync(z)));
  assert.ok(ic['klasör/merhaba.txt'] && ic['tek.txt'] && ic['klasör/alt/ikili.bin'] && ic['klasör/bosdizin/']);

  const ac = (await donustur(is(z, 'zip-ac', a), y.ortam())).ciktilar[0];
  assert.equal(path.basename(ac), 'arsiv');
  assert.equal(fs.readFileSync(path.join(ac, 'klasör', 'merhaba.txt'), 'utf8'), 'selam '.repeat(1000));
  assert.equal(fs.statSync(path.join(ac, 'klasör', 'alt', 'boş.txt')).size, 0);
  assert.deepEqual(fs.readFileSync(path.join(ac, 'klasör', 'alt', 'ikili.bin')), fs.readFileSync(path.join(g, 'klasör', 'alt', 'ikili.bin')));
  assert.ok(fs.statSync(path.join(ac, 'klasör', 'bosdizin')).isDirectory());
  // ikinci açış çakışmaz
  const ac2 = (await donustur(is(z, 'zip-ac', a), y.ortam())).ciktilar[0];
  assert.equal(path.basename(ac2), 'arsiv (1)');
  assert.ok(y.ls(a).every((d) => !d.startsWith('.~')));
  // ikinci zip adı da benzersiz
  const z2 = (await donustur(is(path.join(g, 'tek.txt'), 'zip', c), y.ortam())).ciktilar[0];
  assert.equal(path.basename(z2), 'tek.zip');
});

test('arsiv: zip-slip, mutlak yol, boyut ve dosya sayısı sınırı reddedilir', async (t) => {
  const g = y.gecici();
  const a = y.gecici();
  t.after(() => y.temizle(g, a));
  const yaz = (ad, icerik) => { const p = path.join(g, ad); fs.writeFileSync(p, zipSync(icerik)); return p; };

  const slip = yaz('slip.zip', { 'iyi.txt': strToU8('iyi'), '../evil.txt': strToU8('kötü') });
  await assert.rejects(donustur(is(slip, 'zip-ac', path.join(a, 'out')), y.ortam()), /güvenlik/);
  const slip2 = yaz('slip2.zip', { 'a/../../evil2.txt': strToU8('kötü') });
  await assert.rejects(donustur(is(slip2, 'zip-ac', path.join(a, 'out')), y.ortam()), /güvenlik/);
  const mutlak = yaz('mutlak.zip', { '/tmp/evil3.txt': strToU8('kötü') });
  await assert.rejects(donustur(is(mutlak, 'zip-ac', path.join(a, 'out')), y.ortam()), /güvenlik/);
  const ters = yaz('ters.zip', { '..\\evil4.txt': strToU8('kötü') });
  await assert.rejects(donustur(is(ters, 'zip-ac', path.join(a, 'out')), y.ortam()), /güvenlik/);
  assert.ok(!fs.existsSync(path.join(a, 'evil.txt')) && !fs.existsSync(path.join(a, 'out', 'evil.txt')));
  assert.ok(!fs.existsSync('/tmp/evil3.txt'));
  // hiçbir şey (yarım klasör dahil) kalmamalı
  assert.deepEqual(fs.existsSync(path.join(a, 'out')) ? y.ls(path.join(a, 'out')) : [], []);

  const buyuk = yaz('buyuk.zip', { 'sifir.bin': new Uint8Array(3 * 1024 * 1024) });
  await assert.rejects(donustur(is(buyuk, 'zip-ac', path.join(a, 'out'), { maksToplamBoyut: 1024 * 1024 }), y.ortam()), /boyut/);
  assert.deepEqual(y.ls(path.join(a, 'out')), []);
  const cok = yaz('cok.zip', { 'a.txt': strToU8('1'), 'b.txt': strToU8('2'), 'c.txt': strToU8('3') });
  await assert.rejects(donustur(is(cok, 'zip-ac', path.join(a, 'out'), { maksDosya: 2 }), y.ortam()), /fazla dosya/);
  await assert.rejects(donustur(is(buyuk, 'zip-ac', path.join(a, 'out'), { maksToplamBoyut: 1024 }), y.ortam()), /boyut/);
  // sınır yeterliyse açılır
  const ok = await donustur(is(buyuk, 'zip-ac', path.join(a, 'out'), { maksToplamBoyut: 4 * 1024 * 1024 }), y.ortam());
  assert.equal(fs.statSync(path.join(ok.ciktilar[0], 'sifir.bin')).size, 3 * 1024 * 1024);
  // bozuk veri
  const bozuk = path.join(g, 'bozuk.zip');
  fs.writeFileSync(bozuk, fs.readFileSync(buyuk).subarray(0, 60));
  await assert.rejects(donustur(is(bozuk, 'zip-ac', path.join(a, 'out2')), y.ortam()));
});

test('arsiv: gzip sıkıştır / aç', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const dosya = path.join(g, 'veri.txt');
  fs.writeFileSync(dosya, 'abc'.repeat(100000));
  const gz = (await donustur(is(dosya, 'gz', c), y.ortam())).ciktilar[0];
  assert.equal(path.basename(gz), 'veri.txt.gz');
  assert.equal(zlib.gunzipSync(fs.readFileSync(gz)).toString(), 'abc'.repeat(100000));
  const acik = (await donustur(is(gz, 'gz-ac', c), y.ortam())).ciktilar[0];
  assert.equal(path.basename(acik), 'veri.txt');
  assert.equal(fs.readFileSync(acik, 'utf8'), 'abc'.repeat(100000));
  // sınır
  await assert.rejects(donustur(is(gz, 'gz-ac', c, { maksToplamBoyut: 1000 }), y.ortam()), /boyut/);
  assert.ok(y.ls(c).every((d) => !d.startsWith('.~')));
  // bozuk gz
  const bozuk = path.join(g, 'bozuk.gz');
  fs.writeFileSync(bozuk, fs.readFileSync(gz).subarray(0, 30));
  await assert.rejects(donustur(is(bozuk, 'gz-ac', c), y.ortam()));
  assert.ok(y.ls(c).every((d) => !d.startsWith('.~')));
});
