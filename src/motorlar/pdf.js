'use strict';
// Ne: TaaDön PDF araçları motoru (birleştir, böl, döndür) — pdf-lib ile.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-inceleme] (son düzenleme: boyut sınırı, hata metni)
// Değiştirme kuralı: davranış değişikliği test/medya.test.js ve test/donustur-ek.test.js güncellenerek yapılır.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, degrees } = require('pdf-lib');
const yollar = require('../yollar');
const surec = require('../surec');

const MAKS_PDF_BAYT = 512 * 1024 * 1024;

/** "1-3,5" -> [0,1,2,4] (0 tabanlı). Sıra korunur, mükerrer eklenmez. Son sayfa için "5-" ve "-3" kısaltmaları desteklenir. */
function sayfaListesi(metin, toplam) {
  if (metin == null || String(metin).trim() === '') return Array.from({ length: toplam }, (_, i) => i);
  const sonuc = [];
  const goruldu = new Set();
  for (const parca of String(metin).split(',')) {
    const p = parca.trim();
    if (!p) throw new Error('Geçersiz sayfa aralığı.');
    let m;
    let bas;
    let bit;
    if ((m = /^(\d+)$/.exec(p))) { bas = Number(m[1]); bit = bas; }
    else if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(p))) { bas = Number(m[1]); bit = Number(m[2]); }
    else if ((m = /^(\d+)\s*-$/.exec(p))) { bas = Number(m[1]); bit = toplam; }
    else if ((m = /^-\s*(\d+)$/.exec(p))) { bas = 1; bit = Number(m[1]); }
    else throw new Error(`Geçersiz sayfa aralığı: ${p}`);
    if (bas < 1 || bit < bas || bit > toplam) throw new Error(`Sayfa aralığı geçersiz ya da belge dışında: ${p} (belgede ${toplam} sayfa var).`);
    for (let s = bas; s <= bit; s += 1) {
      if (!goruldu.has(s - 1)) { goruldu.add(s - 1); sonuc.push(s - 1); }
    }
  }
  return sonuc;
}

async function pdfAc(yol) {
  const g = yollar.girdiYolu(yol);
  const st = await fsp.stat(g);
  if (st.size > MAKS_PDF_BAYT) throw new Error('PDF çok büyük (512 MB sınırı).');
  const veri = await fsp.readFile(g);
  try {
    return await PDFDocument.load(veri, { updateMetadata: false });
  } catch (e) {
    const ic = String((e && e.message) || e);
    if (/encrypt/i.test(ic)) throw new Error('PDF şifreli; önce şifresini kaldırın.');
    const kisa = ic.length > 80 ? `${ic.slice(0, 77)}...` : ic;
    throw new Error(`PDF okunamadı; dosya bozuk ya da tamamlanmamış olabilir. (${path.basename(g)}: ${kisa})`);
  }
}

/** Birleştirilecek girdilerin toplam boyutu sınırı aşıyorsa hata atar (bellekte tek belge oluşur). */
async function toplamBoyutDenetle(girdiler, sinir = MAKS_PDF_BAYT) {
  let toplam = 0;
  for (const yol of girdiler) {
    toplam += (await fsp.stat(yollar.girdiYolu(yol))).size;
    if (toplam > sinir) {
      const mb = Math.round(sinir / (1024 * 1024));
      throw new Error(`Birleştirilecek PDF'lerin toplam boyutu çok büyük (${mb} MB sınırı). Daha az ya da daha küçük dosya seçin.`);
    }
  }
  return toplam;
}

function iptalKontrol(sinyal) {
  if (sinyal && sinyal.aborted) throw surec.iptalHatasi();
}

async function kaydet(ctx, doc, ad) {
  return yollar.guvenliUret(ctx.ciktiKlasoru, ad, 'pdf', async (gecici) => {
    await fsp.writeFile(gecici, await doc.save(), { flag: 'wx' });
  });
}

