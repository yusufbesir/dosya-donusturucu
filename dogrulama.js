'use strict';
// Ana sürecin IPC doğrulama yardımcıları. Electron'a bağımlı değildir; node:test ile denenir.
// 1.9.0 Özellikler anahtarları ve tekPdf seçeneği: [Claude#taadon-1.9-paket-c 2026-11-04]
// 1.10.0 Yönetici paneli (PIN özeti, deneme sayacı, yol maskeleme): [Claude#taadon-1.10-yonetici 2026-11-04]
const path = require('path');
const nodeFs = require('fs');
const crypto = require('crypto');

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
// Ayarlar > Özellikler (1.9.0): her biri boolean, varsayılan açık; kapalıysa özellik görünmez/çalışmaz.
const OZELLIK_ANAHTARLARI = Object.freeze(['ozOnizleme', 'ozGorevCubugu', 'ozPano', 'ozBicimAlgila', 'ozPdfBirlestir', 'ozIsitma']);
// 1.12: ad çakışma kuralı ('numara': ad (1).uz; 'cop': var olan aynı adlı dosya Geri Dönüşüm Kutusu'na, yeni dosya o adı alır — kalıcı silme yok)
const CAKISMA_KURALLARI = Object.freeze(['numara', 'cop']);
const TARIH_KLASOR_DESENI = /^\d{4}-\d{2}-\d{2}$/;
// 1.12 boyut tahmini (kaba oran; yalnız bilgi amaçlı). kaynakKategori: gorsel|belge|tablo|sunum|pdf|ekitap|veri|ses|video
const TAHMIN_ORANLARI = Object.freeze({
  gorsel: { jpg: 0.35, jpeg: 0.35, png: 1.2, webp: 0.25, avif: 0.18, tiff: 2.0, tif: 2.0, gif: 0.5, bmp: 4.0, ico: 0.2, pdf: 1.05 },
  belge: { pdf: 1.1, docx: 1.0, odt: 0.9, rtf: 1.6, txt: 0.3, html: 0.8, epub: 0.9 },
  tablo: { pdf: 0.8, xlsx: 1.0, ods: 0.9, csv: 0.4, html: 1.2 },
  sunum: { pdf: 0.9, pptx: 1.0, odp: 0.9 },
  pdf: { docx: 0.9, png: 3.0, jpg: 1.5, txt: 0.05 },
  ekitap: { epub: 1.0, mobi: 1.3, azw3: 1.1, pdf: 1.4, txt: 0.3, docx: 1.0 },
  veri: { json: 1.2, csv: 0.8, yaml: 1.0, xml: 1.5, tsv: 0.8 }
});
function boyutTahmini(kategori, hedef, toplamBayt) {
  const oranlar = Object.hasOwn(TAHMIN_ORANLARI, kategori) ? TAHMIN_ORANLARI[kategori] : null;
  const h = String(hedef || '').toLowerCase();
  const oran = oranlar && Object.hasOwn(oranlar, h) ? oranlar[h] : null;
  if (!oran || !Number.isFinite(toplamBayt) || toplamBayt <= 0) return null;
  return Math.round(toplamBayt * oran);
}
function tarihKlasorAdi(simdi = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${simdi.getFullYear()}-${p(simdi.getMonth() + 1)}-${p(simdi.getDate())}`;
}

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
      case 'tekPdf': // çoklu dosyada çıktıları tek PDF'de birleştir (1.9.0)
        if (typeof v !== 'boolean') throw new Error('Geçersiz tek PDF seçeneği.');
        if (v) c.tekPdf = true;
        break;
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
  let hazir = kaynakCiktiKlasoru(ham, a.ciktiYeri, ctx);
  // 1.12 tarihli alt klasör: çıktı <klasör>\YYYY-AA-GG altına; klasör yoksa oluşturulur (yalnız izinli çıktı klasörü altında)
  if (a.tarihliKlasor === true && hazir && typeof hazir.ciktiKlasoru === 'string') {
    const fsImpl = ctx.fs || nodeFs;
    // Güvenlik: önce üst klasör izinli ve var olan bir çıktı klasörü olmalı; alt klasör adı yalnız tarihKlasorAdi() üretir.
    const ustKlasor = ciktiKlasoruDogrula(hazir.ciktiKlasoru, ctx.izinliKlasorler, fsImpl);
    const altKlasor = path.join(ustKlasor, tarihKlasorAdi(ctx.simdi));
    fsImpl.mkdirSync(altKlasor, { recursive: true });
    ctx.izinliKlasorler.ekle(altKlasor);
    hazir = Object.assign({}, hazir, { ciktiKlasoru: altKlasor });
  }
  const is = isDogrula(hazir, ctx);
  is.sonek = typeof a.sonek === 'string' && SONEK_DESENI.test(a.sonek) ? a.sonek : '';
  is.ozgunTasi = a.ozgunTasi === true;
  is.ustVeriTemizle = a.ustVeriTemizle === true;
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
    case 'cakisma':
      if (!CAKISMA_KURALLARI.includes(deger)) throw new Error('Geçersiz çakışma kuralı.');
      return deger;
    case 'tarihliKlasor':
    case 'ozBoyutTahmini':
      if (typeof deger !== 'boolean') throw new Error('Boolean olmalı.');
      return deger;
    case 'sonek':
      if (typeof deger !== 'string' || !SONEK_DESENI.test(deger)) {
        throw new Error('Sonek en çok 20 karakter olmalı; yalnız harf, rakam, boşluk, _ . - kullanılabilir.');
      }
      return deger;
    case 'ozgunTasi':
      if (typeof deger !== 'boolean') throw new Error('Geçersiz değer.');
      return deger;
    case 'ustVeriTemizle': // gizlilik: çıktıdan üst veriyi sil (varsayılan kapalı); [Claude#taadon-ekip-b 2026-11-04]
      if (typeof deger !== 'boolean') throw new Error('Geçersiz değer.');
      return deger;
    case 'motorRust': // arşiv işlerinde Rust çekirdeği (taa-donustur); [Claude#taadon-rust-asama2 2026-11-04]
      if (typeof deger !== 'boolean') throw new Error('Geçersiz değer.');
      return deger;
    case 'ozYonetici': // Yönetici paneli kartı görünsün mü (varsayılan açık) [Claude#taadon-1.10-yonetici 2026-11-04]
      if (typeof deger !== 'boolean') throw new Error('Geçersiz değer.');
      return deger;
    case 'yoneticiPinOzeti': // yalnız SHA-256 özeti (64 küçük hex) ya da '' (PIN yok); düz PIN hiçbir yere yazılmaz
      if (deger === '') return '';
      if (typeof deger !== 'string' || !OZET_DESENI.test(deger)) throw new Error('Geçersiz PIN özeti.');
      return deger;
    case 'ozOnizleme': case 'ozGorevCubugu': case 'ozPano': case 'ozBicimAlgila': case 'ozPdfBirlestir': case 'ozIsitma':
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

/* ---------- Yönetici paneli (1.10.0) [Claude#taadon-1.10-yonetici 2026-11-04] ---------- */
const PIN_DESENI = /^[0-9]{4,8}$/;
const OZET_DESENI = /^[0-9a-f]{64}$/;
const PIN_ONEK = 'taadon-yonetici-pin:'; // sabit önek: aynı PIN'in başka programlardaki SHA-256 özetiyle eşleşmesin

/** PIN 4-8 haneli rakam dizgesi mi */
function pinGecerli(pin) {
  return typeof pin === 'string' && PIN_DESENI.test(pin);
}

/** PIN'in SHA-256 özeti (64 küçük hex). Geçersiz PIN hata verir; PIN hata metnine konmaz. */
function pinOzeti(pin) {
  if (!pinGecerli(pin)) throw new Error('PIN 4-8 haneli rakam olmalı.');
  return crypto.createHash('sha256').update(PIN_ONEK + pin, 'utf8').digest('hex');
}

/** PIN kayıtlı özetle eşleşiyor mu (sabit süreli karşılaştırma) */
function pinEslesir(pin, ozet) {
  if (!pinGecerli(pin) || typeof ozet !== 'string' || !OZET_DESENI.test(ozet)) return false;
  return crypto.timingSafeEqual(Buffer.from(pinOzeti(pin), 'hex'), Buffer.from(ozet, 'hex'));
}

/**
 * Yanlış PIN deneme sayacı (saf; saat dışarıdan verilebilir). `maks` yanlış denemeden sonra `beklemeMs` boyunca
 * kilit açma reddedilir; bekleme bitince sayaç sıfırlanır. bekleme() kalan ms'yi (0 = deneyebilir) döndürür.
 */
function pinDenemeSayaci({ maks = 5, beklemeMs = 60000, saat = Date.now } = {}) {
  let yanlis = 0;
  let bitis = 0;
  return {
    bekleme() {
      const kalan = bitis - saat();
      if (kalan > 0) return kalan;
      if (bitis) { bitis = 0; yanlis = 0; }
      return 0;
    },
    basarisiz() {
      yanlis++;
      if (yanlis >= maks) bitis = saat() + beklemeMs;
      return yanlis;
    },
    sifirla() { yanlis = 0; bitis = 0; },
    get yanlis() { return yanlis; }
  };
}

/**
 * Tanı metninde kullanıcı adını maskeler: verilen adların (ör. Windows kullanıcı adı, ev klasörü adı) yol ayracı,
 * tırnak ya da boşlukla sınırlanan her geçişi `%USER%` olur (büyük/küçük harf duyarsız). 2 karakterden kısa ad atlanır.
 */
function yolMaskele(metin, adlar) {
  let m = String(metin == null ? '' : metin);
  const liste = [...new Set((Array.isArray(adlar) ? adlar : [adlar]).filter((a) => typeof a === 'string' && a.length >= 2))]
    .sort((a, b) => b.length - a.length);
  for (const ad of liste) {
    const kacis = ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    m = m.replace(new RegExp(`(^|[\\\\/"'\\s=:])${kacis}(?=$|[\\\\/"'\\s,;])`, 'gi'), '$1%USER%');
  }
  return m;
}

/** Tanı dosyasına girecek ayarlar: PIN özeti yerine yalnız "var/yok" bilgisi. */
function taniAyarlari(ayarlar) {
  const a = Object.assign({}, ayarlar || {});
  a.yoneticiPinOzeti = a.yoneticiPinOzeti ? '(maskeli)' : '';
  return a;
}

module.exports = {
  CAKISMA_KURALLARI, TARIH_KLASOR_DESENI, tarihKlasorAdi, boyutTahmini,
  PIN_DESENI, OZET_DESENI, pinGecerli, pinOzeti, pinEslesir, pinDenemeSayaci, yolMaskele, taniAyarlari,
  acilabilirCiktiDogrula,
  ACILABILIR_UZANTILAR,
  SABIT_INDIRME_URL, LIMITLER, VARSAYILAN_ISLEMLER, KALITELER, TEMALAR,
  CIKTI_YERLERI, PDF_KALITELERI, SONEK_DESENI, MAKS_ARGV_DOSYA, OZELLIK_ANAHTARLARI,
  kaynakCiktiKlasoru, isHazirla, argvSuz, argvDosyalari,
  YolKumesi, normalize, yolBicimiGecerli, dosyaMi, klasorMu,
  girdiYoluDogrula, sofficeAdiGecerli, ciktiKlasoruDogrula, izinliDosyaKokleri, dosyaUrlIzinli, istekIzinli, uzantiAl, islemAdlari, hedefDogrula,
  secenekTemizle, isDogrula, ayarDogrula, gorselBicimiGecerli, veriBaytlari, guvenliAd, gonderenGecerli
};
