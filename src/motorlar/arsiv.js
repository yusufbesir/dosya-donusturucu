'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate, Gzip, Gunzip } = require('fflate');
const yollar = require('../yollar');
const surec = require('../surec');
const { kanonik } = require('../katalog');

const VARSAYILAN_MAKS_BOYUT = 2 * 1024 * 1024 * 1024; // 2 GB
const VARSAYILAN_MAKS_DOSYA = 100000;
const OKUMA_BAYT = 64 * 1024;
const YAZMA_OKUMA_BAYT = 256 * 1024;

// Zaten sıkıştırılmış biçimler: sıkıştırmadan sakla
const SAKLA = new Set(['zip', 'gz', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'mp3', 'mp4', 'mkv', 'webm', 'm4a',
  'aac', 'ogg', 'opus', 'flac', 'mov', 'avi', 'docx', 'xlsx', 'pptx', '7z', 'rar', 'bz2', 'xz']);

function iptalKontrol(sinyal) {
  if (sinyal && sinyal.aborted) throw surec.iptalHatasi();
}

function sinirDegeri(deger, varsayilan, ad) {
  if (deger == null || deger === '') return varsayilan;
  const n = Number(deger);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Geçersiz ${ad} sınırı.`);
  return n;
}

// ---- ZIP yol güvenliği (zip-slip) ----
const AYRILMIS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function guvenliYol(kok, ad) {
  const n = String(ad).replace(/\\/g, '/');
  if (!n || n.includes('\u0000')) throw new Error('ZIP içinde geçersiz dosya adı var; arşiv reddedildi.');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new Error(`ZIP güvenlik ihlali: mutlak yol reddedildi (${ad}).`);
  const parcalar = [];
  for (const p of n.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') throw new Error(`ZIP güvenlik ihlali: üst klasöre çıkan yol reddedildi (${ad}).`);
    let t = p.replace(/[:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
    if (!t) t = '_';
    if (AYRILMIS.test(t)) t = `_${t}`;
    parcalar.push(t);
  }
  if (parcalar.length === 0) return null;
  const hedef = path.resolve(kok, ...parcalar);
  if (!hedef.startsWith(kok + path.sep)) throw new Error(`ZIP güvenlik ihlali: çıktı klasörü dışına çıkan yol reddedildi (${ad}).`);
  return hedef;
}

function acYazma(yol) {
  // aynı ad varsa (yinelenen girdi ya da büyük/küçük harf çakışması) benzersiz ad
  const uz = path.extname(yol);
  const govde = uz ? yol.slice(0, -uz.length) : yol;
  for (let n = 0; n < 10000; n += 1) {
    const aday = n === 0 ? yol : `${govde} (${n})${uz}`;
    try {
      return { fd: fs.openSync(aday, 'wx'), yol: aday };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Dosya adı çakışması çözülemedi.');
}

async function klasoruTasi(gecici, klasor, ad) {
  for (let n = 0; n < 100000; n += 1) {
    const aday = path.join(klasor, n === 0 ? ad : `${ad} (${n})`);
    if (yollar.varMi(aday)) continue;
    try {
      await fsp.rename(gecici, aday);
      return aday;
    } catch (e) {
      if (['EEXIST', 'ENOTEMPTY', 'EPERM', 'EISDIR'].includes(e.code) && yollar.varMi(aday)) continue;
      throw e;
    }
  }
  throw new Error('Benzersiz klasör adı üretilemedi.');
}

// ---- ZIP aç ----
async function zipAc(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const sec = ctx.secenekler || {};
  const maksBoyut = sinirDegeri(sec.maksToplamBoyut, VARSAYILAN_MAKS_BOYUT, 'boyut');
  const maksDosya = sinirDegeri(sec.maksDosya, VARSAYILAN_MAKS_DOSYA, 'dosya sayısı');
  const ad = yollar.temizAd(yollar.govdeAdi(girdi));

  await fsp.mkdir(ctx.ciktiKlasoru, { recursive: true });
  const stage = await fsp.mkdtemp(path.join(await fsp.realpath(ctx.ciktiKlasoru), '.~zip-'));
  let acik = null; // { fd, bitti }
  let toplam = 0;
  let dosyaSayisi = 0;
  const kapat = () => {
    if (acik) { try { fs.closeSync(acik.fd); } catch { /* yoksay */ } acik = null; }
  };
  let fh;
  try {
    fh = await fsp.open(girdi, 'r');
    const { size } = await fh.stat();
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (dosya) => {
      iptalKontrol(ctx.sinyal);
      if (acik && !acik.bitti) throw new Error('ZIP bozuk ya da eksik.');
      kapat();
      const hedefYol = guvenliYol(stage, dosya.name);
      const dizinGirisi = /[\\/]$/.test(dosya.name);
      if (!hedefYol) return;
      dosyaSayisi += 1; // klasör girişleri de sayılır
      if (dosyaSayisi > maksDosya) throw new Error(`ZIP çok fazla dosya içeriyor (sınır ${maksDosya}).`);
      if (dizinGirisi) {
        fs.mkdirSync(hedefYol, { recursive: true });
        return;
      }
      if (dosya.originalSize != null && toplam + dosya.originalSize > maksBoyut) {
        throw new Error(`ZIP açılmış boyutu sınırı aşıyor (sınır ${maksBoyut} bayt).`);
      }
      fs.mkdirSync(path.dirname(hedefYol), { recursive: true });
      const yazma = acYazma(hedefYol);
      acik = { fd: yazma.fd, bitti: false };
      const buAcik = acik;
      dosya.ondata = (err, veri, final) => {
        if (err) throw new Error(`ZIP verisi çözülemedi: ${err.message || err}`);
        toplam += veri.length;
        if (toplam > maksBoyut) throw new Error(`ZIP açılmış boyutu sınırı aşıyor (sınır ${maksBoyut} bayt).`);
        if (veri.length) fs.writeSync(buAcik.fd, veri);
        if (final) { buAcik.bitti = true; fs.closeSync(buAcik.fd); if (acik === buAcik) acik = null; }
      };
      dosya.start();
    };

    const tampon = Buffer.allocUnsafe(OKUMA_BAYT);
    let okunan = 0;
    for (;;) {
      iptalKontrol(ctx.sinyal);
      const { bytesRead } = await fh.read(tampon, 0, OKUMA_BAYT, null);
      if (bytesRead === 0) break;
      okunan += bytesRead;
      unzip.push(new Uint8Array(tampon.subarray(0, bytesRead)), false);
      if (ctx.ilerleme && size) ctx.ilerleme(Math.min(95, Math.floor((okunan / size) * 95)));
    }
    unzip.push(new Uint8Array(0), true);
    if (acik && !acik.bitti) throw new Error('ZIP bozuk ya da eksik.');
    kapat();
    await fh.close();
    fh = null;
    return [await klasoruTasi(stage, path.resolve(ctx.ciktiKlasoru), ad)];
  } catch (e) {
    kapat();
    if (fh) await fh.close().catch(() => {});
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    if (e && e.iptal) throw e;
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ---- ZIP oluştur ----
async function girdileriTopla(girdiler, maksDosya) {
  const kayitlar = [];
  const adlar = new Set();
  const benzersiz = (ad) => {
    let aday = ad;
    for (let n = 1; adlar.has(aday.toLowerCase()); n += 1) {
      const i = ad.lastIndexOf('.');
      const kok = i > 0 && !ad.slice(i).includes('/') ? ad.slice(0, i) : ad;
      const uz = i > 0 && kok !== ad ? ad.slice(i) : '';
      aday = `${kok} (${n})${uz}`;
    }
    adlar.add(aday.toLowerCase());
    return aday;
  };
  const gez = async (yol, zipAdi) => {
    if (kayitlar.length >= maksDosya) throw new Error(`Çok fazla dosya (sınır ${maksDosya}).`);
    const st = await fsp.lstat(yol);
    if (st.isSymbolicLink()) return; // sembolik bağlantılar izlenmez
    if (st.isDirectory()) {
      const cocuklar = await fsp.readdir(yol);
      if (cocuklar.length === 0) kayitlar.push({ yol, ad: `${zipAdi}/`, dizin: true, st });
      for (const c of cocuklar) await gez(path.join(yol, c), `${zipAdi}/${c}`);
    } else if (st.isFile()) {
      kayitlar.push({ yol, ad: zipAdi, st });
    }
  };
  for (const g of girdiler) {
    const yol = yollar.girdiYolu(g);
    const kokAd = benzersiz(path.basename(yol));
    await gez(yol, kokAd);
  }
  return kayitlar;
}

async function zipOlustur(ctx) {
  const sec = ctx.secenekler || {};
  const maksDosya = sinirDegeri(sec.maksDosya, VARSAYILAN_MAKS_DOSYA, 'dosya sayısı');
  const kayitlar = (await girdileriTopla(ctx.girdiler, maksDosya)).filter((k) => !k.dizin || true);
  const ad = ctx.girdiler.length === 1 ? yollar.govdeAdi(ctx.girdiler[0]) : 'arsiv';
  const toplamBayt = kayitlar.reduce((t, k) => t + (k.dizin ? 0 : k.st.size), 0);

  return yollar.guvenliUret(ctx.ciktiKlasoru, ad, 'zip', async (gecici) => {
    const ws = fs.createWriteStream(gecici, { flags: 'wx' });
    let yazmaHatasi = null;
    let zipHatasi = null;
    ws.on('error', (e) => { yazmaHatasi = e; });
    const zip = new Zip((err, parca) => {
      if (err) { zipHatasi = err; return; }
      ws.write(parca);
    });
    const bekle = async () => {
      if (yazmaHatasi) throw yazmaHatasi;
      if (zipHatasi) throw zipHatasi;
      if (ws.writableNeedDrain) await Promise.race([once(ws, 'drain'), once(ws, 'error').then(() => { throw yazmaHatasi; })]);
    };
    let islenen = 0;
    try {
      for (const k of kayitlar) {
        iptalKontrol(ctx.sinyal);
        const mt = k.st.mtime.getFullYear() < 1980 ? new Date(1980, 0, 1) : k.st.mtime;
        const uz = yollar.uzantiAl(k.ad);
        const dosya = k.dizin || SAKLA.has(uz) ? new ZipPassThrough(k.ad) : new ZipDeflate(k.ad, { level: 6 });
        dosya.mtime = mt;
        zip.add(dosya);
        if (k.dizin) {
          dosya.push(new Uint8Array(0), true);
        } else {
          const fh = await fsp.open(k.yol, 'r');
          try {
            for (;;) {
              iptalKontrol(ctx.sinyal);
              const tampon = Buffer.allocUnsafe(YAZMA_OKUMA_BAYT);
              const { bytesRead } = await fh.read(tampon, 0, YAZMA_OKUMA_BAYT, null);
              if (bytesRead === 0) { dosya.push(new Uint8Array(0), true); break; }
              dosya.push(new Uint8Array(tampon.buffer, tampon.byteOffset, bytesRead), false);
              islenen += bytesRead;
              await bekle();
              if (ctx.ilerleme && toplamBayt) ctx.ilerleme(Math.min(95, Math.floor((islenen / toplamBayt) * 95)));
            }
          } finally {
            await fh.close().catch(() => {});
          }
        }
        await bekle();
      }
      zip.end();
      await bekle();
      ws.end();
      await Promise.race([once(ws, 'finish'), once(ws, 'error').then(() => { throw yazmaHatasi; })]);
    } catch (e) {
      try { zip.terminate(); } catch { /* yoksay */ }
      ws.destroy();
      await once(ws, 'close').catch(() => {});
      throw e;
    }
  });
}

// ---- GZIP ----
async function gzipSikistir(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const st = await fsp.stat(girdi);
  if (!st.isFile()) throw new Error('GZIP yalnız dosyaları sıkıştırır; klasör için ZIP kullanın.');
  const ad = path.basename(girdi);
  return yollar.guvenliUret(ctx.ciktiKlasoru, ad, 'gz', async (gecici) => {
    const ws = fs.createWriteStream(gecici, { flags: 'wx' });
    let yazmaHatasi = null;
    ws.on('error', (e) => { yazmaHatasi = e; });
    const gz = new Gzip({ level: 6, filename: ad, mtime: st.mtime });
    gz.ondata = (parca) => { ws.write(Buffer.from(parca)); };
    const fh = await fsp.open(girdi, 'r');
    let islenen = 0;
    try {
      for (;;) {
        iptalKontrol(ctx.sinyal);
        const tampon = Buffer.allocUnsafe(YAZMA_OKUMA_BAYT);
        const { bytesRead } = await fh.read(tampon, 0, YAZMA_OKUMA_BAYT, null);
        if (bytesRead === 0) { gz.push(new Uint8Array(0), true); break; }
        gz.push(new Uint8Array(tampon.buffer, tampon.byteOffset, bytesRead), false);
        islenen += bytesRead;
        if (yazmaHatasi) throw yazmaHatasi;
        if (ws.writableNeedDrain) await once(ws, 'drain');
        if (ctx.ilerleme && st.size) ctx.ilerleme(Math.min(95, Math.floor((islenen / st.size) * 95)));
      }
      ws.end();
      await once(ws, 'finish');
      if (yazmaHatasi) throw yazmaHatasi;
    } catch (e) {
      ws.destroy();
      await once(ws, 'close').catch(() => {});
      throw e;
    } finally {
      await fh.close().catch(() => {});
    }
  });
}

async function gzipAc(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const sec = ctx.secenekler || {};
  const maksBoyut = sinirDegeri(sec.maksToplamBoyut, VARSAYILAN_MAKS_BOYUT, 'boyut');
  const st = await fsp.stat(girdi);
  const adHam = path.basename(girdi);
  const cikisAdi = /\.gz$/i.test(adHam) && adHam.length > 3 ? adHam.slice(0, -3) : `${adHam}.cikti`;
  return yollar.guvenliUret(ctx.ciktiKlasoru, yollar.govdeAdi(cikisAdi), yollar.uzantiAl(cikisAdi), async (gecici) => {
    const ws = fs.createWriteStream(gecici, { flags: 'wx' });
    let yazmaHatasi = null;
    ws.on('error', (e) => { yazmaHatasi = e; });
    let toplam = 0;
    let bitti = false;
    const gunzip = new Gunzip();
    gunzip.ondata = (parca, final) => {
      toplam += parca.length;
      if (toplam > maksBoyut) throw new Error(`GZIP açılmış boyutu sınırı aşıyor (sınır ${maksBoyut} bayt).`);
      ws.write(Buffer.from(parca));
      if (final) bitti = true;
    };
    const fh = await fsp.open(girdi, 'r');
    let okunan = 0;
    try {
      const tampon = Buffer.allocUnsafe(OKUMA_BAYT);
      for (;;) {
        iptalKontrol(ctx.sinyal);
        const { bytesRead } = await fh.read(tampon, 0, OKUMA_BAYT, null);
        if (bytesRead === 0) break;
        okunan += bytesRead;
        gunzip.push(new Uint8Array(tampon.subarray(0, bytesRead)), false);
        if (yazmaHatasi) throw yazmaHatasi;
        if (ws.writableNeedDrain) await once(ws, 'drain');
        if (ctx.ilerleme && st.size) ctx.ilerleme(Math.min(95, Math.floor((okunan / st.size) * 95)));
      }
      gunzip.push(new Uint8Array(0), true);
      if (!bitti) throw new Error('GZIP dosyası bozuk ya da eksik.');
      ws.end();
      await once(ws, 'finish');
      if (yazmaHatasi) throw yazmaHatasi;
    } catch (e) {
      ws.destroy();
      await once(ws, 'close').catch(() => {});
      throw e;
    } finally {
      await fh.close().catch(() => {});
    }
  });
}

async function calistir(ctx) {
  iptalKontrol(ctx.sinyal);
  switch (kanonik(ctx.hedef)) {
    case 'zip': return zipOlustur(ctx);
    case 'zip-ac': return zipAc(ctx);
    case 'gz': return gzipSikistir(ctx);
    case 'gz-ac': return gzipAc(ctx);
    default: throw new Error(`Bilinmeyen arşiv işlemi: ${ctx.hedef}`);
  }
}

module.exports = { calistir, guvenliYol, VARSAYILAN_MAKS_BOYUT, VARSAYILAN_MAKS_DOSYA };
