// TaaDön arayüz mantığı (renderer). Sahip: Yusuf. yazan: [Claude#taadon] — değişiklikler ORTAK-AJAN-KURALLARI çerçevesinde.
// 1.9.0 Özellikler kartı, önizleme, tek PDF'de birleştir, ısıtma: [Claude#taadon-1.9-paket-c 2026-11-04]
// 1.10.0 Yönetici paneli kartı: [Claude#taadon-1.10-yonetici 2026-11-04]
const api = window.donusturucu;

/* ---------- Yardımcılar ---------- */
function h(etiket, ozellik, ...cocuklar) {
  const e = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik || {})) {
    if (v == null || v === false) continue;
    if (k === 'sinif') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'metin') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of cocuklar.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const adAl = (yol) => String(yol).split(/[\\/]/).pop();
const uzAl = (yol) => { const a = adAl(yol); const i = a.lastIndexOf('.'); return i < 0 ? '' : a.slice(i + 1).toLowerCase(); };

// Aynı metin zaten görünüyorsa tekrar eklenmez; en çok 4 bildirim kalır (en eskisi kaldırılır).
function bildir(metin, hata) {
  const kutu = document.getElementById('bildirimler');
  if (Array.from(kutu.children).some((c) => c.textContent === metin)) return;
  while (kutu.children.length >= 4) kutu.firstElementChild.remove();
  const k = h('div', { sinif: 'bildirim' + (hata ? ' hata' : ''), metin });
  kutu.append(k);
  setTimeout(() => k.remove(), hata ? 7000 : 3500);
}
const hataMetni = (e) => (e && e.message) ? e.message : String(e);
// Döngülerde dosya başına hata yerine tek toplu bildirim: hatalar = [[ad, mesaj], ...]
function hatalariBildir(hatalar) {
  if (!hatalar.length) return;
  const [ad, m] = hatalar[0];
  bildir(hatalar.length === 1 ? `${ad}: ${m}` : `${hatalar.length} dosyada hata oluştu. İlki: ${ad}: ${m}`, true);
}
// Klasör gezme (saf işlev; test için işaretli blok): girisler = {name, isDirectory} öğeleri,
// oku(dizin) -> Promise<çocuk listesi>. En çok `derinlik` klasör katmanı ve `limit` tanınan dosya alınır.
// KLASOR-GEZ-BASLA
async function klasorGez(girisler, secenek) {
  const { derinlik, limit, tanin, oku } = secenek;
  const dosyalar = [];
  let kesildi = false;
  async function gez(g, d) {
    if (kesildi) return;
    if (g.isDirectory) {
      if (d >= derinlik) return;
      for (const c of await oku(g)) { await gez(c, d + 1); if (kesildi) return; }
    } else if (tanin(g.name)) {
      if (dosyalar.length >= limit) { kesildi = true; return; }
      dosyalar.push(g);
    }
  }
  for (const g of girisler) await gez(g, 0);
  return { dosyalar, kesildi };
}
// KLASOR-GEZ-BITIS
const KLASOR_DERINLIK = 3;
const KLASOR_LIMIT = 500;
// Katalogda (sayfa araçlarının kabul listelerinde) tanınan uzantı mı?
function taninanUzanti(ad) {
  const i = String(ad).lastIndexOf('.');
  if (i < 0) return false;
  const u = String(ad).slice(i + 1).toLowerCase();
  return Object.values(ARACLAR).some((liste) => liste.some((a) => a.kabul && a.kabul.includes(u)));
}
const dizinOku = (g) => new Promise((ok, no) => {
  const r = g.createReader(); const hepsi = [];
  const al = () => r.readEntries((l) => { if (!l.length) ok(hepsi); else { hepsi.push(...l); al(); } }, no);
  al();
});
const girdidenDosya = (g) => new Promise((ok, no) => g.file(ok, no));
// Bırakılan öğelerden File listesi: klasörler gezilir (webkitGetAsEntry bırakma anında eşzamanlı çağrılır).
async function birakilanDosyalar(e) {
  const dt = e.dataTransfer;
  if (!dt) return [];
  const ogeler = Array.from(dt.items || []).filter((it) => it.kind === 'file');
  const dizinler = [];
  const dosyalar = [];
  if (ogeler.length) {
    for (const it of ogeler) {
      const g = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
      if (g && g.isDirectory) dizinler.push(g);
      else { const f = it.getAsFile(); if (f) dosyalar.push(f); }
    }
  } else dosyalar.push(...Array.from(dt.files || []));
  if (!dizinler.length) return dosyalar;
  const hatalar = [];
  let r = { dosyalar: [], kesildi: false };
  try { r = await klasorGez(dizinler, { derinlik: KLASOR_DERINLIK, limit: KLASOR_LIMIT, tanin: taninanUzanti, oku: dizinOku }); }
  catch (err) { hatalar.push(['Klasör okunamadı', hataMetni(err)]); }
  for (const g of r.dosyalar) {
    try { dosyalar.push(await girdidenDosya(g)); } catch (err) { hatalar.push([g.name, hataMetni(err)]); }
  }
  hatalariBildir(hatalar);
  if (r.kesildi) bildir('İlk ' + KLASOR_LIMIT + ' dosya alındı.', true);
  return dosyalar;
}
// Gönderim düğmesi: çift tık / Ctrl+Enter aynı dosyaları iki kez eklemesin; iş eklenemezse düğme geri açılır.
async function gonder(dugme, is) {
  if (dugme.disabled) return;
  dugme.disabled = true;
  let tamam = false;
  try { tamam = await is(); } catch (e) { bildir(hataMetni(e), true); }
  if (!tamam && dugme.isConnected) dugme.disabled = false;
}

