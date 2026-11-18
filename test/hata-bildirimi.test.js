'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../hata-bildirimi.js');

test('temizle: sır ve kişisel veri çıkar', () => {
  const t = H.temizle('parola=abc123 bearer eyJhbGciOiJIUzI1NiJ9abcdefghijkl ali@x.com C:\\Users\\Yusuf\\gizli\\tutaa.db 05321234567 "Ali Yılmaz"');
  for (const yasak of ['abc123', 'eyJ', 'ali@x.com', 'Yusuf', '05321234567', 'Ali']) assert.ok(!t.includes(yasak), `${yasak} kaldı: ${t}`);
  assert.ok(t.includes('tutaa.db'), t);
});

test('aynı hata aynı parmak izi, kuyrukta tek kayıt', () => {
  const a = H.rapor({ program: 'p', surum: '1', tur: 'hata', yer: 'a.js:1', mesaj: 'indeks 5 hatalı' });
  const b = H.rapor({ program: 'p', surum: '1', tur: 'hata', yer: 'a.js:1', mesaj: 'indeks 9 hatalı' });
  assert.strictEqual(a.parmak_izi, b.parmak_izi);
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'hata-'));
  assert.strictEqual(H.kuyrugaYaz(kok, a), true);
  assert.strictEqual(H.kuyrugaYaz(kok, a), false);
  const satir = JSON.parse(fs.readFileSync(path.join(kok, 'kuyruk', 'hata-p', 'giden.jsonl'), 'utf8').trim());
  assert.strictEqual(satir.uc, '/v1/hata-raporu');
  assert.match(satir.no, /^H-[0-9a-f]{16}-\d{8}$/);
  assert.strictEqual(satir.govde.program, 'p');
});
