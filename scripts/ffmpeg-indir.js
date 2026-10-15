#!/usr/bin/env node
'use strict';

// FFmpeg 6.1.1 (win32-x64) indirir, SHA-256 doğrular ve vendor/ffmpeg/ffmpeg.exe olarak yazar.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

const URL_ADRESI = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz';
const BEKLENEN_SHA256 = '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77';
const IZINLI_HOSTLAR = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAKS_INDIRME = 300 * 1024 * 1024;
const MAKS_ACILMIS = 600 * 1024 * 1024;
const MAKS_YONLENDIRME = 5;

const LISANS_METNI = `FFmpeg
======
Bu klasördeki ffmpeg.exe, FFmpeg 6.1.1 sürümünün GPL-3.0 lisanslı bir derlemesidir.
FFmpeg, Dosya Dönüştürücü tarafından ayrı bir program olarak çağrılır; uygulamaya bağlanmaz.

Lisans   : GNU General Public License sürüm 3 (GPL-3.0) - https://www.gnu.org/licenses/gpl-3.0.html
Kaynak   : https://ffmpeg.org/download.html
Derleme  : https://github.com/eugeneware/ffmpeg-static (sürüm b6.1.1)

FFmpeg, FFmpeg geliştiricilerinin ticari markasıdır.
Kaynak kodu için yukarıdaki adresleri kullanabilirsiniz.
`;

function adresiDenetle(adres) {
  const u = new URL(adres);
  if (u.protocol !== 'https:') throw new Error(`Yalnız HTTPS adreslerine izin verilir: ${adres}`);
  if (u.username || u.password) throw new Error('Kullanıcı bilgisi içeren adreslere izin verilmez.');
  if (!IZINLI_HOSTLAR.has(u.hostname)) throw new Error(`İzin verilmeyen sunucu: ${u.hostname}`);
  return u;
}

function proxyVar() {
  return process.env.HTTPS_PROXY || process.env.https_proxy || '';
}

async function sha256Dosya(yol) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(yol), h);
  return h.digest('hex');
}

// ---- Düz https ile indirme (yönlendirmeler elle, izinli hostlara) ----
function httpsIndir(adres, hedef, kalan = MAKS_YONLENDIRME) {
  return new Promise((coz, reddet) => {
    let u;
    try { u = adresiDenetle(adres); } catch (e) { return reddet(e); }
    const istek = https.get(u, { headers: { 'User-Agent': 'dosya-donusturucu-indirici' } }, (yanit) => {
      const kod = yanit.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(kod)) {
        yanit.resume();
        if (kalan <= 0) return reddet(new Error('Çok fazla yönlendirme.'));
        let sonraki;
        try { sonraki = new URL(yanit.headers.location, u).href; } catch (e) { return reddet(e); }
        return httpsIndir(sonraki, hedef, kalan - 1).then(coz, reddet);
      }
      if (kod !== 200) {
        yanit.resume();
        return reddet(new Error(`İndirme başarısız: HTTP ${kod}`));
      }
      let toplam = 0;
      yanit.on('data', (d) => {
        toplam += d.length;
        if (toplam > MAKS_INDIRME) istek.destroy(new Error('İndirilen dosya beklenenden büyük.'));
      });
      pipeline(yanit, fs.createWriteStream(hedef, { flags: 'wx' })).then(coz, reddet);
    });
    istek.setTimeout(60000, () => istek.destroy(new Error('İndirme zaman aşımına uğradı.')));
    istek.on('error', reddet);
  });
}

// ---- Proxy varsa curl (argüman dizisi, shell yok); yönlendirmeler elle denetlenir ----
function curlCalistir(argumanlar) {
  return new Promise((coz, reddet) => {
    const c = spawn('curl', argumanlar, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => reddet(new Error(`curl çalıştırılamadı: ${e.message}`)));
    c.on('close', (kod) => (kod === 0 ? coz(out) : reddet(new Error(`curl hatası (kod ${kod}): ${err.trim().slice(-300)}`))));
  });
}

