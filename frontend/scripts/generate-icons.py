"""Regenerasi aset brand MealChain Guardian dari satu sumber: `public/img/logo.png`.

Output
------
assets/logo-mark.png                96x96 transparan — mark untuk UI (rail, halaman masuk, 404).
                                    SENGAJA di luar `public/`: diimpor sebagai modul
                                    (`import logoMark from "@/assets/logo-mark.png"`) sehingga
                                    Next memberi URL ber-hash `/_next/static/media/...` — itulah
                                    yang membuat logo baru langsung sampai ke pengguna tanpa
                                    menunggu cache browser/service worker kedaluwarsa.
public/icons/icon-192.png           192x192 di atas putih
public/icons/icon-512.png           512x512 di atas putih
public/icons/icon-512-maskable.png  512x512, mark 64% kanvas (aman di safe circle 80%)
app/apple-icon.png                  180x180 opaque — iOS "Add to Home Screen"
                                    (konvensi file App Router: Next menambahkan hash sendiri)
public/favicon.ico                  16/32/48/256, dirujuk eksplisit di `app/layout.tsx` dengan
                                    query versi; lihat catatan ukuran kecil di bawah

Dua hal yang TIDAK boleh dilupakan
----------------------------------
1. **Potong alfa lebih dulu.** `logo.png` 500x500 hanya memakai 232x276 di tengahnya; kalau
   berkasnya di-resize apa adanya, mark muncul ~46% kotak dan pada 24px terbaca seperti
   kotak kosong.
2. **Ukuran kecil butuh tepi keras.** Mark penuh pada 16px jadi bubur piksel, bukan karena
   detailnya, tapi karena setiap piksel tepi hasil downscale hanya ~40-60% alfa sehingga
   tercampur putih. Alfa dipotong di 128 (`hard_edges`) + coverage dinaikkan ke 0,92 untuk
   entri 16px; terukur 118 piksel abu-abu -> 0. Siluet satu warna (`silhouette_tile`)
   sempat diuji dan lebih tajam, tapi kehilangan warna brand dan terbaca sebagai kotak
   gelap, jadi tidak dipakai. ICO dibangun manual (PNG per entri) karena Pillow hanya bisa
   menurunkan satu gambar dasar untuk semua ukuran.

Butuh Pillow (bukan dependensi proyek): `pip install pillow`.

Pakai: `python scripts/generate-icons.py` dari folder `frontend/`
(`MCG_FRONTEND` menimpa root proyek kalau dijalankan dari tempat lain).
"""

import io
import os
import struct
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

FRONTEND = Path(os.environ.get("MCG_FRONTEND", Path(__file__).resolve().parents[1]))
SRC = FRONTEND / "public" / "img" / "logo.png"
MARK_OUT = FRONTEND / "assets" / "logo-mark.png"
ICONS = FRONTEND / "public" / "icons"
FAVICON = FRONTEND / "public" / "favicon.ico"
APPLE_ICON = FRONTEND / "app" / "apple-icon.png"

BACKGROUND = (255, 255, 255)
SILHOUETTE_COLOUR = (31, 59, 77)  # token `navy-900` (docs/design.md §4)

COVERAGE_MARK = 1.00      # aset UI: padding datang dari tile di sekelilingnya
COVERAGE_ANY = 0.72       # ikon biasa
COVERAGE_MASKABLE = 0.64  # di dalam safe circle 80%
COVERAGE_FAVICON = 0.80   # 32px ke atas
COVERAGE_TINY = 0.92      # 16px: hampir memenuhi kanvas + tepi keras (lihat hard_edges)


def trimmed_mark() -> Image.Image:
    """Mark dipotong ke batas alfanya (buang margin transparan)."""
    img = Image.open(SRC).convert("RGBA")
    alpha = img.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    box = alpha.getbbox()
    if box is None:
        raise SystemExit(f"tidak ada piksel opaque di {SRC}")
    return img.crop(box)


def fitted(mark: Image.Image, box: int) -> Image.Image:
    """Perbesar/perkecil mark sampai sisi terpanjangnya = `box`, rasio dijaga."""
    scale = box / max(mark.size)
    return mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS
    )


