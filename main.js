'use strict';
// TaaDön ana süreç (Electron). Sahip: Yusuf. yazan: [Claude#taadon] — değişiklikler ORTAK-AJAN-KURALLARI çerçevesinde.
const { app, BrowserWindow, Menu, session, dialog, ipcMain, shell, powerSaveBlocker, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
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
  let dialogAcik = false;                      // aynı anda tek dosya/klasör iletişim kutusu
  let gucEngelId = null;                       // powerSaveBlocker kimliği (çalışan iş varken)
  const etkinIsler = new Set();                // bekleyen + çalışan iş kimlikleri

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
      motorRust: true        // arşiv işlerinde Rust çekirdeği taa-donustur.exe (yoksa JS yolu); [Claude#taadon-rust-asama2 2026-11-04]
    };
    if (typeof k.ciktiKlasoru === 'string' && D.yolBicimiGecerli(k.ciktiKlasoru)) ayarlar.ciktiKlasoru = k.ciktiKlasoru;
    if (typeof k.sofficeYolu === 'string' && D.yolBicimiGecerli(k.sofficeYolu) && D.sofficeAdiGecerli(k.sofficeYolu)) ayarlar.sofficeYolu = k.sofficeYolu;
    if (Number.isInteger(k.esZamanli) && k.esZamanli >= 1 && k.esZamanli <= 4) ayarlar.esZamanli = k.esZamanli;
    if (D.TEMALAR.includes(k.tema)) ayarlar.tema = k.tema;
    if (D.CIKTI_YERLERI.includes(k.ciktiYeri)) ayarlar.ciktiYeri = k.ciktiYeri;
    if (typeof k.sonek === 'string' && D.SONEK_DESENI.test(k.sonek)) ayarlar.sonek = k.sonek;
    if (typeof k.ozgunTasi === 'boolean') ayarlar.ozgunTasi = k.ozgunTasi;
    if (typeof k.motorRust === 'boolean') ayarlar.motorRust = k.motorRust;
    try { fs.mkdirSync(ayarlar.ciktiKlasoru, { recursive: true }); } catch { ayarlar.ciktiKlasoru = varsayilanCikti(); try { fs.mkdirSync(ayarlar.ciktiKlasoru, { recursive: true }); } catch { /* yoksay */ } }
    izinliKlasorler.ekle(ayarlar.ciktiKlasoru);
    izinliKlasorler.ekle(varsayilanCikti());
    // Kayıtlı soffice yolu önceki oturumda kullanıcı tarafından seçildi
    if (ayarlar.sofficeYolu) izinliDosyalar.ekle(ayarlar.sofficeYolu);

    const g = jsonOku(gecmisYolu(), []);
    gecmis = Array.isArray(g) ? g.filter((x) => x && typeof x.id === 'string').slice(0, D.LIMITLER.maksGecmis) : [];
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
          return await donustur.donustur(is, Object.assign({}, ortam, {
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
        } finally {
          fs.rm(geciciKlasor, { recursive: true, force: true }, () => {});
        }
      }
    });
    kuyruk.on('durum', (d) => {
      if (!d || typeof d.id !== 'string') return;
      if (Array.isArray(d.ciktilar)) d.ciktilar.forEach((y) => uretilenler.ekle(y));
      if (['bitti', 'hata', 'iptal'].includes(d.durum)) {
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
      }
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

    ele('is-ekle', (ham) => {
      if (etkinIsler.size >= MAKS_ETKIN_IS) throw new Error(`Kuyrukta en fazla ${MAKS_ETKIN_IS} iş olabilir; bazılarının bitmesini bekle.`);
      const id = crypto.randomUUID();
      // D.isHazirla: ciktiYeri==='kaynak' ise çıktı klasörü ilk girdinin klasörü (izinliKlasorler'e eklenir);
      // işe ayarlardan sonek ve ozgunTasi eklenir, çekirdek (donustur) bunları uygular.
      const is = D.isHazirla(ham, {
        izinli: izinliDosyalar, id,
        hedeflerFn: (u) => cekirdek().katalog.hedefler(u),
        islemKumesi: islemKumesi(), izinliKlasorler,
        ayarlar: { ciktiYeri: ayarlar.ciktiYeri, sonek: ayarlar.sonek, ozgunTasi: ayarlar.ozgunTasi }
      });
      const ad = is.girdiler.length === 1 ? path.basename(is.girdiler[0]) : `${path.basename(is.girdiler[0])} ve ${is.girdiler.length - 1} dosya`;
      isBilgisi.set(id, { ad, hedef: is.hedef });
      etkinIsler.add(id);
      try { kuyruk.ekle(is); } catch (e) { etkinIsler.delete(id); isBilgisi.delete(id); throw e; }
      gucDurumunuGuncelle();
      return { id, ad };
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

    ele('ayarlar-al', () => Object.assign({}, ayarlar, { gecmis }));

    ele('gecmis-temizle', () => {
      gecmis = []; jsonYaz(gecmisYolu(), gecmis);
      return Object.assign({}, ayarlar, { gecmis });
    });

    ele('ayar-kaydet', (anahtar, deger) => {
      // GEÇİCİ UYUMLULUK: eski arayüz geçmişi ayar-kaydet('gecmisTemizle') ile temizliyor. Arayüz yeni
      // 'gecmis-temizle' kanalına (preload: gecmisTemizle) geçince bu dal kaldırılacak.
      if (anahtar === 'gecmisTemizle') {
        gecmis = []; jsonYaz(gecmisYolu(), gecmis);
        return Object.assign({}, ayarlar, { gecmis });
      }
      const temiz = D.ayarDogrula(anahtar, deger, { izinli: izinliDosyalar, izinliKlasorler });
      ayarlar[anahtar] = temiz;
      if (anahtar === 'esZamanli' && kuyruk) kuyruk.esZamanli = temiz;
      jsonYaz(ayarYolu(), ayarlar);
      return Object.assign({}, ayarlar, { gecmis });
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
