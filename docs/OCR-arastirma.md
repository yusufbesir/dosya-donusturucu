<!-- Sahip: Yusuf (TaaDön). Yazan: [Claude#ocr-arastirma 2026-11-04]. Ne: "Metin (OCR)" yeteneği için seçenek araştırması ve Türkçe ölçüm. Değişiklik: yazan yapay zeka ya da Yusuf; Yusuf'un kuralları (ORTAK-AJAN-KURALLARI.md); silme yok. Kod değişikliği içermez. -->
# OCR araştırması: TaaDön "Metin (OCR)" (Türkçe)

## Özet
- **Öneri: Windows OCR (Windows.Media.Ocr), PowerShell ile değil, `taa-donustur` içinden `windows` crate ile.** Ölçümde Türkçe karakter doğruluğu %96,1–99,6, toplam süre (süreç başlatma dahil) yaklaşık 80–100 ms. Deneme exe'si 171 KB; çekirdeğe ekleyeceği boyut yüzlerce KB düzeyinde, model dosyası yok.
- **ocrs elendi:** Türkçe harfleri hiç tanımadı (ğüşıöçİ: 0/59). Alfabesi yalnız ASCII Latin. Modelleri Apache değil, **CC BY-SA 4.0** lisanslı.
- **Tesseract yedek yol olabilir:** Apache-2.0, `tur.traineddata` 4,6 MB (fast). Resmi taşınabilir zip yok, yalnız 26,6 MB'lık kurucu var. Ölçülmedi (kurulu değil, kurmadım).
- Özellik bayrağı `ozOcr` olur, varsayılan değeri kapalı. Türkçe OCR dili yoksa yetenek gizlenir.

## Ölçüm
**Düzenek:** Windows 10 Pro 19045, `Windows.Media.Ocr.dll` 10.0.19041.4355. Kullanılabilir OCR dili: `tr` (sistem dili Türkçe). Örnek metin 5 satır, 229 karakter, 59 Türkçe özel harf. Arial 56 px ile sharp (SVG→PNG) üzerinden üretildi:
- `ornek`: 1800×700, density 300
- `kucuk`: 900 px genişlik (yaklaşık 150 dpi)
- `zor`: 1200 px genişlik, bulanıklık 1,2, düşük karşıtlık, 1,5° dönüş

Doğruluk = 1 − Levenshtein/229. Boşluklar sadeleştirildi, NFC normalizasyonu uygulandı. Süre üç tekrarın medyanıdır ve duvar saatiyle ölçüldü (süreç başlatma dahil).

| Yol | Görsel | Levenshtein | Doğruluk | Türkçe harf | Süre (medyan) |
|---|---|---|---|---|---|
| Windows OCR, Rust (`windows` 0.61.3) | ornek | 5 | %97,8 | 58/59 | 102 ms (OCR 31 ms) |
| Windows OCR, Rust | kucuk | 1 | %99,6 | 58/59 | 80 ms (OCR 13 ms) |
| Windows OCR, Rust | zor | 9 | %96,1 | 54/59 | 94 ms (OCR 29 ms) |
| Windows OCR, PowerShell 5.1 | ornek / kucuk / zor | 5 / 1 / 9 | Rust ile aynı | Rust ile aynı | 462 / 750 / 393 ms |
| ocrs-cli 0.13.1 (crates.io) | ornek | 71 | %69,0 | 0/59 | 444 ms |
| ocrs-cli | kucuk | 59 | %74,2 | 0/59 | 333 ms |
| ocrs-cli | zor | 61 | %73,4 | 0/59 | 332 ms |
| Tesseract 5 | — | ölçülmedi | ölçülmedi | ölçülmedi | ölçülmedi |

### Windows OCR hataları
- "ığdırlı" sözcüğü "Iğdırlı" okundu: sözcük başındaki küçük ı büyük harfe döndü. Bu hata üç görselde de var.
- "%18" 1800 px görselde ve `zor` görselinde düştü.
- `zor` görselinde "İŞÇİ" sözcüğü "işçi" okundu (büyük/küçük harf hatası).

### ocrs hataları
Türkçe harflerin yerine `?` ya da noktasız/çengelsiz Latin harfi geldi. Örnek: "?agri Isik g?ne?li".

### Windows OCR uygulama bulguları
- `StorageFile.GetFileFromPathAsync`, `\\?\` önekli yolu reddediyor (HRESULT 0x800700A1). PowerShell'de 8.3 kısa yolla bazı çağrılar başarısız oldu, uzun yolla hepsi çalıştı.
- **Sonuç:** Dosya yolunu WinRT'ye vermek yerine görsel sharp ile ham BGRA8'e çözülmeli ve `SoftwareBitmap.CreateCopyFromBuffer` ile verilmeli. Böylece yol sorunu ortadan kalkar, WIC çözücüsü de saldırı yüzeyinden çıkar.
- `OcrEngine.MaxImageDimension` = 10000 px. Daha büyük görseller küçültülmeli.

## Seçenekler

### a) ocrs (Rust, `taa-donustur` içine gömülü)
- **Lisans:** Kod Apache-2.0 / MIT. **Modeller CC BY-SA 4.0** (HierText'ten miras alıyor); dağıtımda atıf ve aynı lisansla paylaşma koşulu var.
- **Paket artışı:** Modeller 2,50 MB (algılama) + 9,71 MB (tanıma) = yaklaşık 12,2 MB. Bunlara rten ve ocrs kodu eklenir; CLI exe'si 8,6 MB çıktı, kitaplık olarak eklenince ne kadar tutacağı ölçülmedi.
- **Türkçe:** Uygun değil. Varsayılan alfabe yalnız ASCII; README'ye göre "yalnız Latin alfabesi". Latin dışı karakter desteği için açılan issue #8 hâlâ açık. Türkçe için kendi modelimizi eğitmemiz gerekir.
- **Hız:** 330–440 ms (CLI, model yükleme dahil).
- **Güvenlik:** CLI ilk çalıştırmada modelleri S3'ten indiriyor; gömülü kullanımda modeller SHA ile sabitlenip pakete konmalı. Saf Rust, ağ gerekmez.
- **Uygulama zorluğu:** Düşük, ama Türkçe olmadığı için anlamsız.

### b) Tesseract 5 (ayrı süreç, FFmpeg kalıbı)
- **Lisans:** Apache-2.0 (tesseract ve tessdata_fast). Kurucunun içindeki DLL'lerin lisansları (leptonica, libtiff, libpng, libarchive, icu ve diğerleri) **doğrulanmadı**.
- **Paket artışı:**
  - Resmi Windows kurucusu: `tesseract-ocr-w64-setup-5.5.3.20260724.exe`, 26,6 MB (tesseract-ocr/tesseract 5.5.3 sürümü). 5.5.4 sürümünde (2026-10-28) Windows ikilisi yok. UB-Mannheim deposundaki son GitHub sürümü 5.4.0, 50,2 MB.
  - **Resmi taşınabilir zip bulunamadı.** Kurucu (NSIS) 7-Zip ile açılıp gerekli dosyalar seçilebilir; bunun kurulu boyutu ölçülmedi.
  - Türkçe dil dosyası `tur.traineddata`: fast 4,55 MB, best 7,46 MB, legacy+LSTM 18,75 MB.
- **Türkçe:** Ölçülmedi.
- **Hız:** Ölçülmedi.
- **Güvenlik:** Ağ gerekmez; kalıp `scripts/ffmpeg-indir.js` ile aynı olur (sabit URL, SHA-256, lisans metni, `vendor/tesseract`). Görsel ayrıştırma C kodunda (leptonica) yapılıyor; ayrı süreçte çalıştığı için yalıtım iyi. Exe'nin imzalı olup olmadığı **doğrulanmadı**.
- **Uygulama zorluğu:** Orta. İndirme/çıkarma betiği, manifest ve dil dosyası gerekir.

### c) Windows OCR (Windows.Media.Ocr)
- **Lisans:** İşletim sisteminin parçası, dağıtılacak bir şey yok. `windows` crate MIT OR Apache-2.0.
- **Paket artışı:** Model yok. Deneme exe'si 171 KB (strip, thin LTO); çekirdeğe katkısının bundan az olması beklenir.
- **Türkçe:** Ölçümde %96,1–99,6, en iyisi. Koşul: Türkçe OCR dil paketi kurulu olmalı. Bu bilgisayarda Türkçe sistem dili nedeniyle kurulu.
  - Kurulu değilse Microsoft Learn'deki PowerToys belgesine göre `Get-WindowsCapability -Online | ? Name -like 'Language.OCR*tr-TR*' | Add-WindowsCapability -Online` gerekir. Bu komut yönetici yetkisi istiyor (burada yetkisiz `Get-WindowsCapability` "yükseltme gerekiyor" hatası verdi). Bu nedenle uygulama kurmaz, kullanıcıya bilgi verir.
- **Hız:** OCR 13–48 ms; Rust süreciyle toplam 80–160 ms, PowerShell ile 370–780 ms.
- **Güvenlik:** Dosya ya da ham piksel girdisiyle yerel çalışıyor. Ağ trafiği yakalanarak "ağ yok" **doğrulanmadı**; Microsoft belgelerinde bulut kullanımı belirtilmiyor. PowerShell yolunda yürütme ilkesi ve AV/AMSI riski var, Rust yolunda bu risk yok.
- **Uygulama zorluğu:** Düşük–orta. WinRT async `.get()` ile çağrılıyor ve çalışan deneme kodu yaklaşık 30 satır. Linux/macOS'ta yok (TaaDön Windows odaklı).

## Öneri: TaaDön
1. **Yol:** `taa-donustur` içine `#[cfg(windows)] mod ocr` eklenir. `windows` crate özellikleri: `Media_Ocr`, `Graphics_Imaging`, `Globalization`, `Foundation`, `Storage_Streams`. JSON satırlı CLI'ye iki komut eklenir:
   - `ocr-diller`: `AvailableRecognizerLanguages` listesini döner.
   - `ocr`: girdi ham BGRA8 ya da PNG, `dil` (varsayılan `tr`); çıktı satırlar ve kutular.
   Bağımlılık eklemek Yusuf'un onayına bağlı (Cargo.toml kuralı).
2. **Görsel girdisi:** Electron tarafında sharp, görseli en çok 10000 px'e küçültür ve ham piksele çevirir; Rust yalnız tamponu alır. Yol, WIC ve `\\?\` sorunları böylece ortadan kalkar. PDF için önce sayfa görsele çevrilir (mevcut önizleme motoru).
3. **ozOcr:** `ayarlar.ozOcr` varsayılan olarak kapalı.
   - `arayuz/uygulama.js` ayar listesine şu satır eklenir: `['ozOcr', 'Görsellerden metin çıkar (Windows OCR)']`.
   - Ana süreçte `ele('ocr', …)` başında `if (ayarlar.ozOcr !== true) return null;` denetimi olur.
   - Açılışta `ocr-diller` çağrılır; listede `tr` yoksa yetenek satırı gizlenir ve dil paketi kurulumunu anlatan bilgi metni gösterilir. Uygulama sistem ayarına dokunmaz.
4. **Paket etkisi:** Yaklaşık +0,1–0,3 MB (tahmin; eklenen kod çekirdeğin içinde ölçülmedi). Model ya da vendor klasörü yok.
5. **Yedek:** Windows OCR yoksa (dil paketi kurulu değilse ya da kurumsal kısıtlama varsa) Tesseract `vendor/tesseract` yolu ileride ayrı bir isteğe bağlı bileşen olabilir, artısı yaklaşık 30 MB + 4,6 MB. Önce Türkçe ölçümü yapılmalı.

## Doğrulanamayanlar
- Tesseract'ın Türkçe doğruluğu ve hızı. Kurulu değil ve kurmadım.
- Tesseract kurucusunun açılmış boyutu, imzası ve içindeki DLL lisansları.
- Windows OCR'nin hiç ağ kullanmadığı (trafik yakalanmadı).
- Türkçe OCR paketinin Türkçe olmayan Windows'ta varsayılan olarak bulunup bulunmadığı.
- Gerçek taranmış belge ya da fotoğraf başarımı. Ölçüm sentetik, tek yazı tipli (Arial) bir görselle yapıldı.
- ocrs kitaplığının (CLI değil) `taa-donustur` exe'sine kattığı net boyut.

## Kaynaklar
- ocrs: https://github.com/robertknight/ocrs (README "Language Support"; issue #8: https://github.com/robertknight/ocrs/issues/8); `ocrs/src/lib.rs` DEFAULT_ALPHABET; model adresleri `ocrs-cli/src/main.rs`.
- ocrs modelleri ve lisansı: https://github.com/robertknight/ocrs-models (LICENSE.md: CC BY-SA 4.0).
- Tesseract sürümleri: https://github.com/tesseract-ocr/tesseract/releases (5.5.3 Windows kurucusu, 26.573.224 bayt).
- UB Mannheim: https://github.com/UB-Mannheim/tesseract/wiki ve https://github.com/UB-Mannheim/tesseract/releases.
- Dil dosyaları: https://github.com/tesseract-ocr/tessdata_fast, https://github.com/tesseract-ocr/tessdata_best, https://github.com/tesseract-ocr/tessdata.
- Windows OCR dil paketleri: https://learn.microsoft.com/en-us/windows/powertoys/text-extractor.
- `windows` crate: https://crates.io/crates/windows (MIT OR Apache-2.0).
- Deneme betikleri ve çıktılar (geçici, proje dışında): `C:\Users\TAA PF60V67C\AppData\Local\Temp\claude\D--Programlar\ca96707a-bbf0-4c09-8efa-d964c81c2689\scratchpad\ocr\` (`betik\`, `cikti\`, `rust-winocr\`, `indirilen-model\`, `ocrs-kur\`).
