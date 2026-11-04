// Açıklama: TaaDön Rust çekirdeği (taadon-cekirdek.exe) ile Node (fflate) arşiv yolunun eşdeğerlik testleri.
// Sahip: Yusuf (TaaDön projesi). yazan: [Claude#taadon-rust-asama1 2026-11-04]. Yalnız ekleme/düzeltme ile değiştirin.
// Exe yoksa (cekirdek-rust derlenmemişse) testler atlanır. Yalnız kendi mkdtemp klasörlerini temizler.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync, strToU8 } = require('fflate');
const arsiv = require('../src/motorlar/arsiv');
const rust = require('../src/motorlar/rust');
const y = require('./yardimci');

const atla = rust.hazir() ? false : 'taadon-cekirdek.exe bulunamadı (cekirdek-rust derlenmemiş)';

function sha(dosya) {
  return crypto.createHash('sha256').update(fs.readFileSync(dosya)).digest('hex');
}

/** Klasör ağacı: göreli yol -> sha256 (klasörler '<klasor>'), sıralı. */
function agac(kok) {
  const sonuc = [];
  const gez = (k, on) => {
    for (const ad of fs.readdirSync(k).sort()) {
      const tam = path.join(k, ad);
      const rel = on ? `${on}/${ad}` : ad;
      if (fs.statSync(tam).isDirectory()) { sonuc.push([rel, '<klasor>']); gez(tam, rel); } else sonuc.push([rel, sha(tam)]);
    }
  };
  gez(kok, '');
  return sonuc;
}

function ornekZip(yol, slip = false) {
  const girdiler = {
    'a.txt': strToU8('merhaba dünya\n'.repeat(200)),
    'b.bin': new Uint8Array(crypto.randomBytes(100 * 1024)),
    'alt/c.txt': strToU8('alt klasör içeriği'),
    'alt/ic/': new Uint8Array(0),
  };
  if (slip) girdiler['../kacak.txt'] = strToU8('kaçak');
  fs.writeFileSync(yol, zipSync(girdiler));
}

const tek = (s) => (Array.isArray(s) ? s[0] : s); // motorlar dizi ya da tek yol döner
const ac = async (zip, klasor, rustMotor) => [tek(await arsiv.calistir({ girdiler: [zip], hedef: 'zip-ac', ciktiKlasoru: klasor, secenekler: {}, rustMotor }))];

test('rust: zip-ac Node ile aynı dosya listesi ve sha256', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const zip = path.join(g, 'ornek.zip');
  ornekZip(zip);
  const [nodeKlasor] = await ac(zip, path.join(g, 'node'), undefined);
  const yuzdeler = [];
  const [rustKlasor] = await arsiv.calistir({
    girdiler: [zip], hedef: 'zip-ac', ciktiKlasoru: path.join(g, 'rust'), secenekler: {}, rustMotor: true, ilerleme: (n) => yuzdeler.push(n),
  });
  assert.equal(path.basename(nodeKlasor), 'ornek');
  assert.equal(path.basename(rustKlasor), 'ornek');
  const n = agac(nodeKlasor);
  assert.deepEqual(agac(rustKlasor), n);
  assert.deepEqual(n.map((x) => x[0]), ['a.txt', 'alt', 'alt/c.txt', 'alt/ic', 'b.bin']);
  assert.ok(yuzdeler.length > 0 && yuzdeler.every((v) => v >= 0 && v <= 95));
  // geçici .~zip- klasörü kalmaz
  assert.deepEqual(y.ls(path.join(g, 'rust')), ['ornek']);
  // CLI doğrudan
  const r = await rust.calistir(['zip-ac', zip, path.join(g, 'cli')]);
  assert.equal(r.dosyaSayisi, 4); // a.txt, b.bin, alt/c.txt, alt/ic/
  assert.deepEqual(agac(path.join(g, 'cli')), n);
});

test('rust: zip-slip girdisi her iki yolda da aynı metinle reddedilir', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const zip = path.join(g, 'kotu.zip');
  ornekZip(zip, true);
  const beklenen = /üst klasöre çıkan yol reddedildi \(\.\.\/kacak\.txt\)/;
  await assert.rejects(ac(zip, path.join(g, 'node'), undefined), beklenen);
  await assert.rejects(ac(zip, path.join(g, 'rust'), true), beklenen);
  assert.deepEqual(y.ls(path.join(g, 'rust')), []); // yarım içerik ve geçici klasör kalmaz
  assert.ok(!fs.existsSync(path.join(g, 'kacak.txt')));
  const liste = await rust.calistir(['zip-listele', zip]);
  assert.equal(liste.guvenli, false);
  assert.equal(liste.girdiSayisi, 5);
  const red = liste.girdiler.filter((x) => !x.guvenli);
  assert.deepEqual(red.map((x) => x.ad), ['../kacak.txt']);
  assert.match(red[0].neden, beklenen);
});

