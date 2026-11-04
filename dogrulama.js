'use strict';
// Ana sürecin IPC doğrulama yardımcıları. Electron'a bağımlı değildir; node:test ile denenir.
const path = require('path');
const nodeFs = require('fs');

const SABIT_INDIRME_URL = 'https://www.libreoffice.org/download/download/';

const LIMITLER = Object.freeze({
  maksGirdi: 5000,
  maksYolUzunluk: 4096,
  maksSayfaBayt: 200 * 1024 * 1024,   // tek bir sayfa görseli
  maksMetinBayt: 100 * 1024 * 1024,   // PDF'den çıkan metin
  maksPdfOkuBayt: 256 * 1024 * 1024,  // arayüze verilecek PDF
  maksGecmis: 200
});

// Çekirdek katalogdan işlem listesi alınamazsa kullanılan, SPEC'te adı geçen işlemler.
const VARSAYILAN_ISLEMLER = Object.freeze([
  'birlestir', 'bol', 'dondur', 'gorsel-pdf', 'zip', 'zip-ac', 'gz', 'gz-ac'
]);

const KALITELER = ['yuksek', 'orta', 'kucuk'];
const TEMALAR = ['sistem', 'acik', 'koyu'];
const CIKTI_YERLERI = ['klasor', 'kaynak'];          // 'klasor': ayarlardaki klasör, 'kaynak': ilk girdinin klasörü
const PDF_KALITELERI = ['dusuk', 'orta', 'yuksek'];  // LibreOffice PDF dışa aktarım kalitesi
const SONEK_DESENI = /^[A-Za-z0-9 _.-]{0,20}$/;      // çıktı adı soneki: ad<sonek>.uz
const MAKS_ARGV_DOSYA = 500;                          // komut satırı / sağ tık ile en fazla dosya

