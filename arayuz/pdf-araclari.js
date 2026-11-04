// PDF -> görsel ve PDF -> metin: pdf.js ile arayüz tarafında çalışır.
// Paketlemede gereken dosyalar: node_modules/pdfjs-dist/legacy/build/pdf.min.mjs ve pdf.worker.min.mjs
// (isteğe bağlı: standard_fonts/, cmaps/, wasm/, iccs/ klasörleri).
const PDFJS_KOK = '../node_modules/pdfjs-dist/';
const PDFJS_URL = new URL(PDFJS_KOK + 'legacy/build/pdf.min.mjs', import.meta.url).href;
const WORKER_URL = new URL(PDFJS_KOK + 'legacy/build/pdf.worker.min.mjs', import.meta.url).href;
const KAYNAK_URL = (alt) => new URL(PDFJS_KOK + alt, import.meta.url).href;

const MAKS_PIKSEL = 30e6;    // tek sayfa için üst sınır (bellek koruması; canvas ~120 MB RGBA)
const MAKS_KENAR = 10000;

let _pdfjs = null;
export async function pdfjsYukle() {
  if (!_pdfjs) {
    _pdfjs = import(PDFJS_URL).then((m) => {
      m.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return m;
    });
    _pdfjs.catch(() => { _pdfjs = null; });
  }
  return _pdfjs;
}

export async function pdfAc(veri) {
  const pdfjs = await pdfjsYukle();
  const gorev = pdfjs.getDocument({
    data: veri,
    standardFontDataUrl: KAYNAK_URL('standard_fonts/'),
    cMapUrl: KAYNAK_URL('cmaps/'),
    cMapPacked: true,
    wasmUrl: KAYNAK_URL('wasm/'),
    iccUrl: KAYNAK_URL('iccs/'),
    isEvalSupported: false,
    enableXfa: false
  });
  return gorev.promise;
}

// "1-3,5" -> [1,2,3,5]; "3-" -> 3..son; "-5" -> 1..5; boş ise tüm sayfalar. Boş parça ya da geçersizse hata.
// Gramer çekirdekteki src/motorlar/pdf.js:sayfaListesi ile aynıdır (orada 0 tabanlı dizin döner).
export function sayfaListesi(metin, toplam) {
  const m = String(metin || '').trim();
  if (!m) return Array.from({ length: toplam }, (_, i) => i + 1);
  const sonuc = new Set();
  for (const parca of m.split(',')) {
    const p = parca.trim();
    if (!p) throw new Error('Geçersiz sayfa aralığı: boş parça var.');
    let r;
    let a;
    let b;
    if ((r = /^(\d+)$/.exec(p))) { a = Number(r[1]); b = a; }
    else if ((r = /^(\d+)\s*-\s*(\d+)$/.exec(p))) { a = Number(r[1]); b = Number(r[2]); }
    else if ((r = /^(\d+)\s*-$/.exec(p))) { a = Number(r[1]); b = toplam; }
    else if ((r = /^-\s*(\d+)$/.exec(p))) { a = 1; b = Number(r[1]); }
    else throw new Error(`Geçersiz sayfa aralığı: "${p}"`);
    if (a < 1 || b < a || b > toplam) throw new Error(`Sayfa aralığı 1-${toplam} içinde olmalı: "${p}"`);
    for (let i = a; i <= b; i++) sonuc.add(i);
  }
  return [...sonuc].sort((x, y) => x - y);
}

