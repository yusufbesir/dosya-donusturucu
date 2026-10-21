'use strict';
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
  hedefler: (uzanti) => cagir('hedefler', String(uzanti)),
  dosyaSec: (kategori, coklu) => cagir('dosya-sec', String(kategori), !!coklu),
  klasorSec: () => cagir('klasor-sec'),
  yolAl: async (dosya) => {
    const yol = webUtils.getPathForFile(dosya);
    if (!yol) throw new Error('Dosya yolu alınamadı.');
    return cagir('yol-bildir', yol);
  },
  isEkle: (is) => cagir('is-ekle', is),
  iptal: (id) => cagir('iptal', String(id)),
  tumunuIptal: () => cagir('tumunu-iptal'),
  klasordeGoster: (yol) => cagir('klasorde-goster', String(yol)),
  ayarlarAl: () => cagir('ayarlar-al'),
  ayarKaydet: (anahtar, deger) => cagir('ayar-kaydet', String(anahtar), deger),
  libreofficeDurumu: () => cagir('libreoffice-durumu'),
  calibreDurumu: () => cagir('calibre-durumu'),
  libreofficeIndirmeSayfasi: () => cagir('libreoffice-indirme'),
  pdfOku: (yol) => cagir('pdf-oku', String(yol)),
  pdfSayfaKaydet: (o) => cagir('pdf-sayfa-kaydet', o),
  metinKaydet: (o) => cagir('metin-kaydet', o),
  durumDinle: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const dinleyici = (_e, d) => cb(d);
    ipcRenderer.on('durum', dinleyici);
    return () => ipcRenderer.removeListener('durum', dinleyici);
  }
}));
