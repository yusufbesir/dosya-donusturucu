'use strict';

const fsp = require('node:fs/promises');
const YAML = require('yaml');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const yollar = require('../yollar');
const surec = require('../surec');
const { kanonik } = require('../katalog');

const MAKS_BAYT = 256 * 1024 * 1024;

function ata(nesne, anahtar, deger) {
  // "__proto__" gibi anahtarlar prototipi değiştirmesin
  Object.defineProperty(nesne, anahtar, { value: deger, enumerable: true, writable: true, configurable: true });
}

// ---- CSV / TSV ----
function csvAyristir(metin, ayirici = ',') {
  let s = String(metin);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const satirlar = [];
  let satir = [];
  let alan = '';
  let tirnakta = false;
  let alanVar = false; // satırda en az bir karakter/ayırıcı görüldü mü
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (tirnakta) {
      if (c === '"') {
        if (s[i + 1] === '"') { alan += '"'; i += 1; } else tirnakta = false;
      } else alan += c;
      continue;
    }
    if (c === '"' && alan === '') { tirnakta = true; alanVar = true; }
    else if (c === ayirici) { satir.push(alan); alan = ''; alanVar = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      if (alanVar || alan !== '') { satir.push(alan); satirlar.push(satir); }
      satir = []; alan = ''; alanVar = false;
    } else { alan += c; alanVar = true; }
  }
  if (tirnakta) throw new Error('CSV hatalı: kapanmamış tırnak.');
  if (alanVar || alan !== '') { satir.push(alan); satirlar.push(satir); }
  return satirlar;
}

