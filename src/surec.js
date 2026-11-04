'use strict';
// surec.js: TaaDön harici program çalıştırıcısı (shell:false, süreç ağacını öldürme, iptal/zaman aşımı).
// Sahip: Yusuf (TaaDön projesi). Değişiklik: Yusuf'un kuralları (ORTAK-AJAN-KURALLARI.md) çerçevesinde.
// yazan: [Claude#inceleme-duzeltme 2026-11-04] sert süre, geri çağrı istisnası, zamanAsimi aralık denetimi.

const { spawn } = require('node:child_process');

const KUYRUK_BAYT = 64 * 1024;
// agaciOldur sonrası 'close' gelmezse bu süre dolunca süreç zorla bırakılır ve promise reddedilir.
const SERT_SURE_MS = 5000;
const EN_AZ_ZAMAN_ASIMI = 1000;
const EN_COK_ZAMAN_ASIMI = 2 ** 31 - 1; // setTimeout üst sınırı

function sertOldur(cocuk) {
  try { cocuk.kill('SIGKILL'); } catch { /* yoksay */ }
}

function agaciOldur(cocuk) {
  if (!cocuk || cocuk.pid == null) return;
  try {
    if (process.platform === 'win32') {
      const t = spawn('taskkill', ['/pid', String(cocuk.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      t.on('error', () => sertOldur(cocuk));
      // taskkill başarısızsa (exit ≠ 0) en azından doğrudan çocuğu öldür.
      t.on('exit', (kod) => { if (kod !== 0) sertOldur(cocuk); });
    } else {
      try { process.kill(-cocuk.pid, 'SIGKILL'); } catch { sertOldur(cocuk); }
    }
  } catch { /* süreç zaten bitmiş olabilir */ }
}

function iptalHatasi() {
  const e = new Error('İşlem iptal edildi.');
  e.name = 'AbortError';
  e.iptal = true;
  return e;
}

function zamanAsimiHatasi() {
  const e = new Error('İşlem zaman aşımına uğradı.');
  e.zamanAsimi = true;
  return e;
}

/** Geçersiz (sayı değil, sonsuz, ≤0) değeri yoksayar; geçerliyi [1000, 2^31-1] aralığına sıkıştırır. */
function zamanAsimiDuzelt(deger) {
  if (deger == null) return null;
  const ms = Number(deger);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(EN_COK_ZAMAN_ASIMI, Math.max(EN_AZ_ZAMAN_ASIMI, Math.floor(ms)));
}

/**
 * Harici programı çalıştırır (shell:false). Süreç tamamen kapanana kadar bekler;
 * öldürme işe yaramazsa SERT_SURE_MS sonra yine de sonuçlanır (asılı kalmaz).
 * @returns {Promise<{kod:number, stdout:string, stderr:string}>}
 */
function calistir(yol, argumanlar, secenek = {}) {
  const { sinyal, stdoutVeri, stderrVeri, cwd, env } = secenek;
  const zamanAsimi = zamanAsimiDuzelt(secenek.zamanAsimi);
  return new Promise((coz, reddet) => {
    if (sinyal && sinyal.aborted) return reddet(iptalHatasi());
    let cocuk;
    try {
      cocuk = spawn(yol, argumanlar, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        cwd,
        env,
      });
    } catch (e) {
      return reddet(e);
    }
    let stdout = '';
    let stderr = '';
    let neden = null; // 'iptal' | 'zaman' | 'hata'
    let geriCagriHatasi = null;
    let zamanlayici = null;
    let sertZamanlayici = null;
    let bitti = false;

    const nedenHatasi = () => {
      if (neden === 'iptal') return iptalHatasi();
      if (neden === 'zaman') return zamanAsimiHatasi();
      return geriCagriHatasi || new Error('İşlem sonlandırıldı.');
    };

    const temizle = () => {
      if (zamanlayici) clearTimeout(zamanlayici);
      if (sertZamanlayici) clearTimeout(sertZamanlayici);
      zamanlayici = null;
      sertZamanlayici = null;
      if (sinyal) sinyal.removeEventListener('abort', iptalEt);
    };
    const sonuclan = (fn, deger) => {
      if (bitti) return;
      bitti = true;
      temizle();
      fn(deger);
    };

    // Süreci sonlandırır; 'close' SERT_SURE_MS içinde gelmezse zorla bırakıp reddeder.
    const sonlandir = (yeniNeden) => {
      neden = neden || yeniNeden;
      if (bitti) return;
      agaciOldur(cocuk);
      if (sertZamanlayici) return;
      sertZamanlayici = setTimeout(() => {
        sertOldur(cocuk);
        try { cocuk.stdout.destroy(); } catch { /* yoksay */ }
        try { cocuk.stderr.destroy(); } catch { /* yoksay */ }
        cocuk.removeAllListeners();
        try { cocuk.stdout.removeAllListeners(); cocuk.stderr.removeAllListeners(); } catch { /* yoksay */ }
        cocuk.on('error', () => { /* geç gelen hatalar yutulur */ });
        sonuclan(reddet, nedenHatasi());
      }, SERT_SURE_MS);
    };

    const geriCagir = (fn, d) => {
      if (!fn || neden === 'hata') return;
      try {
        fn(d);
      } catch (e) {
        geriCagriHatasi = e instanceof Error ? e : new Error(String(e));
        sonlandir('hata');
      }
    };

    const kisalt = (s) => (s.length > KUYRUK_BAYT * 2 ? s.slice(-KUYRUK_BAYT) : s);
    cocuk.stdout.setEncoding('utf8');
    cocuk.stderr.setEncoding('utf8');
    cocuk.stdout.on('data', (d) => { stdout = kisalt(stdout + d); geriCagir(stdoutVeri, d); });
    cocuk.stderr.on('data', (d) => { stderr = kisalt(stderr + d); geriCagir(stderrVeri, d); });

    const iptalEt = () => sonlandir('iptal');
    if (sinyal) sinyal.addEventListener('abort', iptalEt, { once: true });
    if (zamanAsimi) {
      zamanlayici = setTimeout(() => sonlandir('zaman'), zamanAsimi);
    }

    cocuk.on('error', (e) => {
      if (e.code === 'ENOENT') sonuclan(reddet, new Error(`Program bulunamadı: ${yol}`));
      else sonuclan(reddet, e);
    });
    cocuk.on('close', (kod) => {
      if (neden) return sonuclan(reddet, nedenHatasi());
      sonuclan(coz, { kod: kod == null ? -1 : kod, stdout, stderr });
    });
  });
}

module.exports = { calistir, iptalHatasi, agaciOldur, zamanAsimiDuzelt, SERT_SURE_MS };
