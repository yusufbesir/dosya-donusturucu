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
  maksPdfOkuBayt: 1024 * 1024 * 1024, // arayüze verilecek PDF
  maksGecmis: 200
});

// Çekirdek katalogdan işlem listesi alınamazsa kullanılan, SPEC'te adı geçen işlemler.
const VARSAYILAN_ISLEMLER = Object.freeze([
  'birlestir', 'bol', 'dondur', 'gorsel-pdf', 'zip', 'zip-ac', 'gz', 'gz-ac'
]);

const KALITELER = ['yuksek', 'orta', 'kucuk'];
const TEMALAR = ['sistem', 'acik', 'koyu'];

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
  const ekle = (x) => {
    const ad = typeof x === 'string' ? x : x && x.hedef;
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
        if (typeof v !== 'string' || v.length > 200 || !/^[0-9,\-\s]+$/.test(v)) throw new Error('Geçersiz sayfa aralığı.');
        c.sayfalar = v.trim(); break;
      case 'kapakGorseli':
        c.kapakGorseli = girdiYoluDogrula(v, izinli, fs); break;
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
  let ad = path.parse(String(kaynakYol)).name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!ad) ad = 'dosya';
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

module.exports = {
  SABIT_INDIRME_URL, LIMITLER, VARSAYILAN_ISLEMLER, KALITELER, TEMALAR,
  YolKumesi, normalize, yolBicimiGecerli, dosyaMi, klasorMu,
  girdiYoluDogrula, sofficeAdiGecerli, ciktiKlasoruDogrula, izinliDosyaKokleri, dosyaUrlIzinli, istekIzinli, uzantiAl, islemAdlari, hedefDogrula,
  secenekTemizle, isDogrula, ayarDogrula, gorselBicimiGecerli, veriBaytlari, guvenliAd, gonderenGecerli
};
