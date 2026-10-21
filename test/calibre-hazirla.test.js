'use strict';
// Ne: scripts/calibre-hazirla.js yardımcı fonksiyonlarının testleri (MSI açılmaz, imza denetlenmez; saf mantık).
// Sahibi: Dosya dönüştürücü işi. Değiştirme kuralı: betik değişince birlikte güncellenir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('../scripts/calibre-hazirla');

const SURUM = h.surumOku();
const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-calibre-hazirla-'));
test.after(() => fs.rmSync(kok, { recursive: true, force: true }));
let sayac = 0;
const yeni = () => { const d = path.join(kok, 'k' + (++sayac)); fs.mkdirSync(d, { recursive: true }); return d; };
// En küçük geçerli PE: MZ başlığı, 0x3c'de PE ofseti, "PE\0\0" + Machine
function peYaz(yol, makine) {
  const b = Buffer.alloc(0x50);
  b.write('MZ', 0, 'latin1'); b.writeUInt32LE(0x40, 0x3c); b.write('PE\0\0', 0x40, 'latin1'); b.writeUInt16LE(makine, 0x44);
  fs.mkdirSync(path.dirname(yol), { recursive: true }); fs.writeFileSync(yol, b);
}
function paketYaz(d, { makine = 0x8664, lisans = true } = {}) {
  const c2 = path.join(d, 'PFiles64', 'Calibre2');
  peYaz(path.join(c2, 'ebook-convert.exe'), makine);
  peYaz(path.join(c2, 'app', 'bin', 'x.dll'), makine);
  peYaz(path.join(c2, 'app', 'bin', 'y.pyd'), 0x8664);
  fs.writeFileSync(path.join(c2, 'app', 'veri.txt'), 'x');
  if (lisans) fs.writeFileSync(path.join(c2, 'LICENSE'), 'GPL');
  return c2;
}

test('sürüm kaydı sabit ve tutarlı', () => {
  assert.equal(SURUM.surum, '9.16.0');
  assert.match(SURUM.sha256, /^[0-9a-f]{64}$/);
  assert.equal(SURUM.boyut, 238899200);
  assert.equal(SURUM.imzalayan, 'Kovid Goyal');
  assert.ok(SURUM.kaynak.startsWith('https://download.calibre-ebook.com/9.16.0/'));
});

test('modül require edilince main çalışmaz, yardımcılar dışa açıktır', () => {
  for (const ad of ['crlArgumanlari', 'kayitDogrula', 'msiKimligiDogrula', 'ebookConvertKlasoruBul', 'peTara', 'surumMetni', 'paketiYerlestir']) assert.equal(typeof h[ad], 'function');
});

test('crlArgumanlari: yalnız CALIBRE_CRL / CALIBRE_TSA_CRL, bypass yok', () => {
  assert.deepEqual(h.crlArgumanlari({}), []);
  assert.deepEqual(h.crlArgumanlari({ CALIBRE_CRL: '/a.pem', CALIBRE_TSA_CRL: '/b.pem', LIBREOFFICE_CRL: '/x' }), ['-CRLfile', '/a.pem', '-TSA-CRLfile', '/b.pem']);
});

test('msiKimligiDogrula: boyut ve SHA-256 ikisi de tutmalı', () => {
  assert.equal(h.msiKimligiDogrula(SURUM.boyut, SURUM.sha256.toUpperCase(), SURUM).tamam, true);
  assert.match(h.msiKimligiDogrula(SURUM.boyut + 1, SURUM.sha256, SURUM).neden, /boyut/);
  assert.match(h.msiKimligiDogrula(SURUM.boyut, 'ab'.repeat(32), SURUM).neden, /SHA-256/);
});

test('kayitDogrula: surumMetni çıktısı geçer; sürüm ya da SHA farkı reddedilir', () => {
  const metin = h.surumMetni(SURUM, 'CN=Kovid Goyal');
  assert.ok(metin.includes('Sahibi:') && metin.includes('GPL-3.0'));
  assert.equal(h.kayitDogrula(metin, SURUM).tamam, true);
  assert.equal(h.kayitDogrula(metin.replace('Calibre 9.16.0', 'Calibre 9.15.0'), SURUM).tamam, false);
  assert.equal(h.kayitDogrula(metin.replace(SURUM.sha256, 'ab'.repeat(32)), SURUM).tamam, false);
  assert.equal(h.kayitDogrula('', SURUM).tamam, false);
});

test('ebookConvertKlasoruBul ve peTara', () => {
  const d = yeni(); const c2 = paketYaz(d);
  assert.equal(h.ebookConvertKlasoruBul(d), c2);
  assert.equal(h.ebookConvertKlasoruBul(yeni()), null);
  const t = h.peTara(c2);
  assert.equal(t.sayi, 3); assert.deepEqual(t.sorunlar, []);
  const d2 = yeni(); const c = paketYaz(d2, { makine: 0x14c });
  assert.ok(h.peTara(c).sorunlar.length === 2);
});

test('paketiYerlestir: doğrulayıp yeniden adlandırır ve GOMULU-SURUM.txt yazar; hatada hedefe dokunmaz', () => {
  const d = yeni(); paketYaz(d); const hedef = path.join(d, 'calibre');
  assert.equal(h.paketiYerlestir(d, hedef, SURUM, 'CN=Kovid Goyal'), 3);
  assert.ok(fs.existsSync(path.join(hedef, 'ebook-convert.exe')) && fs.existsSync(path.join(hedef, 'LICENSE')));
  assert.equal(h.kayitDogrula(fs.readFileSync(path.join(hedef, 'GOMULU-SURUM.txt'), 'utf8'), SURUM).tamam, true);
  // x86 dosya -> hata, hedef oluşmaz
  const d2 = yeni(); paketYaz(d2, { makine: 0x14c }); const h2 = path.join(d2, 'calibre');
  assert.throws(() => h.paketiYerlestir(d2, h2, SURUM, 'x'), /x64/);
  assert.ok(!fs.existsSync(h2));
  // LICENSE yok -> hata
  const d3 = yeni(); paketYaz(d3, { lisans: false });
  assert.throws(() => h.paketiYerlestir(d3, path.join(d3, 'calibre'), SURUM, 'x'), /LICENSE/);
  // hedef zaten var -> üzerine yazılmaz
  const d4 = yeni(); paketYaz(d4); fs.mkdirSync(path.join(d4, 'calibre'));
  assert.throws(() => h.paketiYerlestir(d4, path.join(d4, 'calibre'), SURUM, 'x'), /üzerine yazılmaz/);
});

test('vendor/calibre varsa kaydı ve LICENSE tutarlı (geliştirici ortamı)', (t) => {
  const kayit = path.join(h.HEDEF, 'GOMULU-SURUM.txt');
  if (!fs.existsSync(kayit)) return t.skip('vendor/calibre yok');
  assert.equal(h.kayitDogrula(fs.readFileSync(kayit, 'utf8'), SURUM).tamam, true);
  assert.ok(fs.existsSync(path.join(h.HEDEF, 'ebook-convert.exe')) && fs.existsSync(path.join(h.HEDEF, 'LICENSE')));
});
