'use strict';

// Biçim kataloğu: hangi uzantı hangi kategoride, hangi hedeflere dönüşebilir.

const KATEGORILER = [
  { id: 'video', ad: 'Video', simge: '🎬' },
  { id: 'ses', ad: 'Ses', simge: '🎵' },
  { id: 'gorsel', ad: 'Görsel', simge: '🖼️' },
  { id: 'belge', ad: 'Belge', simge: '📄' },
  { id: 'ekitap', ad: 'E-kitap', simge: '📚' },
  { id: 'tablo', ad: 'Tablo', simge: '📊' },
  { id: 'sunum', ad: 'Sunum', simge: '📽️' },
  { id: 'pdf', ad: 'PDF Araçları', simge: '📕' },
  { id: 'veri', ad: 'Veri', simge: '🧮' },
  { id: 'arsiv', ad: 'Arşiv', simge: '🗜️' },
];

const BICIMLER = {};
function tanimla(kategori, liste) {
  for (const [uzanti, ad] of Object.entries(liste)) BICIMLER[uzanti] = { kategori, ad };
}

tanimla('video', {
  mp4: 'MP4', mkv: 'MKV', avi: 'AVI', mov: 'MOV', webm: 'WebM', wmv: 'WMV', flv: 'FLV',
  mpg: 'MPG', mpeg: 'MPEG', m4v: 'M4V', '3gp': '3GP', ts: 'TS', ogv: 'OGV',
});
tanimla('ses', {
  mp3: 'MP3', wav: 'WAV', flac: 'FLAC', aac: 'AAC', m4a: 'M4A', ogg: 'OGG', opus: 'Opus',
  wma: 'WMA', aiff: 'AIFF', ac3: 'AC3', mp2: 'MP2',
});
tanimla('gorsel', {
  jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF', tiff: 'TIFF', tif: 'TIFF',
  gif: 'GIF', bmp: 'BMP', ico: 'ICO', svg: 'SVG',
});
tanimla('belge', {
  docx: 'Word (DOCX)', doc: 'Word (DOC)', odt: 'OpenDocument Metin (ODT)', rtf: 'RTF',
  txt: 'Düz metin (TXT)', html: 'HTML', htm: 'HTML', md: 'Markdown',
});
// E-kitap: şimdilik yalnız YAZMA (EPUB çıktısı); EPUB girdi, MOBI/AZW3/FB2 ayrı karar bekliyor.
tanimla('ekitap', { epub: 'E-kitap (EPUB)' });
tanimla('tablo', { xlsx: 'Excel (XLSX)', xls: 'Excel (XLS)', ods: 'OpenDocument Tablo (ODS)', csv: 'CSV' });
tanimla('sunum', { pptx: 'PowerPoint (PPTX)', ppt: 'PowerPoint (PPT)', odp: 'OpenDocument Sunum (ODP)' });
tanimla('pdf', { pdf: 'PDF' });
tanimla('veri', { json: 'JSON', tsv: 'TSV', yaml: 'YAML', yml: 'YAML', xml: 'XML' });
tanimla('arsiv', { zip: 'ZIP', gz: 'GZIP' });

// Eş anlamlı uzantılar -> kanonik uzantı
const KANONIK = { jpeg: 'jpg', tif: 'tiff', htm: 'html', yml: 'yaml', mpeg: 'mpg' };
function kanonik(uzanti) {
  const u = String(uzanti || '').toLowerCase().replace(/^\./, '');
  return KANONIK[u] || u;
}

const VIDEO_HEDEF = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'm4v', '3gp', 'ts', 'ogv'];
const SES_HEDEF = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'ac3', 'mp2'];
const GORSEL_HEDEF = ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico'];
// EPUB'a dönüştürülebilen kaynaklar (kanonik uzantı; htm -> html)
const EPUB_KAYNAK = ['docx', 'doc', 'odt', 'rtf', 'txt', 'html'];
const VERI_HEDEF = ['json', 'csv', 'tsv', 'yaml', 'xml'];

function ad(uzanti) {
  return (BICIMLER[uzanti] && BICIMLER[uzanti].ad) || uzanti.toUpperCase();
}
function ogeUret(hedef, motor, etiket) {
  const k = BICIMLER[hedef] ? BICIMLER[hedef].kategori : 'belge';
  return { hedef, kategori: k, motor, etiket: etiket || ad(hedef) };
}

