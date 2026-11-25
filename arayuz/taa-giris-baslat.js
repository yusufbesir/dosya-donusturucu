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

  // Ortak bilgisayarda giren kişi kalıcı olmasın: sol altta hesap menüsü (Kullanıcı değiştir, Ekranı kilitle Ctrl+L, Çıkış yap).
  // Üçü de ortak oturumu kapatır; kilitte giriş ekranı kullanıcı adı dolu açılır.
  function cikisGoster(oturum) {
    var E = window.TaaGirisEkrani;
    if (E && E.hesapMenusu) E.hesapMenusu({ api: api, oturum: oturum, programAdi: 'TaaDön', cikinca: girisAc });
  }

  function girildi(oturum) { uyariGoster(oturum); cikisGoster(oturum); }

  // n: hesap menüsünden gelirse { neden: 'degistir'|'kilit'|'cikis', kullanici, ileti }.
  function girisAc(n) {
    ['taa-giris-cikis', 'taa-giris-hesap', 'taa-giris-menu'].forEach(function (k) { var d = document.getElementById(k); if (d) d.remove(); });
    if (document.querySelector('.taa-giris')) return;   // zaten açık
    if (!window.TaaGirisEkrani) { kilitle(); return; }   // ekran betiği yüklenemedi: girişsiz açılmaz
    window.TaaGirisEkrani.ac(document.body, { programAdi: 'TaaDön', api: api, girildi: girildi,
      kullanici: n && n.kullanici, kilitli: !!(n && n.neden === 'kilit'), ileti: n && n.ileti });
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
      if (b.oturum) { cikisGoster(b.oturum); return; }   // geçerli oturum var
      girisAc();
    }).catch(function () { girisAc(); }); // emin olunamıyorsa giriş istenir
  }

  function basla() {
    denetle();
    setInterval(denetle, ARALIK_MS);
    // Başka programda çıkış yapıldıysa ortak bilgisayarda pencere öne gelince hemen fark edilsin (en çok 5 sn'de bir).
    var son = Date.now();
    function odakDenetle() {
      if (document.visibilityState === 'hidden' || Date.now() - son < 5000) return;
      son = Date.now();
      denetle();
    }
    window.addEventListener('focus', odakDenetle);
    document.addEventListener('visibilitychange', odakDenetle);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', basla);
  else basla();
})();
