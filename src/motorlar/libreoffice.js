'use strict';
// Ne: LibreOffice (soffice --headless) ile ofis belgesi dönüştürme motoru; HTML girdisini temizler, profili ağdan yalıtır.
// Sahibi: TaaDön dosya dönüştürücü işi. yazan: [Claude#libreoffice-inceleme-2026-11-04] (inceleme bulguları 1-6).
// Değiştirme kuralı: test/guvenlik.test.js ve test/libreoffice-ek.test.js geçmeli; silme yalnız Yusuf'un kararıyla, çöp kutusuna.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const yollar = require('../yollar');
const surec = require('../surec');
const { BICIMLER, kanonik } = require('../katalog');

const VARSAYILAN_ZAMAN_ASIMI = 5 * 60 * 1000;
const EN_AZ_ZAMAN_ASIMI = 10 * 1000;
const EN_COK_ZAMAN_ASIMI = 60 * 60 * 1000;

/** Zaman aşımı (ms): sayı değilse ya da [10 sn, 60 dk] dışındaysa varsayılan (5 dk). */
function zamanAsimiAl(deger) {
  const n = Number(deger);
  return Number.isFinite(n) && n >= EN_AZ_ZAMAN_ASIMI && n <= EN_COK_ZAMAN_ASIMI ? n : VARSAYILAN_ZAMAN_ASIMI;
}

const HATA_GENEL = 'LibreOffice bu belgeyi dönüştüremedi. Belge bozuk, şifreli ya da bu biçim desteklenmiyor olabilir.';
const HATA_ACILAMADI = 'Belge açılamadı (bozuk ya da desteklenmeyen biçim).';
const HATA_SIFRELI = 'Belge şifreli; önce şifresini kaldırın.';

/** soffice sonucunu ({kod, stderr, stdout}) kullanıcıya gösterilecek Türkçe metne çevirir.
 *  Ham çıktı yalnız parantez içinde, ilk 120 karakterle ve denetim karakterlerinden arındırılmış verilir. */
function loHataMetni({ kod, stderr, stdout } = {}) {
  const ham = `${stderr || ''}\n${stdout || ''}`;
  let mesaj = HATA_GENEL;
  if (/password/i.test(ham)) mesaj = HATA_SIFRELI;
  else if (/could not be loaded/i.test(ham)) mesaj = HATA_ACILAMADI;
  const satirlar = ham.split(/\r?\n/).map((x) => x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).filter(Boolean);
  const ozet = satirlar.slice(-3).join(' | ');
  const teknik = [kod !== 0 && kod != null ? `kod ${kod}` : '', ozet].filter(Boolean).join(': ').slice(0, 120);
  return teknik ? `${mesaj} (${teknik})` : mesaj;
}
const SOFFICE_DOGRULANAMADI = 'LibreOffice doğrulanamadı: soffice.exe dosyasının "The Document Foundation" imzası geçerli değil. Resmî LibreOffice kurun ya da Ayarlar sayfasından imzalı soffice.exe seçin.';

/** Olası soffice yollarını öncelik sırasıyla (var olanlar) döndürür: ozelYol (ayarlardan), programla gelen
 *  LibreOffice (gomuluKlasor/libreoffice/program), Windows kurulum klasörleri, Linux PATH.
 *  Her biri ayrıca doğrulanabilsin (Authenticode) diye hepsi listelenir. */
