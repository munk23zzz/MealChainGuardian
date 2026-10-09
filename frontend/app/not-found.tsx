import Image from "next/image";
import Link from "next/link";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      {/* Mark brand: halaman ini juga punya brand, dan sebelumnya hanya teks. Dekoratif
          karena judul di bawahnya sudah menyebut MealChain Guardian. */}
      <Image
        src={`${BASE_PATH}/img/logo-mark.png`}
        alt=""
        aria-hidden="true"
        width={56}
        height={56}
        className="object-contain"
      />
      <h1 className="text-xl font-semibold text-navy-900">
        Halaman tidak ditemukan
      </h1>
      <p className="text-muted-foreground">
        Screen ini tidak ada di MealChain Guardian. Kembali ke dashboard untuk
        melihat status pasokan 10 lokasi.
      </p>
      <Link
        href="/dashboard"
        className="rounded-md border border-navy-700 px-3 py-1.5 font-medium text-navy-700 hover:bg-navy-100"
      >
        Ke dashboard
      </Link>
    </div>
  );
}
