// Sahip: Yusuf. yazan: [Claude#hesap-menusu-cekmece 2026-11-26]
// Sol menü ve alttaki Kuyruk paneli çekmece gibi içe katlanır; kapanınca kenardaki ok düğmesi geri açar (Ctrl+B sol menüyü açar/kapatır).
// Durum yalnız bu bilgisayarda (localStorage) hatırlanır; depolama yoksa oturum boyunca çalışır. Stiller stil.css'te (CSP: style-src 'self').
(function () {
  'use strict';
  var ANAHTAR = 'taadon-cekmece';
  var durum = { sol: true, kuyruk: true };
  try { var k = JSON.parse(localStorage.getItem(ANAHTAR) || '{}'); if (k && typeof k === 'object') { durum.sol = k.sol !== false; durum.kuyruk = k.kuyruk !== false; } } catch (e) { /* varsayılan: ikisi açık */ }
  function sakla() { try { localStorage.setItem(ANAHTAR, JSON.stringify(durum)); } catch (e) { /* yalnız bu oturum */ } }

  function dugme(sinif, ad) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'cekmece-ok ' + sinif; b.setAttribute('aria-label', ad); b.title = ad;
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    return b;
  }

  function basla() {
    var kabuk = document.querySelector('.kabuk'), yan = document.querySelector('.yan'), kuyruk = document.getElementById('kuyruk');
    if (!kabuk || !yan || !kuyruk) return;
    if (!yan.id) yan.id = 'yan-menu';

    var sol = dugme('cekmece-sol', 'Menüyü daralt');
    sol.setAttribute('aria-controls', yan.id);
    kabuk.appendChild(sol);
    function solUygula() {
      kabuk.classList.toggle('yan-kapali', !durum.sol);
      yan.inert = !durum.sol;
      sol.setAttribute('aria-expanded', String(durum.sol));
      var ad = durum.sol ? 'Menüyü daralt (Ctrl+B)' : 'Menüyü aç (Ctrl+B)';
      sol.setAttribute('aria-label', ad); sol.title = ad;
    }
    sol.addEventListener('click', function () { durum.sol = !durum.sol; solUygula(); sakla(); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        var t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault(); durum.sol = !durum.sol; solUygula(); sakla();
      }
    });

    var baslik = kuyruk.querySelector('.kuyruk-baslik'), liste = document.getElementById('kuyruk-liste');
    var alt = dugme('cekmece-alt', 'Kuyruğu daralt');
    if (liste) alt.setAttribute('aria-controls', 'kuyruk-liste');
    if (baslik) baslik.insertBefore(alt, baslik.firstChild);
    function kuyrukUygula() {
      kuyruk.classList.toggle('kapali', !durum.kuyruk);
      alt.setAttribute('aria-expanded', String(durum.kuyruk));
      var ad = durum.kuyruk ? 'Kuyruğu daralt' : 'Kuyruğu aç';
      alt.setAttribute('aria-label', ad); alt.title = ad;
    }
    alt.addEventListener('click', function () { durum.kuyruk = !durum.kuyruk; kuyrukUygula(); sakla(); });
    solUygula(); kuyrukUygula();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', basla); else basla();
})();