test('rust: boyut sınırı ve hata çıkış kodu', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const zip = path.join(g, 'ornek.zip');
  ornekZip(zip);
  await assert.rejects(
    arsiv.calistir({ girdiler: [zip], hedef: 'zip-ac', ciktiKlasoru: path.join(g, 'r'), secenekler: { maksToplamBoyut: 1000 }, rustMotor: true }),
    /sınırı aşıyor/,
  );
  await assert.rejects(rust.calistir(['zip-ac', path.join(g, 'yok.zip'), path.join(g, 'x')]), /ZIP dosyası açılamadı/);
});

test('rust: zip-olustur çıktısı Node ile açılınca kaynakla aynı', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const kaynak = path.join(g, 'kaynak');
  fs.mkdirSync(path.join(kaynak, 'alt', 'bos'), { recursive: true });
  fs.writeFileSync(path.join(kaynak, 'metin.txt'), 'satır\n'.repeat(5000));
  fs.writeFileSync(path.join(kaynak, 'alt', 'veri.bin'), crypto.randomBytes(50 * 1024));
  await y.pngUret(path.join(kaynak, 'alt', 'resim.png'));
  const zipYolu = tek(await arsiv.calistir({ girdiler: [kaynak], hedef: 'zip', ciktiKlasoru: path.join(g, 'z'), secenekler: {}, rustMotor: true }));
  assert.equal(path.basename(zipYolu), 'kaynak.zip');
  const [acilan] = await ac(zipYolu, path.join(g, 'ac'), undefined);
  assert.deepEqual(agac(path.join(acilan, 'kaynak')), agac(kaynak));
  const liste = await rust.calistir(['zip-listele', zipYolu]);
  const png = liste.girdiler.find((x) => x.ad === 'kaynak/alt/resim.png');
  assert.equal(png.boyut, png.sikistirilmis); // SAKLA: png sıkıştırılmadan saklanır
});

test('rust: gzip/gunzip gidiş-dönüş, Node ile çapraz', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const girdi = path.join(g, 'veri.txt');
  fs.writeFileSync(girdi, `${'abc '.repeat(100000)}${crypto.randomBytes(2000).toString('hex')}`);
  const gz = async (rustMotor, klasor, dosya, hedef) => [tek(await arsiv.calistir({ girdiler: [dosya], hedef, ciktiKlasoru: path.join(g, klasor), secenekler: {}, rustMotor }))];
  const [rustGz] = await gz(true, 'rgz', girdi, 'gz');
  const [nodeGz] = await gz(undefined, 'ngz', girdi, 'gz');
  assert.equal(path.basename(rustGz), 'veri.txt.gz');
  const [a] = await gz(undefined, 'a1', rustGz, 'gz-ac'); // Rust -> Node
  const [b] = await gz(true, 'a2', nodeGz, 'gz-ac'); // Node -> Rust
  const [c] = await gz(true, 'a3', rustGz, 'gz-ac'); // Rust -> Rust
  for (const x of [a, b, c]) {
    assert.equal(path.basename(x), 'veri.txt');
    assert.equal(sha(x), sha(girdi));
  }
  // çıktı üzerine yazma yok
  await assert.rejects(rust.calistir(['gzip', girdi, rustGz]), /zaten var/);
  await assert.rejects(rust.calistir(['gunzip', rustGz, path.join(g, 'k.txt'), '--maks-bayt', '100']), /sınırı aşıyor/);
  assert.ok(!fs.existsSync(path.join(g, 'k.txt')));
});

test('rust: imza komutu pdf/png için', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const pdf = path.join(g, 'a.pdf');
  fs.writeFileSync(pdf, '%PDF-1.7\n%âãÏÓ\n');
  const png = path.join(g, 'b.png');
  await y.pngUret(png);
  const sahte = path.join(g, 'c.pdf');
  fs.writeFileSync(sahte, 'PDF değil');
  const r1 = await rust.calistir(['imza', pdf]);
  assert.deepEqual(r1, { ok: true, uzanti: 'pdf', imzaUygun: true, boyut: fs.statSync(pdf).size });
  const r2 = await rust.calistir(['imza', png]);
  assert.equal(r2.uzanti, 'png');
  assert.equal(r2.imzaUygun, true);
  assert.equal((await rust.calistir(['imza', sahte])).imzaUygun, false);
});

test('rust: rustMotor kapalıyken (varsayılan) JS yolu kullanılır', async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const zip = path.join(g, 'ornek.zip');
  ornekZip(zip);
  const orijinal = rust.arsivCalistir;
  let cagrildi = false;
  rust.arsivCalistir = async () => { cagrildi = true; throw new Error('çağrılmamalı'); };
  try {
    const [k] = await ac(zip, path.join(g, 'c'), undefined);
    assert.equal(path.basename(k), 'ornek');
    assert.equal(cagrildi, false);
  } finally {
    rust.arsivCalistir = orijinal;
  }
});