function sofficeAdaylari({ platform, env, ozelYol, gomuluKlasor } = {}) {
  const plt = platform || process.platform;
  const e = env || process.env;
  const liste = [];
  if (ozelYol && /^(soffice|libreoffice)(\.exe|\.bin|\.com)?$/i.test(path.basename(ozelYol)) && yollar.dosyaMi(ozelYol)) {
    liste.push(ozelYol);
  }
  if (gomuluKlasor) {
    const gomulu = path.join(gomuluKlasor, 'libreoffice', 'program', plt === 'win32' ? 'soffice.exe' : 'soffice');
    if (yollar.dosyaMi(gomulu)) liste.push(gomulu);
  }
  if (plt === 'win32') {
    const kokler = [e.ProgramFiles, e['ProgramFiles(x86)']];
    const adaylar = kokler.filter(Boolean).map((k) => path.join(k, 'LibreOffice', 'program', 'soffice.exe'));
    if (e.LOCALAPPDATA) adaylar.push(path.join(e.LOCALAPPDATA, 'Programs', 'LibreOffice', 'program', 'soffice.exe'));
    for (const a of adaylar) if (yollar.dosyaMi(a)) liste.push(a);
  } else {
    const p = yollar.pathteBul(['soffice', 'libreoffice'], e);
    if (p) liste.push(p);
  }
  return [...new Set(liste)];
}

/** İlk uygun soffice yolu ya da null. */
function sofficeBul(secenek = {}) {
  return sofficeAdaylari(secenek)[0] || null;
}

// Çıktı süzgeçleri: kaynak türüne göre
function disaAktarmaFiltresi(hedef, kaynakKategori) {
  if (hedef === 'pdf') return 'pdf';
  if (hedef === 'epub') return 'epub:EPUB'; // Writer EPUB dışa aktarma süzgeci (writer.xcd: "EPUB")
  if (kaynakKategori === 'tablo') {
    return { xlsx: 'xlsx:Calc MS Excel 2007 XML', ods: 'ods:calc8', csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
      html: 'html:HTML (StarCalc)' }[hedef] || hedef;
  }
  if (kaynakKategori === 'sunum') {
    return { pptx: 'pptx:Impress MS PowerPoint 2007 XML', odp: 'odp:impress8' }[hedef] || hedef;
  }
  return { docx: 'docx:MS Word 2007 XML', odt: 'odt:writer8', rtf: 'rtf:Rich Text Format',
    txt: 'txt:Text (encoded):UTF8', html: 'html:HTML (StarWriter)' }[hedef] || hedef;
}

function iceAktarmaFiltresi(kaynakUz) {
  switch (kaynakUz) {
    case 'pdf': return 'writer_pdf_import';
    case 'html': return 'HTML (StarWriter)';
    case 'txt': return 'Text (encoded):UTF8';
    case 'csv': return 'CSV:44,34,76,1';
    default: return null;
  }
}

// ---- Ağ erişimini kesme ----
function agKapatXcu() {
  const ogeYol = (yol, ad, deger) =>
    `<item oor:path="${yol}"><prop oor:name="${ad}" oor:op="fuse"><value>${deger}</value></prop></item>`;
  const oge = (ad, deger) => ogeYol('/org.openoffice.Inet/Settings', ad, deger);
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${[
    oge('ooInetProxyType', 1),
    oge('ooInetHTTPProxyName', '127.0.0.1'), oge('ooInetHTTPProxyPort', 9),
    oge('ooInetHTTPSProxyName', '127.0.0.1'), oge('ooInetHTTPSProxyPort', 9),
    oge('ooInetFTPProxyName', '127.0.0.1'), oge('ooInetFTPProxyPort', 9),
    oge('ooInetNoProxy', ''),
    // Makrolar kapalı ve en yüksek güvenlik; dış bağlantılar güncellenmez
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'MacroSecurityLevel', 3),
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'DisableMacrosExecution', 'true'),
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'BlockUntrustedRefererLinks', 'true'),
    // Etkin içerik (OLE/DDE/gömülü nesne güncelleme) ve eklentiler kapalı; Java sanal makinesi hiç başlatılmaz
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'DisableActiveContent', 'true'),
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'ExecutePlugins', 'false'),
    ogeYol('/org.openoffice.Office.Java/VirtualMachine', 'Enable', 'false'),
    ogeYol('/org.openoffice.Office.Writer/Content/Update', 'Link', 2),
    ogeYol('/org.openoffice.Office.Calc/Content/Update', 'Link', 2),
  ].join('\n')}