// Dönen canvas'ın olcekKisildi alanı, bellek sınırı yüzünden düşürülen ölçeği taşır (yoksa null).
export async function sayfaCiz(belge, no, olcek) {
  const sayfa = await belge.getPage(no);
  let ol = Number(olcek) > 0 ? Number(olcek) : 1;
  let kisildi = null;
  let gorunum = sayfa.getViewport({ scale: ol });
  const oran = Math.min(1, Math.sqrt(MAKS_PIKSEL / (gorunum.width * gorunum.height)), MAKS_KENAR / Math.max(gorunum.width, gorunum.height));
  if (oran < 1) { ol *= oran; kisildi = ol; gorunum = sayfa.getViewport({ scale: ol }); }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(gorunum.width));
  canvas.height = Math.max(1, Math.floor(gorunum.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await sayfa.render({ canvasContext: ctx, canvas, viewport: gorunum }).promise;
  sayfa.cleanup();
  canvas.olcekKisildi = kisildi;
  return canvas;
}

export function canvasBayt(canvas, uzanti) {
  const tur = uzanti === 'jpg' ? 'image/jpeg' : 'image/png';
  return new Promise((coz, red) => {
    canvas.toBlob(async (b) => {
      if (!b) return red(new Error('Görsel oluşturulamadı.'));
      coz(new Uint8Array(await b.arrayBuffer()));
    }, tur, 0.92);
  });
}

export async function sayfaMetni(belge, no) {
  const sayfa = await belge.getPage(no);
  const icerik = await sayfa.getTextContent();
  let s = '';
  for (const o of icerik.items) {
    if (typeof o.str !== 'string') continue;
    s += o.str + (o.hasEOL ? '\n' : '');
  }
  sayfa.cleanup();
  return s.trimEnd();
}

/**
 * PDF -> PNG/JPG. Her sayfa canvas'a çizilir ve ana sürece kaydettirilir.
 * secenek: { yol, uzanti:'png'|'jpg', olcek, sayfalar, ciktiKlasoru, ilerleme(yuzde, metin), iptal:()=>bool }
 */
export async function pdfGorselYap(api, s) {
  const belge = await pdfAc(await api.pdfOku(s.yol));
  try {
    const liste = sayfaListesi(s.sayfalar, belge.numPages);
    const ciktilar = [];
    let not = '';   // ölçek kısıldıysa sonraki sayfalarda da görünür
    for (let i = 0; i < liste.length; i++) {
      if (s.iptal && s.iptal()) break;
      s.ilerleme && s.ilerleme(Math.round((i / liste.length) * 100), `Sayfa ${liste[i]} / ${belge.numPages}${not}`);
      const canvas = await sayfaCiz(belge, liste[i], s.olcek);
      if (canvas.olcekKisildi && s.ilerleme) {
        const x = (Math.floor(canvas.olcekKisildi * 100) / 100).toLocaleString('tr-TR');
        not = ` (ölçek ${x}x'e düşürüldü)`;
        s.ilerleme(Math.round((i / liste.length) * 100), `Sayfa ${liste[i]} / ${belge.numPages}${not}`);
      }
      const veri = await canvasBayt(canvas, s.uzanti);
      canvas.width = canvas.height = 0;
      ciktilar.push(await api.pdfSayfaKaydet({ kaynak: s.yol, sayfa: liste[i], toplam: belge.numPages, uzanti: s.uzanti, veri, ciktiKlasoru: s.ciktiKlasoru }));
    }
    s.ilerleme && s.ilerleme(100, s.iptal && s.iptal() ? 'İptal edildi' : 'Bitti');
    return ciktilar;
  } finally {
    belge.destroy();
  }
}

/** PDF -> tek bir .txt dosyası. */
export async function pdfMetinYap(api, s) {
  const belge = await pdfAc(await api.pdfOku(s.yol));
  try {
    const liste = sayfaListesi(s.sayfalar, belge.numPages);
    const parcalar = [];
    for (let i = 0; i < liste.length; i++) {
      if (s.iptal && s.iptal()) break;
      s.ilerleme && s.ilerleme(Math.round((i / liste.length) * 100), `Sayfa ${liste[i]} / ${belge.numPages}`);
      parcalar.push(`--- Sayfa ${liste[i]} ---\n${await sayfaMetni(belge, liste[i])}`);
    }
    const metin = parcalar.join('\n\n');
    const bos = !metin.replace(/--- Sayfa \d+ ---/g, '').trim();
    if (s.iptal && s.iptal()) {
      if (bos) return [];
    } else if (bos) {
      throw new Error('Bu PDF\'de seçilebilir metin yok (taranmış görsel olabilir).');
    }
    s.ilerleme && s.ilerleme(100, 'Bitti');
    return [await api.metinKaydet({ kaynak: s.yol, metin, ciktiKlasoru: s.ciktiKlasoru })];
  } finally {
    belge.destroy();
  }
}
