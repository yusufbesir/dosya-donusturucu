'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yollar = require('../yollar');
const surec = require('../surec');
const { BICIMLER, kanonik } = require('../katalog');

const VARSAYILAN_ZAMAN_ASIMI = 5 * 60 * 1000;
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
  const oge = (ad, tur, deger) => ogeYol('/org.openoffice.Inet/Settings', ad, deger);
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${[
    oge('ooInetProxyType', 'int', 1),
    oge('ooInetHTTPProxyName', 'string', '127.0.0.1'), oge('ooInetHTTPProxyPort', 'int', 9),
    oge('ooInetHTTPSProxyName', 'string', '127.0.0.1'), oge('ooInetHTTPSProxyPort', 'int', 9),
    oge('ooInetFTPProxyName', 'string', '127.0.0.1'), oge('ooInetFTPProxyPort', 'int', 9),
    oge('ooInetNoProxy', 'string', ''),
    // Makrolar kapalı ve en yüksek güvenlik; dış bağlantılar güncellenmez
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'MacroSecurityLevel', 3),
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'DisableMacrosExecution', 'true'),
    ogeYol('/org.openoffice.Office.Common/Security/Scripting', 'BlockUntrustedRefererLinks', 'true'),
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
function cssTemizle(metin) {
  let c = String(metin).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
  if (c.includes('\\')) c = cssKacislariniCoz(c);
  c = c.replace(/@import\b(?:\s*url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|\s*"[^"]*"|\s*'[^']*'|[^;{}])*;?/gi, '');
  c = c.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (m, a, b, d) => {
    const v = a !== undefined ? a : b !== undefined ? b : d;
    return uzakMi(v) ? 'url()' : m;
  });
  c = c.replace(/"([^"]*)"|'([^']*)'/g, (m, a, b) => (uzakMi(a !== undefined ? a : b) ? '""' : m));
  return c.replace(/</g, '\\3c '); // </style> ile dışarı çıkılamasın
}

const ATILAN_ELEMANLAR = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base',
  'noembed', 'noframes', 'xmp', 'plaintext', 'animate', 'set', 'portal']);
const URL_NITELIKLERI = new Set(['src', 'href', 'background', 'poster', 'data', 'action', 'formaction', 'ping',
  'longdesc', 'lowsrc', 'dynsrc', 'manifest', 'codebase', 'cite', 'profile', 'archive', 'classid', 'icon']);
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

function nitelikleriTemizle(n) {
  if (!Array.isArray(n.attrs)) return;
  n.attrs = n.attrs.filter((a) => {
    const ad = a.name.toLowerCase();
    if (!/^[a-z0-9_:.\-]+$/.test(ad)) return false; // bozuk etiketten doğan tuhaf nitelik adları (örn. "<script")
    const tamAd = a.prefix ? `${a.prefix}:${ad}` : ad;
    if (ad.startsWith('on') || tamAd.startsWith('on')) return false;
    const son = tamAd.split(':').pop();
    if (URL_NITELIKLERI.has(son)) return !uzakMi(a.value);
    if (SRCSET_NITELIKLERI.has(son)) {
      a.value = String(a.value).split(',').map((x) => x.trim()).filter((x) => x && !uzakMi(x.split(/\s+/)[0])).join(', ');
      return true;
    }
    if (son === 'style') { a.value = cssTemizle(a.value); return true; }
    return true;
  });
}

function htmlTemizle(html) {
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
        if (ebeveyn === 'style') c.value = cssTemizle(c.value);
        continue;
      }
      if (c.nodeName === '#documentType') continue;
      // Yorumlar (koşullu yorumlar dahil) içerik değildir; başka bir ayrıştırıcıyla farklı yorumlanmasın diye atılır
      if (ozelOge(c) || c.nodeName === '#comment') {
        const hedefListe = (c.parentNode && c.parentNode.childNodes) || dugum.childNodes;
        const i = hedefListe.indexOf(c);
        if (i >= 0) hedefListe.splice(i, 1);
        continue;
      }
      nitelikleriTemizle(c);
      yigin.push(c);
    }
  }
  return parse5.serialize(belge);
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
  const zamanAsimi = Number(sec.zamanAsimi || ctx.zamanAsimi) || VARSAYILAN_ZAMAN_ASIMI;

  const profil = await fsp.mkdtemp(path.join(geciciKlasor, 'lo-profil-'));
  const cikis = await fsp.mkdtemp(path.join(geciciKlasor, 'lo-cikis-'));
  let girdiKlasoru = null;
  try {
    await profilAgiKapat(profil);
    let girdiDosyasi = girdi;
    if (kaynakUz === 'html') {
      // Temizlenmiş geçici kopya (özgün dosyaya dokunulmaz); latin1 ile bayt kaybı olmadan okunur/yazılır.
      girdiKlasoru = await fsp.mkdtemp(path.join(geciciKlasor, 'lo-girdi-'));
      girdiDosyasi = path.join(girdiKlasoru, path.basename(girdi));
      await fsp.writeFile(girdiDosyasi, htmlTemizle(await fsp.readFile(girdi, 'latin1')), 'latin1');
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
    const dosyalar = (await fsp.readdir(cikis)).filter((d) => d.toLowerCase().endsWith(`.${hedef}`));
    if (sonuc.kod !== 0 || dosyalar.length === 0) {
      const ozet = (sonuc.stderr || sonuc.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
      throw new Error(`LibreOffice dönüştüremedi${sonuc.kod !== 0 ? ` (kod ${sonuc.kod})` : ''}${ozet ? `: ${ozet}` : '.'}`);
    }
    if (ilerleme) ilerleme(90);
    const uretilen = path.join(cikis, dosyalar[0]);
    return await yollar.guvenliUret(ciktiKlasoru, ctx.ciktiAdi || yollar.govdeAdi(girdi), hedef, async (gecici) => {
      await fsp.copyFile(uretilen, gecici, 1 /* COPYFILE_EXCL */);
    });
  } finally {
    await fsp.rm(profil, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(cikis, { recursive: true, force: true }).catch(() => {});
    if (girdiKlasoru) await fsp.rm(girdiKlasoru, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { calistir, htmlTemizle, agKapatXcu, uzakMi, sofficeBul, sofficeAdaylari, SOFFICE_DOGRULANAMADI, VARSAYILAN_ZAMAN_ASIMI };
