'use strict';
// Ne: TaaDön 1.6.0 T2 testleri: çıktı soneki (benzersiz ad, (n)), Özgün klasörüne taşıma (silme yok), çıktı doğrulama
//     (boş/imza tutmayan çıktı -> Türkçe hata + .bozuk eki), imza eşlemeleri, OneDrive "yalnız bulutta" denetimi,
//     uzantı küçültmenin Türkçe yerel ayardan bağımsızlığı.
// Sahibi: Dosya dönüştürücü (TaaDön) işi. yazan: [Claude#taadon-T2]
// Değiştirme kuralı: src/donustur.js ya da src/yollar.js davranışı değişince birlikte güncellenir. Test geçici
// klasörleri işletim sisteminin geçici klasöründe (dd-t2-*) bırakılır, kalıcı silinmez; silme yalnız Yusuf'un kararıyla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yollar = require('../src/yollar');
const {
  donustur, ciktiGecerli, ciktilariDogrula, ozgunleriTasi, bulutDenetle, CIKTI_IMZALARI, CIKTI_BOZUK, BULUT_DOSYASI,
} = require('../src/donustur');

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dd-t2-'));
}
function yaz(yol, icerik) {
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  fs.writeFileSync(yol, icerik);
  return yol;
}
const ortam = (ek = {}) => ({ ilerleme: () => {}, ...ek });

test('sonek: govde<sonek>.uzanti, çakışmada (n), var olan dosyanın üzerine yazılmaz', async () => {
  const k = gecici();
  const a = yaz(path.join(k, 'rapor.pdf'), '%PDF-1 a');
  const yeni = await yollar.sonekEkle(a, '_v2');
  assert.equal(yeni, path.join(k, 'rapor_v2.pdf'));
  assert.equal(fs.readFileSync(yeni, 'utf8'), '%PDF-1 a');
  assert.equal(fs.existsSync(a), false);

  const b = yaz(path.join(k, 'rapor.pdf'), '%PDF-1 b');
  const yeni2 = await yollar.sonekEkle(b, '_v2');
  assert.equal(yeni2, path.join(k, 'rapor_v2 (1).pdf'));
  assert.equal(fs.readFileSync(yeni, 'utf8'), '%PDF-1 a', 'ilk dosya korunmalı');
  assert.equal(fs.readFileSync(yeni2, 'utf8'), '%PDF-1 b');
});

test('sonek: klasör çıktısına ad sonuna eklenir; geçersiz sonek reddedilir', async () => {
  const k = gecici();
  const d = path.join(k, 'arsiv');
  fs.mkdirSync(d);
  yaz(path.join(d, 'i.txt'), 'x');
  const yeni = await yollar.sonekEkle(d, ' son');
  assert.equal(yeni, path.join(k, 'arsiv son'));
  assert.equal(fs.readFileSync(path.join(yeni, 'i.txt'), 'utf8'), 'x');
  for (const s of ['a/b', 'x'.repeat(21), 'ç', 'a:b', '', 5]) assert.equal(yollar.sonekGecerli(s), false, String(s));
  for (const s of ['_v2', ' kopya', 'a.b-c', 'X'.repeat(20)]) assert.equal(yollar.sonekGecerli(s), true, s);
  await assert.rejects(yollar.sonekEkle(path.join(yeni, 'i.txt'), '../x'), /soneki geçersiz/);
});

test('donustur: zip işine sonek uygulanır, ozgunTasi girdiyi Özgün klasörüne taşır (silme yok)', async () => {
  const k = gecici();
  const girdi = yaz(path.join(k, 'not.txt'), 'merhaba');
  const cikti = path.join(k, 'cikti');
  const s = await donustur({ id: 't2', girdiler: [girdi], hedef: 'zip', ciktiKlasoru: cikti, secenekler: {}, sonek: '_yedek', ozgunTasi: true }, ortam());
  assert.deepEqual(s.ciktilar, [path.join(cikti, 'not_yedek.zip')]);
  assert.equal(fs.readFileSync(s.ciktilar[0]).subarray(0, 2).toString('latin1'), 'PK');
  const hedef = path.join(k, yollar.OZGUN_KLASOR, 'not.txt');
  assert.deepEqual(s.tasinanlar, [{ kaynak: girdi, hedef }]);
  assert.deepEqual(s.uyarilar, []);
  assert.equal(fs.existsSync(girdi), false);
  assert.equal(fs.readFileSync(hedef, 'utf8'), 'merhaba');
});

test('donustur: sonek/ozgunTasi verilmezse davranış eski gibi; geçersiz sonek iş başlamadan reddedilir', async () => {
  const k = gecici();
  const girdi = yaz(path.join(k, 'a.txt'), 'x');
  const s = await donustur({ girdiler: [girdi], hedef: 'zip', ciktiKlasoru: k }, ortam());
  assert.deepEqual(s.ciktilar, [path.join(k, 'a.zip')]);
  assert.deepEqual(s.tasinanlar, []);
  assert.equal(fs.existsSync(girdi), true);
  await assert.rejects(donustur({ girdiler: [girdi], hedef: 'zip', ciktiKlasoru: k, sonek: 'a\\b' }, ortam()), /soneki geçersiz/);
});