</oor:items>
`;
}

async function profilAgiKapat(profil) {
  await fsp.mkdir(path.join(profil, 'user'), { recursive: true });
  await fsp.writeFile(path.join(profil, 'user', 'registrymodifications.xcu'), agKapatXcu(), 'utf8');
}

// ---- HTML'deki uzak/yerel kaynak başvurularını temizleme (parse5 ile) ----
// Belge gerçek bir HTML ayrıştırıcısıyla ayrıştırılır, ağaç dolaşılır, tehlikeli öğeler atılır,
// başvuru taşıyan nitelikler ve <style> içeriği temizlenir, sonra yeniden yazılır.
// Düzenli ifadeyle etiket ayıklamak (bozuk etiket, büyük harf, entity vb. atlatmalar) bırakıldı.
const parse5 = require('parse5');

const IZINLI_SEMALAR = new Set(['data', 'mailto', 'tel']);

function uzakMi(v) {
  const cozulmus = String(v)
    .replace(/&#x([0-9a-f]+);?/gi, (_m, x) => String.fromCodePoint(Math.min(parseInt(x, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&(colon|sol|bsol|Tab|NewLine);/gi, (_m, n) => ({ colon: ':', sol: '/', bsol: '\\', tab: '', newline: '' }[n.toLowerCase()]))
    .replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  if (/^[\/\\]/.test(cozulmus)) return true; // //, \\, kök-mutlak (/etc/...) ve \yol
  const sema = /^([a-z][a-z0-9+.\-]*):/i.exec(cozulmus);
  return !!sema && !IZINLI_SEMALAR.has(sema[1].toLowerCase()); // http, https, ftp, file, smb, C:\... vb.
}

function cssKacislariniCoz(s) {
  return s
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_m, x) => {
      const cp = parseInt(x, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
    })
    .replace(/\\([^0-9a-f\r\n\f])/gi, '$1');
}

// CSS metni: @import hepsi, uzak url(...) ve uzak dizgeler (image-set vb.) kaldırılır.
// cozumle (isteğe bağlı): göreli adresi file:/// mutlak adrese çevirir ya da null (atılır) döndürür.
function cssTemizle(metin, cozumle) {
  let c = String(metin).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
  if (c.includes('\\')) c = cssKacislariniCoz(c);
  c = c.replace(/@import\b(?:\s*url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|\s*"[^"]*"|\s*'[^']*'|[^;{}])*;?/gi, '');
  c = c.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (m, a, b, d) => {
    const v = a !== undefined ? a : b !== undefined ? b : d;
    if (uzakMi(v)) return 'url()';
    if (!cozumle) return m;
    const yeni = cozumle(v, true);
    if (yeni === undefined) return m;
    if (yeni === null) return 'url()';
    // Tırnaksız yazılır (aşağıdaki dizge süzgeci file: dizgelerini siler); ayırıcı karakterler yüzde kodlanır
    return `url(${yeni.replace(/[()'"\\\s]/g, (k) => `%${k.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})`;
  });
  c = c.replace(/"([^"]*)"|'([^']*)'/g, (m, a, b) => (uzakMi(a !== undefined ? a : b) ? '""' : m));
  return c.replace(/</g, '\\3c '); // </style> ile dışarı çıkılamasın
}

const ATILAN_ELEMANLAR = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base',
  'noembed', 'noframes', 'xmp', 'plaintext', 'animate', 'set', 'portal']);
const URL_NITELIKLERI = new Set(['src', 'href', 'background', 'poster', 'data', 'action', 'formaction', 'ping',
  'longdesc', 'lowsrc', 'dynsrc', 'manifest', 'codebase', 'cite', 'profile', 'archive', 'classid', 'icon']);
const GOMULEBILIR_NITELIKLER = new Set(['src', 'background', 'poster', 'lowsrc', 'dynsrc']);
const SRCSET_NITELIKLERI = new Set(['srcset', 'imagesrcset']);

