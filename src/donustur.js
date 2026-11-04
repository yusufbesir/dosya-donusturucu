'use strict';
// Ne: TaaDön dönüştürme giriş noktası; işi doğrular, motoru seçer (planla), girdileri denetler ve motoru çalıştırır.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-inceleme], 1.6.0 (sonek, Özgün taşıma, çıktı
//     doğrulama, bulut dosyası denetimi): [Claude#taadon-T2], 1.9.0 tek PDF'de birleştir: [Claude#taadon-1.9-paket-c 2026-11-04]
// Değiştirme kuralı: davranış değişikliği test/donustur-ek.test.js ve ilgili testler güncellenerek yapılır;
// silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak olur. Kullanıcı dosyası hiçbir koşulda kalıcı silinmez.

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

const BULUT_DOSYASI = "Dosya yalnız bulutta görünüyor; önce OneDrive'da 'Bu cihazda her zaman tut' seçip tekrar deneyin.";
const BULUT_ZAMAN_ASIMI_MS = 10000;

/** İlk 1 baytı okur (OneDrive yer tutucusunda indirmeyi tetikler). */
async function ilkBaytOku(yol) {
  const fh = await fsp.open(yol, 'r');
  try {
    await fh.read(Buffer.alloc(1), 0, 1, 0);
  } finally {
    await fh.close().catch(() => {});
  }
}

/**
 * OneDrive "yalnız bulutta" denetimi. Node fs.Stats Windows dosya özniteliklerini (RECALL_ON_DATA_ACCESS 0x400000)
 * vermediği için davranışa bakılır: boyutu > 0 olan dosyanın ilk baytı zaman aşımı (10 sn) içinde okunamıyorsa
 * ya da bulut sağlayıcı hatası (libuv: UNKNOWN) dönerse Türkçe bulut mesajı fırlatılır.
 */
async function bulutDenetle(yol, st, { zamanAsimiMs = BULUT_ZAMAN_ASIMI_MS, okuyucu = ilkBaytOku } = {}) {
  if (!st || !st.isFile() || st.size === 0) return;
  let zamanlayici;
  const zaman = new Promise((cozum) => { zamanlayici = setTimeout(() => cozum('zaman'), zamanAsimiMs); });
  let sonuc;
  try {
    sonuc = await Promise.race([Promise.resolve().then(() => okuyucu(yol)).then(() => 'tamam', (e) => e), zaman]);
  } finally {
    clearTimeout(zamanlayici);
  }
  if (sonuc === 'zaman') throw new Error(BULUT_DOSYASI);
  if (sonuc instanceof Error && sonuc.code === 'UNKNOWN') throw new Error(BULUT_DOSYASI);
  // Diğer okuma hataları (izin vb.) burada yutulur; motor kendi anlamlı hatasını verir.
}

async function girdiKontrol(yol, dizinOk, ortam = {}) {
  let st;
  try {
    st = await fsp.stat(yollar.girdiYolu(yol));
  } catch {
    throw new Error(`Girdi dosyası bulunamadı: ${path.basename(String(yol))}`);
  }
  if (st.isDirectory() && !dizinOk) throw new Error(`Klasör yerine dosya seçin: ${path.basename(String(yol))}`);
  if (ortam.bulutDenetimiYok !== true) {
    await bulutDenetle(yollar.girdiYolu(yol), st, { zamanAsimiMs: ortam.bulutZamanAsimiMs || BULUT_ZAMAN_ASIMI_MS });
  }
}

// Çıktı doğrulama (düzeltme listesi C): uzantı -> beklenen ilk baytlar; listede olmayanlar (mp3/mp4/wav/webm/mkv
// ve diğerleri) yalnız boyut > 0 ile denetlenir.
const PK = [0x50, 0x4b];
const CIKTI_IMZALARI = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  docx: PK, xlsx: PK, pptx: PK, odt: PK, ods: PK, odp: PK, epub: PK, zip: PK,
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38], // GIF8
};
const CIKTI_BOZUK = 'Çıktı dosyası doğrulanamadı (boş ya da beklenen biçimde değil); kaynak dosyayı kaynak uygulamada açıp yeniden kaydedip deneyin.';

/** Tek çıktıyı denetler: true/false. Klasör çıktılar (zip-ac) denetlenmez (true). */
async function ciktiGecerli(yol) {
  let st;
  try { st = await fsp.stat(yol); } catch { return false; }
  if (st.isDirectory()) return true;
  if (!st.isFile() || st.size === 0) return false;
  const imza = CIKTI_IMZALARI[yollar.uzantiAl(yol)];
  if (!imza) return true;
  if (st.size < imza.length) return false;
  const tampon = Buffer.alloc(imza.length);
  const fh = await fsp.open(yol, 'r');
  try {
    await fh.read(tampon, 0, imza.length, 0);
  } finally {
    await fh.close().catch(() => {});
  }
  return imza.every((b, i) => tampon[i] === b);
}

