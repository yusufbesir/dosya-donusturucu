'use strict';
// Ne: TaaDön hız ölçümü (png→jpg, jpg→pdf, txt→pdf, wav→mp3 medyanı + paket require süreleri).
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-t6], 1.11.0 "5 txt→pdf tek tek vs toplu" vakası:
//     [Claude#taadon-1.11-paket-a 2026-11-04]
// Kural: yalnız kendi mkdtemp klasörünü kullanır ve fs.rmSync ile siler; kullanıcı dosyasına dokunmaz.
// Çalıştır: node scripts/hiz-olc.js   (çıktı stdout + %TEMP%\taadon-hiz.md)
//           node scripts/hiz-olc.js --toplu   (yalnız LibreOffice toplu vakası)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const kok = path.join(__dirname, '..');

const TEKRAR = 3;
const medyan = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

function requireSuresi(paket) {
  // Her paket temiz bir süreçte ölçülür (önbellek etkisi olmasın)
  const kod = `const t=process.hrtime.bigint();require(${JSON.stringify(paket)});console.log(Number(process.hrtime.bigint()-t)/1e6)`;
  const v = [];
  for (let i = 0; i < TEKRAR; i += 1) {
    const r = spawnSync(process.execPath, ['-e', kod], { cwd: kok, encoding: 'utf8' });
    v.push(r.status === 0 ? parseFloat(r.stdout) : NaN);
  }
  return medyan(v.filter(Number.isFinite));
}

/** 1.11.0: 5 txt→pdf, girdi başına soffice (loTopluKapali) ve tek soffice çağrısı (toplu); ikisi de hazır profil şablonuyla. */
async function topluVakasi(sofficeYolu) {
  const { donustur } = require('../src/donustur');
  const { isit } = require('../src/motorlar/libreoffice');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-hiz-toplu-'));
  const satirlar = [];
  try {
    const profilSablonu = path.join(tmp, 'lo-sablon');
    await isit({ sofficeYolu, profilSablonu, geciciKlasor: tmp });
    const girdiler = [1, 2, 3, 4, 5].map((n) => {
      const p = path.join(tmp, `metin${n}.txt`);
      fs.writeFileSync(p, `TaaDön toplu ölçüm ${n}\n`.repeat(200));
      return p;
    });
    for (const [ad, ek] of [['5 txt→pdf tek tek (LO)', { loTopluKapali: true }], ['5 txt→pdf toplu (LO, tek çağrı)', {}]]) {
      const v = [];
      for (let i = 0; i < TEKRAR; i += 1) {
        const cikti = fs.mkdtempSync(path.join(tmp, 'c-'));
        const t0 = process.hrtime.bigint();
        const s = await donustur({ id: 'hiz', girdiler, hedef: 'pdf', ciktiKlasoru: cikti, secenekler: {} },
          { sofficeYolu, profilSablonu, ilerleme: () => {}, ...ek });
        v.push(ms(t0));
        if (s.ciktilar.length !== 5) throw new Error(`${ad}: ${s.ciktilar.length} çıktı`);
        fs.rmSync(cikti, { recursive: true, force: true });
      }
      satirlar.push([ad, `${Math.round(medyan(v))} ms`, v.map((x) => Math.round(x)).join(' / ')]);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return satirlar;
}

function yaz(satirlar) {
  const md = ['# TaaDön hız ölçümü', `Tarih: ${new Date().toISOString()}  Node ${process.version}`, '',
    '| İş | Medyan | Tekrarlar |', '|---|---|---|', ...satirlar.map((s) => `| ${s.join(' | ')} |`), ''].join('\n');
  console.log(md);
  fs.writeFileSync(path.join(os.tmpdir(), 'taadon-hiz.md'), md, 'utf8');
}

async function main() {
  if (process.argv.includes('--toplu')) {
    const { sofficeBul } = require('../src/motorlar/libreoffice');
    const sofficeYolu = sofficeBul({ gomuluKlasor: path.join(kok, 'vendor') }) || path.join(kok, 'vendor', 'libreoffice', 'program', 'soffice.exe');
    yaz(await topluVakasi(sofficeYolu));
    return;
  }
  const yollar = require('../src/yollar');
  const { sofficeBul } = require('../src/motorlar/libreoffice');
  const { donustur } = require('../src/donustur');
  const sharp = require('sharp');
  const ffmpegYolu = yollar.ffmpegYolunuBul({ uygulamaKlasoru: kok });
  const sofficeYolu = sofficeBul({ gomuluKlasor: path.join(kok, 'vendor') }) || path.join(kok, 'vendor', 'libreoffice', 'program', 'soffice.exe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-hiz-'));
  const satirlar = [];
  try {
    const png = path.join(tmp, 'buyuk.png');
    const jpg = path.join(tmp, 'buyuk.jpg');
    const txt = path.join(tmp, 'metin.txt');
    const wav = path.join(tmp, 'sessiz.wav');
    const raw = Buffer.alloc(4000 * 3000 * 3);
    for (let i = 0; i < raw.length; i += 3) { raw[i] = (i >> 10) & 255; raw[i + 1] = (i >> 14) & 255; raw[i + 2] = (i >> 18) & 255; }
    await sharp(raw, { raw: { width: 4000, height: 3000, channels: 3 } }).png({ compressionLevel: 1 }).toFile(png);
    await sharp(png).jpeg({ quality: 85 }).toFile(jpg);
    fs.writeFileSync(txt, 'TaaDön hız ölçümü\n'.repeat(200));
    const f = spawnSync(ffmpegYolu, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '10', wav], { encoding: 'utf8' });
    if (f.status !== 0) throw new Error('wav üretilemedi: ' + f.stderr);

    const isler = [
      ['png→jpg (4000×3000)', png, 'jpg'],
      ['jpg→pdf (4000×3000)', jpg, 'pdf'],
      ['txt→pdf (LibreOffice)', txt, 'pdf'],
      ['wav→mp3 (10 sn)', wav, 'mp3'],
    ];
    for (const [ad, girdi, hedef] of isler) {
      const v = [];
      for (let i = 0; i < TEKRAR; i += 1) {
        const cikti = fs.mkdtempSync(path.join(tmp, 'c-'));
        const t0 = process.hrtime.bigint();
        await donustur({ id: 'hiz', girdiler: [girdi], hedef, ciktiKlasoru: cikti, secenekler: {} }, { ffmpegYolu, sofficeYolu, ilerleme: () => {} });
        v.push(ms(t0));
        fs.rmSync(cikti, { recursive: true, force: true });
      }
      satirlar.push([ad, `${Math.round(medyan(v))} ms`, v.map((x) => Math.round(x)).join(' / ')]);
    }
    satirlar.push(...await topluVakasi(sofficeYolu));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const req = ['sharp', 'pdf-lib', 'pdfjs-dist', 'fflate', 'marked'].map((p) => {
    let s = NaN;
    try { s = requireSuresi(p); } catch { /* yok */ }
    return [`require('${p}')`, Number.isFinite(s) ? `${s.toFixed(1)} ms` : 'yüklenemedi', '(temiz süreç medyanı)'];
  });
  yaz([...satirlar, ...req]);
}

main().catch((e) => { console.error(e); process.exit(1); });