/* ---------- Son kullanılan biçim (yalnız bu bilgisayarda, localStorage) ---------- */
const SON_HEDEF_ANAHTAR = 'taadon.sonHedefler';
function sonHedefleriOku() {
  try { const v = JSON.parse(localStorage.getItem(SON_HEDEF_ANAHTAR) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
// anahtar: 'oto/<grup>' ya da '<sayfa>/<araç>'; dönen değer yalnız o anki hedef listesindeyse kullanılır
function sonHedefAl(anahtar) { const v = sonHedefleriOku()[anahtar]; return typeof v === 'string' && /^[a-z0-9-]{1,32}$/.test(v) ? v : null; }
function sonHedefYaz(anahtar, hedef) {
  try { const v = sonHedefleriOku(); v[anahtar] = hedef; localStorage.setItem(SON_HEDEF_ANAHTAR, JSON.stringify(v)); } catch { /* kalıcı olmasa da çalışır */ }
}

/* ---------- Özellikler (1.9.0; Ayarlar > Özellikler, varsayılan açık) ---------- */
const ozellikAcik = (anahtar) => !durum.ayarlar || durum.ayarlar[anahtar] !== false;

// Önizleme: satırda ~400 ms durunca (fare ya da klavye odağı) küçük ipucu kutusu; tembel, önbelleksiz, tek istek.
const onizleme = { zamanlayici: null, no: 0, bekleyen: false, kutu: null, url: null };
function onizlemeKapat() {
  clearTimeout(onizleme.zamanlayici);
  onizleme.zamanlayici = null;
  onizleme.no++;
  if (onizleme.kutu) { onizleme.kutu.remove(); onizleme.kutu = null; }
  if (onizleme.url) { URL.revokeObjectURL(onizleme.url); onizleme.url = null; }
}
async function onizlemeGetir(li, yol, no) {
  if (no !== onizleme.no || !li.isConnected) return;
  if (onizleme.bekleyen) { onizleme.zamanlayici = setTimeout(() => onizlemeGetir(li, yol, no), 150); return; }
  onizleme.bekleyen = true;
  let r = null;
  try { r = await api.onizle(yol); } catch { r = null; } finally { onizleme.bekleyen = false; }
  if (no !== onizleme.no || !li.isConnected || !r) return;
  const kutu = h('div', { sinif: 'onizleme-ipucu', role: 'tooltip', id: 'onizleme-ipucu' });
  if (typeof r.metin === 'string') kutu.textContent = r.metin;
  else if (r.veri) {
    onizleme.url = URL.createObjectURL(new Blob([r.veri], { type: 'image/png' }));
    kutu.append(h('img', { src: onizleme.url, alt: 'Önizleme: ' + adAl(yol) }));
  } else return;
  const d = li.getBoundingClientRect();
  kutu.style.left = Math.max(8, Math.min(d.left + 24, window.innerWidth - 200)) + 'px';
  kutu.style.top = (d.bottom + 196 < window.innerHeight ? d.bottom + 4 : Math.max(8, d.top - 196)) + 'px';
  document.body.append(kutu);
  onizleme.kutu = kutu;
  li.setAttribute('aria-describedby', 'onizleme-ipucu');
}
function onizlemeBagla(li, yol) {
  if (!ozellikAcik('ozOnizleme') || typeof api.onizle !== 'function') return li;
  const bekle = () => { onizlemeKapat(); const no = onizleme.no; onizleme.zamanlayici = setTimeout(() => onizlemeGetir(li, yol, no), 400); };
  const birak = () => { onizlemeKapat(); li.removeAttribute('aria-describedby'); };
  li.addEventListener('mouseenter', bekle);
  li.addEventListener('mouseleave', birak);
  li.addEventListener('focusin', bekle);
  li.addEventListener('focusout', (e) => { if (!li.contains(e.relatedTarget)) birak(); });
  li.addEventListener('keydown', (e) => { if (e.key === 'Escape') birak(); });
  return li;
}

// Isıtma: ilk belge/tablo/sunum dosyası eklenince LibreOffice arka planda bir kez hazırlanır (ana süreç tek sefer).
const ISITMA_UZANTILARI = new Set(['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp']);
let isitmaIstendi = false;
function isitmaKontrol(yollar) {
  if (isitmaIstendi || !ozellikAcik('ozIsitma') || typeof api.isitmaIste !== 'function') return;
  if (!yollar.some((y) => ISITMA_UZANTILARI.has(uzAl(y)))) return;
  isitmaIstendi = true;
  api.isitmaIste().catch(() => {});
}

/* ---------- Durum ---------- */
const durum = {
  ayarlar: null,
  gecmis: [],
  sayfa: 'donustur',
  kategoriler: [],
  lo: { kurulu: true, yol: '' },
  cal: { kurulu: true, yol: '' },
  sekme: {},          // sayfa -> seçili araç
  sekmeOnceki: {},    // sayfa -> önceki seçili sekmenin konumu (kayan gösterge animasyonu için)
  yerel: {},         // 'sayfa/arac' -> { dosyalar:[], hedef, secenekler:{} }
  oto: { dosyalar: [], gruplar: {}, algilanan: {} }   // Dönüştür sayfası: bırakılan dosyalar, grup kimliği -> { hedef, secenekler }, yol -> imzadan biçim
};

const KATEGORI_BASLIK = {
  video: ['Video', 'Video dosyalarını başka biçimlere çevir, sesini çıkar, kırp ya da GIF yap.'],
  ses: ['Ses', 'Ses dosyalarını dönüştür. İstersen kapak görseliyle videoya çevir.'],
  gorsel: ['Görsel', 'Görselleri başka biçimlere çevir, boyutlandır ya da PDF yap.'],
  belge: ['Belge', 'Word, ODT, RTF, TXT, HTML, Markdown ve PDF belgelerini birbirine çevir.'],
  ekitap: ['E-kitap', 'EPUB, MOBI, AZW3 ve FB2 e-kitaplarını birbirine, PDF, Word, TXT, RTF ya da HTMLZ\'ye çevir; Word, ODT, RTF, TXT ve HTML belgelerinden e-kitap yap.'],
  tablo: ['Tablo', 'Excel, ODS ve CSV tablolarını dönüştür.'],
  sunum: ['Sunum', 'PowerPoint ve ODP sunumlarını dönüştür ya da PDF yap.'],
  pdf: ['PDF Araçları', 'PDF birleştir, böl, döndür; görsellerden PDF üret; PDF\'yi Word, görsel ya da metne çevir.'],
  veri: ['Veri', 'JSON, CSV, TSV, YAML ve XML arasında dönüştür.'],
  arsiv: ['Arşiv', 'ZIP oluştur ya da aç, GZIP ile sıkıştır.']
};
const LO_KATEGORILERI = ['belge', 'ekitap', 'tablo', 'sunum'];

const KALITE_SECENEKLERI = [['', 'Varsayılan'], ['yuksek', 'Yüksek'], ['orta', 'Orta'], ['kucuk', 'Küçük dosya']];
// Belge/tablo/sunum -> PDF hedefinde görünen alanlar (yalnız hedef pdf iken)
const PDF_ALANLARI = [
  { anahtar: 'pdfa', etiket: 'PDF/A (arşiv)', tip: 'onay', goster: (hedef) => hedef === 'pdf' },
  { anahtar: 'pdfKalite', etiket: 'PDF kalitesi', tip: 'select', varsayilan: 'orta', secenekler: [['dusuk', 'Düşük'], ['orta', 'Orta'], ['yuksek', 'Yüksek']], goster: (hedef) => hedef === 'pdf' }
];
const KALITE = { anahtar: 'kalite', etiket: 'Kalite', tip: 'select', secenekler: KALITE_SECENEKLERI };
const GENISLIK = (e) => ({ anahtar: 'genislik', etiket: e || 'Genişlik (piksel)', tip: 'number', yer: 'ör. 1280', min: 16, max: 16000 });

/* Her sayfa bir ya da birkaç "araç" içerir. */
const ARACLAR = {
  video: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', '3gp', 'ts', 'ogv'], coklu: true, hedefTipi: 'katalog',
    alanlar: [
      KALITE,
      { anahtar: 'baslangic', etiket: 'Kırpma başlangıcı', tip: 'text', yer: 'ss:dd:sn (ör. 00:00:05)' },
      { anahtar: 'bitis', etiket: 'Kırpma bitişi', tip: 'text', yer: 'ss:dd:sn (ör. 00:01:00)' },
      GENISLIK(),
      { anahtar: 'fps', etiket: 'GIF kare hızı (fps)', tip: 'number', yer: 'ör. 12', min: 1, max: 60, goster: (hd) => hd === 'gif' }
    ]
  }],
  ses: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'ac3', 'mp2'], coklu: true, hedefTipi: 'katalog',
    alanlar: [
      KALITE,
      { anahtar: 'kapakGorseli', etiket: 'Kapak görseli (videoya çevirirken)', tip: 'gorselSec', goster: (hd, hedefBilgi) => hedefBilgi && hedefBilgi.kategori === 'video' }
    ]
  }],
  gorsel: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif', 'gif', 'bmp', 'ico', 'svg'], coklu: true, hedefTipi: 'katalog',
    alanlar: [KALITE, GENISLIK()]
  }],
  belge: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm', 'md', 'pdf'], coklu: true, hedefTipi: 'katalog', alanlar: PDF_ALANLARI
  }],
  ekitap: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['epub', 'mobi', 'azw3', 'fb2', 'htmlz', 'docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm'], coklu: true, hedefTipi: 'katalog',
    aciklama: 'EPUB yazma LibreOffice ile, diğer e-kitap biçimleri programla gelen Calibre ile yapılır. DRM (kopya koruması) olan kitaplar dönüştürülemez.', alanlar: []
  }],
  tablo: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['xlsx', 'xls', 'ods', 'csv'], coklu: true, hedefTipi: 'katalog', alanlar: PDF_ALANLARI
  }],
  sunum: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['pptx', 'ppt', 'odp'], coklu: true, hedefTipi: 'katalog', alanlar: PDF_ALANLARI
  }],
  veri: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['json', 'csv', 'tsv', 'yaml', 'yml', 'xml'], coklu: true, hedefTipi: 'katalog', alanlar: []
  }],
  pdf: [
    { id: 'birlestir', ad: 'Birleştir', kabul: ['pdf'], coklu: true, sirali: true, en: 2, hedefTipi: 'sabit', hedef: 'birlestir', tekIs: true, dugme: 'PDF\'leri birleştir',
      aciklama: 'Listedeki sırayla tek bir PDF\'de birleştirilir. Sırayı okların yardımıyla değiştirebilirsin.', alanlar: [] },
    { id: 'bol', ad: 'Böl', kabul: ['pdf'], coklu: false, hedefTipi: 'sabit', hedef: 'bol', dugme: 'PDF\'yi böl',
      aciklama: 'Seçtiğin sayfa aralığını ayrı bir PDF olarak çıkarır.',
      alanlar: [{ anahtar: 'sayfalar', etiket: 'Sayfa aralığı', tip: 'text', yer: 'ör. 1-3,5', gerekli: true }] },
    { id: 'dondur', ad: 'Döndür', kabul: ['pdf'], coklu: false, hedefTipi: 'sabit', hedef: 'dondur', dugme: 'PDF\'yi döndür',
      aciklama: 'Sayfa aralığını boş bırakırsan tüm sayfalar döner.',
      alanlar: [
        { anahtar: 'aci', etiket: 'Açı', tip: 'select', secenekler: [['90', '90° (saat yönünde)'], ['180', '180°'], ['270', '270° (saat yönünün tersine)']], varsayilan: '90' },
        { anahtar: 'sayfalar', etiket: 'Sayfa aralığı (isteğe bağlı)', tip: 'text', yer: 'ör. 1-3,5' }
      ] },
    { id: 'gorsel-pdf', ad: 'Görsel → PDF', kabul: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'tif', 'gif', 'bmp'], coklu: true, sirali: true, en: 1, hedefTipi: 'sabit', hedef: 'gorsel-pdf', tekIs: true, dugme: 'PDF oluştur',
      aciklama: 'Görseller listedeki sırayla tek bir PDF\'ye eklenir.', alanlar: [] },
    { id: 'pdf-word', ad: 'PDF → Word', kabul: ['pdf'], coklu: true, hedefTipi: 'sabit', hedef: 'docx', dugme: 'Word\'e çevir', lo: true,
      aciklama: 'LibreOffice ile düzenlenebilir bir Word (.docx) belgesine çevrilir. Karmaşık düzenler birebir korunmayabilir.', alanlar: [] },
    { id: 'pdf-gorsel', ad: 'PDF → Görsel', kabul: ['pdf'], coklu: true, yerel: 'gorsel', dugme: 'Görsele çevir',
      aciklama: 'Her sayfa ayrı bir görsel olarak kaydedilir.',
      alanlar: [
        { anahtar: 'bicim', etiket: 'Biçim', tip: 'select', secenekler: [['png', 'PNG'], ['jpg', 'JPG']], varsayilan: 'png' },
        { anahtar: 'olcek', etiket: 'Ölçek', tip: 'select', secenekler: [['1', '1x (hızlı)'], ['1.5', '1,5x'], ['2', '2x (keskin)'], ['3', '3x (çok keskin)']], varsayilan: '2' },
        { anahtar: 'sayfalar', etiket: 'Sayfa aralığı (isteğe bağlı)', tip: 'text', yer: 'ör. 1-3,5' }
      ] },
    { id: 'pdf-metin', ad: 'PDF → Metin', kabul: ['pdf'], coklu: true, yerel: 'metin', dugme: 'Metne çevir',
      aciklama: 'PDF içindeki seçilebilir metin .txt dosyasına çıkarılır. Taranmış (görsel) PDF\'lerde metin bulunmaz.',
      alanlar: [{ anahtar: 'sayfalar', etiket: 'Sayfa aralığı (isteğe bağlı)', tip: 'text', yer: 'ör. 1-3,5' }] }
  ],
  arsiv: [
    { id: 'zip', ad: 'ZIP oluştur', kabul: null, coklu: true, hedefTipi: 'sabit', hedef: 'zip', tekIs: true, dugme: 'ZIP oluştur',
      aciklama: 'Seçtiğin dosyalar tek bir .zip içine konur.', alanlar: [] },
    { id: 'zip-ac', ad: 'ZIP aç', kabul: ['zip'], coklu: true, hedefTipi: 'sabit', hedef: 'zip-ac', dugme: 'ZIP\'i aç',
      aciklama: 'İçindekiler çıktı klasöründe yeni bir klasöre çıkarılır. Güvenli olmayan yollar reddedilir.', alanlar: [] },
    { id: 'gz', ad: 'GZIP sıkıştır', kabul: null, coklu: true, hedefTipi: 'sabit', hedef: 'gz', dugme: 'GZIP ile sıkıştır',
      aciklama: 'Her dosya ayrı bir .gz dosyasına sıkıştırılır.', alanlar: [] },
    { id: 'gz-ac', ad: 'GZ aç', kabul: ['gz'], coklu: true, hedefTipi: 'sabit', hedef: 'gz-ac', dugme: 'GZ\'yi aç',
      aciklama: '.gz dosyaları açılır.', alanlar: [] }
  ]
};

/* ---------- Kuyruk ---------- */
const ROZET = { bekliyor: 'Bekliyor', calisiyor: 'Dönüştürülüyor', bitti: 'Bitti', hata: 'Hata', iptal: 'İptal' };
const isler = new Map();      // id -> { ad, durum, yuzde, ciktilar, hata, el }

function kuyrukSayaciniGuncelle() {
  document.getElementById('kuyruk-sayac').textContent = String(isler.size);
  document.getElementById('kuyruk-bos').hidden = isler.size > 0;
}

function isElemani(id, o) {
  const dolgu = h('div', { sinif: 'ilerleme-dolgu' });
  const bar = h('div', { sinif: 'ilerleme', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': (o.ad || 'Dosya') + ' ilerlemesi' }, dolgu);
  const yuzde = h('span', { sinif: 'is-yuzde' });
  const rozet = h('span', { sinif: 'rozet' });
  const ad = h('div', { sinif: 'is-ad' });
  const eylem = h('div', { sinif: 'is-eylem' });
  const hata = h('div', { sinif: 'is-hata', hidden: true });
  const sure = h('span', { sinif: 'is-sure', title: 'Geçen süre' });
  const boyut = h('span', { sinif: 'is-sure is-boyut', title: 'Önce → sonra boyut' });
  const el = h('li', { sinif: 'is-oge' }, ad, eylem, h('div', { sinif: 'is-alt' }, bar, yuzde, boyut, sure, rozet), hata);
  o.el = el; o.refs = { dolgu, bar, yuzde, rozet, ad, eylem, hata, sure, boyut };
  return el;
}

// Bitti rozetinde çizilen onay işareti (CSS ile 420 ms'de çizilir)
function tikSimgesi() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('tik');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7');
  svg.append(p);
  return svg;
}

// 2,1 MB / 480 KB biçimi (Türkçe ondalık virgül)
function boyutMetni(b) {
  if (!Number.isFinite(b) || b < 0) return '';
  if (b < 1024) return Math.round(b) + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  const mb = b / (1024 * 1024);
  if (mb < 1024) return mb.toFixed(1).replace('.', ',') + ' MB';
  return (mb / 1024).toFixed(2).replace('.', ',') + ' GB';
}
const boyutlarMetni = (b) => (b && Number.isFinite(b.girdi) && Number.isFinite(b.cikti)) ? boyutMetni(b.girdi) + ' → ' + boyutMetni(b.cikti) : '';

const sureMetni = (ms) => {
  const sn = Math.max(0, Math.round(ms / 1000));
  return sn < 60 ? `${sn} sn` : `${Math.floor(sn / 60)} dk ${String(sn % 60).padStart(2, '0')} sn`;
};

// Kalan süre tahmini (saf işlev; test için işaretli blok): %10 altı ve ilk 3 sn'de boş döner.
// TAHMIN-BASLA
function tahminMetni(baslangic, yuzde, simdi) {
  if (!baslangic || !Number.isFinite(yuzde) || yuzde < 10 || yuzde >= 100) return '';
  const gecen = simdi - baslangic;
  if (!(gecen >= 3000)) return '';
  const kalan = Math.max(1, Math.round(gecen * (100 - yuzde) / yuzde / 1000));
  return kalan < 120 ? `~${kalan} sn` : `~${Math.round(kalan / 60)} dk`;
}
// TAHMIN-BITIS

function isCiz(id) {
  const o = isler.get(id);
  if (!o) return;
  if (!o.el) {
    const el = isElemani(id, o);
    document.getElementById('kuyruk-liste').prepend(el);
  }
  const r = o.refs;
  o.el.dataset.durum = o.durum;
  r.ad.textContent = o.ad || 'Dosya';
  r.ad.title = o.ad || '';
  const y = Math.max(0, Math.min(100, Math.round(o.durum === 'bitti' ? 100 : (o.yuzde || 0))));
  r.dolgu.style.width = (o.durum === 'calisiyor' && y === 0 ? 4 : y) + '%';
  r.bar.setAttribute('aria-valuenow', String(y));
  r.bar.setAttribute('aria-valuetext', `${y}% · ${ROZET[o.durum] || o.durum}`);
  r.bar.setAttribute('aria-label', (o.ad || 'Dosya') + ' ilerlemesi');
  r.yuzde.textContent = y + '%';
  r.rozet.replaceChildren(o.durum === 'bitti' ? tikSimgesi() : null, ROZET[o.durum] || o.durum);
  r.rozet.className = 'rozet ' + o.durum;
  const tahmin = o.durum === 'calisiyor' ? tahminMetni(o.baslangic, o.yuzde, Date.now()) : '';
  r.sure.textContent = o.sure != null ? sureMetni(o.sure) : tahmin;
  r.sure.title = tahmin ? 'Tahmini kalan süre' : 'Geçen süre';
  r.boyut.textContent = o.durum === 'bitti' ? boyutlarMetni(o.boyutlar) : '';
  r.hata.hidden = !(o.durum === 'hata' && o.hata);
  r.hata.textContent = o.hata || '';
  r.eylem.replaceChildren();
  if (o.durum === 'bekliyor' || o.durum === 'calisiyor') {
    r.eylem.append(h('button', { sinif: 'dugme tehlike kucuk', type: 'button', onclick: () => api.iptal(id).catch((e) => bildir(hataMetni(e), true)) }, 'İptal'));
  }
  if (o.durum === 'hata' || o.durum === 'iptal') {
    r.eylem.append(h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: (e) => yenidenDene(id, e.currentTarget) }, 'Yeniden dene'));
  }
  if (o.durum === 'bitti' && o.ciktilar && o.ciktilar.length) {
    if (o.ciktilar.length === 1) r.eylem.append(h('button', { sinif: 'dugme birincil kucuk', type: 'button', title: o.ciktilar[0], onclick: () => ciktiyiAc(o.ciktilar[0]) }, 'Aç'));
    r.eylem.append(h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => klasordeGoster(o.ciktilar[0]) }, 'Klasörde göster'));
  }
  kuyrukSayaciniGuncelle();
}

