'use strict';
// TaaDön 1.6.0 T1 testleri: yeni ayarlar (ciktiYeri, sonek, ozgunTasi), secenekTemizle (pdfa, pdfKalite),
// argv süzme (sağ tık / komut satırı), preload dosyalarDinle, is-ekle kaynak klasörü mantığı.
// Sahip: Yusuf. yazan: [Claude#taadon-T1] — ORTAK-AJAN-KURALLARI çerçevesinde değiştirilebilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../dogrulama');

const KOK = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(KOK, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(KOK, 'preload.js'), 'utf8');
const ctxBos = () => ({ izinli: new D.YolKumesi(), izinliKlasorler: new D.YolKumesi() });

test('ayarDogrula: ciktiYeri', () => {
  assert.equal(D.ayarDogrula('ciktiYeri', 'klasor', ctxBos()), 'klasor');
  assert.equal(D.ayarDogrula('ciktiYeri', 'kaynak', ctxBos()), 'kaynak');
  for (const k of ['', 'KAYNAK', 'masaustu', null, 1, true, ['kaynak']]) {
    assert.throws(() => D.ayarDogrula('ciktiYeri', k, ctxBos()), /çıktı yeri/);
  }
});

test('ayarDogrula: sonek', () => {
  for (const s of ['', '-donusturuldu', '_v2', ' kopya', 'a.b-c_d 1', 'x'.repeat(20)]) {
    assert.equal(D.ayarDogrula('sonek', s, ctxBos()), s);
  }
  for (const s of ['x'.repeat(21), '/a', '\\a', 'a:b', 'ş', '<>', 'a\0', '..\\x', 5, null, undefined, {}]) {
    assert.throws(() => D.ayarDogrula('sonek', s, ctxBos()), /Sonek/);
  }
});

test('ayarDogrula: ozgunTasi yalnız boolean', () => {
  assert.equal(D.ayarDogrula('ozgunTasi', true, ctxBos()), true);
  assert.equal(D.ayarDogrula('ozgunTasi', false, ctxBos()), false);
  for (const v of ['true', 1, 0, null, undefined, 'false']) {
    assert.throws(() => D.ayarDogrula('ozgunTasi', v, ctxBos()), /Geçersiz/);
  }
  assert.throws(() => D.ayarDogrula('bilinmeyen', 1, ctxBos()), /Bilinmeyen ayar/);
});

test('secenekTemizle: pdfa ve pdfKalite', () => {
  const izinli = new D.YolKumesi();
  assert.deepEqual(D.secenekTemizle({ pdfa: true, pdfKalite: 'yuksek' }, izinli), { pdfa: true, pdfKalite: 'yuksek' });
  assert.deepEqual(D.secenekTemizle({ pdfa: false, pdfKalite: 'dusuk' }, izinli), { pdfa: false, pdfKalite: 'dusuk' });
  assert.deepEqual(D.secenekTemizle({ pdfKalite: 'orta' }, izinli), { pdfKalite: 'orta' });
  assert.throws(() => D.secenekTemizle({ pdfa: 'evet' }, izinli), /PDF\/A/);
  assert.throws(() => D.secenekTemizle({ pdfa: 1 }, izinli), /PDF\/A/);
  assert.throws(() => D.secenekTemizle({ pdfKalite: 'kucuk' }, izinli), /PDF kalitesi/);
  assert.throws(() => D.secenekTemizle({ pdfKalite: 'YUKSEK' }, izinli), /PDF kalitesi/);
});

test('argvSuz: exe/uygulama yolu, "--" ve bayraklar ayıklanır', () => {
  const kok = path.resolve(os.tmpdir());
  const a = path.join(kok, 'a.pdf');
  const b = path.join(kok, 'b c.docx');
  const argv = ['C:\\TaaDön\\TaaDön.exe', '--allow-file-access-from-files', '--', a, '-x', '--original-process-start-time=1', b, a, '', 42];
  assert.deepEqual(D.argvSuz(argv, { atla: 1 }), [a, b]);
  // Geliştirme: electron + uygulama yolu atlanır
  assert.deepEqual(D.argvSuz(['electron', kok, a], { atla: 2 }), [a]);
  // Göreli yol: çalışma klasörü yoksa atılır, varsa çözülür
  assert.deepEqual(D.argvSuz(['exe', 'goreli.pdf'], { atla: 1 }), []);
  assert.deepEqual(D.argvSuz(['exe', 'goreli.pdf'], { atla: 1, calismaKlasoru: kok }), [path.join(kok, 'goreli.pdf')]);
  assert.deepEqual(D.argvSuz(null), []);
  // Üst sınır
  const cok = ['exe', ...Array.from({ length: 600 }, (_, i) => path.join(kok, `d${i}.pdf`))];
  assert.equal(D.argvSuz(cok).length, D.MAKS_ARGV_DOSYA);
  assert.equal(D.MAKS_ARGV_DOSYA, 500);
});

