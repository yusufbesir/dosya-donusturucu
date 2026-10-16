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
Word, Excel ve PowerPoint türleri programla birlikte gelen, **değiştirilmemiş** LibreOffice ile dönüştürülür; ayrıca bir şey kurmak gerekmez. LibreOffice yalnız arka planda, her işte ayrı ve geçici bir profille çalışır: makrolar kapalı (makro güvenliği en yüksek düzeyde), dış bağlantılar güncellenmez, ağ erişimi kapalıdır. Ayarlar'dan başka bir `soffice.exe` seçilirse o kullanılır.

Windows'ta kullanılacak her `soffice.exe` (ayarlardaki yol, programla gelen `resources/libreoffice` ve `%ProgramFiles%\LibreOffice`) açılışta ve kullanımda yeniden doğrulanır: ad kuralı ile Authenticode imzası (PowerShell `Get-AuthenticodeSignature`, imza geçerli ve imzacı "The Document Foundation" olmalı; sonuç dosya boyutu/zamanıyla önbelleğe alınır). Geçmeyen yol kullanılmaz, arayüz "LibreOffice doğrulanamadı" der; PowerShell zaman aşımı da "doğrulanamadı" sayılır. Linux'ta (geliştirme) imza denetimi atlanır. Sınır: denetim ile çalıştırma arasındaki kısa sürede dosya değiştirilirse (TOCTOU) yakalanmaz. PDF→Word dönüşümü metin ağırlıklı PDF'lerde iyi, taranmış (görüntü) PDF'lerde metin çıkmaz.

Gömme adımı (`npm run libreoffice-hazirla -- <msi>`): resmî MSI dosyasının SHA-256'sı `scripts/libreoffice-surum.json` içindeki sabit değerle ve "The Document Foundation" Authenticode imzasıyla doğrulanır; biri tutmazsa işlem durur ve hiçbir şey yazılmaz. Doğrulama geçince MSI'daki amd64 (x64) VC++ çalışma zamanı DLL'leri (`<ad>_amd64.<GUID>` girdileri, 7za ile alınır; `System64` klasörü ARM64 DLL ile çakıştığı için kullanılmaz, her DLL'in x64 olduğu PE başlığından denetlenir) `program/` altına, `Fonts` klasöründeki yazı tipleri `share/fonts/truetype/` altına kopyalanır (32 bit `System/` kullanılmaz; aynı adlı dosyanın üzerine yazılmaz, symlink reddedilir). Linux'ta imza `osslsigncode` ile denetlenir ("Signature verification: ok" şart). Ağı kısıtlı ortamlar için isteğe bağlı `LIBREOFFICE_CRL` ve `LIBREOFFICE_TSA_CRL` ortam değişkenleri yerel CRL dosyasını `osslsigncode`'a `-CRLfile` / `-TSA-CRLfile` olarak geçirir; denetimi atlatan bir bayrak yoktur. LibreOffice, Python betik bileşenleri (pyuno, Python çalışma zamanı, LibreLogo; `pythonloaderlo.dll`, `pyuno.pyd`, `python3*.dll`, `python-core-*`, `share/Scripts/python`, `librelogo.xcd` vb.) çıkarılarak gömülür: Windows'ta Writer belgesi yüklenirken Python yükleyicisi ayrı iş parçacığında başlayıp locale kilidinde Writer dönüşümlerini sonsuza kadar kilitliyor (2026-10-16, gerçek kurulumda görüldü); makrolar zaten kapalı olduğundan gerekmez. Lisans açısından: kalan dosyalar değiştirilmemiş resmî dosyalardır, çıkarılan yalnız isteğe bağlı bileşendir; çıkarılanlar kurulum çıktısında listelenir ve `GOMULU-SURUM.txt`'e yazılır.

Dürüst not: 26.8.1 paketi, bulut ortamında CRL sunucularına ağ kapalı olduğu için betik yerine aynı adımlarla elle hazırlandı. SHA-256 resmî değerle eşleşti, imza özeti ve sertifika zinciri doğrulandı; yalnız sertifika iptal listesi (CRL) denetlenemedi.

## Motorlar ve lisanslar
| Bileşen | Sürüm | Lisans | Not |
|---|---|---|---|
| FFmpeg | 6.1.1 (ffmpeg-static b6.1.1, win32-x64) | GPL-3.0 | Ayrı program olarak, değiştirilmeden çağrılır. Tam lisans metni ve kaynak kodu teklifi pakette `resources/lisanslar/` altında. İndirilen dosya SHA-256 ile doğrulanır. |
| LibreOffice | 26.8.1 (`scripts/libreoffice-surum.json`) | MPL-2.0 | Değiştirilmemiş, ayrı program. Lisans metni `resources/lisanslar/LibreOffice-MPL-2.0.txt`, kaynak kodu: https://www.libreoffice.org/about-us/source-code/ |
| sharp / libvips | 0.35.5 / 8.18 | Apache-2.0 / LGPL-3.0 | |
| pdf-lib, pdfjs-dist, marked, fast-xml-parser, fflate, yaml, parse5 | package.json'daki sabit sürümler | MIT / Apache-2.0 / MIT / MIT / MIT / ISC / MIT | parse5: HTML girdilerini temizlemek için |
| Electron | 43.7.6 | MIT | |
| Bu programın kendi kodu | | MIT (deponun `LICENSE` dosyası) | |

