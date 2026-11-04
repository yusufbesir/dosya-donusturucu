'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function uzantiAl(yol) {
  return path.extname(String(yol)).slice(1).toLowerCase();
}

function govdeAdi(yol) {
  const b = path.basename(String(yol));
  const e = path.extname(b);
  return e && e !== b ? b.slice(0, -e.length) : b;
}

/** UTF-16 kod birimi değil, kod noktası (emoji bölünmez) sayarak keser. */
function kisalt(metin, n) {
  const k = Array.from(String(metin));
  return k.length > n ? k.slice(0, n).join('') : String(metin);
}

const ayrilmis = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function temizAd(ad) {
  let s = String(ad == null ? '' : ad).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  s = s.replace(/[. ]+$/, '').replace(/^\s+/, '');
  if (!s || /^\.+$/.test(s)) s = 'dosya';
  if (ayrilmis.test(s)) s = `_${s}`;
  if (Array.from(s).length > 120) {
    s = kisalt(s, 120).replace(/[. ]+$/, '');
    if (!s) s = 'dosya';
  }
  return s;
}

function girdiYolu(yol) {
  if (typeof yol !== 'string' || yol.length === 0) throw new Error('Geçersiz dosya yolu.');
  if (yol.includes('\u0000')) throw new Error('Geçersiz dosya yolu (NUL karakteri).');
  // '-' ile başlayan ya da 'xxx:' gibi görünen yollar da tam yola çevrilir
  return path.resolve(yol);
}

/** FFmpeg girdi/çıktı adresi: her zaman tam yol + "file:" öneki (protokol kaçırma önlemi). */
function ffmpegAdresi(yol) {
  return `file:${girdiYolu(yol)}`;
}

function varMi(yol) {
  try {
    fs.lstatSync(yol);
    return true;
  } catch {
    return false;
  }
}

function adayYol(klasor, ad, uzanti, n) {
  const u = String(uzanti || '').replace(/^\./, '');
  const sonek = n === 0 ? '' : ` (${n})`;
  return path.join(klasor, `${ad}${sonek}${u ? `.${u}` : ''}`);
}

/** Var olan hiçbir dosyanın üzerine yazmayan ad: ad.ext, ad (1).ext, ... */
function benzersizYol(klasor, ad, uzanti) {
  for (let n = 0; n < 100000; n += 1) {
    const aday = adayYol(klasor, ad, uzanti, n);
    if (!varMi(aday)) return aday;
  }
  throw new Error('Benzersiz dosya adı üretilemedi.');
}

function geciciYol(klasor, ad, uzanti) {
  const u = String(uzanti || '').replace(/^\./, '');
  const rastgele = crypto.randomBytes(5).toString('hex');
  return path.join(klasor, `.~${kisalt(temizAd(ad), 40)}-${rastgele}${u ? `.${u}` : ''}`);
}

/** Geçici dosyayı siler; Windows'ta EBUSY/EPERM için yeniden dener, yine olmazsa uyarır. */
async function geciciSil(yol) {
  try {
    await fsp.rm(yol, { force: true, maxRetries: 5, retryDelay: 150 });
  } catch (e) {
    console.warn(`Geçici dosya silinemedi: ${yol} (${e && e.code ? e.code : e})`);
  }
}

/** Klasör+ad+sonek+uzantı toplam yolu 200'ü aşmasın diye adı (uzantı korunarak) kısaltır. */
function adiSigdir(klasor, ad, uzanti) {
  const u = String(uzanti || '').replace(/^./, '');
  const uzunUzanti = u ? u.length + 1 : 0;
  const butce = 200 - path.join(klasor, 'x').length + 1 - uzunUzanti - 8; // 8: " (99999)"
  if (Array.from(ad).length <= butce) return ad;
  const kisa = kisalt(ad, Math.max(butce, 1)).replace(/[. ]+$/, '');
  return kisa || 'dosya';
}

const KOPYA_KODLARI = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EACCES', 'ENOSYS', 'EMLINK']);

