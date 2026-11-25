// Sahip: Yusuf. yazan: [Claude#KM2-hesap-giris 2026-11-25]
// TaaDön'ün TAA ortak girişe bağlantısı: kanal adları, preload yüzeyi, CSP uyumlu stil dosyası, sayfa ve paket.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const kok = path.join(__dirname, '..');
const oku = (...p) => fs.readFileSync(path.join(kok, ...p), 'utf8');
const g = require(path.join(kok, 'taa', 'taa-giris.js'));

test('preload kanalları ortak KANAL ile aynı', () => {
  const preload = oku('preload.js');
  for (const k of Object.values(g.KANAL)) assert.ok(preload.includes(`'${k}'`), k);
});

test('ana süreç ortak köprüyü program adı ve gönderen denetimiyle kurar', () => {
  const main = oku('main.js');
  assert.match(main, /require\('\.\/taa\/taa-giris\.js'\)\.ipcKur\(ipcMain, \{\s*program: 'taadon', paketli: app\.isPackaged,/);
  assert.match(main, /gonderenKontrol\(e\); if \(!pencere \|\| e\.sender !== pencere\.webContents \|\| e\.senderFrame !== e\.sender\.mainFrame\)/);
  assert.match(oku('program.toml'), /^ad = "taadon"/m, 'program adı sunucudaki program_yetkisi ile aynı');
  assert.ok(JSON.parse(oku('package.json')).build.files.includes('taa/taa-giris.js'));
});

test('stil dosyası ekranın STIL bölümüyle aynı; satır içi stil yok (CSP style-src self)', () => {
  const ek = oku('arayuz', 'taa-giris-ekrani.js');
  const stil = ek.match(/const STIL = `([\s\S]*?)`;/)[1].trim();
  const css = oku('arayuz', 'taa-giris.css');
  assert.strictEqual(css.split('/* STIL-BAS */\n')[1].split('\n/* STIL-BIT */')[0], stil);
  const baslat = oku('arayuz', 'taa-giris-baslat.js');
  assert.ok(!/createElement\('style'\)|style\.cssText|setAttribute\('style'/.test(baslat));
  const html = oku('arayuz', 'index.html');
  assert.match(html, /<link rel="stylesheet" id="taa-giris-stil" href="taa-giris.css">/);
  const i = (s) => html.indexOf(s);
  assert.ok(i('taa-giris-ekrani.js') > 0 && i('taa-giris-ekrani.js') < i('taa-giris-baslat.js') && i('taa-giris-baslat.js') < i('uygulama.js'));
});

test('taa-kimlik yoksa giriş istenmez', async () => {
  assert.deepStrictEqual(await g.baslangic({ env: { TAA_KIMLIK: path.join(kok, 'yok') } }), { arac: false, oturum: null });
});