function normalize(yol) {
  const r = path.resolve(String(yol));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function yolBicimiGecerli(yol) {
  return typeof yol === 'string' && yol.length > 0 && yol.length <= LIMITLER.maksYolUzunluk &&
    !yol.includes('\0') && path.isAbsolute(yol);
}

// Bu oturumda kullanıcının seçtiği/sürüklediği yolların kümesi.
class YolKumesi {
  constructor() { this._k = new Set(); }
  ekle(yol) { if (yolBicimiGecerli(yol)) this._k.add(normalize(yol)); }
  var(yol) { return yolBicimiGecerli(yol) && this._k.has(normalize(yol)); }
  get boyut() { return this._k.size; }
}

function dosyaMi(yol, fs = nodeFs) {
  try { return fs.statSync(yol).isFile(); } catch { return false; }
}
function klasorMu(yol, fs = nodeFs) {
  try { return fs.statSync(yol).isDirectory(); } catch { return false; }
}

// Mutlak, var olan, izinli kümede bulunan bir dosya yolu olmalı.
function girdiYoluDogrula(yol, izinli, fs = nodeFs) {
  if (!yolBicimiGecerli(yol)) throw new Error('Geçersiz dosya yolu.');
  if (!izinli.var(yol)) throw new Error('Bu dosya bu oturumda seçilmemiş.');
  if (!dosyaMi(yol, fs)) throw new Error('Dosya bulunamadı.');
  return path.resolve(yol);
}

// Çıktı klasörü: mutlak, var olan ve izinli kümede (iletişim kutusundan seçilmiş ya da ayarlardaki/varsayılan) olmalı.
function ciktiKlasoruDogrula(yol, izinliKlasorler, fs = nodeFs) {
  if (!yolBicimiGecerli(yol)) throw new Error('Geçersiz çıktı klasörü.');
  if (!izinliKlasorler || typeof izinliKlasorler.var !== 'function' || !izinliKlasorler.var(yol)) {
    throw new Error('Bu çıktı klasörü bu oturumda seçilmemiş.');
  }
  if (!klasorMu(yol, fs)) throw new Error('Çıktı klasörü bulunamadı.');
  return path.resolve(yol);
}

function uzantiAl(yol) {
  return path.extname(String(yol)).replace(/^\./, '').toLowerCase();
}

function islemAdlari(islemler) {
  const kume = new Set(VARSAYILAN_ISLEMLER);
  // Yalnız gerçek işlemler (hedef === id) sayılır; biçim hedefleri (docx, mp3...) uzantı denetiminden geçmeli.
  const ekle = (x) => {
    const ad = typeof x === 'string' ? x : (x && x.hedef === x.id ? x.id : null);
    if (typeof ad === 'string' && /^[a-z0-9-]{1,32}$/.test(ad)) kume.add(ad);
  };
  if (Array.isArray(islemler)) islemler.forEach(ekle);
  return kume;
}

// Hedef: ya bilinen bir işlem adı ya da her girdi uzantısı için katalogda izinli bir biçim.
function hedefDogrula(hedef, uzantilar, hedeflerFn, islemKumesi) {
  if (typeof hedef !== 'string' || !/^[a-z0-9-]{1,32}$/.test(hedef)) throw new Error('Geçersiz hedef.');
  if (islemKumesi && islemKumesi.has(hedef)) return hedef;
  if (!uzantilar.length) throw new Error('Girdi yok.');
  for (const u of uzantilar) {
    const liste = hedeflerFn(u) || [];
    if (!liste.some((h) => h && h.hedef === hedef)) {
      throw new Error(`"${hedef}" hedefi .${u || '?'} dosyaları için izinli değil.`);
    }
  }
  return hedef;
}

const ZAMAN = /^(\d{1,2}:)?\d{1,2}:\d{1,2}(\.\d{1,3})?$|^\d{1,6}(\.\d{1,3})?$/;
function tamSayi(v, min, max) {
  if (!(typeof v === 'number' || (typeof v === 'string' && /^\d{1,7}$/.test(v)))) throw new Error('Geçersiz sayı değeri.');
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Geçersiz sayı değeri.');
  return n;
}

// Yalnızca bilinen anahtarlar ve değer aralıkları geçer.
function secenekTemizle(ham, izinli, fs = nodeFs) {
  const c = {};
  if (ham == null) return c;
  if (typeof ham !== 'object' || Array.isArray(ham)) throw new Error('Geçersiz seçenekler.');
  for (const [k, v] of Object.entries(ham)) {
    if (v === undefined || v === null || v === '') continue;
    switch (k) {
      case 'kalite':
        if (!KALITELER.includes(v)) throw new Error('Geçersiz kalite.');
        c.kalite = v; break;
      case 'baslangic': case 'bitis':
        if (typeof v !== 'string' || !ZAMAN.test(v)) throw new Error('Geçersiz süre.');
        c[k] = v; break;
      case 'genislik': c.genislik = tamSayi(v, 16, 16000); break;
      case 'fps': c.fps = tamSayi(v, 1, 60); break;
      case 'aci':
        c.aci = tamSayi(v, 0, 360);
        if (![0, 90, 180, 270, 360].includes(c.aci)) throw new Error('Geçersiz açı.');
        break;
      case 'sayfalar':
        if (typeof v !== 'string' || !/^[0-9,\- ]{1,200}$/.test(v)) throw new Error('Geçersiz sayfa aralığı.');
        c.sayfalar = v.trim(); break;
      case 'kapakGorseli':
        c.kapakGorseli = girdiYoluDogrula(v, izinli, fs); break;
      case 'pdfa':
        if (typeof v !== 'boolean') throw new Error('Geçersiz PDF/A seçeneği.');
        c.pdfa = v; break;
      case 'pdfKalite':
        if (!PDF_KALITELERI.includes(v)) throw new Error('Geçersiz PDF kalitesi.');
        c.pdfKalite = v; break;
      default:
        // bilinmeyen anahtar sessizce atılır
        break;
    }
  }
  return c;
}

/**
 * Arayüzden gelen ham işi doğrular ve temiz bir iş nesnesi döndürür.
 * ctx = { izinli:YolKumesi, izinliKlasorler:YolKumesi, hedeflerFn, islemKumesi, id, fs? }
 */
function isDogrula(ham, ctx) {
  const fs = ctx.fs || nodeFs;
  if (!ham || typeof ham !== 'object') throw new Error('Geçersiz iş.');
  if (!Array.isArray(ham.girdiler) || ham.girdiler.length === 0 || ham.girdiler.length > LIMITLER.maksGirdi) {
    throw new Error('Geçersiz girdi listesi.');
  }
  const girdiler = ham.girdiler.map((g) => girdiYoluDogrula(g, ctx.izinli, fs));
  const hedef = hedefDogrula(ham.hedef, [...new Set(girdiler.map(uzantiAl))], ctx.hedeflerFn, ctx.islemKumesi);
  const ciktiKlasoru = ciktiKlasoruDogrula(ham.ciktiKlasoru, ctx.izinliKlasorler, fs);
  const secenekler = secenekTemizle(ham.secenekler, ctx.izinli, fs);
  return { id: ctx.id, girdiler, hedef, ciktiKlasoru, secenekler };
}

/**
 * "Çıktı kaynağın yanına" mantığı (saf). ciktiYeri === 'kaynak' ise ilk girdi önce izinli dosya olarak
 * doğrulanır, sonra onun klasörü izinliKlasorler'e eklenir ve ham işin ciktiKlasoru o klasörle değiştirilir.
 * Diğer durumda ham iş olduğu gibi döner. Ham nesne değiştirilmez.
 */
function kaynakCiktiKlasoru(ham, ciktiYeri, ctx) {
  if (ciktiYeri !== 'kaynak') return ham;
  if (!ham || typeof ham !== 'object' || !Array.isArray(ham.girdiler) || ham.girdiler.length === 0) {
    throw new Error('Geçersiz girdi listesi.');
  }
  const ilk = girdiYoluDogrula(ham.girdiler[0], ctx.izinli, ctx.fs || nodeFs);
  const klasor = path.dirname(ilk);
  ctx.izinliKlasorler.ekle(klasor);
  return Object.assign({}, ham, { ciktiKlasoru: klasor });
}

/**
 * is-ekle için tam hazırlık: kaynak klasörü mantığı + isDogrula + ayarlardan sonek ve ozgunTasi.
 * ctx = isDogrula ctx'i + { ayarlar: { ciktiYeri, sonek, ozgunTasi } }
 */
function isHazirla(ham, ctx) {
  const a = ctx.ayarlar || {};
  const is = isDogrula(kaynakCiktiKlasoru(ham, a.ciktiYeri, ctx), ctx);
  is.sonek = typeof a.sonek === 'string' && SONEK_DESENI.test(a.sonek) ? a.sonek : '';
  is.ozgunTasi = a.ozgunTasi === true;
  return is;
}

/**
 * Komut satırı / ikinci örnek argv'sini süzer (saf, dosya sistemine bakmaz). İlk `atla` öğe (exe; geliştirmede
 * exe + uygulama yolu) atılır; "--", "-" ile başlayan Electron/Chromium bayrakları ve boş/geçersiz öğeler ayıklanır.
 * Göreli yollar `calismaKlasoru` verilmişse ona göre çözülür, verilmemişse atılır. Tekrarsız, en çok MAKS_ARGV_DOSYA.
 */
function argvSuz(argv, { atla = 1, calismaKlasoru } = {}) {
  if (!Array.isArray(argv)) return [];
  const sonuc = [];
  const gorulen = new Set();
  for (const a of argv.slice(Math.max(0, atla | 0))) {
    if (typeof a !== 'string' || !a || a.startsWith('-')) continue;
    let yol = a;
    if (!path.isAbsolute(yol)) {
      if (typeof calismaKlasoru !== 'string' || !path.isAbsolute(calismaKlasoru)) continue;
      yol = path.resolve(calismaKlasoru, yol);
    }
    if (!yolBicimiGecerli(yol)) continue;
    const n = normalize(yol);
    if (gorulen.has(n)) continue;
    gorulen.add(n);
    sonuc.push(path.resolve(yol));
    if (sonuc.length >= MAKS_ARGV_DOSYA) break;
  }
  return sonuc;
}

/** argvSuz + var olan normal dosya + tanınan uzantı (taninanFn(uzanti) => boolean). */
function argvDosyalari(argv, secenek = {}, taninanFn = () => true, fs = nodeFs) {
  return argvSuz(argv, secenek).filter((y) => dosyaMi(y, fs) && !!taninanFn(uzantiAl(y)));
}

const SOFFICE_ADLARI = ['soffice.exe', 'soffice.com', 'soffice', 'soffice.bin'];
function sofficeAdiGecerli(yol) {
  // Windows yolları (ters eğik çizgi) POSIX'te de doğru ayrıştırılsın
  const ad = String(yol).split(/[\\/]/).pop().toLowerCase();
  return SOFFICE_ADLARI.includes(ad);
}

function ayarDogrula(anahtar, deger, ctx) {
  const fs = ctx.fs || nodeFs;
  switch (anahtar) {
    case 'ciktiKlasoru':
      if (!yolBicimiGecerli(deger) || !ctx.izinliKlasorler.var(deger)) throw new Error('Bu klasör seçilmemiş.');
      return ciktiKlasoruDogrula(deger, ctx.izinliKlasorler, fs);
    case 'sofficeYolu': {
      if (deger === '' || deger == null) return '';
      if (!sofficeAdiGecerli(deger)) throw new Error('soffice.exe seçilmeli.');
      return girdiYoluDogrula(deger, ctx.izinli, fs);
    }
    case 'esZamanli': return tamSayi(deger, 1, 4);
    case 'tema':
      if (!TEMALAR.includes(deger)) throw new Error('Geçersiz tema.');
      return deger;
    case 'ciktiYeri':
      if (!CIKTI_YERLERI.includes(deger)) throw new Error('Geçersiz çıktı yeri.');
      return deger;
    case 'sonek':
      if (typeof deger !== 'string' || !SONEK_DESENI.test(deger)) {
        throw new Error('Sonek en çok 20 karakter olmalı; yalnız harf, rakam, boşluk, _ . - kullanılabilir.');
      }
      return deger;
    case 'ozgunTasi':
      if (typeof deger !== 'boolean') throw new Error('Geçersiz değer.');
      return deger;
    case 'motorRust': // arşiv işlerinde Rust çekirdeği (taa-donustur); [Claude#taadon-rust-asama2 2026-11-04]
      if (typeof deger !== 'boolean') throw new Error('Geçersiz değer.');
      return deger;
    default:
      throw new Error('Bilinmeyen ayar.');
  }
}

// Dosya başlığı (sihirli bayt) uzantıyla uyuşmalı.
function gorselBicimiGecerli(veri, uzanti) {
  if (!veri || veri.length < 4) return false;
  if (uzanti === 'png') return veri[0] === 0x89 && veri[1] === 0x50 && veri[2] === 0x4e && veri[3] === 0x47;
  if (uzanti === 'jpg') return veri[0] === 0xff && veri[1] === 0xd8 && veri[2] === 0xff;
  return false;
}

function veriBaytlari(veri, sinir) {
  let b;
  if (veri instanceof Uint8Array) b = veri;
  else if (veri instanceof ArrayBuffer) b = new Uint8Array(veri);
  else throw new Error('Geçersiz veri.');
  if (b.length === 0) throw new Error('Veri boş.');
  if (b.length > sinir) throw new Error('Veri boyut sınırını aşıyor.');
  return b;
}

// Dosya adı: kaynak adından, yol ayracı ve denetim karakteri bırakmadan.
function guvenliAd(kaynakYol, ek) {
  let ad = path.parse(String(kaynakYol)).name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  if (!ad) ad = 'dosya';
  // Windows ayrılmış aygıt adları (uzantılı da) tehlikelidir.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(ad)) ad = '_' + ad;
  return (ad.slice(0, 120) + (ek || '')).replace(/[. ]+$/, '');
}

// Arayüzün (file://) isteklerinde izinli kökler: arayuz/ ve pdfjs-dist'in çalışma zamanı klasörleri.
function izinliDosyaKokleri(uygulamaKlasoru) {
  const pdfjs = path.join(uygulamaKlasoru, 'node_modules', 'pdfjs-dist');
  return [
    path.join(uygulamaKlasoru, 'arayuz'),
    path.join(pdfjs, 'legacy', 'build'),
    path.join(pdfjs, 'standard_fonts'),
    path.join(pdfjs, 'cmaps'),
    path.join(pdfjs, 'wasm'),
    path.join(pdfjs, 'iccs')
  ];
}

// file: adresi izinli köklerden birinin altındaki bir dosyaya mı gidiyor? Host'lu (UNC) adresler reddedilir.
function dosyaUrlIzinli(url, kokler, platform = process.platform) {
  const win = platform === 'win32';
  const P = win ? path.win32 : path.posix;
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'file:' || u.host !== '' || u.username || u.password) return false;
  let yol;
  try { yol = decodeURIComponent(u.pathname); } catch { return false; }
  if (yol.includes('\0')) return false;
  if (win) {
    yol = yol.replace(/^\/([A-Za-z]:)/, '$1');
    if (yol.startsWith('\\') || yol.startsWith('//') || !/^[A-Za-z]:[\\/]/.test(yol)) return false;
  } else if (!yol.startsWith('/')) return false;
  const norm = (x) => { const r = P.resolve(x).replace(/[\\/]+$/, ''); return win ? r.toLowerCase() : r; };
  const r = norm(yol);
  return kokler.some((k) => { const kk = norm(k); return r.startsWith(kk + P.sep); });
}