function ozelOge(n) {
  if (n.nodeName === '#comment') return true;
  const ad = String(n.tagName || n.nodeName || '').toLowerCase();
  if (ATILAN_ELEMANLAR.has(ad)) return true;
  const nitelik = (a) => { const o = (n.attrs || []).find((x) => x.name.toLowerCase() === a); return o ? String(o.value) : null; };
  if (ad === 'link') {
    const rel = (nitelik('rel') || '').toLowerCase().split(/[\s]+/);
    return rel.some((r) => ['stylesheet', 'preload', 'import', 'prefetch', 'modulepreload', 'prerender'].includes(r));
  }
  if (ad === 'meta') return (nitelik('http-equiv') || '').trim().toLowerCase() === 'refresh';
  return false;
}

function nitelikleriTemizle(n, cozumle) {
  if (!Array.isArray(n.attrs)) return;
  n.attrs = n.attrs.filter((a) => {
    const ad = a.name.toLowerCase();
    if (!/^[a-z0-9_:.\-]+$/.test(ad)) return false; // bozuk etiketten doğan tuhaf nitelik adları (örn. "<script")
    const tamAd = a.prefix ? `${a.prefix}:${ad}` : ad;
    if (ad.startsWith('on') || tamAd.startsWith('on')) return false;
    const son = tamAd.split(':').pop();
    if (URL_NITELIKLERI.has(son)) {
      if (uzakMi(a.value)) return false;
      if (!cozumle) return true;
      const yeni = cozumle(a.value, GOMULEBILIR_NITELIKLER.has(son)); // yalnız görsel niteliklerinde gömülür (a href değil)
      if (yeni === null) return false;
      if (yeni !== undefined) a.value = yeni;
      return true;
    }
    if (SRCSET_NITELIKLERI.has(son)) {
      a.value = String(a.value).split(',').map((x) => x.trim()).filter((x) => x && !uzakMi(x.split(/\s+/)[0]))
        .map((x) => {
          if (!cozumle) return x;
          const [u, ...tanim] = x.split(/\s+/);
          const yeni = cozumle(u, true);
          if (yeni === null) return null;
          return yeni === undefined ? x : [yeni, ...tanim].join(' ');
        })
        .filter(Boolean).join(', ');
      return true;
    }
    if (son === 'style') { a.value = cssTemizle(a.value, cozumle); return true; }
    return true;
  });
}

// Gömülebilir yerel görsel türleri ve sınırlar. Neden gömülür: LibreOffice file:/// görsellerini DOCX/ODT'ye gömmez,
// kullanıcının yerel yoluna işaret eden dış bağlantı bırakır (belge taşınabilir olmaz, yerel yol sızar).
// SVG bilerek yok: betik taşıyabilir (güvenlik denetimi 2026-11-04); gömülmez, file:/// adresi kalır.
const GOMULU_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp' };
const GORSEL_AZAMI = 10 * 1024 * 1024;
const TOPLAM_GORSEL_AZAMI = 50 * 1024 * 1024;

/** Göreli adres çözücüsü: kaynak klasöre göre çözer; klasörün dışına çıkanı (../, mutlak) null ile attırır,
 *  kalanı file:/// mutlak adrese çevirir. Değiştirilmeyecekler (boş, #çapa, data:/mailto:/tel:) için undefined.
 *  cozumle(deger, gom=true) çağrısında ve yerel görsel (GOMULU_MIME) kaynak klasörde kalıyorsa dosya okunup
 *  data:<mime>;base64 olarak gömülür (her biri <= 10 MB, çözücü başına toplam <= 50 MB).
 *  Sınır aşılır, dosya okunamaz/yoksa ya da sembolik bağ klasör dışına çıkarsa gömme atlanır ve niteliğe file:/// adres
 *  kalır (eski davranış; dosya kaynak klasör içinde olduğundan güvenlik açısından zararsızdır, yalnız taşınabilir olmaz).
 *  Neden: temizlenmiş kopya ayrı geçici klasöre yazılır; göreli görseller orada bulunmaz, ../ ise dışarıdan dosya gömebilir. */
