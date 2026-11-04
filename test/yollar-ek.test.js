// TaaDön: src/yollar.js ek testleri (Windows güvenli ad, kod noktası kısaltma, yol uzunluğu).
// Sahip: Claude (TaaDön projesi). Yalnız yollar.js davranışını sınar; temel.test.js'e dokunmaz.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yollar = require('../src/yollar');

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dd-yollar-ek-'));
}
const yaz = (icerik = 'x') => async (g) => fs.writeFileSync(g, icerik);

test('guvenliUret: CON.mp4 ayrılmış ad güvenli ada çevrilir', async () => {
  const k = gecici();
  const sonuc = await yollar.guvenliUret(k, 'CON', 'mp4', yaz());
  assert.equal(path.basename(sonuc), '_CON.mp4');
  assert.ok(fs.existsSync(sonuc));
});

test('guvenliUret: yasak karakter ve sonu nokta/boşluk temizlenir', async () => {
  const k = gecici();
  const sonuc = await yollar.guvenliUret(k, 'a<b>c:d"e|f?g*h. ', 'pdf', yaz());
  assert.equal(path.basename(sonuc), 'a_b_c_d_e_f_g_h.pdf');
});

test('guvenliUret: klasör bileşeni içeren ad reddedilir', async () => {
  const k = gecici();
  await assert.rejects(() => yollar.guvenliUret(k, '..\\x', 'txt', yaz()), /Geçersiz çıktı adı/);
  await assert.rejects(() => yollar.guvenliUret(k, '../x', 'txt', yaz()), /Geçersiz çıktı adı/);
  assert.deepEqual(fs.readdirSync(k), []);
});

test('temizAd: emoji kod noktası olarak kesilir, bölünmez', () => {
  const ad = '😀'.repeat(130);
  const s = yollar.temizAd(ad);
  assert.equal(Array.from(s).length, 120);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s));
  const g = path.basename(yollar.geciciYol(os.tmpdir(), ad, 'mp4'));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(g));
});

test('guvenliUret: çok uzun ad toplam yol 200 altında kalacak şekilde kısalır, uzantı korunur', async () => {
  const k = gecici();
  const sonuc = await yollar.guvenliUret(k, 'u'.repeat(119), 'mkv', yaz());
  assert.ok(sonuc.length <= 200, String(sonuc.length));
  assert.ok(sonuc.endsWith('.mkv'));
  const k2 = path.join(k, 'd'.repeat(60));
  const s2 = await yollar.guvenliUret(k2, 'v'.repeat(119), 'mkv', yaz());
  assert.ok(s2.length <= 200, String(s2.length));
  assert.ok(s2.endsWith('.mkv'));
});

test('guvenliUret: benzersiz "ad (1).ext" davranışı korunur', async () => {
  const k = gecici();
  const a = await yollar.guvenliUret(k, 'rapor', 'txt', yaz('1'));
  const b = await yollar.guvenliUret(k, 'rapor', 'txt', yaz('2'));
  assert.equal(path.basename(a), 'rapor.txt');
  assert.equal(path.basename(b), 'rapor (1).txt');
  assert.equal(fs.readFileSync(a, 'utf8'), '1');
  assert.equal(fs.readdirSync(k).length, 2);
});

test('pathteBul: platform parametresi uzantı kuralını belirler', () => {
  const k = gecici();
  const exe = path.join(k, 'ffmpeg.exe');
  fs.writeFileSync(exe, '');
  // linux kuralı: yalnız 'ffmpeg' aranır, ffmpeg.exe bulunmaz; win32 kuralı: .exe denenir
  assert.equal(yollar.pathteBul(['ffmpeg'], { PATH: k }, 'linux'), null);
  assert.equal(yollar.pathteBul(['ffmpeg'], { PATH: k }, 'win32'), exe);
});
