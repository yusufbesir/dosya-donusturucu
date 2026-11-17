# build/ — ikon dosyaları

- `ikon.ico` — Windows ikonu (16–256 px, 9 boy). exe, kurulum/kaldırma sihirbazı ve kısayollar için kullanılır.
- `ikon-512.png` — 512 px PNG. `build.icon` ve uygulama penceresi ikonu (`main.js`) için kullanılır.
- `icon.png` — 512 px kopya (2.0.0: Kesit logosu).
- `logo/` — Kesit logosu kaynak SVG'leri ve aile (bkz. logo/BENIOKU.md).

Kaynak (2.0.0): `logo/taadon-uygulama*.svg`; 1.x ikon seti TEZDENEME PR #26 idi.
Sahibi: Dosya dönüştürücü işi.

Değiştirme kuralı: ikon değişirse `.ico` ve `.png` birlikte güncellenir.
- Ikon ve surum bilgisi (FileDescription vb.) artik electron-builder tarafindan degil, afterPack'te `scripts/exe-kaynak.js` ile exe'ye gomulur (manifest hash'i bayatlamasin diye `signAndEditExecutable:false`).
