'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const yollar = require('../yollar');
const surec = require('../surec');
const { BICIMLER, kanonik } = require('../katalog');

const KALITELER = ['yuksek', 'orta', 'kucuk'];

function kaliteAl(sec) {
  const k = sec && sec.kalite ? String(sec.kalite) : 'orta';
  if (!KALITELER.includes(k)) throw new Error(`Geçersiz kalite ayarı: ${k}`);
  return k;
}
const sec3 = (kalite, y, o, k) => (kalite === 'yuksek' ? y : kalite === 'orta' ? o : k);

// ---- Kodek tabloları ----
function sesArgs(kodek, kalite) {
  switch (kodek) {
    case 'aac': return ['-c:a', 'aac', '-b:a', sec3(kalite, '192k', '128k', '96k')];
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', sec3(kalite, '256k', '192k', '128k')];
    case 'opus': return ['-c:a', 'libopus', '-b:a', sec3(kalite, '160k', '128k', '64k')];
    case 'vorbis': return ['-c:a', 'libvorbis', '-q:a', sec3(kalite, '6', '4', '2')];
    case 'wmav2': return ['-c:a', 'wmav2', '-b:a', sec3(kalite, '192k', '128k', '96k')];
    case 'mp2': return ['-c:a', 'mp2', '-ar', '44100', '-ac', '2', '-b:a', sec3(kalite, '256k', '192k', '128k')];
    case 'ac3': return ['-c:a', 'ac3', '-ar', '48000', '-b:a', sec3(kalite, '384k', '256k', '160k')];
    case 'flac': return ['-c:a', 'flac'];
    case 'pcm_s16le': return ['-c:a', 'pcm_s16le'];
    case 'pcm_s16be': return ['-c:a', 'pcm_s16be'];
    default: throw new Error(`Bilinmeyen ses kodeği: ${kodek}`);
  }
}

function videoArgs(kodek, kalite) {
  switch (kodek) {
    case 'h264':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', sec3(kalite, '18', '23', '28'), '-pix_fmt', 'yuv420p'];
    case 'mpeg4':
      return ['-c:v', 'mpeg4', '-q:v', sec3(kalite, '2', '5', '9'), '-pix_fmt', 'yuv420p'];
    case 'mpeg2':
      return ['-c:v', 'mpeg2video', '-q:v', sec3(kalite, '2', '4', '8'), '-pix_fmt', 'yuv420p'];
    case 'wmv2':
      return ['-c:v', 'wmv2', '-b:v', sec3(kalite, '4000k', '2000k', '900k'), '-pix_fmt', 'yuv420p'];
    case 'theora':
      return ['-c:v', 'libtheora', '-q:v', sec3(kalite, '9', '7', '4'), '-pix_fmt', 'yuv420p'];
    case 'vp9':
      return ['-c:v', 'libvpx-vp9', '-crf', sec3(kalite, '28', '33', '38'), '-b:v', '0',
        '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-pix_fmt', 'yuv420p'];
    default: throw new Error(`Bilinmeyen video kodeği: ${kodek}`);
  }
}

const MOV_FLAGS = ['-movflags', '+faststart'];
const VIDEO_PROFIL = {
  mp4: { v: 'h264', a: 'aac', ek: MOV_FLAGS },
  mkv: { v: 'h264', a: 'aac' },
  mov: { v: 'h264', a: 'aac', ek: MOV_FLAGS },
  m4v: { v: 'h264', a: 'aac', ek: MOV_FLAGS },
  ts: { v: 'h264', a: 'aac' },
  flv: { v: 'h264', a: 'aac' },
  '3gp': { v: 'h264', a: 'aac' },
  avi: { v: 'mpeg4', a: 'mp3' },
  webm: { v: 'vp9', a: 'opus' },
  wmv: { v: 'wmv2', a: 'wmav2' },
  mpg: { v: 'mpeg2', a: 'mp2' },
  ogv: { v: 'theora', a: 'vorbis' },
};
const SES_PROFIL = {
  mp3: 'mp3', wav: 'pcm_s16le', flac: 'flac', aac: 'aac', m4a: 'aac', ogg: 'vorbis',
  opus: 'opus', wma: 'wmav2', aiff: 'pcm_s16be', ac3: 'ac3', mp2: 'mp2',
};

