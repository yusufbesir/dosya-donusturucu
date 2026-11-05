'use strict';
// belgeler veri alanı (TAA tek çatı, T2-B3): göç, yazım, alan yokken eski davranış, boş TAA_VERI_KOK.
// Sahip: Yusuf. yazan: [Claude#dosya-donusturucu-T2 2026-11-05]
// TAA_VERI_KOK ve APPDATA geçici klasöre yönlendirilir; gerçek kullanıcı verisine dokunulmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { olustur } = require('../src/belge-alani');
const veri = require('../taa/taa-veri.js');

const KAYITLAR = [
  { id: 'a1', ad: 'rapor.docx', hedef: 'pdf', durum: 'bitti', ciktilar: ['C:\\x\\rapor.pdf'], hata: '', zaman: 1700000000000 },
  { id: 'a2', ad: 'foto.png', hedef: 'jpg', durum: 'hata', ciktilar: [], hata: 'bozuk', zaman: 1700000001000 }
];

function ortam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'taadon-belge-'));
  const userData = path.join(kok, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  const env = { TAA_VERI_KOK: path.join(kok, 'veri'), APPDATA: path.join(kok, 'appdata'), XDG_DATA_HOME: path.join(kok, 'xdg'), HOME: kok };
  const gunluk = [];
  return { kok, userData, env, gunluk, ac: () => olustur({ userData, surum: '1.12.0', env, gunluk: (m) => gunluk.push(m) }) };
}

test('göç: gecmis.json alana kopyalanır, eskisi .tasindi olur, şema değişmez', () => {
  const o = ortam();
  fs.writeFileSync(path.join(o.userData, 'gecmis.json'), JSON.stringify(KAYITLAR));
  const b = o.ac();
  assert.deepEqual(b.yukle(), KAYITLAR);
  assert.equal(b.durum.kip, 'alan');
  assert.equal(b.durum.goc, 'tasindi');
  assert.ok(!fs.existsSync(path.join(o.userData, 'gecmis.json')));
  assert.ok(fs.existsSync(path.join(o.userData, 'gecmis.json.tasindi')));
  const hedef = path.join(o.env.TAA_VERI_KOK, 'belgeler', 'kayitlar.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(hedef, 'utf8')), KAYITLAR);
  const sahip = veri.sahipTomlCoz(fs.readFileSync(path.join(o.env.TAA_VERI_KOK, 'belgeler', 'SAHIP.toml'), 'utf8'));
  assert.equal(sahip.sahip, 'taadon');
  assert.equal(sahip.gecici, false);
});

test('göç bir kez: ikinci açılışta .tasindi varken yeniden göçmez, alandan okur', () => {
  const o = ortam();
  fs.writeFileSync(path.join(o.userData, 'gecmis.json'), JSON.stringify(KAYITLAR));
  o.ac().yukle();
  fs.writeFileSync(path.join(o.userData, 'gecmis.json'), '[]'); // sonradan bırakılan eski dosya yok sayılır
  const b = o.ac();
  assert.deepEqual(b.yukle(), KAYITLAR);
  assert.equal(b.durum.goc, 'zaten');
});

test('yazım: geçmiş alandan yazılır (atomik), eski yola yazılmaz', () => {
  const o = ortam();
  const b = o.ac();
  assert.deepEqual(b.yukle(), []);
  assert.equal(b.yaz(KAYITLAR), true);
  const alan = path.join(o.env.TAA_VERI_KOK, 'belgeler');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(alan, 'kayitlar.json'), 'utf8')), KAYITLAR);
  assert.ok(!fs.existsSync(path.join(o.userData, 'gecmis.json')));
  assert.ok(!fs.readdirSync(alan).some((f) => f.includes('gecici'))); // geçici dosya kalmadı
  assert.deepEqual(o.ac().yukle(), KAYITLAR); // yeniden açılışta okunur
});

test('alan yokken (yazılamıyor): eski yol ve günlük', () => {
  const o = ortam();
  // TAA_VERI_KOK bir DOSYA: alan klasörü oluşturulamaz
  fs.writeFileSync(o.env.TAA_VERI_KOK, 'dosya');
  fs.writeFileSync(path.join(o.userData, 'gecmis.json'), JSON.stringify(KAYITLAR));
  const b = o.ac();
  assert.deepEqual(b.yukle(), KAYITLAR);
  assert.equal(b.durum.kip, 'eski');
  assert.ok(o.gunluk.length >= 1);
  b.yaz([KAYITLAR[0]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(o.userData, 'gecmis.json'), 'utf8')), [KAYITLAR[0]]);
  assert.ok(!fs.existsSync(path.join(o.userData, 'gecmis.json.tasindi')));
});

test('alan yazımı sonradan başarısız olursa eski yola düşer', () => {
  const o = ortam();
  const b = o.ac();
  b.yukle();
  const alan = path.join(o.env.TAA_VERI_KOK, 'belgeler');
  // kayitlar.json yerine aynı adlı DİZİN: rename başarısız olur
  fs.mkdirSync(path.join(alan, 'kayitlar.json'));
  assert.equal(b.yaz(KAYITLAR), true);
  assert.equal(b.durum.kip, 'eski');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(o.userData, 'gecmis.json'), 'utf8')), KAYITLAR);
  assert.ok(o.gunluk.some((m) => /yazılamadı/.test(m)));
});

