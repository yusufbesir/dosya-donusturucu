'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { imzaDogrula, imzaciUygunMu } = require('../src/imza');
const lo = require('../src/motorlar/libreoffice');

const KOK = path.join(__dirname, '..');
const okuMetin = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');

const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-imza-'));
test.after(() => fs.rmSync(dizin, { recursive: true, force: true }));
const exe = path.join(dizin, 'soffice.exe');
fs.writeFileSync(exe, 'MZ-sahte');

const TDF = 'CN=The Document Foundation, O=The Document Foundation, L=Berlin, C=DE';
const ps = (obj, kod = 0) => async () => ({ kod, stdout: typeof obj === 'string' ? obj : JSON.stringify(obj) });

test('imza: Linux/geliştirmede denetim atlanır, PowerShell çağrılmaz', async () => {
  let cagri = 0;
  const r = await imzaDogrula(exe, { platform: 'linux', powershell: async () => { cagri++; return { kod: 1, stdout: '' }; } });
  assert.deepEqual(r, { gecerli: true, atlandi: true });
  assert.equal(cagri, 0);
});

test('imza: geçerli imza + The Document Foundation kabul edilir', async () => {
  const r = await imzaDogrula(exe, { platform: 'win32', powershell: ps({ Durum: 'Valid', Konu: TDF }) });
  assert.equal(r.gecerli, true);
});

test('imza: imzasız, bozuk, süresi geçmiş ya da başka imzacı reddedilir', async () => {
  for (const o of [
    { Durum: 'NotSigned', Konu: '' }, { Durum: 'HashMismatch', Konu: TDF }, { Durum: 'UnknownError', Konu: TDF },
    { Durum: 'NotTrusted', Konu: TDF },
    { Durum: 'Valid', Konu: 'CN=Kotu Yazilim, O=Kotu' },
    { Durum: 'Valid', Konu: 'CN=Evil, O=Not The Document Foundation Ltd' },
    { Durum: 'Valid', Konu: 'CN=Evil, OU=The Document Foundation' },
  ]) {
    const r = await imzaDogrula(exe, { platform: 'win32', powershell: ps(o) });
    assert.equal(r.gecerli, false, JSON.stringify(o));
    assert.ok(!r.degraded);
  }
});

test('imza: PowerShell hatası/zaman aşımı/çöp çıktı "degraded" olarak reddedilir ve önbelleğe alınmaz', async () => {
  const onbellek = new Map();
  for (const p of [
    async () => { const e = new Error('zaman'); e.zamanAsimi = true; throw e; },
    async () => { throw new Error('ENOENT'); },
    ps('geçersiz json'), ps({ Durum: 'Valid', Konu: TDF }, 1),
  ]) {
    const r = await imzaDogrula(exe, { platform: 'win32', powershell: p, onbellek });
    assert.equal(r.gecerli, false);
    assert.equal(r.degraded, true);
  }
  assert.equal(onbellek.size, 0);
  assert.equal((await imzaDogrula(path.join(dizin, 'yok.exe'), { platform: 'win32', powershell: ps({ Durum: 'Valid', Konu: TDF }) })).gecerli, false);
});

test('imza: sonuç önbelleğe alınır; dosya değişirse yeniden denetlenir', async () => {
  const onbellek = new Map();
  let cagri = 0;
  const p = async () => { cagri++; return { kod: 0, stdout: JSON.stringify({ Durum: 'Valid', Konu: TDF }) }; };
  const dosya = path.join(dizin, 'onb', 'soffice.exe');
  fs.mkdirSync(path.dirname(dosya)); fs.writeFileSync(dosya, 'bir');
  await imzaDogrula(dosya, { platform: 'win32', powershell: p, onbellek });
  const ikinci = await imzaDogrula(dosya, { platform: 'win32', powershell: p, onbellek });
  assert.equal(cagri, 1); assert.equal(ikinci.onbellekten, true);
  fs.writeFileSync(dosya, 'degisti-uzun'); // boyut değişti
  await imzaDogrula(dosya, { platform: 'win32', powershell: p, onbellek });
  assert.equal(cagri, 2);
});

test('imza: PowerShell çağrısına yol komut içinde değil ortam değişkeniyle verilir', () => {
  const kaynak = okuMetin('src', 'imza.js');
  assert.match(kaynak, /shell: false/);
  assert.match(kaynak, /DD_IMZA_YOLU/);
  assert.match(kaynak, /Get-AuthenticodeSignature -LiteralPath \$env:DD_IMZA_YOLU/);
  assert.ok(imzaciUygunMu('CN="The Document Foundation", O=X'));
});

test('main.js: her soffice adayı (ayar, gömülü, ProgramFiles) imza denetiminden geçer; geçmeyen kullanılmaz', () => {
  const m = okuMetin('main.js');
  assert.match(m, /imzaDogrula\(a, \{ onbellek: imzaOnbellek \}\)/);
  assert.match(m, /sofficeAdaylari/);
  assert.match(m, /sofficeAramaYok: true/);
  assert.match(m, /'dogrulanamadi'/);
  assert.match(m, /D\.sofficeAdiGecerli\(ayarlar\.sofficeYolu\)/);
  const d = okuMetin('src', 'donustur.js');
  assert.match(d, /!ortam\.sofficeAramaYok/);
});

test('libreoffice.sofficeAdaylari: ayar, gömülü ve ProgramFiles adayları sırayla listelenir', () => {
  const g = path.join(dizin, 'gom'); const pf = path.join(dizin, 'pf');
  const gomulu = path.join(g, 'libreoffice', 'program', 'soffice');
  const resmi = path.join(pf, 'LibreOffice', 'program', 'soffice.exe');
  for (const f of [gomulu, resmi]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); }
  const ozel = path.join(dizin, 'soffice.exe');
  assert.deepEqual(lo.sofficeAdaylari({ platform: 'linux', env: { PATH: '' }, ozelYol: ozel, gomuluKlasor: g }), [ozel, gomulu]);
  assert.equal(lo.sofficeBul({ platform: 'linux', env: { PATH: '' }, gomuluKlasor: g }), gomulu);
  assert.equal(lo.sofficeAdaylari({ platform: 'win32', env: { ProgramFiles: pf }, ozelYol: path.join(dizin, 'cmd.exe') }).includes(resmi), true);
});
