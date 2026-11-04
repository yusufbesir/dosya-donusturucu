'use strict';
// rust.js: TaaDön Rust çekirdeği (taadon-cekirdek.exe) köprüsü. JSON satırlı çıktı, stderr'de "ILERLEME n" satırları.
// Sahip: Yusuf (TaaDön projesi). Değişiklik: Yusuf'un kuralları (ORTAK-AJAN-KURALLARI.md) çerçevesinde.
// yazan: [Claude#taadon-rust-asama1 2026-11-04]. Varsayılan kapalı: arsiv.js yalnız ctx.rustMotor === true ise buraya gelir.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const surec = require('../surec');
const yollar = require('../yollar');

const EXE_ADI = process.platform === 'win32' ? 'taadon-cekirdek.exe' : 'taadon-cekirdek';
const PROJE_KOKU = path.join(__dirname, '..', '..');

/** Aday yollar (öncelik sırasıyla): paketli kaynaklar, vendor, geliştirme derlemesi. */
function adaylar() {
  const liste = [];
  if (process.resourcesPath) liste.push(path.join(process.resourcesPath, 'cekirdek', EXE_ADI));
  liste.push(path.join(PROJE_KOKU, 'vendor', 'cekirdek', EXE_ADI));
  liste.push(path.join(PROJE_KOKU, 'cekirdek-rust', 'target', 'release', EXE_ADI));
  return liste;
}

function exeYolu() {
  for (const aday of adaylar()) {
    if (aday.includes(`app.asar${path.sep}`)) continue; // asar içinden çalıştırılamaz
    try {
      if (fs.statSync(aday).isFile()) return aday;
    } catch { /* yok */ }
  }
  return null;
}

function hazir() {
  return exeYolu() !== null;
}

function sonJson(metin) {
  const satirlar = String(metin || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = satirlar.length - 1; i >= 0; i -= 1) {
    if (!satirlar[i].startsWith('{')) continue;
    try { return JSON.parse(satirlar[i]); } catch { /* sonraki */ }
  }
  return null;
}

/**
 * Çekirdeği çalıştırır, JSON sonucu döner. ok:false ya da ayrıştırılamayan çıktı Türkçe hata olarak fırlatılır.
 * @param {string[]} args
 * @param {{sinyal?: AbortSignal, ilerleme?: (n:number)=>void, zamanAsimi?: number}} [secenek]
 */
async function calistir(args, secenek = {}) {
  const exe = exeYolu();
  if (!exe) throw new Error('Rust çekirdeği (taadon-cekirdek.exe) bulunamadı.');
  const { sinyal, ilerleme, zamanAsimi } = secenek;
  let artik = '';
  const stderrVeri = (parca) => {
    if (typeof ilerleme !== 'function') return;
    artik += parca;
    const satirlar = artik.split(/\r?\n/);
    artik = satirlar.pop();
    for (const s of satirlar) {
      const m = /^ILERLEME (\d{1,3})\s*$/.exec(s);
      if (m) ilerleme(Math.min(100, Number(m[1])));
    }
  };
  const r = await surec.calistir(exe, args.map(String), { sinyal, zamanAsimi, stderrVeri });
  const sonuc = sonJson(r.stdout);
  if (!sonuc) {
    const ayrinti = String(r.stderr || '').split(/\r?\n/).filter((s) => s && !s.startsWith('ILERLEME')).slice(-3).join(' ');
    throw new Error(`Rust çekirdeği beklenmeyen biçimde sonlandı (çıkış kodu ${r.kod})${ayrinti ? `: ${ayrinti}` : '.'}`);
  }
  if (sonuc.ok !== true) throw new Error(sonuc.hata || `Rust çekirdeği başarısız oldu (çıkış kodu ${r.kod}).`);
  return sonuc;
}

// ---- arsiv.js için iş yolu (sonuç biçimi JS yoluyla aynı: çıktı yolları dizisi) ----

/**
 * @param {object} ctx arsiv.calistir bağlamı
 * @param {'zip'|'zip-ac'|'gz'|'gz-ac'} islem
 * @param {{klasoruTasi: Function, sinirDegeri: Function, VARSAYILAN_MAKS_BOYUT: number, VARSAYILAN_MAKS_DOSYA: number}} y
 */
async function arsivCalistir(ctx, islem, y) {
  const sec = ctx.secenekler || {};
  const opts = { sinyal: ctx.sinyal, ilerleme: (n) => { if (ctx.ilerleme) ctx.ilerleme(Math.min(95, n)); } };
  const maksBoyut = () => Math.floor(y.sinirDegeri(sec.maksToplamBoyut, y.VARSAYILAN_MAKS_BOYUT, 'boyut'));
  const maksDosya = () => Math.floor(y.sinirDegeri(sec.maksDosya, y.VARSAYILAN_MAKS_DOSYA, 'dosya sayısı'));

  if (islem === 'zip-ac') {
    const girdi = yollar.girdiYolu(ctx.girdiler[0]);
    const mb = maksBoyut();
    const md = maksDosya();
    const ad = yollar.temizAd(yollar.govdeAdi(girdi));
    await fsp.mkdir(ctx.ciktiKlasoru, { recursive: true });
    // JS yoluyla aynı: kendi geçici klasörümüze aç, sonra benzersiz ada taşı
    const stage = await fsp.mkdtemp(path.join(await fsp.realpath(ctx.ciktiKlasoru), '.~zip-'));
    try {
      await calistir(['zip-ac', girdi, stage, '--maks-bayt', mb, '--maks-dosya', md], opts);
      return [await y.klasoruTasi(stage, path.resolve(ctx.ciktiKlasoru), ad)];
    } catch (e) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
  }
  if (islem === 'zip') {
    const md = maksDosya();
    const girdiler = ctx.girdiler.map((g) => yollar.girdiYolu(g));
    const ad = ctx.girdiler.length === 1 ? yollar.govdeAdi(ctx.girdiler[0]) : 'arsiv';
    return yollar.guvenliUret(ctx.ciktiKlasoru, ad, 'zip', async (gecici) => {
      await calistir(['zip-olustur', gecici, ...girdiler, '--maks-dosya', md], opts);
    });
  }
  if (islem === 'gz') {
    const girdi = yollar.girdiYolu(ctx.girdiler[0]);
    const st = await fsp.stat(girdi);
    if (!st.isFile()) throw new Error('GZIP yalnız dosyaları sıkıştırır; klasör için ZIP kullanın.');
    return yollar.guvenliUret(ctx.ciktiKlasoru, path.basename(girdi), 'gz', async (gecici) => {
      await calistir(['gzip', girdi, gecici], opts);
    });
  }
  if (islem === 'gz-ac') {
    const girdi = yollar.girdiYolu(ctx.girdiler[0]);
    const mb = maksBoyut();
    const adHam = path.basename(girdi);
    const cikisAdi = /\.gz$/i.test(adHam) && adHam.length > 3 ? adHam.slice(0, -3) : `${adHam}.cikti`;
    return yollar.guvenliUret(ctx.ciktiKlasoru, yollar.govdeAdi(cikisAdi), yollar.uzantiAl(cikisAdi), async (gecici) => {
      await calistir(['gunzip', girdi, gecici, '--maks-bayt', mb], opts);
    });
  }
  throw new Error(`Bilinmeyen arşiv işlemi: ${islem}`);
}

module.exports = { hazir, exeYolu, adaylar, calistir, arsivCalistir, EXE_ADI };