function goreliCozucu(kaynakKlasor) {
  const kok = path.resolve(kaynakKlasor);
  const taban = pathToFileURL(kok.endsWith(path.sep) ? kok : kok + path.sep);
  const kucuk = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
  const icerde = (kokYol, hedef) => {
    const g = path.relative(kucuk(kokYol), kucuk(hedef));
    return !!g && g !== '..' && !g.startsWith(`..${path.sep}`) && !path.isAbsolute(g);
  };
  const onbellek = new Map(); // dosya yolu -> data URI ya da null (dosya bir kez okunur)
  let toplam = 0;              // çıktıya giden toplam bayt: her kullanımda (önbellek isabeti dahil) sayılır
  let gercekKok = null;
  // Güvenlik (denetim 2026-11-04): yalnız HTML'in kendi klasörü ya da bir alt klasör derinliğindeki (ör. ad_files/img.png)
  // dosyalar gömülür; gerçek uzantı ve sihirli baytlar (PNG/JPEG/GIF/WEBP/BMP) türle uyuşmalı. Böylece başka klasörlerden
  // ya da görsel kılığındaki dosyalardan çıktı belgesine veri sızmaz.
  const derinlikUygun = (gercek) => path.relative(gercekKok, path.dirname(gercek)).split(path.sep).filter(Boolean).length <= 1;
  const sihirliUygun = (buf, mime) => {
    if (mime === 'image/png') return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (mime === 'image/gif') return buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8';
    if (mime === 'image/webp') return buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    if (mime === 'image/bmp') return buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d;
    return false;
  };
  const gom = (hedefYol) => {
    let sonuc = null;
    if (!onbellek.has(hedefYol)) {
      try {
        if (gercekKok === null) gercekKok = fs.realpathSync(kok);
        const gercek = fs.realpathSync(hedefYol);
        const mime = GOMULU_MIME[path.extname(gercek).toLowerCase()];
        if (mime && icerde(gercekKok, gercek) && derinlikUygun(gercek)) {
          const st = fs.statSync(gercek);
          if (st.isFile() && st.size <= GORSEL_AZAMI) {
            const buf = fs.readFileSync(gercek);
            if (buf.length <= GORSEL_AZAMI && sihirliUygun(buf, mime)) sonuc = `data:${mime};base64,${buf.toString('base64')}`;
          }
        }
      } catch { sonuc = null; }
      onbellek.set(hedefYol, sonuc);
    } else sonuc = onbellek.get(hedefYol);
    if (!sonuc) return null;
    if (toplam + sonuc.length > TOPLAM_GORSEL_AZAMI) return null; // bütçe aşımı: bu kullanımda gömülmez
    toplam += sonuc.length;
    return sonuc;
  };
  return (deger, gomulsun = false) => {
    const v = String(deger).trim();
    if (!v || v.startsWith('#') || /^[a-z][a-z0-9+.\-]*:/i.test(v)) return undefined;
    let u;
    try { u = new URL(v, taban); } catch { return null; }
    if (u.protocol !== 'file:' || u.host) return null;
    let hedefYol;
    try { hedefYol = fileURLToPath(u); } catch { return null; }
    if (!icerde(kok, path.resolve(hedefYol))) return null;
    if (gomulsun) {
      const veri = gom(path.resolve(hedefYol));
      if (veri) return veri;
    }
    // Gömülmeyen başvuru: file:/// adresi yalnız gerçek yolu (realpath) kaynak klasörde kalan, sembolik bağ olmayan,
    // görsel uzantılı normal dosya için bırakılır; aksi halde nitelik atılır (yerel dosya ekleme / bilgi sızması önlemi).
    try {
      if (gercekKok === null) gercekKok = fs.realpathSync(kok);
      const tam = path.resolve(hedefYol);
      const lst = fs.lstatSync(tam);
      if (lst.isSymbolicLink() || !lst.isFile()) return null;
      if (!GOMULU_MIME[path.extname(tam).toLowerCase()]) return null;
      if (!icerde(gercekKok, fs.realpathSync(tam))) return null;
    } catch { return null; }
    return u.href;
  };
}