async function yenidenDene(id, dugme) {
  const eski = isler.get(id);
  if (dugme) dugme.disabled = true;
  try {
    const r = await api.isYenidenDene(id);
    let o = isler.get(r.id);
    if (!o) { o = { durum: 'bekliyor', yuzde: 0, ciktilar: [] }; isler.set(r.id, o); }
    o.ad = r.ad; o.hedef = (eski && eski.hedef) || '';
    isCiz(r.id);
    bildir('İş yeniden kuyruğa eklendi.');
  } catch (e) {
    if (dugme) dugme.disabled = false;
    bildir(hataMetni(e), true);
  }
}

function klasordeGoster(yol) {
  api.klasordeGoster(yol).catch((e) => bildir(hataMetni(e), true));
}
function ciktiyiAc(yol) {
  api.ciktiyiAc(yol).catch((e) => bildir(hataMetni(e), true));
}

function durumGeldi(d) {
  if (!d || typeof d.id !== 'string') return;
  let o = isler.get(d.id);
  if (!o) { o = { ad: '', durum: 'bekliyor', yuzde: 0, ciktilar: [] }; isler.set(d.id, o); }
  if (d.durum) o.durum = d.durum;
  if (typeof d.yuzde === 'number') o.yuzde = d.yuzde;
  if (Array.isArray(d.ciktilar) && d.ciktilar.length) o.ciktilar = d.ciktilar;
  if (d.hata) o.hata = d.hata;
  if (d.boyutlar && typeof d.boyutlar === 'object') o.boyutlar = d.boyutlar;
  if (d.durum === 'calisiyor' && !o.baslangic) o.baslangic = Date.now();
  if (['bitti', 'hata', 'iptal'].includes(d.durum) && o.baslangic && o.sure == null) o.sure = Date.now() - o.baslangic;
  isCiz(d.id);
  if (['bitti', 'hata', 'iptal'].includes(d.durum)) {
    bildir(`${o.ad || 'Dosya'}: ${ROZET[d.durum]}`, d.durum === 'hata');
    durum.gecmis.unshift({ id: d.id, ad: o.ad, hedef: o.hedef || '', durum: d.durum, ciktilar: o.ciktilar, hata: o.hata || '', zaman: Date.now() });
    durum.gecmis = durum.gecmis.slice(0, 200);
    if (durum.sayfa === 'gecmis') sayfayiCiz();
  }
}

/* ---------- Dosya ekleme ---------- */
function yerelDurum(sayfa, arac) {
  const k = sayfa + '/' + arac.id;
  if (!durum.yerel[k]) durum.yerel[k] = { dosyalar: [], hedef: null, secenekler: {}, sonuclar: [] };
  return durum.yerel[k];
}

function kabulEdilir(arac, yol) {
  return !arac.kabul || arac.kabul.includes(uzAl(yol));
}

function dosyalariEkle(sayfa, arac, yollar) {
  const y = yerelDurum(sayfa, arac);
  let atlanan = 0;
  for (const yol of yollar) {
    if (!kabulEdilir(arac, yol)) { atlanan++; continue; }
    if (y.dosyalar.includes(yol)) continue;
    if (!arac.coklu) y.dosyalar = [];
    y.dosyalar.push(yol);
  }
  if (atlanan) bildir(`${atlanan} dosya bu sayfada desteklenmediği için atlandı.`, true);
  y.hedef = null;
  sayfayiCiz();
  bicimleriAlgila(y.dosyalar);
  isitmaKontrol(y.dosyalar);
}

async function dosyaSec(sayfa, arac) {
  try {
    const yollar = await api.dosyaSec(sayfa, arac.coklu);
    if (yollar.length) dosyalariEkle(sayfa, arac, yollar);
  } catch (e) { bildir(hataMetni(e), true); }
}

async function yollariAl(dosyalar) {
  const yollar = [];
  const hatalar = [];
  for (const f of dosyalar) {
    try { yollar.push(await api.yolAl(f)); } catch (e) { hatalar.push([`"${f.name}" eklenemedi`, hataMetni(e)]); }
  }
  hatalariBildir(hatalar);
  return yollar;
}

async function birakildi(sayfa, arac, dosyalar) {
  const yollar = await yollariAl(dosyalar);
  if (yollar.length) dosyalariEkle(sayfa, arac, yollar);
}

/* ---------- Hedefler ---------- */
const hedefOnbellek = new Map();
async function hedefleriBul(uzantilar) {
  let ortak = null;
  for (const u of [...new Set(uzantilar)]) {
    if (!hedefOnbellek.has(u)) hedefOnbellek.set(u, await api.hedefler(u));
    const liste = hedefOnbellek.get(u);
    ortak = ortak === null ? liste.slice() : ortak.filter((a) => liste.some((b) => b.hedef === a.hedef));
  }
  return ortak || [];
}

/* ---------- Sayfa çizimi ---------- */
const sayfaKutu = () => document.getElementById('sayfa');

function menuyuGuncelle() {
  document.querySelectorAll('.menu-oge').forEach((b) => {
    const etkin = b.dataset.sayfa === durum.sayfa;
    b.classList.toggle('etkin', etkin);
    if (b.toggleAttribute('aria-current', etkin)) b.setAttribute('aria-current', 'page');
  });
}

function sayfayiGit(ad) {
  durum.sayfa = ad;
  menuyuGuncelle();
  if (ad === 'gecmis') gecmisiYenile();
  sayfayiCiz().then(() => { if (durum.sayfa === ad) sayfaKutu().focus({ preventScroll: true }); });
  sayfaKutu().scrollTop = 0;
}

let cizimSirasi = 0;
async function sayfayiCiz() {
  const sira = ++cizimSirasi;
  onizlemeKapat();
  const s = durum.sayfa;
  let icerik;
  try {
    if (s === 'donustur') icerik = await donusturSayfasi();
    else if (ARACLAR[s]) icerik = await kategoriSayfasi(s);
    else if (s === 'gecmis') icerik = gecmisSayfasi();
    else if (s === 'ayarlar') icerik = ayarlarSayfasi();
    else icerik = hakkindaSayfasi();
  } catch (e) {
    icerik = h('div', { sinif: 'bilgi' }, h('p', { metin: 'Sayfa yüklenemedi: ' + hataMetni(e) }));
  }
  if (sira !== cizimSirasi) return;
  const odak = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.odak : null;
  sayfaKutu().replaceChildren(h('div', { sinif: 'sayfa-ic' }, icerik));
  if (odak) { const e = sayfaKutu().querySelector(`[data-odak="${CSS.escape(odak)}"]`); if (e) e.focus(); }
  sekmeGostergesiniYerlestir();
}

// Sekme göstergesi: koyu hap, önceki sekmeden yenisine kayar. Ön kenar önce, arka kenar 70 ms gecikmeli
// (data-yon ile CSS'te); ilk çizimde ya da hareket azaltmada anında yerleşir.
function sekmeKonumu(e) {
  return e ? { sol: e.offsetLeft, ust: e.offsetTop, gen: e.offsetWidth, yuk: e.offsetHeight } : null;
}
function sekmeGostergesiniYerlestir() {
  const kutu = sayfaKutu().querySelector('.sekmeler');
  if (!kutu) return;
  const g = kutu.querySelector('.sekme-gosterge');
  const etkin = kutu.querySelector('.sekme.etkin');
  if (!g || !etkin) return;
  const hedef = sekmeKonumu(etkin);
  const yerlestir = (k) => {
    g.style.setProperty('--sol', k.sol + 'px'); g.style.setProperty('--ust', k.ust + 'px');
    g.style.setProperty('--gen', k.gen + 'px'); g.style.setProperty('--yuk', k.yuk + 'px');
  };
  const onceki = durum.sekmeOnceki[kutu.dataset.sayfa];
  delete durum.sekmeOnceki[kutu.dataset.sayfa];
  g.classList.add('aninda');
  yerlestir(onceki || hedef);
  void g.offsetWidth; // geçişsiz başlangıç konumunu uygula
  g.classList.remove('aninda');
  if (!onceki || onceki.ust !== hedef.ust) { yerlestir(hedef); return; }
  g.dataset.yon = hedef.sol > onceki.sol ? 'sag' : 'sol';
  requestAnimationFrame(() => yerlestir(hedef));
}

function calBilgiKutusu() {
  return h('div', { sinif: 'bilgi' },
    h('p', {}, h('strong', {}, durum.cal.durum === 'dogrulanamadi' ? 'Calibre doğrulanamadı. ' : 'Calibre bulunamadı. '),
      durum.cal.durum === 'dogrulanamadi'
        ? 'Programla gelen ebook-convert.exe dosyasının "Kovid Goyal" imzası geçerli değil, bu yüzden kullanılmıyor. Programı yeniden kurun.'
        : 'E-kitap dönüştürücü (Calibre) programla birlikte gelmeliydi. Programı yeniden kurun; EPUB yazma LibreOffice ile çalışmaya devam eder.'));
}

function loBilgiKutusu() {
  return h('div', { sinif: 'bilgi' },
    durum.lo.durum === 'dogrulanamadi'
      ? h('p', {}, h('strong', {}, 'LibreOffice doğrulanamadı. '),
        'Bulunan soffice.exe dosyasının "The Document Foundation" imzası geçerli değil, bu yüzden kullanılmıyor. Resmî LibreOffice\'i kurun ya da Ayarlar sayfasından imzalı bir soffice.exe seçin.')
      : h('p', {}, h('strong', {}, 'LibreOffice bulunamadı. '),
      'Belge, tablo ve sunum dönüştürmeleri için bilgisayarında ücretsiz LibreOffice kurulu olmalı. Kurduktan sonra program otomatik bulur; farklı bir yere kurduysan Ayarlar sayfasından soffice.exe dosyasını seçebilirsin.'),
    h('button', { sinif: 'dugme birincil', type: 'button', onclick: () => api.libreofficeIndirmeSayfasi().catch((e) => bildir(hataMetni(e), true)) }, 'İndirme sayfasını aç'));
}

