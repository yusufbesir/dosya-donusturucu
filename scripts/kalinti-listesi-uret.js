'use strict';
// Bilinen eski sürüm kalıntıları listesi üreticisi (sahibi: Yusuf Beşir / dosya-donusturucu).
// Verilen klasörü (LibreOffice köküne göre göreli yapı: program/..., share/...) gezer ve her normal dosya için
// {yol:"resources/libreoffice/<göreli>", boyut, sha256} üretip src/eski-kalintilar.json dosyasına yazar.
// Kullanım: node scripts/kalinti-listesi-uret.js <klasör> [çıktı.json]
// Değiştirme kuralları: implementer -> verifier; silme yalnız Yusuf'un kararıyla çöp kutusuna.
// Tek istisna: uygulamanın kendi kurulum klasöründeki manifestli eski sürüm temizliği (src/guncelleme.js).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ONEK = 'resources/libreoffice';
const KAYNAK_SURUMLER = ['1.0.0', '1.0.1', '1.0.2'];

function sha256Dosya(yol) {
  return new Promise((coz, red) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(yol);
    s.on('error', red);
    s.on('data', (b) => h.update(b));
    s.on('end', () => coz(h.digest('hex')));
  });
}

async function kalintilariTopla(kok) {
  const sonuc = [];
  async function gez(klasor, onek) {
    const girdiler = await fs.promises.readdir(klasor, { withFileTypes: true });
    for (const g of girdiler) {
      const tam = path.join(klasor, g.name);
      const goreli = onek ? onek + '/' + g.name : g.name;
      const st = await fs.promises.lstat(tam);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) await gez(tam, goreli);
      else if (st.isFile()) sonuc.push({ yol: `${ONEK}/${goreli}`, boyut: st.size, sha256: await sha256Dosya(tam) });
    }
  }
  await gez(kok, '');
  sonuc.sort((a, b) => (a.yol < b.yol ? -1 : a.yol > b.yol ? 1 : 0));
  return sonuc;
}

async function listeUret(kok) {
  return {
    aciklama: 'Dosya Dönüştürücü (sahibi: Yusuf Beşir / dosya-donusturucu). 1.0.0 kurulumunda bulunan, sonraki sürümlerde ' +
      'pakete alınmayan LibreOffice Python bileşenleri. Güncellemede önceki manifest kaydı olmadığından src/guncelleme.js ' +
      'bu listedeki dosyaları (yalnız boyut VE SHA-256 tutuyorsa, yeni manifestte yoksa) kurulum klasöründen siler. ' +
      'Üretici: scripts/kalinti-listesi-uret.js. Değiştirme: implementer -> verifier; silme yalnız Yusuf kararıyla.',
    kaynakSurumler: KAYNAK_SURUMLER,
    dosyalar: await kalintilariTopla(kok),
  };
}

if (require.main === module) {
  (async () => {
    const kok = process.argv[2];
    if (!kok) { console.error('Kullanım: node scripts/kalinti-listesi-uret.js <klasör> [çıktı.json]'); process.exit(1); }
    const hedef = process.argv[3] || path.join(__dirname, '..', 'src', 'eski-kalintilar.json');
    const liste = await listeUret(kok);
    fs.writeFileSync(hedef, JSON.stringify(liste, null, 1) + '\n');
    console.log(`${liste.dosyalar.length} kalıntı yazıldı: ${hedef}`);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { listeUret, kalintilariTopla };