def _paste(canvas: Image.Image, mark: Image.Image) -> Image.Image:
    canvas.paste(mark, ((canvas.width - mark.width) // 2, (canvas.height - mark.height) // 2), mark)
    return canvas


def opaque_tile(mark: Image.Image, size: int, coverage: float, crisp: bool = False) -> Image.Image:
    """Mark penuh di atas tile putih (RGB, tanpa alfa: ikon PWA/favicon lama juga RGB).

    `crisp=True` memotong alfa (lihat `hard_edges`) — dipakai untuk 16px saja; pada ukuran
    besar tepi ber-alfa-halus justru lebih enak dilihat.
    """
    fitted_mark = fitted(mark, round(size * coverage))
    if crisp:
        fitted_mark = hard_edges(fitted_mark)
    return _paste(Image.new("RGB", (size, size), BACKGROUND), fitted_mark)


def transparent_tile(mark: Image.Image, size: int, coverage: float) -> Image.Image:
    """Mark transparan untuk UI (tile putihnya digambar oleh komponennya)."""
    return _paste(Image.new("RGBA", (size, size), (0, 0, 0, 0)), fitted(mark, round(size * coverage)))


def silhouette_tile(mark: Image.Image, size: int, coverage: float) -> Image.Image:
    """Versi satu warna (TIDAK dipakai di favicon final — disimpan karena berguna untuk
    keperluan lain: stempel, watermark, ikon satu warna).

    Catatan hasil uji: siluet penuh pada 16px memang paling tajam, tapi kehilangan semua
    warna brand dan bentuknya terbaca sebagai "kotak gelap", bukan perisai. Kandidat yang
    menang adalah mark penuh dengan alfa di-potong (lihat `hard_edges`) — lihat
    `mcg-icons/favicon-real-size.png` untuk lembar pembandingnya.
    """
    base = fitted(mark, round(size * coverage))
    mask = base.getchannel("A").point(lambda v: 255 if v >= 8 else 0)
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))  # closing: tutup celah tipis
    inverted = ImageOps.invert(mask)
    for corner in ((0, 0), (mask.width - 1, 0), (0, mask.height - 1), (mask.width - 1, mask.height - 1)):
        if inverted.getpixel(corner) == 255:  # hanya area LUAR yang di-flood
            ImageDraw.floodfill(inverted, corner, 128)
    holes = inverted.point(lambda v: 255 if v == 255 else 0)  # sisa putih = lubang di dalam mark
    solid = ImageChops.lighter(mask, holes)
    layer = Image.new("RGB", base.size, SILHOUETTE_COLOUR)
    return _paste(Image.new("RGB", (size, size), BACKGROUND), Image.merge("RGBA", (*layer.split(), solid)))


def hard_edges(mark: Image.Image) -> Image.Image:
    """Buang piksel setengah transparan hasil downscale (`LANCZOS`): alfa dipotong di 128.

    Inilah yang membuat favicon 16px tajam. Tanpa ini, tepi mark tersebar jadi piksel abu-abu
    (setiap piksel tepi hanya ~40-60% alfa) sehingga huruf/bentuknya luntur — terukur: versi
    ber-alfa-halus punya 118 piksel "abu-abu" di 16px, versi tepi-keras 0.
    """
    alpha = mark.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    return Image.merge("RGBA", (*mark.split()[:3], alpha))


def write_ico(entries: list[tuple[int, Image.Image]], out: Path) -> None:
    """Tulis ICO dari beberapa gambar berbeda (PNG per entri) — Pillow hanya bisa menurunkan
    SATU gambar dasar untuk semua ukuran, sedangkan kita butuh siluet di 16px."""
    header = struct.pack("<HHH", 0, 1, len(entries))
    payloads = []
    for _, img in entries:
        buf = io.BytesIO()
        img.convert("RGBA").save(buf, format="PNG", optimize=True)
        payloads.append(buf.getvalue())
    offset = len(header) + 16 * len(entries)
    directory = b""
    for (size, _), data in zip(entries, payloads):
        directory += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        offset += len(data)
    out.write_bytes(header + directory + b"".join(payloads))


def main() -> None:
    mark = trimmed_mark()
    print(f"mark dipotong: {mark.size} (dari {Image.open(SRC).size})")

    MARK_OUT.parent.mkdir(parents=True, exist_ok=True)
    ui_mark = transparent_tile(mark, 96, COVERAGE_MARK)
    ui_mark.save(MARK_OUT, format="PNG", optimize=True)
    print(f"tulis {MARK_OUT.name} {ui_mark.size} {MARK_OUT.stat().st_size} B")

    ICONS.mkdir(parents=True, exist_ok=True)
    for name, size, coverage in (
        ("icon-192.png", 192, COVERAGE_ANY),
        ("icon-512.png", 512, COVERAGE_ANY),
        ("icon-512-maskable.png", 512, COVERAGE_MASKABLE),
    ):
        out = ICONS / name
        icon = opaque_tile(mark, size, coverage)
        icon.save(out, format="PNG", optimize=True)
        print(f"tulis {out.name} {icon.size} {out.stat().st_size} B")

    apple = opaque_tile(mark, 180, COVERAGE_ANY)
    apple.save(APPLE_ICON, format="PNG", optimize=True)
    print(f"tulis {APPLE_ICON.name} {apple.size} {APPLE_ICON.stat().st_size} B")

    entries = [
        (16, opaque_tile(mark, 16, COVERAGE_TINY, crisp=True)),  # tepi keras: ini yang membuat 16px tajam
        (32, opaque_tile(mark, 32, COVERAGE_FAVICON)),
        (48, opaque_tile(mark, 48, COVERAGE_FAVICON)),
        (256, opaque_tile(mark, 256, COVERAGE_FAVICON)),
    ]
    write_ico(entries, FAVICON)
    print(f"tulis {FAVICON.name} entri={[s for s, _ in entries]} {FAVICON.stat().st_size} B")


if __name__ == "__main__":
    main()
