'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const yollar = require('./yollar');
const surec = require('./surec');
const katalog = require('./katalog');
const libreoffice = require('./motorlar/libreoffice');

// Tüm girdileri birlikte alan işlemler
const TOPLU = new Set(['birlestir', 'zip', 'gorsel-pdf']);
// Kaynak uzantıdan bağımsız işlemler: hedef -> motor
const ISLEM_MOTORU = {
  birlestir: 'pdf', bol: 'pdf', dondur: 'pdf',
  'gorsel-pdf': 'gorsel',
  zip: 'arsiv', 'zip-ac': 'arsiv', gz: 'arsiv', 'gz-ac': 'arsiv',
};
// Aynı biçime dönüştürme (kırp/boyutlandır/sıkıştır) izni olan kategoriler
const AYNI_BICIM_KATEGORI = new Set(['video', 'ses', 'gorsel']);

function motorYukle(ad) {
  switch (ad) {
    case 'ffmpeg': return require('./motorlar/ffmpeg');
    case 'gorsel': return require('./motorlar/gorsel');
    case 'libreoffice': return require('./motorlar/libreoffice');
    case 'pdf': return require('./motorlar/pdf');
    case 'veri': return require('./motorlar/veri');
    case 'arsiv': return require('./motorlar/arsiv');
    case 'markdown': return require('./motorlar/markdown');
    default: throw new Error(`Bilinmeyen motor: ${ad}`);
  }
}

function dogrula(is) {
  if (!is || typeof is !== 'object') throw new Error('Geçersiz iş.');
  if (!Array.isArray(is.girdiler) || is.girdiler.length === 0) throw new Error('En az bir girdi dosyası gerekli.');
  if (typeof is.hedef !== 'string' || !is.hedef) throw new Error('Hedef biçim belirtilmedi.');
  if (typeof is.ciktiKlasoru !== 'string' || !is.ciktiKlasoru) throw new Error('Çıktı klasörü belirtilmedi.');
  for (const g of is.girdiler) yollar.girdiYolu(g); // tür/NUL denetimi
  yollar.girdiYolu(is.ciktiKlasoru);
}

/** İş için motoru ve gerekli bilgiyi seçer. */
function planla(is) {
  const hedef = String(is.hedef).toLowerCase();
  if (ISLEM_MOTORU[hedef]) {
    return { motor: ISLEM_MOTORU[hedef], hedef, toplu: TOPLU.has(hedef), kaynak: null };
  }
  const kaynak = katalog.kanonik(yollar.uzantiAl(is.girdiler[0]));
  const hedefK = katalog.kanonik(hedef);
  const secenekler = katalog.hedefler(kaynak);
  const bulunan = secenekler.find((h) => h.hedef === hedefK);
  if (bulunan) {
    const toplu = bulunan.hedef === 'pdf' && bulunan.motor === 'gorsel' && is.secenekler && is.secenekler.tekPdf === true;
    return { motor: bulunan.motor, hedef: hedefK, toplu, kaynak };
  }
  const bilgi = katalog.BICIMLER[kaynak];
  if (bilgi && AYNI_BICIM_KATEGORI.has(bilgi.kategori) && hedefK === kaynak) {
    const motor = bilgi.kategori === 'gorsel' ? 'gorsel' : 'ffmpeg';
    if (motor === 'gorsel' && (kaynak === 'svg' || kaynak === 'ico' || kaynak === 'bmp')) {
      throw new Error(`${kaynak.toUpperCase()} biçiminde yeniden boyutlandırma desteklenmiyor.`);
    }
    return { motor, hedef: hedefK, toplu: false, kaynak };
  }
  throw new Error(`Bu dönüştürme desteklenmiyor: ${kaynak || '?'} → ${hedef}`);
}

async function girdiKontrol(yol, dizinOk) {
  let st;
  try {
    st = await fsp.stat(yollar.girdiYolu(yol));
  } catch {
    throw new Error(`Girdi dosyası bulunamadı: ${path.basename(String(yol))}`);
  }
  if (st.isDirectory() && !dizinOk) throw new Error(`Klasör yerine dosya seçin: ${path.basename(String(yol))}`);
}

