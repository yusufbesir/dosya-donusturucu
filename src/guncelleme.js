'use strict';
// Güncelleme temizliği: yeni sürüm kurulup doğrulandıktan sonra, ESKİ sürümün manifestinde
// olup yenisinde olmayan dosyaları siler. Electron'a bağımlı değildir.
//
// Güvenlik özeti:
//  - Yalnız kurulum klasörü altında, önceki sürümün manifestinde adı geçen dosyalar silinir.
//  - Her yol bileşeni lstat ile denetlenir; sembolik bağ/junction izlenmez, silinmez.
//  - Gerçek yol (realpath) kurulum kökünün altında olmalı; korunacak köklerin altındaki hiçbir şey silinmez.
//  - Boyutu VE SHA-256'sı önceki manifesttekinden farklı dosyaya (kullanıcı değiştirmiş) dokunulmaz.
//  - Yeni sürüm doğrulanamazsa (boş manifest, çalışan exe ya da resources/app.asar girdisi yok, dosya/hash tutmuyor)
//    hiçbir şey silinmez. Çalışan exe, resources/app.asar ve resources/surum-manifest.json her durumda silinmez.
//  - Silmeden hemen önce tüm yol bileşenleri lstat ile, gerçek yol realpath ile bir kez daha denetlenir.
//  - temizlik-gunlugu.txt ve onceki-manifest geçici dosyası sembolik bağ izlemez (lstat + 'wx').
//
// KALAN YARIŞ PENCERESİ: son lstat/realpath denetimi ile unlink çağrısı arasındaki çok kısa aralıkta, kurulum
// klasörüne yazma yetkisi olan bir saldırgan bir ara klasörü bağ/junction ile değiştirebilir (Node'da unlinkat/openat yok).

const nodeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UYGULAMA = 'dosya-donusturucu';
const MANIFEST_GORELI = ['resources', 'surum-manifest.json'];
const SURUM_KLASORU = '.surum';
const ONCEKI = 'onceki-manifest.json';
const GUNLUK = 'temizlik-gunlugu.txt';
const ASAR_GORELI = 'resources/app.asar';
const MANIFEST_GORELI_YOL = 'resources/surum-manifest.json';

function varsayilanFs() {
  return Object.assign({}, nodeFs.promises, { createReadStream: nodeFs.createReadStream });
}

const buyukKucuk = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);

function altinda(kok, hedef, esitDahil) {
  const r = path.relative(buyukKucuk(path.resolve(kok)), buyukKucuk(path.resolve(hedef)));
  if (r === '') return !!esitDahil;
  return !r.startsWith('..') && !path.isAbsolute(r);
}

// Manifest yolu: '/' ayraçlı, göreli, '..', '.', sürücü harfi/UNC/ters bölü içermeyen
function goreliGecerli(yol) {
  if (typeof yol !== 'string' || yol.length === 0 || yol.length > 1024) return false;
  if (yol.includes('\0') || yol.includes('\\') || yol.includes(':')) return false;
  if (yol.startsWith('/')) return false;
  const parcalar = yol.split('/');
  if (parcalar.some((p) => p === '' || p === '.' || p === '..' || /[. ]$/.test(p))) return false;
  if (path.isAbsolute(yol) || path.win32.isAbsolute(yol)) return false;
  if (parcalar[0].toLowerCase() === SURUM_KLASORU) return false; // kendi kayıt klasörüne dokunma
  return true;
}

function manifestGecerli(m) {
  if (!m || typeof m !== 'object' || m.uygulama !== UYGULAMA || !Array.isArray(m.dosyalar)) return false;
  return m.dosyalar.every((d) => d && typeof d.yol === 'string' && Number.isInteger(d.boyut) && d.boyut >= 0);
}

async function jsonOku(fsi, yol) {
  try { return JSON.parse(await fsi.readFile(yol, 'utf8')); } catch (e) { return e && e.code === 'ENOENT' ? null : undefined; }
}

function sha256(fsi, yol) {
  return new Promise((coz, red) => {
    const h = crypto.createHash('sha256');
    const s = fsi.createReadStream(yol);
    s.on('error', red);
    s.on('data', (b) => h.update(b));
    s.on('end', () => coz(h.digest('hex')));
  });
}

