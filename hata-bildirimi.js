// Sahip: Yusuf. yazan: [Claude#hata-bildirimi 2026-11-18]
// TAA ortak hata bildirimi, Electron/Node tarafı (Rust karşılığı: yusufbesir/taa-paket crates/taa-hata, docs/HATA-BILDIRIMI.md).
// Çökme/hata -> temizlenmiş rapor -> yerel kuyruk (<kök>/kuyruk/hata-<program>/giden.jsonl, taa-kuyruk biçimi) ->
// `taa-kuyruk gonder` sunucuya POST /v1/hata-raporu yollar. Ağa gitmez; müşteri verisi/parola/anahtar/dosya içeriği taşımaz.
// Kullanım (main.js başında): require('./hata-bildirimi').kur({ program: 'tutaa', surum: app.getVersion(), app });
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const UC = '/v1/hata-raporu';
const MESAJ_EN_COK = 400;
const SATIR_EN_COK = 20;
const SATIR_UZUNLUK = 200;
const SIR = ['parola', 'sifre', 'şifre', 'password', 'pass', 'pin', 'token', 'jeton', 'anahtar', 'key', 'secret', 'bearer', 'authorization', 'oturum', 'cookie'];

const sirAnahtariMi = (s) => {
  const k = s.replace(/[=:]+$/, '').toLowerCase();
  return k.length > 0 && SIR.some((a) => k === a || k.endsWith(a));
};
const dosyaAdi = (y) => y.split(/[\\/]/).pop() || y;

function sozcukTemizle(s) {
  const t = s.replace(/^[.'"`]+|[.'"`]+$/g, '');
  if (t.includes('@') && t.includes('.')) return s.replace(t, '<eposta>');
  if ((t.includes('\\') || t.startsWith('/') || t.includes(':\\')) && t.length > 3) return s.replace(t, dosyaAdi(t));
  const rakam = (t.match(/[0-9]/g) || []).length;
  if (rakam >= 4 && /^[0-9+\-./ ]+$/.test(t)) return s.replace(t, '<sayi>');
  if ([...t].length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(t)) return s.replace(t, '<belirtec>');
  return s;
}

// Rust `temizle` ile aynı kurallar: tırnak içi değer, e-posta, 4+ rakamlı sayı, uzun belirteç, yol, sır alanı değeri.
function temizle(girdi) {
  let kalan = '';
  let tirnak = null;
  for (const c of String(girdi)) {
    if (tirnak) {
      if (c === tirnak) {
        tirnak = null;
        kalan += '<metin>' + c;
      }
    } else {
      if (c === '"' || c === '`') tirnak = c;
      kalan += c;
    }
  }
  if (tirnak) kalan += '<metin>';
  let cikti = '';
  let gizli = false;
  const parcalar = kalan.split(/(\s|[,;()[\]{}<>])/);
  for (const s of parcalar) {
    if (s === '') continue;
    if (/^(\s|[,;()[\]{}<>])$/.test(s)) { cikti += s; continue; }
    if (gizli) { gizli = false; cikti += '<gizli>'; continue; }
    const i = s.search(/[=:]/);
    if (i > 0 && sirAnahtariMi(s.slice(0, i)) && s.length > i + 1) { cikti += s.slice(0, i + 1) + '<gizli>'; continue; }
    if (sirAnahtariMi(s)) { gizli = true; cikti += s; continue; }
    cikti += sozcukTemizle(s);
  }
  return cikti;
}

const kisalt = (s, n) => ([...s].length <= n ? s : [...s].slice(0, n).join('') + '…');

function rapor({ program, surum, tur, yer = '', mesaj = '', satirlar = [] }) {
  const y = kisalt(temizle(yer), 120);
  const m = kisalt(temizle(mesaj), MESAJ_EN_COK);
  const son = satirlar.slice(-SATIR_EN_COK).map((s) => kisalt(temizle(String(s)), SATIR_UZUNLUK));
  const norm = m.replace(/[0-9]/g, '');
  const parmakIzi = crypto.createHash('sha1').update([program, tur, y, norm].join('\u0001')).digest('hex').slice(0, 16);
  return { program, surum, tur, yer: y, mesaj: m, son_satirlar: son, parmak_izi: parmakIzi };
}

const govde = (r) => ({ bicim: 1, ...r, isletim: process.platform, zaman: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });

function varsayilanKok() {
  if (process.env.TAA_VERI_KOK) return process.env.TAA_VERI_KOK;
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'TAA', 'veri');
  return path.join(os.homedir(), '.local', 'share', 'taa', 'veri');
}

// Şifreleme: Rust `taa_kuyruk::sifre` ile birebir (ChaCha20-Poly1305 IETF, 12 bayt nonce, hex; etiket şifreli metnin sonunda).
// Anahtar: <kök>/anahtar/kuyruk.key (64 hex, ilk kullanımda atomik üretilir). `taa-kuyruk gonder` gönderimde çözer.
function anahtarAl(kok) {
  const yol = path.join(kok, 'anahtar', 'kuyruk.key');
  const oku = () => {
    try { const m = fs.readFileSync(yol, 'utf8').trim(); return /^[0-9a-f]{64}$/.test(m) ? Buffer.from(m, 'hex') : null; } catch { return null; }
  };
  let a = oku();
  if (a) return a;
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  const yeni = crypto.randomBytes(32);
  try {
    fs.writeFileSync(yol, yeni.toString('hex'), { flag: 'wx' });
    return yeni;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    for (let i = 0; i < 20 && !a; i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); a = oku(); }
    if (!a) throw new Error('kuyruk anahtarı okunamadı');
    return a;
  }
}
function kapat(anahtar, nesne) {
  const n = crypto.randomBytes(12);
  const c = crypto.createCipheriv('chacha20-poly1305', anahtar, n, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(JSON.stringify(nesne), 'utf8'), c.final(), c.getAuthTag()]);
  return { _sifreli: 1, n: n.toString('hex'), c: ct.toString('hex') };
}
function ac(anahtar, zarf) {
  const n = Buffer.from(zarf.n, 'hex');
  const ct = Buffer.from(zarf.c, 'hex');
  const d = crypto.createDecipheriv('chacha20-poly1305', anahtar, n, { authTagLength: 16 });
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'));
}

