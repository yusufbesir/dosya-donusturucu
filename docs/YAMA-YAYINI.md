---
description: TaaDön yama yayını (uzaktan güncelleme) tasarım belgesi; yalnız öneri, kod değişmez.
sahip: Yusuf (TaaDön projesi)
yazan: [Claude#taadon-yama-tasarimi 2026-11-04]
degisiklik: Yalnız yazan yapay zeka veya Yusuf değiştirir; karar Yusuf'undur.
---
# TaaDön yama yayını (tasarım)

## Özet
Hedef: 1.10.0 -> 1.11.0 geçişinde 700 MB paket yeniden inmesin. Öneri: **kendi yama biçimi (manifest farkı)** birincil,
electron-updater blockmap yalnız yedek. Yama deposu `yusufbesir/taa-yayin` (açık, yalnız imzalı yama); tam paket özel
`taa-paket`te kalır. Anahtar üretimi ve varsayılan mod Yusuf'un kararıdır (bölüm 4).

## 0. Mevcut durum (okunan kaynaklar)
- `scripts/manifest-uret.js` (afterPack) `resources/surum-manifest.json` üretir: `{uygulama, surum, olusturma, dosyalar:[{yol,boyut,sha256}]}`; 1.10.0'da 2,5 MB, her dosyada SHA-256 var.
- `src/guncelleme.js` yalnız kurulum SONRASI kalıntı temizler (`eskiSurumuTemizle`); indirme/yerleştirme yok. `.surum/onceki-manifest.json` önceki sürümün listesini tutar. Yama motoru buradaki yol/bağ denetimlerini (`goreliGecerli`, lstat, realpath, nlink) yeniden kullanmalı.
- Gerçek boyutlar (`dist/win-unpacked`, 1.10.0): `TaaDön.exe` 239 MB (Electron), `app.asar` 34,7 MB, LibreOffice 1,45 GB açık, Calibre 666 MB, FFmpeg 79 MB; kurulum paketi 699 MB, `.blockmap` 0,73 MB.
- Düzeltme: "app.asar + çekirdek exe çoğu sürümde 2-10 MB" varsayımı app.asar için **doğru değil**: asar 34,7 MB (node_modules dahil). Sıkıştırılmış yama ~10-14 MB beklenir (ölçülmedi). Çekirdek exe boyutu ölçülmedi.
- electron-updater projede yok; `build.publish: null`, `signAndEditExecutable:false`, kod imzası yok; NSIS `perMachine:false` (kurulum klasörü kullanıcıya yazılabilir, yönetici hakkı gerekmez: yama için avantaj).

## 1. Seçenekler
### a) electron-updater (generic provider veya GitHub Releases) + blockmap
- İşleyiş (electron-builder "Auto Update" belgesine göre; bu oturumda web'den DOĞRULANMADI): `latest.yml` + yeni kurulum exe + `.blockmap`; istemci eski blockmap ile farkı bulup yalnız değişen blokları HTTP Range ile çeker, kurulum exe'yi yerelde birleştirir, çalıştırır.
- Sınırlar: (1) fark, **kurulum paketi** (sıkıştırılmış 7z/LZMA akış) üzerindedir; asar değişince akışta kayma olursa sonraki bloklar eşleşmeyebilir, inen miktar önceden bilinmez. (2) Motorlar değişmese de sıkıştırma çıktısı aynı kalıyorsa bloklar eşleşir, kalmıyorsa 700 MB'a yaklaşır. TAHMİN: iyi durum 20-60 MB, kötü durum yüzlerce MB. (3) Kurulum yine 3 GB'ı yeniden yazar. (4) Kod imzası olmadığından publisherName doğrulaması yok; güven yalnız `latest.yml` sha512 + HTTPS. (5) Tam kurulum exe'nin açık `taa-yayin`de durması gerekir; "yalnız imzalı yama" ilkesiyle ve özel `taa-paket` kararıyla çelişir.
- Ölçüm fırsatı: `dist/` içinde 1.1.0 ... 1.10.0 kurulum exe + blockmap çiftleri var; ardışık sürümler arasındaki gerçek blok eşleşmesi ölçülüp karar kanıta bağlanır.
### b) Kendi yama biçimi: manifest farkı (ÖNERİLEN)
- Yayın: sürüm başına imzalı `yama.json` (yeni tam manifest + dosya URL'leri) ve içerik adresli havuz `havuz/<sha256>` (sıkıştırılmış). İstemci kendi manifestiyle farkı hesaplar; tek yama herhangi eski sürümü son sürüme götürür.
- İstemci: yerel `resources/surum-manifest.json` ile karşılaştırır; eklenen/değişen dosyaları indirir (SHA-256 doğrular); silinecekleri mevcut `guncelleme.js` kalıntı mantığıyla kaldırır.
- Yerleştirme (atomik): `<kurulum>\.surum\hazirlik\<yeni>\` içine indir+doğrula; hepsi tamsa, çalışan exe kilitli olduğundan **yeniden başlatmada** (küçük yardımcı süreç) eskileri `eski\<sürüm>\`e yedekle, yenileri `rename` ile yerleştir (aynı birim, atomik). Kilitli dosya varsa tümü geri alınır.
- Boyut: çoğu sürümde değişen = `app.asar` (~35 MB, sıkıştırılmış ~10-14 MB) + `cekirdek/taa-donustur.exe` + `surum-manifest.json` (2,5 MB) + `surum-dosyalar.txt` (2 MB; NSIS kaldırıcı listesi, güncellenmeli). Motorlar ve Electron (239 MB exe) yükseltilmedikçe inmez.
- Sınırlar: asar tek dosya, küçük kod değişikliği de ~35 MB (sıkıştırılmış) getirir; iyileştirme: kodu (`src/`, `arayuz/`) ayrı küçük asar'a bölmek veya asar'a ikili fark (bsdiff/zstd `--patch-from`) uygulamak (sonraki aşama). Electron/motor yükseltmesi yama değil "tam sürüm" kanalı gerektirir.
- Doğrulanmamış: imzasız exe'nin yamalı hâlinde Defender/SmartScreen davranışı.
### c) Squirrel / MSIX
- Squirrel.Windows bakımsız, NSIS'ten geçişi kurulum modelini yıkar; MSIX imza sertifikası şart (kod imzası yok). **Elendi** (derin araştırma yapılmadı; gerekçe imza ve bakım durumu).

## 2. Güvenlik
- **İmza**: Ed25519 (veya minisign). `yama.json` (sürüm, geçerli eski sürüm aralığı, dosyalar{yol,boyut,sha256,url}, `min_istemci`, tarih, **artan sayaç**) imzalanır; imza ayrı `yama.json.sig`. Açık anahtar uygulamaya gömülü (asar içinde sabit); imzasız/yanlış imzalı manifest yok sayılır. Node `crypto` Ed25519'u yerleşik destekler (ek bağımlılık yok).
- **Özel anahtar**: yalnız Yusuf'un `D:\YusufII\HAFIZAM1\anahtarlar\` klasöründe; yapay zeka erişmez, bu belge anahtara dokunmaz. İmzalama Yusuf'un elle çalıştırdığı betikle yapılır. Sızıntı/kayıp planı: ikinci (yedek) açık anahtar gömülür; döndürme yeni anahtarla imzalı tam sürümle.
- **Geri alma saldırısı**: istemci kayıtlı sayaçtan küçük yamayı reddeder; imzalı `iptal.json` kötü yamayı geri çeker.
- **Dosya doğrulama**: boyut ve SHA-256 manifestle birebir; uyuşmayan dosya atılır, yama iptal. Yol kuralları `goreliGecerli` ile (.., mutlak yol, ayrılmış ad, `.surum` yasak); yalnız kurulum klasörü altı.
- **Ağ**: yalnız HTTPS ve `github.com/yusufbesir/taa-yayin` (+ Releases yönlendirme alanı `objects.githubusercontent.com`; DOĞRULANMALI); başka host/yönlendirme reddi; zaman aşımı, boyut sınırı (manifest ≤ 5 MB, dosya ≤ bildirilen boyut).
- **Geri alma**: yerleştirmeden önce `eski\<sürüm>\` yedek. Dikkat: mevcut `guncelleme.js` yeni sürüm doğrulanınca eski dosyaları siler; yama için yedek "sağlıklı açılış doğrulanana kadar" korunur, sonra Geri Dönüşüm Kutusu'na taşınır (kalıcı silme yok). Ana pencere açılmazsa yardımcı süreç otomatik geri yükler.
- **Modlar** (Yönetici paneli, PIN kilitli; ayar `guncellemeModu`): `sor` (bildir, onayla, indir/uygula), `otomatik` (arka planda indir, kapanışta yerleştir), `kapali` (ağ isteği yok; elle "şimdi denetle" mümkün). Telemetri yok; istek yalnız sürüm sorgusudur.
- Not: bunlar kod imzası yokluğunu telafi etmez; SmartScreen uyarısı sürer.

## 3. Öneri ve yol haritası
Öneri: **b birincil**; a yalnız Electron/motor yükseltmesi gibi büyük sürümlerde tam paket yedeği (özel kanal, ayrı karar).
1. Ölçüm (kodsuz): `dist/` blockmap çiftleriyle a'nın gerçek inen miktarı; 1.9->1.10 manifest farkıyla b'nin gerçek miktarı. Eşik: b ortalaması ≤ 50 MB ise sürdür.
2. Anahtar çifti (Yusuf); açık anahtarı uygulamaya göm; imza/doğrulama modülü + birim testleri.
3. Yama üretici betik (`scripts/yama-uret.js`): iki manifest farkı -> `yama.json` + havuz; imzaya hazır çıktı.
4. İstemci: denetim -> indirme -> doğrulama -> hazırlık klasörü -> yeniden başlatmada atomik yerleştirme -> geri alma.
5. Yönetici paneli: mod seçici, son denetim, yama geçmişi, elle denetim.
6. `taa-yayin` düzeniyle sahte yama (1.10.1-deneme), sonra gerçek 1.11.0.
**Test planı**: (i) temiz makine/sanal makine: 1.10.0 kur, 1.11.0 yamasını uygula, sürüm ve işlev denetle; (ii) bozuk imza, bozuk SHA, kesik indirme, başka host'a yönlendirme reddi; (iii) eski sayaçlı yama reddi; (iv) yerleştirme sırasında güç kesme -> açılışta onarma; (v) kilitli dosya (LibreOffice çalışırken) -> erteleme; (vi) başarısız açılış -> otomatik geri alma; (vii) yama sonrası kaldırma tüm dosyaları siliyor mu (`surum-dosyalar.txt`); (viii) Defender/SmartScreen; (ix) `kapali` modda sıfır ağ trafiği.
**Ölçüm**: indirilen bayt, süre, değişen dosya sayısı/bayt, başarı/geri alma sayısı (yerel `yama-gunlugu.txt`, `temizlik-gunlugu.txt` yanında).

## 4. Yusuf'un kararları
1. Anahtar üretimi: kim/nerede, yedek açık anahtar; Ed25519 mi minisign mi (öneri: Ed25519, Node yerleşik).
2. Varsayılan mod: `sor` (öneri) mi `otomatik` mi; bildirim sıklığı.
3. `taa-yayin` dizin düzeni (öneri): `kanal/kararli/yama.json`, `yama.json.sig`, `iptal.json`, `havuz/<sha256>`; Releases (dosya başı 2 GB) mi depo dosyası (100 MB sınırı; asar ~35 MB sığar) mi.
4. Tam paket (a) açık depoda yayımlansın mı? (Öneri: hayır, özel kalsın.)
5. Kod imzası sertifikası alınacak mı (SmartScreen için; bütçe kararı)?
6. Eski sürümden atlamalı yama desteklensin mi, yoksa asgari sürüm sınırı mı?
7. Asar bölme (kod/bağımlılık ayrımı) ile yama boyutu küçültülsün mü?