// ---- Zaman ----
function sureSaniye(deger) {
  if (deger == null || deger === '') return null;
  if (typeof deger === 'number') {
    if (!Number.isFinite(deger) || deger < 0) throw new Error(`Geçersiz süre: ${deger}`);
    return deger;
  }
  const s = String(deger).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(s);
  if (!m) throw new Error(`Geçersiz süre biçimi: ${s}`);
  if (m[3] === undefined) return Number(m[1]) * 60 + parseFloat(m[2]);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
}

function kirpmaAl(sec) {
  const bas = sureSaniye(sec && sec.baslangic);
  const bit = sureSaniye(sec && sec.bitis);
  if (bas != null && bit != null && bit <= bas) throw new Error('Kırpma bitişi başlangıçtan sonra olmalı.');
  return { bas, bit };
}

function genislikAl(sec) {
  if (sec == null || sec.genislik == null || sec.genislik === '') return null;
  const g = Math.floor(Number(sec.genislik));
  if (!Number.isFinite(g) || g < 16 || g > 16384) throw new Error('Geçersiz genişlik (16-16384).');
  return g - (g % 2);
}

function girdiKirpmaArgs(kirp) {
  const a = [];
  if (kirp.bas != null) a.push('-ss', String(kirp.bas));
  if (kirp.bit != null) a.push('-to', String(kirp.bit));
  return a;
}

// Girdi demuxer beyaz listesi: ffconcat/concat (dış dosya okutabilir), hls, dash, sdp, rtsp vb. YOK.
// Dosya içeriğine bakılarak otomatik seçim (ör. .mp4 adlı sahte ffconcat) bu liste dışındakileri seçemez.
const IZINLI_DEMUXERLAR = [
  'mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm', 'avi', 'asf', 'flv', 'mpeg', 'mpegts', 'mpegvideo',
  'ogg', 'wav', 'w64', 'flac', 'mp3', 'aac', 'ac3', 'eac3', 'aiff', 'amr', 'caf', 'ape', 'wv', 'tta', 'au', 'voc',
  'dts', 'dtshd', 'h264', 'hevc', 'm4v', 'mpeg4video', 'vc1', 'rm', 'gif', 'apng', 'image2', 'image2pipe',
  'png_pipe', 'jpeg_pipe', 'webp_pipe', 'bmp_pipe', 'tiff_pipe', 'svg_pipe', 'avif_pipe', 'ico', 'mjpeg', 'ivf',
  'ogv', 'wtv', 'dv', 'gxf', 'mxf', 'nut', 'swf', 'rawvideo', 'truehd', 'mlp', 'aa', 'sox', 'xwma', 'wsd', 'oma', 'mpl2',
].join(',');

/** Her '-i' girdisinden önce girdi seçeneği olarak protokol (+ lavfi dışında demuxer) beyaz listesi ekler. */
function girdiGuvenligi(args) {
  const c = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-i') {
      c.push('-protocol_whitelist', 'file,pipe');
      const lavfi = args[i - 2] === '-f' && args[i - 1] === 'lavfi';
      if (!lavfi) c.push('-format_whitelist', IZINLI_DEMUXERLAR);
    }
    c.push(args[i]);
  }
  return c;
}

const GLOBAL = ['-hide_banner', '-nostdin', '-n', '-nostats', '-progress', 'pipe:1'];

// ---- Çalıştırıcı + ilerleme ----
/**
 * FFmpeg çalıştırır. sureOverride: toplam süre (sn) biliniyorsa; yoksa stderr "Duration:" satırından okunur.
 * kirp: {bas,bit} ilerleme hesabı için.
 */
