'use strict';
// Ne: calibre.js / imza.js / hazırlama betikleri için ek testler (PowerShell yol aktarımı, ortam, hata metni, DN ayrıştırma, önbellek TTL).
// Sahibi: Dosya dönüştürücü işi (yazan: Claude). Değiştirme kuralı: yalnız ekleme; silme yalnız Yusuf'un kararıyla, çöp kutusuna taşıyarak.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const lo = require('../scripts/libreoffice-hazirla');
const ch = require('../scripts/calibre-hazirla');
const calibre = require('../src/motorlar/calibre');
const { imzaDogrula, imzaciUygunMu } = require('../src/imza');

test('imzaPsKomutu: $args yok, yol ortam değişkeninde', () => {
  for (const f of [lo.imzaPsKomutu, ch.imzaPsKomutu]) {
    const k = f('D:/a b/x.msi', { PATH: 'p' });
    assert.equal(k.args.join(' ').includes('$args'), false);
    assert.equal(k.args.includes('D:/a b/x.msi'), false);
    assert.match(k.args[k.args.length - 1], /\$env:DD_IMZA_YOLU/);
    assert.equal(k.env.DD_IMZA_YOLU, 'D:/a b/x.msi');
    assert.equal(k.env.PATH, 'p');
  }
});

test('isOrtami: bayraklar ve dil', () => {
  const o = calibre.isOrtami(os.tmpdir(), {});
  assert.equal(o.CALIBRE_OVERRIDE_LANG, 'en');
  assert.equal(o.QTWEBENGINE_CHROMIUM_FLAGS, '--proxy-server=127.0.0.1:9 --host-resolver-rules=MAP * ~NOTFOUND');
});

test('hataMetni: DRM, açılamadı, bozuk, genel; ham stderr sızmaz', () => {
  assert.equal(calibre.hataMetni(1, '', 'book is locked with DRM'), calibre.DRM_HATASI);
  assert.equal(calibre.hataMetni(1, '', 'X is DRM'), calibre.DRM_HATASI);
  assert.equal(calibre.hataMetni(1, '', 'DRM locked'), calibre.DRM_HATASI);
  assert.equal(calibre.hataMetni(1, '', 'No such file or directory'), 'Dosya açılamadı.');
  assert.equal(calibre.hataMetni(1, '', 'zipfile.BadZipFile: x'), 'Dosya bozuk.');
  const g = calibre.hataMetni(1, '', 'Traceback secret-detail');
  assert.equal(g, 'E-kitap dönüştürülemedi. Dosya bozuk ya da desteklenmeyen biçimde olabilir; başka bir hedef (ör. EPUB) deneyin.');
  assert.ok(!g.includes('secret'));
});

test('imzaciUygunMu: tırnak içindeki virgül bölmez', () => {
  assert.equal(imzaciUygunMu('CN="The Document Foundation", O="X, Inc.", C=DE'), true);
  assert.equal(imzaciUygunMu('CN="Evil, CN=The Document Foundation"'), false);
  assert.equal(imzaciUygunMu('O="Kovid Goyal", C=IN', 'Kovid Goyal'), true);
});

test('imzaDogrula önbelleği: TTL dolunca yeniden denetler', async () => {
  const d = path.join(os.tmpdir(), `imzattl-${process.pid}-${Date.now()}.exe`);
  fs.writeFileSync(d, 'x');
  try {
    let cagri = 0; let t = 1000;
    const ps = async () => { cagri++; return { kod: 0, stdout: JSON.stringify({ Durum: 'Valid', Konu: 'CN=The Document Foundation' }) }; };
    const s = { platform: 'win32', powershell: ps, onbellek: new Map(), simdi: () => t };
    await imzaDogrula(d, s); await imzaDogrula(d, s);
    assert.equal(cagri, 1);
    t += 11 * 60 * 1000;
    const r = await imzaDogrula(d, s);
    assert.equal(cagri, 2); assert.equal(r.gecerli, true); assert.equal(r.onbellekten, undefined);
    assert.ok([...s.onbellek.keys()][0].split('|').length >= 5);
  } finally { fs.unlinkSync(d); }
});
