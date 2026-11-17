# arayuz/yazitipi — yerel yazı tipleri (2.0.0)

Ne: TaaDön arayüzünün yerel yazı tipi dosyaları (CDN yok; CSP `font-src 'self'` ile yüklenir).
Sahibi: TaaDön işi. Yazan: [Claude Opus 5.5, TaaDön arayüz başlığı, 2026-11-17].
Kaynak: npm Fontsource paketleri (5.3.x); her yüz iki alt küme: `-latin` ve `-latin-ext` (`unicode-range` ile yalnız gerekeni yüklenir).
Türkçe denetimi: her ailede `İ ı ğ Ğ ş Ş ç Ç ö Ö ü Ü` glifleri fontTools ile doğrulandı (2026-11-17).
Değiştirme kuralı: dosya eklenir ya da çıkarılırsa `stil.css` içindeki `@font-face` ve lisans dosyası birlikte güncellenir.

| Dosya | Yazı tipi | Tema / kullanım | Lisans |
|---|---|---|---|
| sora-600-* | Sora 600 | Tayf başlıkları | SIL OFL 1.1 (Sora-OFL.txt) |
| inter-400/500/600-* | Inter | Tayf gövde, etiket, menü | SIL OFL 1.1 (Inter-OFL.txt) |
| archivo-wdth-* | Archivo değişken (genişlik + ağırlık) | Matbaa başlıkları (dar 800) | SIL OFL 1.1 (Archivo-OFL.txt) |
| sourcesans3-400/600-* | Source Sans 3 | Matbaa gövde, etiket | SIL OFL 1.1 (SourceSans3-OFL.txt) |
| barlowsc-700-* | Barlow Semi Condensed 700 | Döküm başlıkları | SIL OFL 1.1 (BarlowSemiCondensed-OFL.txt) |
| barlow-400/600-* | Barlow | Döküm gövde, etiket | SIL OFL 1.1 (Barlow-OFL.txt) |
| jetbrainsmono-400-* | JetBrains Mono | Üç temada yol ve sayılar | SIL OFL 1.1 (JetBrainsMono-OFL.txt) |

1.x'teki Newsreader ve Space Mono kaldırıldı (eski görünüm). Git geçmişinde durur.