async function ffmpegCalistir({ ffmpegYolu, args, sinyal, ilerleme, kirp, sureOverride, zamanAsimi }) {
  if (!ffmpegYolu) throw new Error('FFmpeg bulunamadı.');
  let toplam = sureOverride || null;
  let tampon = '';
  let sonYuzde = -1;
  const bildir = (sn) => {
    if (!ilerleme || !toplam || toplam <= 0) return;
    const y = Math.max(0, Math.min(99, Math.floor((sn / toplam) * 100)));
    if (y !== sonYuzde) { sonYuzde = y; ilerleme(y); }
  };
  const stderrVeri = (d) => {
    if (toplam) return;
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(d);
    if (!m) return;
    let sure = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
    if (kirp) {
      const bas = kirp.bas || 0;
      const bit = kirp.bit != null ? Math.min(kirp.bit, sure) : sure;
      sure = Math.max(bit - bas, 0.001);
    }
    toplam = sure;
  };
  const stdoutVeri = (d) => {
    tampon += d;
    const satirlar = tampon.split(/\r?\n/);
    tampon = satirlar.pop();
    for (const s of satirlar) {
      const i = s.indexOf('=');
      if (i < 0) continue;
      const k = s.slice(0, i);
      const v = s.slice(i + 1).trim();
      if (k === 'out_time_us' || k === 'out_time_ms') {
        const us = Number(v);
        if (Number.isFinite(us) && us >= 0) bildir(us / 1e6);
      }
    }
  };
  const sonuc = await surec.calistir(ffmpegYolu, [...GLOBAL, ...girdiGuvenligi(args)], { sinyal, stdoutVeri, stderrVeri, zamanAsimi });
  if (sonuc.kod !== 0) {
    const satirlar = sonuc.stderr.trim().split(/\r?\n/).filter(Boolean);
    const ozet = satirlar.slice(-4).join(' | ');
    throw new Error(`FFmpeg hatası (kod ${sonuc.kod}): ${ozet || 'bilinmeyen hata'}`);
  }
  return sonuc;
}

// ---- Komut kurucular (saf fonksiyonlar, test edilebilir) ----
function sesVideoGirdisi(girdi, hedef, sec, kalite, kirp) {
  const profil = VIDEO_PROFIL[hedef];
  if (hedef !== 'mp4' && hedef !== 'mpg') throw new Error('Sesten yalnız MP4 ve MPG video üretilebilir.');
  const g = genislikAl(sec) || 1280;
  const y = Math.max(2, Math.round((g * 9) / 16 / 2) * 2);
  const fps = hedef === 'mpg' ? '25' : '10';
  const vf = `scale=${g}:${y}:force_original_aspect_ratio=decrease,pad=${g}:${y}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`;
  const onGiris = [];
  if (sec && sec.kapakGorseli) {
    onGiris.push('-loop', '1', '-framerate', fps, '-i', yollar.ffmpegAdresi(sec.kapakGorseli));
  } else {
    onGiris.push('-f', 'lavfi', '-i', `color=c=black:s=${g}x${y}:r=${fps}`);
  }
  const args = [
    ...onGiris,
    ...girdiKirpmaArgs(kirp), '-i', yollar.ffmpegAdresi(girdi),
    '-map', '0:v:0', '-map', '1:a:0', '-shortest',
    '-vf', vf, '-r', fps,
    ...videoArgs(profil.v, kalite), ...(sec && sec.kapakGorseli && profil.v === 'h264' ? ['-tune', 'stillimage'] : []),
    ...sesArgs(profil.a, kalite), ...(profil.ek || []),
  ];
  return args;
}

