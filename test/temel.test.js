'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Kuyruk } = require('../src/kuyruk');
const katalog = require('../src/katalog');
const yollar = require('../src/yollar');
const { sofficeBul } = require('../src/motorlar/libreoffice');
const { sayfaListesi } = require('../src/motorlar/pdf');
const { guvenliYol } = require('../src/motorlar/arsiv');
const { komutOlustur, sureSaniye } = require('../src/motorlar/ffmpeg');
const y = require('./yardimci');

test('katalog: mp3 -> mpg ve mp2 sunulur, motor ffmpeg', () => {
  const h = katalog.hedefler('mp3');
  assert.ok(h.find((x) => x.hedef === 'mpg' && x.kategori === 'video' && x.motor === 'ffmpeg'));
  assert.ok(h.find((x) => x.hedef === 'mp2' && x.kategori === 'ses'));
  assert.ok(!h.find((x) => x.hedef === 'mp3'));
});

test('katalog: kategori ve biçim kapsamı', () => {
  assert.deepEqual(katalog.KATEGORILER.map((k) => k.id), ['video', 'ses', 'gorsel', 'belge', 'tablo', 'sunum', 'pdf', 'veri', 'arsiv']);
  for (const u of ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', '3gp', 'ts', 'ogv',
    'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'ac3', 'mp2', 'jpg', 'jpeg', 'png', 'webp', 'avif',
    'tiff', 'tif', 'gif', 'bmp', 'ico', 'svg', 'docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm', 'md', 'pdf', 'xlsx',
    'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp', 'json', 'tsv', 'yaml', 'yml', 'xml', 'zip', 'gz']) {
    assert.ok(katalog.BICIMLER[u], u);
  }
  assert.ok(katalog.hedefler('mp4').find((x) => x.hedef === 'gif'));
  assert.ok(katalog.hedefler('mp4').find((x) => x.hedef === 'mp3' && /ses çıkar/.test(x.etiket)));
  assert.ok(!katalog.hedefler('svg').find((x) => x.hedef === 'svg'));
  assert.ok(katalog.hedefler('pdf').map((x) => x.hedef).includes('docx'));
  assert.ok(katalog.hedefler('csv').map((x) => x.hedef).includes('xlsx'));
  assert.ok(katalog.hedefler('csv').map((x) => x.hedef).includes('json'));
  assert.deepEqual(katalog.hedefler('bilinmeyen'), []);
  assert.ok(katalog.islemler('video').map((i) => i.id).includes('sesi-cikar'));
});

test('yollar: benzersizYol var olan dosyayı atlar', () => {
  const d = y.gecici();
  try {
    assert.equal(path.basename(yollar.benzersizYol(d, 'a', 'mp4')), 'a.mp4');
    fs.writeFileSync(path.join(d, 'a.mp4'), 'x');
    assert.equal(path.basename(yollar.benzersizYol(d, 'a', 'mp4')), 'a (1).mp4');
    fs.writeFileSync(path.join(d, 'a (1).mp4'), 'x');
    assert.equal(path.basename(yollar.benzersizYol(d, 'a', 'mp4')), 'a (2).mp4');
  } finally { y.temizle(d); }
});

test('yollar: tasiBenzersiz üzerine yazmaz', async () => {
  const d = y.gecici();
  try {
    fs.writeFileSync(path.join(d, 'a.txt'), 'ESKI');
    const g = yollar.geciciYol(d, 'a', 'txt');
    fs.writeFileSync(g, 'YENI');
    const son = await yollar.tasiBenzersiz(g, d, 'a', 'txt');
    assert.equal(path.basename(son), 'a (1).txt');
    assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'ESKI');
    assert.equal(fs.readFileSync(son, 'utf8'), 'YENI');
    assert.ok(!fs.existsSync(g));
  } finally { y.temizle(d); }
});

test('yollar: guvenliUret hata olunca geçici dosyayı siler, diğer dosyalara dokunmaz', async () => {
  const d = y.gecici();
  try {
    fs.writeFileSync(path.join(d, 'baska.txt'), 'dokunma');
    await assert.rejects(yollar.guvenliUret(d, 'a', 'txt', async (g) => { fs.writeFileSync(g, 'yarim'); throw new Error('patladi'); }), /patladi/);
    assert.deepEqual(y.ls(d), ['baska.txt']);
  } finally { y.temizle(d); }
});

test('yollar: girdi yolu "-" ile başlıyorsa ve protokol benziyorsa tam yola çevrilir', () => {
  assert.ok(path.isAbsolute(yollar.girdiYolu('-i')));
  assert.ok(yollar.ffmpegAdresi('http://x/y').startsWith('file:/'));
  assert.ok(yollar.ffmpegAdresi('concat:a|b').startsWith('file:'));
  assert.throws(() => yollar.girdiYolu('a\u0000b'));
});

