# Dosya Dönüştürücü - Teknik Tanım

Etiket: [İP:Dosya dönüştürücü#eSZiVv]

Barkod uygulamasından ayrı, Windows için kurulan bir Electron masaüstü programı. Bütün dönüştürmeler bilgisayarda yapılır; hiçbir dosya internete gönderilmez. Arayüz tamamen Türkçe.

## Motorlar
| Motor | Ne için | Nasıl gelir | Lisans |
|---|---|---|---|
| FFmpeg 6.1.1 (win32-x64) | Video, ses, video→GIF, BMP/ICO görsel | `scripts/ffmpeg-indir.js` indirir, SHA-256 doğrular, `vendor/ffmpeg/ffmpeg.exe` olarak `extraResources` ile pakete girer | GPL-3.0 (ayrı program olarak çağrılır) |
| sharp 0.35.5 (libvips) | JPG, PNG, WEBP, AVIF, TIFF, GIF, SVG girişi | npm bağımlılığı, `asarUnpack` | Apache-2.0 / libvips LGPL-3.0 |
| LibreOffice (kullanıcının bilgisayarında) | Belge, tablo, sunum, PDF→Word | Kurulu değilse arayüz indirme bağlantısını gösterir; `soffice.exe` yolu ayarlardan seçilebilir | MPL-2.0 (ayrı program) |
| pdf-lib | PDF birleştir, böl, döndür, görsel→PDF | npm | MIT |
| pdfjs-dist | PDF→görsel, PDF→metin (arayüz tarafında) | npm | Apache-2.0 |
| marked | Markdown→HTML (sonra LibreOffice ile DOCX/PDF) | npm | MIT |
| fast-xml-parser, yaml | Veri dönüştürme | npm | MIT / ISC |
| fflate | ZIP oluştur/aç, GZIP | npm | MIT |

## Klasör yapısı
```
dosya-donusturucu/
  main.js            Electron ana süreç, güvenlik, IPC (arayüz görevi)
  preload.js         contextBridge API (arayüz görevi)
  arayuz/            index.html, stil.css, uygulama.js, pdf-araclari.js (arayüz görevi)
  src/               dönüştürme çekirdeği, Electron'a bağımlı DEĞİL (çekirdek görevi)
    katalog.js
    yollar.js
    kuyruk.js
    donustur.js
    motorlar/ffmpeg.js, gorsel.js, libreoffice.js, pdf.js, veri.js, arsiv.js, markdown.js
  scripts/ffmpeg-indir.js (çekirdek görevi)
  test/              node:test testleri
  build/icon.png
```

## Çekirdek API sözleşmesi (src/)
Tüm modüller CommonJS, `'use strict'`. Electron'u `require` etmez; böylece `node --test` ile denenir.

### katalog.js
```js
KATEGORILER // [{ id:'video', ad:'Video', simge:'🎬' }, 'ses','gorsel','belge','tablo','sunum','pdf','veri','arsiv']
BICIMLER    // { mp4:{kategori:'video', ad:'MP4'}, ... } uzantı -> bilgi (küçük harf, noktasız)
hedefler(kaynakUzanti) // -> [{ hedef:'mp3', kategori:'ses', motor:'ffmpeg', etiket:'MP3 (ses çıkar)' }, ...]
islemler(kategori)      // kategoriye özgü ek işlemler (ör. video: kırp, boyutlandır, sıkıştır, gif, sesi-çıkar)
```
En az şu biçimler:
- Video: mp4, mkv, avi, mov, webm, wmv, flv, mpg/mpeg, m4v, 3gp, ts, ogv → bunların hepsi + gif + ses biçimleri (ses çıkarma)
- Ses: mp3, wav, flac, aac, m4a, ogg, opus, wma, aiff, ac3, mp2 → bunların hepsi + video (mp4/mpg: siyah ekran ya da kapak görseliyle). "MP3 → MPEG" hem `mp2` (MPEG ses) hem `mpg` (MPEG video) olarak sunulur.
- Görsel: jpg/jpeg, png, webp, avif, tiff/tif, gif, bmp, ico, svg(yalnız giriş) → jpg, png, webp, avif, tiff, gif, bmp, ico, pdf
- Belge: docx, doc, odt, rtf, txt, html/htm, md, pdf → docx, odt, rtf, txt, html, pdf (pdf → docx/odt/txt LibreOffice `writer_pdf_import` ile)
- Tablo: xlsx, xls, ods, csv → xlsx, ods, csv, pdf, html
- Sunum: pptx, ppt, odp → pptx, odp, pdf
- PDF araçları: birleştir, böl (sayfa aralığı), döndür, görsel→PDF, PDF→Word, PDF→görsel ve PDF→metin (arayüzde pdf.js)
- Veri: json, csv, tsv, yaml/yml, xml → json, csv, tsv, yaml, xml
- Arşiv: dosyalardan zip, zip aç, gzip sıkıştır, gz aç

### İş nesnesi
```js
{
  id: 'uuid',
  girdiler: ['C:\\...\\a.mp3'],        // birleştir/zip için birden çok
  hedef: 'mpg',                          // hedef uzantı ya da işlem adı ('birlestir','bol','zip-ac'...)
  ciktiKlasoru: 'C:\\...\\Çıktı',
  secenekler: { kalite:'yuksek'|'orta'|'kucuk', baslangic:'00:00:05', bitis:'00:01:00', genislik:1280,
                sayfalar:'1-3,5', aci:90, kapakGorseli:'...', ... }
}
```
### donustur.js
```js
donustur(is, ortam) // -> Promise<{ ciktilar:[yol...] }>
// ortam = { ffmpegYolu, sofficeYolu, ilerleme:(yuzde)=>{}, sinyal:AbortSignal, geciciKlasor }
```
### kuyruk.js
`new Kuyruk({ esZamanli:2, calistirici:(is, ortam)=>Promise })` EventEmitter; `ekle(is)`, `iptal(id)`, `tumunuIptal()`; olay `'durum'` → `{ id, durum:'bekliyor'|'calisiyor'|'bitti'|'hata'|'iptal', yuzde, ciktilar, hata }`.

### Kurallar (güvenlik ve veri bütünlüğü)
- Harici programlar `child_process.spawn(yol, argDizisi, { shell:false, windowsHide:true })` ile çalışır; asla `shell:true` ya da `exec` yok.
- Girdi yolu `-` ile başlıyorsa ya da FFmpeg'e giderken protokol gibi görünüyorsa (`xxx:`) tam yola çevrilir (FFmpeg için `file:` öneki).
- Var olan dosyanın üzerine asla yazılmaz: `yollar.benzersizYol(klasor, ad, uzanti)` → `ad.mp4`, `ad (1).mp4`, ... FFmpeg'e `-n` verilir.
- Çıktı önce geçici adla yazılır, başarılı olunca son ada taşınır; hata/iptalde yarım dosya silinir (yalnız kendi oluşturduğu geçici dosya).
- ZIP açarken: zip-slip engeli (çıktı klasörü dışına çıkan yol reddedilir), toplam açılmış boyut sınırı (varsayılan 4 GB) ve dosya sayısı sınırı (100.000).
- LibreOffice her işte ayrı geçici profil ile (`-env:UserInstallation=file:///...`) ve zaman aşımıyla (varsayılan 5 dk) çalışır; `--headless --norestore --nolockcheck`.
- İlerleme: FFmpeg `-progress pipe:1 -nostats` çıktısından ve stderr'deki `Duration:` satırından yüzde hesaplanır.
- İptal: AbortSignal gelince alt süreç öldürülür.

## Arayüz
- Solda kategori menüsü: Video, Ses, Görsel, Belge, Tablo, Sunum, PDF Araçları, Veri, Arşiv; altta Geçmiş, Ayarlar, Hakkında ve Lisanslar.
- Her kategoride: sürükle-bırak alanı + "Dosya seç", hedef biçim seçimi (yalnız uygun olanlar), kategoriye özgü ayarlar (kalite, kırpma, boyut, sayfa aralığı...), çıktı klasörü, "Dönüştür".
- Kuyruk listesi: dosya adı, durum, ilerleme çubuğu, iptal, bitince "Klasörde göster".
- LibreOffice yoksa Belge/Tablo/Sunum sayfasında açıklama + resmi indirme sayfasını varsayılan tarayıcıda açan düğme (yalnız `https://www.libreoffice.org/download/download/` sabit adresi).
- Modern, akıcı, açık/koyu tema (sistem temasını izler), Türkçe.
