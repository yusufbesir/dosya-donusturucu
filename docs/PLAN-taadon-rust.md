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
