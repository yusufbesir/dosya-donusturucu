// Açıklama: TaaDön Rust çekirdeği (taa-donustur.exe) ile Node (fflate) arşiv yolunun eşdeğerlik testleri.
// Sahip: Yusuf (TaaDön projesi). yazan: [Claude#taadon-rust-asama1 2026-11-04], [Claude#taadon-rust-asama2 2026-11-04]
// (ad, UTF-8 bayraksız ad ve yinelenen ad vakaları). Yalnız ekleme/düzeltme ile değiştirin.
// Exe yoksa (taa-donustur derlenmemişse) testler atlanır. Yalnız kendi mkdtemp klasörlerini temizler.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync, strToU8, Zip, ZipPassThrough } = require('fflate');
const arsiv = require('../src/motorlar/arsiv');
const rust = require('../src/motorlar/rust');
const y = require('./yardimci');

const atla = rust.hazir() ? false : 'taa-donustur.exe bulunamadı (taa-donustur derlenmemiş)';

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
  assert.deepEqual(r1, { ok: true, uzanti: 'pdf', imzaUygun: true, boyut: fs.statSync(pdf).size, algilanan: 'pdf' });
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

// ---- 2. aşama vakaları (yazan: [Claude#taadon-rust-asama2 2026-11-04]) ----

test('rust: UTF-8 bayrağı olmayan girdi adları (ASCII eşit; ASCII dışı farkı belgeli)', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  // fflate yalnız ASCII dışı adlarda UTF-8 bayrağını (bit 11) koyar; ASCII adlar bayraksız yazılır.
  const zip = path.join(g, 'bayraksiz.zip');
  const ham = Buffer.from(zipSync({ 'Gx.txt': strToU8('bir'), 'klasor/Ad_1-2.txt': strToU8('iki') }));
  for (let i = 0; i < ham.length - 4; i += 1) {
    if (ham.readUInt32LE(i) === 0x04034b50) assert.equal(ham.readUInt16LE(i + 6) & 0x800, 0); // yerel başlık: bayrak yok
    if (ham.readUInt32LE(i) === 0x02014b50) assert.equal(ham.readUInt16LE(i + 8) & 0x800, 0); // merkezi dizin: bayrak yok
  }
  fs.writeFileSync(zip, ham);
  const [n] = await ac(zip, path.join(g, 'node'), undefined);
  const [r] = await ac(zip, path.join(g, 'rust'), true);
  assert.deepEqual(agac(r), agac(n));
  assert.deepEqual(agac(n).map((x) => x[0]), ['Gx.txt', 'klasor', 'klasor/Ad_1-2.txt']);

  // ASCII dışı bayt (0x81) bayraksız: Rust (zip crate) CP437 çözer -> "ü"; fflate latin1 çözer -> U+0081 (denetim
  // karakteri, guvenliYol'da "_" olur). Bu bilinen fark belgelenir; eski DOS/Windows arşivlerinde Rust adı daha doğru verir.
  const ozel = path.join(g, 'cp437.zip');
  const b = Buffer.from(ham);
  const ad = Buffer.from('Gx.txt');
  let degisen = 0;
  for (let i = b.indexOf(ad); i !== -1; i = b.indexOf(ad, i + 1)) { b[i + 1] = 0x81; degisen += 1; }
  assert.equal(degisen, 2); // yerel başlık + merkezi dizin
  fs.writeFileSync(ozel, b);
  const liste = await rust.calistir(['zip-listele', ozel]);
  assert.ok(liste.girdiler.some((x) => x.ad === 'Gü.txt'), JSON.stringify(liste.girdiler.map((x) => x.ad)));
  const [n2] = await ac(ozel, path.join(g, 'node2'), undefined);
  const [r2] = await ac(ozel, path.join(g, 'rust2'), true);
  const nAdlar = agac(n2).map((x) => x[0]);
  const rAdlar = agac(r2).map((x) => x[0]);
  assert.ok(rAdlar.includes('Gü.txt'));
  assert.ok(!nAdlar.includes('Gü.txt')); // fflate latin1: farklı ad (belgeli fark)
  assert.deepEqual(rAdlar.filter((a) => a.startsWith('klasor')), nAdlar.filter((a) => a.startsWith('klasor')));
});

