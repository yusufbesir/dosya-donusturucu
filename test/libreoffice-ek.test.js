'use strict';
// Ne: src/motorlar/libreoffice.js inceleme bulguları (kodlama, göreli URL, XCU yalıtımı, hata metni, zaman aşımı,
//     HTML yan görselleri) için soffice gerektirmeyen birim testleri.
// Sahibi: TaaDön dosya dönüştürücü işi. yazan: [Claude#libreoffice-inceleme-2026-11-04]
// Değiştirme kuralı: davranış değişince birlikte güncellenir; silme yalnız Yusuf'un kararıyla, çöp kutusuna.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const lo = require('../src/motorlar/libreoffice');

test('kodlama: UTF-8 HTML temizlenince à Š NBSP bozulmaz, meta charset=utf-8 eklenir', () => {
  const ham = Buffer.from('<html><head><meta charset="iso-8859-9"></head><body><p>à Š son</p></body></html>', 'utf8');
  // meta yanlış (iso-8859-9) bildirse bile çıktı tek utf-8 meta taşımalı; burada önce bildirimsiz durumu deneyelim
  const bildirimsiz = Buffer.from('<p>à Š son</p>', 'utf8');
  const cikti = lo.htmlDosyasiniTemizle(bildirimsiz, os.tmpdir()).toString('utf8');
  const metin = cikti.replace(/&nbsp;/g, ' ');
  assert.ok(metin.includes('à Š son'), cikti);
  assert.match(cikti, /<head><meta charset="utf-8">/);
  assert.equal((cikti.match(/charset/gi) || []).length, 1);
  // Bildirilen kodlamaya uyulur ve eski bildirim atılır
  const tr = lo.htmlBaytlariniCoz(ham);
  assert.equal(tr.kodlama, 'windows-1254');
  const c2 = lo.htmlDosyasiniTemizle(ham, os.tmpdir()).toString('utf8');
  assert.ok(!/iso-8859-9/i.test(c2));
  assert.equal((c2.match(/charset/gi) || []).length, 1);
});

