# TaaDön (Windows masaüstü) — eski adı Dosya Dönüştürücü

Etiket: [İP:Dosya dönüştürücü#eSZiVv]

Barkod uygulamasından ayrı, bilgisayara kurulan bir dönüştürme programı. Bütün işlemler bilgisayarda yapılır; dosyalar internete gönderilmez.

## Nasıl kullanılır
Solda kategori seçmezsiniz: **Dönüştür** sayfasına (ya da pencerenin herhangi bir yerine) dosya bırakın; program türünü kendisi tanır, dosyaları türüne göre gruplar ve her grup için yalnız çevrilebilecek biçimleri gösterir. PDF Araçları ve Arşiv, birden çok dosya ya da özel işlem gerektirdiği için ayrı sayfalarda kalır.

## Klavye kısayolları
`Ctrl+O` dosya seç · `Ctrl+Enter` dönüştür / işlemi başlat · `Ctrl+1/2/3` Dönüştür, PDF Araçları, Arşiv · `Ctrl+,` Ayarlar · `Ctrl+Shift+Backspace` kuyruktaki bitenleri temizle. Kuyrukta her iş bitince geçen süre ve onay işareti görünür; tek çıktılı işte **Aç** düğmesi dosyayı varsayılan uygulamada açar, **Klasörde göster** ise Gezgin'de seçer (ikisi de yalnız programın ürettiği dosyalar için çalışır).

## Son kullanılan biçim
Bir dosya türü (ya da PDF/Arşiv aracı) için seçilen hedef biçim bu bilgisayarda hatırlanır; aynı türde dosya bırakınca o biçim önceden seçili gelir (yalnız o an geçerli biçimlerden biriyse). Kayıt yalnız yerel tarayıcı deposundadır, dışarı gönderilmez.

## Zaman aşımı
Her motor için üst süre vardır: LibreOffice 5 dk, Calibre 10 dk, FFmpeg 2 saat; süre dolunca alt süreç ağacıyla birlikte öldürülür ve iş "zaman aşımı" hatasıyla biter; yarım dosya bırakılmaz. LibreOffice makroları kapalıdır (MacroSecurityLevel 3).

## Çıktı ayarları
Ayarlar sayfasındaki "Çıktı" kartında: **Çıktı yeri** (seçtiğin klasör ya da kaynağın yanına), **çıktı adı soneki** (ör. `-donusturuldu`; en çok 20 karakter, yalnız harf, rakam, boşluk, `_ . -`) ve **özgün dosyayı iş bitince Özgün klasörüne taşı** (dosya silinmez; kaynak klasör altındaki `Özgün\` klasörüne taşınır, başka sürücüye taşıma yapılmaz). Her çıktı yazıldıktan sonra doğrulanır (boyut ve biçim imzası); doğrulanamayan çıktı `.bozuk` eki alır ve iş hata verir.

## PDF/A ve PDF kalitesi
Belge, tablo ve sunumdan PDF üretirken iki seçenek görünür: **PDF/A (arşiv)** (PDF/A-2b) ve **kalite** (düşük: görseller 150 dpi, orta: 300 dpi, yüksek: küçültme yok). Etiketli PDF ve yer imleri her zaman açıktır.

## Sağ tık menüsü ve klasör bırakma
Kurulum, yalnız bu kullanıcı için (HKCU, yönetici gerekmez) dosyaların sağ tık menüsüne **TaaDön ile dönüştür** ekler; kaldırmada anahtar silinir. Taşınabilir sürümde bu menü yoktur. Programa komut satırından da dosya verilebilir: `TaaDön.exe "dosya1" "dosya2"`; program açıksa dosyalar açık pencereye eklenir. Pencereye klasör bırakılınca en çok 3 alt klasör derinliğindeki tanınan dosyalar (en çok 500) listeye alınır.

## Özellikler (1.9.0)
Ayarlar > **Özellikler** kartındaki onay kutularıyla her yeni özellik kapatılabilir (hepsi varsayılan açık; kapatınca özellik görünmez ve çalışmaz):
- **Önizleme:** dosya satırının üzerinde (ya da klavye odağında) ~400 ms durunca küçük önizleme: görsel/EPUB kapağı 160 px, PDF için "N sayfa".
- **Görev çubuğu ilerlemesi**, **Ctrl+V ile panodan ekleme**, **içerikten biçim uyarısı** (uzantı uyuşmazsa).
- **Tek PDF'de birleştir:** Dönüştür sayfasında bir grupta 2+ dosya ve hedef PDF iken çıkan onay kutusu (varsayılan işaretsiz). Çıktı `<ilk ad> (birleşik).pdf`; birleştirme başarılıysa ara PDF'ler Geri Dönüşüm Kutusu'na taşınır (kalıcı silme yok), başarısızsa ayrı PDF'ler korunur.
- **LibreOffice ısıtma:** ilk belge/tablo/sunum eklenince LibreOffice profil şablonu arka planda bir kez hazırlanır; ilk dönüştürme hızlanır.

## Yönetici paneli (1.10.0)
Ayarlar sayfasının sonundaki **Yönetici paneli** kartı kapalı ve kilitli başlar; Ayarlar > Özellikler'deki **Yönetici panelini göster** kutusuyla tamamen gizlenebilir (kapatınca kanallar da kilitlenir). [Claude#taadon-1.10-yonetici 2026-11-04]
- **PIN:** ilk açılışta 4-8 haneli bir PIN belirlenir. Ayarlara yalnız PIN'in SHA-256 özeti (`yoneticiPinOzeti`) yazılır; düz PIN hiçbir yere yazılmaz, loglanmaz, arayüze geri dönmez. 5 yanlış denemede 60 sn beklenir. PIN'i değiştirmek için panel açık olmalı ve eski PIN girilmeli. Unutulursa: program kapalıyken `%APPDATA%\TaaDön\ayarlar.json` içindeki `yoneticiPinOzeti` değeri `""` yapılır.
- **Kilit:** yalnız ana süreçte, oturumluk tutulur; `yonetici-durum` ve `tani-olustur` kanalları kilit kapalıyken hata verir. **Kilitle** düğmesi ya da programı kapatmak paneli kilitler.
- **Durum tablosu:** sürüm, Electron/Node, çekirdek (Rust/JS), Rust exe yolu ve SHA-256, modül sürümü (`SURUM.txt`), FFmpeg/LibreOffice/Calibre durumu, kuyruk (bekleyen/çalışan/biten/hata) ve geçmiş sayıları, ayar dosyası, profil şablonu. Özellik anahtarları burada yalnız okunur (değiştirme Özellikler kartından).
- **Rust çekirdeğini kapat/aç:** `motorRust` ayarını değiştirir; geri alınabilir, arşiv işlerinde bir sonraki işten itibaren geçerli.
- **Tanı dosyası oluştur:** `Belgeler\TaaDön-tani-<tarih>.txt` (üzerine yazmaz). İçerik: durum, son 50 geçmiş kaydı, ayarlar; PIN özeti maskeli, yollardaki kullanıcı adı `%USER%`. Ardından **Klasörde göster** sunulur.

## Neleri dönüştürür
| Menü | Girdi | Çıktı ve işlemler |
|---|---|---|
| Video | mp4, mkv, avi, mov, webm, wmv, flv, mpg/mpeg, m4v, 3gp, ts, ogv | Aynı biçimler, GIF, sesi çıkarma (mp3, wav...), kırpma, boyut, kalite |
| Ses | mp3, wav, flac, aac, m4a, ogg, opus, wma, aiff, ac3, mp2 | Aynı biçimler, MPEG ses (mp2), MPEG video (mpg) ve mp4 (siyah ekran ya da kapak görseliyle), kırpma |
| Görsel | jpg, png, webp, avif, tiff, gif, bmp, ico, svg | jpg, png, webp, avif, tiff, gif, bmp, ico, pdf; boyut ve kalite |
| Belge | docx, doc, odt, rtf, txt, html, md, pdf | docx, odt, rtf, txt, html, pdf (PDF→Word dahil) |
| E-kitap | epub, mobi, azw3, fb2, htmlz (Calibre); docx, doc, odt, rtf, txt, html | e-kitaptan: epub, mobi, azw3, fb2, pdf, docx, txt, htmlz, rtf (Calibre); belgeden: epub (LibreOffice), mobi/azw3/fb2 (Calibre; .doc hariç). DRM'li kitaplar dönüştürülmez. |
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

### Calibre (e-kitap) gömme

Gömme adımı (`npm run calibre-hazirla -- <calibre-64bit-X.msi>`): resmî Calibre MSI dosyasının boyutu ve SHA-256'sı `scripts/calibre-surum.json` içindeki sabit değerlerle, Authenticode imzası da "Kovid Goyal" imzacısıyla doğrulanır (Windows: PowerShell `Get-AuthenticodeSignature`; Linux: `osslsigncode verify`, "Signature verification: ok" şart). Biri tutmazsa hiçbir şey yazılmaz. Ağı kısıtlı ortamlar için isteğe bağlı `CALIBRE_CRL` ve `CALIBRE_TSA_CRL` ortam değişkenleri yerel CRL dosyasını (PEM) `osslsigncode`'a `-CRLfile` / `-TSA-CRLfile` olarak geçirir; denetimi atlatan bir bayrak yoktur. MSI `msiextract` (Linux) ya da `msiexec /a` (Windows) ile açılır; paketteki `Calibre2` klasörünün içeriği değiştirilmeden `vendor/calibre/` altına konur (`ebook-convert.exe`, `app/`, `LICENSE`); pakete yalnız ebook-convert için gereken dosyalar girer (diğer calibre*.exe araçları `extraResources` süzgecinde dışarıda bırakılır), tüm `.exe/.dll/.pyd` dosyalarının x64 (PE Machine 0x8664) olduğu denetlenir ve `GOMULU-SURUM.txt` yazılır. `npm run dist` bu betiği her derlemede çalıştırır: `vendor/calibre` hazırsa yalnız kaydı doğrular, yoksa MSI ister. Paketleme sırasında `vendor/calibre` → `resources/calibre` olarak kopyalanır.

Çalışma zamanında yalnız `resources/calibre/ebook-convert.exe` kullanılır (Windows'ta her kullanımda Authenticode imzası ve imzacı "Kovid Goyal" denetlenir; geçmeyen yol kullanılmaz, kullanıcının bilgisayarındaki ayrı Calibre kurulumu aranmaz). Her iş kendi geçici klasöründe çalışır: `CALIBRE_CONFIG_DIRECTORY`, `CALIBRE_TEMP_DIR` ve `CALIBRE_CACHE_DIRECTORY` o klasöre yönlendirilir, kullanıcının Calibre kitaplığı ve ayarları okunmaz/yazılmaz, vekil 127.0.0.1:9 ile ağ kapatılır; iş bitince klasör silinir. DRM'li kitaplar için Calibre'nin `DRMError`'u Türkçe açıklamaya çevrilir; program DRM kaldırmaz.

Dürüst not: 26.8.1 paketi, bulut ortamında CRL sunucularına ağ kapalı olduğu için betik yerine aynı adımlarla elle hazırlandı. SHA-256 resmî değerle eşleşti, imza özeti ve sertifika zinciri doğrulandı; yalnız sertifika iptal listesi (CRL) denetlenemedi.

## Motorlar ve lisanslar
| Bileşen | Sürüm | Lisans | Not |
|---|---|---|---|
| FFmpeg | 6.1.1 (ffmpeg-static b6.1.1, win32-x64) | GPL-3.0 | Ayrı program olarak, değiştirilmeden çağrılır. Tam lisans metni ve kaynak kodu teklifi pakette `resources/lisanslar/` altında. İndirilen dosya SHA-256 ile doğrulanır. |
| LibreOffice | 26.8.1 (`scripts/libreoffice-surum.json`) | MPL-2.0 | Değiştirilmemiş, ayrı program. Lisans metni `resources/lisanslar/LibreOffice-MPL-2.0.txt`, kaynak kodu: https://www.libreoffice.org/about-us/source-code/ |
| Calibre | 9.16.0 (`scripts/calibre-surum.json`) | GPL-3.0 | Değiştirilmemiş, ayrı program olarak (`resources/calibre/ebook-convert.exe`) çağrılır. Lisans metni `resources/calibre/LICENSE` ve `resources/lisanslar/Calibre-GPL-3.0.txt`, kaynak kodu: https://github.com/kovidgoyal/calibre |
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

## Rust çekirdeği (taa-donustur)
Arşiv işleri (ZIP/GZIP oluştur-aç) `taa-donustur/` crate'inden derlenen `taa-donustur.exe` ile yapılır (zip-ac ≈6x hızlı). Ayarlar → "Görünüm ve başarım" → "Arşiv işlemlerinde Rust çekirdeğini kullan (hızlı)" (ayar `motorRust`, varsayılan açık). Exe yoksa ya da Rust'ın desteklemediği bir arşivde (yinelenen girdi adı) sessizce JS (fflate) yolu kullanılır. Paketleme: `node scripts/cekirdek-hazirla.js` (`npm run dist` bunu önce çalıştırır) `cargo build --release -j 2` yapar, exe'yi ve `SURUM.txt` (sürüm + SHA-256) dosyasını `vendor/cekirdek/` altına koyar; kurulumda `resources/cekirdek/` olur. Modül bilgisi: `taa-donustur/modul.toml`. Ayrıntı: `docs/PLAN-taadon-rust.md`. <!-- yazan: [Claude#taadon-rust-asama2 2026-11-04] -->

## Windows kurulum dosyası üretme
Windows'ta:
```
npm install
npm run dist
```
`dist/` altına `TaaDon-Kurulum-<sürüm>.exe` (kurulum) ve `TaaDon-Tasinabilir-<sürüm>.exe` (kurulumsuz) gelir. `npm run dist` önce FFmpeg'i indirip doğrular, sonra calibre-hazirla ile Calibre kaydını denetler.

Linux'ta derleme: Windows sharp ikilisi `npm install --no-save --os=win32 --cpu=x64 @img/sharp-win32-x64@0.35.5` ile eklenir; wine yoksa barkod uygulamasındaki gibi `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js` içindeki `isMacOsCatalina()` koşulu `true` yapılarak kaldırıcı yükleyiciden çıkarılır. `signAndEditExecutable=false` olduğundan exe imzasızdır (bkz. "Kod imzalama"). Linux yerel modülleri (`@napi-rs/*`; pdf.js arayüzde tarayıcı canvas'ını kullanır) ve Linux sharp ikilileri pakete alınmaz.

## Güncelleme temizliği ve kaldırma
Güncellemede NSIS eski kaldırıcıyı çağırdığında (`build/kurulum.nsh`, `${isUpdated}`) hiçbir dosya silinmez; yeni dosyalar eskilerin üzerine yazılır. Eski sürümden artakalan dosyaları uygulamanın kendisi temizler (`src/guncelleme.js`, yalnız kurulu Windows sürümünde, açılıştan yaklaşık 8 sn sonra):
1. `afterPack` (`scripts/manifest-uret.js`) her sürümde `resources/surum-manifest.json` (yol, boyut, SHA-256) ve kaldırıcı için `resources/surum-dosyalar.txt` üretir.
2. Yeni manifest doğrulanır: boş olmamalı, `resources/app.asar` ve çalışan exe girdileri bulunmalı, kurulu dosyaların boyutu (exe ve asar için SHA-256'sı da) tutmalı. Biri tutmazsa `dogrulanamadi` döner ve hiçbir şey silinmez.
3. Önceki sürümün manifestinde olup yenisinde olmayan dosyalar aday olur (`.surum/onceki-manifest.json`). Çalışan exe, `resources/app.asar` ve `resources/surum-manifest.json` hiçbir koşulda silinmez; korunan kökler (kullanıcı verisi, Belgeler, çıktı klasörü) altındaki dosyalara dokunulmaz.
4. Aday, yalnız boyutu **ve SHA-256'sı** önceki manifesttekiyle aynıysa (kullanıcı değiştirmediyse) silinir; sembolik bağ/junction izlenmez. Silmeden hemen önce her yol bileşeni `lstat` ile, gerçek yol `realpath` ile bir kez daha denetlenir. Kalan yarış penceresi: bu son denetim ile `unlink` arasındaki çok kısa süre; kurulum klasörüne yazabilen biri o anda bir ara klasörü bağla değiştirebilir (Node'da `unlinkat` yok).
5. Sonuç `.surum/temizlik-gunlugu.txt` dosyasına yazılır; günlük ve geçici manifest dosyası sembolik bağ izlemez (`lstat` + `wx`). Yeni manifest başarıyla işlenince `onceki-manifest.json` güncellenir; hata olursa güncellenmez ve sonraki açılışta yeniden denenir.

Ayrıca 1.0.0–1.0.2 kurulumlarında önceki manifest hiç kaydedilmediğinden, bilinen eski sürüm kalıntıları (1.0.0'daki LibreOffice Python bileşenleri) `src/eski-kalintilar.json` sabit listesiyle (yol, boyut, SHA-256; `scripts/kalinti-listesi-uret.js` üretir) önceki manifest olsa da olmasa da, yeni sürüm doğrulandıktan sonra aynı güvenlik denetimleriyle silinir; boyutu ya da SHA-256'sı tutmayan dosyaya dokunulmaz, günlüğe yalnız özet (`KALINTI: N silindi, M atlandı`) yazılır. Liste app.asar içinde durduğundan asar destekli `fs` ile okunur (1.0.4'te `original-fs` ile okunmaya çalışıldı ve Windows'ta adım atlandı; 1.0.5'te düzeltildi).

Normal kaldırmada `RMDir /r $INSTDIR` **kullanılmaz**. Kaldırıcı `resources\surum-dosyalar.txt` (UTF-16LE, `F|dosya` ve `D|klasör` satırları, klasörler en derinden başlayarak) listesindeki dosyaları tek tek `Delete`, klasörleri özyinelemesiz `RMDir` ile (yalnız boşsa) siler; ardından `.surum` içindeki bilinen dosyaları, kaldırıcıyı ve en son `$INSTDIR`'yi (özyinelemesiz) kaldırır. `$INSTDIR\<ana exe>` yoksa ya da `$INSTDIR` bir sürücü köküyse (`X:\`) hiçbir şey silmeden çıkar. Böylece kullanıcının aynı klasöre koyduğu dosyalar kalır.

**Kaldırıcının sınırlaması (NSIS):** Kaldırıcı dosya içeriği için SHA-256 denetimi yapmaz; yalnız kurulumda yazılan `surum-dosyalar.txt` listesindeki adları tek tek siler. Tek denetim listenin kendisinindir: paketleme sırasında listenin SHA-256'sı kaldırıcıya gömülür (`build/uretilen/liste-sha.nsh`, `afterPack` üretir), kaldırıcı `certutil -hashfile` ile hesaplayıp karşılaştırır; uyuşmazsa ya da hesaplanamazsa hiçbir şey silmez. Bağ/junction (reparse point, `FILE_ATTRIBUTE_REPARSE_POINT` 0x400) olan kurulum klasörüne, klasörlere ve dosyalara dokunmaz (bir klasör bağsa altındaki hiçbir dosya silinmez), `RMDir /r` kullanmaz, Windows ayrılmış adları (`CON`, `NUL`, `COM1` ...) ve `..` içeren yolları reddeder, listede olmayan kullanıcı dosyalarını bırakır. Ayrıntılı denetimler (dosya içeriği SHA-256, sabit bağ/hardlink `nlink > 1` atlama) yalnız uygulama içi güncelleme temizliğindedir (`src/guncelleme.js`). Kurulum yalnız kullanıcı başınadır ("tüm kullanıcılar için" sayfası kapalıdır).

**Sınırlama (bu sürüme ilk geçiş):** Bu sürümden önce kurulmuş sürümün kaldırıcısı bu makroyu içermez; güncelleme sırasında o eski kaldırıcı klasörü önceden boşaltır (eski davranış). Yani 1.0.0 gibi makrosuz bir sürümden bu sürüme geçişte kurulum klasöründeki kullanıcı dosyaları da silinebilir; bu sürümden sonraki geçişlerde yeni davranış geçerlidir. Kurulum klasörüne kendi dosyalarınızı koymayın.

## Kod imzalama
Şu an exe'ler **imzasızdır**: Windows SmartScreen uyarı verir ("Ek bilgi" > "Yine de çalıştır"). Plan: kod imzalama sertifikası (OV/EV ya da Azure Trusted Signing) alınınca `package.json` içinde `win.signAndEditExecutable` açılır ve electron-builder `win.signtoolOptions` (ya da Azure Trusted Signing ayarı) ile exe, kurulum ve taşınabilir dosyalar imzalanır. Not: imzalama açılınca güncelleme manifestindeki exe SHA-256'sı imzadan **sonra** üretilmelidir (imza dosyayı değiştirir); bu nedenle `scripts/manifest-uret.js` `afterPack` yerine `afterSign` kancasına taşınmalıdır, aksi halde `guncelleme.js` doğrulaması exe için `sha256 tutmuyor` der ve temizlik hiç çalışmaz.

## Doğrulama durumu
- Çekirdek dönüşümler Linux'ta gerçek FFmpeg 6.1.1 ve LibreOffice ile uçtan uca test edildi.
- Uygulama Linux'ta (xvfb) açılıp kuyruk üzerinden mp3→mpg ve csv→json işleri tamamlandı.
- Windows'ta kurulup denenmedi; ilk kullanımda kurulum, kısayollar ve LibreOffice bulma Windows'ta denenmeli.

## Sürüm notları
- 1.1.0: yeni ad (TaaDön) ve tasarım dili.
- 1.2.0: sekmeler, klavye kısayolları, süre bilgisi.
- 1.3.0: son kullanılan biçim, zaman aşımı.
- 1.4.1: Aç düğmesi.
- 1.10.0: Ayarlar'da PIN kilitli **Yönetici paneli** (sürüm, çekirdek ve motor durumu, kuyruk sayıları, Rust çekirdeğini kapat/aç, maskeli tanı dosyası); Özellikler'den gizlenebilir.
- 1.9.0: Ayarlar'da "Özellikler" kartı (her yeni özellik kapatılabilir); satır üzerinde önizleme; Dönüştür sayfasında "Tek PDF'de birleştir"; LibreOffice ısıtma; Ctrl+V ile panodan ekleme, görev çubuğu ilerlemesi, içerikten biçim uyarısı, kalan süre tahmini.
- 1.8.0: hatalı/iptal işte "Yeniden dene"; e-kitapta başlık dosya adından türetilir, kapak/üst veri korunur; Ayarlar'da "çıktıdan üst veriyi temizle" (PDF Info/XMP, Office kişisel bilgi, görsel EXIF).
- 1.7.0: Rust çekirdeği `taa-donustur` (arşiv işlemleri ve çıktı imza doğrulaması; zip açma ≈6x hızlı), Ayarlar'dan kapatılabilir; JS yolu geri düşme.
- 1.6.0: çıktı yeri/sonek/Özgün klasörüne taşıma, çıktı doğrulama, PDF/A ve PDF kalitesi, klasör bırakma, sağ tık menüsü ve komut satırından dosya açma, hız (tembel yükleme, LibreOffice profil şablonu).
- 1.5.0: erişilebilirlik ve kontrast iyileştirmeleri; Türkçe hata metinleri; güvenlik sertleştirmeleri (karışık seçim denetimi, zip bellek sınırı, HTML kodlama düzeltmesi, PDF okuma sınırı 256 MB); uyku engeli ve bitiş bildirimi; PDF araçlarında iptal.