/* ---------- Dönüştür (otomatik tanıma) ---------- */
// Kullanıcı tür seçmez: bırakılan her dosya uzantısından tanınır, çevrilebileceği biçimler gösterilir.
const bicimOnbellek = new Map();
async function bicimBilgisi(uzanti) {
  if (!bicimOnbellek.has(uzanti)) bicimOnbellek.set(uzanti, await api.bicimBilgi(uzanti));
  return bicimOnbellek.get(uzanti);
}
const katBilgi = (id) => durum.kategoriler.find((k) => k.id === id) || { id, ad: id, simge: '📄' };
// Hedef biçimlerin ayarları (kalite, kırpma, boyut...) kaynağın kategorisindeki "Dönüştür" aracından gelir
const kategoriAlanlari = (kat) => (kat !== 'pdf' && kat !== 'arsiv' && ARACLAR[kat] && ARACLAR[kat][0].alanlar) || [];

function otoGrupDurumu(gid) {
  if (!durum.oto.gruplar[gid]) durum.oto.gruplar[gid] = { hedef: null, secenekler: {} };
  return durum.oto.gruplar[gid];
}

function otoEkle(yollar) {
  let eklenen = 0;
  for (const yol of yollar) {
    if (durum.oto.dosyalar.includes(yol)) continue;
    durum.oto.dosyalar.push(yol);
    eklenen++;
  }
  if (eklenen) sayfayiCiz();
  bicimleriAlgila(yollar);
  isitmaKontrol(yollar);
}

// İmzadan biçim algılama (1.9.0): sonuç durum.oto.algilanan'da; uzantıyla uyuşmayan varsa sayfa yeniden çizilir.
function bicimleriAlgila(yollar) {
  if (typeof api.bicimAlgila !== 'function' || !ozellikAcik('ozBicimAlgila')) return;
  const yeni = yollar.filter((y) => !(y in durum.oto.algilanan));
  if (!yeni.length) return;
  Promise.allSettled(yeni.map((y) => api.bicimAlgila(y).then((r) => { durum.oto.algilanan[y] = r; return r; }))).then((sonuc) => {
    if (sonuc.some((x) => x.status === 'fulfilled' && x.value && x.value.bicim && !x.value.uyusuyor)) sayfayiCiz();
  });
}
function algilananEtiketi(yol) {
  const r = durum.oto.algilanan[yol];
  if (!r || !r.bicim || r.uyusuyor || !ozellikAcik('ozBicimAlgila')) return null;
  return h('span', { sinif: 'algilanan', metin: `Algılanan: ${r.bicim.toUpperCase()} (uzantı .${r.uzanti || '?'})` });
}

async function otoSec() {
  try {
    const yollar = await api.dosyaSec('tum', true);
    if (yollar.length) otoEkle(yollar);
  } catch (e) { bildir(hataMetni(e), true); }
}

// Ctrl+V (1.9.0): panodaki dosyalar bırakma yoluyla, yolu olmayan PNG görüntü (ekran görüntüsü) geçici dosya olarak eklenir.
async function panoYapistir(e) {
  if (!ozellikAcik('ozPano')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const cd = e.clipboardData;
  if (!cd) return;
  let dosyalar = Array.from(cd.files || []);
  if (!dosyalar.length) dosyalar = Array.from(cd.items || []).filter((x) => x.kind === 'file').map((x) => x.getAsFile()).filter(Boolean);
  if (!dosyalar.length) return;
  e.preventDefault();
  const yolVar = (f) => typeof api.dosyaYolu === 'function' && !!api.dosyaYolu(f);
  const yollu = dosyalar.filter(yolVar);
  const gorsel = dosyalar.find((f) => !yolVar(f) && /^image\//.test(f.type));
  if (durum.sayfa !== 'donustur' && (yollu.length || gorsel)) sayfayiGit('donustur');
  if (yollu.length) await otoBirakildi(yollu);
  if (!yollu.length && gorsel) {
    try {
      if (gorsel.type !== 'image/png') throw new Error('Panodaki görüntü PNG değil.');
      if (gorsel.size > 50 * 1024 * 1024) throw new Error('Panodaki görüntü 50 MB sınırını aşıyor.');
      const yol = await api.panoGorseliKaydet(new Uint8Array(await gorsel.arrayBuffer()));
      otoEkle([yol]);
      bildir('Panodan görüntü alındı');
    } catch (err) { bildir(hataMetni(err), true); }
  }
}

async function otoBirakildi(dosyalar) {
  const yollar = await yollariAl(dosyalar);
  if (yollar.length) otoEkle(yollar);
}

// Dosyaları kaynak kategorisine göre gruplar; bir grubun ortak hedefi yoksa uzantıya göre bölünür.
async function otoGruplariKur() {
  const tanimsiz = [];
  const kategoriye = new Map();
  for (const yol of durum.oto.dosyalar) {
    const b = await bicimBilgisi(uzAl(yol));
    if (!b.kategori) { tanimsiz.push(yol); continue; }
    if (!kategoriye.has(b.kategori)) kategoriye.set(b.kategori, []);
    kategoriye.get(b.kategori).push({ yol, uzanti: b.uzanti, ad: b.ad });
  }
  const gruplar = [];
  for (const [kat, ogeler] of kategoriye) {
    const uzantilar = [...new Set(ogeler.map((o) => o.uzanti))];
    const ortak = await hedefleriBul(uzantilar);
    if (ortak.length || uzantilar.length === 1) {
      gruplar.push({ id: kat, kat, ogeler, hedefler: ortak });
    } else {
      for (const u of uzantilar) {
        gruplar.push({ id: kat + ':' + u, kat, ogeler: ogeler.filter((o) => o.uzanti === u), hedefler: await hedefleriBul([u]) });
      }
    }
  }
  return { gruplar, tanimsiz };
}

function otoGrupKarti(g) {
  const gs = otoGrupDurumu(g.id);
  if (gs.hedef && !g.hedefler.some((x) => x.hedef === gs.hedef)) gs.hedef = null;
  if (!gs.hedef && g.hedefler.length === 1) gs.hedef = g.hedefler[0].hedef;
  if (!gs.hedef) { const son = sonHedefAl('oto/' + g.id); if (son && g.hedefler.some((x) => x.hedef === son)) gs.hedef = son; }
  const hedefBilgi = g.hedefler.find((x) => x.hedef === gs.hedef) || null;
  const kb = katBilgi(g.kat);
  const baslikId = 'grup-' + g.id.replace(/[^a-z0-9]/gi, '-');
  const kart = [
    h('h3', { metin: `${kb.simge} ${kb.ad} · ${g.ogeler.length} dosya` }),
    h('ul', { sinif: 'dosya-liste' }, g.ogeler.map((o, i) => onizlemeBagla(h('li', { sinif: 'dosya-oge' },
      h('span', { sinif: 'dosya-uz', metin: o.uzanti || '?' }),
      h('span', { sinif: 'dosya-ad', title: o.yol, metin: adAl(o.yol) }),
      h('span', { sinif: 'ipucu', metin: o.ad || '' }),
      h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Listeden çıkar', 'aria-label': 'Listeden çıkar', 'data-odak': `cikar-${g.id}-${i}`, onclick: () => { durum.oto.dosyalar = durum.oto.dosyalar.filter((x) => x !== o.yol); sayfayiCiz(); } }, '✕'),
      algilananEtiketi(o.yol)), o.yol)))
  ];
  if (!g.hedefler.length) {
    kart.push(h('p', { sinif: 'ipucu', metin: 'Bu dosyaların çevrilebileceği ortak bir biçim yok. Farklı türleri ayrı ayrı bırak.' }));
  } else {
    kart.push(h('h3', { sinif: 'alt-baslik', id: baslikId, metin: 'Çevirebileceğin biçimler' }));
    const bolumler = new Map();
    for (const x of g.hedefler) {
      if (!bolumler.has(x.kategori)) bolumler.set(x.kategori, []);
      bolumler.get(x.kategori).push(x);
    }
    for (const [k, liste] of bolumler) {
      if (bolumler.size > 1) kart.push(h('p', { sinif: 'ipucu bolum', metin: katBilgi(k).ad }));
      kart.push(h('div', { sinif: 'cipler', 'aria-labelledby': baslikId }, liste.map((x) =>
        h('button', { sinif: 'cip' + (x.hedef === gs.hedef ? ' secili' : ''), type: 'button', 'aria-pressed': String(x.hedef === gs.hedef),
          'data-odak': `cip-${g.id}-${x.hedef}`, title: x.etiket, onclick: () => { gs.hedef = x.hedef; sonHedefYaz('oto/' + g.id, x.hedef); sayfayiCiz(); } }, x.etiket || x.hedef.toUpperCase()))));
    }
    if (g.kat === 'pdf') {
      kart.push(h('p', { sinif: 'ipucu', metin: 'PDF\'yi görsele ya da metne çevirmek, birleştirmek, bölmek veya döndürmek için soldaki "PDF Araçları" sayfasını kullan.' }));
    }
  }
  // Tek PDF'de birleştir (1.9.0): grupta 2+ dosya ve hedef PDF iken; varsayılan işaretsiz
  if (tekPdfGoster(g, gs)) {
    const kimlik = 'tekpdf-' + g.id.replace(/[^a-z0-9]/gi, '-');
    const kutu = h('input', { id: kimlik, type: 'checkbox', checked: gs.tekPdf === true, 'data-odak': kimlik });
    kutu.addEventListener('change', () => { gs.tekPdf = kutu.checked; });
    kart.push(h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: kimlik }, kutu, ' Tek PDF\'de birleştir'),
      h('p', { sinif: 'ipucu', metin: 'Dosyalar sırayla tek bir PDF\'de toplanır; ara PDF\'ler Geri Dönüşüm Kutusu\'na taşınır.' })));
  }
  const alanlar = kategoriAlanlari(g.kat).filter((a) => !a.goster || a.goster(gs.hedef, hedefBilgi));
  if (gs.hedef && alanlar.length) {
    kart.push(h('h3', { sinif: 'alt-baslik', metin: 'Ayarlar' }),
      h('div', { sinif: 'alanlar' }, alanlar.map((a) => alanOlustur('oto-' + g.id.replace(/[^a-z0-9]/gi, '-'), { id: 'donustur' }, gs, a))));
  }
  return h('div', { sinif: 'kart' }, kart);
}