/**
 * @param {object} is  İş nesnesi (SPEC)
 * @param {object} ortam { ffmpegYolu, sofficeYolu, ilerleme, sinyal, geciciKlasor }
 * @returns {Promise<{ciktilar:string[]}>}
 */
async function donustur(is, ortam = {}) {
  dogrula(is);
  const sinyal = ortam.sinyal;
  const iptalKontrol = () => { if (sinyal && sinyal.aborted) throw surec.iptalHatasi(); };
  iptalKontrol();

  const plan = planla(is);
  const dizinOk = plan.motor === 'arsiv' && (plan.hedef === 'zip');
  for (const g of is.girdiler) await girdiKontrol(g, dizinOk);
  if (plan.motor === 'pdf' || plan.motor === 'gorsel' || plan.motor === 'ffmpeg') {
    // pdf/gorsel/ffmpeg için tek girdi yeterli; yukarıdaki kontrol hepsini doğruladı
  }

  const ciktiKlasoru = path.resolve(is.ciktiKlasoru);
  const ffmpegYolu = ortam.ffmpegYolu
    || (plan.motor === 'ffmpeg' || plan.hedef === 'bmp' || plan.hedef === 'ico'
      ? yollar.ffmpegYolunuBul({ uygulamaKlasoru: path.join(__dirname, '..') }) : null);
  // sofficeAramaYok: ana süreç yolu zaten (imza denetimiyle) çözdü; boşsa denetimsiz yeniden arama yapılmaz
  const sofficeYolu = ortam.sofficeYolu
    || (!ortam.sofficeAramaYok && (plan.motor === 'libreoffice' || plan.motor === 'markdown') ? libreoffice.sofficeBul({}) : null);
  const sofficeHata = ortam.sofficeDurumu === 'dogrulanamadi' ? libreoffice.SOFFICE_DOGRULANAMADI
    : 'LibreOffice bulunamadı. Lütfen LibreOffice kurun ya da yolunu ayarlardan seçin.';
  const bildir = typeof ortam.ilerleme === 'function' ? ortam.ilerleme : () => {};

  if (plan.motor === 'ffmpeg' && !ffmpegYolu) throw new Error('FFmpeg bulunamadı. "npm run ffmpeg-indir" ile indirin.');
  if (plan.motor === 'libreoffice' && !sofficeYolu) throw new Error(sofficeHata);
  if (plan.motor === 'markdown' && plan.hedef !== 'html' && !sofficeYolu) throw new Error(sofficeHata);

  // Bu işe özel geçici klasör (yalnız kendi oluşturduğumuz; sonunda silinir)
  const isGeciciKok = await yollar.geciciKlasorOlustur(ortam.geciciKlasor || os.tmpdir());
  const motor = motorYukle(plan.motor);
  const ciktilar = [];
  try {
    const gruplar = plan.toplu ? [is.girdiler] : is.girdiler.map((g) => [g]);
    for (let i = 0; i < gruplar.length; i += 1) {
      iptalKontrol();
      const ilerleme = (y) => {
        const tek = Math.max(0, Math.min(100, Number(y) || 0));
        bildir(Math.min(99, Math.floor(((i + tek / 100) / gruplar.length) * 100)));
      };
      const sonuc = await motor.calistir({
        girdiler: gruplar[i],
        hedef: plan.hedef,
        ciktiKlasoru,
        secenekler: is.secenekler || {},
        ffmpegYolu,
        sofficeYolu,
        sinyal,
        ilerleme,
        geciciKlasor: isGeciciKok,
        kaynakUzanti: plan.kaynak,
      });
      iptalKontrol();
      for (const c of Array.isArray(sonuc) ? sonuc : [sonuc]) ciktilar.push(c);
    }
    bildir(100);
    return { ciktilar };
  } finally {
    await fsp.rm(isGeciciKok, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { donustur, planla };
