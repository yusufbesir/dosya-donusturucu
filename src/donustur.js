'use strict';
// Ne: TaaDön dönüştürme giriş noktası; işi doğrular, motoru seçer (planla), girdileri denetler ve motoru çalıştırır.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-inceleme]
// Değiştirme kuralı: davranış değişikliği test/donustur-ek.test.js ve ilgili testler güncellenerek yapılır;
// silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak olur.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const yollar = require('./yollar');
const surec = require('./surec');
const katalog = require('./katalog');
const libreoffice = require('./motorlar/libreoffice');
const calibre = require('./motorlar/calibre');

// Tüm girdileri birlikte alan işlemler
const TOPLU = new Set(['birlestir', 'zip', 'gorsel-pdf']);
// Kaynak uzantıdan bağımsız işlemler: hedef -> motor
const ISLEM_MOTORU = {
  birlestir: 'pdf', bol: 'pdf', dondur: 'pdf',
  'gorsel-pdf': 'gorsel',
  zip: 'arsiv', 'zip-ac': 'arsiv', gz: 'arsiv', 'gz-ac': 'arsiv',
};
// Kaynak uzantı denetimi olan işlemler: hedef -> { uzantilar (kanonik), etiket }. Listede olmayanlar (zip, gz) her dosyayı alır.
const GORSEL_KAYNAK = ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico', 'svg'];
const ISLEM_KAYNAGI = {
  birlestir: { uzantilar: ['pdf'], etiket: 'PDF' },
  bol: { uzantilar: ['pdf'], etiket: 'PDF' },
  dondur: { uzantilar: ['pdf'], etiket: 'PDF' },
  'gorsel-pdf': { uzantilar: GORSEL_KAYNAK, etiket: 'görsel (JPG, PNG, WebP, AVIF, TIFF, GIF, BMP, ICO, SVG)' },
  'zip-ac': { uzantilar: ['zip'], etiket: 'ZIP' },
  'gz-ac': { uzantilar: ['gz'], etiket: 'GZIP (.gz)' },
};
const FFMPEG_BULUNAMADI = 'FFmpeg bulunamadı. Ses, video ve BMP/ICO dönüştürücü programla birlikte gelmeliydi; programı yeniden kurun.';
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
    case 'calibre': return require('./motorlar/calibre');
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

function girdiUzantisi(g) {
  return katalog.kanonik(yollar.uzantiAl(g));
}

/** Tekil işlemlerde aynı dosyanın birden çok seçilmesini önler (Windows'ta büyük/küçük harf duyarsız). */
function tekillestir(girdiler) {
  const goruldu = new Set();
  const sonuc = [];
  for (const g of girdiler) {
    let anahtar = path.resolve(String(g));
    if (process.platform === 'win32') anahtar = anahtar.toLowerCase();
    if (goruldu.has(anahtar)) continue;
    goruldu.add(anahtar);
    sonuc.push(g);
  }
  return sonuc;
}

/** Tek bir kaynak uzantı için hedefin motorunu döndürür; desteklenmiyorsa null. Aynı biçim desteklenmiyorsa hata atar. */
function motorBul(kaynak, hedefK) {
  const bulunan = katalog.hedefler(kaynak).find((h) => h.hedef === hedefK);
  if (bulunan) return bulunan.motor;
  const bilgi = katalog.BICIMLER[kaynak];
  if (bilgi && AYNI_BICIM_KATEGORI.has(bilgi.kategori) && hedefK === kaynak) {
    const motor = bilgi.kategori === 'gorsel' ? 'gorsel' : 'ffmpeg';
    if (motor === 'gorsel' && (kaynak === 'svg' || kaynak === 'ico' || kaynak === 'bmp')) {
      throw new Error(`${kaynak.toUpperCase()} üzerinde boyutlandırma/sıkıştırma desteklenmiyor; önce PNG ya da JPG'ye dönüştürün.`);
    }
    return motor;
  }
  return null;
}

