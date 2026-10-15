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
Word, Excel ve PowerPoint türleri bilgisayardaki ücretsiz LibreOffice ile dönüştürülür. Kurulu değilse ilgili sayfada indirme düğmesi çıkar (https://www.libreoffice.org/download/download/). LibreOffice farklı bir klasördeyse Ayarlar'dan `soffice.exe` seçilebilir. PDF→Word dönüşümü metin ağırlıklı PDF'lerde iyi, taranmış (görüntü) PDF'lerde metin çıkmaz.

## Motorlar ve lisanslar
| Bileşen | Lisans | Not |
|---|---|---|
| FFmpeg 6.1.1 (ffmpeg-static b6.1.1, win32-x64) | GPL-3.0 | Ayrı program olarak çağrılır; kaynak: https://ffmpeg.org/download.html. İndirilen dosya SHA-256 ile doğrulanır. |
| sharp / libvips | Apache-2.0 / LGPL-3.0 | |
| LibreOffice | MPL-2.0 | Programla gelmez, kullanıcı kurar |
| pdf-lib, pdfjs-dist, marked, fast-xml-parser, fflate, yaml | MIT / Apache-2.0 / MIT / MIT / MIT / ISC | |
| Electron | MIT | |

Program kişisel kullanım içindir. Başkalarına dağıtılacaksa FFmpeg'in GPL koşulları (kaynak koduna erişim) yerine getirilmelidir.

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
