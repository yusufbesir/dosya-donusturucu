'use strict';
// Ne: Programa gömülü Calibre'nin ebook-convert aracıyla e-kitap dönüştürme motoru (EPUB/MOBI/AZW3/FB2 girdi;
//     EPUB/MOBI/AZW3/FB2/PDF/DOCX/TXT/HTMLZ/RTF çıktı; Word/ODT/RTF/TXT/HTML belgelerinden MOBI/AZW3/FB2).
// Sahibi: Dosya dönüştürücü işi.
// Değiştirme kuralı: yeni biçim ekleme kullanıcı kararıyla ve test/calibre.test.js güncellenerek yapılır;
// silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak olur.
//
// Güvenlik ve yalıtım:
// - ebook-convert.exe yalnız programla gelen (resources/calibre) kopyadan ya da geliştirmede vendor/calibre'den çağrılır;
//   Windows'ta ana süreç Authenticode imzasını ("Kovid Goyal") denetler (src/imza.js), geçmeyen yol kullanılmaz.
// - Her iş kendi geçici klasörüne CALIBRE_CONFIG_DIRECTORY / CALIBRE_TEMP_DIR / CALIBRE_CACHE_DIRECTORY ile yönlendirilir;
//   kullanıcının Calibre ayarları ve kitaplığı okunmaz/yazılmaz. Dönüşüm bitince klasör silinir.
// - ebook-convert ağa çıkmaz (kapak/metadata indirme yalnız ayrı araçlardadır); yine de vekil 127.0.0.1:9 ile kapatılır.
// - DRM'li kitap açılmaz; Calibre'nin DRMError'u Türkçe açıklamaya çevrilir, DRM kaldırma yapılmaz.

const fsp = require('node:fs/promises');
const path = require('node:path');
const yollar = require('../yollar');
const surec = require('../surec');
const { kanonik } = require('../katalog');

const VARSAYILAN_ZAMAN_ASIMI = 10 * 60 * 1000;
const CALIBRE_BULUNAMADI = 'Calibre (ebook-convert) bulunamadı. E-kitap dönüştürücü programla birlikte gelmeliydi; programı yeniden kurun.';
const CALIBRE_DOGRULANAMADI = 'Calibre doğrulanamadı: ebook-convert.exe dosyasının "Kovid Goyal" imzası geçerli değil, bu yüzden kullanılmıyor. Programı yeniden kurun.';
const DRM_HATASI = 'Bu e-kitap DRM (kopya koruması) ile kilitli; dönüştürülemez. Program DRM kaldırmaz.';

// Calibre'nin kabul ettiği girdi ve ürettiği çıktı biçimleri (kanonik uzantılar)
const GIRDILER = Object.freeze(['epub', 'mobi', 'azw3', 'fb2', 'htmlz', 'docx', 'odt', 'rtf', 'txt', 'html']);
const CIKTILAR = Object.freeze(['epub', 'mobi', 'azw3', 'fb2', 'pdf', 'docx', 'txt', 'htmlz', 'rtf']);

/** Olası ebook-convert yollarını öncelik sırasıyla döndürür: programla gelen Calibre (gomuluKlasor/calibre), Linux'ta PATH. */
function ebookConvertAdaylari({ platform, env, gomuluKlasor } = {}) {
  const plt = platform || process.platform;
  const e = env || process.env;
  const liste = [];
  if (gomuluKlasor) {
    const gomulu = path.join(gomuluKlasor, 'calibre', plt === 'win32' ? 'ebook-convert.exe' : 'ebook-convert');
    if (yollar.dosyaMi(gomulu)) liste.push(gomulu);
  }
  if (plt !== 'win32') {
    const p = yollar.pathteBul(['ebook-convert'], e);
    if (p) liste.push(p);
  }
  return [...new Set(liste)];
}

function ebookConvertBul(secenek = {}) {
  return ebookConvertAdaylari(secenek)[0] || null;
}

/** ebook-convert için iş başına ortam: ayar/geçici/önbellek klasörleri işin klasöründe, ağ kapalı. */
function isOrtami(isKlasoru, taban = process.env) {
  return Object.assign({}, taban, {
    CALIBRE_CONFIG_DIRECTORY: path.join(isKlasoru, 'ayar'),
    CALIBRE_TEMP_DIR: path.join(isKlasoru, 'gecici'),
    CALIBRE_CACHE_DIRECTORY: path.join(isKlasoru, 'onbellek'),
    CALIBRE_NO_NATIVE_FILEDIALOGS: '1',
    CALIBRE_OVERRIDE_LANG: 'tr',
    http_proxy: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', no_proxy: '',
  });
}

