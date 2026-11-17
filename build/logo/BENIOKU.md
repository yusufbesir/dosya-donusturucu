# build/logo — TaaDön logosu "Kesit" (2.0.0)

Yusuf'un seçimi (2026-11-17): **Kesit** (GPT Astra konsepti). Aynı malzemenin iki hâli: keskin üçgen girer, dış köşesi yuvarlatılmış parça çıkar; aradaki çapraz boşluk dönüşüm sınırı. 64×64 ızgara, iki parça, örtüşme yok.
Yazan: [Claude Opus 5.5, TaaDön arayüz başlığı, 2026-11-17].

| Dosya | Ne |
|---|---|
| taadon-kesit.svg | İşaret; üçgen `currentColor`, parça `var(--vurgu-svg, currentColor)` (gömülü kullanım, tema vurgusu) |
| taadon-kesit-tek.svg | Tek renk işaret (mürekkep) |
| taadon-kesit-acik.svg / -koyu.svg | Sabit renkli işaret (açık ve koyu zemin; `<img>` ve dışa aktarım) |
| taadon-yatay-acik.svg / -koyu.svg | Yatay kilit: işaret + "TaaDön" (Sora 600, yola çevrilmiş; yazı tipi gerekmez) |
| taadon-dikey-acik.svg / -koyu.svg | Dikey kilit |
| taadon-uygulama.svg | Uygulama simgesi: koyu mürekkep kare (#141A22), beyaz üçgen, camgöbeği parça (#5ED0DB); tema değişmez |
| taadon-uygulama-kucuk.svg | 16–24 px için kenar boşluğu az sürüm |

`../ikon.ico` (16, 20, 24, 32, 40, 48, 64, 128, 256 px) ve `../ikon-512.png`, `../icon.png` bu SVG'lerden Chromium ile çizilip üretildi. İşaret üç temada aynı kalır; yalnız ikinci renk temanın vurgusunu alır. Uygulamada işaret `arayuz/index.html` ve `uygulama.js` (`logoSvg`) içinde satır içi SVG olarak durur, renkleri `stil.css`'teki `.logo` kurallarından gelir (CSP: satır içi stil yok).