async function donusturSayfasi() {
  const parcalar = [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: 'Dönüştür' })),
    h('p', { sinif: 'sayfa-aciklama', metin: 'Herhangi bir dosyayı bırak. Türünü tanır, çevirebileceği biçimleri gösteririm; tür seçmen gerekmez.' })
  ];
  const bos = durum.oto.dosyalar.length === 0;
  const alan = h('div', { sinif: 'birakma' + (bos ? ' buyuk-alan' : ''), role: 'group', 'aria-label': 'Dosya bırakma alanı' },
    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3' })),
    h('strong', { metin: bos ? 'Dosyaları buraya sürükle' : 'Daha fazla dosya bırak' }),
    h('span', { metin: 'ya da' }),
    h('button', { sinif: 'dugme birincil', type: 'button', 'data-odak': 'sec', onclick: otoSec }, 'Dosya seç'));
  alan.addEventListener('dragover', (e) => { e.preventDefault(); alan.classList.add('uzerinde'); });
  alan.addEventListener('dragleave', () => alan.classList.remove('uzerinde'));
  alan.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); alan.classList.remove('uzerinde');
    sayfaKutu().classList.remove('surukle');
    birakilanDosyalar(e).then((dosyalar) => { if (dosyalar.length) otoBirakildi(dosyalar); });
  });
  parcalar.push(alan);
  svgDuzelt(alan);

  if (bos) {
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Neleri çevirebilirim?' }),
      h('ul', { sinif: 'tur-liste' }, ['video', 'ses', 'gorsel', 'belge', 'ekitap', 'tablo', 'sunum', 'pdf', 'veri', 'arsiv'].map((id) =>
        h('li', {}, h('strong', { metin: `${katBilgi(id).simge} ${katBilgi(id).ad}: ` }), h('span', { sinif: 'ipucu', metin: KATEGORI_BASLIK[id][1] }))))));
    return parcalar;
  }

  const { gruplar, tanimsiz } = await otoGruplariKur();
  if (gruplar.some((g) => ['belge', 'tablo', 'sunum', 'pdf', 'ekitap'].includes(g.kat)) && !durum.lo.kurulu) parcalar.push(loBilgiKutusu());
  if (gruplar.some((g) => g.kat === 'ekitap') && !durum.cal.kurulu) parcalar.push(calBilgiKutusu());

  for (const g of gruplar) parcalar.push(otoGrupKarti(g));

  if (tanimsiz.length) {
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: `Tanınmayan dosyalar (${tanimsiz.length})` }),
      h('p', { sinif: 'ipucu', metin: 'Bu dosya türleri desteklenmiyor, dönüştürülmeyecek.' }),
      h('ul', { sinif: 'dosya-liste' }, tanimsiz.map((yol) => h('li', { sinif: 'dosya-oge' },
        h('span', { sinif: 'dosya-uz', metin: uzAl(yol) || '?' }),
        h('span', { sinif: 'dosya-ad', title: yol, metin: adAl(yol) }),
        h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Listeden çıkar', 'aria-label': 'Listeden çıkar', 'data-odak': 'cikar-tanimsiz-' + yol, onclick: () => { durum.oto.dosyalar = durum.oto.dosyalar.filter((x) => x !== yol); sayfayiCiz(); } }, '✕'))))));
  }

  parcalar.push(ciktiKlasoruKarti());

  const eksik = gruplar.filter((g) => !otoGrupDurumu(g.id).hedef);
  const toplam = gruplar.reduce((t, g) => t + g.ogeler.length, 0);
  let neden = '';
  if (!gruplar.length) neden = 'Dönüştürülebilir dosya yok.';
  else if (eksik.length) neden = eksik.length === 1 ? `"${katBilgi(eksik[0].kat).ad}" dosyaları için bir biçim seç.` : 'Her dosya grubu için bir biçim seç.';
  parcalar.push(h('button', { sinif: 'dugme birincil buyuk', type: 'button', 'data-odak': 'donustur', disabled: !!neden, title: neden,
    onclick: (e) => gonder(e.currentTarget, () => otoDonustur(gruplar)) }, `Dönüştür (${toplam} dosya)`));
  if (neden) parcalar.push(h('p', { sinif: 'ipucu', metin: neden }));
  parcalar.push(h('div', { sinif: 'satir', 'data-bos': '1' }, h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => { durum.oto.dosyalar = []; durum.oto.gruplar = {}; sayfayiCiz(); } }, 'Listeyi temizle')));
  return parcalar;
}

const tekPdfGoster = (g, gs) => ozellikAcik('ozPdfBirlestir') && gs.hedef === 'pdf' && g.ogeler.length >= 2;

async function otoDonustur(gruplar) {
  let eklenen = 0;
  const hatalar = [];
  const bitenler = new Set();
  for (const g of gruplar) {
    const gs = otoGrupDurumu(g.id);
    const hedefBilgi = g.hedefler.find((x) => x.hedef === gs.hedef) || null;
    const secenekler = seceneklerHazirla({ alanlar: kategoriAlanlari(g.kat) }, gs, hedefBilgi);
    const tek = tekPdfGoster(g, gs) && gs.tekPdf === true;
    if (tek) secenekler.tekPdf = true;
    for (const ogeler of (tek ? [g.ogeler] : g.ogeler.map((o) => [o]))) {
      const o = ogeler[0];
      try {
        const r = await api.isEkle({ girdiler: ogeler.map((x) => x.yol), hedef: gs.hedef, ciktiKlasoru: durum.ayarlar.ciktiKlasoru, secenekler });
        let j = isler.get(r.id);
        if (!j) { j = { durum: 'bekliyor', yuzde: 0, ciktilar: [] }; isler.set(r.id, j); }
        j.ad = r.ad; j.hedef = gs.hedef;
        isCiz(r.id);
        eklenen++;
        ogeler.forEach((x) => bitenler.add(x.yol));
      } catch (e) { hatalar.push([adAl(o.yol), hataMetni(e)]); }
    }
  }
  hatalariBildir(hatalar);
  if (eklenen) {
    bildir(eklenen === 1 ? 'İş kuyruğa eklendi.' : `${eklenen} iş kuyruğa eklendi.`);
    durum.oto.dosyalar = durum.oto.dosyalar.filter((x) => !bitenler.has(x));
    for (const g of gruplar) { const gs = otoGrupDurumu(g.id); gs.hedef = null; gs.tekPdf = false; }
    sayfayiCiz();
  }
  return eklenen > 0;
}

async function kategoriSayfasi(s) {
  const araclar = ARACLAR[s];
  const [baslik, aciklama] = KATEGORI_BASLIK[s];
  const secili = araclar.find((a) => a.id === durum.sekme[s]) || araclar[0];
  durum.sekme[s] = secili.id;
  const y = yerelDurum(s, secili);

  const parcalar = [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: baslik })),
    h('p', { sinif: 'sayfa-aciklama', metin: aciklama })
  ];

  const sekmeId = (a) => `sekme-${s}-${a.id}`;
  const panelId = 'sekme-panel-' + s;
  if (araclar.length > 1) {
    const kutu = h('div', { sinif: 'sekmeler', role: 'tablist', 'aria-label': baslik, 'data-sayfa': s }, h('div', { sinif: 'sekme-gosterge', 'aria-hidden': 'true' }), araclar.map((a) =>
      h('button', { sinif: 'sekme' + (a.id === secili.id ? ' etkin' : ''), type: 'button', role: 'tab', 'aria-selected': String(a.id === secili.id),
        id: sekmeId(a), 'aria-controls': panelId, tabindex: a.id === secili.id ? '0' : '-1', 'data-odak': 'sekme-' + a.id,
        onclick: () => { if (a.id === durum.sekme[s]) return; durum.sekmeOnceki[s] = sekmeKonumu(kutu.querySelector('.sekme.etkin')); durum.sekme[s] = a.id; sayfayiCiz(); } }, a.ad)));
    // Ok tuşları / Home / End ile sekme değiştir (yeni sekme odaklanır, çizim sonrası odak data-odak ile geri gelir)
    kutu.addEventListener('keydown', (e) => {
      const dugmeler = Array.from(kutu.querySelectorAll('.sekme'));
      const i = araclar.findIndex((a) => a.id === durum.sekme[s]);
      const n = araclar.length;
      const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      dugmeler[j].focus();
      dugmeler[j].click();
    });
    parcalar.push(kutu);
  }
  const panel = [];
  if (secili.aciklama) panel.push(h('p', { sinif: 'ipucu', metin: secili.aciklama }));

  const loGerekli = LO_KATEGORILERI.includes(s) || secili.lo;
  if (loGerekli && !durum.lo.kurulu) panel.push(loBilgiKutusu());
  if (s === 'ekitap' && !durum.cal.kurulu) panel.push(calBilgiKutusu());

  // Bırakma alanı
  const alan = h('div', { sinif: 'birakma', role: 'group', 'aria-label': 'Dosya bırakma alanı' },
    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3' })),
    h('strong', { metin: secili.coklu ? 'Dosyaları buraya sürükle' : 'Dosyayı buraya sürükle' }),
    h('span', { metin: 'ya da' }),
    h('button', { sinif: 'dugme birincil', type: 'button', 'data-odak': 'sec', onclick: () => dosyaSec(s, secili) }, 'Dosya seç'));
  alan.addEventListener('dragover', (e) => { e.preventDefault(); alan.classList.add('uzerinde'); });
  alan.addEventListener('dragleave', () => alan.classList.remove('uzerinde'));
  alan.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); alan.classList.remove('uzerinde');
    birakilanDosyalar(e).then((dosyalar) => { if (dosyalar.length) birakildi(s, secili, dosyalar); });
  });
  panel.push(alan);
  // SVG'nin h() ile oluşturulması HTML ad alanında olacağından, doğru ad alanıyla yeniden kur
  svgDuzelt(alan);

  // Seçilen dosyalar
  if (y.dosyalar.length) {
    panel.push(h('div', { sinif: 'kart' }, h('h3', { metin: `Seçilen dosyalar (${y.dosyalar.length})` }),
      h('ul', { sinif: 'dosya-liste' }, y.dosyalar.map((yol, i) => onizlemeBagla(h('li', { sinif: 'dosya-oge' },
        h('span', { sinif: 'dosya-uz', metin: uzAl(yol) || '?' }),
        h('span', { sinif: 'dosya-ad', title: yol, metin: adAl(yol) }),
        secili.sirali ? h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Yukarı', 'aria-label': 'Yukarı taşı', 'data-odak': 'yukari-' + yol, disabled: i === 0, onclick: () => { [y.dosyalar[i - 1], y.dosyalar[i]] = [y.dosyalar[i], y.dosyalar[i - 1]]; sayfayiCiz(); } }, '▲') : null,
        secili.sirali ? h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Aşağı', 'aria-label': 'Aşağı taşı', 'data-odak': 'asagi-' + yol, disabled: i === y.dosyalar.length - 1, onclick: () => { [y.dosyalar[i + 1], y.dosyalar[i]] = [y.dosyalar[i], y.dosyalar[i + 1]]; sayfayiCiz(); } }, '▼') : null,
        h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Listeden çıkar', 'aria-label': 'Listeden çıkar', 'data-odak': 'cikar-' + i, onclick: () => { y.dosyalar.splice(i, 1); y.hedef = null; sayfayiCiz(); } }, '✕'),
        algilananEtiketi(yol)), yol))),
      h('div', { sinif: 'satir', 'data-bos': '1' }, h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => { y.dosyalar = []; y.hedef = null; sayfayiCiz(); } }, 'Listeyi temizle'))));
  }

  // Hedef biçimler
  let hedefBilgi = null;
  let hedefler = [];
  if (secili.hedefTipi === 'katalog' && y.dosyalar.length) {
    hedefler = await hedefleriBul(y.dosyalar.map(uzAl));
    // E-kitap sayfasında yalnız e-kitap hedefleri, diğer sayfalarda e-kitap hedefi görünmez
    hedefler = hedefler.filter((x) => (x.kategori === 'ekitap') === (s === 'ekitap'));
    if (y.hedef && !hedefler.some((x) => x.hedef === y.hedef)) y.hedef = null;
    if (!y.hedef) { const son = sonHedefAl(s + '/' + secili.id); if (son && hedefler.some((x) => x.hedef === son)) y.hedef = son; }
    hedefBilgi = hedefler.find((x) => x.hedef === y.hedef) || null;
    panel.push(h('div', { sinif: 'kart' }, h('h3', { id: 'hedef-baslik-' + s, metin: 'Hedef biçim' }),
      hedefler.length
        ? h('div', { sinif: 'cipler', 'aria-labelledby': 'hedef-baslik-' + s }, hedefler.map((x) =>
          h('button', { sinif: 'cip' + (x.hedef === y.hedef ? ' secili' : ''), type: 'button', 'aria-pressed': String(x.hedef === y.hedef),
            'data-odak': 'cip-' + x.hedef, title: x.etiket, onclick: () => { y.hedef = x.hedef; sonHedefYaz(s + '/' + secili.id, x.hedef); sayfayiCiz(); } }, x.etiket || x.hedef.toUpperCase())))
        : h('p', { sinif: 'ipucu', metin: 'Seçilen dosyaların hepsi için ortak bir hedef biçim yok. Farklı türleri ayrı ayrı dönüştür.' })));
  } else if (secili.hedefTipi === 'katalog') {
    panel.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Hedef biçim' }), h('p', { sinif: 'ipucu', metin: 'Önce bir dosya ekle; ona uygun biçimler burada görünür.' })));
  }

  // Kategoriye özgü ayarlar
  const gorunenAlanlar = (secili.alanlar || []).filter((a) => !a.goster || a.goster(y.hedef, hedefBilgi));
  if (gorunenAlanlar.length) {
    panel.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Ayarlar' }),
      h('div', { sinif: 'alanlar' }, gorunenAlanlar.map((a) => alanOlustur(s, secili, y, a)))));
  }

  // Çıktı klasörü
  panel.push(ciktiKlasoruKarti());

  // Sonuçlar (yerel PDF işleri)
  if (y.sonuclar && y.sonuclar.length) {
    panel.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Sonuç' }),
      h('ul', { sinif: 'dosya-liste' }, y.sonuclar.map((yol) => h('li', { sinif: 'dosya-oge' },
        h('span', { sinif: 'dosya-ad', title: yol, metin: adAl(yol) }),
        h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => klasordeGoster(yol) }, 'Klasörde göster'))))));
  }

  // Dönüştür
  const hazir = hazirMi(secili, y);
  const yerelIlerleme = y.calisiyor ? h('div', { sinif: 'kart' }, h('div', { sinif: 'ilerleme' }, yerelDolgu(y)),
    h('div', { sinif: 'satir' }, yerelMetin(y),
      h('button', { sinif: 'dugme tehlike kucuk', type: 'button', disabled: !!y.iptalIstendi, onclick: (e) => { y.iptalIstendi = true; e.currentTarget.disabled = true; } }, 'İptal'))) : null;
  if (yerelIlerleme) panel.push(yerelIlerleme);
  panel.push(h('button', { sinif: 'dugme birincil buyuk', type: 'button', 'data-odak': 'donustur', disabled: !hazir.tamam || !!y.calisiyor,
    title: hazir.neden || '', onclick: (e) => gonder(e.currentTarget, () => donustur(s, secili, y, hedefBilgi)) }, y.calisiyor ? 'Çalışıyor…' : (secili.dugme || 'Dönüştür')));
  if (!hazir.tamam && hazir.neden) panel.push(h('p', { sinif: 'ipucu', metin: hazir.neden }));
  // Sekmeli sayfada içerik sekme paneline sarılır
  if (araclar.length > 1) parcalar.push(h('div', { role: 'tabpanel', id: panelId, 'aria-labelledby': sekmeId(secili) }, panel));
  else parcalar.push(...panel);
  return parcalar;
}