test('yollar: ffmpegYolunuBul', () => {
  const d = y.gecici();
  try {
    fs.mkdirSync(path.join(d, 'res', 'ffmpeg'), { recursive: true });
    fs.mkdirSync(path.join(d, 'app', 'vendor', 'ffmpeg'), { recursive: true });
    assert.equal(yollar.ffmpegYolunuBul({ resourcesPath: path.join(d, 'res'), uygulamaKlasoru: path.join(d, 'app'), platform: 'win32' }), null);
    fs.writeFileSync(path.join(d, 'app', 'vendor', 'ffmpeg', 'ffmpeg.exe'), '');
    assert.equal(yollar.ffmpegYolunuBul({ resourcesPath: path.join(d, 'res'), uygulamaKlasoru: path.join(d, 'app'), platform: 'win32' }),
      path.join(d, 'app', 'vendor', 'ffmpeg', 'ffmpeg.exe'));
    fs.writeFileSync(path.join(d, 'res', 'ffmpeg', 'ffmpeg.exe'), '');
    assert.equal(yollar.ffmpegYolunuBul({ resourcesPath: path.join(d, 'res'), uygulamaKlasoru: path.join(d, 'app'), platform: 'win32' }),
      path.join(d, 'res', 'ffmpeg', 'ffmpeg.exe'));
    assert.equal(yollar.ffmpegYolunuBul({ platform: 'linux', env: { PATH: path.join(d, 'yok') } }), null);
    if (y.ffmpegYolu) assert.ok(yollar.ffmpegYolunuBul({ platform: 'linux', env: process.env }));
  } finally { y.temizle(d); }
});

test('libreoffice: sofficeBul Windows klasörleri, özel yol ve null', () => {
  const d = y.gecici();
  try {
    const env = { ProgramFiles: path.join(d, 'PF'), 'ProgramFiles(x86)': path.join(d, 'PF86'), LOCALAPPDATA: path.join(d, 'LA') };
    assert.equal(sofficeBul({ platform: 'win32', env }), null);
    const yerel = path.join(d, 'LA', 'Programs', 'LibreOffice', 'program');
    fs.mkdirSync(yerel, { recursive: true });
    fs.writeFileSync(path.join(yerel, 'soffice.exe'), '');
    assert.equal(sofficeBul({ platform: 'win32', env }), path.join(yerel, 'soffice.exe'));
    const pf = path.join(d, 'PF', 'LibreOffice', 'program');
    fs.mkdirSync(pf, { recursive: true });
    fs.writeFileSync(path.join(pf, 'soffice.exe'), '');
    assert.equal(sofficeBul({ platform: 'win32', env }), path.join(pf, 'soffice.exe'));
    const ozel = path.join(d, 'ozel', 'soffice.exe');
    fs.mkdirSync(path.dirname(ozel));
    fs.writeFileSync(ozel, '');
    assert.equal(sofficeBul({ platform: 'win32', env, ozelYol: ozel }), ozel);
    assert.equal(sofficeBul({ platform: 'linux', env: { PATH: path.join(d, 'yok') } }), null);
  } finally { y.temizle(d); }
});

test('pdf: sayfa aralığı çözümleme', () => {
  assert.deepEqual(sayfaListesi('1-3,5', 6), [0, 1, 2, 4]);
  assert.deepEqual(sayfaListesi('', 3), [0, 1, 2]);
  assert.deepEqual(sayfaListesi('2-', 4), [1, 2, 3]);
  assert.throws(() => sayfaListesi('7', 6));
  assert.throws(() => sayfaListesi('3-1', 6));
  assert.throws(() => sayfaListesi('a', 6));
});

test('arsiv: guvenliYol zip-slip', () => {
  const kok = path.resolve('/tmp/kok-deneme');
  assert.throws(() => guvenliYol(kok, '../evil.txt'), /güvenlik/);
  assert.throws(() => guvenliYol(kok, 'a/../../evil.txt'), /güvenlik/);
  assert.throws(() => guvenliYol(kok, '/etc/passwd'), /güvenlik/);
  assert.throws(() => guvenliYol(kok, 'C:\\Windows\\x.dll'), /güvenlik/);
  assert.throws(() => guvenliYol(kok, '..\\evil.txt'), /güvenlik/);
  assert.equal(guvenliYol(kok, 'a/b.txt'), path.join(kok, 'a', 'b.txt'));
});

