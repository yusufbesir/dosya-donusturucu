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

function bildir(metin, hata) {
  const k = h('div', { sinif: 'bildirim' + (hata ? ' hata' : ''), metin });
  document.getElementById('bildirimler').append(k);
  setTimeout(() => k.remove(), hata ? 7000 : 3500);
}
const hataMetni = (e) => (e && e.message) ? e.message : String(e);

/* ---------- Durum ---------- */
const durum = {
  ayarlar: null,
  gecmis: [],
  sayfa: 'video',
  kategoriler: [],
  lo: { kurulu: true, yol: '' },
  sekme: {},          // sayfa -> seçili araç
  yerel: {}           // 'sayfa/arac' -> { dosyalar:[], hedef, secenekler:{} }
};

const KATEGORI_BASLIK = {
  video: ['Video', 'Video dosyalarını başka biçimlere çevir, sesini çıkar, kırp ya da GIF yap.'],
  ses: ['Ses', 'Ses dosyalarını dönüştür. İstersen kapak görseliyle videoya çevir.'],
  gorsel: ['Görsel', 'Görselleri başka biçimlere çevir, boyutlandır ya da PDF yap.'],
  belge: ['Belge', 'Word, ODT, RTF, TXT, HTML, Markdown ve PDF belgelerini birbirine çevir.'],
  tablo: ['Tablo', 'Excel, ODS ve CSV tablolarını dönüştür.'],
  sunum: ['Sunum', 'PowerPoint ve ODP sunumlarını dönüştür ya da PDF yap.'],
  pdf: ['PDF Araçları', 'PDF birleştir, böl, döndür; görsellerden PDF üret; PDF\'yi Word, görsel ya da metne çevir.'],
  veri: ['Veri', 'JSON, CSV, TSV, YAML ve XML arasında dönüştür.'],
  arsiv: ['Arşiv', 'ZIP oluştur ya da aç, GZIP ile sıkıştır.']
};
const LO_KATEGORILERI = ['belge', 'tablo', 'sunum'];

const KALITE_SECENEKLERI = [['', 'Varsayılan'], ['yuksek', 'Yüksek'], ['orta', 'Orta'], ['kucuk', 'Küçük dosya']];
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
    id: 'donustur', ad: 'Dönüştür', kabul: ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm', 'md', 'pdf'], coklu: true, hedefTipi: 'katalog', alanlar: []
  }],
  tablo: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['xlsx', 'xls', 'ods', 'csv'], coklu: true, hedefTipi: 'katalog', alanlar: []
  }],
  sunum: [{
    id: 'donustur', ad: 'Dönüştür', kabul: ['pptx', 'ppt', 'odp'], coklu: true, hedefTipi: 'katalog', alanlar: []
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
  const bar = h('div', { sinif: 'ilerleme', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, dolgu);
  const yuzde = h('span', { sinif: 'is-yuzde' });
  const rozet = h('span', { sinif: 'rozet' });
  const ad = h('div', { sinif: 'is-ad' });
  const eylem = h('div', { sinif: 'is-eylem' });
  const hata = h('div', { sinif: 'is-hata', hidden: true });
  const el = h('li', { sinif: 'is-oge' }, ad, eylem, h('div', { sinif: 'is-alt' }, bar, yuzde, rozet), hata);
  o.el = el; o.refs = { dolgu, bar, yuzde, rozet, ad, eylem, hata };
  return el;
}

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
  r.yuzde.textContent = y + '%';
  r.rozet.textContent = ROZET[o.durum] || o.durum;
  r.rozet.className = 'rozet ' + o.durum;
  r.hata.hidden = !(o.durum === 'hata' && o.hata);
  r.hata.textContent = o.hata || '';
  r.eylem.replaceChildren();
  if (o.durum === 'bekliyor' || o.durum === 'calisiyor') {
    r.eylem.append(h('button', { sinif: 'dugme tehlike kucuk', type: 'button', onclick: () => api.iptal(id).catch((e) => bildir(hataMetni(e), true)) }, 'İptal'));
  }
  if (o.durum === 'bitti' && o.ciktilar && o.ciktilar.length) {
    r.eylem.append(h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => klasordeGoster(o.ciktilar[0]) }, 'Klasörde göster'));
  }
  kuyrukSayaciniGuncelle();
}