function yerelMetin(y) {
  const p = h('p', { sinif: 'ipucu', metin: y.ilerlemeMetni || 'Hazırlanıyor…' });
  y.metinEl = p;
  return p;
}

function yerelDolgu(y) {
  const d = h('div', { sinif: 'ilerleme-dolgu' });
  d.style.width = Math.max(3, y.yuzde || 0) + '%';
  y.dolguEl = d;
  return d;
}

// h() ile oluşturulan <svg> HTML ad alanında kalır; SVG ad alanıyla yeniden oluştur.
function svgDuzelt(kok) {
  kok.querySelectorAll('svg').forEach((eski) => {
    const yeni = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    yeni.setAttribute('viewBox', '0 0 24 24');
    yeni.setAttribute('aria-hidden', 'true');
    eski.querySelectorAll('path').forEach((p) => {
      const yp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      yp.setAttribute('d', p.getAttribute('d'));
      yeni.append(yp);
    });
    eski.replaceWith(yeni);
  });
}

function hazirMi(arac, y) {
  if (!y.dosyalar.length) return { tamam: false, neden: 'Önce dosya ekle.' };
  if (arac.en && y.dosyalar.length < arac.en && arac.id === 'birlestir') return { tamam: false, neden: 'Birleştirmek için en az 2 PDF gerekir.' };
  if (arac.hedefTipi === 'katalog' && !y.hedef) return { tamam: false, neden: 'Bir hedef biçim seç.' };
  for (const a of arac.alanlar || []) {
    if (a.gerekli && !String(y.secenekler[a.anahtar] || '').trim()) return { tamam: false, neden: `"${a.etiket}" alanını doldur.` };
  }
  return { tamam: true };
}

function alanOlustur(s, arac, y, a) {
  const id = `alan-${s}-${a.anahtar}`;
  const mevcut = y.secenekler[a.anahtar] !== undefined ? y.secenekler[a.anahtar] : (a.varsayilan !== undefined ? a.varsayilan : '');
  if (y.secenekler[a.anahtar] === undefined && a.varsayilan !== undefined) y.secenekler[a.anahtar] = a.varsayilan;
  let girdi;
  if (a.tip === 'select') {
    girdi = h('select', { id }, a.secenekler.map(([d, e]) => h('option', { value: d, selected: String(mevcut) === d }, e)));
    girdi.addEventListener('change', () => { y.secenekler[a.anahtar] = girdi.value; });
  } else if (a.tip === 'onay') {
    girdi = h('input', { id, type: 'checkbox', checked: mevcut === true });
    girdi.addEventListener('change', () => { y.secenekler[a.anahtar] = girdi.checked; });
    return h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: id }, girdi, ' ' + a.etiket));
  } else if (a.tip === 'gorselSec') {
    const ad = y.secenekler[a.anahtar] ? adAl(y.secenekler[a.anahtar]) : 'Seçilmedi (siyah ekran)';
    return h('div', { sinif: 'alan' }, h('label', { metin: a.etiket }),
      h('div', { sinif: 'satir' }, h('span', { sinif: 'dosya-ad', metin: ad }),
        h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: async () => {
          try { const r = await api.dosyaSec('gorsel', false); if (r[0]) { y.secenekler[a.anahtar] = r[0]; sayfayiCiz(); } } catch (e) { bildir(hataMetni(e), true); }
        } }, 'Seç'),
        y.secenekler[a.anahtar] ? h('button', { sinif: 'ikon-dugme', type: 'button', 'aria-label': 'Kaldır', onclick: () => { delete y.secenekler[a.anahtar]; sayfayiCiz(); } }, '✕') : null));
  } else {
    girdi = h('input', { id, type: a.tip === 'number' ? 'number' : 'text', placeholder: a.yer || '', value: mevcut, min: a.min, max: a.max, autocomplete: 'off', spellcheck: 'false' });
    girdi.addEventListener('input', () => { y.secenekler[a.anahtar] = girdi.value; });
  }
  return h('div', { sinif: 'alan' }, h('label', { for: id, metin: a.etiket }), girdi);
}

// Dönüştür / kategori sayfalarındaki çıktı klasörü kartı; çıktı yeri "kaynak" ise klasör seçilmez.
function ciktiKlasoruKarti() {
  const kaynak = durum.ayarlar.ciktiYeri === 'kaynak';
  return h('div', { sinif: 'kart' }, h('h3', { metin: 'Çıktı klasörü' }),
    h('div', { sinif: 'satir' },
      h('div', { sinif: 'yol', title: kaynak ? '' : durum.ayarlar.ciktiKlasoru, metin: kaynak ? 'Kaynağın yanına kaydedilir' : durum.ayarlar.ciktiKlasoru }),
      kaynak ? null : h('button', { sinif: 'dugme ikincil', type: 'button', onclick: ciktiKlasoruDegistir }, 'Değiştir')));
}

async function ciktiKlasoruDegistir() {
  try {
    const k = await api.klasorSec();
    if (!k) return;
    const r = await api.ayarKaydet('ciktiKlasoru', k);
    durum.ayarlar = r;
    sayfayiCiz();
  } catch (e) { bildir(hataMetni(e), true); }
}

/* ---------- Dönüştürme ---------- */
function seceneklerHazirla(arac, y, hedef) {
  const o = {};
  for (const a of arac.alanlar || []) {
    if (a.goster && !a.goster(y.hedef, hedef)) continue;
    const v = y.secenekler[a.anahtar];
    if (v === undefined || v === '') continue;
    if (a.tip === 'number' || a.anahtar === 'aci') o[a.anahtar] = Number(v);
    else o[a.anahtar] = v;
  }
  return o;
}

async function donustur(s, arac, y, hedefBilgi) {
  if (arac.yerel) { await yerelPdfIsi(s, arac, y); return true; }
  const hedef = arac.hedefTipi === 'sabit' ? arac.hedef : y.hedef;
  const secenekler = seceneklerHazirla(arac, y, hedefBilgi);
  const gruplar = arac.tekIs ? [y.dosyalar.slice()] : y.dosyalar.map((d) => [d]);
  let eklenen = 0;
  const hatalar = [];
  for (const girdiler of gruplar) {
    try {
      const r = await api.isEkle({ girdiler, hedef, ciktiKlasoru: durum.ayarlar.ciktiKlasoru, secenekler });
      let o = isler.get(r.id);
      if (!o) { o = { durum: 'bekliyor', yuzde: 0, ciktilar: [] }; isler.set(r.id, o); }
      o.ad = r.ad; o.hedef = hedef;
      isCiz(r.id);
      eklenen++;
    } catch (e) { hatalar.push([adAl(girdiler[0]), hataMetni(e)]); }
  }
  hatalariBildir(hatalar);
  if (eklenen) {
    bildir(eklenen === 1 ? 'İş kuyruğa eklendi.' : `${eklenen} iş kuyruğa eklendi.`);
    y.dosyalar = []; y.hedef = null;
    sayfayiCiz();
  }
  return eklenen > 0;
}

async function yerelPdfIsi(s, arac, y) {
  const arayuz = await import('./pdf-araclari.js');
  y.calisiyor = true; y.iptalIstendi = false; y.yuzde = 0; y.sonuclar = [];
  sayfayiCiz();
  const ilerlemeKaydet = (yuzde, metin) => {
    y.yuzde = yuzde; y.ilerlemeMetni = metin;
    if (y.dolguEl) y.dolguEl.style.width = Math.max(3, yuzde) + '%';
    if (y.metinEl) y.metinEl.textContent = metin;
  };
  let hatali = 0;
  const hatalar = [];
  try {
    const toplam = y.dosyalar.length;
    for (let i = 0; i < toplam && !y.iptalIstendi; i++) {
      const yol = y.dosyalar[i];
      const ortak = {
        yol, ciktiKlasoru: durum.ayarlar.ciktiKlasoru, sayfalar: (y.secenekler.sayfalar || '').trim(),
        ilerleme: (yz, m) => ilerlemeKaydet(Math.round(((i + yz / 100) / toplam) * 100), `${adAl(yol)} — ${m}`),
        iptal: () => y.iptalIstendi
      };
      try {
        let c;
        if (arac.yerel === 'gorsel') c = await arayuz.pdfGorselYap(api, { ...ortak, uzanti: y.secenekler.bicim === 'jpg' ? 'jpg' : 'png', olcek: Number(y.secenekler.olcek || 2) });
        else c = await arayuz.pdfMetinYap(api, ortak);
        y.sonuclar.push(...c);
      } catch (e) { hatali++; hatalar.push([adAl(yol), hataMetni(e)]); }
    }
    hatalariBildir(hatalar);
    if (y.iptalIstendi) bildir(`${arac.ad} iptal edildi.`);
    if (y.sonuclar.length) {
      bildir(`${y.sonuclar.length} dosya kaydedildi.`);
      durum.gecmis.unshift(...y.sonuclar.slice(0, 1).map((k) => ({ id: 'yerel-' + Date.now(), ad: adAl(y.dosyalar[0]) + (y.dosyalar.length > 1 ? ` ve ${y.dosyalar.length - 1} dosya` : ''), hedef: arac.ad, durum: hatali ? 'hata' : 'bitti', ciktilar: [k], hata: '', zaman: Date.now() })));
    }
  } finally {
    y.calisiyor = false; y.iptalIstendi = false; y.metinEl = null;
    sayfayiCiz();
  }
}

/* ---------- Geçmiş ---------- */
// Arayüz kendi kopyasını anında günceller; Geçmiş sayfası açılınca main'deki kalıcı liste esas alınır.
async function gecmisiYenile() {
  try {
    const r = await api.ayarlarAl();
    if (!Array.isArray(r.gecmis)) return;
    const yerel = durum.gecmis.filter((g) => String(g.id).startsWith('yerel-'));
    durum.gecmis = r.gecmis.concat(yerel).sort((a, b) => (b.zaman || 0) - (a.zaman || 0)).slice(0, 200);
    if (durum.sayfa === 'gecmis') sayfayiCiz();
  } catch { /* yerel kopya kullanılmaya devam eder */ }
}

