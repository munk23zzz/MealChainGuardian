"""Siapkan satu berkas sumber brand dari gambar mentah (mis. ekspor AI 2000x2000).

Hasilnya `public/img/logo.png` — sumber tunggal untuk SEMUA turunan (dibaca oleh
`scripts/generate-icons.py`). Yang dilakukan di sini, dan alasannya:

1. **Potong ke batas alfa.** Berkas mentah hampir selalu membawa margin transparan besar
   (contoh: ekspor 2000x2000 hanya memakai 1382x1627). Tanpa potong, mark terlihat kecil
   di dalam kotaknya dan ikon kecil jadi mubazir.
2. **Batasi sisi panjang ke 1024 px.** Turunan terbesar adalah ikon PWA 512 px, jadi 1024
   sudah 2x; menyimpan 2000 px hanya menambah bobot repo tanpa menambah ketajaman.
3. **Optimize PNG.** Seni datar seperti ini turun drastis tanpa kehilangan kualitas.

Pakai: python scripts/prepare-logo.py "D:\\Downloads\\MGlogo.png"
"""

import io
import sys
from pathlib import Path

from PIL import Image

FRONTEND = Path(__file__).resolve().parents[1]
KELUARAN = FRONTEND / "public" / "img" / "logo.png"
SISI_MAKS = 1024


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('pakai: python scripts/prepare-logo.py <berkas-masuk.png>')
    masuk = Path(sys.argv[1])
    if not masuk.exists():
        raise SystemExit(f"berkas tidak ditemukan: {masuk}")

    asli = Image.open(masuk).convert("RGBA")
    alpha = asli.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    kotak = alpha.getbbox()
    if kotak is None:
        raise SystemExit(f"tidak ada piksel opaque di {masuk}")
    dipotong = asli.crop(kotak)

    skala = min(1.0, SISI_MAKS / max(dipotong.size))
    akhir = (
        dipotong
        if skala == 1.0
        else dipotong.resize(
            (round(dipotong.width * skala), round(dipotong.height * skala)), Image.LANCZOS
        )
    )

    buf = io.BytesIO()
    akhir.save(buf, format="PNG", optimize=True)
    KELUARAN.parent.mkdir(parents=True, exist_ok=True)
    KELUARAN.write_bytes(buf.getvalue())

    print(f"masuk  : {masuk} {asli.size} {masuk.stat().st_size} B")
    print(f"potong : {dipotong.size} (kotak alfa {kotak})")
    print(f"tulis  : {KELUARAN} {akhir.size} {KELUARAN.stat().st_size} B (sisi maks {SISI_MAKS})")


if __name__ == "__main__":
    main()
