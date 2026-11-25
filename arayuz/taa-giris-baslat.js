// Sahip: Yusuf. yazan: [Claude#KM2-hesap-giris 2026-11-25]
// TaaDön açılışında TAA ortak girişi (KM1). Stiller arayuz/taa-giris.css'te (CSP style-src 'self'). window.taaGiris preload.js'den gelir.
// Kural: bu bilgisayarda taa-kimlik kuruluysa giriş zorunlu; kurulu değilse program eskisi gibi açılır.
// Geçerli oturum varsa ekran gösterilmez. Şifre bu dosyada hiç tutulmaz.
(function () {
  'use strict';
  var api = window.taaGiris;
  if (!api) return;   // preload köprüsü yok: araç bilgisi alınamaz
  var ARALIK_MS = 10 * 60 * 1000;   // süren oturum aralıkla yeniden denetlenir (süre dolunca ya da yetki kalkınca giriş istenir)

  function uyariGoster(oturum) {
    var metin = window.TaaGirisEkrani.uyariMetni(oturum);
    if (!metin) return;
    var d = document.createElement('div');
    d.className = 'taa-oturum-uyari';
    d.setAttribute('role', 'alert');
    d.textContent = metin;
    var k = document.createElement('button');
    k.type = 'button'; k.setAttribute('aria-label', 'Kapat'); k.textContent = '×';
    k.addEventListener('click', function () { d.remove(); });
    d.appendChild(k);
    document.body.appendChild(d);
  }

  function girisAc() {
    if (document.querySelector('.taa-giris')) return;   // zaten açık
    if (!window.TaaGirisEkrani) { kilitle(); return; }   // ekran betiği yüklenemedi: girişsiz açılmaz
    window.TaaGirisEkrani.ac(document.body, { programAdi: 'TaaDön', girildi: uyariGoster });
  }

  // Ekran betiği yoksa sayfa kapatılır; program yeniden kurulmalı.
  function kilitle() {
    if (document.getElementById('taa-giris-kilit')) return;
    Array.prototype.forEach.call(document.body.children, function (e) { e.inert = true; });
    var d = document.createElement('div');
    d.id = 'taa-giris-kilit';
    d.setAttribute('role', 'alert');
    d.textContent = 'Giriş ekranı yüklenemedi. TaaDön\'ü yeniden kurun ya da yöneticinize haber verin.';
    document.body.appendChild(d);
  }

  function denetle() {
    return Promise.resolve().then(function () { return api.baslangic(); }).then(function (b) {
      if (!b || !b.arac) return;          // taa-kimlik kurulu değil: eski davranış
      if (b.oturum) return;               // geçerli oturum var
      girisAc();
    }).catch(function () { girisAc(); }); // emin olunamıyorsa giriş istenir
  }

  function basla() {
    denetle();
    setInterval(denetle, ARALIK_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', basla);
  else basla();
})();
