'use strict';
// Ne: src/motorlar/libreoffice.js inceleme bulguları (kodlama, göreli URL, XCU yalıtımı, hata metni, zaman aşımı,
//     HTML yan görselleri) için soffice gerektirmeyen birim testleri.
// Sahibi: TaaDön dosya dönüştürücü işi. yazan: [Claude#libreoffice-inceleme-2026-11-04]
// Değiştirme kuralı: davranış değişince birlikte güncellenir; silme yalnız Yusuf'un kararıyla, çöp kutusuna.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
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
  // Gerçek dosyalar gerekir: file:/// adresi yalnız kaynak klasörde var olan görsel dosyalar için bırakılır.
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-kaynak-'));
  fs.mkdirSync(path.join(kok, 'img'));
  // 10 MB + 1 bayt: gömme sınırını aşsın ki data: değil file:/// kalsın (bu test file:/// adres üretimini sınar)
  for (const ad of ['a.png', 'b.png', 'd (1).png', 'f.png']) fs.writeFileSync(path.join(kok, 'img', ad), Buffer.alloc(10 * 1024 * 1024 + 1));
  try {
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
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
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

test('görsel gömme: kaynak klasördeki png/srcset/css data: olur; sınır aşımı, yok ve ../ gömülmez', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-gom-'));
  try {
    fs.mkdirSync(path.join(kok, 'img'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(kok, 'img', 'a.png'), png);
    fs.writeFileSync(path.join(kok, 'img', 'buyuk.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    fs.writeFileSync(path.join(kok, 'img', 'not.txt'), 'x');
    const h = lo.htmlTemizle('<img src="img/a.png"><img srcset="img/a.png 1x"><div style="background:url(img/a.png)"></div>' +
      '<img src="img/buyuk.png"><img src="img/yok.png"><img src="../x.png"><a href="img/a.png">k</a><img src="img/not.txt">', { kaynakKlasor: kok });
    const b64 = png.toString('base64');
    assert.ok(h.includes(`src="data:image/png;base64,${b64}"`), h);
    assert.ok(h.includes(`srcset="data:image/png;base64,${b64} 1x"`), h);
    assert.ok(h.includes(`url(data:image/png;base64,${b64})`), h);
    // sınır aşımı: gömülmez ama gerçek görsel dosya olduğu için file:/// adresi kalır
    assert.ok(h.includes(`src="${pathToFileURL(path.join(kok, 'img', 'buyuk.png')).href}"`), h);
    // bulunamayan ve görsel olmayan dosya: nitelik atılır (yerel dosya ekleme önlemi); ../ atılır
    assert.ok(!h.includes('yok.png') && !h.includes('not.txt'), h);
    assert.ok(!/x\.png/.test(h), h);
    // bağlantı (a href) görsel olsa bile gömülmez; gerçek dosya olduğu için file:/// kalır
    assert.ok(h.includes(`href="${pathToFileURL(path.join(kok, 'img', 'a.png')).href}"`), h);
    // sihirli bayt denetimi: uzantısı png ama içeriği sıfır olan dosya gömülmez (file:/// kalır)
    fs.writeFileSync(path.join(kok, 'img', 'sahte.png'), Buffer.alloc(64));
    const s = lo.htmlTemizle('<img src="img/sahte.png">', { kaynakKlasor: kok });
    assert.ok(!s.includes('data:') && s.includes(pathToFileURL(path.join(kok, 'img', 'sahte.png')).href), s);
    // derinlik: iki alt klasör derinliğindeki görsel gömülmez
    fs.mkdirSync(path.join(kok, 'img', 'alt'));
    fs.writeFileSync(path.join(kok, 'img', 'alt', 'derin.png'), png);
    assert.ok(!lo.htmlTemizle('<img src="img/alt/derin.png">', { kaynakKlasor: kok }).includes('data:'));
    // toplam bütçe çıktı baytıyla (base64) sayılır: 6 x 9 MB geçerli PNG (~12 MB base64) -> 4'ü gömülür, kalanı gömülmez;
    // aynı görselin tekrarı da bütçeden düşer
    const govde = [];
    const pngBas = png.subarray(0, 8);
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(kok, `d${i}.png`), Buffer.concat([pngBas, Buffer.alloc(9 * 1024 * 1024, i)]));
      govde.push(`<img src="d${i}.png">`);
    }
    const t = lo.htmlTemizle(govde.join(''), { kaynakKlasor: kok });
    assert.equal((t.match(/src="data:image\/png/g) || []).length, 4);
    assert.ok(t.includes(`src="${pathToFileURL(path.join(kok, 'd5.png')).href}"`));
    const tekrar = lo.htmlTemizle('<img src="d0.png">'.repeat(6), { kaynakKlasor: kok });
    assert.equal((tekrar.match(/src="data:image\/png/g) || []).length, 4, 'önbellek isabeti de bütçeye sayılmalı');
  } finally {
    // Testin kendi ürettiği geçici veri (kullanıcı dosyası değil); diğer testlerdeki temizle() kalıbıyla aynı.
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

// ---- 1.6.0 (T4): PDF süzgeç seçenekleri ve hazır profil şablonu ----
function suzgecJson(f) { return JSON.parse(f.slice(f.indexOf('{'))); }

test('pdf süzgeci: seçenek verilmezse eski düz "pdf"; boş seçenekle etiketli+yer imli orta kalite', () => {
  assert.equal(lo.disaAktarmaFiltresi('pdf', 'belge'), 'pdf');
  const f = lo.disaAktarmaFiltresi('pdf', 'belge', {});
  assert.match(f, /^pdf:writer_pdf_Export:\{/);
  const j = suzgecJson(f);
  assert.deepEqual(j.UseTaggedPDF, { type: 'boolean', value: 'true' });
  assert.deepEqual(j.ExportBookmarks, { type: 'boolean', value: 'true' });
  assert.deepEqual(j.Quality, { type: 'long', value: '85' });
  assert.deepEqual(j.MaxImageResolution, { type: 'long', value: '300' });
  assert.equal(j.SelectPdfVersion, undefined);
});

test('pdf süzgeci: pdfa -> SelectPdfVersion=2; kalite kombinasyonları; kaynağa göre süzgeç adı', () => {
  const a = suzgecJson(lo.disaAktarmaFiltresi('pdf', 'belge', { pdfa: true, pdfKalite: 'dusuk' }));
  assert.deepEqual(a.SelectPdfVersion, { type: 'long', value: '2' });
  assert.deepEqual(a.Quality, { type: 'long', value: '60' });
  assert.deepEqual(a.ReduceImageResolution, { type: 'boolean', value: 'true' });
  assert.deepEqual(a.MaxImageResolution, { type: 'long', value: '150' });
  const y = suzgecJson(lo.disaAktarmaFiltresi('pdf', 'belge', { pdfa: false, pdfKalite: 'yuksek' }));
  assert.equal(y.SelectPdfVersion, undefined);
  assert.deepEqual(y.Quality, { type: 'long', value: '95' });
  assert.deepEqual(y.UseLosslessCompression, { type: 'boolean', value: 'false' });
  assert.deepEqual(y.ReduceImageResolution, { type: 'boolean', value: 'false' });
  assert.equal(y.MaxImageResolution, undefined);
  assert.match(lo.disaAktarmaFiltresi('pdf', 'tablo', {}), /^pdf:calc_pdf_Export:/);
  assert.match(lo.disaAktarmaFiltresi('pdf', 'sunum', {}), /^pdf:impress_pdf_Export:/);
  // pdf dışı hedeflerde seçenek süzgeci değiştirmez
  assert.equal(lo.disaAktarmaFiltresi('docx', 'belge', { pdfa: true }), 'docx:MS Word 2007 XML');
});

test('pdf süzgeci: geçersiz kalite (ve prototip adları) -> orta', () => {
  for (const k of ['cok-iyi', '', null, 5, '__proto__', 'constructor', 'toString']) {
    const j = suzgecJson(lo.disaAktarmaFiltresi('pdf', 'belge', { pdfKalite: k }));
    assert.deepEqual(j.Quality, { type: 'long', value: '85' }, String(k));
  }
});

test('hata metni: şifre sözcüğü de şifreli belge mesajına gider', () => {
  assert.match(lo.loHataMetni({ kod: 1, stderr: 'Belge şifre ile korunuyor' }), /^Belge şifreli/);
  assert.match(lo.loHataMetni({ kod: 1, stderr: 'wrong password' }), /^Belge şifreli/);
});

test('profil şablonu: ilk profilden bir kez yazılır, sonra kopyalanır; işaretsiz klasör hazır sayılmaz', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-sablon-test-'));
  try {
    const profil = path.join(kok, 'profil');
    fs.mkdirSync(path.join(profil, 'user', 'alt'), { recursive: true });
    fs.writeFileSync(path.join(profil, 'user', 'registrymodifications.xcu'), 'x');
    fs.writeFileSync(path.join(profil, 'user', 'alt', 'veri.bin'), 'v');
    fs.writeFileSync(path.join(profil, 'user', '.lock'), 'kilit');
    const sablon = path.join(kok, 'veri', 'lo-sablon');
    assert.equal(lo.sablonHazirMi(sablon), false);
    assert.equal(await lo.profilSablonundanKur(path.join(kok, 'yok'), sablon), false);
    await Promise.all([lo.profilSablonuYaz(profil, sablon), lo.profilSablonuYaz(profil, sablon)]);
    assert.equal(lo.sablonHazirMi(sablon), true);
    assert.equal(fs.existsSync(path.join(sablon, 'user', '.lock')), false);
    const yeni = path.join(kok, 'yeni');
    assert.equal(await lo.profilSablonundanKur(yeni, sablon), true);
    assert.equal(fs.readFileSync(path.join(yeni, 'user', 'alt', 'veri.bin'), 'utf8'), 'v');
    assert.equal(fs.existsSync(path.join(yeni, 'taadon-sablon-tamam')), false);
    assert.deepEqual(fs.readdirSync(path.join(kok, 'veri')), ['lo-sablon']); // geçici yazım klasörü kalmadı
    fs.mkdirSync(path.join(kok, 'yarim', 'user'), { recursive: true });
    assert.equal(lo.sablonHazirMi(path.join(kok, 'yarim')), false);
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});