// Kuyruğa yazar (taa-kuyruk giden.jsonl biçimi); aynı hata aynı gün ikinci kez eklenmez. Asla fırlatmaz.
function kuyrugaYaz(kok, r) {
  try {
    const klasor = path.join(kok, 'kuyruk', `hata-${r.program}`);
    fs.mkdirSync(klasor, { recursive: true });
    const no = `H-${r.parmak_izi}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const yol = path.join(klasor, 'giden.jsonl');
    const var_ = fs.existsSync(yol) && fs.readFileSync(yol, 'utf8').split('\n').some((l) => l.includes(`"no":"${no}"`));
    if (var_) return false;
    const zaman = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    let g;
    try { g = kapat(anahtarAl(kok), govde(r)); } catch { g = govde(r); } // anahtar yoksa rapor kaybolmasın (zaten temizlenmiş)
    fs.appendFileSync(yol, JSON.stringify({ no, uc: UC, zaman, govde: g }) + '\n');
    return true;
  } catch {
    return false;
  }
}

let ayar = null;

function bildir(tur, hata, satirlar = []) {
  if (!ayar) return false;
  const e = hata instanceof Error ? hata : new Error(String(hata));
  const yer = (e.stack || '').split('\n').find((s) => /\.js:\d+/.test(s)) || '';
  return kuyrugaYaz(ayar.kok, rapor({ program: ayar.program, surum: ayar.surum, tur, yer: yer.trim(), mesaj: `${e.name}: ${e.message}`, satirlar }));
}

// Kancalar: yakalanmamış hata/söz reddi/renderer-alt süreç çökmesi. Mevcut davranışı bozmaz (uncaughtException'da
// başka dinleyici yoksa Node varsayılanı gibi çıkış yapılmaz; Electron kendi iletişim kutusunu gösterir).
function kur({ program, surum, kok, app } = {}) {
  if (ayar || !program) return;
  ayar = { program, surum: String(surum || '0'), kok: kok || varsayilanKok() };
  process.on('uncaughtExceptionMonitor', (e) => bildir('cokme', e));
  process.on('unhandledRejection', (e) => bildir('hata', e));
  if (app && typeof app.on === 'function') {
    app.on('render-process-gone', (_ev, _wc, d) => bildir('cokme', new Error(`render-process-gone: ${d && d.reason}`)));
    app.on('child-process-gone', (_ev, d) => bildir('cokme', new Error(`child-process-gone: ${d && d.type} ${d && d.reason}`)));
  }
}

module.exports = { kur, bildir, temizle, rapor, kuyrugaYaz, varsayilanKok, anahtarAl, kapat, ac, UC };