async function sayfalariKopyala(kaynak, indeksler) {
  const yeni = await PDFDocument.create();
  const sayfalar = await yeni.copyPages(kaynak, indeksler);
  for (const s of sayfalar) yeni.addPage(s);
  return yeni;
}

async function birlestir(ctx) {
  if (ctx.girdiler.length < 2) throw new Error('Birleştirmek için en az iki PDF gerekli.');
  await toplamBoyutDenetle(ctx.girdiler);
  const hedefDoc = await PDFDocument.create();
  for (let i = 0; i < ctx.girdiler.length; i += 1) {
    iptalKontrol(ctx.sinyal);
    const kaynak = await pdfAc(ctx.girdiler[i]);
    const sayfalar = await hedefDoc.copyPages(kaynak, kaynak.getPageIndices());
    for (const s of sayfalar) hedefDoc.addPage(s);
    if (ctx.ilerleme) ctx.ilerleme(Math.floor(((i + 1) / ctx.girdiler.length) * 90));
  }
  return kaydet(ctx, hedefDoc, 'birlestirilmis');
}

async function bol(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const ad = yollar.govdeAdi(girdi);
  const sec = ctx.secenekler || {};
  const kaynak = await pdfAc(girdi);
  const toplam = kaynak.getPageCount();
  const ciktilar = [];
  // sayfalar verilmiş ve ayri değilse: seçili sayfalar tek PDF; aksi halde parçalar ayrı dosya
  const parcalar = [];
  if (sec.sayfalar && !sec.ayri) {
    parcalar.push({ ad: `${ad}-sayfa-${String(sec.sayfalar).replace(/[^\d,\-]/g, '').replace(/,/g, '_')}`, idx: sayfaListesi(sec.sayfalar, toplam) });
  } else if (sec.sayfalar) {
    for (const p of String(sec.sayfalar).split(',')) {
      parcalar.push({ ad: `${ad}-sayfa-${p.trim().replace(/[^\d\-]/g, '')}`, idx: sayfaListesi(p, toplam) });
    }
  } else {
    for (let i = 0; i < toplam; i += 1) parcalar.push({ ad: `${ad}-sayfa-${i + 1}`, idx: [i] });
  }
  for (let i = 0; i < parcalar.length; i += 1) {
    iptalKontrol(ctx.sinyal);
    const doc = await sayfalariKopyala(kaynak, parcalar[i].idx);
    ciktilar.push(await kaydet(ctx, doc, parcalar[i].ad));
    if (ctx.ilerleme) ctx.ilerleme(Math.floor(((i + 1) / parcalar.length) * 95));
  }
  return ciktilar;
}

async function dondur(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const sec = ctx.secenekler || {};
  const aci = Number(sec.aci == null ? 90 : sec.aci);
  if (!Number.isInteger(aci) || aci % 90 !== 0) throw new Error('Döndürme açısı 90\'ın katı olmalı.');
  const doc = await pdfAc(girdi);
  const idx = sayfaListesi(sec.sayfalar, doc.getPageCount());
  const sayfalar = doc.getPages();
  for (const i of idx) {
    const mevcut = sayfalar[i].getRotation().angle;
    sayfalar[i].setRotation(degrees((((mevcut + aci) % 360) + 360) % 360));
  }
  return kaydet(ctx, doc, `${yollar.govdeAdi(girdi)}-dondurulmus`);
}

async function calistir(ctx) {
  iptalKontrol(ctx.sinyal);
  switch (ctx.hedef) {
    case 'birlestir': return birlestir(ctx);
    case 'bol': return bol(ctx);
    case 'dondur': return dondur(ctx);
    default: throw new Error(`Bilinmeyen PDF işlemi: ${ctx.hedef}`);
  }
}

module.exports = { calistir, sayfaListesi, toplamBoyutDenetle, MAKS_PDF_BAYT };
