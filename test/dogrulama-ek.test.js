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