test('ffmpeg: komut kurma (süre ve kalite)', () => {
  assert.equal(sureSaniye('00:01:05.5'), 65.5);
  assert.equal(sureSaniye('1:30'), 90);
  assert.equal(sureSaniye('12'), 12);
  assert.throws(() => sureSaniye('-5'));
  assert.throws(() => sureSaniye('abc'));
  const a = komutOlustur({ girdi: '/tmp/a.mp4', hedef: 'mp4', secenekler: { kalite: 'kucuk', genislik: 641, baslangic: '00:00:05', bitis: 20 } });
  assert.ok(a.includes('scale=640:-2'));
  assert.ok(a.join(' ').includes('-crf 28'));
  assert.ok(a.join(' ').includes('-ss 5 -to 20'));
  assert.throws(() => komutOlustur({ girdi: '/tmp/a.mp4', hedef: 'mp4', secenekler: { kalite: 'x' } }));
  assert.throws(() => komutOlustur({ girdi: '/tmp/a.mp4', hedef: 'mp4', secenekler: { baslangic: 10, bitis: 5 } }));
  const m = komutOlustur({ girdi: '/tmp/a.mp3', hedef: 'mpg', secenekler: {} }).join(' ');
  assert.ok(m.includes('-c:v mpeg2video') && m.includes('-c:a mp2') && m.includes('-shortest') && m.includes('color=c=black:s=1280x720'));
  const k = komutOlustur({ girdi: '/tmp/a.mp3', hedef: 'mp4', secenekler: { kapakGorseli: '/tmp/k.png' } }).join(' ');
  assert.ok(k.includes('-loop 1') && k.includes('file:/tmp/k.png') && !k.includes('lavfi'));
  assert.ok(komutOlustur({ girdi: '/tmp/a.mp3', hedef: 'mp2', secenekler: {} }).join(' ').includes('-c:a mp2'));
});

test('kuyruk: eşzamanlılık sınırı, durumlar, iptal', async () => {
  let aktif = 0;
  let enCok = 0;
  const durumlar = {};
  const k = new Kuyruk({
    esZamanli: 2,
    calistirici: async (is, ortam) => {
      aktif += 1; enCok = Math.max(enCok, aktif);
      try {
        if (is.hata) throw new Error('kasitli');
        for (let i = 1; i <= 4; i += 1) {
          if (ortam.sinyal.aborted) throw new Error('iptal');
          ortam.ilerleme(i * 25);
          await new Promise((r) => setTimeout(r, 30));
        }
        return { ciktilar: [`cikti-${is.id}`] };
      } finally { aktif -= 1; }
    },
  });
  k.on('durum', (d) => { (durumlar[d.id] = durumlar[d.id] || []).push(d); });
  for (let i = 1; i <= 5; i += 1) k.ekle({ id: `is${i}`, hata: i === 3 });
  k.ekle({ id: 'uzun', hata: false });
  assert.equal(k.iptal('is5'), true); // bekliyor
  await k.bosBekle();
  assert.ok(enCok <= 2 && enCok >= 2, `en çok eşzamanlı: ${enCok}`);
  const son = (id) => durumlar[id][durumlar[id].length - 1];
  assert.equal(son('is1').durum, 'bitti');
  assert.deepEqual(son('is1').ciktilar, ['cikti-is1']);
  assert.equal(son('is1').yuzde, 100);
  assert.equal(son('is3').durum, 'hata');
  assert.match(son('is3').hata, /kasitli/);
  assert.equal(son('is5').durum, 'iptal');
  assert.ok(durumlar.is1.some((d) => d.durum === 'calisiyor' && d.yuzde > 0 && d.yuzde < 100));
});

test('kuyruk: çalışan işi iptal eder ve tumunuIptal', async () => {
  const k = new Kuyruk({
    esZamanli: 1,
    calistirici: (is, ortam) => new Promise((coz, reddet) => {
      ortam.sinyal.addEventListener('abort', () => reddet(Object.assign(new Error('x'), { iptal: true })));
      setTimeout(() => coz({ ciktilar: [] }), 5000);
    }),
  });
  const son = {};
  k.on('durum', (d) => { son[d.id] = d.durum; });
  k.ekle({ id: 'a' }); k.ekle({ id: 'b' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(son.a, 'calisiyor');
  k.tumunuIptal();
  await k.bosBekle();
  assert.equal(son.a, 'iptal');
  assert.equal(son.b, 'iptal');
});

test('libreoffice: programla gelen LibreOffice kurulu olandan önce bulunur', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'gomulu-'));
  const prog = path.join(kok, 'libreoffice', 'program');
  fs.mkdirSync(prog, { recursive: true });
  fs.writeFileSync(path.join(prog, 'soffice.exe'), '');
  assert.equal(sofficeBul({ platform: 'win32', env: {}, gomuluKlasor: kok }), path.join(prog, 'soffice.exe'));
  assert.equal(sofficeBul({ platform: 'win32', env: {}, gomuluKlasor: path.join(kok, 'yok') }), null);
  fs.rmSync(kok, { recursive: true, force: true });
});