/** Tek geçişli dönüştürme komutu (GIF hariç). Çıktı adresi ayrıca eklenir. */
function komutOlustur({ girdi, hedef, secenekler }) {
  const sec = secenekler || {};
  const h = kanonik(hedef);
  const kalite = kaliteAl(sec);
  const kirp = kirpmaAl(sec);
  const kaynakKat = BICIMLER[kanonik(path.extname(girdi).slice(1))];
  const kaynakSes = kaynakKat && kaynakKat.kategori === 'ses';

  if (SES_PROFIL[h]) {
    return [
      ...girdiKirpmaArgs(kirp), '-i', yollar.ffmpegAdresi(girdi),
      '-vn', '-sn', '-dn', '-map', '0:a:0',
      ...sesArgs(SES_PROFIL[h], kalite),
    ];
  }
  if (VIDEO_PROFIL[h]) {
    if (kaynakSes) return sesVideoGirdisi(girdi, h, sec, kalite, kirp);
    const profil = VIDEO_PROFIL[h];
    const g = genislikAl(sec);
    return [
      ...girdiKirpmaArgs(kirp), '-i', yollar.ffmpegAdresi(girdi),
      '-sn', '-dn', '-map', '0:v:0', '-map', '0:a:0?',
      ...(g ? ['-vf', `scale=${g}:-2`] : []),
      ...videoArgs(profil.v, kalite), ...sesArgs(profil.a, kalite), ...(profil.ek || []),
    ];
  }
  throw new Error(`FFmpeg bu hedefi desteklemiyor: ${hedef}`);
}

function gifSecenekleri(sec) {
  const fps = sec.fps == null || sec.fps === '' ? 12 : Math.floor(Number(sec.fps));
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Geçersiz FPS (1-60).');
  const g = genislikAl(sec) || 480;
  return { fps, genislik: g };
}

/** Ana giriş: bir dosyayı dönüştürür; çıktı yolunu döndürür. */
async function calistir(ctx) {
  const { girdiler, hedef: hedefHam, ciktiKlasoru, secenekler, ffmpegYolu, sinyal, ilerleme, geciciKlasor } = ctx;
  const girdi = yollar.girdiYolu(girdiler[0]);
  const hedef = kanonik(hedefHam);
  const sec = secenekler || {};
  const ad = yollar.govdeAdi(girdi);

  if (hedef === 'gif') {
    const { fps, genislik } = gifSecenekleri(sec);
    const kirp = kirpmaAl(sec);
    return yollar.guvenliUret(ciktiKlasoru, ad, 'gif', async (gecici) => {
      const palet = path.join(geciciKlasor, `palet-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
      try {
        const vf = `fps=${fps},scale=${genislik}:-1:flags=lanczos`;
        const kirpArgs = girdiKirpmaArgs(kirp);
        await ffmpegCalistir({
          ffmpegYolu, sinyal, kirp,
          ilerleme: ilerleme && ((y) => ilerleme(y * 0.4)),
          args: [...kirpArgs, '-i', yollar.ffmpegAdresi(girdi), '-an', '-sn', '-dn',
            '-vf', `${vf},palettegen=stats_mode=diff`, '-frames:v', '1', '-update', '1', yollar.ffmpegAdresi(palet)],
        });
        // palettegen tüm akışı okur; ikinci geçiş
        await ffmpegCalistir({
          ffmpegYolu, sinyal, kirp,
          ilerleme: ilerleme && ((y) => ilerleme(40 + y * 0.6)),
          args: [...kirpArgs, '-i', yollar.ffmpegAdresi(girdi), '-i', yollar.ffmpegAdresi(palet), '-an', '-sn', '-dn',
            '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, '-loop', '0',
            '-f', 'gif', yollar.ffmpegAdresi(gecici)],
        });
      } finally {
        await fsp.rm(palet, { force: true }).catch(() => {});
      }
    });
  }

  const args = komutOlustur({ girdi, hedef, secenekler: sec });
  const kirp = kirpmaAl(sec);
  const sureOverride = null;
  return yollar.guvenliUret(ciktiKlasoru, ad, hedef, async (gecici) => {
    await ffmpegCalistir({
      ffmpegYolu, sinyal, ilerleme, kirp, sureOverride,
      args: [...args, yollar.ffmpegAdresi(gecici)],
    });
  });
}

module.exports = {
  calistir,
  ffmpegCalistir,
  komutOlustur,
  girdiGuvenligi,
  IZINLI_DEMUXERLAR,
  sureSaniye,
  VIDEO_PROFIL,
  SES_PROFIL,
};
