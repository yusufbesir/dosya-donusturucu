'use strict';
// exe-kaynak.js ve manifest-uret.js testleri: ikon/sürüm gömme ve manifest hash'inin gömmeden sonra tutması.
// Gerçek Windows exe gerekir (dist/win-unpacked/Dosya Dönüştürücü.exe); yoksa ilgili test atlanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ResEdit = require('resedit');
const { exeKaynaklariniGom, surumDortlu } = require('../scripts/exe-kaynak');
const { dosyalariTopla } = require('../scripts/manifest-uret');

const KOK = path.join(__dirname, '..');
const IKON = path.join(KOK, 'build', 'ikon.ico');
const KAYNAK_EXE = path.join(KOK, 'dist', 'win-unpacked', 'Dosya Dönüştürücü.exe');
const exeVar = fs.existsSync(KAYNAK_EXE);

// .ico dizininden ham görüntü baytlarını çıkarır
function icoGoruntuleri(bayt) {
  const adet = bayt.readUInt16LE(4);
  const sonuc = [];
  for (let i = 0; i < adet; i++) {
    const o = 6 + i * 16;
    const boyut = bayt.readUInt32LE(o + 8);
    const ofset = bayt.readUInt32LE(o + 12);
    sonuc.push(bayt.subarray(ofset, ofset + boyut));
  }
  return sonuc;
}

test('surumDortlu: sürümü 4 sayıya tamamlar, geçersizi reddeder', () => {
  assert.deepEqual(surumDortlu('1.0.7'), [1, 0, 7, 0]);
  assert.deepEqual(surumDortlu('2.3.4.5'), [2, 3, 4, 5]);
  assert.throws(() => surumDortlu('abc'));
});

test('exeKaynaklariniGom: ikonlar ikon.ico ile aynı, sürüm bilgisi doğru, manifest hash tutar',
  { skip: exeVar ? false : 'dist/win-unpacked exe yok' }, async () => {
    const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-exe-'));
    try {
      const exeYolu = path.join(dizin, 'Dosya Dönüştürücü.exe');
      fs.copyFileSync(KAYNAK_EXE, exeYolu);
      exeKaynaklariniGom(exeYolu, { ikonYolu: IKON, surum: '1.0.7', urunAdi: 'Dosya Dönüştürücü' });

      const res = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(exeYolu)));
      const beklenen = icoGoruntuleri(fs.readFileSync(IKON));
      const ikonlar = res.entries.filter((e) => e.type === 3);
      assert.equal(ikonlar.length, beklenen.length);
      assert.equal(ResEdit.Resource.IconGroupEntry.fromEntries(res.entries).length, 1);
      const gercek = ikonlar.map((e) => Buffer.from(e.bin));
      for (const b of beklenen) {
        assert.ok(gercek.some((g) => g.equals(b)), 'ikon.ico görüntüsü exe içinde bulunamadı');
      }

      const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
      const dizeler = vi.getStringValues(vi.getAllLanguagesForStringValues()[0]);
      assert.equal(dizeler.FileDescription, 'Dosya Dönüştürücü');
      assert.equal(dizeler.ProductName, 'Dosya Dönüştürücü');
      assert.equal(dizeler.FileVersion, '1.0.7.0');
      assert.equal(dizeler.ProductVersion, '1.0.7.0');
      assert.equal(dizeler.OriginalFilename, 'Dosya Dönüştürücü.exe');
      assert.equal(dizeler.CompanyName, undefined);
      assert.equal(dizeler.LegalCopyright, undefined);

      // gömmeden SONRA hesaplanan manifest girdisi dosyanın gerçek özetiyle tutar
      const dosyalar = await dosyalariTopla(dizin);
      const girdi = dosyalar.find((d) => d.yol === 'Dosya Dönüştürücü.exe');
      const bayt = fs.readFileSync(exeYolu);
      assert.equal(girdi.sha256, crypto.createHash('sha256').update(bayt).digest('hex'));
      assert.equal(girdi.boyut, bayt.length);
    } finally {
      fs.rmSync(dizin, { recursive: true, force: true });
    }
  });