function klasordeGoster(yol) {
  api.klasordeGoster(yol).catch((e) => bildir(hataMetni(e), true));
}

function durumGeldi(d) {
  if (!d || typeof d.id !== 'string') return;
  let o = isler.get(d.id);
  if (!o) { o = { ad: '', durum: 'bekliyor', yuzde: 0, ciktilar: [] }; isler.set(d.id, o); }
  if (d.durum) o.durum = d.durum;
  if (typeof d.yuzde === 'number') o.yuzde = d.yuzde;
  if (Array.isArray(d.ciktilar) && d.ciktilar.length) o.ciktilar = d.ciktilar;
  if (d.hata) o.hata = d.hata;
  isCiz(d.id);
  if (['bitti', 'hata', 'iptal'].includes(d.durum)) {
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
}

async function dosyaSec(sayfa, arac) {
  try {
    const yollar = await api.dosyaSec(sayfa, arac.coklu);
    if (yollar.length) dosyalariEkle(sayfa, arac, yollar);
  } catch (e) { bildir(hataMetni(e), true); }
}

async function birakildi(sayfa, arac, dosyalar) {
  const yollar = [];
  for (const f of dosyalar) {
    try { yollar.push(await api.yolAl(f)); } catch (e) { bildir(`"${f.name}" eklenemedi: ${hataMetni(e)}`, true); }
  }
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
  document.querySelectorAll('.menu-oge').forEach((b) => b.classList.toggle('etkin', b.dataset.sayfa === durum.sayfa));
}

function sayfayiGit(ad) {
  durum.sayfa = ad;
  menuyuGuncelle();
  sayfayiCiz();
  sayfaKutu().scrollTop = 0;
}

let cizimSirasi = 0;
async function sayfayiCiz() {
  const sira = ++cizimSirasi;
  const s = durum.sayfa;
  let icerik;
  try {
    if (ARACLAR[s]) icerik = await kategoriSayfasi(s);
    else if (s === 'gecmis') icerik = gecmisSayfasi();
    else if (s === 'ayarlar') icerik = ayarlarSayfasi();
    else icerik = hakkindaSayfasi();
  } catch (e) {
    icerik = h('div', { sinif: 'bilgi' }, h('p', { metin: 'Sayfa yüklenemedi: ' + hataMetni(e) }));
  }
  if (sira !== cizimSirasi) return;
  const odak = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.odak : null;
  sayfaKutu().replaceChildren(h('div', { sinif: 'sayfa-ic' }, icerik));
  if (odak) { const e = sayfaKutu().querySelector(`[data-odak="${odak}"]`); if (e) e.focus(); }
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

  if (araclar.length > 1) {
    parcalar.push(h('div', { sinif: 'sekmeler', role: 'tablist' }, araclar.map((a) =>
      h('button', { sinif: 'sekme' + (a.id === secili.id ? ' etkin' : ''), type: 'button', role: 'tab', 'aria-selected': String(a.id === secili.id),
        onclick: () => { durum.sekme[s] = a.id; sayfayiCiz(); } }, a.ad))));
  }
  if (secili.aciklama) parcalar.push(h('p', { sinif: 'ipucu', metin: secili.aciklama }));

  const loGerekli = LO_KATEGORILERI.includes(s) || secili.lo;
  if (loGerekli && !durum.lo.kurulu) parcalar.push(loBilgiKutusu());

  // Bırakma alanı
  const alan = h('div', { sinif: 'birakma', role: 'button', tabindex: '0', 'aria-label': 'Dosya bırakma alanı' },
    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3' })),
    h('strong', { metin: secili.coklu ? 'Dosyaları buraya sürükle' : 'Dosyayı buraya sürükle' }),
    h('span', { metin: 'ya da' }),
    h('button', { sinif: 'dugme birincil', type: 'button', 'data-odak': 'sec', onclick: () => dosyaSec(s, secili) }, 'Dosya seç'));
  alan.addEventListener('dragover', (e) => { e.preventDefault(); alan.classList.add('uzerinde'); });
  alan.addEventListener('dragleave', () => alan.classList.remove('uzerinde'));
  alan.addEventListener('drop', (e) => {
    e.preventDefault(); alan.classList.remove('uzerinde');
    birakildi(s, secili, Array.from(e.dataTransfer.files));
  });
  parcalar.push(alan);
  // SVG'nin h() ile oluşturulması HTML ad alanında olacağından, doğru ad alanıyla yeniden kur
  svgDuzelt(alan);

  // Seçilen dosyalar
  if (y.dosyalar.length) {
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: `Seçilen dosyalar (${y.dosyalar.length})` }),
      h('ul', { sinif: 'dosya-liste' }, y.dosyalar.map((yol, i) => h('li', { sinif: 'dosya-oge' },
        h('span', { sinif: 'dosya-uz', metin: uzAl(yol) || '?' }),
        h('span', { sinif: 'dosya-ad', title: yol, metin: adAl(yol) }),
        secili.sirali ? h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Yukarı', 'aria-label': 'Yukarı taşı', disabled: i === 0, onclick: () => { [y.dosyalar[i - 1], y.dosyalar[i]] = [y.dosyalar[i], y.dosyalar[i - 1]]; sayfayiCiz(); } }, '▲') : null,
        secili.sirali ? h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Aşağı', 'aria-label': 'Aşağı taşı', disabled: i === y.dosyalar.length - 1, onclick: () => { [y.dosyalar[i + 1], y.dosyalar[i]] = [y.dosyalar[i], y.dosyalar[i + 1]]; sayfayiCiz(); } }, '▼') : null,
        h('button', { sinif: 'ikon-dugme', type: 'button', title: 'Listeden çıkar', 'aria-label': 'Listeden çıkar', onclick: () => { y.dosyalar.splice(i, 1); y.hedef = null; sayfayiCiz(); } }, '✕')))),
      h('div', { sinif: 'satir', 'data-bos': '1' }, h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => { y.dosyalar = []; y.hedef = null; sayfayiCiz(); } }, 'Listeyi temizle'))));
  }

  // Hedef biçimler
  let hedefBilgi = null;
  let hedefler = [];
  if (secili.hedefTipi === 'katalog' && y.dosyalar.length) {
    hedefler = await hedefleriBul(y.dosyalar.map(uzAl));
    if (y.hedef && !hedefler.some((x) => x.hedef === y.hedef)) y.hedef = null;
    hedefBilgi = hedefler.find((x) => x.hedef === y.hedef) || null;
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Hedef biçim' }),
      hedefler.length
        ? h('div', { sinif: 'cipler', role: 'radiogroup' }, hedefler.map((x) =>
          h('button', { sinif: 'cip' + (x.hedef === y.hedef ? ' secili' : ''), type: 'button', role: 'radio', 'aria-checked': String(x.hedef === y.hedef),
            title: x.etiket, onclick: () => { y.hedef = x.hedef; sayfayiCiz(); } }, x.etiket || x.hedef.toUpperCase())))
        : h('p', { sinif: 'ipucu', metin: 'Seçilen dosyaların hepsi için ortak bir hedef biçim yok. Farklı türleri ayrı ayrı dönüştür.' })));
  } else if (secili.hedefTipi === 'katalog') {
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Hedef biçim' }), h('p', { sinif: 'ipucu', metin: 'Önce bir dosya ekle; ona uygun biçimler burada görünür.' })));
  }

  // Kategoriye özgü ayarlar
  const gorunenAlanlar = (secili.alanlar || []).filter((a) => !a.goster || a.goster(y.hedef, hedefBilgi));
  if (gorunenAlanlar.length) {
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Ayarlar' }),
      h('div', { sinif: 'alanlar' }, gorunenAlanlar.map((a) => alanOlustur(s, secili, y, a)))));
  }

  // Çıktı klasörü
  parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Çıktı klasörü' }),
    h('div', { sinif: 'satir' },
      h('div', { sinif: 'yol', title: durum.ayarlar.ciktiKlasoru, metin: durum.ayarlar.ciktiKlasoru }),
      h('button', { sinif: 'dugme ikincil', type: 'button', onclick: ciktiKlasoruDegistir }, 'Değiştir'))));

  // Sonuçlar (yerel PDF işleri)
  if (y.sonuclar && y.sonuclar.length) {
    parcalar.push(h('div', { sinif: 'kart' }, h('h3', { metin: 'Sonuç' }),
      h('ul', { sinif: 'dosya-liste' }, y.sonuclar.map((yol) => h('li', { sinif: 'dosya-oge' },
        h('span', { sinif: 'dosya-ad', title: yol, metin: adAl(yol) }),
        h('button', { sinif: 'dugme ikincil kucuk', type: 'button', onclick: () => klasordeGoster(yol) }, 'Klasörde göster'))))));
  }

  // Dönüştür
  const hazir = hazirMi(secili, y);
  const yerelIlerleme = y.calisiyor ? h('div', { sinif: 'kart' }, h('div', { sinif: 'ilerleme' }, yerelDolgu(y)), h('p', { sinif: 'ipucu', metin: y.ilerlemeMetni || 'Hazırlanıyor…' })) : null;
  if (yerelIlerleme) parcalar.push(yerelIlerleme);
  parcalar.push(h('button', { sinif: 'dugme birincil buyuk', type: 'button', 'data-odak': 'donustur', disabled: !hazir.tamam || !!y.calisiyor,
    title: hazir.neden || '', onclick: () => donustur(s, secili, y, hedefBilgi) }, y.calisiyor ? 'Çalışıyor…' : (secili.dugme || 'Dönüştür')));
  if (!hazir.tamam && hazir.neden) parcalar.push(h('p', { sinif: 'ipucu', metin: hazir.neden }));
  return parcalar;
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
  if (arac.yerel) return yerelPdfIsi(s, arac, y);
  const hedef = arac.hedefTipi === 'sabit' ? arac.hedef : y.hedef;
  const secenekler = seceneklerHazirla(arac, y, hedefBilgi);
  const gruplar = arac.tekIs ? [y.dosyalar.slice()] : y.dosyalar.map((d) => [d]);
  let eklenen = 0;
  for (const girdiler of gruplar) {
    try {
      const r = await api.isEkle({ girdiler, hedef, ciktiKlasoru: durum.ayarlar.ciktiKlasoru, secenekler });
      let o = isler.get(r.id);
      if (!o) { o = { durum: 'bekliyor', yuzde: 0, ciktilar: [] }; isler.set(r.id, o); }
      o.ad = r.ad; o.hedef = hedef;
      isCiz(r.id);
      eklenen++;
    } catch (e) { bildir(hataMetni(e), true); }
  }
  if (eklenen) {
    bildir(eklenen === 1 ? 'İş kuyruğa eklendi.' : `${eklenen} iş kuyruğa eklendi.`);
    y.dosyalar = []; y.hedef = null;
    sayfayiCiz();
  }
}

