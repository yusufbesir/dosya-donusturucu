// TaaDön doğrulama.js ek testleri (yazan: Claude). Yalnız dogrulama.js davranışını denetler; kuralları gevşetmeden eklenebilir.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../dogrulama');

const hedeflerSahte = (u) => (u === 'pdf' ? [{ hedef: 'docx' }, { hedef: 'txt' }] : []);

test('biçim hedeflerinde uzantı denetimi atlanmaz', () => {
  const islemler = D.islemAdlari([{ id: 'docx', hedef: 'docx' }, { id: 'kirp', hedef: 'kirp' }, { id: 'mp3-a', hedef: 'mp3' }, { id: 'zip' }]);
  // hedef === id olan kayıt işlem sayılır; hedef !== id olan (biçim) sayılmaz
  assert.ok(islemler.has('kirp') && !islemler.has('mp3'));
  const sadeceBicim = D.islemAdlari([{ id: 'dönüştür', hedef: 'docx' }, { id: 'x', hedef: 'mp3' }]);
  assert.ok(!sadeceBicim.has('docx') && !sadeceBicim.has('mp3'));
  assert.throws(() => D.hedefDogrula('docx', ['exe'], hedeflerSahte, sadeceBicim), /izinli değil/);
  assert.equal(D.hedefDogrula('docx', ['pdf'], hedeflerSahte, sadeceBicim), 'docx');
});

test('guvenliAd ayrılmış adlar ve sondaki nokta/boşluk', () => {
  assert.equal(D.guvenliAd('/x/nul.pdf'), '_nul');
  assert.equal(D.guvenliAd('/x/COM1.txt'), '_COM1');
  assert.equal(D.guvenliAd('/x/lpt9.a.b'), '_lpt9.a');
  assert.equal(D.guvenliAd('/x/...pdf'), 'dosya');
  assert.equal(D.guvenliAd('/x/a.pdf.'), 'a.pdf');
  assert.equal(D.guvenliAd('/x/rapor', '-1'), 'rapor-1');
});

test('tamSayi sıkı', () => {
  assert.equal(D.ayarDogrula('esZamanli', 2, {}), 2);
  assert.equal(D.ayarDogrula('esZamanli', '3', {}), 3);
  for (const v of [true, '0x40', '1e1', ' 12 ', '-1', '12345678', 1.5, [], {}]) {
    assert.throws(() => D.secenekTemizle({ fps: v }), undefined, String(v));
  }
});

test('sayfalar satır sonu/sekme reddeder', () => {
  assert.deepEqual(D.secenekTemizle({ sayfalar: '1-3, 5' }), { sayfalar: '1-3, 5' });
  assert.throws(() => D.secenekTemizle({ sayfalar: '1\n2' }));
  assert.throws(() => D.secenekTemizle({ sayfalar: '1\t2' }));
  assert.throws(() => D.secenekTemizle({ sayfalar: '1'.repeat(201) }));
});

test('açılabilir uzantılar ve PDF okuma sınırı', () => {
  assert.ok(!D.ACILABILIR_UZANTILAR.has('html') && !D.ACILABILIR_UZANTILAR.has('htmlz'));
  assert.equal(D.LIMITLER.maksPdfOkuBayt, 256 * 1024 * 1024);
});

