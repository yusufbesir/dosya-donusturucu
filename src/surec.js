'use strict';

const { spawn } = require('node:child_process');

const KUYRUK_BAYT = 64 * 1024;

function agaciOldur(cocuk) {
  if (!cocuk || cocuk.pid == null) return;
  try {
    if (process.platform === 'win32') {
      const t = spawn('taskkill', ['/pid', String(cocuk.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      t.on('error', () => { try { cocuk.kill('SIGKILL'); } catch { /* yoksay */ } });
    } else {
      try { process.kill(-cocuk.pid, 'SIGKILL'); } catch { cocuk.kill('SIGKILL'); }
    }
  } catch { /* süreç zaten bitmiş olabilir */ }
}

function iptalHatasi() {
  const e = new Error('İşlem iptal edildi.');
  e.name = 'AbortError';
  e.iptal = true;
  return e;
}

/**
 * Harici programı çalıştırır (shell:false). Süreç tamamen kapanana kadar bekler.
 * @returns {Promise<{kod:number, stdout:string, stderr:string}>}
 */
function calistir(yol, argumanlar, secenek = {}) {
  const { sinyal, zamanAsimi, stdoutVeri, stderrVeri, cwd, env } = secenek;
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
    let neden = null; // 'iptal' | 'zaman'
    let zamanlayici = null;

    const kisalt = (s) => (s.length > KUYRUK_BAYT * 2 ? s.slice(-KUYRUK_BAYT) : s);
    cocuk.stdout.setEncoding('utf8');
    cocuk.stderr.setEncoding('utf8');
    cocuk.stdout.on('data', (d) => { stdout = kisalt(stdout + d); if (stdoutVeri) stdoutVeri(d); });
    cocuk.stderr.on('data', (d) => { stderr = kisalt(stderr + d); if (stderrVeri) stderrVeri(d); });

    const iptalEt = () => { neden = neden || 'iptal'; agaciOldur(cocuk); };
    if (sinyal) sinyal.addEventListener('abort', iptalEt, { once: true });
    if (zamanAsimi) {
      zamanlayici = setTimeout(() => { neden = neden || 'zaman'; agaciOldur(cocuk); }, zamanAsimi);
    }
    const temizle = () => {
      if (zamanlayici) clearTimeout(zamanlayici);
      if (sinyal) sinyal.removeEventListener('abort', iptalEt);
    };

    cocuk.on('error', (e) => {
      temizle();
      if (e.code === 'ENOENT') reddet(new Error(`Program bulunamadı: ${yol}`));
      else reddet(e);
    });
    cocuk.on('close', (kod) => {
      temizle();
      if (neden === 'iptal') return reddet(iptalHatasi());
      if (neden === 'zaman') {
        const e = new Error('İşlem zaman aşımına uğradı.');
        e.zamanAsimi = true;
        return reddet(e);
      }
      coz({ kod: kod == null ? -1 : kod, stdout, stderr });
    });
  });
}

module.exports = { calistir, iptalHatasi, agaciOldur };
