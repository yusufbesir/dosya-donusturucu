'use strict';
// TaaDön ana süreç (Electron). Sahip: Yusuf. yazan: [Claude#taadon] — değişiklikler ORTAK-AJAN-KURALLARI çerçevesinde.
// 1.10.0 Yönetici paneli (PIN kilidi, durum, tanı dosyası): [Claude#taadon-1.10-yonetici 2026-11-04]
const { app, BrowserWindow, Menu, session, dialog, ipcMain, shell, powerSaveBlocker, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const D = require('./dogrulama');

const ARAYUZ_URL = pathToFileURL(path.join(__dirname, 'arayuz', 'index.html')).href;
const SMOKE = process.env.DONUSTURUCU_SMOKE === '1';

// Çekirdek (src/) yalnızca gerektiğinde yüklenir.
const _onbellek = {};
const modul = (ad, yol) => (_onbellek[ad] || (_onbellek[ad] = require(yol)));
const cekirdek = () => ({
  get katalog() { return modul('katalog', './src/katalog'); },
  get kuyruk() { return modul('kuyruk', './src/kuyruk'); },
  get donustur() { return modul('donustur', './src/donustur'); },
  get yollar() { return modul('yollar', './src/yollar'); },
  get libreoffice() { return modul('libreoffice', './src/motorlar/libreoffice'); },
  get calibre() { return modul('calibre', './src/motorlar/calibre'); }
});

// Sınırlar (inceleme bulguları)
const MAKS_YOL_BILDIR = 5000;   // yol-bildir çağrısı başına en fazla yol
const MAKS_ETKIN_IS = 500;      // bekleyen + çalışan iş üst sınırı
const MAKS_PANO_BAYT = 50 * 1024 * 1024; // panodan yapıştırılan görüntü (PNG) üst sınırı

// Saf yardımcı: baytlar "%PDF-" imzasıyla başlıyor mu (ilk 5 bayt)
function pdfImzasiGecerli(bayt) {
  if (!bayt || bayt.length < 5) return false;
  const imza = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let i = 0; i < 5; i++) if (bayt[i] !== imza[i]) return false;
  return true;
}

// Saf yardımcı: sayfa numarası dolgu uzunluğu; toplam 1..100000 tamsayıysa basamak sayısı, en az 3
function sayfaDolgusu(toplam) {
  if (!Number.isInteger(toplam) || toplam < 1 || toplam > 100000) return 3;
  return Math.max(3, String(toplam).length);
}

// Saf yardımcı (1.9.0): panodan gelen görüntü PNG imzalı ve 8..sinir bayt arası mı
function panoPngGecerli(bayt, sinir) {
  if (!(bayt instanceof Uint8Array) || bayt.length < 8 || bayt.length > sinir) return false;
  const imza = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bayt[i] !== imza[i]) return false;
  return true;
}