FFmpeg için GPL derlemesi seçildi: LGPL derlemelerinde H.264/H.265 kodlayıcıları (x264/x265) bulunmadığından MP4 çıktısı kalitesi düşerdi. Program kişisel kullanım içindir; başkasına verilirse GPL gereği kaynak kodu teklifi (`FFmpeg-KAYNAK.txt`) pakette zaten bulunur.

## Güncelleme planı
- FFmpeg ve LibreOffice güvenlik duyuruları her ayın ilk haftası kontrol edilir: https://ffmpeg.org/security.html ve https://www.libreoffice.org/about-us/security/advisories/
- Gömülü bileşenlerden birini etkileyen bir açık yayımlanırsa yeni sürüm indirilir, `scripts/ffmpeg-indir.js` ya da `scripts/libreoffice-surum.json` içindeki sürüm ve SHA-256 güncellenir, testler çalıştırılır ve yeni kurulum dosyası üretilir.
- npm bağımlılıkları için her derlemeden önce `npm audit --omit=dev` çalıştırılır.

## Güvenlik
- Ağ erişimi yok: arayüz yalnız kendi dosyalarını yükleyebilir, dış istekler engellenir. LibreOffice her işte ağı kapalı geçici profille çalışır, HTML girdileri parse5 ile ayrıştırılıp temizlenir (script/iframe/object/embed/base, yenileme meta'sı, stylesheet bağlantıları, `on*` olayları atılır; tüm niteliklerdeki ve `<style>`/`style` içindeki uzak/yerel adresler ile `@import` kaldırılır), sonra yeniden yazılır.
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
`dist/` altına `Dosya-Donusturucu-Kurulum-<sürüm>.exe` (kurulum) ve `Dosya-Donusturucu-Tasinabilir-<sürüm>.exe` (kurulumsuz) gelir. `npm run dist` önce FFmpeg'i indirip doğrular.

Linux'ta derleme: Windows sharp ikilisi `npm install --no-save --os=win32 --cpu=x64 @img/sharp-win32-x64@0.35.5` ile eklenir; wine yoksa barkod uygulamasındaki gibi `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js` içindeki `isMacOsCatalina()` koşulu `true` yapılarak kaldırıcı yükleyiciden çıkarılır. `signAndEditExecutable=false` olduğundan exe imzasızdır (bkz. "Kod imzalama"). Linux yerel modülleri (`@napi-rs/*`; pdf.js arayüzde tarayıcı canvas'ını kullanır) ve Linux sharp ikilileri pakete alınmaz.

## Güncelleme temizliği ve kaldırma
Güncellemede NSIS eski kaldırıcıyı çağırdığında (`build/kurulum.nsh`, `${isUpdated}`) hiçbir dosya silinmez; yeni dosyalar eskilerin üzerine yazılır. Eski sürümden artakalan dosyaları uygulamanın kendisi temizler (`src/guncelleme.js`, yalnız kurulu Windows sürümünde, açılıştan yaklaşık 8 sn sonra):
1. `afterPack` (`scripts/manifest-uret.js`) her sürümde `resources/surum-manifest.json` (yol, boyut, SHA-256) ve kaldırıcı için `resources/surum-dosyalar.txt` üretir.
2. Yeni manifest doğrulanır: boş olmamalı, `resources/app.asar` ve çalışan exe girdileri bulunmalı, kurulu dosyaların boyutu (exe ve asar için SHA-256'sı da) tutmalı. Biri tutmazsa `dogrulanamadi` döner ve hiçbir şey silinmez.
3. Önceki sürümün manifestinde olup yenisinde olmayan dosyalar aday olur (`.surum/onceki-manifest.json`). Çalışan exe, `resources/app.asar` ve `resources/surum-manifest.json` hiçbir koşulda silinmez; korunan kökler (kullanıcı verisi, Belgeler, çıktı klasörü) altındaki dosyalara dokunulmaz.
4. Aday, yalnız boyutu **ve SHA-256'sı** önceki manifesttekiyle aynıysa (kullanıcı değiştirmediyse) silinir; sembolik bağ/junction izlenmez. Silmeden hemen önce her yol bileşeni `lstat` ile, gerçek yol `realpath` ile bir kez daha denetlenir. Kalan yarış penceresi: bu son denetim ile `unlink` arasındaki çok kısa süre; kurulum klasörüne yazabilen biri o anda bir ara klasörü bağla değiştirebilir (Node'da `unlinkat` yok).
5. Sonuç `.surum/temizlik-gunlugu.txt` dosyasına yazılır; günlük ve geçici manifest dosyası sembolik bağ izlemez (`lstat` + `wx`). Yeni manifest başarıyla işlenince `onceki-manifest.json` güncellenir; hata olursa güncellenmez ve sonraki açılışta yeniden denenir.