async function yerelPdfIsi(s, arac, y) {
  const arayuz = await import('./pdf-araclari.js');
  y.calisiyor = true; y.yuzde = 0; y.sonuclar = [];
  sayfayiCiz();
  const ilerlemeKaydet = (yuzde, metin) => {
    y.yuzde = yuzde; y.ilerlemeMetni = metin;
    if (y.dolguEl) y.dolguEl.style.width = Math.max(3, yuzde) + '%';
  };
  let hatali = 0;
  try {
    const toplam = y.dosyalar.length;
    for (let i = 0; i < toplam; i++) {
      const yol = y.dosyalar[i];
      const ortak = {
        yol, ciktiKlasoru: durum.ayarlar.ciktiKlasoru, sayfalar: (y.secenekler.sayfalar || '').trim(),
        ilerleme: (yz, m) => ilerlemeKaydet(Math.round(((i + yz / 100) / toplam) * 100), `${adAl(yol)} — ${m}`)
      };
      try {
        let c;
        if (arac.yerel === 'gorsel') c = await arayuz.pdfGorselYap(api, { ...ortak, uzanti: y.secenekler.bicim === 'jpg' ? 'jpg' : 'png', olcek: Number(y.secenekler.olcek || 2) });
        else c = await arayuz.pdfMetinYap(api, ortak);
        y.sonuclar.push(...c);
      } catch (e) { hatali++; bildir(`${adAl(yol)}: ${hataMetni(e)}`, true); }
    }
    if (y.sonuclar.length) {
      bildir(`${y.sonuclar.length} dosya kaydedildi.`);
      durum.gecmis.unshift(...y.sonuclar.slice(0, 1).map((k) => ({ id: 'yerel-' + Date.now(), ad: adAl(y.dosyalar[0]) + (y.dosyalar.length > 1 ? ` ve ${y.dosyalar.length - 1} dosya` : ''), hedef: arac.ad, durum: hatali ? 'hata' : 'bitti', ciktilar: [k], hata: '', zaman: Date.now() })));
    }
  } finally {
    y.calisiyor = false;
    sayfayiCiz();
  }
}

