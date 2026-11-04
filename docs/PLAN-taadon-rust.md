<!-- Sahip: Yusuf. Yazan: Claude [İP:Dosya dönüştürücü#eSZiVv], 2026-11-04. Rust+Python geçiş planı; değişiklik yazan yapay zeka ya da Yusuf tarafından; silme yok. -->
# PLAN-taadon: Rust çekirdek + Python katmanı geçişi

## Kural ve kalıp
- Yusuf (2026-11-04): ağır hesap ve asıl iş Rust, üstü Python; diğer diller parça parça.
- Ortak kalıp (Fiyat Etiketi ekibi): Rust çekirdeği WebAssembly olarak Electron içinde çalıştır; önce ağır bölümü ölç, sonra Rust modülünü eşdeğerlik testiyle ekle; eski JS geri düşme olarak kalsın.

## Ölçüm (T6, 2026-11-04; medyan 3 tekrar)
| İş | Süre | Asıl yük nerede |
|---|---|---|
| png→jpg 4000×3000 (sharp/libvips) | 83 ms | yerel C kitaplığı; Rust'a geçiş hız getirmez, bağımlılık azaltır |
| jpg→pdf (pdf-lib) | 18 ms | JS; küçük |
| wav→mp3 (FFmpeg süreci) | 94 ms | dış program |
| txt→pdf (LibreOffice süreci) | 17–29 sn (profil şablonuyla ≈4,7 sn/iş) | dış program; asıl darboğaz |
| modül yükleme (sharp+pdf-lib) | 215 → 12 ms (tembel) | çözüldü |
Sonuç: ağır hesap dış programlarda; Rust'ın ölçülebilir kazancı arşiv (fflate, JS) ve PDF sayfa işlemleri (pdf-lib, JS) ile doğrulama/imza katmanında. Görsel için sharp kalır (zaten yerel).

## Aşamalar
1. **Rust çekirdek → WASM (crate `taadon-cekirdek`)**: zip/gzip (zip + flate2; zip-slip, boyut/ZIP64 sınırı), PDF birleştir/böl/döndür (lopdf), çıktı imza/doğrulama, CSV/JSON/YAML/XML (serde). `wasm-pack build --target nodejs`; Electron ana süreçte `require('taadon-cekirdek')`. Her işlev için eşdeğerlik testi (aynı girdi → Node ve Rust çıktıları: boyut, imza, sayfa sayısı, zip girdi listesi). Ayar `motor.rust` (varsayılan kapalı → ölçüm sonrası açık); JS yolu geri düşme.
2. **Python katmanı (`taadon-py`)**: kuyruk/ayarlar/geçmiş/dış program argüman kurma (FFmpeg, LibreOffice, Calibre) ve LibreOffice profil şablonu; pytest. Electron ana süreç JSON satırlı IPC ile Python sürecine devreder (önce yalnız LibreOffice işleri). Dağıtımda gömülü Python (embeddable) + PyInstaller yok (boyut); imza denetimi mevcut.
3. **Kabuk**: HTML/CSS arayüz aynı; Electron → Tauri (Rust) adayı; karar 2. aşama sonunda ölçümle.
4. **Paketleme**: cargo (release) + wasm-pack + mevcut electron-builder; manifest/temizlik mantığı değişmez.

## İlk somut adım (sonraki tur)
- Araç zinciri: bu bilgisayarda `cargo`/`rustc` PATH'te yok (kontrol 2026-11-04 15:50). rustup + MSVC Build Tools kurulumu Yusuf'un kararı (Windows kurulum/kaldırma kuralı); kurulana kadar Rust derlemesi bulutta (Linux) yapılıp wasm çıktısı depoya alınır (wasm platformdan bağımsız).
- `taadon-cekirdek` iskeleti: arşiv modülü + JSON CLI + wasm hedefi; `test/rust-esdegerlik.test.js` ile zip-ac/zip işlerinde Node ve Rust karşılaştırması.

## Riskler
- Paket boyutu motorlardan geliyor (LibreOffice 1,5 GB); Rust bunu değiştirmez.
- WASM'da dosya sistemi erişimi yok: baytlar Node tarafından okunup verilir; büyük arşivlerde akış için `taadon-cekirdek` native (N-API, napi-rs) ikinci seçenek.
- LibreOffice darboğazı için sıcak süreç (UNO) ayrı iş; Rust'la ilgisiz.

## 1. aşama durumu (2026-11-04, yazan: [Claude#taadon-rust-asama1])
- Karar: wasm-pack/wasm-bindgen-cli kurulu değil (kurulum Yusuf kararı) → 1. aşama **yerel CLI**: `cekirdek-rust/` crate'i → `taadon-cekirdek.exe` (x86_64-pc-windows-msvc, release ≈ 623 KB). Bağımlılıklar: zip 9.3 (yalnız deflate, zlib-rs), flate2, serde, serde_json, sha2.
- Komutlar: `imza`, `zip-listele`, `zip-ac` (`--maks-bayt`, `--maks-dosya`), `zip-olustur` (`--maks-dosya`), `gzip`, `gunzip` (`--maks-bayt`), `surum`. Çıktı stdout'a tek JSON satırı (`ok:true|false`, hata Türkçe, çıkış kodu 2); ilerleme stderr'e `ILERLEME n`.
- Kurallar `src/motorlar/arsiv.js` ile birebir: guvenliYol (`..`, mutlak, sürücü harfi, NUL, ayrılmış adlar `_` öneki, `:*?"<>|` ve denetim karakterleri `_`), 65535 girdi / 2 GiB açılmış boyut, ZIP64 reddi (≥4 GiB), SAKLA listesi Stored, var olan dosyaya yazmama (`(n)` eki), symlink girdileri düz dosya, oluştururken symlink atlanır; ek olarak her dosyanın üst klasörü canonicalize edilip hedef kökü altında mı denetlenir.
- Node köprüsü: `src/motorlar/rust.js` (exe arama: `process.resourcesPath/cekirdek/` → `vendor/cekirdek/` → `cekirdek-rust/target/release/`; `hazir()`, `calistir(args,{sinyal,ilerleme,zamanAsimi})`, `arsivCalistir`). `arsiv.js calistir`: yalnız `ctx.rustMotor === true && rust.hazir()` ise zip / zip-ac / gz / gz-ac Rust'a gider; varsayılan kapalı (`donustur.js` henüz `rustMotor` geçirmiyor), exe yoksa JS yolu.
- Testler: `cargo test` 7/7 (güvenli yol vakaları, zip-slip/mutlak reddi, sınırlar, üzerine yazmama, zip/gzip gidiş-dönüş, imza); `node --test test/rust-esdegerlik.test.js` 7/7 (Node zipAc ile dosya listesi + sha256 aynı, zip-slip iki yolda aynı metinle red, Rust zip → Node aç, gzip çapraz gidiş-dönüş, imza pdf/png); `veri-arsiv` ve `arsiv-ek` geçiyor.
- Hız (aynı zip: 50 MB ham / 26 MB sıkıştırılmış, 20 dosya, medyan 3): zip-ac Node 610 ms → Rust 103 ms (≈6x); zip oluştur 1255 → 583 ms (≈2x); gz 2,5 MB 37 → 38 ms (süreç başlatma maliyeti baskın).
- Bilinen farklar/riskler: UTF-8 bayrağı olmayan girdi adlarında Rust CP437, fflate latin1 çözer; merkezi dizinde yinelenen adlı ZIP'ler Rust'ta reddedilir (Node `(n)` ile açar); ZIP Rust'ta merkezi dizinden, fflate'te yerel başlıklardan okunur. Mevcut JS `zipOlustur`'da çok dosyalı işte `MaxListenersExceededWarning` (Promise.race içinde biriken `once(ws,'error')`) görüldü; ayrı düzeltme önerisi.
- Sonraki adım: paketleme — `cargo build --release` çıktısını `vendor/cekirdek/taadon-cekirdek.exe`'ye kopyalayan betik + electron-builder `extraResources` (`vendor/cekirdek` → `cekirdek/`), imza/manifest denetimine ekleme; ardından ayar `motor.rust` ile `donustur.js`'ten `rustMotor` geçirme ve ölçüm sonrası varsayılanı açma.

## 2. aşama durumu (2026-11-04, yazan: [Claude#taadon-rust-asama2]; TAA paket planı A4 hizası)
- Ad: crate ve ikili `taa-donustur` (klasör `cekirdek-rust/` → `taa-donustur/`, lib `taa_donustur`, exe `taa-donustur.exe`, sürüm 1.6.0). Workspace'e taşınabilir: mutlak yol yok, kendi `.gitignore` (`/target/`); `yusufbesir/taa-paket` workspace'ine çıkınca `[profile.release]` köke taşınmalı. `taa-donustur/modul.toml`: ad, surum=1.6.0, arayuz=1, gerektirir={}, ozellikler=[arsiv, imza], program=taadon, butce.acilis_ms=800.
- Köprü (`src/motorlar/rust.js`) arama sırası: `process.resourcesPath/cekirdek/` → `vendor/cekirdek/` → `taa-donustur/target/release/`.
- Paketleme: `scripts/cekirdek-hazirla.js` (cargo varsa `cargo build --release -j 2`, yoksa var olan vendor exe'si, ikisi de yoksa Türkçe hata) → `vendor/cekirdek/taa-donustur.exe` + `SURUM.txt` (ad, sürüm, SHA-256, kaynak); exe'nin `surum` çıktısı modul.toml ile eşleşmezse hata. `package.json` dist/dist:dir önce bunu çalıştırır; extraResources `vendor/cekirdek` → `cekirdek` (yalnız exe + SURUM.txt). `manifest-uret.js` appOutDir'in tamamını gezdiğinden `resources/cekirdek/*` manifest ve kaldırıcı listesine kendiliğinden girer (ek iş yok).
- Bayrak: ayar `motorRust` (boolean, varsayılan **açık**: eşdeğerlik testleri geçti, zip-ac ≈6x). `dogrulama.ayarDogrula`, `main.js` (varsayılan + `rustMotor: ayarlar.motorRust === true` ortamı), `donustur.js` (motor ctx'ine `rustMotor`), Ayarlar → "Görünüm ve başarım" onay kutusu. Exe yoksa JS yolu.
- Yinelenen ad: zip crate merkezi dizindeki yinelenen adları sessizce tekilleştirir (girdi kaybı); Rust artık `has_duplicate_names()` ile reddeder ("ZIP yinelenen girdi adı içeriyor…"), köprü bu hatada `zip-ac` için JS yoluna düşer (fflate `(n)` ekiyle açar) → davranış aynı.
- UTF-8 bayraksız adlar: ASCII adlarda iki yol aynı (test); ASCII dışı baytta Rust CP437 (0x81 → "ü"), fflate latin1 (U+0081 → `_`) çözer — bilinen, belgeli fark (test bunu sabitler).
- JS `zipOlustur`: `Promise.race` içindeki her turda yeni `once(ws,'error')` dinleyicisi yerine tek `hataSozu` → `MaxListenersExceededWarning` giderildi (40×2 MB denemede uyarı 0).
- Testler: `cargo test` 7/7; `rust-esdegerlik` 9/9 (+2 vaka); veri-arsiv, arsiv-ek, arayuz, ekip-t1, main-ek geçiyor; Electron ekran denetimi EKRAN_TAMAM.
