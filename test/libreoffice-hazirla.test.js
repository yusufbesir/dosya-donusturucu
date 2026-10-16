'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('../scripts/libreoffice-hazirla');

const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-lo-hazirla-'));
test.after(() => fs.rmSync(kok, { recursive: true, force: true }));
let sayac = 0;
const yeni = () => { const d = path.join(kok, 'k' + (++sayac)); fs.mkdirSync(d, { recursive: true }); return d; };
const yaz = (...p) => { fs.mkdirSync(path.dirname(path.join(...p)), { recursive: true }); fs.writeFileSync(path.join(...p), 'x'); };

test('modül require edilince main çalışmaz, yardımcılar dışa açıktır', () => {
  for (const ad of ['crlArgumanlari', 'ekKlasorBul', 'kopyaPlani', 'planiUygula', 'surumMetni']) assert.equal(typeof h[ad], 'function');
});

test('crlArgumanlari: yalnız verilen değişkenler -CRLfile/-TSA-CRLfile olur, bypass yok', () => {
  assert.deepEqual(h.crlArgumanlari({}), []);
  assert.deepEqual(h.crlArgumanlari({ LIBREOFFICE_CRL: '/a.crl' }), ['-CRLfile', '/a.crl']);
  assert.deepEqual(h.crlArgumanlari({ LIBREOFFICE_CRL: '/a.crl', LIBREOFFICE_TSA_CRL: '/b.crl' }), ['-CRLfile', '/a.crl', '-TSA-CRLfile', '/b.crl']);
});

test('ekKlasorBul: büyük/küçük harf duyarsız, LibreOffice klasörünü hariç tutar', () => {
  const d = yeni();
  const lo = path.join(d, 'LibreOffice:.');
  yaz(lo, 'program', 'soffice.exe');
  yaz(lo, 'share', 'fonts', 'a.ttf');
  yaz(d, 'FONTS', 'b.ttf');
  yaz(d, 'system64', 'vcruntime140.dll');
  yaz(d, 'System', 'x.dll');
  assert.equal(h.sofficeKlasoruBul(d), lo);
  assert.equal(h.ekKlasorBul(d, ['Fonts'], lo), path.join(d, 'FONTS'));
  assert.equal(h.ekKlasorBul(d, ['System64'], lo), path.join(d, 'system64'));
  assert.equal(h.ekKlasorBul(d, ['Yok'], lo), null);
});

test('kopyaPlani + planiUygula: DLL program/ altına, yazı tipi share/fonts/truetype/ altına gider', () => {
  const d = yeni(); const hedef = path.join(d, 'h'); const s64 = path.join(d, 'System64'); const f = path.join(d, 'Fonts');
  yaz(hedef, 'program', 'soffice.exe');
  yaz(s64, 'vcruntime140.dll'); yaz(s64, 'not.txt');
  yaz(f, 'A.TTF'); yaz(f, 'b.otf'); yaz(f, 'oku.txt');
  assert.equal(h.planiUygula(h.kopyaPlani(s64, hedef, 'program', ['.dll']), hedef), 1);
  assert.equal(h.planiUygula(h.kopyaPlani(f, hedef, path.join('share', 'fonts', 'truetype'), ['.ttf', '.otf']), hedef), 2);
  assert.ok(fs.existsSync(path.join(hedef, 'program', 'vcruntime140.dll')));
  assert.ok(fs.existsSync(path.join(hedef, 'share', 'fonts', 'truetype', 'A.TTF')));
  assert.ok(!fs.existsSync(path.join(hedef, 'program', 'not.txt')));
});

test('kopyaPlani: hedefte aynı adlı dosya varsa hata, üzerine yazılmaz', () => {
  const d = yeni(); const hedef = path.join(d, 'h'); const s64 = path.join(d, 'System64');
  yaz(hedef, 'program', 'msvcp140.dll'); yaz(s64, 'msvcp140.dll');
  fs.writeFileSync(path.join(hedef, 'program', 'msvcp140.dll'), 'eski');
  assert.throws(() => h.kopyaPlani(s64, hedef, 'program', ['.dll']), /üzerine yazılmaz/);
  assert.equal(fs.readFileSync(path.join(hedef, 'program', 'msvcp140.dll'), 'utf8'), 'eski');
  assert.throws(() => h.planiUygula([{ kaynak: path.join(s64, 'msvcp140.dll'), hedef: path.join(hedef, 'program', 'msvcp140.dll') }], hedef));
  assert.equal(fs.readFileSync(path.join(hedef, 'program', 'msvcp140.dll'), 'utf8'), 'eski');
});

test('kopyaPlani: symlink reddedilir, yol dışarı taşamaz', (t) => {
  const d = yeni(); const hedef = path.join(d, 'h'); const s64 = path.join(d, 'System64');
  fs.mkdirSync(hedef); yaz(d, 'dis.dll');
  fs.mkdirSync(s64);
  try { fs.symlinkSync(path.join(d, 'dis.dll'), path.join(s64, 'link.dll')); } catch { t.skip('symlink kurulamadı'); return; }
  assert.throws(() => h.kopyaPlani(s64, hedef, 'program', ['.dll']), /Normal dosya değil/);
  assert.throws(() => h.kopyaPlani(s64, hedef, '../disari', ['.dll']), /dışarı taşıyor/);
});

test('surumMetni: açıklama satırı ve gerekli alanlar', () => {
  const m = h.surumMetni({ surum: '26.8.1', kaynak: 'https://ornek/x.msi', sha256: 'ab' }, 'O=The Document Foundation');
  assert.match(m.split('\n')[0], /^Ne: Dosya Dönüştürücü'ye gömülü LibreOffice paketinin kimlik kartı\. Sahibi: Yusuf Beşir/);
  for (const p of ['26.8.1', 'https://ornek/x.msi', 'MSI SHA-256: ab', 'The Document Foundation', 'share/fonts/truetype/', 'MPL-2.0', 'yeniden dağıtım izniyle', 'source-code']) assert.ok(m.includes(p), p);
});
