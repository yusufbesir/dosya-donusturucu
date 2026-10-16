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

const SURUM = { surum: '26.8.1', sha256: 'c6298b10cfa1748bcbedad94c62ce771e240e5021bfd6d7a967cd571b04b5312' };

test('kayitDogrula: elle yazılmış, parantezli ek metinli kaydı tanır', () => {
  const m = 'Ne: x\n\nLibreOffice 26.8.1 (dosyaları değiştirilmemiş)\nMSI SHA-256: ' + SURUM.sha256 + ' (resmi .sha256 ile eşleşti)\n';
  assert.equal(h.kayitDogrula(m, SURUM).tamam, true);
});

test('kayitDogrula: surumMetni çıktısı ve eski "SHA-256:" biçimi kabul edilir', () => {
  assert.equal(h.kayitDogrula(h.surumMetni({ ...SURUM, kaynak: 'k' }, 'O=x'), SURUM).tamam, true);
  assert.equal(h.kayitDogrula('LibreOffice 26.8.1\nSHA-256: ' + SURUM.sha256.toUpperCase() + '\n', SURUM).tamam, true);
});

test('kayitDogrula: eşleşmeyen sha, sürüm, kısa/uzun hex ve eksik satır reddedilir', () => {
  const ok = (s, v = '26.8.1') => `Sürüm: LibreOffice ${v} (x)\nMSI SHA-256: ${s}\n`;
  assert.equal(h.kayitDogrula(ok('0'.repeat(64)), SURUM).tamam, false);
  assert.equal(h.kayitDogrula(ok(SURUM.sha256, '26.8.2'), SURUM).tamam, false);
  assert.equal(h.kayitDogrula(ok(SURUM.sha256.slice(0, 63)), SURUM).tamam, false);
  assert.equal(h.kayitDogrula(ok(SURUM.sha256 + 'a'), SURUM).tamam, false);
  assert.equal(h.kayitDogrula('LibreOffice 26.8.1\n', SURUM).tamam, false);
  assert.equal(h.kayitDogrula('MSI SHA-256: ' + SURUM.sha256, SURUM).tamam, false);
  assert.equal(h.kayitDogrula('', SURUM).tamam, false);
});

test('kayitDogrula: gerçek vendor kaydı (varsa) salt-okunur doğrulanır', (t) => {
  const yol = path.join(__dirname, '..', 'vendor', 'libreoffice', 'GOMULU-SURUM.txt');
  if (!fs.existsSync(yol)) { t.skip('kayıt yok'); return; }
  const gercek = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'libreoffice-surum.json'), 'utf8'));
  assert.equal(h.kayitDogrula(fs.readFileSync(yol, 'utf8'), gercek).tamam, true);
});

test('imzaciDogruMu: Windows ve Linux konu biçimleri', () => {
  assert.equal(h.imzaciDogruMu('CN=The Document Foundation, O=The Document Foundation, L=Berlin, S=Berlin, C=DE'), true);
  assert.equal(h.imzaciDogruMu('/C=DE/ST=Berlin/L=Berlin/O=The Document Foundation/CN=The Document Foundation'), true);
  assert.equal(h.imzaciDogruMu('CN="The Document Foundation", O="The Document Foundation", C=DE'), true);
});

test('imzaciDogruMu: alt dize, ek, eksik ve enjeksiyon denemeleri reddedilir', () => {
  const kotu = [
    'CN=The Document Foundation, O=The Document Foundation Evil, C=DE',
    '/C=DE/O=The Document Foundation Evil/CN=The Document Foundation',
    'CN=The Document Foundation, O=Evil, OU=O=The Document Foundation',
    'CN=The Document Foundation, O="Evil, O=The Document Foundation"',
    'CN=Evil, O=The Document Foundation',
    'O=The Document Foundation',
    'CN=The Document Foundation, O=The Document Foundation, O=Evil',
    'CN=Evil The Document Foundation, O=The Document Foundation',
    '/O=Evil/CN=x/O=The Document Foundation/CN=The Document Foundation',
    '', undefined,
  ];
  for (const k of kotu) assert.equal(h.imzaciDogruMu(k), false, String(k));
});

test('konuAyristir: virgül/tırnak/kaçış', () => {
  assert.deepEqual(h.konuAyristir('CN="A, B", O=C\\, D').CN, ['A, B']);
  assert.deepEqual(h.konuAyristir('CN="A, B", O=C\\, D').O, ['C, D']);
});

test('pythonBilesenMi: listedeki öğeler, büyük/küçük harf ve alt yollar eşleşir', () => {
  for (const y of ['program/pythonloaderlo.dll', 'Program/PyUno.pyd', 'program/python313.dll', 'program/python3.dll', 'program/python-core-3.13.1/lib/x.py',
    'program/__pycache__/a.pyc', 'share/Scripts/python/x.py', 'share/registry/LibreLogo.xcd', 'program\\python.exe']) assert.equal(h.pythonBilesenMi(y), true, y);
  for (const y of ['program/soffice.exe', 'program/python.txt', 'program/python2.dll', 'share/Scripts/javascript/x.js', 'share/registry/main.xcd', 'x/program/pyuno.pyd']) assert.equal(h.pythonBilesenMi(y), false, y);
});

test('pythonBilesenMi: mutlak yol, .. ve boş girdi reddedilir', () => {
  for (const y of ['/program/pyuno.pyd', 'C:\\program\\pyuno.pyd', '../program/pyuno.pyd', 'program/../program/pyuno.pyd', '', null, undefined]) assert.equal(h.pythonBilesenMi(y), false, String(y));
});