// Saf yardımcı (1.9.0): dosyanın ilk baytlarından (en çok 4 KB) biçim algılama. Bilinmiyorsa null.
// PK (zip) kapsayıcısında [Content_Types].xml varsa word/ xl/ ppt/ dizgisi aranır; epub mimetype dizgisinden tanınır.
function bicimAlgila(bayt) {
  if (!bayt || bayt.length < 4) return null;
  const ascii = (bas, son) => { let m = ''; for (let i = bas; i < Math.min(son, bayt.length); i++) m += String.fromCharCode(bayt[i]); return m; };
  const bas = (...d) => d.every((x, i) => bayt[i] === x);
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (bas(0x50, 0x4b, 0x03, 0x04)) {
    const metin = ascii(0, 4096);
    if (metin.includes('application/epub+zip')) return 'epub';
    if (metin.includes('[Content_Types].xml')) {
      if (metin.includes('word/')) return 'docx';
      if (metin.includes('xl/')) return 'xlsx';
      if (metin.includes('ppt/')) return 'pptx';
    }
    return 'zip';
  }
  if (bas(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (bas(0xff, 0xd8, 0xff)) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF') {
    if (ascii(8, 12) === 'WEBP') return 'webp';
    if (ascii(8, 12) === 'WAVE') return 'wav';
    return null;
  }
  if (ascii(0, 3) === 'ID3' || (bayt[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(bayt[1]))) return 'mp3';
  if (ascii(4, 8) === 'ftyp') return 'mp4';
  if (bas(0x1f, 0x8b)) return 'gz';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (bas(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7z';
  if (ascii(0, 6) === 'Rar!\x1a\x07') return 'rar';
  if (ascii(0, 2) === 'BM') return 'bmp';
  return null;
}

// Saf yardımcı (1.9.0): algılanan biçim uzantıyla uyuşuyor mu (kapsayıcı aileleri hoş görülür). Bilinmiyorsa uyuşur.
function bicimUyusuyor(bicim, uzanti) {
  if (!bicim) return true;
  const u = String(uzanti || '').toLowerCase();
  const aile = {
    jpg: ['jpg', 'jpeg', 'jpe', 'jfif'],
    zip: ['zip', 'docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'epub', 'odt', 'ods', 'odp', 'odg', 'cbz', 'jar', 'apk', 'kmz', '3mf', 'xps', 'oxps'],
    mp4: ['mp4', 'm4a', 'm4v', 'm4b', 'mov', '3gp', '3g2', 'heic', 'heif', 'avif', 'f4v'],
    ogg: ['ogg', 'oga', 'ogv', 'opus', 'spx'],
    gz: ['gz', 'tgz']
  };
  return (aile[bicim] || [bicim]).includes(u);
}

// Saf yardımcı (1.9.0): görev çubuğu ilerlemesi; etkin iş yoksa -1, yoksa çalışanların ortalama yüzdesi (0..1)
function gorevCubuguDegeri(yuzdeler, etkinSayi) {
  if (!(etkinSayi > 0)) return -1;
  const g = (yuzdeler || []).filter((y) => Number.isFinite(y));
  if (!g.length) return 0;
  return g.reduce((t, y) => t + Math.max(0, Math.min(100, y)), 0) / g.length / 100;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let pencere = null;
  let kuyruk = null;
  let ayarlar = null;
  let gecmis = [];
  const izinliDosyalar = new D.YolKumesi();    // iletişim kutusundan seçilen / sürüklenen dosyalar
  const izinliKlasorler = new D.YolKumesi();   // iletişim kutusundan seçilen klasörler
  const uretilenler = new D.YolKumesi();       // programın ürettiği çıktı yolları
  const isBilgisi = new Map();                 // id -> { ad, hedef }
  const isHamlari = new Map();                 // id -> { girdiler, hedef, ciktiKlasoru, secenekler } (Yeniden dene; bitenler temizlenince silinir)
  const MAKS_ISHAM = 200;
  let dialogAcik = false;                      // aynı anda tek dosya/klasör iletişim kutusu
  let gucEngelId = null;                       // powerSaveBlocker kimliği (çalışan iş varken)
  const etkinIsler = new Set();                // bekleyen + çalışan iş kimlikleri
  const calisanYuzde = new Map();              // id -> yüzde (görev çubuğu ilerlemesi)
  let hataGostergesi = null;                   // görev çubuğu 'error' modu zamanlayıcısı
  let isitmaBasladi = false;                   // LibreOffice ısıtması oturumda en çok bir kez (1.9.0)
  let onizlemeSuruyor = false;                 // önizleme: aynı anda en çok bir istek (1.9.0)
  let yoneticiAcik = false;                    // Yönetici paneli kilidi (1.10.0): yalnız main tutar, oturumluk
  const pinSayac = D.pinDenemeSayaci({ maks: 5, beklemeMs: 60000 }); // 5 yanlış PIN → 60 sn bekleme

  const ayarYolu = () => path.join(app.getPath('userData'), 'ayarlar.json');
  const gecmisYolu = () => path.join(app.getPath('userData'), 'gecmis.json');

  function varsayilanCikti() {
    return path.join(app.getPath('documents'), 'Dönüştürülenler');
  }

  function jsonOku(yol, yedek) {
    try { return JSON.parse(fs.readFileSync(yol, 'utf8')); } catch { return yedek; }
  }
  function jsonYaz(yol, veri) {
    try {
      fs.mkdirSync(path.dirname(yol), { recursive: true });
      const gecici = yol + '.tmp';
      fs.writeFileSync(gecici, JSON.stringify(veri, null, 2), 'utf8');
      fs.renameSync(gecici, yol);
    } catch (e) { console.error('Kaydedilemedi:', e.message); }
  }

  function ayarlariYukle() {
    const k = jsonOku(ayarYolu(), {});
    ayarlar = {
      ciktiKlasoru: varsayilanCikti(),
      sofficeYolu: '',
      esZamanli: 2,
      tema: 'sistem',
      ciktiYeri: 'klasor',   // 'klasor' | 'kaynak' (çıktı ilk girdinin klasörüne)
      sonek: '',             // çıktı adı soneki: ad<sonek>.uz
      ozgunTasi: false,      // iş bitince özgün dosya <kaynak>\Özgün\ altına taşınır (silinmez)
      ustVeriTemizle: false, // çıktıdan yazar/yorum/konum üst verisi silinir (gizlilik; PDF, Office, görsel)
      motorRust: true,       // arşiv işlerinde Rust çekirdeği taa-donustur.exe (yoksa JS yolu); [Claude#taadon-rust-asama2 2026-11-04]
      ozYonetici: true,      // 1.10.0 Yönetici paneli kartı (kapalıysa kart görünmez, kanallar kilitli)
      yoneticiPinOzeti: '',  // yalnız SHA-256 özeti; düz PIN hiçbir yere yazılmaz
      // 1.9.0 Özellikler (Ayarlar'dan kapatılabilir; hepsi varsayılan açık) [Claude#taadon-1.9-paket-c 2026-11-04]
      ...Object.fromEntries(D.OZELLIK_ANAHTARLARI.map((k) => [k, true]))
    };
    if (typeof k.ciktiKlasoru === 'string' && D.yolBicimiGecerli(k.ciktiKlasoru)) ayarlar.ciktiKlasoru = k.ciktiKlasoru;
    if (typeof k.sofficeYolu === 'string' && D.yolBicimiGecerli(k.sofficeYolu) && D.sofficeAdiGecerli(k.sofficeYolu)) ayarlar.sofficeYolu = k.sofficeYolu;
    if (Number.isInteger(k.esZamanli) && k.esZamanli >= 1 && k.esZamanli <= 4) ayarlar.esZamanli = k.esZamanli;
    if (D.TEMALAR.includes(k.tema)) ayarlar.tema = k.tema;
    if (D.CIKTI_YERLERI.includes(k.ciktiYeri)) ayarlar.ciktiYeri = k.ciktiYeri;
    if (typeof k.sonek === 'string' && D.SONEK_DESENI.test(k.sonek)) ayarlar.sonek = k.sonek;
    if (typeof k.ozgunTasi === 'boolean') ayarlar.ozgunTasi = k.ozgunTasi;
    if (typeof k.motorRust === 'boolean') ayarlar.motorRust = k.motorRust;
    if (typeof k.ustVeriTemizle === 'boolean') ayarlar.ustVeriTemizle = k.ustVeriTemizle;
    if (typeof k.ozYonetici === 'boolean') ayarlar.ozYonetici = k.ozYonetici;
    if (typeof k.yoneticiPinOzeti === 'string' && D.OZET_DESENI.test(k.yoneticiPinOzeti)) ayarlar.yoneticiPinOzeti = k.yoneticiPinOzeti;
    for (const oz of D.OZELLIK_ANAHTARLARI) if (typeof k[oz] === 'boolean') ayarlar[oz] = k[oz];
    try { fs.mkdirSync(ayarlar.ciktiKlasoru, { recursive: true }); } catch { ayarlar.ciktiKlasoru = varsayilanCikti(); try { fs.mkdirSync(ayarlar.ciktiKlasoru, { recursive: true }); } catch { /* yoksay */ } }
    izinliKlasorler.ekle(ayarlar.ciktiKlasoru);
    izinliKlasorler.ekle(varsayilanCikti());
    // Kayıtlı soffice yolu önceki oturumda kullanıcı tarafından seçildi
    if (ayarlar.sofficeYolu) izinliDosyalar.ekle(ayarlar.sofficeYolu);

    const g = jsonOku(gecmisYolu(), []);
    gecmis = Array.isArray(g) ? g.filter((x) => x && typeof x.id === 'string').slice(0, D.LIMITLER.maksGecmis) : [];
  }

  // Arayüze giden ayarlar: PIN özeti main'den çıkmaz, yalnız "PIN belirlenmiş mi" bilgisi gider.
  function disaAyarlar() {
    const { yoneticiPinOzeti, ...g } = ayarlar;
    return Object.assign(g, { yoneticiPinVar: !!yoneticiPinOzeti, gecmis });
  }

  function ffmpegYolu() {
    try {
      const b = cekirdek().yollar.ffmpegYolunuBul({ resourcesPath: process.resourcesPath, uygulamaKlasoru: __dirname });
      if (b) return b;
    } catch { /* aşağıdaki adaylara düş */ }
    const aday = [
      path.join(__dirname, 'vendor', 'ffmpeg', 'ffmpeg.exe'),
      path.join(process.resourcesPath || '', 'vendor', 'ffmpeg', 'ffmpeg.exe'),
      path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe')
    ];
    return aday.find((y) => D.dosyaMi(y)) || aday[0];
  }

  const imzaOnbellek = new Map();
  // soffice yolu: ayarlardaki yol, programla gelen LibreOffice, %ProgramFiles%\LibreOffice. Windows'ta her aday
  // (ad kuralı + Authenticode imzası, imzacı "The Document Foundation") açılışta/kullanımda yeniden doğrulanır;
  // geçmeyen yol kullanılmaz. Dönüş: { yol, durum: 'tamam' | 'yok' | 'dogrulanamadi' }
  async function sofficeCoz() {
    let adaylar = [];
    try {
      const lo = cekirdek().libreoffice;
      adaylar = lo.sofficeAdaylari({ gomuluKlasor: app.isPackaged ? process.resourcesPath : path.join(__dirname, 'vendor') });
    } catch { /* çekirdek yüklenemedi */ }
    if (ayarlar.sofficeYolu && D.sofficeAdiGecerli(ayarlar.sofficeYolu) && D.dosyaMi(ayarlar.sofficeYolu)) {
      adaylar = [ayarlar.sofficeYolu, ...adaylar.filter((x) => x !== ayarlar.sofficeYolu)];
    }
    if (!adaylar.length) return { yol: '', durum: 'yok' };
    const { imzaDogrula } = modul('imza', './src/imza');
    for (const a of adaylar) {
      const r = await imzaDogrula(a, { onbellek: imzaOnbellek });
      if (r.gecerli) return { yol: a, durum: 'tamam' };
      console.error('LibreOffice imzası doğrulanamadı:', a, r.neden || '');
    }
    return { yol: '', durum: 'dogrulanamadi' };
  }

  // ebook-convert yolu: yalnız programla gelen Calibre (resources/calibre; geliştirmede vendor/calibre). Windows'ta
  // Authenticode imzası (imzacı "Kovid Goyal") doğrulanır. Dönüş: { yol, durum: 'tamam' | 'yok' | 'dogrulanamadi' }
  async function calibreCoz() {
    let adaylar = [];
    try {
      adaylar = cekirdek().calibre.ebookConvertAdaylari({ gomuluKlasor: app.isPackaged ? process.resourcesPath : path.join(__dirname, 'vendor') });
    } catch { /* çekirdek yüklenemedi */ }
    if (!adaylar.length) return { yol: '', durum: 'yok' };
    const { imzaDogrula } = modul('imza', './src/imza');
    for (const a of adaylar) {
      const r = await imzaDogrula(a, { onbellek: imzaOnbellek, imzaci: 'Kovid Goyal' });
      if (r.gecerli) return { yol: a, durum: 'tamam' };
      console.error('Calibre imzası doğrulanamadı:', a, r.neden || '');
    }
    return { yol: '', durum: 'dogrulanamadi' };
  }

  function arayuzeGonder(kanal, veri) {
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send(kanal, veri);
  }

  // Kuyrukta iş varken sistemin uyku/askıya almasını engeller; kuyruk boşalınca bırakır.
  function gucDurumunuGuncelle() {
    try {
      if (etkinIsler.size > 0) {
        if (gucEngelId === null || !powerSaveBlocker.isStarted(gucEngelId)) gucEngelId = powerSaveBlocker.start('prevent-app-suspension');
      } else if (gucEngelId !== null) {
        if (powerSaveBlocker.isStarted(gucEngelId)) powerSaveBlocker.stop(gucEngelId);
        gucEngelId = null;
      }
    } catch (e) { console.error('Güç engeli:', e.message); }
  }

  // Görev çubuğu ilerlemesi: çalışan işlerin ortalaması; kuyruk boşsa -1; hata kısa süre 'error' modunda gösterilir.
  function gorevCubugunuGuncelle() {
    if (!pencere || pencere.isDestroyed() || hataGostergesi) return;
    if (ayarlar && ayarlar.ozGorevCubugu === false) { try { pencere.setProgressBar(-1); } catch { /* yoksay */ } return; }
    try { pencere.setProgressBar(gorevCubuguDegeri([...calisanYuzde.values()], etkinIsler.size)); } catch (e) { console.error('Görev çubuğu:', e.message); }
  }
  function gorevCubuguHata() {
    if (!pencere || pencere.isDestroyed() || (ayarlar && ayarlar.ozGorevCubugu === false)) return;
    clearTimeout(hataGostergesi);
    try { pencere.setProgressBar(1, { mode: 'error' }); } catch (e) { console.error('Görev çubuğu:', e.message); }
    hataGostergesi = setTimeout(() => { hataGostergesi = null; gorevCubugunuGuncelle(); }, 3000);
  }

  // İş bitince (bitti/hata) pencere odakta değilse kısa Türkçe bildirim gösterir.
  function isBildirimi(ad, durum) {
    try {
      if (durum !== 'bitti' && durum !== 'hata') return;
      if (!Notification.isSupported()) return;
      if (pencere && !pencere.isDestroyed() && pencere.isFocused()) return;
      const govde = durum === 'bitti' ? `${ad || 'Dosya'} dönüştürüldü` : `${ad || 'Dosya'} dönüştürmesi başarısız`;
      new Notification({ title: 'TaaDön', body: govde }).show();
    } catch (e) { console.error('Bildirim:', e.message); }
  }

  function kuyrukHazirla() {
    const { kuyruk: K, donustur } = cekirdek();
    const Kuyruk = K.Kuyruk || K;
    kuyruk = new Kuyruk({
      esZamanli: ayarlar.esZamanli,
      calistirici: async (is, ortam) => {
        const geciciKlasor = fs.mkdtempSync(path.join(app.getPath('temp'), 'dosya-donusturucu-'));
        try {
          const lo = await sofficeCoz();
          const cal = await calibreCoz();
          const sonuc = await donustur.donustur(is, Object.assign({}, ortam, {
            ffmpegYolu: ffmpegYolu(),
            sofficeYolu: lo.yol,
            sofficeDurumu: lo.durum,
            sofficeAramaYok: true,
            ebookConvertYolu: cal.yol,
            calibreDurumu: cal.durum,
            calibreAramaYok: true,
            profilSablonu: path.join(app.getPath('userData'), 'lo-profil-sablonu'), // LibreOffice profil şablonu (hız)
            rustMotor: ayarlar.motorRust === true, // arşiv: Rust çekirdeği (exe yoksa sessizce JS yolu)
            geciciKlasor
          }));
          // Tek PDF'de birleştir: birleştirme başarılıysa ara PDF'ler Geri Dönüşüm Kutusu'na (kalıcı silme yok)
          if (sonuc && Array.isArray(sonuc.araCiktilar)) {
            for (const a of sonuc.araCiktilar) {
              try { await shell.trashItem(path.resolve(a)); } catch (e) { console.error('Ara PDF çöpe taşınamadı:', a, e.message); }
            }
          }
          return sonuc;
        } finally {
          fs.rm(geciciKlasor, { recursive: true, force: true }, () => {});
        }
      }
    });
    kuyruk.on('durum', (d) => {
      if (!d || typeof d.id !== 'string') return;
      if (Array.isArray(d.ciktilar)) d.ciktilar.forEach((y) => uretilenler.ekle(y));
      if (d.durum === 'calisiyor') calisanYuzde.set(d.id, typeof d.yuzde === 'number' ? d.yuzde : (calisanYuzde.get(d.id) || 0));
      if (['bitti', 'hata', 'iptal'].includes(d.durum)) {
        calisanYuzde.delete(d.id);
        const b = isBilgisi.get(d.id) || {};
        etkinIsler.delete(d.id);
        gucDurumunuGuncelle();
        isBildirimi(b.ad, d.durum);
        gecmis.unshift({
          id: d.id, ad: b.ad || '', hedef: b.hedef || '', durum: d.durum,
          ciktilar: Array.isArray(d.ciktilar) ? d.ciktilar : [],
          hata: d.hata ? String(d.hata.message || d.hata) : '', zaman: Date.now()
        });
        gecmis = gecmis.slice(0, D.LIMITLER.maksGecmis);
        jsonYaz(gecmisYolu(), gecmis);
        isBilgisi.delete(d.id);
        if (d.durum === 'bitti') isHamlari.delete(d.id); // yalnız hata/iptal yeniden denenebilir
        while (isHamlari.size > MAKS_ISHAM) isHamlari.delete(isHamlari.keys().next().value);
      }
      if (d.durum === 'hata') gorevCubuguHata();
      else gorevCubugunuGuncelle();
      arayuzeGonder('durum', Object.assign({}, d, { hata: d.hata ? String(d.hata.message || d.hata) : undefined }));
    });
  }

  function islemKumesi() {
    try {
      const { katalog } = cekirdek();
      const tum = [];
      for (const k of katalog.KATEGORILER) {
        if (typeof katalog.islemler === 'function') tum.push(...(katalog.islemler(k.id) || []));
      }
      return D.islemAdlari(tum);
    } catch { return D.islemAdlari([]); }
  }

  function gonderenKontrol(e) {
    const url = e.senderFrame && e.senderFrame.url;
    if (!D.gonderenGecerli(url, ARAYUZ_URL)) throw new Error('Yetkisiz çağrı.');
  }
  function ele(kanal, isleyici) {
    ipcMain.handle(kanal, async (e, ...a) => { gonderenKontrol(e); return isleyici(...a); });
  }

  function ipcKur() {
    ele('kategoriler', () => cekirdek().katalog.KATEGORILER);

    ele('hedefler', (uzanti) => {
      if (typeof uzanti !== 'string' || !/^[a-z0-9]{1,10}$/i.test(uzanti)) throw new Error('Geçersiz uzantı.');
      return cekirdek().katalog.hedefler(uzanti.toLowerCase());
    });

    // Dosya türü tanıma: uzantıdan kategori ve ad (bilinmiyorsa kategori null)
    ele('bicim-bilgi', (uzanti) => {
      if (typeof uzanti !== 'string' || !/^[a-z0-9]{0,10}$/i.test(uzanti)) throw new Error('Geçersiz uzantı.');
      const { katalog } = cekirdek();
      const u = uzanti.toLowerCase();
      const b = katalog.BICIMLER[u] || katalog.BICIMLER[katalog.kanonik(u)];
      return { uzanti: u, kategori: b ? b.kategori : null, ad: b ? b.ad : null };
    });

    ele('dosya-sec', async (kategori, coklu) => {
      if (dialogAcik) throw new Error('Bir seçim penceresi zaten açık.');
      const { katalog } = cekirdek();
      const filtreler = [];
      if (kategori === 'soffice') {
        filtreler.push({ name: 'LibreOffice (soffice.exe)', extensions: ['exe'] });
      } else if (kategori === 'tum') {
        // Dönüştür sayfası: tanınan tüm uzantılar (katalogda hedefi olanlar)
        const uzantilar = Object.keys(katalog.BICIMLER).filter((u) => katalog.hedefler(u).length > 0);
        filtreler.push({ name: 'Desteklenen dosyalar', extensions: uzantilar });
        filtreler.push({ name: 'Tüm dosyalar', extensions: ['*'] });
      } else {
        if (typeof kategori !== 'string' || !katalog.KATEGORILER.some((k) => k.id === kategori)) throw new Error('Geçersiz kategori.');
        const uzantilar = Object.keys(katalog.BICIMLER).filter((u) => {
          const k = katalog.BICIMLER[u].kategori;
          return k === kategori || (kategori === 'ekitap' && katalog.EPUB_KAYNAK.includes(katalog.kanonik(u))) || (kategori === 'pdf' && (k === 'gorsel' || u === 'pdf')) || (kategori === 'arsiv' && ['zip', 'gz'].includes(u));
        });
        if (kategori === 'arsiv') uzantilar.push('zip', 'gz');
        if (uzantilar.length) filtreler.push({ name: 'Desteklenen dosyalar', extensions: [...new Set(uzantilar)] });
        filtreler.push({ name: 'Tüm dosyalar', extensions: ['*'] });
      }
      const props = ['openFile'];
      if (coklu && kategori !== 'soffice') props.push('multiSelections');
      let r;
      dialogAcik = true;
      try {
        r = await dialog.showOpenDialog(pencere, { title: 'Dosya seç', properties: props, filters: filtreler });
      } finally { dialogAcik = false; }
      if (r.canceled) return [];
      const yollar = r.filePaths.filter((y) => D.dosyaMi(y));
      yollar.forEach((y) => izinliDosyalar.ekle(y));
      return yollar;
    });

    ele('klasor-sec', async () => {
      if (dialogAcik) throw new Error('Bir seçim penceresi zaten açık.');
      let r;
      dialogAcik = true;
      try {
        r = await dialog.showOpenDialog(pencere, {
          title: 'Çıktı klasörünü seç', properties: ['openDirectory', 'createDirectory'],
          defaultPath: ayarlar.ciktiKlasoru
        });
      } finally { dialogAcik = false; }
      if (r.canceled || !r.filePaths[0]) return null;
      izinliKlasorler.ekle(r.filePaths[0]);
      return r.filePaths[0];
    });

    // Sürükle-bırak: preload webUtils.getPathForFile ile bulduğu yolu bildirir. Tek yol (dizge) ya da en fazla
    // MAKS_YOL_BILDIR yollu dizi kabul edilir; yalnız katalogda tanınan uzantılar ile pdf/zip/gz izinli olur.
    function bildirilenYoluDogrula(yol) {
      if (!D.yolBicimiGecerli(yol) || !D.dosyaMi(yol)) throw new Error('Yalnızca dosyalar bırakılabilir.');
      const u = path.extname(String(yol)).slice(1).toLowerCase();
      const { katalog } = cekirdek();
      const taninan = ['pdf', 'zip', 'gz'].includes(u) || !!(u && (katalog.BICIMLER[u] || katalog.BICIMLER[katalog.kanonik(u)]));
      if (!taninan) throw new Error('Bu dosya türü desteklenmiyor.');
      izinliDosyalar.ekle(yol);
      return yol;
    }
    ele('yol-bildir', (yol) => {
      if (Array.isArray(yol)) {
        if (yol.length > MAKS_YOL_BILDIR) throw new Error(`Bir seferde en fazla ${MAKS_YOL_BILDIR} dosya bırakılabilir.`);
        return yol.map(bildirilenYoluDogrula);
      }
      return bildirilenYoluDogrula(yol);
    });

    // Ctrl+V ile panodan ekran görüntüsü (1.9.0): PNG bayt, en çok 50 MB; %TEMP%\taadon-pano altına yazılır, izinli olur.
    ele('pano-gorseli-kaydet', async (veri) => {
      if (ayarlar.ozPano === false) throw new Error('Panodan ekleme Ayarlar > Özellikler bölümünde kapalı.');
      const bayt = D.veriBaytlari(veri, MAKS_PANO_BAYT);
      if (!panoPngGecerli(bayt, MAKS_PANO_BAYT)) throw new Error('Panodaki görüntü PNG değil.');
      const klasor = path.join(app.getPath('temp'), 'taadon-pano');
      await fs.promises.mkdir(klasor, { recursive: true });
      const zaman = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');
      for (let i = 0; i < 20; i++) {
        const hedef = path.join(klasor, `pano-${zaman}${i ? '-' + i : ''}.png`);
        try {
          await fs.promises.writeFile(hedef, bayt, { flag: 'wx' });
          izinliDosyalar.ekle(hedef);
          return hedef;
        } catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      throw new Error('Benzersiz dosya adı bulunamadı.');
    });

    // İmzadan biçim algılama (1.9.0): izinli dosyanın başı okunur (sihirli baytlar ilk 64 baytta; ofis dizgileri için 4 KB).
    ele('bicim-algila', async (yol) => {
      const tam = D.girdiYoluDogrula(yol, izinliDosyalar);
      const fh = await fs.promises.open(tam, 'r');
      let bayt;
      try {
        const tampon = Buffer.alloc(4096);
        const { bytesRead } = await fh.read(tampon, 0, 4096, 0);
        bayt = tampon.subarray(0, bytesRead);
      } finally { await fh.close(); }
      const uzanti = path.extname(tam).slice(1).toLowerCase();
      if (ayarlar.ozBicimAlgila === false) return { bicim: null, uzanti, uyusuyor: true };
      const bicim = bicimAlgila(bayt);
      return { bicim, uzanti, uyusuyor: bicimUyusuyor(bicim, uzanti) };
    });

    // Önizleme (1.9.0): izinli dosya için 160 px PNG ya da "N sayfa" metni; aynı anda tek istek, önbellek yok.
    ele('onizle', async (yol) => {
      if (ayarlar.ozOnizleme === false) return null;
      const tam = D.girdiYoluDogrula(yol, izinliDosyalar);
      if (onizlemeSuruyor) return null;
      onizlemeSuruyor = true;
      try {
        const r = await modul('onizleme', './src/motorlar/onizleme').onizle(tam, { enBuyukKenar: 160 });
        if (!r) return null;
        if (typeof r.metin === 'string') return { metin: r.metin };
        return r.veri ? { mime: 'image/png', veri: new Uint8Array(r.veri) } : null;
      } finally { onizlemeSuruyor = false; }
    });

    // Isıtma (1.9.0): ilk belge/tablo/sunum eklenince LibreOffice profil şablonu arka planda bir kez hazırlanır.
    ele('isitma-iste', () => {
      if (ayarlar.ozIsitma === false || isitmaBasladi) return false;
      isitmaBasladi = true;
      (async () => {
        const lo = await sofficeCoz();
        if (!lo.yol) return;
        const geciciKlasor = fs.mkdtempSync(path.join(app.getPath('temp'), 'dosya-donusturucu-'));
        try {
          const r = await cekirdek().libreoffice.isit({ sofficeYolu: lo.yol, profilSablonu: path.join(app.getPath('userData'), 'lo-profil-sablonu'), geciciKlasor });
          if (r && r.durum === 'hata') console.error('LibreOffice ısıtma:', r.hata || 'başarısız');
        } finally {
          fs.rm(geciciKlasor, { recursive: true, force: true }, () => {});
        }
      })().catch((e) => console.error('LibreOffice ısıtma:', e.message));
      return true;
    });

    function isEkleHam(ham) {
      const id = crypto.randomUUID();
      // D.isHazirla: ciktiYeri==='kaynak' ise çıktı klasörü ilk girdinin klasörü (izinliKlasorler'e eklenir);
      // işe ayarlardan sonek ve ozgunTasi eklenir, çekirdek (donustur) bunları uygular.
      const is = D.isHazirla(ham, {
        izinli: izinliDosyalar, id,
        hedeflerFn: (u) => cekirdek().katalog.hedefler(u),
        islemKumesi: islemKumesi(), izinliKlasorler,
        ayarlar: { ciktiYeri: ayarlar.ciktiYeri, sonek: ayarlar.sonek, ozgunTasi: ayarlar.ozgunTasi, ustVeriTemizle: ayarlar.ustVeriTemizle }
      });
      if (ayarlar.ozPdfBirlestir === false) delete is.secenekler.tekPdf; // özellik kapalıysa tek PDF birleştirme yok
      const ad = is.girdiler.length === 1 ? path.basename(is.girdiler[0]) : `${path.basename(is.girdiler[0])} ve ${is.girdiler.length - 1} dosya`;
      isBilgisi.set(id, { ad, hedef: is.hedef });
      etkinIsler.add(id);
      try { kuyruk.ekle(is); } catch (e) { etkinIsler.delete(id); isBilgisi.delete(id); throw e; }
      // Yeniden dene için ham (doğrulanmış) iş girdisi; yeniden denerken aynı doğrulamadan tekrar geçer.
      try { isHamlari.set(id, JSON.parse(JSON.stringify({ girdiler: ham.girdiler, hedef: ham.hedef, ciktiKlasoru: ham.ciktiKlasoru, secenekler: ham.secenekler }))); } catch { /* kayıt yoksa yeniden dene kapalı */ }
      gucDurumunuGuncelle();
      return { id, ad };
    }
    ele('is-ekle', (ham) => {
      if (etkinIsler.size >= MAKS_ETKIN_IS) throw new Error(`Kuyrukta en fazla ${MAKS_ETKIN_IS} iş olabilir; bazılarının bitmesini bekle.`);
      return isEkleHam(ham);
    });
    ele('is-yeniden-dene', (id) => {
      if (typeof id !== 'string' || id.length > 64) throw new Error('Geçersiz iş.');
      const kayit = isHamlari.get(id);
      if (!kayit) throw new Error('Bu iş yeniden denenemez (kayıt bulunamadı).');
      if (etkinIsler.size >= MAKS_ETKIN_IS) throw new Error(`Kuyrukta en fazla ${MAKS_ETKIN_IS} iş olabilir; bazılarının bitmesini bekle.`);
      const r = isEkleHam(JSON.parse(JSON.stringify(kayit))); // girdiler hâlâ izinli mi / dosyalar var mı: isHazirla denetler
      isHamlari.delete(id);
      return r;
    });

    ele('iptal', (id) => {
      if (typeof id !== 'string' || id.length > 64) throw new Error('Geçersiz iş.');
      kuyruk.iptal(id);
      return true;
    });
    ele('tumunu-iptal', () => { kuyruk.tumunuIptal(); return true; });

    ele('klasorde-goster', (yol) => {
      if (!D.yolBicimiGecerli(yol) || !uretilenler.var(yol)) throw new Error('Bu yol programın ürettiği bir çıktı değil.');
      if (!fs.existsSync(yol)) throw new Error('Dosya artık yok.');
      shell.showItemInFolder(path.resolve(yol));
      return true;
    });

    // Üretilen çıktıyı varsayılan uygulamada açar; yalnız programın kendi ürettiği, hâlâ var olan ve belge/medya
    // uzantılı dosya için. Arşivden çıkan dosyalar (zip-ac, gz-ac) her türden olabilir; çalıştırılabilir ya da
    // betik türleri (exe, bat, cmd, ps1, lnk, js, hta...) izin listesinde olmadığı için asla açılmaz.
    ele('ciktiyi-ac', async (yol) => {
      if (typeof D.acilabilirCiktiDogrula === 'function') {
        // Ortak denetim (dogrulama.js): üretilen çıktı mı, açılabilir uzantı mı, normal dosya mı
        D.acilabilirCiktiDogrula(yol, uretilenler, fs);
      } else {
        // Geri dönüş: dogrulama.js'te ortak denetim yoksa eski satır içi denetim
        if (!D.yolBicimiGecerli(yol) || !uretilenler.var(yol)) throw new Error('Bu yol programın ürettiği bir çıktı değil.');
        if (!D.ACILABILIR_UZANTILAR.has(path.extname(String(yol)).slice(1).toLowerCase())) throw new Error('Bu dosya türü programdan açılmaz; "Klasörde göster" ile ulaşabilirsin.');
        let st; try { st = fs.lstatSync(yol); } catch { throw new Error('Dosya artık yok.'); }
        if (!st.isFile()) throw new Error('Yalnız normal dosyalar açılır.');
      }
      const hata = await shell.openPath(path.resolve(yol));
      if (hata) throw new Error(`Dosya açılamadı. (${hata})`);
      return true;
    });

    ele('ayarlar-al', () => disaAyarlar());

    ele('gecmis-temizle', () => {
      gecmis = []; jsonYaz(gecmisYolu(), gecmis);
      for (const k of [...isHamlari.keys()]) if (!etkinIsler.has(k)) isHamlari.delete(k);
      return disaAyarlar();
    });

    ele('ayar-kaydet', (anahtar, deger) => {
      // GEÇİCİ UYUMLULUK: eski arayüz geçmişi ayar-kaydet('gecmisTemizle') ile temizliyor. Arayüz yeni
      // 'gecmis-temizle' kanalına (preload: gecmisTemizle) geçince bu dal kaldırılacak.
      if (anahtar === 'gecmisTemizle') {
        gecmis = []; jsonYaz(gecmisYolu(), gecmis);
        for (const k of [...isHamlari.keys()]) if (!etkinIsler.has(k)) isHamlari.delete(k);
        return disaAyarlar();
      }
      if (anahtar === 'yoneticiPinOzeti') throw new Error('PIN yalnız Yönetici panelinden değiştirilir.');
      const temiz = D.ayarDogrula(anahtar, deger, { izinli: izinliDosyalar, izinliKlasorler });
      ayarlar[anahtar] = temiz;
      if (anahtar === 'ozYonetici' && temiz === false) yoneticiAcik = false; // panel kapanınca kilitlenir
      if (anahtar === 'esZamanli' && kuyruk) kuyruk.esZamanli = temiz;
      if (anahtar === 'ozGorevCubugu') gorevCubugunuGuncelle();
      jsonYaz(ayarYolu(), ayarlar);
      return disaAyarlar();
    });

    /* ---------- Yönetici paneli (1.10.0) ---------- */
    // Kilit yalnız main'de tutulur; durum/tanı kanalları ilk iş olarak yoneticiDenetle() çağırır. PIN düz metni
    // hiçbir yere yazılmaz, loglanmaz ve hata metnine konmaz.
    function yoneticiDenetle() {
      if (!yoneticiAcik || ayarlar.ozYonetici === false) throw new Error('Yönetici paneli kilitli.');
    }
    function yoneticiEtkin() {
      if (ayarlar.ozYonetici === false) throw new Error('Yönetici paneli Ayarlar > Özellikler bölümünde kapalı.');
    }
    function pinDene(pin) {
      const kalan = pinSayac.bekleme();
      if (kalan > 0) throw new Error(`Çok fazla yanlış deneme; ${Math.ceil(kalan / 1000)} sn sonra tekrar dene.`);
      if (!D.pinEslesir(typeof pin === 'string' ? pin : '', ayarlar.yoneticiPinOzeti)) {
        const n = pinSayac.basarisiz();
        throw new Error(n >= 5 ? 'PIN yanlış; 60 sn beklemelisin.' : 'PIN yanlış.');
      }
      pinSayac.sifirla();
    }

    ele('yonetici-kilit-ac', (pin) => {
      yoneticiEtkin();
      if (!ayarlar.yoneticiPinOzeti) throw new Error('Önce bir PIN belirle.');
      pinDene(pin);
      yoneticiAcik = true;
      return true;
    });
    ele('yonetici-kilitle', () => { yoneticiAcik = false; return true; });
    // İlk kurulum: PIN yoksa yeni PIN belirlenir ve panel açılır. PIN varsa panel açık olmalı ve eski PIN doğru girilmeli.
    ele('yonetici-pin-belirle', (yeniPin, eskiPin) => {
      yoneticiEtkin();
      if (ayarlar.yoneticiPinOzeti) { yoneticiDenetle(); pinDene(eskiPin); }
      if (!D.pinGecerli(yeniPin)) throw new Error('PIN 4-8 haneli rakam olmalı.');
      ayarlar.yoneticiPinOzeti = D.ayarDogrula('yoneticiPinOzeti', D.pinOzeti(yeniPin), {});
      jsonYaz(ayarYolu(), ayarlar);
      yoneticiAcik = true;
      return true;
    });

    async function yoneticiDurumu() {
      const rust = modul('rust', './src/motorlar/rust');
      const exe = rust.exeYolu();
      let sha256 = '';
      if (exe) { try { sha256 = crypto.createHash('sha256').update(await fs.promises.readFile(exe)).digest('hex'); } catch { sha256 = ''; } }
      const surumAdaylari = [exe && path.join(path.dirname(exe), 'SURUM.txt'),
        process.resourcesPath && path.join(process.resourcesPath, 'cekirdek', 'SURUM.txt'),
        path.join(__dirname, 'vendor', 'cekirdek', 'SURUM.txt')].filter(Boolean);
      let modulSurumu = '';
      for (const y of surumAdaylari) {
        try { const m = (await fs.promises.readFile(y, 'utf8')).match(/^surum=(.+)$/m); if (m) { modulSurumu = m[1].trim(); break; } } catch { /* sonraki aday */ }
      }
      const ff = ffmpegYolu();
      const [lo, cal] = await Promise.all([sofficeCoz().catch(() => ({ yol: '', durum: 'yok' })), calibreCoz().catch(() => ({ yol: '', durum: 'yok' }))]);
      const sayim = { bekleyen: 0, calisan: 0, biten: 0, hata: 0 };
      try {
        for (const k of (kuyruk ? kuyruk.liste() : [])) {
          if (!k) continue;
          if (k.durum === 'bekliyor') sayim.bekleyen++;
          else if (k.durum === 'calisiyor') sayim.calisan++;
          else if (k.durum === 'bitti') sayim.biten++;
          else if (k.durum === 'hata') sayim.hata++;
        }
      } catch { /* kuyruk yok */ }
      return {
        surum: require('./package.json').version,
        electron: process.versions.electron || '', node: process.versions.node || '',
        cekirdek: { rustHazir: !!exe, exeYolu: exe || '', sha256, modulSurumu, motorRust: ayarlar.motorRust === true },
        motorlar: {
          ffmpeg: { yol: ff, var: D.dosyaMi(ff) },
          soffice: { yol: lo.yol, durum: lo.durum },
          calibre: { yol: cal.yol, durum: cal.durum }
        },
        ozellikler: Object.fromEntries(D.OZELLIK_ANAHTARLARI.map((k) => [k, ayarlar[k] !== false])),
        kuyruk: sayim,
        gecmisSayisi: gecmis.length,
        ayarDosyasi: ayarYolu(),
        profilSablonu: fs.existsSync(path.join(app.getPath('userData'), 'lo-profil-sablonu'))
      };
    }
    ele('yonetici-durum', async () => {
      yoneticiDenetle();
      return yoneticiDurumu();
    });

    // Tanı dosyası: Belgeler\TaaDön-tani-<tarih>.txt; 'wx' ile yazılır (üzerine yazma yok). İçerik: durum + son 50
    // geçmiş kaydı + ayarlar (PIN özeti maskeli); kullanıcı adı geçen her yol %USER% olur.
    ele('tani-olustur', async () => {
      yoneticiDenetle();
      const veri = { olusturma: new Date().toISOString(), durum: await yoneticiDurumu(), gecmis: gecmis.slice(0, 50), ayarlar: D.taniAyarlari(ayarlar) };
      let kullanici = '';
      try { kullanici = os.userInfo().username; } catch { /* yoksay */ }
      // Kısa (8.3) ad da maskelenir: %TEMP% yolu C:\Users\ABCDEF~1\... biçiminde gelebilir
      const kisaAdlar = [os.tmpdir(), app.getPath('temp')].map((y) => (String(y).match(/[\\/]Users[\\/]([^\\/]+)/i) || [])[1]);
      const metin = D.yolMaskele('TaaDön tanı dosyası (kullanıcı adı ve PIN maskeli)\n' + JSON.stringify(veri, null, 2) + '\n',
        [kullanici, path.basename(os.homedir()), ...kisaAdlar]);
      const klasor = app.getPath('documents');
      const zaman = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '');
      for (let i = 0; i < 20; i++) {
        const hedef = path.join(klasor, `TaaDön-tani-${zaman}${i ? '-' + i : ''}.txt`);
        try {
          await fs.promises.writeFile(hedef, metin, { encoding: 'utf8', flag: 'wx' });
          uretilenler.ekle(hedef); // "Klasörde göster" için
          return hedef;
        } catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      throw new Error('Benzersiz dosya adı bulunamadı.');
    });

    ele('libreoffice-durumu', async () => {
      const r = await sofficeCoz();
      return { kurulu: !!r.yol, yol: r.yol, durum: r.durum };
    });

    ele('calibre-durumu', async () => {
      const r = await calibreCoz();
      return { kurulu: !!r.yol, yol: r.yol, durum: r.durum };
    });

    ele('libreoffice-indirme', async () => {
      await shell.openExternal(D.SABIT_INDIRME_URL);
      return true;
    });

    ele('pdf-oku', async (yol) => {
      D.girdiYoluDogrula(yol, izinliDosyalar);
      if (path.extname(String(yol)).slice(1).toLowerCase() !== 'pdf') throw new Error('Yalnız PDF dosyaları okunabilir.');
      const st = await fs.promises.stat(yol);
      if (st.size > D.LIMITLER.maksPdfOkuBayt) throw new Error('PDF çok büyük.');
      const bayt = new Uint8Array(await fs.promises.readFile(yol));
      if (!pdfImzasiGecerli(bayt)) throw new Error('Dosya geçerli bir PDF değil (%PDF- imzası yok).');
      return bayt;
    });

    async function guvenliKaydet(klasor, ad, uzanti, bayt) {
      const { yollar } = cekirdek();
      // Üzerine yazma yok: 'wx' bayrağı, çakışırsa yeni benzersiz ad denenir.
      for (let i = 0; i < 5; i++) {
        const hedef = await yollar.benzersizYol(klasor, ad, uzanti);
        try {
          await fs.promises.writeFile(hedef, bayt, { flag: 'wx' });
          uretilenler.ekle(hedef);
          return hedef;
        } catch (e) { if (e.code !== 'EEXIST') throw e; }
      }
      throw new Error('Benzersiz dosya adı bulunamadı.');
    }

    ele('pdf-sayfa-kaydet', async (o) => {
      if (!o || typeof o !== 'object') throw new Error('Geçersiz istek.');
      D.girdiYoluDogrula(o.kaynak, izinliDosyalar);
      const klasor = D.ciktiKlasoruDogrula(o.ciktiKlasoru, izinliKlasorler);
      const uz = o.uzanti === 'jpeg' ? 'jpg' : o.uzanti;
      if (uz !== 'png' && uz !== 'jpg') throw new Error('Geçersiz görsel biçimi.');
      if (!Number.isInteger(o.sayfa) || o.sayfa < 1 || o.sayfa > 100000) throw new Error('Geçersiz sayfa.');
      const bayt = D.veriBaytlari(o.veri, D.LIMITLER.maksSayfaBayt);
      if (!D.gorselBicimiGecerli(bayt, uz)) throw new Error('Görsel verisi biçimle uyuşmuyor.');
      if (o.toplam !== undefined && (!Number.isInteger(o.toplam) || o.toplam < 1 || o.toplam > 100000)) throw new Error('Geçersiz toplam sayfa.');
      const ad = D.guvenliAd(o.kaynak, `-sayfa-${String(o.sayfa).padStart(sayfaDolgusu(o.toplam), '0')}`);
      return guvenliKaydet(klasor, ad, uz, bayt);
    });

    ele('metin-kaydet', async (o) => {
      if (!o || typeof o !== 'object') throw new Error('Geçersiz istek.');
      D.girdiYoluDogrula(o.kaynak, izinliDosyalar);
      const klasor = D.ciktiKlasoruDogrula(o.ciktiKlasoru, izinliKlasorler);
      if (typeof o.metin !== 'string') throw new Error('Geçersiz metin.');
      const bayt = Buffer.from(o.metin, 'utf8');
      if (bayt.length > D.LIMITLER.maksMetinBayt) throw new Error('Metin çok büyük.');
      return guvenliKaydet(klasor, D.guvenliAd(o.kaynak), 'txt', bayt);
    });
  }

  // Sağ tık / komut satırı: `TaaDön.exe "dosya1" "dosya2"`. Tanınan uzantı: pdf/zip/gz ya da katalogdaki biçim.
  function argvUzantiTaniniyor(u) {
    try {
      const { katalog } = cekirdek();
      return ['pdf', 'zip', 'gz'].includes(u) || !!(u && (katalog.BICIMLER[u] || katalog.BICIMLER[katalog.kanonik(u)]));
    } catch { return false; }
  }
  let bekleyenDosyalar = [];   // pencere yüklenmeden gelen komut satırı dosyaları
  let arayuzHazir = false;
  function komutSatiriDosyalari(argv, calismaKlasoru) {
    // Paketli: argv[0] exe; geliştirme (electron .): argv[0] electron, argv[1] uygulama yolu
    const yollar = D.argvDosyalari(argv, { atla: app.isPackaged ? 1 : 2, calismaKlasoru }, argvUzantiTaniniyor);
    if (!yollar.length) return;
    yollar.forEach((y) => izinliDosyalar.ekle(y));
    if (arayuzHazir && pencere && !pencere.isDestroyed()) arayuzeGonder('dosyalar-eklendi', yollar);
    else bekleyenDosyalar = bekleyenDosyalar.concat(yollar).slice(0, D.MAKS_ARGV_DOSYA);
  }

  app.on('second-instance', (_e, argv, calismaKlasoru) => {
    if (!pencere || pencere.isDestroyed()) {
      if (app.isReady()) olustur();
    } else {
      if (pencere.isMinimized()) pencere.restore();
      pencere.show();
      pencere.focus();
    }
    try { komutSatiriDosyalari(argv, calismaKlasoru); } catch (e) { console.error('Komut satırı dosyaları:', e.message); }
  });

  function olustur() {
    pencere = new BrowserWindow({
      title: 'TaaDön',
      width: 1240,
      height: 820,
      minWidth: 900,
      minHeight: 620,
      show: SMOKE ? false : true,
      autoHideMenuBar: true,
      backgroundColor: '#EEF1EA',
      icon: path.join(__dirname, 'build', 'ikon-512.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        allowRunningInsecureContent: false
      }
    });
    pencere.setMenuBarVisibility(false);
    pencere.on('page-title-updated', (e) => e.preventDefault());
    pencere.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pencere.webContents.on('will-navigate', (e) => e.preventDefault());
    pencere.webContents.on('will-attach-webview', (e) => e.preventDefault());
    arayuzHazir = false;
    pencere.webContents.on('did-finish-load', () => {
      arayuzHazir = true;
      if (bekleyenDosyalar.length) { const y = bekleyenDosyalar; bekleyenDosyalar = []; arayuzeGonder('dosyalar-eklendi', y); }
    });
    pencere.loadFile(path.join(__dirname, 'arayuz', 'index.html'));
    pencere.on('closed', () => { pencere = null; arayuzHazir = false; });
    if (SMOKE) smokeCalistir(pencere);
    else if (process.env.DONUSTURUCU_EKRAN) ekranGoruntusuAl(pencere, process.env.DONUSTURUCU_EKRAN);
  }

  // DONUSTURUCU_SMOKE=1: pencere gizli açılır, arayüz ve pdf.js denenir, sonuç yazdırılır, çıkılır.
  function smokeCalistir(p) {
    const mesajlar = [];
    p.webContents.on('console-message', (e) => { mesajlar.push(`${e.level}: ${e.message}`); });
    p.webContents.on('did-fail-load', (_e, kod, acik) => { mesajlar.push(`yükleme hatası ${kod} ${acik}`); });
    p.webContents.once('did-finish-load', async () => {
      let sonuc = {};
      try {
        const { PDFDocument } = require('pdf-lib');
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 200]).drawText('Merhaba');
        const b64 = Buffer.from(await pdf.save()).toString('base64');
        await new Promise((r) => setTimeout(r, 800));
        sonuc = await p.webContents.executeJavaScript(`(async () => {
          const o = {
            api: typeof window.donusturucu,
            menu: document.querySelectorAll('[data-kategori]').length
          };
          try {
            const m = await import('./pdf-araclari.js');
            const veri = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0));
            const belge = await m.pdfAc(veri);
            const c = await m.sayfaCiz(belge, 1, 1);
            o.pdf = { sayfa: belge.numPages, genislik: c.width };
            o.metin = await m.sayfaMetni(belge, 1);
          } catch (e) { o.pdfHata = String(e && e.message || e); }
          try { o.kategoriler = (await window.donusturucu.kategoriler()).length; } catch (e) { o.apiHata = String(e.message); }
          return o;
        })()`);
      } catch (e) { sonuc = { hata: String(e.message) }; }
      console.log('SMOKE_SONUC ' + JSON.stringify({ sonuc, mesajlar }));
      app.exit(0);
    });
    setTimeout(() => { console.log('SMOKE_ZAMAN_ASIMI'); app.exit(1); }, 20000);
  }

  // DONUSTURUCU_EKRAN=<klasör>: arayüz görsel denetimi için her sayfanın açık ve koyu temada ekran görüntüsünü
  // PNG olarak o klasöre yazar, sonra çıkar. Yalnız geliştirme/testte kullanılır; kullanıcı verisine dokunmaz.
  function ekranGoruntusuAl(p, klasor) {
    const sayfalar = ['donustur', 'pdf', 'arsiv', 'gecmis', 'ayarlar', 'hakkinda'];
    p.webContents.once('did-finish-load', async () => {
      try {
        fs.mkdirSync(klasor, { recursive: true });
        await new Promise((r) => setTimeout(r, 900));
        for (const tema of ['acik', 'koyu']) {
          await p.webContents.executeJavaScript(`document.documentElement.dataset.tema = ${JSON.stringify(tema)}; true`);
          for (const s of sayfalar) {
            await p.webContents.executeJavaScript(`document.querySelector('.menu-oge[data-sayfa=${JSON.stringify(s)}]').click(); true`);
            await new Promise((r) => setTimeout(r, 650));
            const g = await p.webContents.capturePage();
            fs.writeFileSync(path.join(klasor, `${tema}-${s}.png`), g.toPNG());
          }
        }
        console.log('EKRAN_TAMAM ' + klasor);
        app.exit(0);
      } catch (e) { console.log('EKRAN_HATA ' + String(e && e.message || e)); app.exit(1); }
    });
    setTimeout(() => { console.log('EKRAN_ZAMAN_ASIMI'); app.exit(1); }, 40000);
  }

  // Windows görev çubuğu gruplaması ve ikonu için (appId ile aynı olmalı)
  if (process.platform === 'win32') app.setAppUserModelId('com.dosyadonusturucu.app');

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const s = session.defaultSession;
    // file://, blob: ve data: dışındaki ağ isteklerini iptal et
    // file: yalnız arayuz/ ve pdfjs-dist çalışma zamanı klasörlerine; host'lu (UNC) adresler reddedilir
    const kokler = D.izinliDosyaKokleri(__dirname);
    s.webRequest.onBeforeRequest((d, cb) => {
      cb({ cancel: !D.istekIzinli(d.url, kokler) });
    });
    s.setPermissionRequestHandler((wc, izin, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);

    ayarlariYukle();
    try { kuyrukHazirla(); } catch (e) { console.error('Çekirdek yüklenemedi:', e.message); }
    ipcKur();
    olustur();
    // İlk açılışta komut satırıyla gelen dosyalar (sağ tık "TaaDön ile dönüştür"); pencere yüklenince gönderilir
    if (!SMOKE) { try { komutSatiriDosyalari(process.argv, process.cwd()); } catch (e) { console.error('Komut satırı dosyaları:', e.message); } }
    // İmza denetimini açılışta ısıt (sonuç önbelleğe alınır); hata arayüzü etkilemez
    sofficeCoz().catch(() => {});
    // Güncelleme temizliği: yalnız kurulu (paketli) Windows sürümünde, açılışı yavaşlatmadan bir kez
    if (app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) {
      setTimeout(() => {
        require('./src/guncelleme').eskiSurumuTemizle({
          kurulumKoku: path.dirname(process.execPath),
          resourcesYolu: process.resourcesPath,
          calisanExe: path.basename(process.execPath),
          korunacakKokler: [app.getPath('userData'), app.getPath('documents'), ayarlar && ayarlar.ciktiKlasoru, varsayilanCikti()].filter(Boolean)
        }).then((r) => { if (r.durum === 'hata' || r.durum === 'dogrulanamadi') console.error('Güncelleme temizliği:', r.durum, r.hata || r.neden || ''); })
          .catch((e) => console.error('Güncelleme temizliği:', e.message));
      }, 8000);
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) olustur(); });
  });

  app.on('window-all-closed', () => app.quit());
}
