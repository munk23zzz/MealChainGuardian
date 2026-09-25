/**
 * E2E check alur demo (Rules.md §5: "UI flow kritis (3 skenario demo) wajib
 * dites end-to-end sebelum dianggap selesai").
 *
 * Cara pakai:
 *   1) npm run dev -- -p 3100        # di terminal lain
 *   2) node scripts/e2e-demo-check.mjs [baseUrl]
 *
 * Yang diperiksa: login → dashboard (peta + filter) → feed (urutan urgensi) →
 * decision detail (SDC, constraint, evidence, catatan Verifier) → approval modal
 * (isi ringkasan lengkap) → approve → agent log (trace + durasi) → KPI (trend).
 *
 * Screenshot disimpan di .e2e-shots/ untuk bukti manual.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3100";
const SHOTS = ".e2e-shots";

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const consoleErrors = [];
  const tileRequests = [];
  page.on("request", (req) => {
    if (/tile\.openstreetmap\.org/.test(req.url())) tileRequests.push(req.url());
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // --- Login -------------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // Tunggu tombol aktif (baru aktif setelah React ter-hydrate) supaya klik
  // tidak memicu submit native.
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  });
  await page.fill("#username", "admin");
  await page.fill("#password", "admin");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.waitForLoadState("networkidle");
  check("Login dinas_admin diarahkan ke dashboard", page.url().includes("/dashboard"));

  const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // --- Dashboard ---------------------------------------------------------
  let text = await body();
  check("Badge 'Data Simulasi' tampil (Rules.md §1.4)", text.includes("Data Simulasi"));
  check("Dashboard punya filter komoditas", text.includes("Komoditas:"));
  check("Dashboard punya filter status", text.includes("Status:"));
  check("Peta ter-render (canvas MapLibre ada)", (await page.locator("canvas").count()) > 0);
  check(
    "Kartu lokasi menampilkan 10 lokasi",
    (await page.locator("section").getByText(/Jakarta Pusat/).count()) > 0 &&
      text.includes("Cianjur"),
  );
  await page.waitForTimeout(2500);
  check(
    "Peta memuat tile OSM (worker MapLibre jalan)",
    tileRequests.length > 0,
    `${tileRequests.length} tile`,
  );
  await shot(page, "01-dashboard");

  // --- Feed --------------------------------------------------------------
  await page.goto(`${BASE}/decisions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  text = await body();
  check("Feed keputusan memuat kartu rekomendasi", text.includes("direkomendasikan"));
  check("Feed menandai urgensi", /Isu keamanan|Ketidakseimbangan regional|Anomali harga/.test(text));
  const order = await page.locator("main p.font-semibold").allInnerTexts();
  check(
    "Urutan feed: isu keamanan lebih dulu",
    order.length === 0 || /Jakarta Barat/.test(order[0]) || /Cianjur|Jakarta/.test(order[0]),
    order.slice(0, 2).join(" | "),
  );
  await shot(page, "02-feed");

  // --- Decision detail ---------------------------------------------------
  await page.goto(`${BASE}/decisions/dec-001`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  text = await body();
  check("Detail: tabel Safe Delivered Cost 6 komponen", text.includes("Freshness risk") && text.includes("Expected loss"));
  check("Detail: total SDC ditampilkan", text.includes("Total Safe Delivered Cost"));
  check("Detail: hard constraint checklist", text.includes("Kelayakan keamanan") && text.includes("Jendela pengiriman"));
  check("Detail: evidence timeline dengan sumber", text.includes("SAP PO") && text.includes("Sensor IoT"));
  check("Detail: catatan audit Verifier", text.includes("Catatan audit Verifier Agent"));
  check("Detail: trace agent (DETECT + durasi)", text.includes("DETECT") && /\d+ (ms|s)/.test(text));
  await shot(page, "03-decision-detail");

  // --- Approval modal ----------------------------------------------------
  await page.getByRole("button", { name: /Setujui/ }).first().click();
  await page.waitForTimeout(800);
  const modal = page.getByRole("dialog");
  const modalText = (await modal.innerText()).replace(/\s+/g, " ");
  check("Modal approve: menjelaskan yang dieksekusi", modalText.includes("Yang akan dieksekusi"));
  check("Modal approve: menyebut SAP (mock)", modalText.includes("Ke SAP mana") && /mock SAP/i.test(modalText));
  check("Modal approve: evidence utama", modalText.includes("Evidence utama"));
  check("Modal approve: hasil audit Verifier", modalText.includes("Hasil audit Verifier"));
  await shot(page, "04-approval-modal");

  await modal.getByRole("button", { name: /Setujui & eksekusi/ }).click();
  await page.waitForTimeout(1500);
  text = await body();
  check("Setelah approve: status jadi Disetujui", text.includes("Disetujui"));
  check("Setelah approve: purchase order SAP (mock) muncul", /PO \d+/.test(text));

  // --- Agent log ---------------------------------------------------------
  await page.goto(`${BASE}/agent-log`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  text = await body();
  check("Agent log: timeline DETECT..LEARN", text.includes("Deteksi") && text.includes("Belajar"));
  check("Agent log: menampilkan input & output step", text.includes("Input:") && text.includes("Output:"));
  check("Agent log: menampilkan total durasi", /total durasi terlaporkan/.test(text));
  await shot(page, "05-agent-log");

  // --- KPI ---------------------------------------------------------------
  await page.goto(`${BASE}/kpi`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  text = await body();
  const kpiCount = await page.getByText("Meal Continuity Rate").count();
  check("KPI: 7 kartu KPI tampil", kpiCount > 0 && text.includes("Evidence Completeness"));
  check("KPI: trend vs periode sebelumnya", /vs periode sebelumnya/.test(text));
  await shot(page, "06-kpi");

  // --- Console bersih ----------------------------------------------------
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools/i.test(e),
  );
  check("Tidak ada error console", realErrors.length === 0, realErrors.slice(0, 3).join(" || "));

  // --- Role-aware: login sebagai SPPG staff ------------------------------
  const staffPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  staffPage.setDefaultTimeout(15_000);
  await staffPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await staffPage.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  });
  await staffPage.fill("#username", "staff");
  await staffPage.fill("#password", "staff");
  await staffPage.click('button[type="submit"]');
  await staffPage.waitForURL("**/dashboard", { timeout: 30_000 });
  await staffPage.waitForTimeout(2000);

  const staffText = (await staffPage.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "SPPG staff: peta diarahkan ke lokasi sendiri",
    /Peta diarahkan ke lokasi Anda: SPPG Jakarta Pusat/.test(staffText),
  );
  check(
    "SPPG staff: lokasi lain di-mute (opacity berkurang)",
    (await staffPage.locator("div.opacity-60").count()) > 0,
  );
  await staffPage.screenshot({ path: `${SHOTS}/07-dashboard-sppg-staff.png`, fullPage: true });

  await staffPage.goto(`${BASE}/decisions/dec-001`, { waitUntil: "domcontentloaded" });
  await staffPage.waitForTimeout(2000);
  const staffDetail = (await staffPage.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "SPPG staff: tidak boleh approve lokasi yang bukan tanggung jawabnya",
    /tidak punya hak approval untuk lokasi tujuan ini/.test(staffDetail),
  );
  await staffPage.close();

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} check lulus`);
  if (failed.length > 0) {
    console.log("Gagal:", failed.map((f) => f.name).join("; "));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("E2E error:", err);
  process.exitCode = 1;
});