function hedefler(kaynakUzanti) {
  const kaynak = kanonik(kaynakUzanti);
  const bilgi = BICIMLER[kaynak] || BICIMLER[String(kaynakUzanti || '').toLowerCase()];
  if (!bilgi) return [];
  const sonuc = [];
  const ekle = (hedef, motor, etiket) => {
    if (hedef === kaynak) return;
    sonuc.push(ogeUret(hedef, motor, etiket));
  };

  switch (bilgi.kategori) {
    case 'video':
      for (const h of VIDEO_HEDEF) ekle(h, 'ffmpeg');
      sonuc.push({ hedef: 'gif', kategori: 'gorsel', motor: 'ffmpeg', etiket: 'GIF (hareketli görsel)' });
      for (const h of SES_HEDEF) ekle(h, 'ffmpeg', `${ad(h)} (ses çıkar)`);
      break;
    case 'ses':
      for (const h of SES_HEDEF) {
        if (h === 'mp2') ekle(h, 'ffmpeg', 'MPEG ses (MP2)');
        else ekle(h, 'ffmpeg');
      }
      ekle('mp4', 'ffmpeg', 'MP4 (siyah ekran ya da kapak görseliyle)');
      ekle('mpg', 'ffmpeg', 'MPEG video (MPG, siyah ekran ya da kapak görseliyle)');
      break;
    case 'gorsel':
      for (const h of GORSEL_HEDEF) ekle(h, 'gorsel');
      sonuc.push({ hedef: 'pdf', kategori: 'pdf', motor: 'gorsel', etiket: 'PDF' });
      break;
    case 'belge': {
      const motor = kaynak === 'md' ? 'markdown' : 'libreoffice';
      const liste = kaynak === 'pdf' ? ['docx', 'odt', 'txt'] : ['docx', 'odt', 'rtf', 'txt', 'html', 'pdf'];
      for (const h of liste) ekle(h, motor);
      // EPUB yazma: yalnız LibreOffice Writer ile açılabilen kaynaklar (Markdown ve PDF hariç)
      if (EPUB_KAYNAK.includes(kaynak)) ekle('epub', 'libreoffice');
      break;
    }
    case 'tablo':
      for (const h of ['xlsx', 'ods', 'csv', 'pdf', 'html']) ekle(h, 'libreoffice');
      if (kaynak === 'csv') for (const h of VERI_HEDEF) ekle(h, 'veri');
      break;
    case 'sunum':
      for (const h of ['pptx', 'odp', 'pdf']) ekle(h, 'libreoffice');
      break;
    case 'pdf':
      for (const h of ['docx', 'odt', 'txt']) ekle(h, 'libreoffice', `${ad(h)} (LibreOffice ile)`);
      break;
    case 'veri':
      for (const h of VERI_HEDEF) ekle(h, 'veri');
      break;
    case 'arsiv':
      if (kaynak === 'zip') sonuc.push({ hedef: 'zip-ac', kategori: 'arsiv', motor: 'arsiv', etiket: 'ZIP aç' });
      if (kaynak === 'gz') sonuc.push({ hedef: 'gz-ac', kategori: 'arsiv', motor: 'arsiv', etiket: 'GZIP aç' });
      break;
    default:
      break;
  }
  return sonuc;
}

const ISLEMLER = {
  video: [
    { id: 'kirp', ad: 'Kırp', secenekler: ['baslangic', 'bitis'] },
    { id: 'boyutlandir', ad: 'Boyutlandır', secenekler: ['genislik'] },
    { id: 'sikistir', ad: 'Sıkıştır', secenekler: ['kalite'] },
    { id: 'gif', ad: 'GIF yap', hedef: 'gif', secenekler: ['fps', 'genislik', 'baslangic', 'bitis'] },
    { id: 'sesi-cikar', ad: 'Sesi çıkar', hedef: 'mp3', secenekler: ['kalite'] },
  ],
  ses: [
    { id: 'kirp', ad: 'Kırp', secenekler: ['baslangic', 'bitis'] },
    { id: 'sikistir', ad: 'Sıkıştır', secenekler: ['kalite'] },
    { id: 'videoya-cevir', ad: 'Videoya çevir', hedef: 'mp4', secenekler: ['kapakGorseli', 'genislik'] },
  ],
  gorsel: [
    { id: 'boyutlandir', ad: 'Boyutlandır', secenekler: ['genislik'] },
    { id: 'sikistir', ad: 'Sıkıştır', secenekler: ['kalite'] },
    { id: 'pdf-yap', ad: 'PDF yap', hedef: 'pdf', secenekler: ['tekPdf', 'sayfa'] },
  ],
  belge: [],
  ekitap: [],
  tablo: [],
  sunum: [],
  pdf: [
    { id: 'birlestir', ad: 'Birleştir', hedef: 'birlestir', coklu: true, secenekler: [] },
    { id: 'bol', ad: 'Böl', hedef: 'bol', secenekler: ['sayfalar', 'ayri'] },
    { id: 'dondur', ad: 'Döndür', hedef: 'dondur', secenekler: ['aci', 'sayfalar'] },
    { id: 'gorsel-pdf', ad: 'Görselden PDF', hedef: 'gorsel-pdf', coklu: true, secenekler: ['sayfa'] },
    { id: 'pdf-word', ad: 'PDF → Word', hedef: 'docx', secenekler: [] },
  ],
  veri: [],
  arsiv: [
    { id: 'zip', ad: 'ZIP oluştur', hedef: 'zip', coklu: true, secenekler: [] },
    { id: 'zip-ac', ad: 'ZIP aç', hedef: 'zip-ac', secenekler: ['maksToplamBoyut', 'maksDosya'] },
    { id: 'gz', ad: 'GZIP sıkıştır', hedef: 'gz', secenekler: [] },
    { id: 'gz-ac', ad: 'GZIP aç', hedef: 'gz-ac', secenekler: ['maksToplamBoyut'] },
  ],
};

function islemler(kategori) {
  return (ISLEMLER[kategori] || []).map((o) => ({ ...o, secenekler: [...o.secenekler] }));
}

module.exports = { KATEGORILER, EPUB_KAYNAK, BICIMLER, hedefler, islemler, kanonik };