Ayrıca 1.0.0–1.0.2 kurulumlarında önceki manifest hiç kaydedilmediğinden, bilinen eski sürüm kalıntıları (1.0.0'daki LibreOffice Python bileşenleri) `src/eski-kalintilar.json` sabit listesiyle (yol, boyut, SHA-256; `scripts/kalinti-listesi-uret.js` üretir) önceki manifest olsa da olmasa da, yeni sürüm doğrulandıktan sonra aynı güvenlik denetimleriyle silinir; boyutu ya da SHA-256'sı tutmayan dosyaya dokunulmaz, günlüğe yalnız özet (`KALINTI: N silindi, M atlandı`) yazılır.

Normal kaldırmada `RMDir /r $INSTDIR` **kullanılmaz**. Kaldırıcı `resources\surum-dosyalar.txt` (UTF-16LE, `F|dosya` ve `D|klasör` satırları, klasörler en derinden başlayarak) listesindeki dosyaları tek tek `Delete`, klasörleri özyinelemesiz `RMDir` ile (yalnız boşsa) siler; ardından `.surum` içindeki bilinen dosyaları, kaldırıcıyı ve en son `$INSTDIR`'yi (özyinelemesiz) kaldırır. `$INSTDIR\<ana exe>` yoksa ya da `$INSTDIR` bir sürücü köküyse (`X:\`) hiçbir şey silmeden çıkar. Böylece kullanıcının aynı klasöre koyduğu dosyalar kalır.

**Kaldırıcının sınırlaması (NSIS):** Kaldırıcı dosya içeriği için SHA-256 denetimi yapmaz; yalnız kurulumda yazılan `surum-dosyalar.txt` listesindeki adları tek tek siler. Tek denetim listenin kendisinindir: paketleme sırasında listenin SHA-256'sı kaldırıcıya gömülür (`build/uretilen/liste-sha.nsh`, `afterPack` üretir), kaldırıcı `certutil -hashfile` ile hesaplayıp karşılaştırır; uyuşmazsa ya da hesaplanamazsa hiçbir şey silmez. Bağ/junction (reparse point, `FILE_ATTRIBUTE_REPARSE_POINT` 0x400) olan kurulum klasörüne, klasörlere ve dosyalara dokunmaz (bir klasör bağsa altındaki hiçbir dosya silinmez), `RMDir /r` kullanmaz, Windows ayrılmış adları (`CON`, `NUL`, `COM1` ...) ve `..` içeren yolları reddeder, listede olmayan kullanıcı dosyalarını bırakır. Ayrıntılı denetimler (dosya içeriği SHA-256, sabit bağ/hardlink `nlink > 1` atlama) yalnız uygulama içi güncelleme temizliğindedir (`src/guncelleme.js`). Kurulum yalnız kullanıcı başınadır ("tüm kullanıcılar için" sayfası kapalıdır).

**Sınırlama (bu sürüme ilk geçiş):** Bu sürümden önce kurulmuş sürümün kaldırıcısı bu makroyu içermez; güncelleme sırasında o eski kaldırıcı klasörü önceden boşaltır (eski davranış). Yani 1.0.0 gibi makrosuz bir sürümden bu sürüme geçişte kurulum klasöründeki kullanıcı dosyaları da silinebilir; bu sürümden sonraki geçişlerde yeni davranış geçerlidir. Kurulum klasörüne kendi dosyalarınızı koymayın.

## Kod imzalama
Şu an exe'ler **imzasızdır**: Windows SmartScreen uyarı verir ("Ek bilgi" > "Yine de çalıştır"). Plan: kod imzalama sertifikası (OV/EV ya da Azure Trusted Signing) alınınca `package.json` içinde `win.signAndEditExecutable` açılır ve electron-builder `win.signtoolOptions` (ya da Azure Trusted Signing ayarı) ile exe, kurulum ve taşınabilir dosyalar imzalanır. Not: imzalama açılınca güncelleme manifestindeki exe SHA-256'sı imzadan **sonra** üretilmelidir (imza dosyayı değiştirir); bu nedenle `scripts/manifest-uret.js` `afterPack` yerine `afterSign` kancasına taşınmalıdır, aksi halde `guncelleme.js` doğrulaması exe için `sha256 tutmuyor` der ve temizlik hiç çalışmaz.

## Doğrulama durumu
- Çekirdek dönüşümler Linux'ta gerçek FFmpeg 6.1.1 ve LibreOffice ile uçtan uca test edildi.
- Uygulama Linux'ta (xvfb) açılıp kuyruk üzerinden mp3→mpg ve csv→json işleri tamamlandı.
- Windows'ta kurulup denenmedi; ilk kullanımda kurulum, kısayollar ve LibreOffice bulma Windows'ta denenmeli.
