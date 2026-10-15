'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { Marked } = require('marked');
const yollar = require('../yollar');
const libreoffice = require('./libreoffice');
const { kanonik } = require('../katalog');

const MAKS_BAYT = 32 * 1024 * 1024;

function kacis(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function guvenliBaglanti(href) {
  const h = String(href || '').trim();
  if (h === '' || h.startsWith('#')) return true;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (!m) return true; // göreli
  return ['http', 'https', 'mailto'].includes(m[1].toLowerCase());
}

function guvenliResim(href) {
  return /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(String(href || '').trim());
}

function olusturMarked() {
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      // ham HTML asla çalışmasın: metin olarak bas
      html(token) { return kacis(token.text != null ? token.text : token.raw); },
    },
    walkTokens(token) {
      if (token.type === 'link' && !guvenliBaglanti(token.href)) token.href = '#';
      if (token.type === 'image' && !guvenliResim(token.href)) {
        // uzak/yerel resim yüklenmesin (internet erişimi yok): alt metne dön
        token.type = 'text';
        token.text = token.text || '';
        token.raw = token.text;
        delete token.tokens;
      }
    },
  });
  return m;
}

function htmlBelgesi(metin, baslik) {
  const marked = olusturMarked();
  const govde = marked.parse(String(metin), { async: false });
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${kacis(baslik)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;line-height:1.5;max-width:50em;margin:2em auto}code,pre{font-family:Consolas,monospace;background:#f4f4f4}pre{padding:.6em;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.3em .6em}blockquote{border-left:4px solid #ccc;margin-left:0;padding-left:1em;color:#555}</style>
</head><body>
${govde}
</body></html>
`;
}

async function calistir(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const hedef = kanonik(ctx.hedef);
  const st = await fsp.stat(girdi);
  if (st.size > MAKS_BAYT) throw new Error('Markdown dosyası çok büyük (32 MB sınırı).');
  let metin = await fsp.readFile(girdi, 'utf8');
  if (metin.charCodeAt(0) === 0xfeff) metin = metin.slice(1);
  const ad = yollar.govdeAdi(girdi);
  const html = htmlBelgesi(metin, ad);

  if (hedef === 'html') {
    return yollar.guvenliUret(ctx.ciktiKlasoru, ad, 'html', async (gecici) => {
      await fsp.writeFile(gecici, html, { encoding: 'utf8', flag: 'wx' });
    });
  }
  const klasor = await fsp.mkdtemp(path.join(ctx.geciciKlasor, 'md-'));
  try {
    const araHtml = path.join(klasor, `${yollar.temizAd(ad)}.html`);
    await fsp.writeFile(araHtml, html, 'utf8');
    return await libreoffice.calistir({
      ...ctx,
      girdiler: [araHtml],
      // çıktı adı özgün Markdown adından gelsin
      kaynakKategori: 'belge',
      ciktiAdi: ad,
    });
  } finally {
    await fsp.rm(klasor, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { calistir, htmlBelgesi };