function gecmisSayfasi() {
  const tarih = (t) => new Date(t).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  return [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: 'Geçmiş' })),
    h('p', { sinif: 'sayfa-aciklama', metin: 'Son 200 işin kaydı yalnız bu bilgisayarda tutulur.' }),
    h('div', { sinif: 'kart' },
      durum.gecmis.length
        ? h('table', { sinif: 'tablo-liste' },
          h('thead', {}, h('tr', {}, ['Dosya', 'Hedef', 'Durum', 'Zaman', ''].map((b) => h('th', { metin: b })))),
          h('tbody', {}, durum.gecmis.map((g) => h('tr', {},
            h('td', { title: g.hata || g.ad, metin: g.ad }),
            h('td', { metin: String(g.hedef || '').toUpperCase() }),
            h('td', {}, h('span', { sinif: 'rozet ' + g.durum, metin: ROZET[g.durum] || g.durum })),
            h('td', { metin: g.zaman ? tarih(g.zaman) : '' }),
            h('td', {}, g.durum === 'bitti' && g.ciktilar && g.ciktilar[0]
              ? h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => klasordeGoster(g.ciktilar[0]) }, 'Klasörde göster') : null)))))
        : h('p', { sinif: 'ipucu', metin: 'Henüz tamamlanmış bir iş yok.' }),
      durum.gecmis.length ? h('div', { sinif: 'satir' }, h('button', { sinif: 'dugme tehlike kucuk', type: 'button', onclick: async () => {
        try { const r = await api.ayarKaydet('gecmisTemizle', true); durum.gecmis = r.gecmis || []; sayfayiCiz(); } catch (e) { bildir(hataMetni(e), true); }
      } }, 'Geçmişi temizle')) : null)
  ];
}

/* ---------- Yönetici paneli (1.10.0; Ayarlar, PIN kilitli, Özellikler'den kapatılabilir) [Claude#taadon-1.10-yonetici 2026-11-04] ---------- */
// Kilit main'de tutulur; burada yalnız görünüm durumu var. PIN değeri saklanmaz, giriş kutusu hemen boşaltılır.
const yonetici = { genis: false, acik: false, durum: null, taniYolu: '' };
function yoneticiSifirla() { yonetici.acik = false; yonetici.durum = null; yonetici.taniYolu = ''; }
async function yoneticiYenile() {
  try { yonetici.durum = await api.yoneticiDurum(); yonetici.acik = true; }
  catch (e) { yoneticiSifirla(); bildir(hataMetni(e), true); }
}
function pinKutusu(id, yer) {
  return h('input', { id, type: 'password', inputmode: 'numeric', maxlength: '8', autocomplete: 'off', placeholder: yer || '4-8 hane', spellcheck: 'false' });
}
// Enter ile gönder; işlevden sonra kutular boşaltılır (PIN bellekte tutulmaz)
function pinFormu(kutular, dugmeMetni, isle) {
  const gonder = async () => {
    const degerler = kutular.map((k) => k.value);
    kutular.forEach((k) => { k.value = ''; });
    try { await isle(...degerler); } catch (e) { bildir(hataMetni(e), true); }
  };
  kutular.forEach((k) => k.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gonder(); } }));
  return h('button', { sinif: 'dugme birincil kucuk', type: 'button', onclick: gonder }, dugmeMetni);
}
function yoneticiKarti(a, kaydet) {
  const ozet = h('summary', {}, h('span', { metin: 'Yönetici paneli' }), h('span', { sinif: 'rozet', metin: yonetici.acik ? 'Açık' : 'Kilitli' }));
  const kart = h('details', { sinif: 'kart yonetici', open: yonetici.genis }, ozet);
  kart.addEventListener('toggle', () => { yonetici.genis = kart.open; });
  if (!yonetici.acik) {
    if (!a.yoneticiPinVar) {
      const yeni = pinKutusu('yonetici-yeni-pin', 'Yeni PIN');
      const tekrar = pinKutusu('yonetici-pin-tekrar', 'PIN tekrar');
      kart.append(h('p', { sinif: 'ipucu', metin: 'PIN belirle: henüz PIN yok. 4-8 haneli bir PIN seç; yalnız özeti saklanır.' }),
        h('div', { sinif: 'satir' }, yeni, tekrar, pinFormu([yeni, tekrar], 'PIN belirle', async (p1, p2) => {
          if (p1 !== p2) throw new Error('PIN\'ler aynı değil.');
          await api.yoneticiPinBelirle(p1);
          durum.ayarlar = await api.ayarlarAl();
          await yoneticiYenile(); sayfayiCiz();
        })));
    } else {
      const pin = pinKutusu('yonetici-pin', 'PIN');
      kart.append(h('p', { sinif: 'ipucu', metin: 'Panel kilitli. 5 yanlış denemede 60 sn beklenir.' }),
        h('div', { sinif: 'satir' }, pin, pinFormu([pin], 'Kilidi aç', async (p) => {
          await api.yoneticiKilitAc(p);
          await yoneticiYenile(); sayfayiCiz();
        })));
    }
    return kart;
  }
  const d = yonetici.durum || {};
  const c = d.cekirdek || {};
  const m = d.motorlar || {};
  const q = d.kuyruk || {};
  const motorMetni = (x) => (x && x.yol ? x.yol : '—') + (x && x.durum ? ` (${x.durum})` : '');
  const satirlar = [
    ['sürüm', d.surum], ['electron / node', `${d.electron || '?'} / ${d.node || '?'}`],
    ['çekirdek', c.rustHazir ? (c.motorRust ? 'Rust (açık)' : 'Rust hazır, kapalı → JS') : 'JS (Rust exe yok)'],
    ['rust exe', c.exeYolu || '—'], ['rust sha256', c.sha256 || '—'], ['modül sürümü', c.modulSurumu || '—'],
    ['ffmpeg', m.ffmpeg ? `${m.ffmpeg.yol} (${m.ffmpeg.var ? 'var' : 'yok'})` : '—'],
    ['soffice', motorMetni(m.soffice)], ['calibre', motorMetni(m.calibre)],
    ['kuyruk', `bekleyen ${q.bekleyen || 0} · çalışan ${q.calisan || 0} · biten ${q.biten || 0} · hata ${q.hata || 0}`],
    ['geçmiş kaydı', String(d.gecmisSayisi || 0)], ['ayar dosyası', d.ayarDosyasi || '—'],
    ['profil şablonu', d.profilSablonu ? 'var' : 'yok']
  ];
  const ozellikler = Object.entries(d.ozellikler || {}).map(([k, v]) => h('span', { sinif: 'rozet' + (v ? ' bitti' : ''), metin: `${k}: ${v ? 'açık' : 'kapalı'}` }));
  const eski = pinKutusu('yonetici-eski-pin', 'Eski PIN');
  const yeni = pinKutusu('yonetici-yeni-pin2', 'Yeni PIN');
  kart.append(
    h('div', { sinif: 'satir' },
      h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: async () => { await yoneticiYenile(); sayfayiCiz(); } }, 'Yenile'),
      h('button', { sinif: 'dugme tehlike kucuk', type: 'button', onclick: async () => {
        try { await api.yoneticiKilitle(); } catch (e) { bildir(hataMetni(e), true); }
        yoneticiSifirla(); sayfayiCiz();
      } }, 'Kilitle')),
    h('table', { sinif: 'tablo-liste yonetici-tablo' }, h('tbody', {}, satirlar.map(([e, v]) => h('tr', {}, h('td', { sinif: 'yonetici-etiket', metin: e }), h('td', { metin: v == null ? '—' : String(v) }))))),
    h('p', { sinif: 'ipucu bolum', metin: 'Özellik anahtarları (değiştirmek için Özellikler kartı)' }),
    h('div', { sinif: 'satir' }, ozellikler),
    h('div', { sinif: 'satir' },
      h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: async () => { await kaydet('motorRust', a.motorRust === false); await yoneticiYenile(); sayfayiCiz(); } },
        a.motorRust === false ? 'Rust çekirdeğini aç' : 'Rust çekirdeğini kapat'),
      h('span', { sinif: 'ipucu', metin: 'Geri alınabilir; arşiv işlerinde bir sonraki işten itibaren geçerli.' })),
    h('div', { sinif: 'satir' },
      h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: async () => {
        try { yonetici.taniYolu = await api.taniOlustur(); bildir('Tanı dosyası oluşturuldu.'); sayfayiCiz(); } catch (e) { bildir(hataMetni(e), true); }
      } }, 'Tanı dosyası oluştur'),
      yonetici.taniYolu ? h('div', { sinif: 'yol', title: yonetici.taniYolu, metin: yonetici.taniYolu }) : null,
      yonetici.taniYolu ? h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => klasordeGoster(yonetici.taniYolu) }, 'Klasörde göster') : null),
    h('p', { sinif: 'ipucu bolum', metin: 'PIN\'i değiştir' }),
    h('div', { sinif: 'satir' }, eski, yeni, pinFormu([eski, yeni], 'PIN\'i değiştir', async (e, y) => {
      await api.yoneticiPinBelirle(y, e);
      bildir('PIN değiştirildi.');
    })));
  return kart;
}

