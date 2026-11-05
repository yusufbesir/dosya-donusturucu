'use strict';
// Ne: 1.6.0 paketleme ve kurulum betiği denetimleri (sağ tık menüsü HKCU, electronLanguages, sürüm, kalıcı silme yok).
// Sahibi: TaaDön işi. yazan: [Claude#ekip-t5-2026-11-04]. Değiştirme: davranış değişince birlikte; silme yalnız Yusuf kararıyla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const KOK = path.join(__dirname, '..');
const oku = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');

test('kurulum.nsh: sağ tık menüsü yalnız HKCU, kaldırmada silinir, kalıcı toplu silme yok', () => {
  const nsh = oku('build', 'kurulum.nsh');
  const anahtar = ['Software', 'Classes', '*', 'shell', 'TaaDon'].join('\\');
  assert.ok(nsh.includes(`WriteRegStr HKCU "${anahtar}" "MUIVerb" "TaaDön ile dönüştür"`));
  assert.ok(nsh.includes(`WriteRegStr HKCU "${anahtar}\\command"`));
  assert.ok(nsh.includes('!macro customUnInstall') && nsh.includes(`DeleteRegKey HKCU "${anahtar}"`));
  assert.ok(!/WriteRegStr HKLM|DeleteRegKey HKLM/.test(nsh), 'HKLM kullanılmamalı');
  const kodSatirlari = nsh.split('\n').filter((s) => !s.trim().startsWith(';'));
  assert.ok(!kodSatirlari.some((s) => /RMDir \/r \$INSTDIR/.test(s)), 'toplu silme olmamalı (yorum dışı)');
  assert.ok(!/\r/.test(nsh), 'LF satır sonu');
});

test('package.json: sürüm 1.12.0, electronLanguages, ürün adı alanları', () => {
  const pkg = JSON.parse(oku('package.json'));
  const lock = JSON.parse(oku('package-lock.json'));
  assert.equal(pkg.version, '1.12.0');
  assert.equal(lock.version, '1.12.0');
  assert.deepEqual(pkg.build.electronLanguages, ['tr', 'en-US']);
  assert.equal(pkg.build.productName, 'TaaDön');
  assert.equal(pkg.build.appId, 'com.dosyadonusturucu.app');
});

test('README ve SPEC 1.6.0 bölümleri', () => {
  const r = oku('README.md');
  for (const b of ['## Çıktı ayarları', '## PDF/A ve PDF kalitesi', '## Sağ tık menüsü ve klasör bırakma', '- 1.6.0:']) assert.ok(r.includes(b), b);
  assert.ok(oku('SPEC.md').includes('## Ayarlar ve seçenekler (1.6.0)'));
});
