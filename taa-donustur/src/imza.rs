//! TaaDön çıktı imza denetimi (src/donustur.js CIKTI_IMZALARI + ciktiGecerli ile birebir aynı kural).
//! Sahip: Yusuf (TaaDön projesi). yazan: [Claude#taadon-rust-asama1 2026-11-04], [Claude#taadon-rust-asama2 2026-11-04] (ad: taa-donustur).
//! Değişiklik: Yusuf'un kuralları çerçevesinde; imza listesi Node tarafıyla birlikte güncellenmelidir.
//! yazan: [Claude#taadon-1.11-paket-c 2026-11-04] (algila: main.js bicimAlgila ile birebir sihirli bayt tablosu).

use crate::{uzanti_al, Hata, Sonuc};
use std::fs::File;
use std::io::Read;
use std::path::Path;

const PK: &[u8] = &[0x50, 0x4b];

/// Uzantıya göre beklenen ilk baytlar; listede olmayan uzantı denetlenmez.
pub fn beklenen_imza(uzanti: &str) -> Option<&'static [u8]> {
    match uzanti {
        "pdf" => Some(&[0x25, 0x50, 0x44, 0x46]),
        "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp" | "epub" | "zip" => Some(PK),
        "png" => Some(&[0x89, 0x50, 0x4e, 0x47]),
        "jpg" | "jpeg" => Some(&[0xff, 0xd8, 0xff]),
        "gif" => Some(&[0x47, 0x49, 0x46, 0x38]),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImzaSonucu {
    pub uzanti: String,
    pub imza_uygun: bool,
    pub boyut: u64,
}

/// ciktiGecerli kuralı: klasör → uygun; dosya değil ya da boş → uygun değil; imzası yoksa → uygun;
/// dosya imzadan kısa ya da baytlar tutmuyor → uygun değil.
pub fn denetle(yol: &Path) -> Sonuc<ImzaSonucu> {
    let uzanti = uzanti_al(yol);
    let md = std::fs::metadata(yol).map_err(|_| Hata::yeni(format!("Dosya bulunamadı: {}", yol.display())))?;
    if md.is_dir() {
        return Ok(ImzaSonucu { uzanti, imza_uygun: true, boyut: 0 });
    }
    let boyut = md.len();
    if !md.is_file() || boyut == 0 {
        return Ok(ImzaSonucu { uzanti, imza_uygun: false, boyut });
    }
    let Some(imza) = beklenen_imza(&uzanti) else {
        return Ok(ImzaSonucu { uzanti, imza_uygun: true, boyut });
    };
    if boyut < imza.len() as u64 {
        return Ok(ImzaSonucu { uzanti, imza_uygun: false, boyut });
    }
    let mut tampon = vec![0u8; imza.len()];
    let mut f = File::open(yol).map_err(|e| Hata::yeni(format!("Dosya açılamadı: {e}")))?;
    f.read_exact(&mut tampon).map_err(|e| Hata::yeni(format!("Dosya okunamadı: {e}")))?;
    Ok(ImzaSonucu { uzanti, imza_uygun: tampon == imza, boyut })
}

fn alt_dizi(b: &[u8], dizi: &[u8]) -> bool {
    !dizi.is_empty() && b.windows(dizi.len()).any(|w| w == dizi)
}

/// main.js bicimAlgila ile aynı kural: ilk 4 KB baytından biçim (bilinmiyorsa None).
pub fn algila(bayt: &[u8]) -> Option<&'static str> {
    let bayt = &bayt[..bayt.len().min(4096)];
    if bayt.len() < 4 {
        return None;
    }
    let ba = |bas: usize, d: &[u8]| bayt.len() >= bas + d.len() && &bayt[bas..bas + d.len()] == d;
    if ba(0, b"%PDF-") {
        return Some("pdf");
    }
    if ba(0, &[0x50, 0x4b, 0x03, 0x04]) {
        if alt_dizi(bayt, b"application/epub+zip") {
            return Some("epub");
        }
        if alt_dizi(bayt, b"[Content_Types].xml") {
            if alt_dizi(bayt, b"word/") {
                return Some("docx");
            }
            if alt_dizi(bayt, b"xl/") {
                return Some("xlsx");
            }
            if alt_dizi(bayt, b"ppt/") {
                return Some("pptx");
            }
        }
        return Some("zip");
    }
    if ba(0, &[0x89, 0x50, 0x4e, 0x47]) {
        return Some("png");
    }
    if ba(0, &[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if ba(0, b"GIF8") {
        return Some("gif");
    }
    if ba(0, b"RIFF") {
        if ba(8, b"WEBP") {
            return Some("webp");
        }
        if ba(8, b"WAVE") {
            return Some("wav");
        }
        return None;
    }
    if ba(0, b"ID3") || (bayt[0] == 0xff && matches!(bayt[1], 0xfb | 0xf3 | 0xf2)) {
        return Some("mp3");
    }
    if ba(4, b"ftyp") {
        return Some("mp4");
    }
    if ba(0, &[0x1f, 0x8b]) {
        return Some("gz");
    }
    if ba(0, b"OggS") {
        return Some("ogg");
    }
    if ba(0, b"fLaC") {
        return Some("flac");
    }
    if ba(0, &[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) {
        return Some("7z");
    }
    if ba(0, b"Rar!\x1a\x07") {
        return Some("rar");
    }
    if ba(0, b"BM") {
        return Some("bmp");
    }
    None
}

/// Dosyanın ilk 4 KB'ından biçim algılar (klasör/okunamayan dosyada hata).
pub fn algila_dosya(yol: &Path) -> Sonuc<Option<&'static str>> {
    let mut f = File::open(yol).map_err(|e| Hata::yeni(format!("Dosya açılamadı: {e}")))?;
    let mut tampon = vec![0u8; 4096];
    let mut dolu = 0usize;
    while dolu < tampon.len() {
        let n = f.read(&mut tampon[dolu..]).map_err(|e| Hata::yeni(format!("Dosya okunamadı: {e}")))?;
        if n == 0 {
            break;
        }
        dolu += n;
    }
    Ok(algila(&tampon[..dolu]))
}

#[cfg(test)]
mod testler {
    use super::algila;

    #[test]
    fn tablo() {
        assert_eq!(algila(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(algila(b"PK\x03\x04[Content_Types].xml word/document.xml"), Some("docx"));
        assert_eq!(algila(b"PK\x03\x04[Content_Types].xml xl/workbook.xml"), Some("xlsx"));
        assert_eq!(algila(b"PK\x03\x04mimetypeapplication/epub+zip"), Some("epub"));
        assert_eq!(algila(b"PK\x03\x04abcd"), Some("zip"));
        assert_eq!(algila(b"RIFF\x00\x00\x00\x00WAVEfmt "), Some("wav"));
        assert_eq!(algila(b"RIFF\x00\x00\x00\x00AVI "), None);
        assert_eq!(algila(b"abc"), None);
        assert_eq!(algila(b"\x00\x00\x00\x18ftypmp42"), Some("mp4"));
    }
}
