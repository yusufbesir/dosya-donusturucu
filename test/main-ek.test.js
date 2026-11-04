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

// ---- 1.9.0 paket A (R9 pano, R10 görev çubuğu, R11 imzadan biçim) ----
test('1.9.0 pano: PNG imza denetimi ve 50 MB sınırı (saf işlev) + IPC bloğu', () => {
  const panoPngGecerli = yardimciAl('panoPngGecerli');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const SINIR = 50 * 1024 * 1024;
  assert.equal(panoPngGecerli(png, SINIR), true);
  assert.equal(panoPngGecerli(new Uint8Array(png), SINIR), true);
  assert.equal(panoPngGecerli(png.subarray(0, 7), SINIR), false, 'imzadan kısa');
  assert.equal(panoPngGecerli(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]), SINIR), false, 'JPEG reddedilir');
  assert.equal(panoPngGecerli(png, 8), false, 'sınırı aşan reddedilir');
  assert.equal(panoPngGecerli(png, png.length), true, 'tam sınırda kabul');
  assert.equal(panoPngGecerli('png', SINIR), false);
  assert.equal(panoPngGecerli(null, SINIR), false);
  assert.match(main, /const MAKS_PANO_BAYT = 50 \* 1024 \* 1024;/);
  const blok = /ele\('pano-gorseli-kaydet'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(blok, /D\.veriBaytlari\(veri, MAKS_PANO_BAYT\)/);
  assert.match(blok, /panoPngGecerli\(bayt, MAKS_PANO_BAYT\)/);
  assert.match(blok, /'taadon-pano'/);
  assert.match(blok, /pano-\$\{zaman\}/);
  assert.match(blok, /flag: 'wx'/);
  assert.match(blok, /izinliDosyalar\.ekle\(hedef\)/);
  assert.match(preload, /panoGorseliKaydet: \(bayt\) => cagir\('pano-gorseli-kaydet', bayt\)/);
});

