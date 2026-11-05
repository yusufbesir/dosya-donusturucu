'use strict';
// belge-alani.js: TaaDön "belgeler" veri alanı sahipliği (docs/T2-TASARIM.md §1, §3 B3).
// Sahip: Yusuf. yazan: [Claude#dosya-donusturucu-T2 2026-11-05]
// Geçmiş kayıtları <TAA_VERI_KOK>/belgeler/kayitlar.json dosyasındadır (şema gecmis.json ile aynı).
// İlk açılışta userData/gecmis.json alana KOPYALANIR, eskisi gecmis.json.tasindi olur (silme yok).
// Alan açılamaz/yazılamazsa eski yol (userData/gecmis.json) ve günlük kullanılır.
// Başka bir program alanın asıl sahibiyse alan salt okunur açılır (yazılmaz).

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
  function alandanOku(okuyucu) {
    try {
      const m = okuyucu();
      return m == null ? [] : JSON.parse(m);
    } catch (e) {
      if (e && e.code === 'ENOENT') return []; // henüz kayıt yok
      gunluk(`belgeler alanı okunamadı: ${e.message}`); return [];
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
    if (durum.kip === 'alan') return alandanOku(() => fs.readFileSync(path.join(sahip.dizin, DOSYA), 'utf8'));
    if (durum.kip === 'salt-okunur') return alandanOku(() => okur.oku(DOSYA));
    return eskiOku();
  }

  // Kayıtları kalıcılaştırır. Alan yazımı başarısızsa eski yola düşer ve günlüğe yazar.
  function yaz(liste) {
    if (durum.kip === 'salt-okunur') return false; // alan başkasının: yazma yok
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
