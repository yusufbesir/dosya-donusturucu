'use strict';
// kuyruk.js: TaaDön dönüştürme iş kuyruğu (eşzamanlılık sınırı, durum olayları, iptal).
// Sahip: Yusuf (TaaDön projesi). Değişiklik: Yusuf'un kuralları (ORTAK-AJAN-KURALLARI.md) çerçevesinde.
// yazan: [Claude#inceleme-duzeltme 2026-11-04] emit güvenliği, iptal sonrası çıktılar, bitenleriTemizle, ekle kopyası.

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

class Kuyruk extends EventEmitter {
  /**
   * @param {{esZamanli?:number, calistirici:(is:object, ortam:object)=>Promise<any>, ortam?:object}} secenek
   */
  constructor({ esZamanli = 2, calistirici, ortam = {} } = {}) {
    super();
    if (typeof calistirici !== 'function') throw new TypeError('calistirici bir fonksiyon olmalı.');
    this.esZamanli = Math.max(1, Math.floor(Number(esZamanli)) || 1);
    this.calistirici = calistirici;
    this.temelOrtam = ortam;
    this._bekleyen = [];
    this._kayitlar = new Map(); // id -> { is, durum, yuzde, ciktilar, hata, kontrol }
    this._calisan = 0;
    this._bosBekleyenler = [];
  }

  _yay(kayit) {
    // Dinleyici istisnası kuyruğun iç durumunu bozmamalı (ör. _siradaki atlanmasın).
    try {
      this.emit('durum', {
        id: kayit.is.id,
        durum: kayit.durum,
        yuzde: kayit.yuzde,
        ciktilar: kayit.ciktilar,
        hata: kayit.hata,
      });
    } catch (e) {
      console.error('Kuyruk durum dinleyicisi hata verdi:', e);
    }
  }

  ekle(is) {
    if (!is || typeof is !== 'object') throw new TypeError('Geçersiz iş.');
    // Çağıranın nesnesi değiştirilmez; kuyruk kendi sığ kopyasıyla çalışır.
    is = { ...is, id: is.id || crypto.randomUUID() };
    if (this._kayitlar.has(is.id)) throw new Error(`Bu kimlikle bir iş zaten var: ${is.id}`);
    const kayit = { is, durum: 'bekliyor', yuzde: 0, ciktilar: [], hata: null, kontrol: new AbortController() };
    this._kayitlar.set(is.id, kayit);
    this._bekleyen.push(kayit);
    this._yay(kayit);
    setImmediate(() => this._siradaki());
    return is.id;
  }

  durumu(id) {
    const k = this._kayitlar.get(id);
    return k ? { id, durum: k.durum, yuzde: k.yuzde, ciktilar: k.ciktilar, hata: k.hata } : null;
  }

  liste() {
    return [...this._kayitlar.values()].map((k) => this.durumu(k.is.id));
  }

  iptal(id) {
    const k = this._kayitlar.get(id);
    if (!k) return false;
    if (k.durum === 'bekliyor') {
      this._bekleyen = this._bekleyen.filter((x) => x !== k);
      k.durum = 'iptal';
      this._yay(k);
      this._bosKontrol();
      return true;
    }
    if (k.durum === 'calisiyor') {
      k.iptalIstendi = true;
      k.kontrol.abort();
      return true;
    }
    return false;
  }

  /**
   * Bitmiş (bitti/hata/iptal) işlerin kayıtlarını siler. idler verilirse yalnız onlar, verilmezse hepsi.
   * @param {string[]} [idler]
   * @returns {string[]} silinen kimlikler
   */
  bitenleriTemizle(idler) {
    const bitmis = new Set(['bitti', 'hata', 'iptal']);
    const adaylar = Array.isArray(idler) ? idler : [...this._kayitlar.keys()];
    const silinen = [];
    for (const id of adaylar) {
      const k = this._kayitlar.get(id);
      if (k && bitmis.has(k.durum)) {
        this._kayitlar.delete(id);
        silinen.push(id);
      }
    }
    return silinen;
  }

  tumunuIptal() {
    for (const k of [...this._kayitlar.values()]) this.iptal(k.is.id);
  }

  /** Bekleyen ve çalışan iş kalmayınca çözülür. */
  bosBekle() {
    if (this._bosMu()) return Promise.resolve();
    return new Promise((coz) => this._bosBekleyenler.push(coz));
  }

  _bosMu() {
    return this._calisan === 0 && this._bekleyen.length === 0;
  }

  _bosKontrol() {
    if (!this._bosMu()) return;
    const l = this._bosBekleyenler.splice(0);
    for (const c of l) c();
  }

  _siradaki() {
    while (this._calisan < this.esZamanli && this._bekleyen.length > 0) {
      const kayit = this._bekleyen.shift();
      this._calisan += 1;
      this._calistir(kayit);
    }
    this._bosKontrol();
  }

  async _calistir(kayit) {
    kayit.durum = 'calisiyor';
    this._yay(kayit);
    const ilerleme = (yuzde) => {
      if (kayit.durum !== 'calisiyor') return;
      const y = Math.max(0, Math.min(100, Math.floor(Number(yuzde) || 0)));
      if (y === kayit.yuzde) return;
      kayit.yuzde = y;
      this._yay(kayit);
    };
    try {
      const ortam = { ...this.temelOrtam, ilerleme, sinyal: kayit.kontrol.signal };
      const sonuc = await this.calistirici(kayit.is, ortam);
      const ciktilar = (sonuc && Array.isArray(sonuc.ciktilar)) ? sonuc.ciktilar : [];
      // İptal istendiği halde çalıştırıcı normal bitip çıktı ürettiyse, bu dosyalar diskte
      // gerçekten vardır; atılırlarsa izlenmeyen artık kalır. Bu yüzden iş 'bitti' sayılır.
      // Çıktı yoksa iptal kabul edilir.
      if ((kayit.iptalIstendi || kayit.kontrol.signal.aborted) && ciktilar.length === 0) {
        kayit.durum = 'iptal';
      } else {
        kayit.durum = 'bitti';
        kayit.yuzde = 100;
        kayit.ciktilar = ciktilar;
      }
    } catch (e) {
      if (kayit.iptalIstendi || kayit.kontrol.signal.aborted || (e && e.iptal)) {
        kayit.durum = 'iptal';
      } else {
        kayit.durum = 'hata';
        kayit.hata = (e && e.message) || String(e);
      }
    } finally {
      this._calisan -= 1;
      try {
        this._yay(kayit);
      } finally {
        this._siradaki();
      }
    }
  }
}

module.exports = { Kuyruk };
