'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const yollar = require('../yollar');
const { kanonik } = require('../katalog');
const ffmpeg = require('./ffmpeg');

sharp.cache(false);

const PIKSEL_SINIRI = 268402689; // libvips varsayılanı; her açılışta açıkça verilir
const KALITE = { yuksek: 92, orta: 80, kucuk: 60 };

function kaliteDegeri(sec) {
  const k = (sec && sec.kalite) || 'orta';
  if (!KALITE[k]) throw new Error(`Geçersiz kalite ayarı: ${k}`);
  return KALITE[k];
}

function genislikAl(sec) {
  if (!sec || sec.genislik == null || sec.genislik === '') return null;
  const g = Math.floor(Number(sec.genislik));
  if (!Number.isFinite(g) || g < 1 || g > 32000) throw new Error('Geçersiz genişlik (1-32000).');
  return g;
}

function ac(girdi, hedef) {
  const uz = yollar.uzantiAl(girdi);
  const secenek = { limitInputPixels: PIKSEL_SINIRI, animated: hedef === 'gif' || hedef === 'webp' };
  if (uz === 'svg') {
    // Dosya yolundan değil Buffer'dan aç: libvips göreli kardeş dosyaları (xlink:href) yüklemesin.
    secenek.density = 144;
    return sharp(fs.readFileSync(girdi), secenek);
  }
  return sharp(girdi, secenek);
}

function bicimUygula(img, hedef, sec) {
  const q = kaliteDegeri(sec);
  switch (hedef) {
    case 'jpg': return img.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: false });
    case 'png': return img.png({ compressionLevel: 9 });
    case 'webp': return img.webp({ quality: q });
    case 'avif': return img.avif({ quality: Math.min(q, 85), effort: 4 });
    case 'tiff': return img.tiff({ quality: q, compression: 'lzw' });
    case 'gif': return img.gif();
    default: throw new Error(`Görsel hedefi desteklenmiyor: ${hedef}`);
  }
}

async function sharpYaz(girdi, cikti, hedef, sec) {
  let img = ac(girdi, hedef).rotate();
  const g = genislikAl(sec);
  if (g) img = img.resize({ width: g, withoutEnlargement: true });
  await bicimUygula(img, hedef, sec).toFile(cikti);
}

