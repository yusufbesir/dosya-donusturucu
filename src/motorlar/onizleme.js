'use strict';
// Ne: Dosya önizleme altyapısı: görsel -> küçük PNG, PDF -> "N sayfa" metni, EPUB -> kapak küçük resmi; diğerleri null.
//     Arayüz bağlantısı ayrıdır (main/preload). Girdi 200 MB üstüyse ve süre 3 sn'yi aşarsa null döner; asla fırlatmaz.
// Sahibi: Dosya dönüştürücü işi. yazan: [Claude#taadon-1.9-paket-b 2026-11-04]
// Değiştirme kuralı: yeni tür eklemek test/ekip-19b.test.js güncellenerek yapılır; silme yalnız Yusuf'un kararıyla.

const fsp = require('node:fs/promises');
const path = require('node:path');

const EN_BUYUK_GIRDI = 200 * 1024 * 1024;
const SURE_SINIRI_MS = 3000;
const GORSELLER = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff', 'gif', 'bmp', 'svg']);
const KAPAK_ADAYI = /(^|\/)cover[^/]*\.(jpe?g|png|gif|webp)$/i;
const KAPAK_ENBUYUK_BAYT = 20 * 1024 * 1024;

let sharpOnbellek = null;
function sharpAl() { if (!sharpOnbellek) sharpOnbellek = require('sharp'); return sharpOnbellek; }

async function kucult(buf, kenar) {
  const sharp = sharpAl();
  const veri = await sharp(buf, { limitInputPixels: 268402689, failOn: 'none' })
    .rotate().resize({ width: kenar, height: kenar, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return { mime: 'image/png', veri };
}

async function pdfMetni(yol) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(await fsp.readFile(yol), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const n = doc.getPageCount();
  return { metin: `${n} sayfa` };
}

function xmlNitelik(etiket, ad) {
  const m = new RegExp(`${ad}\s*=\s*["']([^"']*)["']`, 'i').exec(etiket);
  return m ? m[1] : null;
}

/** EPUB (zip) içinden kapak: OPF meta cover / properties=cover-image, yoksa cover*.jpg|png adı. */
async function epubKapagi(yol) {
  const { unzipSync } = require('fflate');
  const zip = unzipSync(new Uint8Array(await fsp.readFile(yol)), {
    filter: (f) => f.originalSize <= KAPAK_ENBUYUK_BAYT && (/\.opf$/i.test(f.name) || /\.(jpe?g|png|gif|webp)$/i.test(f.name)),
  });
  const adlar = Object.keys(zip);
  let hedef = null;
  const opfAd = adlar.find((a) => /\.opf$/i.test(a));
  if (opfAd) {
    const opf = Buffer.from(zip[opfAd]).toString('utf8');
    const klasor = path.posix.dirname(opfAd);
    const ogeler = opf.match(/<item\b[^>]*>/gi) || [];
    let href = null;
    const kapakMeta = (opf.match(/<meta\b[^>]*>/gi) || []).find((t) => /name\s*=\s*["']cover["']/i.test(t));
    const kimlik = kapakMeta && xmlNitelik(kapakMeta, 'content');
    if (kimlik) { const o = ogeler.find((t) => xmlNitelik(t, 'id') === kimlik); if (o) href = xmlNitelik(o, 'href'); }
    if (!href) { const o = ogeler.find((t) => /properties\s*=\s*["'][^"']*cover-image/i.test(t)); if (o) href = xmlNitelik(o, 'href'); }
    if (href) {
      let tam = path.posix.normalize(path.posix.join(klasor === '.' ? '' : klasor, decodeURIComponent(href.replace(/[#?].*$/, ''))));
      if (!tam.startsWith('..') && zip[tam]) hedef = tam;
    }
  }
  if (!hedef) hedef = adlar.find((a) => KAPAK_ADAYI.test(a)) || null;
  return hedef ? Buffer.from(zip[hedef]) : null;
}

async function isle(yol, kenar) {
  const uz = path.extname(String(yol)).slice(1).toLowerCase();
  if (GORSELLER.has(uz)) return kucult(await fsp.readFile(yol), kenar);
  if (uz === 'pdf') return pdfMetni(yol);
  if (uz === 'epub') { const kapak = await epubKapagi(yol); return kapak ? kucult(kapak, kenar) : null; }
  return null;
}

/**
 * @param {string} yol
 * @param {{enBuyukKenar?:number, sureSiniriMs?:number}} [sec]
 * @returns {Promise<{mime:string, veri:Buffer}|{metin:string}|null>}
 */
async function onizle(yol, sec = {}) {
  try {
    const kenar = Math.min(Math.max(Number(sec.enBuyukKenar) || 160, 16), 1024);
    const st = await fsp.stat(String(yol));
    if (!st.isFile() || st.size > EN_BUYUK_GIRDI) return null;
    let zamanlayici;
    const sinir = new Promise((coz) => { zamanlayici = setTimeout(() => coz(null), Number(sec.sureSiniriMs) || SURE_SINIRI_MS); });
    try { return await Promise.race([isle(String(yol), kenar), sinir]); } finally { clearTimeout(zamanlayici); }
  } catch {
    return null;
  }
}

module.exports = { onizle, epubKapagi, EN_BUYUK_GIRDI, SURE_SINIRI_MS };
