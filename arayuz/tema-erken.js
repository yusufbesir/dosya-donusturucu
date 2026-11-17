// TaaDön görünüm çözücü: tema (tayf|matbaa|dokum), kip (acik|koyu) ve vurgu rengini <html> üzerine yazar.
// <head> içinde, stil dosyasından önce ve modül olmadan yüklenir; böylece ilk boyamada yanlış tema parlamaz.
// Son bilinen görünüm localStorage'dan okunur (asıl kayıt main süreçteki ayarlar.json; uygulama.js her
// değişiklikte bu kopyayı tazeler). CSP 'self' ile uyumlu: satır içi betik ya da stil yok, renkler CSSOM ile yazılır.
// yazan: [Claude Opus 5.5, TaaDön arayüz başlığı, 2026-11-17]
(function () {
  'use strict';
  var TEMALAR = ['tayf', 'matbaa', 'dokum'];
  var KIPLER = ['sistem', 'acik', 'koyu'];
  var HAZIR = {
    visne: { acik: ['#8A2F42', '#FFFFFF'], koyu: ['#F1A8B6', '#38151F'] },
    orman: { acik: ['#14634F', '#FFFFFF'], koyu: ['#A4D9BD', '#17372A'] }
  };
  var ANAHTAR = 'taadon.gorunum';
  var medya = null;
  try { medya = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { medya = null; }

  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbHex(r) { return '#' + r.map(function (x) { var s = Math.round(Math.max(0, Math.min(255, x))).toString(16); return s.length < 2 ? '0' + s : s; }).join('').toUpperCase(); }
  function parlaklik(h) {
    var c = hexRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function oran(a, b) { var x = parlaklik(a), y = parlaklik(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Rengi beyaza (t>0) ya da siyaha (t<0) doğru |t| oranında karıştırır.
  function karistir(h, t) { var c = hexRgb(h); var hedef = t > 0 ? 255 : 0; var k = Math.abs(t); return rgbHex(c.map(function (v) { return v + (hedef - v) * k; })); }

  // Serbest renk: kipin zeminine en az 3:1, üstündeki yazıya en az 4,5:1 olacak biçimde açıklığı ayarlanır.
  function serbestVurgu(hex, kip) {
    var zemin = kip === 'koyu' ? '#151515' : '#F5F5F5';
    var renk = hex.toUpperCase();
    var yon = kip === 'koyu' ? 1 : -1; // koyuda açılır, açıkta koyulaşır
    for (var i = 0; i < 20 && oran(renk, zemin) < 3; i++) renk = karistir(renk, yon * 0.08);
    var beyaz = '#FFFFFF', siyah = '#141A22';
    var yazi = oran(renk, beyaz) >= oran(renk, siyah) ? beyaz : siyah;
    var adim = yazi === beyaz ? -0.06 : 0.06;
    for (var j = 0; j < 20 && oran(renk, yazi) < 4.5; j++) renk = karistir(renk, adim);
    return [renk, yazi];
  }

  function kipCoz(tercih) {
    if (tercih === 'acik' || tercih === 'koyu') return tercih;
    return medya && medya.matches ? 'koyu' : 'acik';
  }

  function duzelt(g) {
    g = g && typeof g === 'object' ? g : {};
    var tema = TEMALAR.indexOf(g.tema) >= 0 ? g.tema : 'tayf';
    var kip = KIPLER.indexOf(g.kipTercih) >= 0 ? g.kipTercih : 'sistem';
    var vurgu = (typeof g.vurgu === 'string' && (HAZIR[g.vurgu] || /^#[0-9a-fA-F]{6}$/.test(g.vurgu))) ? g.vurgu : '';
    return { tema: tema, kipTercih: kip, vurgu: vurgu };
  }

  function uygula(g) {
    g = duzelt(g);
    var kok = document.documentElement;
    var kip = kipCoz(g.kipTercih);
    kok.setAttribute('data-tema', g.tema);
    kok.setAttribute('data-kip', kip);
    var cift = null;
    if (HAZIR[g.vurgu]) cift = HAZIR[g.vurgu][kip];
    else if (g.vurgu) cift = serbestVurgu(g.vurgu, kip);
    if (cift) { kok.style.setProperty('--vurgu', cift[0]); kok.style.setProperty('--vurgu-metin', cift[1]); }
    else { kok.style.removeProperty('--vurgu'); kok.style.removeProperty('--vurgu-metin'); }
    return g;
  }

  function sakla(g) { try { localStorage.setItem(ANAHTAR, JSON.stringify(duzelt(g))); } catch (e) { /* depolama yoksa yalnız bu oturum */ } }
  function oku() { try { return duzelt(JSON.parse(localStorage.getItem(ANAHTAR) || '{}')); } catch (e) { return duzelt({}); } }

  var son = uygula(oku());
  if (medya && typeof medya.addEventListener === 'function') {
    medya.addEventListener('change', function () { if (son.kipTercih === 'sistem') uygula(son); });
  }

  window.taadonGorunum = Object.freeze({
    TEMALAR: TEMALAR, KIPLER: KIPLER, HAZIR: HAZIR,
    uygula: function (g) { son = uygula(g); sakla(son); return son; },
    kipCoz: kipCoz, oran: oran, serbestVurgu: serbestVurgu, duzelt: duzelt
  });
})();