test('1.9.0 bicimAlgila: sihirli bayt tablosu ve uzantı uyuşması', () => {
  const bicimAlgila = yardimciAl('bicimAlgila');
  const bicimUyusuyor = yardimciAl('bicimUyusuyor');
  const B = (...p) => Buffer.concat(p.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from(x))));
  const pk = (icerik) => B([0x50, 0x4b, 0x03, 0x04], Buffer.alloc(26), icerik);
  const vakalar = [
    [B('%PDF-1.7\n'), 'pdf'],
    [pk('mimetypeapplication/epub+zip'), 'epub'],
    [pk('[Content_Types].xml....PK..word/document.xml'), 'docx'],
    [pk('[Content_Types].xml....PK..xl/workbook.xml'), 'xlsx'],
    [pk('[Content_Types].xml....PK..ppt/presentation.xml'), 'pptx'],
    [pk('word/document.xml'), 'zip'],
    [pk('a.txt'), 'zip'],
    [B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'],
    [B([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'jpg'],
    [B('GIF89a'), 'gif'],
    [B('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'webp'],
    [B('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'wav'],
    [B('RIFF', [0, 0, 0, 0], 'AVI LIST'), null],
    [B('BM', [0, 0, 0, 0]), 'bmp'],
    [B('ID3', [4, 0, 0]), 'mp3'],
    [B([0xff, 0xfb, 0x90, 0x64]), 'mp3'],
    [B([0, 0, 0, 0x20], 'ftypisom'), 'mp4'],
    [B([0x1f, 0x8b, 0x08, 0]), 'gz'],
    [B('OggS', [0, 2]), 'ogg'],
    [B('fLaC', [0, 0, 0, 0x22]), 'flac'],
    [B([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), '7z'],
    [B('Rar!', [0x1a, 0x07, 0x01, 0]), 'rar'],
    [B('merhaba dünya'), null],
    [B([1, 2]), null],
    [Buffer.alloc(0), null]
  ];
  for (const [bayt, beklenen] of vakalar) assert.equal(bicimAlgila(bayt), beklenen, `${bayt.subarray(0, 12).toString('hex')} -> ${beklenen}`);
  assert.equal(bicimAlgila(null), null);
  assert.equal(bicimAlgila(new Uint8Array(B('%PDF-1.4'))), 'pdf', 'Uint8Array da kabul');
  // Uyuşma: aynı biçim / aile uyuşur; farklıysa uyuşmaz; bilinmiyorsa (null) gösterilmez
  assert.equal(bicimUyusuyor('png', 'png'), true);
  assert.equal(bicimUyusuyor('png', 'jpg'), false);
  assert.equal(bicimUyusuyor('jpg', 'jpeg'), true);
  assert.equal(bicimUyusuyor('zip', 'docx'), true);
  assert.equal(bicimUyusuyor('docx', 'xlsx'), false);
  assert.equal(bicimUyusuyor('mp4', 'mov'), true);
  assert.equal(bicimUyusuyor('zip', 'jpg'), false);
  assert.equal(bicimUyusuyor(null, 'txt'), true);
  const blok = /ele\('bicim-algila'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(blok, /D\.girdiYoluDogrula\(yol, izinliDosyalar\)/);
  assert.match(blok, /fh\.read\(tampon, 0, 4096, 0\)/);
  assert.match(blok, /uyusuyor: bicimUyusuyor\(bicim, uzanti\)/);
  assert.match(preload, /bicimAlgila: \(yol\) => cagir\('bicim-algila', String\(yol\)\)/);
});

test('1.9.0 görev çubuğu: ortalama yüzde, boş kuyrukta -1, hata modu kısa süre', () => {
  const gorevCubuguDegeri = yardimciAl('gorevCubuguDegeri');
  assert.equal(gorevCubuguDegeri([], 0), -1);
  assert.equal(gorevCubuguDegeri([50], 0), -1);
  assert.equal(gorevCubuguDegeri([], 2), 0, 'yalnız bekleyen varsa 0');
  assert.equal(gorevCubuguDegeri([20, 60], 2), 0.4);
  assert.equal(gorevCubuguDegeri([150, -10], 2), 0.5, 'sınırlanır');
  assert.match(main, /pencere\.setProgressBar\(gorevCubuguDegeri\(\[\.\.\.calisanYuzde\.values\(\)\], etkinIsler\.size\)\)/);
  assert.match(main, /setProgressBar\(1, \{ mode: 'error' \}\)/);
  assert.match(main, /if \(d\.durum === 'hata'\) gorevCubuguHata\(\);/);
});

// ---- 1.9.0 paket C: Özellikler bayrakları, önizleme ve ısıtma IPC [Claude#taadon-1.9-paket-c 2026-11-04] ----
test('1.9.0: onizle IPC izinli yol şartı, tek istek ve özellik bayrağı', () => {
  const blok = /ele\('onizle'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(blok, /ayarlar\.ozOnizleme === false\) return null/);
  assert.match(blok, /D\.girdiYoluDogrula\(yol, izinliDosyalar\)/);
  assert.ok(blok.indexOf('girdiYoluDogrula') < blok.indexOf("onizle(tam"), 'önizleme izin denetiminden sonra');
  assert.match(blok, /if \(onizlemeSuruyor\) return null;/);
  assert.match(blok, /finally \{ onizlemeSuruyor = false; \}/);
  assert.match(blok, /'\.\/src\/motorlar\/onizleme'/);
  assert.match(preload, /onizle: \(yol\) => cagir\('onizle', String\(yol\)\)/);
});

test('1.9.0: isitma-iste tek sefer, ozIsitma kapalıysa yok, libreoffice.isit arka planda', () => {
  const blok = /ele\('isitma-iste'[\s\S]*?\n {4}\}\);/.exec(main)[0];
  assert.match(blok, /ayarlar\.ozIsitma === false \|\| isitmaBasladi\) return false;/);
  assert.match(blok, /isitmaBasladi = true;/);
  assert.match(blok, /libreoffice\.isit\(\{ sofficeYolu: lo\.yol, profilSablonu: [^}]*geciciKlasor \}\)/);
  assert.match(blok, /await sofficeCoz\(\)/, 'yalnız imzası doğrulanmış soffice');
  assert.match(preload, /isitmaIste: \(\) => cagir\('isitma-iste'\)/);
});

test('1.9.0: Özellikler bayrakları main tarafında uygulanır; ara PDF\'ler yalnız çöpe', () => {
  assert.match(main, /D\.OZELLIK_ANAHTARLARI\.map\(\(k\) => \[k, true\]\)/, 'varsayılanlar açık');
  assert.match(main, /for \(const oz of D\.OZELLIK_ANAHTARLARI\) if \(typeof k\[oz\] === 'boolean'\) ayarlar\[oz\] = k\[oz\];/);
  assert.match(main, /ayarlar\.ozGorevCubugu === false\) \{ try \{ pencere\.setProgressBar\(-1\)/);
  assert.match(/ele\('pano-gorseli-kaydet'[\s\S]*?\n {4}\}\);/.exec(main)[0], /ayarlar\.ozPano === false\) throw/);
  assert.match(/ele\('bicim-algila'[\s\S]*?\n {4}\}\);/.exec(main)[0], /ayarlar\.ozBicimAlgila === false\) return \{ bicim: null/);
  assert.match(main, /ayarlar\.ozPdfBirlestir === false\) delete is\.secenekler\.tekPdf/);
  assert.match(main, /for \(const a of sonuc\.araCiktilar\)[\s\S]{0,80}shell\.trashItem\(/);
  assert.ok(!/fs\.(rm|unlink)[^\n]*araCiktilar/.test(main), 'ara PDF\'ler kalıcı silinmez');
});

/* ---------- 1.10.0 Yönetici paneli kanalları [Claude#taadon-1.10-yonetici 2026-11-04] ---------- */
function kanalBlogu(kanal) {
  const bas = main.indexOf(`ele('${kanal}'`);
  assert.ok(bas > 0, `${kanal} kanalı main.js içinde olmalı`);
  const son = main.indexOf('\n    });', bas);
  return main.slice(bas, son > 0 ? son : bas + 2000);
}

test('yönetici kanalları kilit denetimi: durum ve tanı ilk iş yoneticiDenetle()', () => {
  for (const k of ['yonetici-durum', 'tani-olustur']) {
    assert.match(kanalBlogu(k), /^ele\('[a-z-]+', async \(\) => \{\n\s+yoneticiDenetle\(\);/, `${k} önce kilidi denetlemeli`);
  }
  assert.match(main, /function yoneticiDenetle\(\) \{\n\s+if \(!yoneticiAcik \|\| ayarlar\.ozYonetici === false\) throw/);
  // yoneticiAcik yalnız kilit-ac ve pin-belirle'de true olur; arayüze dönmez
  assert.equal((main.match(/yoneticiAcik = true/g) || []).length, 2);
  assert.match(kanalBlogu('yonetici-kilit-ac'), /pinDene\(pin\);\n\s+yoneticiAcik = true;\n\s+return true;/);
  assert.match(main, /ele\('yonetici-kilitle', \(\) => \{ yoneticiAcik = false; return true; \}\);/);
  assert.match(kanalBlogu('yonetici-pin-belirle'), /if \(ayarlar\.yoneticiPinOzeti\) \{ yoneticiDenetle\(\); pinDene\(eskiPin\); \}/);
  assert.match(kanalBlogu('ayar-kaydet'), /anahtar === 'ozYonetici' && temiz === false\) yoneticiAcik = false/);
});

test('PIN güvenliği: düz PIN yazılmaz/loglanmaz, özet arayüze gitmez, ayar-kaydet ile değiştirilemez', () => {
  assert.doesNotMatch(main, /console\.[a-z]+\([^)]*\b(pin|yeniPin|eskiPin)\b/i);
  assert.match(main, /D\.pinDenemeSayaci\(\{ maks: 5, beklemeMs: 60000 \}\)/);
  assert.match(main, /const \{ yoneticiPinOzeti, \.\.\.g \} = ayarlar;/);
  assert.doesNotMatch(main, /Object\.assign\(\{\}, ayarlar, \{ gecmis \}\)/, 'ayarlar arayüze yalnız disaAyarlar() ile gider');
  assert.match(kanalBlogu('ayar-kaydet'), /anahtar === 'yoneticiPinOzeti'\) throw/);
  assert.match(main, /D\.OZET_DESENI\.test\(k\.yoneticiPinOzeti\)/);
  assert.match(main, /D\.pinOzeti\(yeniPin\)/);
});

test('tanı dosyası: Belgeler, wx bayrağı, yol maskeleme, PIN özeti maskeli, son 50 geçmiş', () => {
  const blok = kanalBlogu('tani-olustur');
  assert.match(blok, /app\.getPath\('documents'\)/);
  assert.match(blok, /TaaDön-tani-/);
  assert.match(blok, /flag: 'wx'/);
  assert.match(blok, /D\.yolMaskele\(/);
  assert.match(blok, /D\.taniAyarlari\(ayarlar\)/);
  assert.match(blok, /gecmis\.slice\(0, 50\)/);
});

test('preload: yönetici köprüleri', () => {
  for (const [ad, kanal] of [['yoneticiKilitAc', 'yonetici-kilit-ac'], ['yoneticiKilitle', 'yonetici-kilitle'], ['yoneticiPinBelirle', 'yonetici-pin-belirle'], ['yoneticiDurum', 'yonetici-durum'], ['taniOlustur', 'tani-olustur']]) {
    assert.match(preload, new RegExp(`\\b${ad}: \\([^)]*\\) => cagir\\('${kanal}'`));
  }
});
