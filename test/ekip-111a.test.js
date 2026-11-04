'use strict';
// Ne: TaaDön 1.11.0 paket A (hız) testleri: LibreOffice toplu yolu (tek soffice çağrısı), çıktı eşleme, kısmi hata,
//     ilerleme ve loTopluKapali ile eski yola düşme. Gerçek soffice gerekmez: surec.calistir sahte süreçle değiştirilir.
// Sahibi: TaaDön dosya dönüştürücü işi. yazan: [Claude#taadon-1.11-paket-a 2026-11-04]
// Değiştirme kuralı: davranış değişikliği src/donustur.js ve src/motorlar/libreoffice.js ile birlikte güncellenir;
// silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const surec = require('../src/surec');
const lo = require('../src/motorlar/libreoffice');
const { donustur, planla, loTopluKullan } = require('../src/donustur');
const y = require('./yardimci');

const SAHTE_SOFFICE = path.join(path.parse(process.cwd()).root, 'yok', 'soffice.exe');
const is = (girdiler, hedef, ciktiKlasoru, ek = {}) => ({ id: 'x', girdiler, hedef, ciktiKlasoru, secenekler: {}, ...ek });

/** surec.calistir yerine geçen sahte soffice: --outdir sonrası her girdi için <gövde>.<hedef> yazar;
 *  adı "bozuk" içeren girdiyi atlar. Her çağrıyı kaydeder ve stdout'a "convert ..." satırları basar. */
function sahteSoffice(t, { kod = 0 } = {}) {
  const cagrilar = [];
  const eski = surec.calistir;
  surec.calistir = async (yol, args, sec = {}) => {
    const i = args.indexOf('--outdir');
    const cikis = args[i + 1];
    const girdiler = args.slice(i + 2);
    const hedef = String(args[args.indexOf('--convert-to') + 1]).split(':')[0];
    cagrilar.push({ yol, girdiler, zamanAsimi: sec.zamanAsimi });
    let stdout = '';
    for (const g of girdiler) {
      if (/bozuk/i.test(path.basename(g))) { stdout += `Error: source file could not be loaded\n`; continue; }
      const ad = `${path.basename(g, path.extname(g))}.${hedef}`;
      fs.writeFileSync(path.join(cikis, ad), hedef === 'pdf' ? `%PDF-1.7\n${path.basename(g)}\n` : 'PK\u0003\u0004');
      const satir = `convert ${g} as a Writer document -> ${path.join(cikis, ad)} using filter : x\n`;
      // satırı iki parçaya bölerek ver (parça sınırı sayacını sına)
      if (sec.stdoutVeri) { sec.stdoutVeri(satir.slice(0, 7)); sec.stdoutVeri(satir.slice(7)); }
      stdout += satir;
    }
    return { kod, stdout, stderr: '' };
  };
  cagrilar.geriAl = () => { surec.calistir = eski; };
  t.after(cagrilar.geriAl);
  return cagrilar;
}

function dosyalar(klasor, adlar) {
  return adlar.map((a) => {
    const p = path.join(klasor, a);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `içerik ${a}\n`);
    return p;
  });
}

const ortam = (ek = {}) => ({ sofficeYolu: SAHTE_SOFFICE, bulutDenetimiYok: true, ilerleme: () => {}, ...ek });

test('planlama: LibreOffice gruplaması (loTopluKullan)', () => {
  assert.equal(loTopluKullan(planla(is(['a.docx', 'b.odt'], 'pdf', 'c'))), true);
  assert.equal(loTopluKullan(planla(is(['a.txt', 'b.txt', 'c.txt'], 'pdf', 'c'))), true);
  assert.equal(loTopluKullan(planla(is(['a.docx'], 'pdf', 'c'))), false, 'tek girdi eski yol');
  assert.equal(loTopluKullan(planla(is(['a.docx', 'a.docx'], 'pdf', 'c'))), false, 'tekilleştirme sonrası tek girdi');
  assert.equal(loTopluKullan(planla(is(['a.docx', 'b.odt'], 'pdf', 'c')), { loTopluKapali: true }), false);
  assert.equal(loTopluKullan(planla(is(['a.md', 'b.md'], 'pdf', 'c'))), true, 'markdown -> LO');
  assert.equal(loTopluKullan(planla(is(['a.md', 'b.md'], 'html', 'c'))), false, 'markdown -> html LO kullanmaz');
  assert.equal(loTopluKullan(planla(is(['a.jpg', 'b.jpg'], 'pdf', 'c'))), false, 'görsel motoru');
});

test('topluBol: aynı gövde adı ve farklı kaynak uzantı ayrı çağrıya gider; sıra korunur', () => {
  const o = (ad) => ({ ad, kaynakUz: path.extname(ad).slice(1), kok: path.basename(ad, path.extname(ad)).toLowerCase() });
  const g = lo.topluBol([o('a/x.txt'), o('b/X.txt'), o('y.txt'), o('z.docx'), o('c/x.txt')]);
  assert.deepEqual(g.map((k) => k.ogeler.map((x) => x.ad)), [['a/x.txt', 'y.txt'], ['b/X.txt'], ['z.docx'], ['c/x.txt']]);
});

test('topluZamanAsimi: taban + girdi başına 60 sn, üst sınır 60 dk', () => {
  assert.equal(lo.topluZamanAsimi(5 * 60000, 3), 8 * 60000);
  assert.equal(lo.topluZamanAsimi(undefined, 2), 7 * 60000);
  assert.equal(lo.topluZamanAsimi(30 * 60000, 100), 60 * 60000);
});

