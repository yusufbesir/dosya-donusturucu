'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const yollar = require('../yollar');
const surec = require('../surec');
const { BICIMLER, kanonik } = require('../katalog');

const VARSAYILAN_ZAMAN_ASIMI = 5 * 60 * 1000;

/** soffice yolu: ozelYol (ayarlardan), Windows kurulum klasörleri, Linux PATH. Bulamazsa null. */
function sofficeBul({ platform, env, ozelYol } = {}) {
  const plt = platform || process.platform;
  const e = env || process.env;
  if (ozelYol && /^(soffice|libreoffice)(\.exe|\.bin|\.com)?$/i.test(path.basename(ozelYol)) && yollar.dosyaMi(ozelYol)) {
    return ozelYol;
  }
  if (plt === 'win32') {
    const kokler = [e.ProgramFiles, e['ProgramFiles(x86)']];
    const adaylar = kokler.filter(Boolean).map((k) => path.join(k, 'LibreOffice', 'program', 'soffice.exe'));
    if (e.LOCALAPPDATA) adaylar.push(path.join(e.LOCALAPPDATA, 'Programs', 'LibreOffice', 'program', 'soffice.exe'));
    for (const a of adaylar) if (yollar.dosyaMi(a)) return a;
    return null;
  }
  return yollar.pathteBul(['soffice', 'libreoffice'], e);
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
  const oge = (ad, tur, deger) =>
    `<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="${ad}" oor:op="fuse"><value>${deger}</value></prop></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${[
    oge('ooInetProxyType', 'int', 1),
    oge('ooInetHTTPProxyName', 'string', '127.0.0.1'), oge('ooInetHTTPProxyPort', 'int', 9),
    oge('ooInetHTTPSProxyName', 'string', '127.0.0.1'), oge('ooInetHTTPSProxyPort', 'int', 9),
    oge('ooInetFTPProxyName', 'string', '127.0.0.1'), oge('ooInetFTPProxyPort', 'int', 9),
    oge('ooInetNoProxy', 'string', ''),
  ].join('\n')}
</oor:items>
`;
}

async function profilAgiKapat(profil) {
  await fsp.mkdir(path.join(profil, 'user'), { recursive: true });
  await fsp.writeFile(path.join(profil, 'user', 'registrymodifications.xcu'), agKapatXcu(), 'utf8');
}

// ---- HTML'deki uzak/yerel kaynak başvurularını temizleme ----
const UZAK_RE = /^(?:https?:|ftp:|file:|\/\/|\\\\|\/\\|\\\/)/i;
function uzakMi(v) {
  const cozulmus = String(v)
    .replace(/&#x([0-9a-f]+);?/gi, (_m, x) => String.fromCodePoint(Math.min(parseInt(x, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&(colon|sol|bsol|Tab|NewLine);/gi, (_m, n) => ({ colon: ':', sol: '/', bsol: '\\', tab: '', newline: '' }[n.toLowerCase()]))
    .replace(/[\u0000-  ]/g, '');
  return UZAK_RE.test(cozulmus);
}

function htmlTemizle(html) {
  let h = String(html);
  // script ve stylesheet bağlantıları
  h = h.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*>/gi, '');
  h = h.replace(/<link\b[^>]*>/gi, (etiket) => (/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(etiket) ? '' : etiket));
  // nitelikler
  h = h.replace(/(\s)(src|href|background|poster|data|action|formaction|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (m, bosluk, ad, ham, c, t, bos) => {
      const v = c !== undefined ? c : t !== undefined ? t : bos;
      return uzakMi(v) ? `${bosluk}${ad}=""` : m;
    });
  h = h.replace(/(\s)srcset\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, bosluk, ham, c, t, bos) => {
    const v = c !== undefined ? c : t !== undefined ? t : bos;
    const temiz = v.split(',').map((x) => x.trim()).filter((x) => x && !uzakMi(x.split(/\s+/)[0]));
    return `${bosluk}srcset="${temiz.join(', ')}"`;
  });
  // CSS url(...) ve @import
  h = h.replace(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi, (m, _q, v) => (uzakMi(v) ? 'url()' : m));
  h = h.replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]*)\1\s*\)?[^;]*;?/gi, (m, _q, v) => (uzakMi(v) ? '' : m));
  return h;
}

async function calistir(ctx) {
  const { girdiler, ciktiKlasoru, sofficeYolu, sinyal, ilerleme, geciciKlasor } = ctx;
  const sec = ctx.secenekler || {};
  const girdi = yollar.girdiYolu(girdiler[0]);
  const hedef = kanonik(ctx.hedef);
  const kaynakUz = kanonik(yollar.uzantiAl(girdi));
  if (!sofficeYolu) throw new Error('LibreOffice bulunamadı. Lütfen LibreOffice kurun ya da yolunu ayarlardan seçin.');
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

module.exports = { calistir, htmlTemizle, agKapatXcu, uzakMi, sofficeBul, VARSAYILAN_ZAMAN_ASIMI };
