'use strict';
// Test yardımcıları (kendi başına test içermez)

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yollar = require('../src/yollar');
const { sofficeBul } = require('../src/motorlar/libreoffice');

const ffmpegYolu = yollar.ffmpegYolunuBul({ uygulamaKlasoru: path.join(__dirname, '..') });
const sofficeYolu = sofficeBul({});

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dd-test-'));
}

function temizle(...klasorler) {
  for (const k of klasorler) fs.rmSync(k, { recursive: true, force: true });
}

function ortam(ek = {}) {
  return { ffmpegYolu, sofficeYolu, ilerleme: () => {}, ...ek };
}

function ffmpegCalistir(args) {
  const r = spawnSync(ffmpegYolu, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { shell: false, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg başarısız: ${r.stderr}`);
}

/** ffmpeg -i çıktısı (akış bilgisi) */
function bilgi(dosya) {
  const r = spawnSync(ffmpegYolu, ['-hide_banner', '-i', dosya], { shell: false, encoding: 'utf8' });
  return r.stderr;
}

function sureSn(dosya) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(bilgi(dosya));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]) : null;
}

/** ffmpeg ile sağlam çözülüyor mu */
function cozulebilir(dosya) {
  const r = spawnSync(ffmpegYolu, ['-hide_banner', '-v', 'error', '-i', dosya, '-f', 'null', '-'], { shell: false, encoding: 'utf8' });
  return r.status === 0 && r.stderr.trim() === '';
}

function sesUret(yol, sn = 1) {
  ffmpegCalistir(['-f', 'lavfi', '-i', `sine=frequency=440:duration=${sn}`, yol]);
}

function videoUret(yol, sn = 1) {
  ffmpegCalistir(['-f', 'lavfi', '-i', `testsrc=duration=${sn}:size=320x240:rate=10`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${sn}`, '-shortest', '-pix_fmt', 'yuv420p', yol]);
}

function ls(klasor) {
  return fs.readdirSync(klasor).sort();
}

const sharp = require('sharp');
async function pngUret(yol, g = 64, y = 48) {
  await sharp({ create: { width: g, height: y, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toFile(yol);
}

module.exports = { ffmpegYolu, sofficeYolu, gecici, temizle, ortam, ffmpegCalistir, bilgi, sureSn, cozulebilir, sesUret, videoUret, ls, pngUret, fsp };