/* ---------- Geçmiş ---------- */
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

/* ---------- Ayarlar ---------- */
function ayarlarSayfasi() {
  const a = durum.ayarlar;
  const kaydet = async (anahtar, deger) => {
    try { const r = await api.ayarKaydet(anahtar, deger); durum.ayarlar = r; temaUygula(); await loYenile(); sayfayiCiz(); }
    catch (e) { bildir(hataMetni(e), true); }
  };
  const temaSec = h('select', { id: 'ayar-tema' }, [['sistem', 'Sistemi izle'], ['acik', 'Açık'], ['koyu', 'Koyu']].map(([d, e]) => h('option', { value: d, selected: a.tema === d }, e)));
  temaSec.addEventListener('change', () => kaydet('tema', temaSec.value));
  const es = h('select', { id: 'ayar-es' }, [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: a.esZamanli === n }, String(n))));
  es.addEventListener('change', () => kaydet('esZamanli', Number(es.value)));
  return [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: 'Ayarlar' })),
    h('p', { sinif: 'sayfa-aciklama', metin: 'Değişiklikler anında kaydedilir.' }),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Çıktı klasörü' }),
      h('div', { sinif: 'satir' }, h('div', { sinif: 'yol', title: a.ciktiKlasoru, metin: a.ciktiKlasoru }),
        h('button', { sinif: 'dugme ikincil', type: 'button', onclick: ciktiKlasoruDegistir }, 'Değiştir')),
      h('p', { sinif: 'ipucu', metin: 'Var olan dosyaların üzerine hiçbir zaman yazılmaz; ad çakışırsa "(1)" eklenir.' })),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'LibreOffice (belge, tablo, sunum)' }),
      h('div', { sinif: 'satir' },
        h('div', { sinif: 'yol', title: durum.lo.yol, metin: durum.lo.kurulu ? durum.lo.yol : (durum.lo.durum === 'dogrulanamadi' ? 'LibreOffice doğrulanamadı' : 'Bulunamadı') }),
        h('button', { sinif: 'dugme ikincil', type: 'button', onclick: async () => {
          try { const r = await api.dosyaSec('soffice', false); if (r[0]) await kaydet('sofficeYolu', r[0]); } catch (e) { bildir(hataMetni(e), true); }
        } }, 'soffice.exe seç'),
        a.sofficeYolu ? h('button', { sinif: 'dugme ikincil', type: 'button', onclick: () => kaydet('sofficeYolu', '') }, 'Otomatik bul') : null),
      !durum.lo.kurulu ? h('div', { sinif: 'satir' }, h('button', { sinif: 'dugme birincil kucuk', type: 'button', onclick: () => api.libreofficeIndirmeSayfasi().catch((e) => bildir(hataMetni(e), true)) }, 'LibreOffice indirme sayfasını aç')) : null),
    h('div', { sinif: 'kart' }, h('h3', { metin: 'Görünüm ve başarım' }),
      h('div', { sinif: 'alanlar' },
        h('div', { sinif: 'alan' }, h('label', { for: 'ayar-tema', metin: 'Tema' }), temaSec),
        h('div', { sinif: 'alan' }, h('label', { for: 'ayar-es', metin: 'Aynı anda çalışan iş sayısı' }), es)))
  ];
}