test('eski yola düşülen oturumun kayıtları yeniden açılışta alana birleştirilir', () => {
  const o = ortam();
  const b = o.ac();
  b.yukle();
  assert.equal(b.yaz([KAYITLAR[0]]), true); // alana yazıldı
  const alan = path.join(o.env.TAA_VERI_KOK, 'belgeler');
  fs.renameSync(path.join(alan, 'kayitlar.json'), path.join(alan, 'kayitlar.json.kilit'));
  fs.mkdirSync(path.join(alan, 'kayitlar.json')); // alan yazımı başarısız olsun
  assert.equal(b.yaz([KAYITLAR[0], KAYITLAR[1]]), true); // eski yola düştü
  assert.equal(b.durum.kip, 'eski');
  fs.rmdirSync(path.join(alan, 'kayitlar.json')); // test temizliği: boş sahte dizin
  fs.renameSync(path.join(alan, 'kayitlar.json.kilit'), path.join(alan, 'kayitlar.json'));
  const c = o.ac();
  assert.deepEqual(c.yukle(), [KAYITLAR[0], KAYITLAR[1]]); // kalıntı birleştirildi
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(alan, 'kayitlar.json'), 'utf8')), [KAYITLAR[0], KAYITLAR[1]]);
  assert.ok(!fs.existsSync(path.join(o.userData, 'gecmis.json')));
  assert.ok(fs.readdirSync(o.userData).some((a) => a.startsWith('gecmis.json.tasindi-')));
});

test('bozuk gecmis.json: boş geçmişle açılır, hata atmaz', () => {
  const o = ortam();
  fs.writeFileSync(path.join(o.userData, 'gecmis.json'), '{bozuk');
  const b = o.ac();
  assert.deepEqual(b.yukle(), []);
  assert.doesNotThrow(() => b.yaz([]));
});

test('digerleri kaldirilmis: bos TAA_VERI_KOK ile acilis hatasiz; baska sahipte alan salt okunur', () => {
  const o = ortam();
  // boş kök: hiçbir alan, hiçbir program yok
  const b = o.ac();
  assert.doesNotThrow(() => b.yukle());
  assert.deepEqual(b.yukle(), []);
  assert.equal(b.durum.kip, 'alan');
  assert.equal(o.gunluk.length, 0);
  // sahip olunmayan alan (etiket-kuyrugu): okur olarak açılamaz, SahipYok; program yine hatasız
  assert.throws(() => veri.acOkur({ alan: 'etiket-kuyrugu', program: 'taadon', env: o.env }), (e) => e.kod === 'SahipYok');
  // belgeler başka bir asıl sahipteyse: salt okunur, yazma yok, kayıtlar okunur
  const o2 = ortam();
  const dizin = path.join(o2.env.TAA_VERI_KOK, 'belgeler');
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, 'SAHIP.toml'), veri.sahipTomlYaz({ sema: 1, alan: 'belgeler', sahip: 'baska', gecici: false, yazan_surum: '1', son_yazim: '2026-11-05T00:00:00Z' }));
  fs.writeFileSync(path.join(dizin, 'kayitlar.json'), JSON.stringify(KAYITLAR));
  const b2 = o2.ac();
  assert.deepEqual(b2.yukle(), KAYITLAR);
  assert.equal(b2.durum.kip, 'salt-okunur');
  assert.equal(b2.durum.sahip, 'baska');
  // salt okunur: alana dokunulmaz, kendi kayıtlar yerel dosyaya yazılır ve sonraki yüklemede birleşir (geçmiş kaybolmaz)
  const yeni = { ...KAYITLAR[0], id: 'a3' };
  assert.equal(b2.yaz([yeni]), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dizin, 'kayitlar.json'), 'utf8')), KAYITLAR, 'alan dosyası değişmedi');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(o2.userData, 'gecmis.json'), 'utf8')), [yeni]);
  assert.match(b2.durum.not, /salt okunur/);
  assert.deepEqual(o2.ac().yukle(), [KAYITLAR[0], KAYITLAR[1], yeni]);
});

test('güvenlik (orta): alandaki bozuk kayitlar.json eski/ altına taşınır, sonraki yazım bozuk içeriği ezmez', () => {
  const o = ortam();
  const b = o.ac(); b.yukle(); b.yaz(KAYITLAR);
  const alan = path.join(o.env.TAA_VERI_KOK, 'belgeler');
  fs.writeFileSync(path.join(alan, 'kayitlar.json'), '{bozuk');
  const c = o.ac();
  assert.deepEqual(c.yukle(), []);
  assert.equal(c.durum.kip, 'alan');
  assert.ok(!fs.existsSync(path.join(alan, 'kayitlar.json')));
  const eski = fs.readdirSync(path.join(alan, 'eski'));
  assert.ok(eski.some((f) => f.startsWith('kayitlar.json-')), eski.join(','));
  assert.equal(fs.readFileSync(path.join(alan, 'eski', eski.find((f) => f.startsWith('kayitlar.json-'))), 'utf8'), '{bozuk');
  assert.ok(o.gunluk.some((m) => /bozuk/.test(m)));
  assert.equal(c.yaz([KAYITLAR[0]]), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(alan, 'kayitlar.json'), 'utf8')), [KAYITLAR[0]]);
});

test('main.js geçmişi belgeler alanı üzerinden yükler ve yazar', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/src\/belge-alani'\)/);
  assert.match(main, /belgeler\.yukle\(\)/);
  assert.equal((main.match(/gecmisiYaz\(\);/g) || []).length, 3);
  assert.doesNotMatch(main, /jsonYaz\(gecmisYolu/);
});

test('program.toml: taadon, belgeler sahibi', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'program.toml'), 'utf8');
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  assert.match(t, /^ad = "taadon"$/m);
  assert.match(t, new RegExp(`^surum = "${s.replace(/\./g, '\\.')}"$`, 'm'));
  assert.match(t, /^veri_sahibi = \["belgeler"\]/m);
  assert.match(t, /^gerektirir = \{ taa-donustur = "1" \}$/m);
});