/** İş için motoru ve gerekli bilgiyi seçer; girdiler alanı (tekil işlemlerde tekilleştirilmiş) kullanılacak listedir. */
function planla(is) {
  const hedef = String(is.hedef).toLowerCase();
  if (ISLEM_MOTORU[hedef]) {
    const beklenen = ISLEM_KAYNAGI[hedef];
    if (beklenen) {
      for (const g of is.girdiler) {
        if (!beklenen.uzantilar.includes(girdiUzantisi(g))) {
          throw new Error(`Bu işlem yalnız ${beklenen.etiket} dosyaları için: ${path.basename(String(g))}`);
        }
      }
    }
    const toplu = TOPLU.has(hedef);
    return { motor: ISLEM_MOTORU[hedef], hedef, toplu, kaynak: null, girdiler: toplu ? [...is.girdiler] : tekillestir(is.girdiler) };
  }
  const kaynak = girdiUzantisi(is.girdiler[0]);
  const hedefK = katalog.kanonik(hedef);
  const motor = motorBul(kaynak, hedefK);
  if (!motor) throw new Error(`Bu dönüştürme desteklenmiyor: ${kaynak || '?'} → ${hedef}`);
  // Karışık seçim: her girdi aynı motorla aynı hedefe gidebilmeli
  for (const g of is.girdiler.slice(1)) {
    const uz = girdiUzantisi(g);
    if (uz === kaynak) continue;
    let m = null;
    try { m = motorBul(uz, hedefK); } catch { m = null; }
    if (m !== motor) {
      throw new Error(`"${path.basename(String(g))}" dosyasının biçimi (${(uz || '?').toUpperCase()}) seçilen kaynak biçimle (${(kaynak || '?').toUpperCase()}) uyuşmuyor.`);
    }
  }
  const toplu = hedefK === 'pdf' && motor === 'gorsel' && Boolean(is.secenekler && is.secenekler.tekPdf === true);
  return { motor, hedef: hedefK, toplu, kaynak, girdiler: toplu ? [...is.girdiler] : tekillestir(is.girdiler) };
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
 * @param {object} ortam { ffmpegYolu, sofficeYolu, ebookConvertYolu, ilerleme, sinyal, geciciKlasor }
 * @returns {Promise<{ciktilar:string[]}>}
 */
async function donustur(is, ortam = {}) {
  dogrula(is);
  const sinyal = ortam.sinyal;
  const iptalKontrol = () => { if (sinyal && sinyal.aborted) throw surec.iptalHatasi(); };
  iptalKontrol();

  const plan = planla(is);
  const dizinOk = plan.motor === 'arsiv' && (plan.hedef === 'zip');
  const girdiler = plan.girdiler;
  for (const g of girdiler) await girdiKontrol(g, dizinOk);

  const ciktiKlasoru = path.resolve(is.ciktiKlasoru);
  // BMP/ICO hem hedef hem kaynak olarak (görsel motorunda) FFmpeg ister
  const ffmpegGerekli = plan.motor === 'ffmpeg'
    || (plan.motor === 'gorsel' && (plan.hedef === 'bmp' || plan.hedef === 'ico'
      || girdiler.some((g) => ['bmp', 'ico'].includes(girdiUzantisi(g)))));
  const ffmpegYolu = ortam.ffmpegYolu
    || (ffmpegGerekli ? yollar.ffmpegYolunuBul({ uygulamaKlasoru: path.join(__dirname, '..') }) : null);
  // sofficeAramaYok: ana süreç yolu zaten (imza denetimiyle) çözdü; boşsa denetimsiz yeniden arama yapılmaz
  const sofficeYolu = ortam.sofficeYolu
    || (!ortam.sofficeAramaYok && (plan.motor === 'libreoffice' || plan.motor === 'markdown') ? libreoffice.sofficeBul({}) : null);
  const sofficeHata = ortam.sofficeDurumu === 'dogrulanamadi' ? libreoffice.SOFFICE_DOGRULANAMADI
    : 'LibreOffice bulunamadı. Lütfen LibreOffice kurun ya da yolunu ayarlardan seçin.';
  // calibreAramaYok: ana süreç yolu zaten (imza denetimiyle) çözdü; boşsa denetimsiz yeniden arama yapılmaz
  const ebookConvertYolu = ortam.ebookConvertYolu
    || (!ortam.calibreAramaYok && plan.motor === 'calibre' ? calibre.ebookConvertBul({ gomuluKlasor: path.join(__dirname, '..', 'vendor') }) : null);
  const bildir = typeof ortam.ilerleme === 'function' ? ortam.ilerleme : () => {};

  if (ffmpegGerekli && !ffmpegYolu) throw new Error(FFMPEG_BULUNAMADI);
  if (plan.motor === 'libreoffice' && !sofficeYolu) throw new Error(sofficeHata);
  if (plan.motor === 'markdown' && plan.hedef !== 'html' && !sofficeYolu) throw new Error(sofficeHata);
  if (plan.motor === 'calibre' && !ebookConvertYolu) throw new Error(ortam.calibreDurumu === 'dogrulanamadi' ? calibre.CALIBRE_DOGRULANAMADI : calibre.CALIBRE_BULUNAMADI);

  // Bu işe özel geçici klasör (yalnız kendi oluşturduğumuz; sonunda silinir)
  const isGeciciKok = await yollar.geciciKlasorOlustur(ortam.geciciKlasor || os.tmpdir());
  const motor = motorYukle(plan.motor);
  const ciktilar = [];
  try {
    const gruplar = plan.toplu ? [girdiler] : girdiler.map((g) => [g]);
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
        ebookConvertYolu,
        calibreDurumu: ortam.calibreDurumu,
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

module.exports = { donustur, planla, tekillestir, FFMPEG_BULUNAMADI };