test('pythonBilesenleriCikar: yalnız Python bileşenlerini kaldırır, kritik yoksa kritikVar false', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-py-'));
  try {
    const yaz = (g) => { const y = path.join(kok, g); fs.mkdirSync(path.dirname(y), { recursive: true }); fs.writeFileSync(y, 'x'); };
    ['program/soffice.exe', 'program/pythonloaderlo.dll', 'program/python313.dll', 'program/python-core-3.13/lib/a.py', 'share/Scripts/python/b.py', 'share/registry/librelogo.xcd', 'share/registry/main.xcd'].forEach(yaz);
    const r = h.pythonBilesenleriCikar(kok);
    assert.equal(r.kritikVar, true);
    assert.equal(r.cikarilan.length, 5);
    assert.ok(fs.existsSync(path.join(kok, 'program', 'soffice.exe')) && fs.existsSync(path.join(kok, 'share', 'registry', 'main.xcd')));
    assert.ok(!fs.existsSync(path.join(kok, 'program', 'python-core-3.13')));
    assert.equal(h.pythonBilesenleriCikar(kok).kritikVar, false);
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('surumMetni: Python çıkarıldı notu var ve kayitDogrula hâlâ tanır', () => {
  const m = h.surumMetni({ ...SURUM, kaynak: 'k' }, 'O=x');
  assert.ok(m.includes('dosyaları değiştirilmemiş; yalnız Python betik bileşenleri çıkarıldı'));
  assert.ok(m.includes('Python betik desteği (pyuno, Python çalışma zamanı, LibreLogo) Windows\'ta Writer dönüşümlerini kilitlediği ve gerekmediği için pakete alınmadı'));
  assert.equal(h.kayitDogrula(m, SURUM).tamam, true);
});

// ---- VC++ DLL mimari denetimi ----
function sahtePe(makine) {
  const b = Buffer.alloc(0x100);
  b.write('MZ', 0, 'latin1'); b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1'); b.writeUInt16LE(makine, 0x84);
  return b;
}

test('peMakine: x64 ve ARM64 Machine değerlerini okur, bozuk dosyada hata verir', () => {
  const d = yeni();
  fs.writeFileSync(path.join(d, 'x64.dll'), sahtePe(0x8664));
  fs.writeFileSync(path.join(d, 'arm.dll'), sahtePe(0xAA64));
  fs.writeFileSync(path.join(d, 'mz.dll'), 'hello world, not a PE file at all, padding padding padding padding padding!!');
  fs.writeFileSync(path.join(d, 'kisa.dll'), 'MZ');
  const pe = sahtePe(0x8664); pe.write('XX', 0x80, 'latin1');
  fs.writeFileSync(path.join(d, 'pesiz.dll'), pe);
  assert.equal(h.peMakine(path.join(d, 'x64.dll')), 0x8664);
  assert.equal(h.peMakine(path.join(d, 'arm.dll')), 0xAA64);
  for (const a of ['mz.dll', 'kisa.dll', 'pesiz.dll']) assert.throws(() => h.peMakine(path.join(d, a)));
});

test('vcMimariDenetle: x64 geçer, arm64 kalır, eksik dosya sorun değil', () => {
  const d = yeni();
  assert.deepEqual(h.vcMimariDenetle(d), []);
  fs.writeFileSync(path.join(d, 'msvcp140.dll'), sahtePe(0x8664));
  fs.writeFileSync(path.join(d, 'vcruntime140.dll'), sahtePe(0x8664));
  assert.deepEqual(h.vcMimariDenetle(d), []);
  fs.writeFileSync(path.join(d, 'concrt140.dll'), sahtePe(0xAA64));
  fs.writeFileSync(path.join(d, 'vccorlib140.dll'), 'bozuk');
  const s = h.vcMimariDenetle(d);
  assert.equal(s.length, 2);
  assert.ok(s.some((x) => x.startsWith('concrt140.dll') && x.includes('AA64')));
  assert.ok(s.some((x) => x.startsWith('vccorlib140.dll')));
});

test('amd64Eslestir: 7za -slt çıktısından yalnız amd64 girdilerini gerçek adla eşleştirir', () => {
  const g = 'DFEFC2FE_EEE6_424C_841B_D4E66F0C84A3';
  const metin = [
    '7-Zip', '----', `Path = msvcp140.dll_amd64.${g}`, 'Size = 1', '',
    `Path = msvcp140.dll_arm64.${g}`, '', `Path = VCRUNTIME140.DLL_AMD64.${g}`, '',
    'Path = soffice.exe.ABC', '', `Path = x/y.dll_amd64.${g}`, '',
  ].join('\r\n');
  assert.deepEqual(h.amd64Eslestir(metin), [
    { girdi: `msvcp140.dll_amd64.${g}`, ad: 'msvcp140.dll' },
    { girdi: `VCRUNTIME140.DLL_AMD64.${g}`, ad: 'VCRUNTIME140.DLL' },
  ]);
  assert.deepEqual(h.amd64Eslestir(''), []);
  assert.throws(() => h.amd64Eslestir(`Path = a.dll_amd64.${g}\nPath = A.dll_amd64.${g.replace('D', 'E')}`));
});

test('surumMetni: VC++ DLL\'lerinin x64 olduğunu belirtir', () => {
  assert.ok(h.surumMetni({ surum: '1.0', kaynak: 'k', sha256: 'a'.repeat(64) }, 'O=x').includes('(x64, MSI\'daki amd64 sürümleri)'));
});
