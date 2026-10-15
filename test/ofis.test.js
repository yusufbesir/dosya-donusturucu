'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { donustur } = require('../src/donustur');
const surec = require('../src/surec');
const { unzipSync, strFromU8 } = require('fflate');
const y = require('./yardimci');
const docxMetni = (yol) => strFromU8(unzipSync(new Uint8Array(fs.readFileSync(yol)))['word/document.xml']);

const ZAMAN = 240000;
const is = (girdiler, hedef, ciktiKlasoru, secenekler = {}) => ({
  id: 'x', girdiler: Array.isArray(girdiler) ? girdiler : [girdiler], hedef, ciktiKlasoru, secenekler,
});
const ortam = (ek) => y.ortam({ ...ek });
const TL = { timeout: ZAMAN };

test('libreoffice: txt -> docx -> pdf -> docx (PDF → Word) ve md -> docx/pdf', { timeout: ZAMAN * 3, skip: !y.sofficeYolu }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const txt = path.join(g, 'not.txt');
  fs.writeFileSync(txt, 'Merhaba dünya, şğüöçı İ\nİkinci satır\n');
  const sec = { zamanAsimi: ZAMAN };

  let docx;
  await t.test('txt -> docx', TL, async () => {
    docx = (await donustur(is(txt, 'docx', c, sec), ortam())).ciktilar[0];
    assert.equal(path.basename(docx), 'not.docx');
    assert.equal(fs.readFileSync(docx).subarray(0, 2).toString('latin1'), 'PK');
  });
  let pdf;
  await t.test('docx -> pdf', TL, async () => {
    pdf = (await donustur(is(docx, 'pdf', c, sec), ortam())).ciktilar[0];
    assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString('latin1'), '%PDF-');
  });
  await t.test('pdf -> docx (writer_pdf_import)', TL, async () => {
    const geri = (await donustur(is(pdf, 'docx', c, sec), ortam())).ciktilar[0];
    assert.equal(path.basename(geri), 'not (1).docx');
    assert.equal(fs.readFileSync(geri).subarray(0, 2).toString('latin1'), 'PK');
    assert.match(docxMetni(geri), /Merhaba/);
  });
  await t.test('md -> docx ve md -> pdf; ham HTML kaçışlanır', TL, async () => {
    const md = path.join(g, 'oku.md');
    fs.writeFileSync(md, '# Başlık\n\n**kalın** ve [bağlantı](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![x](http://example.com/a.png)\n\n- bir\n- iki\n');
    const d = (await donustur(is(md, 'docx', c, sec), ortam())).ciktilar[0];
    assert.equal(path.basename(d), 'oku.docx');
    assert.match(docxMetni(d), /Başlık/);
    assert.ok(!/<script>/.test(docxMetni(d)));
    assert.equal(fs.readFileSync(d).subarray(0, 2).toString('latin1'), 'PK');
    const p = (await donustur(is(md, 'pdf', c, sec), ortam())).ciktilar[0];
    assert.equal(fs.readFileSync(p).subarray(0, 5).toString('latin1'), '%PDF-');
    const h = (await donustur(is(md, 'html', c), ortam())).ciktilar[0];
    const html = fs.readFileSync(h, 'utf8');
    assert.ok(!/<script>/i.test(html.replace(/<head>[\s\S]*<\/head>/, '')), 'ham script etiketi olmamalı');
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!/javascript:/i.test(html));
    assert.ok(!/<img/i.test(html));
    assert.match(html, /<h1[^>]*>Başlık<\/h1>/);
  });
  await t.test('csv -> xlsx -> pdf; xlsx -> csv (Türkçe karakterler)', TL, async () => {
    const csv = path.join(g, 'tablo.csv');
    fs.writeFileSync(csv, 'ad,şehir\nAyşe,İstanbul\nÖmer,Çanakkale\n');
    const x = (await donustur(is(csv, 'xlsx', c, sec), ortam())).ciktilar[0];
    assert.equal(fs.readFileSync(x).subarray(0, 2).toString('latin1'), 'PK');
    const p = (await donustur(is(x, 'pdf', c, sec), ortam())).ciktilar[0];
    assert.equal(fs.readFileSync(p).subarray(0, 5).toString('latin1'), '%PDF-');
    const geri = (await donustur(is(x, 'csv', c, sec), ortam())).ciktilar[0];
    assert.match(fs.readFileSync(geri, 'utf8'), /Çanakkale/);
  });
  await t.test('geçici profil/çıktı klasörleri ve .~ dosyaları kalmaz', () => {
    assert.ok(y.ls(c).every((d) => !d.startsWith('.~')), y.ls(c).join(','));
  });
});

test('libreoffice: zaman aşımı ve iptal alt süreci öldürür', { timeout: 120000, skip: !y.sofficeYolu }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const txt = path.join(g, 'a.txt');
  fs.writeFileSync(txt, 'deneme');
  await assert.rejects(donustur(is(txt, 'pdf', c, { zamanAsimi: 50 }), ortam()), /zaman aşımı/);
  assert.deepEqual(y.ls(c), []);
  const ac = new AbortController();
  const p = donustur(is(txt, 'pdf', c, { zamanAsimi: ZAMAN }), ortam({ sinyal: ac.signal }));
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.deepEqual(y.ls(c), []);
  assert.equal(typeof surec.calistir, 'function');
});

test('libreoffice: LibreOffice yoksa anlaşılır hata', async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const txt = path.join(g, 'a.txt');
  fs.writeFileSync(txt, 'x');
  const eskiPath = process.env.PATH;
  process.env.PATH = path.join(g, 'yok');
  try {
    await assert.rejects(donustur(is(txt, 'pdf', c), { ffmpegYolu: null, sofficeYolu: null, ilerleme: () => {} }), /LibreOffice bulunamadı/);
  } finally { process.env.PATH = eskiPath; }
});