test('rust: aynı adı iki kez taşıyan ZIP -> Rust reddeder, köprü JS yoluna düşer (sonuç aynı)', { skip: atla }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const parcalar = [];
  const z = new Zip((err, veri) => { if (err) throw err; parcalar.push(veri); });
  for (const icerik of ['birinci', 'ikinci']) {
    const f = new ZipPassThrough('ayni.txt');
    z.add(f);
    f.push(strToU8(icerik), true);
  }
  z.end();
  const zip = path.join(g, 'yinelenen.zip');
  fs.writeFileSync(zip, Buffer.concat(parcalar.map((p) => Buffer.from(p))));
  // CLI doğrudan: reddeder (zip crate yinelenenleri sessizce tekilleştirirdi; girdi kaybı yerine red)
  await assert.rejects(rust.calistir(['zip-ac', zip, path.join(g, 'cli')]), /yinelenen girdi adı/);
  assert.equal(rust.jsYolunaDus(new Error('ZIP yinelenen girdi adı içeriyor; arşiv Rust çekirdeğinde açılmadı.')), true);
  assert.equal(rust.jsYolunaDus(new Error('ZIP bozuk ya da okunamadı (x).')), false);
  const [n] = await ac(zip, path.join(g, 'node'), undefined);
  const [r] = await ac(zip, path.join(g, 'rust'), true);
  const na = agac(n);
  assert.equal(na.length, 2); // ikisi de açılır, biri "(n)" ekiyle
  assert.deepEqual(agac(r), na);
  assert.deepEqual(y.ls(path.join(g, 'rust')), ['yinelenen']); // Rust'ın geçici .~zip- klasörü kalmaz
});

// ---- 1.11.0 paket C: biçim algılama eşdeğerliği [Claude#taadon-1.11-paket-c 2026-11-04] ----
test('rust: imza algilanan alanı main.js bicimAlgila ile 12+ örnekte aynı', { skip: atla }, async (t) => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = /\nfunction bicimAlgila\([^)]*\) \{[\s\S]*?\n\}/.exec(main);
  assert.ok(m, 'bicimAlgila main.js içinde bulunmalı');
  const bicimAlgila = new Function(`${m[0]}; return bicimAlgila;`)();
  const L = (...d) => Buffer.from(d);
  const A = (s) => Buffer.from(s, 'latin1');
  const pk = (icerik) => Buffer.concat([L(0x50, 0x4b, 3, 4), L(0, 0, 0, 0), A(icerik)]);
  const ornekler = {
    'a.pdf': [A('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'), 'pdf'],
    'b.docx': [pk('[Content_Types].xml word/document.xml'), 'docx'],
    'c.xlsx': [pk('[Content_Types].xml xl/workbook.xml'), 'xlsx'],
    'd.pptx': [pk('[Content_Types].xml ppt/presentation.xml'), 'pptx'],
    'e.epub': [pk('mimetypeapplication/epub+zip'), 'epub'],
    'f.zip': [pk('dosya.txt'), 'zip'],
    'g.png': [Buffer.concat([L(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), L(0, 0, 0, 0x0d), A('IHDR')]), 'png'],
    'h.jpg': [L(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0), 'jpg'],
    'i.gif': [Buffer.concat([A('GIF89a'), L(1, 0, 1, 0)]), 'gif'],
    'j.webp': [Buffer.concat([A('RIFF'), L(4, 0, 0, 0), A('WEBPVP8 ')]), 'webp'],
    'k.mp4': [Buffer.concat([L(0, 0, 0, 0x18), A('ftypmp42'), L(0, 0, 0, 0)]), 'mp4'],
    'l.bin': [A('duz metin dosyasi'), null],
    'm.7z': [L(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4), '7z'],
    'n.rar': [Buffer.concat([A('Rar!'), L(0x1a, 7, 0)]), 'rar'],
    'o.wav': [Buffer.concat([A('RIFF'), L(4, 0, 0, 0), A('WAVEfmt ')]), 'wav'],
    'p.mp3': [Buffer.concat([A('ID3'), L(3, 0, 0, 0, 0, 0, 0)]), 'mp3'],
    'q.bmp': [Buffer.concat([A('BM'), L(0x36, 0, 0, 0)]), 'bmp'],
    'r.gz': [L(0x1f, 0x8b, 8, 0, 0, 0, 0, 0), 'gz'],
    's.ogg': [Buffer.concat([A('OggS'), L(0, 2)]), 'ogg'],
    't.flac': [Buffer.concat([A('fLaC'), L(0, 0, 0, 0x22)]), 'flac'],
    'u.avi': [Buffer.concat([A('RIFF'), L(4, 0, 0, 0), A('AVI LIST')]), null],
    'v.kisa': [A('ab'), null],
  };
  const g = y.gecici();
  t.after(() => y.temizle(g));
  for (const [ad, [bayt, beklenen]] of Object.entries(ornekler)) {
    const yol = path.join(g, ad);
    fs.writeFileSync(yol, bayt);
    const r = await rust.calistir(['imza', yol]);
    assert.equal(r.algilanan, beklenen, `${ad}: rust`);
    assert.equal(bicimAlgila(bayt), r.algilanan, `${ad}: JS == Rust`);
  }
  assert.equal((await rust.calistir(['imza', g])).algilanan, null); // klasör
});
