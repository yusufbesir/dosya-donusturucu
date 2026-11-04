'use strict';
// Ne: TaaDön Rust çekirdeğini (taa-donustur.exe) paketlemeye hazırlayan betik; `npm run dist` / `dist:dir` önce bunu çalıştırır.
// Sahip: Yusuf (TaaDön projesi). yazan: [Claude#taadon-rust-asama2 2026-11-04].
// Değiştirme kuralı: Yusuf'un kuralları (ORTAK-AJAN-KURALLARI.md) çerçevesinde; silme yok.
// Adımlar:
//  1) cargo varsa taa-donustur/ içinde `cargo build --release -j 2` (PC'de başka ağır derleme olabileceği için 2 iş).
//     cargo yoksa ve vendor/cekirdek/taa-donustur.exe varsa o kullanılır; ikisi de yoksa Türkçe hata (çıkış kodu 1).
//  2) Derlenen exe vendor/cekirdek/ altına kopyalanır (geçici ada yazılıp yeniden adlandırılır; aynıysa dokunulmaz).
//     vendor/ yeniden üretilebilir derleme çıktısıdır (git'te yok).
//  3) Exe `surum` komutuyla denetlenir: sürüm taa-donustur/modul.toml "surum" ile aynı olmalı.
//  4) vendor/cekirdek/SURUM.txt: ad, sürüm, SHA-256, kaynak (cargo|vendor). electron-builder extraResources ile
//     vendor/cekirdek -> resources/cekirdek kopyalanır; manifest-uret.js resources altını zaten listeler.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const CRATE = path.join(KOK, 'taa-donustur');
const EXE_ADI = process.platform === 'win32' ? 'taa-donustur.exe' : 'taa-donustur';
const DERLEME = path.join(CRATE, 'target', 'release', EXE_ADI);
const VENDOR = path.join(KOK, 'vendor', 'cekirdek');
const HEDEF = path.join(VENDOR, EXE_ADI);

function hata(metin) {
  console.error(`[cekirdek-hazirla] HATA: ${metin}`);
  process.exit(1);
}

function modulSurumu() {
  const yol = path.join(CRATE, 'modul.toml');
  let metin;
  try { metin = fs.readFileSync(yol, 'utf8'); } catch { hata(`Modül tanımı okunamadı: ${yol}`); }
  const ad = /^\s*ad\s*=\s*"([^"]+)"/m.exec(metin);
  const surum = /^\s*surum\s*=\s*"([^"]+)"/m.exec(metin);
  if (!ad || !surum) hata('modul.toml içinde ad/surum bulunamadı.');
  return { ad: ad[1], surum: surum[1] };
}

function sha256(yol) {
  return crypto.createHash('sha256').update(fs.readFileSync(yol)).digest('hex');
}

function cargoVar() {
  const r = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: false, windowsHide: true });
  return r.status === 0;
}

function derle() {
  console.log('[cekirdek-hazirla] cargo build --release -j 2 (taa-donustur/)');
  const r = spawnSync('cargo', ['build', '--release', '-j', '2'], { cwd: CRATE, stdio: 'inherit', shell: false, windowsHide: true });
  if (r.status !== 0) hata(`cargo derlemesi başarısız oldu (çıkış kodu ${r.status}).`);
  if (!fs.existsSync(DERLEME)) hata(`Derleme çıktısı bulunamadı: ${DERLEME}`);
}

function kopyala() {
  fs.mkdirSync(VENDOR, { recursive: true });
  if (fs.existsSync(HEDEF) && sha256(HEDEF) === sha256(DERLEME)) return;
  const gecici = `${HEDEF}.yeni`;
  fs.copyFileSync(DERLEME, gecici);
  fs.renameSync(gecici, HEDEF); // derleme çıktısı yenisiyle değiştirilir (kaynaktan yeniden üretilebilir)
}

function surumDenetle(beklenen) {
  const r = spawnSync(HEDEF, ['surum'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000 });
  let json = null;
  try { json = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).pop()); } catch { /* aşağıda */ }
  if (!json || json.ok !== true) hata(`${EXE_ADI} çalıştırılamadı ya da beklenmeyen çıktı verdi.`);
  if (json.surum !== beklenen) hata(`${EXE_ADI} sürümü (${json.surum}) modul.toml sürümüyle (${beklenen}) aynı değil; Cargo.toml version alanını güncelleyin.`);
}

function main() {
  const modul = modulSurumu();
  let kaynak;
  if (cargoVar()) {
    derle();
    kopyala();
    kaynak = 'cargo';
  } else if (fs.existsSync(HEDEF)) {
    console.log('[cekirdek-hazirla] cargo bulunamadı; var olan vendor/cekirdek/' + EXE_ADI + ' kullanılıyor.');
    kaynak = 'vendor';
  } else {
    hata(`cargo bulunamadı ve vendor/cekirdek/${EXE_ADI} yok. Rust araç zincirini (rustup) kurun ya da derlenmiş exe'yi vendor/cekirdek/ altına koyun.`);
  }
  surumDenetle(modul.surum);
  const ozet = sha256(HEDEF);
  const satirlar = [
    '# TaaDön Rust çekirdeği paket bilgisi; scripts/cekirdek-hazirla.js üretir (elle düzenlemeyin). Sahip: Yusuf.',
    `ad=${modul.ad}`,
    `surum=${modul.surum}`,
    `dosya=${EXE_ADI}`,
    `sha256=${ozet}`,
    `boyut=${fs.statSync(HEDEF).size}`,
    `kaynak=${kaynak}`,
    `uretim=${new Date().toISOString()}`,
  ];
  fs.writeFileSync(path.join(VENDOR, 'SURUM.txt'), `${satirlar.join('\r\n')}\r\n`, 'utf8');
  console.log(`[cekirdek-hazirla] Hazır: vendor/cekirdek/${EXE_ADI} ${modul.surum} sha256=${ozet}`);
}

main();