/** Geçici dosyayı, var olanın üzerine yazmadan benzersiz son ada taşır (link/EXCL ile atomik). */
async function tasiBenzersiz(gecici, klasor, ad, uzanti) {
  for (let n = 0; n < 100000; n += 1) {
    const aday = adayYol(klasor, ad, uzanti, n);
    if (varMi(aday)) continue;
    try {
      await fsp.link(gecici, aday);
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      if (!KOPYA_KODLARI.has(e.code)) throw e;
      try {
        await fsp.copyFile(gecici, aday, fs.constants.COPYFILE_EXCL);
      } catch (e2) {
        if (e2.code === 'EEXIST') continue;
        await fsp.rm(aday, { force: true }).catch(() => {});
        throw e2;
      }
    }
    await geciciSil(gecici);
    return aday;
  }
  throw new Error('Benzersiz dosya adı üretilemedi.');
}

/**
 * Çıktıyı geçici adla üretir; başarılıysa son ada taşır, hata/iptalde yalnız kendi geçici dosyasını siler.
 * fn(geciciYol) geçici yola yazmalıdır.
 */
async function guvenliUret(klasor, ad, uzanti, fn) {
  if (typeof ad === 'string' && path.basename(ad) !== ad) throw new Error('Geçersiz çıktı adı (klasör bileşeni içeriyor).');
  ad = temizAd(ad);
  if (path.basename(ad) !== ad) throw new Error('Geçersiz çıktı adı.');
  ad = adiSigdir(klasor, ad, uzanti);
  await fsp.mkdir(klasor, { recursive: true });
  const gecici = geciciYol(klasor, ad, uzanti);
  try {
    await fn(gecici);
    let st;
    try { st = await fsp.stat(gecici); } catch { st = null; }
    if (!st || st.size === 0) throw new Error('Çıktı dosyası üretilemedi.');
    return await tasiBenzersiz(gecici, klasor, ad, uzanti);
  } catch (e) {
    await geciciSil(gecici);
    throw e;
  }
}

async function geciciKlasorOlustur(taban) {
  const kok = taban || os.tmpdir();
  await fsp.mkdir(kok, { recursive: true });
  return fsp.mkdtemp(path.join(kok, 'dd-'));
}

function calistirilabilir(yol, platform) {
  try {
    const st = fs.statSync(yol);
    if (!st.isFile()) return false;
    if ((platform || process.platform) === 'win32') return true;
    fs.accessSync(yol, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function dosyaMi(yol) {
  try {
    return fs.statSync(yol).isFile();
  } catch {
    return false;
  }
}

function pathteBul(adlar, env, platform) {
  const pathDegeri = (env && (env.PATH || env.Path || env.path)) || '';
  const plt = platform || process.platform;
  const uzantilar = plt === 'win32' ? ['.exe', '.com', ''] : [''];
  for (const klasor of pathDegeri.split(path.delimiter)) {
    if (!klasor) continue;
    for (const ad of adlar) {
      for (const u of uzantilar) {
        const aday = path.join(klasor, ad + u);
        if (calistirilabilir(aday, plt)) return aday;
      }
    }
  }
  return null;
}

/** FFmpeg yolu: Windows paketinde resourcesPath/ffmpeg/ffmpeg.exe, geliştirmede vendor/ffmpeg/ffmpeg.exe, Linux'ta PATH. */
function ffmpegYolunuBul({ resourcesPath, uygulamaKlasoru, platform, env } = {}) {
  const plt = platform || process.platform;
  if (plt === 'win32') {
    const adaylar = [];
    if (resourcesPath) adaylar.push(path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
    if (uygulamaKlasoru) adaylar.push(path.join(uygulamaKlasoru, 'vendor', 'ffmpeg', 'ffmpeg.exe'));
    for (const a of adaylar) if (dosyaMi(a)) return a;
    return null;
  }
  const bulunan = pathteBul(['ffmpeg'], env || process.env, plt);
  if (bulunan) return bulunan;
  if (uygulamaKlasoru) {
    const yerel = path.join(uygulamaKlasoru, 'vendor', 'ffmpeg', 'ffmpeg');
    if (calistirilabilir(yerel, plt)) return yerel;
  }
  return null;
}

module.exports = {
  uzantiAl,
  govdeAdi,
  kisalt,
  temizAd,
  girdiYolu,
  ffmpegAdresi,
  benzersizYol,
  geciciYol,
  tasiBenzersiz,
  guvenliUret,
  geciciKlasorOlustur,
  ffmpegYolunuBul,
  pathteBul,
  dosyaMi,
  varMi,
};