/** Tüm çıktıları denetler; tutmayanları `.bozuk` ekiyle yeniden adlandırır (silmez) ve Türkçe hata fırlatır. */
async function ciktilariDogrula(ciktilar) {
  const bozuklar = [];
  for (const c of ciktilar) {
    if (await ciktiGecerli(c)) continue;
    let yeni = null;
    try { if (yollar.varMi(c)) yeni = await yollar.bozukIsaretle(c); } catch { yeni = null; }
    bozuklar.push(yeni || c);
  }
  if (bozuklar.length) {
    const e = new Error(CIKTI_BOZUK);
    e.bozukCiktilar = bozuklar;
    throw e;
  }
}

function ayniYol(a, b) {
  const n = (x) => { const r = path.resolve(String(x)); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return n(a) === n(b);
}

/**
 * Başarılı işten sonra girdileri `<girdi klasörü>\Özgün\` altına taşır. Kalıcı silme yok: yalnız rename/link.
 * Başka sürücü (EXDEV), klasör girdisi, çıktıyla aynı dosya ya da başka hata -> atlanır ve uyarı eklenir.
 */
async function ozgunleriTasi(girdiler, ciktilar) {
  const tasinanlar = [];
  const uyarilar = [];
  const goruldu = [];
  for (const g of girdiler) {
    const kaynak = path.resolve(String(g));
    if (goruldu.some((x) => ayniYol(x, kaynak))) continue; // birleştirmede aynı dosya iki kez seçilmiş olabilir
    goruldu.push(kaynak);
    const ad = path.basename(kaynak);
    if (ciktilar.some((c) => ayniYol(c, kaynak))) { uyarilar.push(`Özgün dosya taşınmadı (çıktıyla aynı dosya): ${ad}`); continue; }
    let st;
    try { st = await fsp.lstat(kaynak); } catch { uyarilar.push(`Özgün dosya taşınmadı (bulunamadı): ${ad}`); continue; }
    if (!st.isFile()) { uyarilar.push(`Özgün taşıma yalnız dosyalar için; klasör taşınmadı: ${ad}`); continue; }
    try {
      const hedef = await yollar.ozguneTasi(kaynak);
      tasinanlar.push({ kaynak, hedef });
    } catch (e) {
      uyarilar.push(e && e.code === 'EXDEV'
        ? `Özgün dosya taşınmadı (Özgün klasörü başka bir sürücüde): ${ad}`
        : `Özgün dosya taşınmadı (${(e && e.code) || (e && e.message) || 'bilinmeyen hata'}): ${ad}`);
    }
  }
  return { tasinanlar, uyarilar };
}

/**
 * Tek PDF'de birleştir (1.9.0): ayrı ayrı üretilen PDF çıktılarını sırayla `<ilk ad> (birleşik).pdf` dosyasında
 * birleştirir (pdf-lib). Ara PDF'lere dokunmaz; onları çağıran (ana süreç) Geri Dönüşüm Kutusu'na taşır.
 */
async function pdfleriBirlestir(pdfler, ciktiKlasoru, ad) {
  const { PDFDocument } = require('pdf-lib');
  await require('./motorlar/pdf').toplamBoyutDenetle(pdfler);
  const hedef = await PDFDocument.create();
  for (const p of pdfler) {
    const kaynak = await PDFDocument.load(await fsp.readFile(p), { updateMetadata: false });
    for (const s of await hedef.copyPages(kaynak, kaynak.getPageIndices())) hedef.addPage(s);
  }
  const bayt = await hedef.save();
  return yollar.guvenliUret(ciktiKlasoru, ad, 'pdf', async (gecici) => {
    await fsp.writeFile(gecici, bayt, { flag: 'wx' });
  });
}

/**
 * @param {object} is  İş nesnesi (SPEC)
 * @param {object} ortam { ffmpegYolu, sofficeYolu, ebookConvertYolu, ilerleme, sinyal, geciciKlasor }
 * @returns {Promise<{ciktilar:string[], tasinanlar:{kaynak:string,hedef:string}[], uyarilar:string[]}>}
 */
async function donustur(is, ortam = {}) {
  dogrula(is);
  const sinyal = ortam.sinyal;
  const iptalKontrol = () => { if (sinyal && sinyal.aborted) throw surec.iptalHatasi(); };
  iptalKontrol();

  const plan = planla(is);
  const dizinOk = plan.motor === 'arsiv' && (plan.hedef === 'zip');
  const girdiler = plan.girdiler;
  for (const g of girdiler) await girdiKontrol(g, dizinOk, ortam);

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
  const sonek = is.sonek == null || is.sonek === '' ? '' : is.sonek;
  if (sonek && !yollar.sonekGecerli(sonek)) throw new Error('Çıktı soneki geçersiz (en çok 20 karakter: harf, rakam, boşluk, _ . -).');
  const bildir = typeof ortam.ilerleme === 'function' ? ortam.ilerleme : () => {};

  if (ffmpegGerekli && !ffmpegYolu) throw new Error(FFMPEG_BULUNAMADI);
  if (plan.motor === 'libreoffice' && !sofficeYolu) throw new Error(sofficeHata);
  if (plan.motor === 'markdown' && plan.hedef !== 'html' && !sofficeYolu) throw new Error(sofficeHata);
  if (plan.motor === 'calibre' && !ebookConvertYolu) throw new Error(ortam.calibreDurumu === 'dogrulanamadi' ? calibre.CALIBRE_DOGRULANAMADI : calibre.CALIBRE_BULUNAMADI);

  // Bu işe özel geçici klasör (yalnız kendi oluşturduğumuz; sonunda silinir)
  const isGeciciKok = await yollar.geciciKlasorOlustur(ortam.geciciKlasor || os.tmpdir());
  const motor = motorYukle(plan.motor);
  const ustVeri = is.ustVeriTemizle === true || ortam.ustVeriTemizle === true;
  let ciktilar = [];
  let araCiktilar = [];
  const birlestirUyarilari = [];
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
        profilSablonu: ortam.profilSablonu,
        ustVeriTemizle: ustVeri,
        rustMotor: ortam.rustMotor, // arşiv motoru: Rust çekirdeği (ayar motorRust); [Claude#taadon-rust-asama2 2026-11-04]
        sinyal,
        ilerleme,
        geciciKlasor: isGeciciKok,
        kaynakUzanti: plan.kaynak,
      });
      iptalKontrol();
      for (const c of Array.isArray(sonuc) ? sonuc : [sonuc]) ciktilar.push(c);
    }
    // Çıktı doğrulama -> sonek -> (başarılıysa) özgünleri taşı. Hiçbir adımda silme yok.
    await ciktilariDogrula(ciktilar);
    // Tek PDF'de birleştir: hedef pdf, ayrı ayrı çevrilen 2+ çıktı (görsel -> PDF zaten toplu tek dosya üretir)
    if (plan.hedef === 'pdf' && !plan.toplu && is.secenekler && is.secenekler.tekPdf === true && ciktilar.length >= 2) {
      iptalKontrol();
      try {
        const birlesik = await pdfleriBirlestir(ciktilar, ciktiKlasoru, `${yollar.temizAd(path.parse(String(girdiler[0])).name)} (birleşik)`);
        await ciktilariDogrula([birlesik]);
        araCiktilar = ciktilar;
        ciktilar = [birlesik];
      } catch (e) {
        birlestirUyarilari.push(`Tek PDF'de birleştirilemedi; ayrı PDF'ler korundu. (${(e && e.message) || e})`);
      }
    }
    if (ustVeri) {
      for (const c of ciktilar) if (yollar.uzantiAl(c) === 'pdf') await require('./motorlar/pdf').ustVeriTemizle(c);
    }
    const sonCiktilar = [];
    for (const c of ciktilar) sonCiktilar.push(sonek ? await yollar.sonekEkle(c, sonek) : c);
    const sonuc = { ciktilar: sonCiktilar, tasinanlar: [], uyarilar: [...birlestirUyarilari] };
    if (araCiktilar.length) sonuc.araCiktilar = araCiktilar;
    if (is.ozgunTasi === true) {
      const t = await ozgunleriTasi(girdiler, sonCiktilar);
      sonuc.tasinanlar = t.tasinanlar;
      sonuc.uyarilar.push(...t.uyarilar);
    }
    bildir(100);
    return sonuc;
  } finally {
    await fsp.rm(isGeciciKok, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  donustur, planla, tekillestir, pdfleriBirlestir, FFMPEG_BULUNAMADI,
  ciktiGecerli, ciktilariDogrula, ozgunleriTasi, bulutDenetle,
  CIKTI_IMZALARI, CIKTI_BOZUK, BULUT_DOSYASI,
};