const hashGerekli = (yol) => yol === 'resources/app.asar' || (!yol.includes('/') && yol.toLowerCase().endsWith('.exe'));

// Yeni sürümün kurulu dosyaları manifeste uyuyor mu?
async function yeniSurumuDogrula(fsi, gercekKok, yeni, calisanExe) {
  // Boş/eksik manifest "her şey silinebilir" sonucuna yol açmasın: çalışan exe ve app.asar girdisi şart
  if (yeni.dosyalar.length === 0) return 'manifest boş';
  const yollar = new Set(yeni.dosyalar.map((d) => String(d.yol).toLowerCase()));
  if (!yollar.has(ASAR_GORELI)) return 'manifestte resources/app.asar yok';
  if (typeof calisanExe !== 'string' || !calisanExe || !yollar.has(calisanExe.toLowerCase())) return 'manifestte çalışan exe yok';
  for (const d of yeni.dosyalar) {
    if (!goreliGecerli(d.yol)) return `geçersiz yol: ${String(d.yol).slice(0, 80)}`;
    const tam = path.join(gercekKok, ...d.yol.split('/'));
    let st;
    try { st = await fsi.lstat(tam); } catch { return `eksik: ${d.yol}`; }
    if (!st.isFile() || st.isSymbolicLink()) return `normal dosya değil: ${d.yol}`;
    if (st.size !== d.boyut) return `boyut tutmuyor: ${d.yol}`;
    if (hashGerekli(d.yol)) {
      if (typeof d.sha256 !== 'string') return `sha256 yok: ${d.yol}`;
      let h;
      try { h = await sha256(fsi, tam); } catch { return `okunamadı: ${d.yol}`; }
      if (h !== d.sha256.toLowerCase()) return `sha256 tutmuyor: ${d.yol}`;
    }
  }
  return null;
}

// Her yol bileşenini lstat ile denetler (bağ yok, ara bileşenler klasör, son bileşen normal dosya) ve gerçek yolu döndürür.
async function yolDenetle(fsi, gercekKok, parcalar) {
  let gecerli = gercekKok;
  let st = null;
  for (let i = 0; i < parcalar.length; i++) {
    gecerli = path.join(gecerli, parcalar[i]);
    try { st = await fsi.lstat(gecerli); } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { atla: 'yok' };
      throw e;
    }
    if (st.isSymbolicLink()) return { atla: 'bag' };
    if (i < parcalar.length - 1) { if (!st.isDirectory()) return { atla: 'klasor-degil' }; }
    else if (!st.isFile()) return { atla: 'dosya-degil' };
  }
  let gercek;
  try { gercek = await fsi.realpath(gecerli); } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { atla: 'yok' };
    throw e;
  }
  return { st, tam: gecerli, gercek };
}

// Tek aday için güvenli silme. Dönüş: { silindi:true } | { atla:'neden' }; beklenmeyen hatada fırlatır.
async function adayiSil(fsi, gercekKok, korunanlar, aday, korunanDosyalar = new Set()) {
  if (!goreliGecerli(aday.yol)) return { atla: 'gecersiz-yol' };
  if (korunanDosyalar.has(aday.yol.toLowerCase())) return { atla: 'korunan-dosya' };
  const parcalar = aday.yol.split('/');
  const tam = path.resolve(gercekKok, ...parcalar);
  if (!altinda(gercekKok, tam)) return { atla: 'kurulum-disi' };

  // 1. denetim
  const d1 = await yolDenetle(fsi, gercekKok, parcalar);
  if (d1.atla) return d1;
  if (d1.st.size !== aday.boyut) return { atla: 'boyut-degisti' };
  if (!altinda(gercekKok, d1.gercek)) return { atla: 'kurulum-disi' };
  for (const k of korunanlar) {
    if (altinda(k, tam, true) || altinda(k, d1.gercek, true)) return { atla: 'korunan' };
  }

  // Kullanıcı değiştirmediyse içerik önceki manifestteki SHA-256 ile aynıdır; tutmazsa dokunulmaz
  if (typeof aday.sha256 !== 'string') return { atla: 'sha256-yok' };
  let h;
  try { h = await sha256(fsi, tam); } catch { return { atla: 'okunamadi' }; }
  if (h !== aday.sha256.toLowerCase()) return { atla: 'sha256-degisti' };

  // Silmeden hemen önce: tüm bileşenler lstat ile ve realpath bir kez daha; hash sırasında dosya değişmemiş olmalı
  const d2 = await yolDenetle(fsi, gercekKok, parcalar);
  if (d2.atla) return d2;
  if (d2.gercek !== d1.gercek || !altinda(gercekKok, d2.gercek)) return { atla: 'yol-degisti' };
  if (d2.st.size !== aday.boyut || d2.st.ino !== d1.st.ino || d2.st.dev !== d1.st.dev || d2.st.mtimeMs !== d1.st.mtimeMs) return { atla: 'degisti' };

  await fsi.unlink(tam);
  return { silindi: true, tam };
}