/** ebook-convert komut satırı argümanları. Girdi ve çıktı yolları ilk iki argümandır; seçenekler sonra gelir. */
function argumanlar(girdi, cikti, hedef, sec = {}) {
  const a = [girdi, cikti];
  if (sec.baslik) a.push('--title', String(sec.baslik));
  if (sec.yazar) a.push('--authors', String(sec.yazar));
  if (hedef === 'pdf') a.push('--paper-size', 'a4', '--pdf-page-numbers');
  if (hedef === 'txt') a.push('--txt-output-encoding', 'utf-8');
  return a;
}

/** Calibre çıktısından anlaşılır Türkçe hata; DRM ayrı yakalanır. */
function hataMetni(kod, stdout, stderr) {
  const metin = `${stderr || ''}\n${stdout || ''}`;
  if (/DRMError|locked by DRM|DRM-?protected|has DRM/i.test(metin)) return DRM_HATASI;
  const ozet = metin.trim().split(/\r?\n/).filter((s) => s.trim() && !/^\s*(File "|Traceback)/.test(s)).slice(-3).join(' | ');
  return `Calibre dönüştüremedi${kod != null && kod !== 0 ? ` (kod ${kod})` : ''}${ozet ? `: ${ozet.slice(0, 400)}` : '.'}`;
}

async function calistir(ctx) {
  const { girdiler, ciktiKlasoru, ebookConvertYolu, sinyal, ilerleme, geciciKlasor } = ctx;
  const sec = ctx.secenekler || {};
  const girdi = yollar.girdiYolu(girdiler[0]);
  const hedef = kanonik(ctx.hedef);
  const kaynakUz = kanonik(yollar.uzantiAl(girdi));
  if (!ebookConvertYolu) throw new Error(ctx.calibreDurumu === 'dogrulanamadi' ? CALIBRE_DOGRULANAMADI : CALIBRE_BULUNAMADI);
  if (!CIKTILAR.includes(hedef)) throw new Error(`Calibre bu hedefi üretmez: ${hedef}`);
  if (!GIRDILER.includes(kaynakUz)) throw new Error(`Calibre bu kaynağı okumaz: ${kaynakUz || '?'}`);
  const zamanAsimi = Number(sec.zamanAsimi || ctx.zamanAsimi) || VARSAYILAN_ZAMAN_ASIMI;

  const isKlasoru = await fsp.mkdtemp(path.join(geciciKlasor, 'calibre-'));
  try {
    const ortam = isOrtami(isKlasoru);
    for (const k of ['CALIBRE_CONFIG_DIRECTORY', 'CALIBRE_TEMP_DIR', 'CALIBRE_CACHE_DIRECTORY']) await fsp.mkdir(ortam[k], { recursive: true });
    // Girdi, özgün adıyla geçici kopya olarak verilir (ebook-convert biçimi uzantıdan anlar; özgün dosyaya dokunulmaz)
    const girdiKopya = path.join(isKlasoru, `girdi.${kaynakUz}`);
    await fsp.copyFile(girdi, girdiKopya, 1 /* COPYFILE_EXCL */);
    const ciktiGecici = path.join(isKlasoru, `cikti.${hedef}`);
    if (ilerleme) ilerleme(5);
    const sonuc = await surec.calistir(ebookConvertYolu, argumanlar(girdiKopya, ciktiGecici, hedef, sec), { sinyal, zamanAsimi, env: ortam, cwd: isKlasoru });
    if (sinyal && sinyal.aborted) throw surec.iptalHatasi();
    let st = null;
    try { st = await fsp.stat(ciktiGecici); } catch { st = null; }
    if (sonuc.kod !== 0 || !st || st.size === 0) throw new Error(hataMetni(sonuc.kod, sonuc.stdout, sonuc.stderr));
    if (ilerleme) ilerleme(90);
    return await yollar.guvenliUret(ciktiKlasoru, ctx.ciktiAdi || yollar.govdeAdi(girdi), hedef, async (gecici) => {
      await fsp.copyFile(ciktiGecici, gecici, 1 /* COPYFILE_EXCL */);
    });
  } finally {
    await fsp.rm(isKlasoru, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { calistir, argumanlar, isOrtami, hataMetni, ebookConvertBul, ebookConvertAdaylari, GIRDILER, CIKTILAR, CALIBRE_BULUNAMADI, CALIBRE_DOGRULANAMADI, DRM_HATASI, VARSAYILAN_ZAMAN_ASIMI };
