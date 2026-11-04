'use strict';
// TaaDön FFmpeg motoru ek testleri (yazan: Claude). Sahibi: proje test takımı; yalnız ekleme/düzeltme yapılır.
// Kapsam: image2 örüntü koruması, zaman aşımı sıkıştırma, Türkçe hata eşleme, kapak görseli doğrulama, Duration ayrıştırma.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ffmpeg = require('../src/motorlar/ffmpeg');
const y = require('./yardimci');

test('girdiGuvenligi: örüntülü görsel girdi öncesi -pattern_type none eklenir', () => {
  const a = ffmpeg.girdiGuvenligi(['-loop', '1', '-i', 'file:kare%03d.png', '-i', 'file:s.mp3', 'cikti']);
  const i = a.indexOf('-i');
  assert.deepEqual(a.slice(i - 6, i), ['-protocol_whitelist', 'file,pipe', '-pattern_type', 'none', '-format_whitelist', ffmpeg.IZINLI_DEMUXERLAR]);
  assert.equal(a.filter((x) => x === '-pattern_type').length, 1, 'yalnız örüntülü görsel girdide');
});

test('girdiGuvenligi: lavfi ve sıradan girdilere -pattern_type eklenmez', () => {
  const a = ffmpeg.girdiGuvenligi(['-f', 'lavfi', '-i', 'color=c=black', '-i', 'file:a.png', '-i', 'file:v%d.mp4', 'c']);
  assert.ok(!a.includes('-pattern_type'));
});

test('zamanAsimiAl: 1000..2^31-1 aralığına sıkıştırır', () => {
  assert.equal(ffmpeg.zamanAsimiAl(50), 1000);
  assert.equal(ffmpeg.zamanAsimiAl(5e12), 2 ** 31 - 1);
  assert.equal(ffmpeg.zamanAsimiAl(240000), 240000);
  assert.equal(ffmpeg.zamanAsimiAl(undefined), ffmpeg.VARSAYILAN_ZAMAN_ASIMI);
  assert.equal(ffmpeg.zamanAsimiAl('abc'), ffmpeg.VARSAYILAN_ZAMAN_ASIMI);
});

test('hataMetniCevir: bilinen kalıplar Türkçeye eşlenir', () => {
  const c = ffmpeg.hataMetniCevir;
  assert.equal(c('x: Invalid data found when processing input'), 'Dosya bozuk ya da eksik görünüyor.');
  assert.equal(c('moov atom not found'), 'Dosya bozuk ya da eksik görünüyor.');
  assert.equal(c('a.mp3: No such file or directory'), 'Girdi dosyası bulunamadı.');
  assert.equal(c('Permission denied'), 'Çıktı klasörüne yazılamıyor.');
  assert.match(c("Stream map '0:a:0' matches no streams."), /ses\/video akışı yok/);
  assert.match(c('Output file does not contain any stream'), /ses\/video akışı yok/);
  assert.equal(c('Unknown encoder libfoo'), 'Bu biçim için kodlayıcı yok.');
  assert.equal(c('Encoder libx265 not found'), 'Bu biçim için kodlayıcı yok.');
});

test('hataMetniCevir: bilinmeyen hata genel metin + ilk satırın ilk 120 karakteri', () => {
  const uzun = 'k'.repeat(200);
  const m = ffmpeg.hataMetniCevir(`\n${uzun}\nikinci satır`);
  assert.match(m, /^Dönüştürme başarısız oldu\. .*başka bir hedef biçim deneyin\. \(k{120}\)$/);
  assert.ok(!m.includes('ikinci'));
  assert.match(ffmpeg.hataMetniCevir(''), /^Dönüştürme başarısız oldu\./);
});

test('ffmpegCalistir: yol yoksa Türkçe FFmpeg bulunamadı iletisi', async () => {
  await assert.rejects(ffmpeg.ffmpegCalistir({ ffmpegYolu: null, args: [] }), /FFmpeg bulunamadı\. Ses\/video dönüştürücü programla birlikte gelmeliydi; programı yeniden kurun\./);
});

test('kapakGorseli: yalnız görsel uzantıları kabul edilir', () => {
  const sec = (k) => ({ girdi: path.join('x', 'a.mp3'), hedef: 'mp4', secenekler: { kapakGorseli: k } });
  assert.throws(() => ffmpeg.komutOlustur(sec(path.join('x', 'kapak.txt'))), /Kapak görseli geçerli bir görsel/);
  assert.throws(() => ffmpeg.komutOlustur(sec(path.join('x', 'kapak'))), /Kapak görseli/);
  const a = ffmpeg.komutOlustur(sec(path.join('x', 'kapak.JPG')));
  assert.ok(a.includes('-loop'));
});

test('ffmpegCalistir: Duration satırı parça sınırında bölünse de ilerleme hesaplanır', { timeout: 60000, skip: !y.ffmpegYolu }, async (t) => {
  const g = y.gecici();
  t.after(() => y.temizle(g));
  const wav = path.join(g, 'a.wav');
  y.ffmpegCalistir(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav]);
  const yuzdeler = [];
  await ffmpeg.ffmpegCalistir({
    ffmpegYolu: y.ffmpegYolu,
    ilerleme: (v) => yuzdeler.push(v),
    args: ['-i', `file:${wav}`, '-f', 'null', '-'],
  });
  assert.ok(yuzdeler.length > 0, 'ilerleme bildirimi gelmeli');
});
