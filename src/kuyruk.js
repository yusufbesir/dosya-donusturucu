'use strict';

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
    this.emit('durum', {
      id: kayit.is.id,
      durum: kayit.durum,
      yuzde: kayit.yuzde,
      ciktilar: kayit.ciktilar,
      hata: kayit.hata,
    });
  }

  ekle(is) {
    if (!is || typeof is !== 'object') throw new TypeError('Geçersiz iş.');
    if (!is.id) is.id = crypto.randomUUID();
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
      if (kayit.iptalIstendi || kayit.kontrol.signal.aborted) {
        kayit.durum = 'iptal';
      } else {
        kayit.durum = 'bitti';
        kayit.yuzde = 100;
        kayit.ciktilar = (sonuc && sonuc.ciktilar) || [];
      }
    } catch (e) {
      if (kayit.iptalIstendi || kayit.kontrol.signal.aborted || (e && e.iptal)) {
        kayit.durum = 'iptal';
      } else {
        kayit.durum = 'hata';
        kayit.hata = (e && e.message) || String(e);
      }
    }
    this._calisan -= 1;
    this._yay(kayit);
    this._siradaki();
  }
}

module.exports = { Kuyruk };
