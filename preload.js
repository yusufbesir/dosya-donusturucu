'use strict';
// TaaDön preload köprüsü. Sahip: Yusuf. yazan: [Claude#taadon]; 1.9.0 onizle/isitmaIste: [Claude#taadon-1.9-paket-c 2026-11-04]
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Ana süreçten gelen "Error invoking remote method ...: Error: " önekini kaldırır.
async function cagir(kanal, ...a) {
  try {
    return await ipcRenderer.invoke(kanal, ...a);
  } catch (e) {
    const m = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    throw new Error(m);
  }
}

contextBridge.exposeInMainWorld('donusturucu', Object.freeze({
  kategoriler: () => cagir('kategoriler'),
  bicimBilgi: (uzanti) => cagir('bicim-bilgi', String(uzanti)),
  hedefler: (uzanti) => cagir('hedefler', String(uzanti)),
  dosyaSec: (kategori, coklu) => cagir('dosya-sec', String(kategori), !!coklu),
  klasorSec: () => cagir('klasor-sec'),
  yolAl: async (dosya) => {
    const yol = webUtils.getPathForFile(dosya);
    if (!yol) throw new Error('Dosya yolu alınamadı.');
    return cagir('yol-bildir', yol);
  },
  // Pano (1.9.0): yolu olan dosya için yol, yoksa '' (ekran görüntüsü gibi); PNG baytını geçici dosyaya yazdırır
  dosyaYolu: (dosya) => { try { return webUtils.getPathForFile(dosya) || ''; } catch { return ''; } },
  panoGorseliKaydet: (bayt) => cagir('pano-gorseli-kaydet', bayt),
  bicimAlgila: (yol) => cagir('bicim-algila', String(yol)),
  boyutTahmini: (yollar, kategori, hedef) => cagir('boyut-tahmini', { yollar: Array.isArray(yollar) ? yollar.map(String) : [], kategori: String(kategori || ''), hedef: String(hedef || '') }),
  onizle: (yol) => cagir('onizle', String(yol)),
  isitmaIste: () => cagir('isitma-iste'),
  isEkle: (is) => cagir('is-ekle', is),
  iptal: (id) => cagir('iptal', String(id)),
  isYenidenDene: (id) => cagir('is-yeniden-dene', String(id)),
  tumunuIptal: () => cagir('tumunu-iptal'),
  klasordeGoster: (yol) => cagir('klasorde-goster', String(yol)),
  ciktiyiAc: (yol) => cagir('ciktiyi-ac', String(yol)),
  ayarlarAl: () => cagir('ayarlar-al'),
  ayarKaydet: (anahtar, deger) => cagir('ayar-kaydet', String(anahtar), deger),
  gecmisTemizle: () => cagir('gecmis-temizle'),
  libreofficeDurumu: () => cagir('libreoffice-durumu'),
  calibreDurumu: () => cagir('calibre-durumu'),
  libreofficeIndirmeSayfasi: () => cagir('libreoffice-indirme'),
  pdfOku: (yol) => cagir('pdf-oku', String(yol)),
  pdfSayfaKaydet: (o) => cagir('pdf-sayfa-kaydet', o),
  metinKaydet: (o) => cagir('metin-kaydet', o),
  // Yönetici paneli (1.10.0): kilit main'de; PIN yalnız karşılaştırma için gönderilir, saklanmaz. [Claude#taadon-1.10-yonetici 2026-11-04]
  yoneticiKilitAc: (pin) => cagir('yonetici-kilit-ac', String(pin)),
  yoneticiKilitle: () => cagir('yonetici-kilitle'),
  yoneticiPinBelirle: (yeniPin, eskiPin) => cagir('yonetici-pin-belirle', String(yeniPin), eskiPin == null ? '' : String(eskiPin)),
  yoneticiDurum: () => cagir('yonetici-durum'),
  taniOlustur: () => cagir('tani-olustur'),
  durumDinle: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const dinleyici = (_e, d) => cb(d);
    ipcRenderer.on('durum', dinleyici);
    return () => ipcRenderer.removeListener('durum', dinleyici);
  },
  // Sağ tık / komut satırı ile gelen dosya yolları (ana süreç izinliDosyalar'a ekledi). Tek dinleyici: yeni
  // çağrı öncekini kaldırır. Dönen işlev dinleyiciyi kaldırır.
  dosyalarDinle: (cb) => {
    ipcRenderer.removeAllListeners('dosyalar-eklendi');
    if (typeof cb !== 'function') return () => {};
    const dinleyici = (_e, yollar) => {
      if (Array.isArray(yollar)) cb(yollar.filter((y) => typeof y === 'string'));
    };
    ipcRenderer.on('dosyalar-eklendi', dinleyici);
    return () => ipcRenderer.removeListener('dosyalar-eklendi', dinleyici);
  }
}));