/* ---------- Ayarlar ---------- */
function ayarlarSayfasi() {
  const a = durum.ayarlar;
  if (a.ozYonetici === false) yoneticiSifirla();
  const kaydet = async (anahtar, deger) => {
    try { const r = await api.ayarKaydet(anahtar, deger); durum.ayarlar = r; temaUygula(); await loYenile(); sayfayiCiz(); }
    catch (e) { bildir(hataMetni(e), true); }
  };
  const temaSec = h('select', { id: 'ayar-tema' }, [['sistem', 'Sistemi izle'], ['acik', 'Açık'], ['koyu', 'Koyu']].map(([d, e]) => h('option', { value: d, selected: a.tema === d }, e)));
  temaSec.addEventListener('change', () => kaydet('tema', temaSec.value));
  const es = h('select', { id: 'ayar-es' }, [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: a.esZamanli === n }, String(n))));
  es.addEventListener('change', () => kaydet('esZamanli', Number(es.value)));
  const ciktiYeri = h('select', { id: 'ayar-ciktiyeri' }, [['klasor', 'Seçtiğim klasör'], ['kaynak', 'Kaynağın yanına']].map(([d, e]) => h('option', { value: d, selected: (a.ciktiYeri || 'klasor') === d }, e)));
  ciktiYeri.addEventListener('change', () => kaydet('ciktiYeri', ciktiYeri.value));
  const sonek = h('input', { id: 'ayar-sonek', type: 'text', maxlength: '20', placeholder: 'ör. -donusturuldu', value: a.sonek || '', autocomplete: 'off', spellcheck: 'false' });
  sonek.addEventListener('change', () => {
    const v = sonek.value;
    if (!/^[A-Za-z0-9 _.-]{0,20}$/.test(v)) { bildir('Sonek en çok 20 karakter; yalnız harf, rakam, boşluk, _ . - kullanılabilir.', true); sonek.value = a.sonek || ''; return; }
    kaydet('sonek', v);
  });
  const ozgunTasi = h('input', { id: 'ayar-ozgun-tasi', type: 'checkbox', checked: a.ozgunTasi === true });
  ozgunTasi.addEventListener('change', () => kaydet('ozgunTasi', ozgunTasi.checked));
  const ustVeri = h('input', { id: 'ayar-ust-veri', type: 'checkbox', checked: a.ustVeriTemizle === true });
  ustVeri.addEventListener('change', () => kaydet('ustVeriTemizle', ustVeri.checked));
  // Rust çekirdeği (taa-donustur.exe) arşiv işlerinde; varsayılan açık, exe yoksa JS yolu. [Claude#taadon-rust-asama2 2026-11-04]
  const motorRust = h('input', { id: 'ayar-motor-rust', type: 'checkbox', checked: a.motorRust !== false });
  motorRust.addEventListener('change', () => kaydet('motorRust', motorRust.checked));
  // Özellikler (1.9.0): her yeni özellik buradan kapatılabilir (varsayılan açık)
  const ozellikler = OZELLIKLER.map(([anahtar, etiket]) => {
    const kutu = h('input', { id: 'ayar-' + anahtar, type: 'checkbox', checked: a[anahtar] !== false });
    kutu.addEventListener('change', () => kaydet(anahtar, kutu.checked));
    return h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: 'ayar-' + anahtar }, kutu, ' ' + etiket));
  });
  const ozYonetici = h('input', { id: 'ayar-ozYonetici', type: 'checkbox', checked: a.ozYonetici !== false });
  ozYonetici.addEventListener('change', () => kaydet('ozYonetici', ozYonetici.checked));
  return [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: 'Ayarlar' })),
    h('p', { sinif: 'sayfa-aciklama', metin: 'Değişiklikler anında kaydedilir.' }),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Çıktı klasörü' }),
      h('div', { sinif: 'satir' }, h('div', { sinif: 'yol', title: a.ciktiKlasoru, metin: a.ciktiKlasoru }),
        h('button', { sinif: 'dugme ikincil', type: 'button', onclick: ciktiKlasoruDegistir }, 'Değiştir')),
      h('p', { sinif: 'ipucu', metin: 'Var olan dosyaların üzerine hiçbir zaman yazılmaz; ad çakışırsa "(1)" eklenir.' })),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Çıktı' }),
      h('div', { sinif: 'alanlar' },
        h('div', { sinif: 'alan' }, h('label', { for: 'ayar-ciktiyeri', metin: 'Çıktı yeri' }), ciktiYeri),
        h('div', { sinif: 'alan' }, h('label', { for: 'ayar-sonek', metin: 'Çıktı adı soneki' }), sonek)),
      h('p', { sinif: 'ipucu', metin: 'Sonek boşsa eklenmez (en çok 20 karakter).' }),
      h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: 'ayar-ozgun-tasi' }, ozgunTasi, ' Özgün dosyayı iş bitince Özgün klasörüne taşı'),
        h('p', { sinif: 'ipucu', metin: 'Özgün dosya silinmez, Özgün klasörüne taşınır.' })),
      h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: 'ayar-ust-veri' }, ustVeri, ' Çıktıdan üst veriyi temizle (gizlilik)'),
        h('p', { sinif: 'ipucu', metin: 'Yazar, yorum, konum ve cihaz bilgisi çıktıdan silinir (PDF, Office belgeleri, görseller).' }))),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'LibreOffice (belge, tablo, sunum)' }),
      h('div', { sinif: 'satir' },
        h('div', { sinif: 'yol', title: durum.lo.yol, metin: durum.lo.kurulu ? durum.lo.yol : (durum.lo.durum === 'dogrulanamadi' ? 'LibreOffice doğrulanamadı' : 'Bulunamadı') }),
        h('button', { sinif: 'dugme ikincil', type: 'button', onclick: async () => {
          try { const r = await api.dosyaSec('soffice', false); if (r[0]) await kaydet('sofficeYolu', r[0]); } catch (e) { bildir(hataMetni(e), true); }
        } }, 'soffice.exe seç'),
        a.sofficeYolu ? h('button', { sinif: 'dugme ikincil', type: 'button', onclick: () => kaydet('sofficeYolu', '') }, 'Otomatik bul') : null),
      !durum.lo.kurulu ? h('div', { sinif: 'satir' }, h('button', { sinif: 'dugme birincil kucuk', type: 'button', onclick: () => api.libreofficeIndirmeSayfasi().catch((e) => bildir(hataMetni(e), true)) }, 'LibreOffice indirme sayfasını aç')) : null),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Calibre (e-kitap: EPUB, MOBI, AZW3, FB2)' }),
      h('div', { sinif: 'satir' },
        h('div', { sinif: 'yol', title: durum.cal.yol, metin: durum.cal.kurulu ? durum.cal.yol : (durum.cal.durum === 'dogrulanamadi' ? 'Calibre doğrulanamadı' : 'Bulunamadı') })),
      h('p', { sinif: 'ipucu', metin: 'Programla gelir, ayrıca kurulmaz; yalnız ebook-convert kullanılır ve her iş kendi geçici klasöründe çalışır.' })),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Görünüm ve başarım' }),
      h('div', { sinif: 'alanlar' },
        h('div', { sinif: 'alan' }, h('label', { for: 'ayar-tema', metin: 'Tema' }), temaSec),
        h('div', { sinif: 'alan' }, h('label', { for: 'ayar-es', metin: 'Aynı anda çalışan iş sayısı' }), es)),
      h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: 'ayar-motor-rust' }, motorRust, ' Arşiv işlemlerinde Rust çekirdeğini kullan (hızlı)'))),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Özellikler' }),
      h('p', { sinif: 'ipucu', metin: 'İstemediğin özelliği kapat; değişiklik anında geçerli olur.' }),
      ozellikler,
      h('div', { sinif: 'alan' }, h('label', { sinif: 'onay-satir', for: 'ayar-ozYonetici' }, ozYonetici, ' Yönetici panelini göster'))),
    a.ozYonetici !== false ? yoneticiKarti(a, kaydet) : null
  ];
}
const OZELLIKLER = [
  ['ozOnizleme', 'Dosya satırının üzerine gelince önizleme göster'],
  ['ozGorevCubugu', 'Görev çubuğunda ilerleme göster'],
  ['ozPano', 'Ctrl+V ile panodaki dosyayı ya da ekran görüntüsünü ekle'],
  ['ozBicimAlgila', 'Dosya içeriği uzantıyla uyuşmazsa uyar'],
  ['ozPdfBirlestir', 'Çoklu dosyada "Tek PDF\'de birleştir" seçeneğini göster'],
  ['ozIsitma', 'İlk belge eklenince LibreOffice\'i önceden hazırla (ısıtma)']
];

/* ---------- Hakkında ---------- */
function hakkindaSayfasi() {
  const satirlar = [
    ['FFmpeg 6.1.1', 'Video, ses, GIF, BMP/ICO', 'GPL-3.0 (ayrı program olarak çağrılır)'],
    ['sharp / libvips', 'JPG, PNG, WEBP, AVIF, TIFF, GIF, SVG', 'Apache-2.0 / LGPL-3.0'],
    ['LibreOffice 26.8.1', 'Belge, tablo, sunum, PDF → Word, EPUB yazma (programla gelir)', 'MPL-2.0 (ayrı program)'],
    ['Calibre 9.16.0 (ebook-convert)', 'E-kitap: EPUB, MOBI, AZW3, FB2, HTMLZ (programla gelir)', 'GPL-3.0 (ayrı program olarak çağrılır; lisans metni resources/calibre/LICENSE)'],
    ['pdf-lib', 'PDF birleştir, böl, döndür, görsel → PDF', 'MIT'],
    ['pdf.js (pdfjs-dist)', 'PDF → görsel, PDF → metin', 'Apache-2.0'],
    ['marked', 'Markdown → HTML', 'MIT'],
    ['fast-xml-parser, yaml', 'Veri dönüştürme', 'MIT / ISC'],
    ['fflate', 'ZIP ve GZIP', 'MIT'],
    ['Electron', 'Masaüstü kabuğu', 'MIT']
  ];
  return [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: 'Hakkında ve Lisanslar' })),
    h('p', { sinif: 'sayfa-aciklama', metin: 'TaaDön, dosyalarını internete göndermeden bilgisayarında dönüştürür.' }),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Klavye kısayolları' }),
      h('ul', { sinif: 'kisayol-liste' }, KISAYOLLAR.map(([tus, acik]) => h('li', {}, h('kbd', { metin: tus }), h('span', { metin: acik }))))),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Gizlilik' }),
      h('p', { metin: 'Bütün dönüştürmeler bu bilgisayarda yapılır. Program ağ bağlantısı kurmaz; tek istisna, istediğinde LibreOffice\'in resmi indirme sayfasını tarayıcında açmasıdır.' })),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Kullanılan bileşenler' }),
      h('table', { sinif: 'tablo-liste lisans-tablo' },
        h('thead', {}, h('tr', {}, ['Bileşen', 'Ne için', 'Lisans'].map((b) => h('th', { metin: b })))),
        h('tbody', {}, satirlar.map((r) => h('tr', {}, r.map((x) => h('td', { metin: x })))))))
  ];
}

/* ---------- Tema, LibreOffice, başlangıç ---------- */
function temaUygula() {
  const t = durum.ayarlar && durum.ayarlar.tema;
  if (t === 'acik' || t === 'koyu') document.documentElement.dataset.tema = t;
  else delete document.documentElement.dataset.tema;
}

async function loYenile() {
  try { durum.lo = await api.libreofficeDurumu(); } catch { durum.lo = { kurulu: false, yol: '' }; }
  try { durum.cal = await api.calibreDurumu(); } catch { durum.cal = { kurulu: false, yol: '' }; }
}

const KISAYOLLAR = [
  ['Ctrl+O', 'Dosya seç'],
  ['Ctrl+V', 'Panodaki dosyayı ya da ekran görüntüsünü ekle'],
  ['Ctrl+Enter', 'Dönüştür / işlemi başlat'],
  ['Ctrl+1 · 2 · 3', 'Dönüştür, PDF Araçları, Arşiv sayfaları'],
  ['Ctrl+,', 'Ayarlar'],
  ['Ctrl+Shift+Backspace', 'Kuyruktaki bitenleri temizle']
];

// Klavye kısayolları: düğmeler sayfada data-odak ile işaretlidir; devre dışıysa hiçbir şey olmaz.
function kisayolDinle(e) {
  if (!e.ctrlKey || e.altKey) return;
  const tikla = (secici) => { const b = sayfaKutu().querySelector(secici); if (b && !b.disabled) { e.preventDefault(); b.click(); } };
  const git = (sayfa) => { e.preventDefault(); sayfayiGit(sayfa); };
  if (e.key === 'o' || e.key === 'O') tikla('[data-odak="sec"]');
  else if (e.key === 'Enter') tikla('[data-odak="donustur"]');
  else if (e.key === '1') git('donustur');
  else if (e.key === '2') git('pdf');
  else if (e.key === '3') git('arsiv');
  else if (e.key === ',') git('ayarlar');
  else if (e.shiftKey && e.key === 'Backspace') { e.preventDefault(); document.getElementById('kuyruk-temizle').click(); }
}

async function basla() {
  window.addEventListener('keydown', kisayolDinle);
  window.addEventListener('paste', panoYapistir);
  // Pencerenin herhangi bir yerine bırakılan dosyalar Dönüştür sayfasına gider (PDF/Arşiv araç sayfaları kendi alanını kullanır)
  const aracSayfasi = () => !!ARACLAR[durum.sayfa];
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!aracSayfasi() && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) sayfaKutu().classList.add('surukle');
  });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) sayfaKutu().classList.remove('surukle'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    sayfaKutu().classList.remove('surukle');
    if (aracSayfasi()) return;
    birakilanDosyalar(e).then((dosyalar) => {
      if (!dosyalar.length) return;
      if (durum.sayfa !== 'donustur') sayfayiGit('donustur');
      otoBirakildi(dosyalar);
    });
  });
  document.querySelectorAll('.menu-oge').forEach((b) => b.addEventListener('click', () => sayfayiGit(b.dataset.sayfa)));
  document.getElementById('kuyruk-iptal').addEventListener('click', () => api.tumunuIptal().catch((e) => bildir(hataMetni(e), true)));
  document.getElementById('kuyruk-temizle').addEventListener('click', () => {
    for (const [id, o] of isler) {
      if (['bitti', 'hata', 'iptal'].includes(o.durum)) { if (o.el) o.el.remove(); isler.delete(id); }
    }
    kuyrukSayaciniGuncelle();
  });
  api.durumDinle(durumGeldi);
  // Sağ tık / komut satırından gelen yollar: Dönüştür sayfasına eklenir
  if (typeof api.dosyalarDinle === 'function') {
    api.dosyalarDinle((yollar) => {
      const liste = (Array.isArray(yollar) ? yollar : []).filter((x) => typeof x === 'string' && x);
      if (!liste.length) return;
      if (durum.sayfa !== 'donustur') sayfayiGit('donustur');
      otoEkle(liste);
    });
  }
  try {
    const r = await api.ayarlarAl();
    durum.ayarlar = r;
    durum.gecmis = Array.isArray(r.gecmis) ? r.gecmis : [];
  } catch (e) {
    durum.ayarlar = { ciktiKlasoru: '', tema: 'sistem', esZamanli: 2, sofficeYolu: '' };
    bildir('Ayarlar okunamadı: ' + hataMetni(e), true);
  }
  temaUygula();
  try { durum.kategoriler = await api.kategoriler(); } catch { durum.kategoriler = []; }
  await loYenile();
  menuyuGuncelle();
  kuyrukSayaciniGuncelle();
  sayfayiCiz();
}

basla();
