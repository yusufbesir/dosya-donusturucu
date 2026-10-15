'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { donustur } = require('../src/donustur');
const { Kuyruk } = require('../src/kuyruk');
const y = require('./yardimci');

test('iptal: uzun FFmpeg işi iptal edilir, yarım dosya kalmaz', { timeout: 60000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const uzun = path.join(g, 'uzun.wav');
  y.ffmpegCalistir(['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '3600', uzun]);
  const ac = new AbortController();
  const p = donustur({ id: 'u', girdiler: [uzun], hedef: 'mp4', ciktiKlasoru: c, secenekler: { kalite: 'yuksek' } },
    y.ortam({ sinyal: ac.signal }));
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(y.ls(c).some((d) => d.startsWith('.~')), 'iş sırasında geçici dosya olmalı');
  const t0 = Date.now();
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 10000);
  assert.deepEqual(y.ls(c), []);
});

test('iptal: Kuyruk ile çalışan iş iptal -> durum iptal, çıktı klasörü boş', { timeout: 60000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const uzun = path.join(g, 'uzun.wav');
  y.ffmpegCalistir(['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '3600', uzun]);
  const k = new Kuyruk({ esZamanli: 2, ortam: y.ortam(), calistirici: (is, ortam) => donustur(is, ortam) });
  const durumlar = [];
  k.on('durum', (d) => durumlar.push(d));
  k.ekle({ id: 'u1', girdiler: [uzun], hedef: 'mpg', ciktiKlasoru: c, secenekler: {} });
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(k.iptal('u1'));
  await k.bosBekle();
  assert.equal(durumlar[durumlar.length - 1].durum, 'iptal');
  assert.deepEqual(y.ls(c), []);
});

test('iptal: başarısız FFmpeg işi yarım dosya bırakmaz ve hata iletir', { timeout: 30000 }, async (t) => {
  const g = y.gecici();
  const c = y.gecici();
  t.after(() => y.temizle(g, c));
  const sahte = path.join(g, 'bozuk.mp3');
  fs.writeFileSync(sahte, 'bu bir ses dosyası değil');
  await assert.rejects(donustur({ id: 'b', girdiler: [sahte], hedef: 'wav', ciktiKlasoru: c, secenekler: {} }, y.ortam()), /FFmpeg hatası/);
  assert.deepEqual(y.ls(c), []);
  await assert.rejects(donustur({ id: 'b', girdiler: [path.join(g, 'yok.mp3')], hedef: 'wav', ciktiKlasoru: c }, y.ortam()), /bulunamadı/);
  await assert.rejects(donustur({ id: 'b', girdiler: [sahte], hedef: 'docx', ciktiKlasoru: c }, y.ortam()), /desteklenmiyor/);
});