// Ağ isteği kararı: yalnız izinli file:, blob: ve data:.
function istekIzinli(url, kokler, platform) {
  const u = String(url);
  if (u.startsWith('blob:') || u.startsWith('data:')) return true;
  if (/^file:/i.test(u)) return dosyaUrlIzinli(u, kokler, platform);
  return false;
}

function gonderenGecerli(url, beklenenUrl) {
  return typeof url === 'string' && url === beklenenUrl;
}

// "Aç" düğmesinin açabileceği çıktı uzantıları: yalnız dönüştürücünün ürettiği belge, görsel, ses, video ve veri
// türleri. Çalıştırılabilir/betik türleri (exe, bat, cmd, ps1, vbs, js, hta, lnk, msi, scr, jar...) ile etkin
// içerik taşıyabilen svg, html ve htmlz bilerek yok; arşivden çıkan dosyalar yalnız bu listedeyse açılır.
const ACILABILIR_UZANTILAR = new Set([
  'pdf', 'docx', 'odt', 'rtf', 'txt', 'md', 'epub', 'mobi', 'azw3', 'fb2',
  'xlsx', 'ods', 'csv', 'tsv', 'pptx', 'odp', 'json', 'yaml', 'yml', 'xml',
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif', 'gif', 'bmp', 'ico',
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', '3gp', 'ogv',
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'ac3', 'mp2', 'zip', 'gz'
]);