function csvHucre(deger, ayirici) {
  const s = deger == null ? '' : typeof deger === 'object' ? JSON.stringify(deger) : String(deger);
  if (s === '') return s;
  if (s.includes('"') || s.includes(ayirici) || /[\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvYaz(satirlar, ayirici = ',') {
  return satirlar.map((r) => r.map((h) => csvHucre(h, ayirici)).join(ayirici)).join('\r\n') + (satirlar.length ? '\r\n' : '');
}

/** Tablo (ilk satır başlık) -> nesne dizisi */
function tablodanNesneye(satirlar) {
  if (satirlar.length === 0) return [];
  const gorulen = new Map();
  const basliklar = satirlar[0].map((b, i) => {
    let ad = String(b).trim() || `sutun${i + 1}`;
    const n = gorulen.get(ad) || 0;
    gorulen.set(ad, n + 1);
    if (n > 0) ad = `${ad}_${n + 1}`;
    return ad;
  });
  return satirlar.slice(1).map((r) => {
    const o = {};
    basliklar.forEach((b, i) => ata(o, b, r[i] === undefined ? '' : r[i]));
    return o;
  });
}

function duzNesneMi(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Herhangi bir değerden nesne dizisi çıkarır (XML/YAML/JSON sarmalayıcılarını açar). */
function kayitlariBul(deger) {
  if (Array.isArray(deger)) {
    return deger.map((e) => (duzNesneMi(e) ? e : { deger: e }));
  }
  if (duzNesneMi(deger)) {
    const anahtarlar = Object.keys(deger);
    if (anahtarlar.length === 1) {
      const ic = deger[anahtarlar[0]];
      if (Array.isArray(ic) || duzNesneMi(ic)) return kayitlariBul(ic);
      return [deger];
    }
    for (const k of anahtarlar) {
      const ic = deger[k];
      if (Array.isArray(ic) && ic.length && ic.every(duzNesneMi)) return ic;
    }
    return [deger];
  }
  return [{ deger }];
}

function nesnedenTabloya(kayitlar) {
  const basliklar = [];
  const var_ = new Set();
  for (const k of kayitlar) {
    for (const a of Object.keys(k)) if (!var_.has(a)) { var_.add(a); basliklar.push(a); }
  }
  const satirlar = [basliklar];
  for (const k of kayitlar) satirlar.push(basliklar.map((b) => (Object.prototype.hasOwnProperty.call(k, b) ? k[b] : '')));
  return satirlar;
}

// ---- XML ----
function xmlAdi(ad) {
  let s = String(ad).replace(/[^\p{L}\p{N}_.-]/gu, '_');
  if (!/^[\p{L}_]/u.test(s)) s = `_${s}`;
  if (/^xml/i.test(s)) s = `_${s}`;
  return s;
}

function xmlDegeri(v) {
  if (Array.isArray(v)) return v.map(xmlDegeri);
  if (duzNesneMi(v)) {
    const o = {};
    for (const k of Object.keys(v)) ata(o, xmlAdi(k), xmlDegeri(v[k]));
    return o;
  }
  return v == null ? '' : v;
}

const XML_AYRISTIRICI = () => new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: { enabled: true, maxTotalExpansions: 1000, maxExpandedLength: 1000000, maxEntityCount: 50 },
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

function xmlYaz(deger) {
  let kok;
  if (Array.isArray(deger)) kok = { kayitlar: { kayit: xmlDegeri(deger) } };
  else if (duzNesneMi(deger) && Object.keys(deger).length === 1) kok = xmlDegeri(deger);
  else kok = { kok: xmlDegeri(deger) };
  const b = new XMLBuilder({ format: true, indentBy: '  ', suppressEmptyNode: false, ignoreAttributes: false, processEntities: true });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${b.build(kok)}`;
}

// ---- Genel okuma / yazma ----
function oku(metin, bicim) {
  let s = String(metin);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  switch (bicim) {
    case 'json': return JSON.parse(s);
    case 'csv': return tablodanNesneye(csvAyristir(s, ','));
    case 'tsv': return tablodanNesneye(csvAyristir(s, '\t'));
    case 'yaml': return YAML.parse(s, { maxAliasCount: 50, uniqueKeys: true, merge: false });
    case 'xml': return XML_AYRISTIRICI().parse(s);
    default: throw new Error(`Desteklenmeyen veri biçimi: ${bicim}`);
  }
}

function yaz(deger, bicim, sec = {}) {
  switch (bicim) {
    case 'json': return `${JSON.stringify(deger, null, 2)}\n`;
    case 'csv':
    case 'tsv': {
      const ayirici = bicim === 'csv' ? ',' : '\t';
      const govde = csvYaz(nesnedenTabloya(kayitlariBul(deger)), ayirici);
      return (sec.bom === false ? '' : '﻿') + govde;
    }
    case 'yaml': return YAML.stringify(deger, { lineWidth: 0 });
    case 'xml': return xmlYaz(deger);
    default: throw new Error(`Desteklenmeyen veri biçimi: ${bicim}`);
  }
}

function donusturMetin(metin, kaynak, hedef, sec) {
  return yaz(oku(metin, kanonik(kaynak)), kanonik(hedef), sec);
}

async function calistir(ctx) {
  const girdi = yollar.girdiYolu(ctx.girdiler[0]);
  const kaynak = kanonik(yollar.uzantiAl(girdi));
  const hedef = kanonik(ctx.hedef);
  if (ctx.sinyal && ctx.sinyal.aborted) throw surec.iptalHatasi();
  const st = await fsp.stat(girdi);
  if (st.size > MAKS_BAYT) throw new Error('Dosya çok büyük (256 MB sınırı).');
  const metin = await fsp.readFile(girdi, 'utf8');
  let cikti;
  try {
    cikti = donusturMetin(metin, kaynak, hedef, ctx.secenekler);
  } catch (e) {
    throw new Error(`${kaynak.toUpperCase()} okunamadı ya da dönüştürülemedi: ${e.message}`);
  }
  if (ctx.ilerleme) ctx.ilerleme(80);
  return yollar.guvenliUret(ctx.ciktiKlasoru, yollar.govdeAdi(girdi), hedef, async (gecici) => {
    await fsp.writeFile(gecici, cikti, { encoding: 'utf8', flag: 'wx' });
  });
}

module.exports = { calistir, csvAyristir, csvYaz, donusturMetin, oku, yaz, kayitlariBul };
