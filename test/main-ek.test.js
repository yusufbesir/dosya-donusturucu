'use strict';
// TaaDön main.js ek denetimleri (inceleme bulguları): CSP, %PDF- imzası, dialogAcik, gecmis-temizle,
// powerSaveBlocker/Notification, sınırlar ve sayfa dolgusu. Sahip: Yusuf. yazan: [Claude#taadon]
// Metin/grep denetimi + main.js'ten çıkarılan saf yardımcı işlevlerin (Electron'suz) denenmesi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const okuMetin = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');
const main = okuMetin('main.js');
const preload = okuMetin('preload.js');

// main.js içindeki üst düzey saf işlevi kaynak metninden çıkarıp yalıtık olarak derler.
function yardimciAl(ad) {
  const m = new RegExp(`\\nfunction ${ad}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(main);
  assert.ok(m, `${ad} main.js içinde bulunmalı`);
  return new Function(`${m[0]}; return ${ad};`)();
}

test('CSP dizesi kesin değerde', () => {
  const html = okuMetin('arayuz', 'index.html');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp);
  assert.equal(csp[1], "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'none'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'");
});

test('pdf-oku: uzantı pdf ve %PDF- imzası denetimi', () => {
  const pdfImzasiGecerli = yardimciAl('pdfImzasiGecerli');
  assert.equal(pdfImzasiGecerli(Buffer.from('%PDF-1.7\n')), true);
  assert.equal(pdfImzasiGecerli(new Uint8Array(Buffer.from('%PDF-'))), true);
  assert.equal(pdfImzasiGecerli(Buffer.from('%PDF')), false);
  assert.equal(pdfImzasiGecerli(Buffer.from('PK\x03\x04xx')), false);
  assert.equal(pdfImzasiGecerli(Buffer.from(' %PDF-1.4')), false);
  assert.equal(pdfImzasiGecerli(null), false);
  const blok = /ele\('pdf-oku'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(blok, /!== 'pdf'\) throw new Error\('Yalnız PDF/);
  assert.match(blok, /pdfImzasiGecerli\(bayt\)/);
});

test('yol-bildir ve is-ekle sınırları', () => {
  assert.match(main, /const MAKS_YOL_BILDIR = 5000;/);
  assert.match(main, /const MAKS_ETKIN_IS = 500;/);
  const yb = /function bildirilenYoluDogrula[\s\S]*?ele\('yol-bildir'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(yb, /\['pdf', 'zip', 'gz'\]\.includes\(u\)/);
  assert.match(yb, /katalog\.BICIMLER/);
  assert.match(yb, /yol\.length > MAKS_YOL_BILDIR/);
  const ie = /ele\('is-ekle'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(ie, /etkinIsler\.size >= MAKS_ETKIN_IS\) throw new Error/);
});

test('dosya-sec / klasor-sec: dialogAcik bayrağı ve finally ile sıfırlama', () => {
  assert.match(main, /let dialogAcik = false;/);
  for (const kanal of ['dosya-sec', 'klasor-sec']) {
    const blok = new RegExp(`ele\\('${kanal}'[\\s\\S]*?\\n {4}\\}\\);`).exec(main)[0];
    assert.match(blok, /if \(dialogAcik\) throw new Error/, `${kanal} açıkken reddetmeli`);
    assert.match(blok, /dialogAcik = true;/);
    assert.match(blok, /finally \{ dialogAcik = false; \}/, `${kanal} finally içinde sıfırlamalı`);
  }
});

test('gecmis-temizle ayrı kanal; preload gecmisTemizle sunar; eski dal işaretli', () => {
  assert.match(main, /ele\('gecmis-temizle',/);
  assert.match(preload, /\bgecmisTemizle: \(\) => cagir\('gecmis-temizle'\)/);
  assert.match(main, /GEÇİCİ UYUMLULUK[\s\S]{0,300}anahtar === 'gecmisTemizle'/);
});

test('powerSaveBlocker ve Notification kullanımı', () => {
  assert.match(main, /require\('electron'\)/);
  assert.match(main, /\bpowerSaveBlocker\b[^\n]*\bNotification\b[^\n]*= require\('electron'\)/);
  assert.match(main, /powerSaveBlocker\.start\('prevent-app-suspension'\)/);
  assert.match(main, /powerSaveBlocker\.stop\(/);
  assert.match(main, /Notification\.isSupported\(\)/);
  assert.match(main, /isFocused\(\)/);
  assert.match(main, /new Notification\(/);
  assert.match(main, /dönüştürüldü/);
  assert.match(main, /başarısız/);
});

test('ciktiyi-ac: ortak denetim (geri dönüşlü) ve Türkçe açma hatası', () => {
  const blok = /ele\('ciktiyi-ac'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(blok, /typeof D\.acilabilirCiktiDogrula === 'function'/);
  assert.match(blok, /D\.acilabilirCiktiDogrula\(yol, uretilenler, fs\)/);
  assert.match(blok, /Dosya açılamadı\. \(\$\{hata\}\)/);
});

test('pdf-sayfa-kaydet: sayfa dolgusu toplam sayfaya göre, en az 3', () => {
  const sayfaDolgusu = yardimciAl('sayfaDolgusu');
  assert.equal(sayfaDolgusu(undefined), 3);
  assert.equal(sayfaDolgusu(9), 3);
  assert.equal(sayfaDolgusu(999), 3);
  assert.equal(sayfaDolgusu(1000), 4);
  assert.equal(sayfaDolgusu(100000), 6);
  assert.equal(sayfaDolgusu(100001), 3);
  assert.equal(sayfaDolgusu(2.5), 3);
  assert.equal(sayfaDolgusu(0), 3);
  assert.match(main, /padStart\(sayfaDolgusu\(o\.toplam\), '0'\)/);
});
