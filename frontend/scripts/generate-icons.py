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
2. **Ukuran kecil butuh tepi keras DAN palet terbatas.** Mark penuh pada 16px jadi bubur piksel,
   bukan karena detailnya, tapi karena setiap piksel tepi hasil downscale hanya ~40-60% alfa
   sehingga tercampur putih. Dua langkah dipakai bersama untuk entri 16px:
   (a) alfa dipotong di 128 (`hard_edges`) + coverage dinaikkan ke 0,98;
   (b) `snap_palette()` memaksa setiap piksel ke palet brand terdekat (lihat `brand_palette`).
   Tanpa (b), versi tepi-keras masih memakai 211 warna berbeda di 256 piksel; dengan (b) hanya 5
   warna — bentuknya jadi blok warna bersih, bukan kabut hijau-abu. Tiga jalan yang DIUJI dan
   ditolak (10 Okt): menebalkan garis gelap (rantai jadi dominan, terbaca seperti cincin gelap),
   kuantisasi ADAPTIVE (`bisukan()` di scratch — hasilnya pucat), dan siluet satu warna
   (`silhouette_tile`) — kehilangan warna brand dan terbaca sebagai "kotak gelap". ICO dibangun
   manual (PNG per entri) karena Pillow hanya bisa menurunkan satu gambar dasar untuk semua ukuran.

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
COVERAGE_TINY = 0.98      # 16px: memenuhi kanvas + tepi keras + palet terbatas (lihat snap_palette)


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


def brand_palette(mark: Image.Image, n: int = 4) -> list[tuple[int, int, int]]:
    """Palet brand untuk `snap_palette`: warna dominan mark (di atas putih) + putih.

    Diturunkan dari artwork, bukan ditulis tangan, supaya tetap benar kalau sumbernya diganti.
    Metodenya FASTOCTREE: MEDIANCUT pada gambar yang banyak tepi ber-alfa cenderung menghasilkan
    palet kelabu (terukur 10 Okt: MEDIANCUT -> putih + (129,161,152) saja, yaitu kabut), sedangkan
    FASTOCTREE memisahkan putih, teal tua, dan hijau seperti yang terlihat di artwork.
    """
    kanvas = _paste(Image.new("RGB", (256, 256), BACKGROUND), fitted(mark, 240))
    quantized = kanvas.quantize(colors=n + 1, method=Image.Quantize.FASTOCTREE)
    mentah: list[int] = list(quantized.getpalette() or [])
    warna_kuant: list[tuple[int, int, int]] = [
        (mentah[i], mentah[i + 1], mentah[i + 2])
        for i in range(0, min(len(mentah), (n + 1) * 3) - 2, 3)
    ]
    hasil: list[tuple[int, int, int]] = []
    for warna in [BACKGROUND, *warna_kuant]:
        if all(sum((a - b) ** 2 for a, b in zip(warna, ada)) > 30**2 for ada in hasil):
            hasil.append(warna)
    return hasil


def snap_palette(img: Image.Image, palet: list[tuple[int, int, int]]) -> Image.Image:
    """Paksa setiap piksel ke warna palet TERDEKAT — buang warna antara.

    Ini langkah yang membuat favicon 16px "tegas", bukan sekadar tepi keras: versi tepi-keras
    masih memakai ~200 warna berbeda di 256 piksel (campuran tepi + latar) sehingga terbaca
    sebagai kabut; dengan snap hanya ~5 warna tersisa dan bentuknya jadi blok warna bersih.
    """
    # CATATAN: `convert()` mode sama mengembalikan SALINAN — pixel harus ditulis ke salinan itu,
    # bukan ke `img` aslinya (kalau tidak, hasil snap tidak terpakai).
    hasil = img.convert("RGB")
    px = hasil.load()
    if px is None:  # tidak terjadi untuk gambar di memori; menjaga pemeriksa tipe
        return hasil
    for y in range(hasil.height):
        for x in range(hasil.width):
            r, g, b = px[x, y]  # type: ignore[misc]

            def jarak(warna: tuple[int, int, int], r=r, g=g, b=b) -> int:
                return (warna[0] - r) ** 2 + (warna[1] - g) ** 2 + (warna[2] - b) ** 2

            px[x, y] = min(palet, key=jarak)
    return hasil


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

    palet = brand_palette(mark)
    print(f"palet favicon ({len(palet)} warna): {palet}")
    entries = [
        # 16px & 32px = ikon yang muncul di TAB peramban (32px dipakai saat layar retina,
        # ditampilkan pada 16 CSS px). Keduanya dapat perlakuan sama: tepi keras + snap palet,
        # supaya tajam di 1x DAN tidak pucat di 2x. Tanpa snap, entri ini memakai ~200 warna
        # campuran dan terbaca sebagai kabut hijau-abu.
        (16, snap_palette(opaque_tile(mark, 16, COVERAGE_TINY, crisp=True), palet)),
        (32, snap_palette(opaque_tile(mark, 32, COVERAGE_FAVICON, crisp=True), palet)),
        # 48px & 256px: dipakai untuk pintasan/taskbar/PWA — ukurannya cukup besar sehingga
        # gradasi halus lebih berguna daripada blok warna; biarkan ber-alfa-halus.
        (48, opaque_tile(mark, 48, COVERAGE_FAVICON)),
        (256, opaque_tile(mark, 256, COVERAGE_FAVICON)),
    ]
    write_ico(entries, FAVICON)
    print(f"tulis {FAVICON.name} entri={[s for s, _ in entries]} {FAVICON.stat().st_size} B")


if __name__ == "__main__":
    main()