// Boşalan klasörleri (yalnız kurulum kökü altında, yalnız gerçekten boşsa) yukarı doğru kaldır
async function bosKlasorleriKaldir(fsi, gercekKok, korunanlar, dosyaTam) {
  let k = path.dirname(dosyaTam);
  while (altinda(gercekKok, k)) {
    try {
      const st = await fsi.lstat(k);
      if (st.isSymbolicLink() || !st.isDirectory()) return;
      if (korunanlar.some((p) => altinda(p, k, true))) return;
      if ((await fsi.readdir(k)).length > 0) return;
      await fsi.rmdir(k); // boş değilse zaten başarısız olur
    } catch { return; }
    k = path.dirname(k);
  }
}

// Bağ izlenmesin: yazmadan önce lstat ile hedefin bağ olmadığı doğrulanır; yeni dosya 'wx' (O_EXCL) ile açılır.
async function baglaDegilMi(fsi, yol) {
  try {
    const st = await fsi.lstat(yol);
    return st.isFile() && !st.isSymbolicLink();
  } catch (e) { if (e && e.code === 'ENOENT') return true; throw e; }
}

async function manifestiYaz(fsi, surumKlasoru, yeni) {
  const gecici = path.join(surumKlasoru, `${ONCEKI}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const hedef = path.join(surumKlasoru, ONCEKI);
  try {
    try { await fsi.lstat(gecici); throw new Error('geçici dosya zaten var'); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    await fsi.writeFile(gecici, JSON.stringify(yeni), { flag: 'wx' });
    await fsi.rename(gecici, hedef); // rename hedefteki bağı izlemez, bağın kendisini değiştirir
  } catch (e) {
    try { if (await baglaDegilMi(fsi, gecici)) await fsi.unlink(gecici); } catch { /* yoksay */ }
    throw e;
  }
}

async function eskiSurumuTemizle({ kurulumKoku, resourcesYolu, korunacakKokler = [], calisanExe, fsImpl } = {}) {
  const exeAdi = typeof calisanExe === 'string' && calisanExe ? calisanExe : path.basename(process.execPath);
  const fsi = fsImpl || varsayilanFs();
  const sonuc = { durum: 'islem-yok', silinen: [], atlanan: [] };
  let surumKlasoru = null;
  const gunluk = async (satir) => {
    if (!surumKlasoru) return;
    try {
      const yol = path.join(surumKlasoru, GUNLUK);
      if (!(await baglaDegilMi(fsi, yol))) return; // sembolik bağ/özel dosya: yazma
      let var_ = true;
      try { await fsi.lstat(yol); } catch { var_ = false; }
      await fsi.appendFile(yol, `${new Date().toISOString()} ${satir}\n`, { flag: var_ ? 'a' : 'ax' });
    } catch { /* günlük hatası temizliği durdurmaz */ }
  };

  try {
    if (typeof kurulumKoku !== 'string' || !kurulumKoku || typeof resourcesYolu !== 'string' || !resourcesYolu) {
      return { ...sonuc, durum: 'hata', hata: 'kurulumKoku/resourcesYolu eksik' };
    }
    let gercekKok;
    try { gercekKok = await fsi.realpath(kurulumKoku); } catch { return { ...sonuc, durum: 'hata', hata: 'kurulum kökü bulunamadı' }; }

    // 1) Yeni manifest
    const yeni = await jsonOku(fsi, path.join(resourcesYolu, MANIFEST_GORELI[1]));
    if (yeni === null) return { ...sonuc, durum: 'manifest-yok' };
    if (!manifestGecerli(yeni)) return { ...sonuc, durum: 'manifest-yok' };

    // .surum klasörü gerçek bir klasör olmalı (bağ değil)
    const sk = path.join(gercekKok, SURUM_KLASORU);
    try {
      const st = await fsi.lstat(sk);
      if (st.isSymbolicLink() || !st.isDirectory()) return { ...sonuc, durum: 'hata', hata: '.surum klasörü geçersiz' };
    } catch (e) {
      if (!e || e.code !== 'ENOENT') throw e;
      await fsi.mkdir(sk);
    }
    surumKlasoru = sk;

    // 2) Önceki manifest
    let onceki = await jsonOku(fsi, path.join(sk, ONCEKI));
    if (onceki !== null && !manifestGecerli(onceki)) { await gunluk('onceki-manifest geçersiz, yok sayıldı'); onceki = null; }

    // Aynı sürüm zaten işlendiyse pahalı doğrulamayı yineleme
    if (onceki && onceki.surum === yeni.surum && onceki.olusturma === yeni.olusturma) return { ...sonuc, durum: 'guncel' };

    // 3) Yeni sürüm doğrulaması
    const neden = await yeniSurumuDogrula(fsi, gercekKok, yeni, exeAdi);
    if (neden) {
      await gunluk(`DOGRULANAMADI: ${neden}; hiçbir şey silinmedi`);
      return { ...sonuc, durum: 'dogrulanamadi', neden };
    }

    // 4) Silme adayları
    if (onceki) {
      const yeniKume = new Set(yeni.dosyalar.map((d) => d.yol.toLowerCase()));
      const adaylar = onceki.dosyalar.filter((d) => !yeniKume.has(String(d.yol).toLowerCase()));
      const korunanlar = [];
      for (const k of korunacakKokler) {
        if (typeof k !== 'string' || !k) continue;
        let r = path.resolve(k);
        try { r = await fsi.realpath(r); } catch { /* yoksa sözdizimsel yol */ }
        korunanlar.push(r);
        if (r !== path.resolve(k)) korunanlar.push(path.resolve(k));
      }
      const korunanDosyalar = new Set([exeAdi.toLowerCase(), ASAR_GORELI, MANIFEST_GORELI_YOL]);
      for (const aday of adaylar) {
        const r = await adayiSil(fsi, gercekKok, korunanlar, aday, korunanDosyalar);
        if (r.silindi) {
          sonuc.silinen.push(aday.yol);
          await gunluk(`SILINDI ${aday.yol}`);
          await bosKlasorleriKaldir(fsi, gercekKok, korunanlar, r.tam);
        } else {
          sonuc.atlanan.push({ yol: aday.yol, neden: r.atla });
          await gunluk(`ATLANDI ${String(aday.yol).slice(0, 200)} (${r.atla})`);
        }
      }
      sonuc.durum = 'temizlendi';
    } else {
      sonuc.durum = 'ilk-kurulum';
      await gunluk('önceki manifest yok; hiçbir şey silinmedi');
    }

    // 5) Yeni manifesti kaydet
    await manifestiYaz(fsi, sk, yeni);
    await gunluk(`manifest kaydedildi (surum ${yeni.surum})`);
    return sonuc;
  } catch (e) {
    // Yarıda kes; onceki-manifest güncellenmez (sonraki açılışta yeniden denenir)
    const mesaj = String((e && e.message) || e);
    await gunluk(`HATA: ${mesaj}; onceki-manifest güncellenmedi`);
    return { ...sonuc, durum: 'hata', hata: mesaj };
  }
}

module.exports = { eskiSurumuTemizle, goreliGecerli, UYGULAMA };