/** <head> başına <meta charset="utf-8"> koyar (öncekiler temizlik sırasında atılmış olur). */
function utf8MetaEkle(belge) {
  const ta = parse5.defaultTreeAdapter;
  const html = (belge.childNodes || []).find((c) => c.tagName === 'html');
  const head = html && (html.childNodes || []).find((c) => c.tagName === 'head');
  if (!head) return;
  const meta = ta.createElement('meta', parse5.html.NS.HTML, [{ name: 'charset', value: 'utf-8' }]);
  meta.parentNode = head;
  head.childNodes.unshift(meta);
}

/** HTML'i temizler. secenek.kaynakKlasor verilirse göreli adresler o klasöre göre çözülür (goreliCozucu);
 *  secenek.utf8Meta true ise var olan charset bildirimleri atılıp <meta charset="utf-8"> eklenir. */
function htmlTemizle(html, secenek = {}) {
  const cozumle = secenek.kaynakKlasor ? goreliCozucu(secenek.kaynakKlasor) : null;
  const charsetMetaMi = (c) => {
    if (String(c.tagName || '').toLowerCase() !== 'meta') return false;
    const n = (a) => { const o = (c.attrs || []).find((x) => x.name.toLowerCase() === a); return o ? String(o.value) : null; };
    return n('charset') !== null || (n('http-equiv') || '').trim().toLowerCase() === 'content-type';
  };
  // scriptingEnabled:false -> <noscript> içeriği de öğe olarak ayrıştırılır ve temizlenir
  const belge = parse5.parse(String(html), { scriptingEnabled: false });
  const yigin = [belge];
  while (yigin.length) {
    const dugum = yigin.pop();
    const cocuklar = [];
    if (Array.isArray(dugum.childNodes)) cocuklar.push(...dugum.childNodes);
    if (dugum.content && Array.isArray(dugum.content.childNodes)) cocuklar.push(...dugum.content.childNodes); // <template>
    for (const c of cocuklar) {
      if (c.nodeName === '#text') {
        const ebeveyn = String(dugum.tagName || '').toLowerCase();
        if (ebeveyn === 'style') c.value = cssTemizle(c.value, cozumle);
        continue;
      }
      if (c.nodeName === '#documentType') continue;
      // Yorumlar (koşullu yorumlar dahil) içerik değildir; başka bir ayrıştırıcıyla farklı yorumlanmasın diye atılır
      if (ozelOge(c) || c.nodeName === '#comment' || (secenek.utf8Meta && charsetMetaMi(c))) {
        const hedefListe = (c.parentNode && c.parentNode.childNodes) || dugum.childNodes;
        const i = hedefListe.indexOf(c);
        if (i >= 0) hedefListe.splice(i, 1);
        continue;
      }
      nitelikleriTemizle(c, cozumle);
      yigin.push(c);
    }
  }
  if (secenek.utf8Meta) utf8MetaEkle(belge);
  return parse5.serialize(belge);
}

/** HTML baytlarını doğru çözer: BOM > <meta charset> (ilk 1024 bayt) > katı UTF-8 > windows-1252.
 *  (Eskiden latin1 okunup yazılıyordu; parse5 U+00A0'ı &nbsp; yazınca à=C3 A0, Š=C5 A0 gibi UTF-8 dizileri bozuluyordu.) */