test('argvDosyalari: yalnız var olan normal dosya ve tanınan uzantı', () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-t1-'));
  try {
    const pdf = path.join(k, 'a.pdf'); fs.writeFileSync(pdf, '%PDF-');
    const exe = path.join(k, 'k.exe'); fs.writeFileSync(exe, 'MZ');
    const alt = path.join(k, 'alt.pdf'); fs.mkdirSync(alt);
    const yok = path.join(k, 'yok.pdf');
    const taninan = (u) => ['pdf', 'docx'].includes(u);
    assert.deepEqual(D.argvDosyalari(['exe', pdf, exe, alt, yok, '--', k], { atla: 1 }, taninan), [pdf]);
  } finally { fs.rmSync(k, { recursive: true, force: true }); }
});

test('preload: dosyalarDinle tek dinleyici ve dosyalar-eklendi kanalı', () => {
  assert.match(preload, /\bdosyalarDinle: \(cb\) =>/);
  const blok = /dosyalarDinle: \(cb\) => \{[\s\S]*?\n {2}\}/.exec(preload)[0];
  assert.match(blok, /removeAllListeners\('dosyalar-eklendi'\)/);
  assert.match(blok, /ipcRenderer\.on\('dosyalar-eklendi'/);
  assert.match(blok, /Array\.isArray\(yollar\)/);
});

test('main: second-instance argv, ilk açılış argv ve dosyalar-eklendi', () => {
  assert.match(main, /app\.on\('second-instance', \(_e, argv, calismaKlasoru\)/);
  assert.match(main, /D\.argvDosyalari\(argv/);
  assert.match(main, /izinliDosyalar\.ekle\(y\)/);
  assert.match(main, /arayuzeGonder\('dosyalar-eklendi'/);
  assert.match(main, /komutSatiriDosyalari\(process\.argv/);
  const si = /app\.on\('second-instance'[\s\S]*?\n {2}\}\);/.exec(main)[0];
  assert.match(si, /olustur\(\)/);
  assert.match(si, /pencere\.focus\(\)/);
  assert.match(main, /D\.isHazirla\(ham,/);
  assert.match(main, /ciktiYeri: 'klasor'/);
});

test('isHazirla / kaynakCiktiKlasoru: kaynak klasörü mantığı', () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-t1-'));
  try {
    const kaynakK = path.join(k, 'kaynak'); fs.mkdirSync(kaynakK);
    const ciktiK = path.join(k, 'cikti'); fs.mkdirSync(ciktiK);
    const girdi = path.join(kaynakK, 'belge.pdf'); fs.writeFileSync(girdi, '%PDF-');
    const yabanci = path.join(k, 'yabanci.pdf'); fs.writeFileSync(yabanci, '%PDF-');
    const yeniCtx = (ayarlar) => {
      const izinli = new D.YolKumesi(); izinli.ekle(girdi);
      const izinliKlasorler = new D.YolKumesi(); izinliKlasorler.ekle(ciktiK);
      return { izinli, izinliKlasorler, id: 'i1', hedeflerFn: (u) => (u === 'pdf' ? [{ hedef: 'docx' }] : []), islemKumesi: D.islemAdlari([]), ayarlar };
    };
    const ham = { girdiler: [girdi], hedef: 'docx', ciktiKlasoru: ciktiK };

    // 'klasor': ciktiKlasoru değişmez; sonek/ozgunTasi ayarlardan eklenir
    let c = yeniCtx({ ciktiYeri: 'klasor', sonek: '-yeni', ozgunTasi: true });
    let is = D.isHazirla(ham, c);
    assert.equal(is.ciktiKlasoru, path.resolve(ciktiK));
    assert.equal(is.sonek, '-yeni');
    assert.equal(is.ozgunTasi, true);
    assert.equal(c.izinliKlasorler.var(kaynakK), false);

    // 'kaynak': ilk girdinin klasörü, izinliKlasorler'e eklenir; ham değişmez
    c = yeniCtx({ ciktiYeri: 'kaynak' });
    is = D.isHazirla(Object.assign({}, ham, { ciktiKlasoru: undefined }), c);
    assert.equal(is.ciktiKlasoru, path.resolve(kaynakK));
    assert.equal(c.izinliKlasorler.var(kaynakK), true);
    assert.equal(is.sonek, '');
    assert.equal(is.ozgunTasi, false);
    assert.equal(ham.ciktiKlasoru, ciktiK);

    // 'kaynak' ama ilk girdi izinli değil: klasör eklenmez, reddedilir
    c = yeniCtx({ ciktiYeri: 'kaynak' });
    assert.throws(() => D.isHazirla({ girdiler: [yabanci], hedef: 'docx' }, c), /seçilmemiş/);
    assert.equal(c.izinliKlasorler.var(k), false);
    assert.throws(() => D.kaynakCiktiKlasoru({ girdiler: [] }, 'kaynak', c), /girdi listesi/);

    // Geçersiz sonek ayarı işe geçmez; ozgunTasi yalnız true ise true
    c = yeniCtx({ ciktiYeri: 'klasor', sonek: '../x', ozgunTasi: 'evet' });
    is = D.isHazirla(ham, c);
    assert.equal(is.sonek, '');
    assert.equal(is.ozgunTasi, false);

    // kaynakCiktiKlasoru 'klasor' iken aynı nesneyi döndürür
    assert.equal(D.kaynakCiktiKlasoru(ham, 'klasor', c), ham);
  } finally { fs.rmSync(k, { recursive: true, force: true }); }
});