async function curlIndir(adres, hedef) {
  let simdiki = adres;
  for (let i = 0; i <= MAKS_YONLENDIRME; i += 1) {
    const dogrulanmis = adresiDenetle(simdiki);
    const cikti = await curlCalistir(['-sS', '--proto', '=https', '--max-filesize', String(MAKS_INDIRME),
      '--max-time', '600', '-o', hedef, '-w', '%{http_code} %{redirect_url}', dogrulanmis.href]);
    const [kod, yonlendirme] = cikti.trim().split(' ');
    if (['301', '302', '303', '307', '308'].includes(kod)) {
      await fsp.rm(hedef, { force: true });
      if (!yonlendirme) throw new Error('Yönlendirme adresi yok.');
      simdiki = yonlendirme;
      continue;
    }
    if (kod !== '200') {
      await fsp.rm(hedef, { force: true });
      throw new Error(`İndirme başarısız: HTTP ${kod}`);
    }
    return;
  }
  throw new Error('Çok fazla yönlendirme.');
}

async function main() {
  const kok = path.join(__dirname, '..');
  const klasor = path.join(kok, 'vendor', 'ffmpeg');
  const exe = path.join(klasor, 'ffmpeg.exe');
  const onbellek = path.join(klasor, 'ffmpeg-win32-x64.gz');
  await fsp.mkdir(klasor, { recursive: true });

  const lisans = path.join(klasor, 'LISANS.txt');
  if (!fs.existsSync(lisans)) await fsp.writeFile(lisans, LISANS_METNI, 'utf8');

  let gzHazir = false;
  if (fs.existsSync(onbellek)) {
    gzHazir = (await sha256Dosya(onbellek)) === BEKLENEN_SHA256;
    if (!gzHazir) console.warn('Önbellekteki gz dosyası SHA-256 ile eşleşmiyor; yeniden indirilecek.');
  }
  if (gzHazir && fs.existsSync(exe)) {
    console.log('FFmpeg zaten hazır:', exe);
    return;
  }

  if (!gzHazir) {
    const gecici = path.join(klasor, `.indirilen-${crypto.randomBytes(4).toString('hex')}.gz`);
    try {
      console.log('FFmpeg indiriliyor...');
      if (proxyVar()) await curlIndir(URL_ADRESI, gecici);
      else await httpsIndir(URL_ADRESI, gecici);
      const ozet = await sha256Dosya(gecici);
      if (ozet !== BEKLENEN_SHA256) {
        throw new Error(`SHA-256 uyuşmuyor!\n  beklenen: ${BEKLENEN_SHA256}\n  bulunan : ${ozet}`);
      }
      await fsp.rename(gecici, onbellek);
    } catch (e) {
      await fsp.rm(gecici, { force: true }).catch(() => {});
      throw e;
    }
  }

  const geciciExe = path.join(klasor, `.ffmpeg-${crypto.randomBytes(4).toString('hex')}.exe.tmp`);
  try {
    let yazilan = 0;
    const sinirla = new (require('node:stream').Transform)({
      transform(parca, _k, cb) {
        yazilan += parca.length;
        if (yazilan > MAKS_ACILMIS) return cb(new Error('Açılmış dosya beklenenden büyük.'));
        return cb(null, parca);
      },
    });
    await pipeline(fs.createReadStream(onbellek), zlib.createGunzip(), sinirla, fs.createWriteStream(geciciExe, { flags: 'wx' }));
    await fsp.rename(geciciExe, exe);
  } catch (e) {
    await fsp.rm(geciciExe, { force: true }).catch(() => {});
    throw e;
  }
  console.log('FFmpeg hazır:', exe);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
}

module.exports = { main, adresiDenetle, BEKLENEN_SHA256, URL_ADRESI };