test('donusumSayaci: bölünmüş satırları doğru sayar', () => {
  let n = 0;
  const say = lo.donusumSayaci((k) => { n += k; });
  say('conv'); say('ert a -> b\r\nError: x\nconvert c'); say(' -> d\n');
  assert.equal(n, 2);
});

test('toplu: 3 txt -> pdf tek soffice çağrısı, çıktı sırası girdilerle aynı, ilerleme artan', async (t) => {
  const cagrilar = sahteSoffice(t);
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const girdiler = dosyalar(g, ['b.txt', 'a.txt', 'c.txt']);
  const yuzdeler = [];
  const s = await donustur(is(girdiler, 'pdf', c), ortam({ ilerleme: (v) => yuzdeler.push(v) }));
  assert.equal(cagrilar.length, 1);
  assert.equal(cagrilar[0].girdiler.length, 3);
  assert.equal(cagrilar[0].zamanAsimi, lo.topluZamanAsimi(undefined, 3));
  assert.deepEqual(s.ciktilar.map((x) => path.basename(x)), ['b.pdf', 'a.pdf', 'c.pdf']);
  for (const [i, x] of s.ciktilar.entries()) assert.match(fs.readFileSync(x, 'utf8'), new RegExp(path.basename(girdiler[i])));
  assert.deepEqual(s.uyarilar, []);
  assert.ok(yuzdeler.length >= 4, yuzdeler.join(','));
  for (let i = 1; i < yuzdeler.length; i += 1) assert.ok(yuzdeler[i] >= yuzdeler[i - 1], yuzdeler.join(','));
  assert.equal(yuzdeler.at(-1), 100);
  assert.ok(yuzdeler.some((v) => v > 5 && v < 90), 'convert satırlarından ara yüzde');
});

test('toplu: kısmi hata -> diğer çıktılar korunur, hata dosyayı adıyla belirtir, Özgün yalnız başarılılar', async (t) => {
  for (const kod of [0, 1]) {
    const cagrilar = sahteSoffice(t, { kod });
    const g = y.gecici(); const c = y.gecici();
    t.after(() => y.temizle(g, c));
    const girdiler = dosyalar(g, ['bir.txt', 'bozuk.txt', 'uc.txt']);
    const s = await donustur(is(girdiler, 'pdf', c, { ozgunTasi: true }), ortam());
    assert.equal(cagrilar.length, 1);
    assert.deepEqual(s.ciktilar.map((x) => path.basename(x)), ['bir.pdf', 'uc.pdf']);
    assert.equal(s.uyarilar.length, 1, s.uyarilar.join('\n'));
    assert.match(s.uyarilar[0], /bozuk\.txt/);
    assert.deepEqual(s.tasinanlar.map((x) => path.basename(x.kaynak)), ['bir.txt', 'uc.txt']);
    assert.ok(fs.existsSync(path.join(g, 'bozuk.txt')), 'başarısız girdi yerinde kalır');
    cagrilar.geriAl();
  }
});

test('toplu: hepsi başarısızsa hata fırlatılır, çıktı klasörü boş kalır', async (t) => {
  sahteSoffice(t);
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const girdiler = dosyalar(g, ['bozuk1.txt', 'bozuk2.txt']);
  await assert.rejects(donustur(is(girdiler, 'pdf', c), ortam()), (e) => Array.isArray(e.basarisizGirdiler) && e.basarisizGirdiler.length === 2);
  assert.deepEqual(y.ls(c), []);
});

test('toplu: aynı gövde adlı girdiler ayrı çağrı, çıktılar benzersiz adla', async (t) => {
  const cagrilar = sahteSoffice(t);
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const girdiler = dosyalar(g, [path.join('a', 'not.txt'), path.join('b', 'not.txt'), 'diger.txt']);
  const s = await donustur(is(girdiler, 'pdf', c), ortam());
  assert.equal(cagrilar.length, 2);
  assert.deepEqual(s.ciktilar.map((x) => path.basename(x)), ['not.pdf', 'not (1).pdf', 'diger.pdf']);
  assert.match(fs.readFileSync(s.ciktilar[1], 'utf8'), /not\.txt/);
});

test('toplu: markdown -> pdf tek çağrı, çıktı adı özgün .md adından', async (t) => {
  const cagrilar = sahteSoffice(t);
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const girdiler = dosyalar(g, ['bir.md', 'iki.md']);
  const s = await donustur(is(girdiler, 'pdf', c), ortam());
  assert.equal(cagrilar.length, 1);
  assert.deepEqual(s.ciktilar.map((x) => path.basename(x)), ['bir.pdf', 'iki.pdf']);
});

test('loTopluKapali: eski tek tek yol (girdi başına bir soffice çağrısı)', async (t) => {
  const cagrilar = sahteSoffice(t);
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const girdiler = dosyalar(g, ['a.txt', 'b.txt', 'c.txt']);
  const s = await donustur(is(girdiler, 'pdf', c), ortam({ loTopluKapali: true }));
  assert.equal(cagrilar.length, 3);
  assert.deepEqual(s.ciktilar.map((x) => path.basename(x)), ['a.pdf', 'b.pdf', 'c.pdf']);
});

test('toplu: iptal edilirse AbortError fırlatılır', async (t) => {
  const eski = surec.calistir;
  t.after(() => { surec.calistir = eski; });
  surec.calistir = async () => { throw surec.iptalHatasi(); };
  const g = y.gecici(); const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const girdiler = dosyalar(g, ['a.txt', 'b.txt']);
  await assert.rejects(donustur(is(girdiler, 'pdf', c), ortam()), (e) => e.name === 'AbortError');
  assert.deepEqual(y.ls(c), []);
});
