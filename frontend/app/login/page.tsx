"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  username: z.string().min(1, "Username wajib diisi"),
  password: z.string().min(1, "Password wajib diisi"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/** Rantai agent (Architecture.md §1) — penanda produk di panel kiri. */
const AGENT_CHAIN = [
  "DETECT",
  "VERIFY",
  "TRACE",
  "PREDICT",
  "OPTIMIZE",
  "DECIDE",
  "ACT",
  "LEARN",
];

/**
 * Akun demo (mock, bukan kredensial nyata — lihat `lib/mock-data.ts`).
 * Tombolnya masuk lewat jalur login yang sama, cuma tanpa mengetik: saat demo ke
 * juri, mengetik password panjang itu risiko yang tidak perlu.
 */
const DEMO_ACCOUNTS = [
  {
    role: "Kepala SPPG",
    username: "sppg.head@demo.local",
    password: "Demo#SPPG2026",
    detail: "DKI Jakarta · bisa approve",
    recommended: true,
  },
  {
    role: "Ahli Gizi SPPG",
    username: "sppg.nutritionist@demo.local",
    password: "Demo#Nut2026",
    detail: "Jawa Barat (Bogor) · bisa approve",
    recommended: false,
  },
  {
    role: "Monitor BGN",
    username: "bgn.monitor@demo.local",
    password: "Demo#BGN2026",
    detail: "Semua wilayah · read-only",
    recommended: false,
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [quickPending, setQuickPending] = useState<string | null>(null);
  // Sebelum React ter-hydrate, tombol submit akan memicu submit native browser
  // (metode GET) sehingga username/password bocor ke URL. Tombol karena itu
  // dinonaktifkan sampai halaman siap.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (values: LoginFormValues) => {
    setError(null);
    try {
      await login(values.username, values.password);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    }
  };

  /** Masuk dengan akun demo tanpa mengetik — jalur login yang sama, bukan bypass. */
  const quickLogin = async (username: string, password: string) => {
    setError(null);
    setQuickPending(username);
    try {
      await login(username, password);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setQuickPending(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Panel produk: konteks dulu, form kemudian. */}
      <aside className="relative flex flex-col justify-between gap-8 overflow-hidden bg-brand px-8 py-10 text-white lg:w-[46%] lg:px-12 lg:py-14">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-white/85">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            MealChain Guardian
          </p>
          <h2 className="mt-5 text-2xl font-semibold leading-tight lg:text-3xl">
            Rantai pasokan pangan institusional yang bisa dipertanggungjawabkan.
          </h2>
          <p className="mt-3 max-w-md text-white/85">
            Tiap keputusan punya bukti, batas waktu, dan jejak audit — dari deteksi
            defisit sampai penyesuaian skor pemasok.
          </p>

          <ol className="mt-8 flex flex-wrap gap-2" aria-label="Tahap alur agent">
            {AGENT_CHAIN.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium tracking-wide"
              >
                <span className="text-white/60" aria-hidden>
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <p className="max-w-md text-xs text-white/75">
          Data pada demo ini adalah simulasi (mock SAP), bukan data instansi nyata.
          Angka keamanan pangan tidak pernah dihitung di sisi tampilan.
        </p>
      </aside>

      {/* Form */}
      <main className="flex flex-1 items-center justify-center bg-navy-100/40 p-6 lg:p-10">
        <div className="w-full max-w-sm">
          <div className="animate-fade-up rounded-xl border border-border bg-card p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-navy-900">Masuk</h1>
            <p className="mb-6 text-muted-foreground">
              Gunakan akun SPPG atau monitoring untuk melanjutkan.
            </p>

            <form
              onSubmit={handleSubmit(onSubmit)}
              method="post"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="username"
                  className="text-sm font-medium text-navy-900"
                >
                  Email / Username
                </label>
                <input
                  id="username"
                  autoComplete="username"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-navy-900 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                  {...register("username")}
                />
                {errors.username && (
                  <p className="flex items-center gap-1.5 text-sm text-navy-900">
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-danger"
                      aria-hidden
                    />
                    {errors.username.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-navy-900"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-navy-900 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="flex items-center gap-1.5 text-sm text-navy-900">
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-danger"
                      aria-hidden
                    />
                    {errors.password.message}
                  </p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-navy-900"
                >
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isSubmitting || !mounted}>
                {isSubmitting ? "Memproses…" : "Masuk"}
              </Button>
            </form>
          </div>

          {/* Akun demo: satu klik, tanpa mengetik — penting saat demo ke juri. */}
          <div className="animate-fade-up mt-5 rounded-xl border border-border bg-card/70 p-4">
            <p className="text-sm font-medium text-navy-900">
              Akun demo (klik untuk langsung masuk)
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  disabled={!mounted || quickPending !== null}
                  onClick={() =>
                    void quickLogin(account.username, account.password)
                  }
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60",
                    account.recommended
                      ? "border-brand/40 bg-brand/[0.05] hover:border-brand/60"
                      : "border-border hover:border-navy-700/30",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-navy-900">
                      {account.role}
                      {account.recommended && (
                        <span className="ml-2 text-xs font-normal text-brand">
                          disarankan
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {account.username} · {account.detail}
                    </span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-brand"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Password demo: <span className="font-mono">Demo#SPPG2026</span> ·{" "}
              <span className="font-mono">Demo#Nut2026</span> ·{" "}
              <span className="font-mono">Demo#BGN2026</span>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