test('kodlama: BOM, geçersiz UTF-8 -> windows-1252, meta windows-1254', () => {
  assert.equal(lo.htmlBaytlariniCoz(Buffer.from([0xef, 0xbb, 0xbf, 0x61])).metin, 'a');
  assert.equal(lo.htmlBaytlariniCoz(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ş', 'utf16le')])).metin, 'ş');
  const r = lo.htmlBaytlariniCoz(Buffer.from([0x3c, 0x70, 0x3e, 0xe0, 0x80, 0xa0])); // geçersiz UTF-8
  assert.equal(r.kodlama, 'windows-1252');
  assert.equal(r.metin, '<p>à€ ');
  const tr = lo.htmlBaytlariniCoz(Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=windows-1254"><p>'), Buffer.from([0xfe, 0xf0])]));
  assert.ok(tr.metin.endsWith('şğ'));
});

test('göreli URL: ../ atılır, img/a.png mutlak file:/// olur, #çapa ve data: korunur', () => {
  const kok = path.join(os.tmpdir(), 'taadon-kaynak', 'belge');
  const h = lo.htmlTemizle('<img src="../gizli.png"><img src="img/a.png"><img src="../../Users/x/y.png">' +
    '<img src="img/../../kacis.png"><a href="#k">k</a><img src="data:image/png;base64,AA">' +
    '<img srcset="img/b.png 1x, ../c.png 2x"><div style="background:url(&quot;img/d (1).png&quot;)"></div>' +
    '<style>p{background:url("../e.png")} q{background:url(\'img/f.png\')}</style>', { kaynakKlasor: kok });
  const beklenen = pathToFileURL(path.join(kok, 'img', 'a.png')).href;
  assert.ok(beklenen.startsWith('file:///'));
  assert.ok(h.includes(`src="${beklenen}"`), h);
  assert.ok(!/gizli|\/x\/y\.png|kacis|c\.png|e\.png/.test(h), h);
  assert.match(h, /href="#k"/);
  assert.match(h, /src="data:image\/png;base64,AA"/);
  assert.ok(h.includes(`srcset="${pathToFileURL(path.join(kok, 'img', 'b.png')).href} 1x"`), h);
  assert.ok(h.includes(`url(${pathToFileURL(path.join(kok, 'img', 'f.png')).href})`), h);
  assert.match(h, /url\(file:\/\/\/[^)"']*img\/d%20%281%29\.png\)/, h);
  // kaynakKlasor verilmezse eski davranış (göreli bırakılır)
  assert.match(lo.htmlTemizle('<img src="img/a.png">'), /src="img\/a\.png"/);
});

test('XCU: etkin içerik, eklentiler ve Java kapalı', () => {
  const x = lo.agKapatXcu();
  const yol = (p, ad, d) => new RegExp(`oor:path="${p.replace(/\//g, '\\/').replace(/\./g, '\\.')}"><prop oor:name="${ad}" oor:op="fuse"><value>${d}</value>`);
  assert.match(x, yol('/org.openoffice.Office.Common/Security/Scripting', 'DisableActiveContent', 'true'));
  assert.match(x, yol('/org.openoffice.Office.Common/Security/Scripting', 'ExecutePlugins', 'false'));
  assert.match(x, yol('/org.openoffice.Office.Java/VirtualMachine', 'Enable', 'false'));
  assert.match(x, /ooInetProxyType"[^>]*><value>1</);
});

test('hata metni: ham çıktı yerine Türkçe açıklama, teknik özet parantezde ≤120 karakter', () => {
  const genel = lo.loHataMetni({ kod: 1, stderr: 'x'.repeat(500) });
  assert.ok(genel.startsWith('LibreOffice bu belgeyi dönüştüremedi. Belge bozuk, şifreli ya da bu biçim desteklenmiyor olabilir. ('));
  const teknik = /\((.*)\)$/.exec(genel)[1];
  assert.ok(teknik.length <= 120 && teknik.startsWith('kod 1: '), teknik);
  assert.ok(lo.loHataMetni({ kod: 1, stderr: 'Error: source file could not be loaded' })
    .startsWith('Belge açılamadı (bozuk ya da desteklenmeyen biçim). ('));
  assert.ok(lo.loHataMetni({ kod: 0, stdout: 'Error: wrong password\n' }).startsWith('Belge şifreli; önce şifresini kaldırın. (Error: wrong password)'));
  assert.equal(lo.loHataMetni({ kod: 0 }), 'LibreOffice bu belgeyi dönüştüremedi. Belge bozuk, şifreli ya da bu biçim desteklenmiyor olabilir.');
  assert.ok(!/[\u0000-\u001f]/.test(lo.loHataMetni({ kod: 2, stderr: 'a\u001b[31mb\tc' })));
});

test('zaman aşımı: [10 sn, 60 dk] dışı ve sayı olmayan varsayılana çekilir', () => {
  const V = lo.VARSAYILAN_ZAMAN_ASIMI;
  for (const d of [undefined, null, 'abc', NaN, Infinity, -5, 0, 50, 9999, 60 * 60 * 1000 + 1]) assert.equal(lo.zamanAsimiAl(d), V, String(d));
  assert.equal(lo.zamanAsimiAl(10000), 10000);
  assert.equal(lo.zamanAsimiAl('240000'), 240000);
  assert.equal(lo.zamanAsimiAl(60 * 60 * 1000), 60 * 60 * 1000);
});

test('HTML çıktısı: yan görseller data: URI olarak gömülür, diğer başvurular değişmez', () => {
  const yan = new Map([['ad_html_1.png', 'data:image/png;base64,QQ=='], ['çğ_html_2.jpg', 'data:image/jpeg;base64,Qg==']]);
  const html = Buffer.from('<p>ş</p><img src="ad_html_1.png"><img src=\'./%C3%A7%C4%9F_html_2.jpg\'><img src="alt/ad_html_1.png"><a href="x.html">x</a>', 'utf8');
  const c = lo.yanGorselleriGom(html, yan).toString('utf8');
  assert.match(c, /<p>ş<\/p><img src="data:image\/png;base64,QQ==">/);
  assert.match(c, /src='data:image\/jpeg;base64,Qg=='/);
  assert.match(c, /src="alt\/ad_html_1\.png"/);
  assert.match(c, /href="x\.html"/);
  assert.equal(lo.yanGorselleriGom(html, new Map()), html);
});
