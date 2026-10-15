# Dosya Dönüştürücü (Windows masaüstü)

Etiket: [İP:Dosya dönüştürücü#eSZiVv]

Barkod uygulamasından ayrı, bilgisayara kurulan bir dönüştürme programı. Bütün işlemler bilgisayarda yapılır; dosyalar internete gönderilmez.

## Neleri dönüştürür
| Menü | Girdi | Çıktı ve işlemler |
|---|---|---|
| Video | mp4, mkv, avi, mov, webm, wmv, flv, mpg/mpeg, m4v, 3gp, ts, ogv | Aynı biçimler, GIF, sesi çıkarma (mp3, wav...), kırpma, boyut, kalite |
| Ses | mp3, wav, flac, aac, m4a, ogg, opus, wma, aiff, ac3, mp2 | Aynı biçimler, MPEG ses (mp2), MPEG video (mpg) ve mp4 (siyah ekran ya da kapak görseliyle), kırpma |
| Görsel | jpg, png, webp, avif, tiff, gif, bmp, ico, svg | jpg, png, webp, avif, tiff, gif, bmp, ico, pdf; boyut ve kalite |
| Belge | docx, doc, odt, rtf, txt, html, md, pdf | docx, odt, rtf, txt, html, pdf (PDF→Word dahil) |
| Tablo | xlsx, xls, ods, csv | xlsx, ods, csv, pdf, html |
| Sunum | pptx, ppt, odp | pptx, odp, pdf |
| PDF Araçları | pdf, görseller | Birleştir, böl, döndür, görsellerden PDF, PDF→Word, PDF→görsel, PDF→metin |
| Veri | json, csv, tsv, yaml, xml | Birbirine dönüştürme |
| Arşiv | dosyalar, zip, gz | ZIP oluştur ve aç, GZIP sıkıştır ve aç |

Ayrıca: sürükle-bırak, toplu kuyruk (aynı anda 1-4 iş), ilerleme çubuğu, iptal, "Klasörde göster", geçmiş, açık/koyu tema. Var olan dosyaların üzerine asla yazılmaz; aynı ad varsa `ad (1).mp4` gibi yeni ad verilir.

## Belge, tablo ve sunum için LibreOffice
Word, Excel ve PowerPoint türleri programla birlikte gelen, **değiştirilmemiş** LibreOffice ile dönüştürülür; ayrıca bir şey kurmak gerekmez. LibreOffice yalnız arka planda, her işte ayrı ve geçici bir profille çalışır: makrolar kapalı (makro güvenliği en yüksek düzeyde), dış bağlantılar güncellenmez, ağ erişimi kapalıdır. Ayarlar'dan başka bir `soffice.exe` seçilirse o kullanılır. PDF→Word dönüşümü metin ağırlıklı PDF'lerde iyi, taranmış (görüntü) PDF'lerde metin çıkmaz.

Gömme adımı (`npm run libreoffice-hazirla -- <msi>`): resmî MSI dosyasının SHA-256'sı `scripts/libreoffice-surum.json` içindeki sabit değerle ve "The Document Foundation" Authenticode imzasıyla doğrulanır; biri tutmazsa işlem durur ve hiçbir şey yazılmaz.

## Motorlar ve lisanslar
| Bileşen | Sürüm | Lisans | Not |
|---|---|---|---|
| FFmpeg | 6.1.1 (ffmpeg-static b6.1.1, win32-x64) | GPL-3.0 | Ayrı program olarak, değiştirilmeden çağrılır. Tam lisans metni ve kaynak kodu teklifi pakette `resources/lisanslar/` altında. İndirilen dosya SHA-256 ile doğrulanır. |
| LibreOffice | `scripts/libreoffice-surum.json` | MPL-2.0 | Değiştirilmemiş, ayrı program. Lisans metni `resources/lisanslar/LibreOffice-MPL-2.0.txt`, kaynak kodu: https://www.libreoffice.org/about-us/source-code/ |
| sharp / libvips | 0.35.5 / 8.18 | Apache-2.0 / LGPL-3.0 | |
| pdf-lib, pdfjs-dist, marked, fast-xml-parser, fflate, yaml | package.json'daki sabit sürümler | MIT / Apache-2.0 / MIT / MIT / MIT / ISC | |
| Electron | 43.7.6 | MIT | |
| Bu programın kendi kodu | | MIT (deponun `LICENSE` dosyası) | |

FFmpeg için GPL derlemesi seçildi: LGPL derlemelerinde H.264/H.265 kodlayıcıları (x264/x265) bulunmadığından MP4 çıktısı kalitesi düşerdi. Program kişisel kullanım içindir; başkasına verilirse GPL gereği kaynak kodu teklifi (`FFmpeg-KAYNAK.txt`) pakette zaten bulunur.

## Güncelleme planı
- FFmpeg ve LibreOffice güvenlik duyuruları her ayın ilk haftası kontrol edilir: https://ffmpeg.org/security.html ve https://www.libreoffice.org/about-us/security/advisories/
- Gömülü bileşenlerden birini etkileyen bir açık yayımlanırsa yeni sürüm indirilir, `scripts/ffmpeg-indir.js` ya da `scripts/libreoffice-surum.json` içindeki sürüm ve SHA-256 güncellenir, testler çalıştırılır ve yeni kurulum dosyası üretilir.
- npm bağımlılıkları için her derlemeden önce `npm audit --omit=dev` çalıştırılır.

## Güvenlik
- Ağ erişimi yok: arayüz yalnız kendi dosyalarını yükleyebilir, dış istekler engellenir. LibreOffice her işte ağı kapalı geçici profille çalışır, HTML girdilerindeki uzak adresler temizlenir.
- Arayüz yalnız kullanıcının seçtiği ya da sürüklediği dosyalara ve seçilmiş çıktı klasörlerine erişebilir.
- Harici programlar kabuk olmadan, argüman listesiyle çalışır; FFmpeg'e protokol ve biçim izin listesi verilir.
- ZIP açarken klasör dışına çıkma (zip-slip), dosya sayısı ve 2 GB toplam boyut sınırı denetlenir.
- Electron: nodeIntegration kapalı, contextIsolation ve sandbox açık, geliştirici araçları kapalı, sıkı CSP.

## Geliştirme
```
npm install
npm test
npm start
```

## Windows kurulum dosyası üretme
Windows'ta:
```
npm install
npm run dist
```
`dist/` altına `Dosya-Donusturucu-Kurulum-1.0.0.exe` (kurulum) ve `Dosya-Donusturucu-Tasinabilir-1.0.0.exe` (kurulumsuz) gelir. `npm run dist` önce FFmpeg'i indirip doğrular.

Linux'ta derleme: Windows sharp ikilisi `npm install --no-save --os=win32 --cpu=x64 @img/sharp-win32-x64@0.35.5` ile eklenir; wine yoksa barkod uygulamasındaki gibi `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js` içindeki `isMacOsCatalina()` koşulu `true` yapılarak kaldırıcı yükleyiciden çıkarılır. `signAndEditExecutable=false` olduğundan exe imzasızdır; SmartScreen uyarısında "Ek bilgi" > "Yine de çalıştır" denir.

## Doğrulama durumu
- Çekirdek dönüşümler Linux'ta gerçek FFmpeg 6.1.1 ve LibreOffice ile uçtan uca test edildi.
- Uygulama Linux'ta (xvfb) açılıp kuyruk üzerinden mp3→mpg ve csv→json işleri tamamlandı.
- Windows'ta kurulup denenmedi; ilk kullanımda kurulum, kısayollar ve LibreOffice bulma Windows'ta denenmeli.
