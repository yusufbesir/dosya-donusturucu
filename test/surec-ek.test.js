'use strict';
// surec-ek.test.js: surec.js (sert süre, geri çağrı istisnası, zamanAsimi) ve kuyruk.js (dinleyici istisnası,
// iptal sonrası çıktı, bitenleriTemizle, ekle kopyası) ek testleri. Sahip: Yusuf (TaaDön).
// yazan: [Claude#inceleme-duzeltme 2026-11-04]. Yusuf'un kuralları (ORTAK-AJAN-KURALLARI.md) çerçevesinde değiştirilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calistir, zamanAsimiDuzelt } = require('../src/surec');
const { Kuyruk } = require('../src/kuyruk');

test('surec: zaman aşımı sonsuz süreci öldürür ve 8 s içinde döner', { timeout: 15000 }, async () => {
  const t0 = Date.now();
  await assert.rejects(
    calistir(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { zamanAsimi: 1000 }),
    (e) => e.zamanAsimi === true,
  );
  assert.ok(Date.now() - t0 < 8000, `süre: ${Date.now() - t0} ms`);
});

test('surec: stdoutVeri geri çağrısı fırlatınca reddeder', { timeout: 15000 }, async () => {
  await assert.rejects(
    calistir(process.execPath, ['-e', 'setInterval(()=>console.log("x"),50)'], {
      stdoutVeri: () => { throw new Error('geri-cagri-patladi'); },
    }),
    /geri-cagri-patladi/,
  );
});

test('surec: zamanAsimi aralık denetimi', () => {
  assert.equal(zamanAsimiDuzelt(undefined), null);
  assert.equal(zamanAsimiDuzelt(NaN), null);
  assert.equal(zamanAsimiDuzelt(Infinity), null);
  assert.equal(zamanAsimiDuzelt(-5), null);
  assert.equal(zamanAsimiDuzelt('abc'), null);
  assert.equal(zamanAsimiDuzelt(10), 1000);
  assert.equal(zamanAsimiDuzelt(5000), 5000);
  assert.equal(zamanAsimiDuzelt(1e12), 2 ** 31 - 1);
});

test('kuyruk: dinleyici fırlatınca sonraki iş yine başlar', { timeout: 10000 }, async (t) => {
  const asil = console.error;
  console.error = () => {};
  t.after(() => { console.error = asil; });
  const baslayan = [];
  const k = new Kuyruk({
    esZamanli: 1,
    calistirici: async (is) => { baslayan.push(is.id); return { ciktilar: [is.id] }; },
  });
  k.on('durum', (d) => { if (d.durum === 'bitti') throw new Error('dinleyici patladi'); });
  k.ekle({ id: 'a' });
  k.ekle({ id: 'b' });
  await k.bosBekle();
  assert.deepEqual(baslayan, ['a', 'b']);
  assert.equal(k.durumu('b').durum, 'bitti');
});

test('kuyruk: iptal sonrası çıktı dönen iş bitti sayılır; çıktısız iptal kalır', async () => {
  const k = new Kuyruk({
    esZamanli: 2,
    calistirici: async (is) => {
      await new Promise((r) => setTimeout(r, 50));
      return { ciktilar: is.cikti ? ['dosya.out'] : [] };
    },
  });
  k.ekle({ id: 'c', cikti: true });
  k.ekle({ id: 'd', cikti: false });
  await new Promise((r) => setTimeout(r, 10));
  k.iptal('c'); k.iptal('d');
  await k.bosBekle();
  assert.equal(k.durumu('c').durum, 'bitti');
  assert.deepEqual(k.durumu('c').ciktilar, ['dosya.out']);
  assert.equal(k.durumu('d').durum, 'iptal');
});

test('kuyruk: ekle nesneyi değiştirmez; bitenleriTemizle', async () => {
  const k = new Kuyruk({ esZamanli: 1, calistirici: async () => ({ ciktilar: [] }) });
  const is = { girdi: 'x' };
  const id = k.ekle(is);
  assert.equal(is.id, undefined);
  k.ekle({ id: 'e' });
  await k.bosBekle();
  assert.deepEqual(k.bitenleriTemizle([id, 'yok']), [id]);
  assert.equal(k.durumu(id), null);
  assert.deepEqual(k.bitenleriTemizle(), ['e']);
  assert.deepEqual(k.liste(), []);
});
