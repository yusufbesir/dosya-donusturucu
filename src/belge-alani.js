'use strict';
// belge-alani.js: TaaDön "belgeler" veri alanı sahipliği (docs/T2-TASARIM.md §1, §3 B3).
// Sahip: Yusuf. yazan: [Claude#dosya-donusturucu-T2 2026-11-05]
// Geçmiş kayıtları <TAA_VERI_KOK>/belgeler/kayitlar.json dosyasındadır (şema gecmis.json ile aynı).
// İlk açılışta userData/gecmis.json alana KOPYALANIR, eskisi gecmis.json.tasindi olur (silme yok).
// Alan açılamaz/yazılamazsa eski yol (userData/gecmis.json) ve günlük kullanılır.
// Başka bir program alanın asıl sahibiyse alan salt okunur açılır (alana yazılmaz; kendi kayıtlar userData/gecmis.json'a).

const fs = require('node:fs');
const path = require('node:path');
const veri = require('../taa/taa-veri.js');

const ALAN = 'belgeler';
const PROGRAM = 'taadon';
const DOSYA = 'kayitlar.json';

// secenek: { userData, surum, env?, gunluk?, jsonYaz? }
//  jsonYaz(yol, veri): eski yol yazıcısı (main.js jsonYaz'ı); verilmezse yerleşik atomik yazıcı.
function olustur(secenek) {
  const { userData, surum, env } = secenek;
  const gunluk = secenek.gunluk || (() => {});
  const eskiYol = path.join(userData, 'gecmis.json');
  const eskiYaz = secenek.jsonYaz || ((yol, v) => {
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    const g = `${yol}.tmp`;
    fs.writeFileSync(g, JSON.stringify(v, null, 2), 'utf8');
    fs.renameSync(g, yol);
  });
  // kip: 'alan' (sahip, yazılır) | 'salt-okunur' (başka sahip) | 'eski' (alan yok/yazılamıyor)
  const durum = { kip: 'eski', sahip: null, neden: '' };
  let sahip = null;

  function eskiOku() {
    try { return JSON.parse(fs.readFileSync(eskiYol, 'utf8')); } catch { return []; }
  }
  // Alandaki kayıt dosyasını okur. Bozuk JSON (yalnız sahipken): dosya <alan>/eski/ altına taşınır ki sonraki yazım
  // bozuk içeriği ezmesin (silme yok); boş listeyle devam edilir ve günlüğe yazılır.
  function alandanOku(okuyucu, bozukYol) {
    let m;
    try { m = okuyucu(); } catch (e) {
      if (e && e.code === 'ENOENT') return []; // henüz kayıt yok
      gunluk(`belgeler alanı okunamadı: ${e.message}`); return [];
    }
    if (m == null) return [];
    try { const v = JSON.parse(m); return Array.isArray(v) ? v : []; } catch (e) {
      if (bozukYol && sahip) {
        try { const h = veri.eskiyeTasi(sahip.dizin, bozukYol, DOSYA); gunluk(`belgeler: bozuk ${DOSYA} eski/ altına taşındı: ${h}`); } catch (e2) { gunluk(`belgeler: bozuk ${DOSYA} taşınamadı: ${e2.message}`); }
      } else gunluk(`belgeler alanı okunamadı: ${e.message}`);
      return [];
    }
  }

  function ac() {
    try {
      sahip = veri.acSahip({ alan: ALAN, program: PROGRAM, surum, env });
    } catch (e) {
      if (e instanceof veri.BaskaSahip) {
        // Asıl sahip başka program: salt okunur aç, kullanıcıya bildirilebilsin.
        durum.sahip = e.sahip;
        try {
          const okur = veri.acOkur({ alan: ALAN, program: PROGRAM, env });
          durum.kip = 'salt-okunur';
          durum.neden = `belgeler alanı ${e.sahip} tarafından yönetiliyor`;
          return okur;
        } catch (e2) { gunluk(`belgeler alanı salt okunur açılamadı: ${e2.message}`); }
      } else {
        gunluk(`belgeler alanı açılamadı, eski yol kullanılıyor: ${e.message}`);
      }
      durum.kip = 'eski';
      durum.neden = e.message;
      return null;
    }
    const g = veri.goc({ eskiYol, alan: ALAN, hedefAd: DOSYA, env });
    if (g.durum === 'hata') {
      // Alan yazılamıyor: eski yolla devam (göç yarım kalmadı; eskisi yerinde).
      gunluk(`belgeler göçü yapılamadı, eski yol kullanılıyor: ${g.hata}`);
      sahip = null; durum.kip = 'eski'; durum.neden = g.hata;
      return null;
    }
    durum.kip = 'alan'; durum.sahip = PROGRAM; durum.goc = g.durum;
    return null;
  }

  // Geçmiş kayıtlarını döndürür (dizi); süzme/sınırlama çağırana aittir.
  function yukle() {
    const okur = ac();
    if (durum.kip === 'alan') {
      const yol = path.join(sahip.dizin, DOSYA);
      const liste = alandanOku(() => fs.readFileSync(yol, 'utf8'), yol);
      return eskiKalintiBirlestir(liste);
    }
    if (durum.kip === 'salt-okunur') {
      // Alan başkasının: alandaki kayıtlar + bu kipte yerel dosyaya yazılmış kendi kayıtlarımız (yinelenen atlanır)
      const alan = alandanOku(() => okur.oku(DOSYA));
      const var_ = new Set(alan.map((k) => JSON.stringify(k)));
      return alan.concat(eskiOku().filter((k) => !var_.has(JSON.stringify(k))));
    }
    return eskiOku();
  }

  // Önceki oturumda alan yazılamayıp eski yola düşülmüşse userData/gecmis.json yeniden oluşmuş olur.
  // Göç bir kez yapıldığı için bu kalıntı alanda yoktur: alandaki listeyle birleştirilir (yinelenen kayıt atlanır),
  // alana yazılır ve kalıntı gecmis.json.tasindi-<zaman> olarak yeniden adlandırılır (silme yok).
  function eskiKalintiBirlestir(liste) {
    if (!fs.existsSync(eskiYol)) return liste;
    let eski;
    try { eski = JSON.parse(fs.readFileSync(eskiYol, 'utf8')); } catch { eski = null; }
    if (!Array.isArray(eski)) { gunluk('belgeler: eski gecmis.json kalıntısı okunamadı, yok sayıldı'); return liste; }
    const var_ = new Set(liste.map((k) => JSON.stringify(k)));
    const eklenen = eski.filter((k) => !var_.has(JSON.stringify(k)));
    const birlesik = liste.concat(eklenen);
    try {
      if (eklenen.length) sahip.yaz(DOSYA, JSON.stringify(birlesik, null, 2));
      const damga = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
      fs.renameSync(eskiYol, `${eskiYol}.tasindi-${damga}`);
      if (eklenen.length) gunluk(`belgeler: eski yoldaki ${eklenen.length} kayıt alana birleştirildi`);
    } catch (e) {
      gunluk(`belgeler: eski kalıntı birleştirilemedi, bellekte birleştirildi: ${e.message}`);
    }
    return birlesik;
  }

  // Kayıtları kalıcılaştırır. Alan yazımı başarısızsa eski yola düşer ve günlüğe yazar.
  // Salt okunur kipte alana DOKUNULMAZ; geçmiş kaybolmasın diye yerel dosyaya (userData/gecmis.json) yazılır (güvenlik, orta).
  function yaz(liste) {
    if (durum.kip === 'salt-okunur') {
      if (!durum.not) { durum.not = 'alan salt okunur; geçmiş yerel dosyaya yazılıyor'; gunluk(`belgeler: ${durum.not}`); }
      eskiYaz(eskiYol, liste);
      return true;
    }
    if (durum.kip === 'alan') {
      try { sahip.yaz(DOSYA, JSON.stringify(liste, null, 2)); return true; } catch (e) {
        gunluk(`belgeler alanına yazılamadı, eski yola düşüldü: ${e.message}`);
        durum.kip = 'eski'; durum.neden = e.message;
      }
    }
    eskiYaz(eskiYol, liste);
    return true;
  }

  return { yukle, yaz, durum };
}

module.exports = { olustur, ALAN, PROGRAM, DOSYA };