test('ozgunleriTasi: Özgün içinde ad çakışırsa (n); çıktıyla aynı dosya ve klasör atlanır', async () => {
  const k = gecici();
  const ozgun = path.join(k, yollar.OZGUN_KLASOR);
  yaz(path.join(ozgun, 'a.txt'), 'eski');
  const a = yaz(path.join(k, 'a.txt'), 'yeni');
  const c = yaz(path.join(k, 'c.png'), 'c');
  const d = path.join(k, 'klasor');
  fs.mkdirSync(d);
  const { tasinanlar, uyarilar } = await ozgunleriTasi([a, a, c, d], [c]);
  assert.deepEqual(tasinanlar, [{ kaynak: a, hedef: path.join(ozgun, 'a (1).txt') }]);
  assert.equal(fs.readFileSync(path.join(ozgun, 'a.txt'), 'utf8'), 'eski');
  assert.equal(fs.readFileSync(path.join(ozgun, 'a (1).txt'), 'utf8'), 'yeni');
  assert.equal(fs.existsSync(c), true);
  assert.equal(fs.existsSync(d), true);
  assert.equal(uyarilar.length, 2);
  assert.match(uyarilar[0], /çıktıyla aynı dosya/);
  assert.match(uyarilar[1], /klasör taşınmadı/);
});

test('çıktı doğrulama: imza eşlemeleri', async () => {
  const k = gecici();
  const ornek = {
    pdf: Buffer.from('%PDF-1.7\n'),
    docx: Buffer.from('PK\x03\x04', 'latin1'),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
    jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    gif: Buffer.from('GIF89a'),
  };
  for (const u of ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'zip']) assert.deepEqual(CIKTI_IMZALARI[u], [0x50, 0x4b], u);
  for (const [u, b] of Object.entries(ornek)) {
    assert.equal(await ciktiGecerli(yaz(path.join(k, `iyi.${u}`), b)), true, u);
    assert.equal(await ciktiGecerli(yaz(path.join(k, `kotu.${u}`), Buffer.from('<html>'))), false, u);
  }
  assert.equal(await ciktiGecerli(yaz(path.join(k, 'BUYUK.PDF'), '%PDF-1')), true, 'büyük harf uzantı');
  assert.equal(await ciktiGecerli(yaz(path.join(k, 'k.jpeg'), Buffer.from([0xff, 0xd8, 0xff]))), true);
  for (const u of ['mp3', 'mp4', 'wav', 'webm', 'mkv']) {
    assert.equal(await ciktiGecerli(yaz(path.join(k, `s.${u}`), 'herhangi')), true, `${u} yalnız boyut`);
    assert.equal(await ciktiGecerli(yaz(path.join(k, `bos.${u}`), '')), false, `${u} boş`);
  }
  assert.equal(await ciktiGecerli(path.join(k, 'yok.pdf')), false);
  assert.equal(await ciktiGecerli(k), true, 'klasör çıktı denetlenmez');
});

test('çıktı doğrulama: boş/bozuk çıktı -> Türkçe hata, dosya .bozuk ekiyle yeniden adlandırılır (silinmez)', async () => {
  const k = gecici();
  const iyi = yaz(path.join(k, 'iyi.pdf'), '%PDF-1');
  const bos = yaz(path.join(k, 'bos.pdf'), '');
  const kotu = yaz(path.join(k, 'kotu.png'), 'degil');
  yaz(path.join(k, 'kotu.png.bozuk'), 'onceki');
  await assert.rejects(ciktilariDogrula([iyi, bos, kotu]), (e) => {
    assert.equal(e.message, CIKTI_BOZUK);
    assert.deepEqual(e.bozukCiktilar, [path.join(k, 'bos.pdf.bozuk'), path.join(k, 'kotu.png (1).bozuk')]);
    return true;
  });
  assert.equal(fs.existsSync(iyi), true);
  assert.equal(fs.existsSync(bos), false);
  assert.equal(fs.statSync(path.join(k, 'bos.pdf.bozuk')).size, 0);
  assert.equal(fs.readFileSync(path.join(k, 'kotu.png (1).bozuk'), 'utf8'), 'degil');
  assert.equal(fs.readFileSync(path.join(k, 'kotu.png.bozuk'), 'utf8'), 'onceki');
  await ciktilariDogrula([iyi]); // hata yok
});

test('bulut denetimi: ilk bayt zaman aşımında ya da UNKNOWN hatasında Türkçe mesaj; normal dosya geçer', async () => {
  const k = gecici();
  const f = yaz(path.join(k, 'b.docx'), 'PK..');
  const st = fs.statSync(f);
  await assert.rejects(bulutDenetle(f, st, { zamanAsimiMs: 30, okuyucu: () => new Promise(() => {}) }), { message: BULUT_DOSYASI });
  await assert.rejects(bulutDenetle(f, st, { okuyucu: async () => { const e = new Error('x'); e.code = 'UNKNOWN'; throw e; } }), { message: BULUT_DOSYASI });
  await bulutDenetle(f, st, { okuyucu: async () => { const e = new Error('x'); e.code = 'EACCES'; throw e; } }); // motor kendi hatasını verir
  await bulutDenetle(f, st); // gerçek okuma
  await bulutDenetle(yaz(path.join(k, 'bos.txt'), ''), fs.statSync(path.join(k, 'bos.txt')), { okuyucu: () => new Promise(() => {}), zamanAsimiMs: 10 });
});

test('uzantı küçültme yerel ayardan bağımsız (TIF/PDF, I -> i)', () => {
  assert.equal(yollar.uzantiAl('C:\\x\\FOTO.TIF'), 'tif');
  assert.equal(yollar.uzantiAl('BELGE.PDF'), 'pdf');
  assert.equal(yollar.uzantiAl('ŞİİR.TXT'), 'txt');
  assert.notEqual('TIF'.toLocaleLowerCase('tr'), 'tif'); // neden toLocaleLowerCase kullanılmadığının kanıtı
});
