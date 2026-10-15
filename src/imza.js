'use strict';
// LibreOffice (soffice.exe) Authenticode imza denetimi. Electron'a bağımlı değildir.
//
// - Yalnız Windows'ta çalışır; başka platformda (geliştirme) denetim atlanır ({ gecerli:true, atlandi:true }).
// - PowerShell çağrısı enjekte edilebilir (`powershell` seçeneği) ki test edilebilsin.
// - Yol PowerShell komut satırına GÖMÜLMEZ: ortam değişkeniyle (DD_IMZA_YOLU) verilir, komut sabittir.
// - Sonuç, dosyanın boyutu ve değişme zamanıyla birlikte önbelleğe alınır (dosya değişirse yeniden denetlenir).
// - Bilinen sınır: denetim ile soffice'nin çalıştırılması arasında dosya değiştirilirse (TOCTOU) bu denetim
//   yakalayamaz; kurulum klasörü kullanıcıya yazılabilir olduğundan bu risk imza denetimiyle tamamen kapanmaz.

const nodeFs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BEKLENEN_IMZACI = 'The Document Foundation';
const ZAMAN_ASIMI = 20000;
const BETIK = '$ErrorActionPreference = "Stop"; $s = Get-AuthenticodeSignature -LiteralPath $env:DD_IMZA_YOLU; ' +
  '$o = @{ Durum = [string]$s.Status; Konu = "" }; if ($s.SignerCertificate) { $o.Konu = [string]$s.SignerCertificate.Subject }; ' +
  '$o | ConvertTo-Json -Compress';

/** Varsayılan PowerShell çağrısı: shell:false, argüman dizisi, zaman aşımı. @returns {Promise<{kod:number, stdout:string}>} */
function varsayilanPowershell({ yol, zamanAsimi = ZAMAN_ASIMI, env = process.env } = {}) {
  return new Promise((coz, reddet) => {
    const kok = env.SystemRoot || env.windir || 'C:\\Windows';
    const exe = path.win32.join(kok, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let cocuk;
    try {
      cocuk = spawn(exe, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', BETIK], {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, env, { DD_IMZA_YOLU: yol })
      });
    } catch (e) { return reddet(e); }
    let stdout = '';
    let zaman = false;
    const z = setTimeout(() => { zaman = true; try { cocuk.kill('SIGKILL'); } catch { /* yoksay */ } }, zamanAsimi);
    cocuk.stdout.setEncoding('utf8');
    cocuk.stdout.on('data', (d) => { if (stdout.length < 65536) stdout += d; });
    cocuk.stderr.resume();
    cocuk.on('error', (e) => { clearTimeout(z); reddet(e); });
    cocuk.on('close', (kod) => {
      clearTimeout(z);
      if (zaman) { const e = new Error('PowerShell zaman aşımı'); e.zamanAsimi = true; return reddet(e); }
      coz({ kod: kod == null ? -1 : kod, stdout });
    });
  });
}

function imzaciUygunMu(konu, beklenen = BEKLENEN_IMZACI) {
  const parcalar = String(konu || '').split(/,(?=\s*[A-Za-z][A-Za-z0-9.]*=)/);
  return parcalar.some((p) => {
    const m = /^\s*(CN|O)\s*=\s*"?(.*?)"?\s*$/i.exec(p);
    return !!m && m[2].trim().toLowerCase() === beklenen.toLowerCase();
  });
}

/**
 * @param {string} yol soffice yolu
 * @param {object} [s] { platform, powershell(async ({yol,zamanAsimi})=>{kod,stdout}), onbellek:Map, fsImpl, zamanAsimi, imzaci }
 * @returns {Promise<{gecerli:boolean, atlandi?:boolean, onbellekten?:boolean, neden?:string, degraded?:boolean}>}
 *  degraded: denetim yapılamadı (zaman aşımı/PowerShell hatası); "imza kanıtı yok" DEĞİL, "doğrulanamadı" sayılır ve yol kullanılmaz.
 */
async function imzaDogrula(yol, s = {}) {
  const platform = s.platform || process.platform;
  if (platform !== 'win32') return { gecerli: true, atlandi: true };
  if (typeof yol !== 'string' || !yol) return { gecerli: false, neden: 'yol-yok' };
  const fsi = s.fsImpl || nodeFs.promises;
  let st;
  try { st = await fsi.stat(yol); } catch { return { gecerli: false, neden: 'dosya-yok' }; }
  if (!st.isFile()) return { gecerli: false, neden: 'dosya-degil' };
  const anahtar = `${yol.toLowerCase()}|${st.size}|${st.mtimeMs}`;
  if (s.onbellek && s.onbellek.has(anahtar)) return Object.assign({}, s.onbellek.get(anahtar), { onbellekten: true });

  const ps = s.powershell || varsayilanPowershell;
  let sonuc;
  try {
    const r = await ps({ yol, zamanAsimi: s.zamanAsimi || ZAMAN_ASIMI });
    let j = null;
    if (r && r.kod === 0) { try { j = JSON.parse(String(r.stdout).trim()); } catch { j = null; } }
    if (!j || typeof j !== 'object') sonuc = { gecerli: false, neden: 'denetim-basarisiz', degraded: true };
    else if (j.Durum !== 'Valid') sonuc = { gecerli: false, neden: `imza-${String(j.Durum || 'yok').slice(0, 40)}` };
    else if (!imzaciUygunMu(j.Konu, s.imzaci)) sonuc = { gecerli: false, neden: 'imzaci-uyumsuz' };
    else sonuc = { gecerli: true };
  } catch (e) {
    return { gecerli: false, neden: e && e.zamanAsimi ? 'zaman-asimi' : 'denetim-basarisiz', degraded: true }; // önbelleğe alınmaz
  }
  if (s.onbellek && !sonuc.degraded) s.onbellek.set(anahtar, sonuc);
  return sonuc;
}

module.exports = { imzaDogrula, imzaciUygunMu, varsayilanPowershell, BEKLENEN_IMZACI };