/* ---------- Hakkında ---------- */
function hakkindaSayfasi() {
  const satirlar = [
    ['FFmpeg 6.1.1', 'Video, ses, GIF, BMP/ICO', 'GPL-3.0 (ayrı program olarak çağrılır)'],
    ['sharp / libvips', 'JPG, PNG, WEBP, AVIF, TIFF, GIF, SVG', 'Apache-2.0 / LGPL-3.0'],
    ['LibreOffice', 'Belge, tablo, sunum, PDF → Word (kullanıcının bilgisayarında)', 'MPL-2.0 (ayrı program)'],
    ['pdf-lib', 'PDF birleştir, böl, döndür, görsel → PDF', 'MIT'],
    ['pdf.js (pdfjs-dist)', 'PDF → görsel, PDF → metin', 'Apache-2.0'],
    ['marked', 'Markdown → HTML', 'MIT'],
    ['fast-xml-parser, yaml', 'Veri dönüştürme', 'MIT / ISC'],
    ['fflate', 'ZIP ve GZIP', 'MIT'],
    ['Electron', 'Masaüstü kabuğu', 'MIT']
  ];
  return [
    h('div', { sinif: 'sayfa-baslik' }, h('h1', { metin: 'Hakkında ve Lisanslar' })),
    h('p', { sinif: 'sayfa-aciklama', metin: 'Dosya Dönüştürücü, dosyalarını internete göndermeden bilgisayarında dönüştürür.' }),
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
}

async function basla() {
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  document.querySelectorAll('.menu-oge').forEach((b) => b.addEventListener('click', () => sayfayiGit(b.dataset.sayfa)));
  document.getElementById('kuyruk-iptal').addEventListener('click', () => api.tumunuIptal().catch((e) => bildir(hataMetni(e), true)));
  document.getElementById('kuyruk-temizle').addEventListener('click', () => {
    for (const [id, o] of isler) {
      if (['bitti', 'hata', 'iptal'].includes(o.durum)) { if (o.el) o.el.remove(); isler.delete(id); }
    }
    kuyrukSayaciniGuncelle();
  });
  api.durumDinle(durumGeldi);
  try {
    const r = await api.ayarlarAl();
    durum.ayarlar = r;
    durum.gecmis = Array.isArray(r.gecmis) ? r.gecmis : [];
  } catch (e) {
    durum.ayarlar = { ciktiKlasoru: '', tema: 'sistem', esZamanli: 2, sofficeYolu: '' };
    bildir('Ayarlar okunamadı: ' + hataMetni(e), true);
  }
  temaUygula();
  await loYenile();
  menuyuGuncelle();
  kuyrukSayaciniGuncelle();
  sayfayiCiz();
}

basla();