async function pngAraDosya(girdi, sec, geciciKlasor, { azamiKenar, beyazZemin }) {
  const ara = path.join(geciciKlasor, `ara-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  let img = ac(girdi, 'png').rotate();
  const g = genislikAl(sec);
  if (g) img = img.resize({ width: g, withoutEnlargement: true });
  if (azamiKenar) img = img.resize({ width: azamiKenar, height: azamiKenar, fit: 'inside', withoutEnlargement: true });
  if (beyazZemin) img = img.flatten({ background: '#ffffff' });
  await img.png().toFile(ara);
  return ara;
}

async function bmpIco(ctx, girdi, hedef, ad) {
  const { ciktiKlasoru, secenekler: sec, ffmpegYolu, sinyal, geciciKlasor } = ctx;
  if (!ffmpegYolu) throw new Error('BMP/ICO için FFmpeg gerekli ama bulunamadı.');
  const ara = await pngAraDosya(girdi, sec, geciciKlasor, hedef === 'ico'
    ? { azamiKenar: 256, beyazZemin: false }
    : { beyazZemin: true });
  try {
    return await yollar.guvenliUret(ciktiKlasoru, ad, hedef, async (gecici) => {
      const args = hedef === 'ico'
        ? ['-i', yollar.ffmpegAdresi(ara), '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgba', '-f', 'ico', yollar.ffmpegAdresi(gecici)]
        : ['-i', yollar.ffmpegAdresi(ara), '-frames:v', '1', '-pix_fmt', 'bgr24', '-f', 'image2', '-c:v', 'bmp', '-update', '1', yollar.ffmpegAdresi(gecici)];
      await ffmpeg.ffmpegCalistir({ ffmpegYolu, args, sinyal });
    });
  } finally {
    await fsp.rm(ara, { force: true }).catch(() => {});
  }
}

// ---- PDF ----
async function sayfayaGoreEkle(pdf, gomulu, sec) {
  let w = gomulu.width * 0.75;
  let h = gomulu.height * 0.75;
  let cizim = { x: 0, y: 0, width: w, height: h };
  if (sec && sec.sayfa === 'a4') {
    const yatay = w > h;
    const pw = yatay ? 841.89 : 595.28;
    const ph = yatay ? 595.28 : 841.89;
    const kenar = 28;
    const olcek = Math.min((pw - 2 * kenar) / w, (ph - 2 * kenar) / h, 1e6);
    const cw = w * olcek;
    const ch = h * olcek;
    cizim = { x: (pw - cw) / 2, y: (ph - ch) / 2, width: cw, height: ch };
    w = pw; h = ph;
  }
  const sayfa = pdf.addPage([Math.max(w, 1), Math.max(h, 1)]);
  sayfa.drawImage(gomulu, cizim);
}

async function gorseliGom(pdf, girdi) {
  const uz = kanonik(yollar.uzantiAl(girdi));
  const meta = await sharp(uz === 'svg' ? await fsp.readFile(girdi) : girdi, { limitInputPixels: PIKSEL_SINIRI }).metadata();
  const duzJpg = uz === 'jpg' && meta.format === 'jpeg' && (!meta.orientation || meta.orientation === 1)
    && (meta.space === 'srgb' || meta.space === 'b-w');
  const duzPng = uz === 'png' && meta.format === 'png' && !meta.isProgressive && meta.depth === 'uchar';
  if (duzJpg) return pdf.embedJpg(await fsp.readFile(girdi));
  if (duzPng) return pdf.embedPng(await fsp.readFile(girdi));
  const tampon = await ac(girdi, 'png').rotate().png().toBuffer();
  return pdf.embedPng(tampon);
}

async function pdfYaz(ctx, girdiler, ad) {
  const { ciktiKlasoru, secenekler: sec, sinyal } = ctx;
  return yollar.guvenliUret(ciktiKlasoru, ad, 'pdf', async (gecici) => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < girdiler.length; i += 1) {
      if (sinyal && sinyal.aborted) throw require('../surec').iptalHatasi();
      const g = await gorseliGom(pdf, yollar.girdiYolu(girdiler[i]));
      await sayfayaGoreEkle(pdf, g, sec);
      if (ctx.ilerleme) ctx.ilerleme(Math.floor(((i + 1) / girdiler.length) * 95));
    }
    await fsp.writeFile(gecici, await pdf.save(), { flag: 'wx' });
  });
}

// sharp (libvips) BMP ve ICO okuyamaz: FFmpeg ile PNG ara dosyaya çevrilir
async function girisiHazirla(ctx, yol, ara) {
  const uz = yollar.uzantiAl(yol);
  if (uz !== 'bmp' && uz !== 'ico') return yol;
  if (!ctx.ffmpegYolu) throw new Error('BMP/ICO okumak için FFmpeg gerekli ama bulunamadı.');
  const hedef = path.join(ctx.geciciKlasor, `giris-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  ara.push(hedef);
  await ffmpeg.ffmpegCalistir({
    ffmpegYolu: ctx.ffmpegYolu, sinyal: ctx.sinyal,
    args: ['-i', yollar.ffmpegAdresi(yol), '-frames:v', '1', '-update', '1', '-f', 'image2', '-c:v', 'png', yollar.ffmpegAdresi(hedef)],
  });
  return hedef;
}

async function calistir(ctx) {
  const ara = [];
  try {
    return await calistirIc(ctx, ara);
  } finally {
    for (const a of ara) await fsp.rm(a, { force: true }).catch(() => {});
  }
}

async function calistirIc(ctx, ara) {
  const hedef = kanonik(ctx.hedef);
  const girdiler = ctx.girdiler.map((g) => yollar.girdiYolu(g));
  if (ctx.sinyal && ctx.sinyal.aborted) throw require('../surec').iptalHatasi();
  const adlar = girdiler.map((g) => yollar.govdeAdi(g));
  for (let i = 0; i < girdiler.length; i += 1) girdiler[i] = await girisiHazirla(ctx, girdiler[i], ara);

  if (hedef === 'pdf' || hedef === 'gorsel-pdf') {
    const ad = girdiler.length > 1 ? 'gorseller' : adlar[0];
    return pdfYaz(ctx, girdiler, ad);
  }
  const girdi = girdiler[0];
  if (hedef === 'bmp' || hedef === 'ico') return bmpIco(ctx, girdi, hedef, adlar[0]);
  return yollar.guvenliUret(ctx.ciktiKlasoru, adlar[0], hedef, async (gecici) => {
    await sharpYaz(girdi, gecici, hedef, ctx.secenekler);
  });
}

module.exports = { calistir, PIKSEL_SINIRI };
