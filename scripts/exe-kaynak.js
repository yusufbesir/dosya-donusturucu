'use strict';
// Windows exe'ye ikon ve sürüm bilgisi kaynaklarını gömer (resedit + pe-library, saf JS; Wine gerekmez).
// electron-builder'ın kendi gömmesi (signAndEditExecutable) kapatıldığı için bunu afterPack kancası
// (scripts/manifest-uret.js) manifest hash'lerinden ÖNCE çağırır; böylece exe sonradan değişmez ve
// surum-manifest.json içindeki exe sha256'sı gerçek dosyayla tutar.
// Yapılanlar: (1) electron'un mevcut ikon grubunun ID/dilini koruyup tüm ikonları build/ikon.ico ile değiştirir;
// (2) sürüm bilgisini (FileDescription, ProductName, FileVersion, ProductVersion, OriginalFilename) yeniden yazar.
// CompanyName ve LegalCopyright eklenmez; electron'dan kalan eski sürüm dizeleri atılır.
// Görev çubuğu fare üstü adı FileDescription'dan geldiği için bu alan ürün adı olmalıdır.

const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit'); // CJS giriş: dist/index.js (exports.require)

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;

function surumDortlu(surum) {
  const p = String(surum).split(/[.+-]/).slice(0, 4).map((x) => Number.parseInt(x, 10));
  if (p.length < 1 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 65535)) {
    throw new Error(`Geçersiz sürüm: ${surum}`);
  }
  while (p.length < 4) p.push(0);
  return p;
}

// exeYolu: yerinde değiştirilir. Seçenekler: { ikonYolu, surum, urunAdi, dosyaAdi? }
function exeKaynaklariniGom(exeYolu, { ikonYolu, surum, urunAdi, dosyaAdi } = {}) {
  if (!exeYolu || !ikonYolu || !surum || !urunAdi) throw new Error('exeYolu, ikonYolu, surum ve urunAdi gerekli');
  const exeBayt = fs.readFileSync(exeYolu);
  const ikonDosyasi = ResEdit.Data.IconFile.from(fs.readFileSync(ikonYolu));
  const exe = ResEdit.NtExecutable.from(exeBayt);
  const res = ResEdit.NtExecutableResource.from(exe);

  // İkon: mevcut ana grubun ID ve dilini al, eski ikon kaynaklarını at, ikon.ico'yu ekle
  const mevcut = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  const grupId = mevcut ? mevcut.id : 1;
  const dil = mevcut ? mevcut.lang : 1033;
  res.entries = res.entries.filter((e) => e.type !== RT_ICON && e.type !== RT_GROUP_ICON);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, grupId, dil, ikonDosyasi.icons.map((i) => i.data));

  // Sürüm bilgisi: eskiyi at, sıfırdan yaz
  const vDil = (ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || {}).lang || 1033;
  res.entries = res.entries.filter((e) => e.type !== RT_VERSION);
  const [a, b, c, d] = surumDortlu(surum);
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(a, b, c, d, vDil);
  vi.setProductVersion(a, b, c, d, vDil);
  vi.setStringValues({ lang: vDil, codepage: 1200 }, {
    FileDescription: urunAdi,
    ProductName: urunAdi,
    FileVersion: `${a}.${b}.${c}.${d}`,
    ProductVersion: `${a}.${b}.${c}.${d}`,
    OriginalFilename: dosyaAdi || path.basename(exeYolu),
    InternalName: urunAdi,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exeYolu, Buffer.from(exe.generate()));
  return { grupId, dil };
}

module.exports = { exeKaynaklariniGom, surumDortlu };