test('acilabilirCiktiDogrula', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-ac-'));
  try {
    const pdf = path.join(dir, 'a.pdf'); fs.writeFileSync(pdf, 'x');
    const exe = path.join(dir, 'a.exe'); fs.writeFileSync(exe, 'x');
    const kl = path.join(dir, 'k.pdf'); fs.mkdirSync(kl);
    const silinmis = path.join(dir, 'yok.pdf');
    const baska = path.join(dir, 'b.pdf'); fs.writeFileSync(baska, 'x');
    const u = new D.YolKumesi();
    [pdf, exe, kl, silinmis].forEach((y) => u.ekle(y));
    assert.equal(D.acilabilirCiktiDogrula(pdf, u), path.resolve(pdf));
    assert.throws(() => D.acilabilirCiktiDogrula(baska, u), /ürettiği/);
    assert.throws(() => D.acilabilirCiktiDogrula('goreli.pdf', u), /ürettiği/);
    assert.throws(() => D.acilabilirCiktiDogrula(exe, u), /açılmaz/);
    assert.throws(() => D.acilabilirCiktiDogrula(silinmis, u), /artık yok/);
    assert.throws(() => D.acilabilirCiktiDogrula(kl, u), /normal dosya/);
    const sb = path.join(dir, 'sb.pdf');
    let sembolikVar = true;
    try { fs.symlinkSync(pdf, sb); } catch { sembolikVar = false; }
    if (sembolikVar) { u.ekle(sb); assert.throws(() => D.acilabilirCiktiDogrula(sb, u), /normal dosya/); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 1.9.0 paket C: Özellikler ayarları, tekPdf seçeneği, tek PDF birleştirme [Claude#taadon-1.9-paket-c 2026-11-04] ----
test('1.9.0: Özellikler anahtarları yalnız boolean kabul eder', () => {
  const ctx = { izinli: new D.YolKumesi(), izinliKlasorler: new D.YolKumesi() };
  assert.deepEqual([...D.OZELLIK_ANAHTARLARI], ['ozOnizleme', 'ozGorevCubugu', 'ozPano', 'ozBicimAlgila', 'ozPdfBirlestir', 'ozIsitma']);
  for (const k of D.OZELLIK_ANAHTARLARI) {
    assert.equal(D.ayarDogrula(k, true, ctx), true);
    assert.equal(D.ayarDogrula(k, false, ctx), false);
    for (const kotu of ['true', 1, 0, null, undefined, {}]) assert.throws(() => D.ayarDogrula(k, kotu, ctx), /Geçersiz değer/, `${k}=${String(kotu)}`);
  }
  assert.throws(() => D.ayarDogrula('ozBilinmeyen', true, ctx), /Bilinmeyen/);
});

test('1.9.0: secenekTemizle tekPdf yalnız boolean; false atılır', () => {
  const izinli = new D.YolKumesi();
  assert.deepEqual(D.secenekTemizle({ tekPdf: true }, izinli), { tekPdf: true });
  assert.deepEqual(D.secenekTemizle({ tekPdf: false }, izinli), {});
  assert.deepEqual(D.secenekTemizle({ tekPdf: true, pdfKalite: 'orta' }, izinli), { tekPdf: true, pdfKalite: 'orta' });
  for (const kotu of ['true', 1, {}]) assert.throws(() => D.secenekTemizle({ tekPdf: kotu }, izinli), /tek PDF/);
});

test('1.9.0: pdfleriBirlestir sırayla "<ilk ad> (birleşik).pdf" üretir, ara PDF\'lere dokunmaz', async () => {
  const { PDFDocument } = require('pdf-lib');
  const { pdfleriBirlestir } = require('../src/donustur');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-birlesik-'));
  try {
    const yap = async (ad, n) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([100 + i, 100]); const y = path.join(dir, ad); fs.writeFileSync(y, await d.save()); return y; };
    const a = await yap('rapor.pdf', 2);
    const b = await yap('ek.pdf', 3);
    const cikti = await pdfleriBirlestir([a, b], dir, 'rapor (birleşik)');
    assert.equal(path.basename(cikti), 'rapor (birleşik).pdf');
    const doc = await PDFDocument.load(fs.readFileSync(cikti));
    assert.equal(doc.getPageCount(), 5);
    assert.equal(Math.round(doc.getPage(0).getWidth()), 100);
    assert.ok(fs.existsSync(a) && fs.existsSync(b), 'ara PDF\'ler yerinde kalır (çöpe taşımayı ana süreç yapar)');
    const ikinci = await pdfleriBirlestir([a, b], dir, 'rapor (birleşik)');
    assert.equal(path.basename(ikinci), 'rapor (birleşik) (1).pdf', 'üzerine yazılmaz');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- 1.10.0 Yönetici paneli saf işlevleri [Claude#taadon-1.10-yonetici 2026-11-04] ---------- */
test('pinGecerli: yalnız 4-8 haneli rakam dizgesi', () => {
  for (const p of ['1234', '00000000', '987654']) assert.equal(D.pinGecerli(p), true, p);
  for (const p of ['123', '123456789', '12a4', ' 1234', '', null, 1234, '١٢٣٤']) assert.equal(D.pinGecerli(p), false, String(p));
});

test('pinOzeti: SHA-256 hex, kararlı; eşleşme sabit süreli; düz PIN özetin içinde yok', () => {
  const o = D.pinOzeti('2468');
  assert.match(o, /^[0-9a-f]{64}$/);
  assert.equal(o, D.pinOzeti('2468'));
  assert.notEqual(o, D.pinOzeti('2469'));
  assert.equal(D.pinEslesir('2468', o), true);
  assert.equal(D.pinEslesir('2469', o), false);
  assert.equal(D.pinEslesir('2468', ''), false);
  assert.equal(D.pinEslesir('24', o), false);
  assert.throws(() => D.pinOzeti('12'), (e) => /4-8 haneli/.test(e.message) && !e.message.includes('12'));
});

test('pin deneme sayacı: 5 yanlışta 60 sn bekleme, süre bitince sıfırlanır', () => {
  let t = 1000;
  const s = D.pinDenemeSayaci({ maks: 5, beklemeMs: 60000, saat: () => t });
  for (let i = 0; i < 4; i++) { assert.equal(s.bekleme(), 0); s.basarisiz(); }
  assert.equal(s.bekleme(), 0);
  s.basarisiz();
  assert.equal(s.bekleme(), 60000);
  t += 30000; assert.equal(s.bekleme(), 30000);
  t += 30001; assert.equal(s.bekleme(), 0);
  assert.equal(s.yanlis, 0);
  s.basarisiz(); s.sifirla(); assert.equal(s.yanlis, 0);
});

test('ayarDogrula: yoneticiPinOzeti 64 hex ya da boş; ozYonetici boolean', () => {
  const ctx = { izinli: new D.YolKumesi(), izinliKlasorler: new D.YolKumesi() };
  const o = D.pinOzeti('1357');
  assert.equal(D.ayarDogrula('yoneticiPinOzeti', o, ctx), o);
  assert.equal(D.ayarDogrula('yoneticiPinOzeti', '', ctx), '');
  assert.throws(() => D.ayarDogrula('yoneticiPinOzeti', '1357', ctx), /PIN özeti/);
  assert.throws(() => D.ayarDogrula('yoneticiPinOzeti', o.toUpperCase(), ctx), /PIN özeti/);
  assert.equal(D.ayarDogrula('ozYonetici', false, ctx), false);
  assert.throws(() => D.ayarDogrula('ozYonetici', 'evet', ctx), /Geçersiz/);
  assert.ok(!D.OZELLIK_ANAHTARLARI.includes('ozYonetici'));
});

test('yolMaskele: kullanıcı adı yol içinde %USER% olur (JSON kaçışlı yollar dahil)', () => {
  const yol = 'C:\\Users\\Ali Veli\\AppData\\Roaming\\TaaDön\\ayarlar.json';
  const beklenen = 'C:\\Users\\%USER%\\AppData\\Roaming\\TaaDön\\ayarlar.json';
  assert.equal(D.yolMaskele(yol, ['Ali Veli']), beklenen);
  assert.equal(D.yolMaskele(JSON.stringify({ y: yol }), ['ali veli']), JSON.stringify({ y: beklenen }));
  assert.equal(D.yolMaskele('/home/yusuf/x yusufcan', ['yusuf']), '/home/%USER%/x yusufcan');
  assert.equal(D.yolMaskele('a/b', ['', 'b']), 'a/b', 'tek karakterli ad atlanır');
  assert.equal(D.yolMaskele('C:\\Users\\a.b+c\\x', ['a.b+c']), 'C:\\Users\\%USER%\\x', 'düzenli ifade karakterleri kaçışlanır');
});

test('taniAyarlari: PIN özeti maskelenir, özgün nesne değişmez', () => {
  const a = { yoneticiPinOzeti: D.pinOzeti('1111'), tema: 'koyu' };
  const t = D.taniAyarlari(a);
  assert.equal(t.yoneticiPinOzeti, '(maskeli)');
  assert.equal(t.tema, 'koyu');
  assert.match(a.yoneticiPinOzeti, /^[0-9a-f]{64}$/);
  assert.equal(D.taniAyarlari({ yoneticiPinOzeti: '' }).yoneticiPinOzeti, '');
});