function htmlBaytlariniCoz(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const coz = (etiket, bas = 0, fatal = false) => new TextDecoder(etiket, { fatal }).decode(b.subarray(bas));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { metin: coz('utf-8', 3), kodlama: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe) return { metin: coz('utf-16le', 2), kodlama: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { metin: coz('utf-16be', 2), kodlama: 'utf-16be' };
  const bas = b.subarray(0, 1024).toString('latin1');
  const m = /<meta\b[^>]*?charset\s*=\s*["']?\s*([a-z0-9_\-:.]+)/i.exec(bas);
  if (m) {
    try {
      let td = new TextDecoder(m[1]);
      if (/^utf-16/.test(td.encoding)) td = new TextDecoder('utf-8'); // HTML kuralı: meta ile utf-16 -> utf-8
      if (td.encoding !== 'utf-8') return { metin: td.decode(b), kodlama: td.encoding };
    } catch { /* bilinmeyen etiket: aşağıdaki sezgiye düş */ }
  }
  try { return { metin: coz('utf-8', 0, true), kodlama: 'utf-8' }; } catch { /* geçersiz UTF-8 */ }
  try { return { metin: coz('windows-1252'), kodlama: 'windows-1252' }; } catch { return { metin: b.toString('latin1'), kodlama: 'latin1' }; }
}

/** HTML dosya baytlarını temizleyip UTF-8 Buffer döndürür (meta charset=utf-8 garantili). */
function htmlDosyasiniTemizle(buf, kaynakKlasor) {
  const { metin } = htmlBaytlariniCoz(buf);
  return Buffer.from(htmlTemizle(metin, { kaynakKlasor, utf8Meta: true }), 'utf8');
}

// SVG yan dosyası gömülmez (betik taşıyabilir); yalnız bit eşlem türleri.
const GORSEL_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', webp: 'image/webp' };

/** LibreOffice HTML dışa aktarımının yan görsel dosyalarını (ad_html_*.png vb.) HTML'e data: URI olarak gömer.
 *  Seçim: yan dosyaları çıktı klasörüne ayrı ayrı taşımak, aynı adlı dosya varken benzersiz ada geçince HTML
 *  başvurularını bozar ve kullanıcının klasörünü kalabalıklaştırır; "EmbedImages" süzgeç seçeneği ise yalnız yeni
 *  Writer sürümlerinde var, Calc'ta yok. Bu yüzden tek, kendi kendine yeten bir HTML üretilir. Bayt korunumlu
 *  (latin1) işlenir; yalnız cikis klasöründeki bilinen görsel adlarına eşleşen src/href değerleri değiştirilir. */
function yanGorselleriGom(htmlBuf, yanDosyalar) {
  if (!yanDosyalar.size) return htmlBuf;
  const metin = htmlBuf.toString('latin1');
  const yeni = metin.replace(/\b(src|href)(\s*=\s*)(["'])([^"']*)\3/gi, (m, ad, esit, tirnak, deger) => {
    let v = Buffer.from(deger, 'latin1').toString('utf8');
    try { v = decodeURIComponent(v); } catch { /* yüzde kodlu değil */ }
    v = v.replace(/^\.\//, '');
    if (/[\\/]/.test(v)) return m; // alt klasör ya da mutlak yol: dokunma
    const veri = yanDosyalar.get(v);
    return veri ? `${ad}${esit}${tirnak}${veri}${tirnak}` : m;
  });
  return Buffer.from(yeni, 'latin1');
}

async function calistir(ctx) {
  const { girdiler, ciktiKlasoru, sofficeYolu, sinyal, ilerleme, geciciKlasor } = ctx;
  const sec = ctx.secenekler || {};
  const girdi = yollar.girdiYolu(girdiler[0]);
  const hedef = kanonik(ctx.hedef);
  const kaynakUz = kanonik(yollar.uzantiAl(girdi));
  if (!sofficeYolu) throw new Error(ctx.sofficeDurumu === 'dogrulanamadi' ? SOFFICE_DOGRULANAMADI : 'LibreOffice bulunamadı. Lütfen LibreOffice kurun ya da yolunu ayarlardan seçin.');
  const bilgi = BICIMLER[kaynakUz];
  const kategori = ctx.kaynakKategori || (bilgi && bilgi.kategori) || 'belge';
  const zamanAsimi = zamanAsimiAl(sec.zamanAsimi || ctx.zamanAsimi);

  const profil = await fsp.mkdtemp(path.join(geciciKlasor, 'lo-profil-'));
  const cikis = await fsp.mkdtemp(path.join(geciciKlasor, 'lo-cikis-'));
  let girdiKlasoru = null;
  try {
    await profilAgiKapat(profil);
    let girdiDosyasi = girdi;
    if (kaynakUz === 'html') {
      // Temizlenmiş geçici kopya (özgün dosyaya dokunulmaz): baytlar doğru kodlamayla çözülür, UTF-8 yazılır;
      // göreli adresler kaynak klasöre göre file:/// mutlak adrese çevrilir, klasör dışına çıkanlar atılır.
      girdiKlasoru = await fsp.mkdtemp(path.join(geciciKlasor, 'lo-girdi-'));
      girdiDosyasi = path.join(girdiKlasoru, path.basename(girdi));
      await fsp.writeFile(girdiDosyasi, htmlDosyasiniTemizle(await fsp.readFile(girdi), path.dirname(girdi)));
    }
    const profilUrl = pathToFileURL(profil).href;
    const infiltre = iceAktarmaFiltresi(kaynakUz);
    const args = [
      '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nologo',
      `-env:UserInstallation=${profilUrl}`,
      ...(infiltre ? [`--infilter=${infiltre}`] : []),
      '--convert-to', disaAktarmaFiltresi(hedef, kategori),
      '--outdir', cikis,
      girdiDosyasi,
    ];
    if (ilerleme) ilerleme(5);
    const sonuc = await surec.calistir(sofficeYolu, args, { sinyal, zamanAsimi, env: process.env });
    if (sinyal && sinyal.aborted) throw surec.iptalHatasi();
    const tumu = await fsp.readdir(cikis);
    const dosyalar = tumu.filter((d) => d.toLowerCase().endsWith(`.${hedef}`));
    if (sonuc.kod !== 0 || dosyalar.length === 0) throw new Error(loHataMetni(sonuc));
    if (ilerleme) ilerleme(90);
    const uretilen = path.join(cikis, dosyalar[0]);
    if (hedef === 'html') {
      const yan = new Map();
      for (const d of tumu) {
        const mime = GORSEL_MIME[String(path.extname(d)).slice(1).toLowerCase()];
        if (!mime || d === dosyalar[0]) continue;
        const st = await fsp.lstat(path.join(cikis, d)).catch(() => null);
        if (st && st.isFile()) yan.set(d, `data:${mime};base64,${(await fsp.readFile(path.join(cikis, d))).toString('base64')}`);
      }
      const html = yanGorselleriGom(await fsp.readFile(uretilen), yan);
      return await yollar.guvenliUret(ciktiKlasoru, ctx.ciktiAdi || yollar.govdeAdi(girdi), hedef, async (gecici) => {
        await fsp.writeFile(gecici, html, { flag: 'wx' });
      });
    }
    return await yollar.guvenliUret(ciktiKlasoru, ctx.ciktiAdi || yollar.govdeAdi(girdi), hedef, async (gecici) => {
      await fsp.copyFile(uretilen, gecici, 1 /* COPYFILE_EXCL */);
    });
  } finally {
    await fsp.rm(profil, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(cikis, { recursive: true, force: true }).catch(() => {});
    if (girdiKlasoru) await fsp.rm(girdiKlasoru, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { calistir, disaAktarmaFiltresi, iceAktarmaFiltresi, htmlTemizle, htmlBaytlariniCoz, htmlDosyasiniTemizle,
  goreliCozucu, yanGorselleriGom, loHataMetni, zamanAsimiAl, agKapatXcu, uzakMi, sofficeBul, sofficeAdaylari,
  SOFFICE_DOGRULANAMADI, VARSAYILAN_ZAMAN_ASIMI };