// "Aç" için denetim zinciri: üretilmiş yol, izinli uzantı, hâlâ var olan normal dosya (sembolik bağ değil).
function acilabilirCiktiDogrula(yol, uretilenler, fs = nodeFs) {
  if (!yolBicimiGecerli(yol) || !uretilenler || typeof uretilenler.var !== 'function' || !uretilenler.var(yol)) {
    throw new Error('Bu yol programın ürettiği bir çıktı değil.');
  }
  if (!ACILABILIR_UZANTILAR.has(uzantiAl(yol))) {
    throw new Error('Bu dosya türü programdan açılmaz; "Klasörde göster" ile ulaşabilirsin.');
  }
  let st;
  try { st = fs.lstatSync(yol); } catch { throw new Error('Dosya artık yok.'); }
  if (!st.isFile()) throw new Error('Yalnız normal dosyalar açılır.');
  return path.resolve(yol);
}

module.exports = {
  acilabilirCiktiDogrula,
  ACILABILIR_UZANTILAR,
  SABIT_INDIRME_URL, LIMITLER, VARSAYILAN_ISLEMLER, KALITELER, TEMALAR,
  CIKTI_YERLERI, PDF_KALITELERI, SONEK_DESENI, MAKS_ARGV_DOSYA,
  kaynakCiktiKlasoru, isHazirla, argvSuz, argvDosyalari,
  YolKumesi, normalize, yolBicimiGecerli, dosyaMi, klasorMu,
  girdiYoluDogrula, sofficeAdiGecerli, ciktiKlasoruDogrula, izinliDosyaKokleri, dosyaUrlIzinli, istekIzinli, uzantiAl, islemAdlari, hedefDogrula,
  secenekTemizle, isDogrula, ayarDogrula, gorselBicimiGecerli, veriBaytlari, guvenliAd, gonderenGecerli
};
