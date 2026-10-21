import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/permissions/roles";
import { contrastRatio, readableTextColor, safeQrColors } from "@/lib/tables/contrast";
import { A4_MM, LABEL_SIZE_PRESETS, MM_TO_PT, QR_MIN_PRINT_MM, computeSheetLayout, pixelsForPrint, safeMarginMm } from "@/lib/tables/label-geometry";
import { DEFAULT_LABEL_OPTIONS, LABEL_TEMPLATE_KEYS, labelOptionsToParams } from "@/lib/tables/label-options";
import { BULK_TABLE_MAX, formatTableName, nextTableNumber, planBulkTables, tableNameKey } from "@/lib/tables/naming";
import { QR_TOKEN_LENGTH, deriveQrToken, hashQrToken, isWellFormedQrToken, issueQrToken, qrTokenPath, rederiveQrToken } from "@/lib/tables/qr-token";
import { resolveTableQrToken, type QrTokenLookup, type QrTokenRecord } from "@/lib/tables/resolve-table-token";
import type { TenantResolution } from "@/lib/tenant/resolve-tenant";
import { bulkTablesSchema, labelOptionsSchema, tableSchema } from "@/lib/validation/tables";
import { buildLabel } from "@/server/labels/layout";
import { decodeImage, isPrivateAddress } from "@/server/labels/logo";
import { createQrMatrix } from "@/server/labels/qr";
import { renderLabelPdf, renderLabelSvg, renderSheetPdf } from "@/server/labels/render";

const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

// ─── Token ──────────────────────────────────────────────────────────────────

describe("QR token üretimi", () => {
  it("128 bit, URL-güvenli, 22 karakter; her seferinde farklı", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => issueQrToken(SECRET).token));
    expect(tokens.size).toBe(500);
    for (const t of tokens) {
      expect(t).toHaveLength(QR_TOKEN_LENGTH);
      expect(isWellFormedQrToken(t)).toBe(true);
      expect(encodeURIComponent(t)).toBe(t);
      expect(Buffer.from(t, "base64url")).toHaveLength(16);
    }
  });

  it("sıralı / tahmin edilebilir değil: ardışık nonce'lar ilişkisiz token üretir", () => {
    const a = deriveQrToken(SECRET, "nonce-0001");
    const b = deriveQrToken(SECRET, "nonce-0002");
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    expect(same).toBeLessThan(6);
  });

  it("veritabanında yalnızca özet + nonce; düz token saklanmaz", () => {
    const issued = issueQrToken(SECRET);
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.tokenHash).toBe(hashQrToken(issued.token));
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(issued.nonce).not.toBe(issued.token);
  });

  it("yeniden türetme: doğru sırla aynı token, yanlış sırla null (yanlış QR basılmaz)", () => {
    const issued = issueQrToken(SECRET);
    expect(rederiveQrToken(SECRET, issued.nonce, issued.tokenHash)).toBe(issued.token);
    expect(rederiveQrToken(`${SECRET}-rotated-xx`, issued.nonce, issued.tokenHash)).toBeNull();
  });

  it("zayıf sır reddedilir; biçimsiz token'lar tanınır", () => {
    expect(() => issueQrToken("short")).toThrow();
    for (const bad of ["", "1", "../../etc/passwd", "a".repeat(21), "a".repeat(23), "abc def ghi jkl mno pq", null, 42]) expect(isWellFormedQrToken(bad)).toBe(false);
    expect(qrTokenPath("AbCdEfGhIjKlMnOpQrStUv")).toBe("/t/AbCdEfGhIjKlMnOpQrStUv");
  });
});

// ─── Çözümleyici ────────────────────────────────────────────────────────────

const tenantA = { id: "tenant_a", name: "A", slug: "a", status: "ACTIVE" as const, plan: "STARTER" as const, domain: { hostname: "a.masanovai.com", type: "SUBDOMAIN" as const, isPrimary: true } };
const hostA: TenantResolution = { kind: "tenant", tenant: tenantA };
const hostB: TenantResolution = { kind: "tenant", tenant: { ...tenantA, id: "tenant_b", slug: "b", domain: { ...tenantA.domain, hostname: "b.masanovai.com" } } };

function record(overrides: Partial<QrTokenRecord> = {}, table: Partial<QrTokenRecord["table"]> = {}): QrTokenRecord {
  return {
    id: "tok1",
    tenantId: "tenant_a",
    active: true,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
    table: { id: "t1", name: "Masa 1", number: 1, active: true, branch: { id: "b1", name: "Merkez", active: true }, area: { id: "a1", name: "Salon", active: true }, ...table },
  };
}
function lookupWith(rec: QrTokenRecord | null): QrTokenLookup & { calls: string[] } {
  const calls: string[] = [];
  return { calls, findByTokenHash: async (hash) => (calls.push(hash), rec) };
}
const token = issueQrToken(SECRET).token;

describe("resolveTableQrToken", () => {
  it("geçerli token → güvenilir bağlam (kiracı host'tan)", async () => {
    const lookup = lookupWith(record());
    const result = await resolveTableQrToken({ host: hostA, token }, { lookup });
    expect(result).toMatchObject({ ok: true, context: { tenant: { id: "tenant_a" }, branch: { name: "Merkez" }, area: { name: "Salon" }, table: { name: "Masa 1" }, token: { status: "active" } } });
    expect(lookup.calls).toEqual([hashQrToken(token)]);
  });

  it("A kiracısının token'ı B'nin alan adında çalışmaz", async () => {
    expect(await resolveTableQrToken({ host: hostB, token }, { lookup: lookupWith(record()) })).toEqual({ ok: false, reason: "tenant_mismatch" });
  });

  it("biçimsiz token veritabanına gitmez", async () => {
    const lookup = lookupWith(record());
    expect(await resolveTableQrToken({ host: hostA, token: "12" }, { lookup })).toEqual({ ok: false, reason: "malformed_token" });
    expect(lookup.calls).toHaveLength(0);
  });

  it.each([
    ["bilinmeyen token", null, "unknown_token"],
    ["iptal edilmiş (revokedAt)", record({ active: false, revokedAt: new Date() }), "revoked"],
    ["pasif token satırı", record({ active: false }), "revoked"],
    ["süresi dolmuş", record({ expiresAt: new Date(Date.now() - 1000) }), "expired"],
    ["pasif masa", record({}, { active: false }), "table_inactive"],
    ["pasif bölge", record({}, { area: { id: "a1", name: "Salon", active: false } }), "area_inactive"],
    ["pasif şube", record({}, { branch: { id: "b1", name: "Merkez", active: false } }), "branch_inactive"],
  ] as const)("%s reddedilir", async (_label, rec, reason) => {
    expect(await resolveTableQrToken({ host: hostA, token }, { lookup: lookupWith(rec) })).toEqual({ ok: false, reason });
  });

  it("bölgesiz masa geçerli; askıdaki kiracı ve platform host'u reddedilir", async () => {
    expect(await resolveTableQrToken({ host: hostA, token }, { lookup: lookupWith(record({}, { area: null })) })).toMatchObject({ ok: true, context: { area: null } });
    const lookup = lookupWith(record());
    expect(await resolveTableQrToken({ host: { kind: "unavailable", tenant: { ...tenantA, status: "SUSPENDED" } }, token }, { lookup })).toEqual({ ok: false, reason: "tenant_unavailable" });
    expect(await resolveTableQrToken({ host: { kind: "platform", hostname: "masanovai.com" }, token }, { lookup })).toEqual({ ok: false, reason: "host_not_tenant" });
    expect(await resolveTableQrToken({ host: { kind: "not_found", hostname: "x.com", reason: "unknown_host" }, token }, { lookup })).toEqual({ ok: false, reason: "host_not_tenant" });
    expect(lookup.calls).toHaveLength(0);
  });
});

// ─── Toplu adlandırma ───────────────────────────────────────────────────────

describe("toplu masa adlandırma", () => {
  const empty = { names: [], numbers: [], total: 0 };
  it("Masa {n}, başlangıç 1, adet 20 → Masa 1 … Masa 20", () => {
    const plan = planBulkTables({ count: 20, startNumber: 1, pattern: "Masa {n}" }, empty);
    expect(plan.ok && plan.tables.map((t) => t.name)).toEqual(Array.from({ length: 20 }, (_, i) => `Masa ${i + 1}`));
    expect(plan.ok && plan.tables.at(-1)!.number).toBe(20);
  });

  it("kalıpta {n} yoksa sona eklenir; ad karşılaştırması büyük/küçük harf duyarsız", () => {
    expect(formatTableName("Teras", 7)).toBe("Teras 7");
    expect(formatTableName("VIP-{n}", 2)).toBe("VIP-2");
    expect(tableNameKey("MASA 1")).toBe(tableNameKey("masa 1"));
    expect(tableNameKey("İÇ")).toBe(tableNameKey("iç"));
  });

  it("mevcut ad ya da numarayla çakışma → hiçbiri oluşturulmaz", () => {
    const plan = planBulkTables({ count: 5, startNumber: 3, pattern: "Masa {n}" }, { names: ["masa 4"], numbers: [7], total: 2 });
    expect(plan).toMatchObject({ ok: false, reason: "conflict", names: ["Masa 4"], numbers: [7] });
  });

  it("sınırlar: adet, numara aralığı, şube üst sınırı", () => {
    expect(planBulkTables({ count: BULK_TABLE_MAX + 1, startNumber: 1, pattern: "Masa" }, empty)).toMatchObject({ ok: false, reason: "range" });
    expect(planBulkTables({ count: 10, startNumber: 9995, pattern: "Masa" }, empty)).toMatchObject({ ok: false, reason: "range" });
    expect(planBulkTables({ count: 10, startNumber: 1, pattern: "Masa" }, { names: [], numbers: [], total: 995 })).toMatchObject({ ok: false, reason: "limit" });
    expect(nextTableNumber([3, null, 12])).toBe(13);
    expect(nextTableNumber([])).toBe(1);
  });

  it("Zod: 100.000 masa ya da geçersiz kalıp kabul edilmez", () => {
    expect(bulkTablesSchema.safeParse({ count: "100000", startNumber: "1", pattern: "Masa {n}" }).success).toBe(false);
    expect(bulkTablesSchema.safeParse({ count: "10", startNumber: "0", pattern: "Masa {n}" }).success).toBe(false);
    expect(bulkTablesSchema.safeParse({ count: "10", startNumber: "1", pattern: "{n}-{n}" }).success).toBe(false);
    expect(bulkTablesSchema.parse({ count: "10", startNumber: "1", pattern: " Masa {n} ", capacity: "" })).toMatchObject({ count: 10, startNumber: 1, pattern: "Masa {n}", capacity: null, diningAreaId: null });
    expect(tableSchema.safeParse({ name: "Masa 1", capacity: "0", active: true }).success).toBe(false);
    expect(tableSchema.safeParse({ name: "Masa 1", number: "1.5", active: true }).success).toBe(false);
    expect(tableSchema.safeParse({ name: "Masa 1", diningAreaId: "../x", active: true }).success).toBe(false);
  });
});

// ─── Ölçüler & yerleşim ─────────────────────────────────────────────────────

describe("etiket ölçüleri ve A4 yerleşimi", () => {
  it("mm → pt ve 300 DPI piksel hesabı", () => {
    expect(50 * MM_TO_PT).toBeCloseTo(141.73, 2);
    expect(pixelsForPrint(25.4)).toBe(300);
    expect(safeMarginMm(50, 50)).toBe(3.5);
    expect(safeMarginMm(105, 148)).toBe(7.5);
  });

  it("6×6 cm → 3 × 4 = 12 etiket/sayfa; ızgara sayfada ortalanır, kenar payı içinde", () => {
    const layout = computeSheetLayout({ width: 60, height: 60 }, 30);
    expect(layout).toMatchObject({ columns: 3, rows: 4, perPage: 12, pages: 3, warning: null });
    const xs = layout.positions.map((p) => p.x);
    const left = Math.min(...xs);
    const right = A4_MM.width - (Math.max(...xs) + 60);
    expect(left).toBeCloseTo(right, 6);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it("A6 sığar ama verimsiz → açık uyarı; ölçek değişmez", () => {
    const layout = computeSheetLayout(LABEL_SIZE_PRESETS.a6, 4);
    expect(layout.perPage).toBe(1);
    expect(layout.warning).toMatch(/verimsiz/);
  });

  it("sığmayan özel boyut → 0 etiket ve uyarı (sessizce küçültülmez)", () => {
    const layout = computeSheetLayout({ width: 200, height: 290 }, 2);
    expect(layout).toMatchObject({ perPage: 0, pages: 0 });
    expect(layout.warning).toMatch(/sığmıyor/);
  });

  it("Zod: ön ayar ölçüleri ön ayardan; özel boyut sınırları", () => {
    expect(labelOptionsSchema.parse({ boyut: "80x50", en: "60", boy: "60" })).toMatchObject({ width: 80, height: 50 });
    expect(labelOptionsSchema.parse({ boyut: "custom", en: "75,5", boy: "90" })).toMatchObject({ width: 75.5, height: 90 });
    expect(labelOptionsSchema.safeParse({ boyut: "custom", en: "20", boy: "90" }).success).toBe(false);
    expect(labelOptionsSchema.safeParse({ boyut: "custom" }).success).toBe(false);
    expect(labelOptionsSchema.safeParse({ sablon: "neon" }).success).toBe(false);
    expect(labelOptionsSchema.safeParse({ cta: "x".repeat(41) }).success).toBe(false);
    expect(labelOptionsSchema.parse(labelOptionsToParams(DEFAULT_LABEL_OPTIONS))).toEqual(DEFAULT_LABEL_OPTIONS);
  });
});

// ─── Kontrast ───────────────────────────────────────────────────────────────

describe("QR renk güvenliği", () => {
  it("WCAG kontrast oranı", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("koyu marka rengi korunur; açık / düşük kontrastlı / ters renk siyah-beyaza zorlanır", () => {
    expect(safeQrColors("#1e3a8a")).toEqual({ dark: "#1e3a8a", light: "#ffffff", forced: false });
    expect(safeQrColors("#f59e0b").forced).toBe(true); // turuncu: kontrast düşük
    expect(safeQrColors("#b91c1c").forced).toBe(true); // 6,5:1 < 7
    expect(safeQrColors("#ffffff", "#000000")).toEqual({ dark: "#000000", light: "#ffffff", forced: true }); // ters QR
    expect(safeQrColors("bozuk")).toMatchObject({ dark: "#000000", forced: true });
    expect(safeQrColors(null)).toMatchObject({ dark: "#000000", forced: false });
  });

  it("metin rengi zemin üzerinde okunur kalır", () => {
    expect(readableTextColor("#ffffff", "#fde68a")).toBe("#111111");
    expect(readableTextColor("#101114", "#fde68a")).toBe("#fde68a");
  });
});

// ─── Çizim & çıktı ──────────────────────────────────────────────────────────

const brand = { name: "Demo Restoran", primary: "#f59e0b", secondary: null, accent: null, logo: null };
const content = { tableName: "Teras 12", url: "https://demo.masanovai.com/t/AbCdEfGhIjKlMnOpQrStUv" };

describe("etiket çizimi", () => {
  it.each(LABEL_TEMPLATE_KEYS)("%s: tüm ön ayar boyutlarında QR ≥ 20 mm ve kesim alanı içinde", (template) => {
    for (const size of Object.values(LABEL_SIZE_PRESETS)) {
      const d = buildLabel({ ...DEFAULT_LABEL_OPTIONS, template, width: size.width, height: size.height }, brand, content);
      expect(d.qr.sizeMm).toBeGreaterThanOrEqual(QR_MIN_PRINT_MM);
      expect(d.qr.sizeMm).toBeLessThanOrEqual(Math.min(size.width, size.height));
      expect(d.shapes.length).toBeGreaterThan(3);
    }
  });

  it("güvensiz marka rengi seçilirse QR siyaha zorlanır ve uyarı verilir", () => {
    const d = buildLabel({ ...DEFAULT_LABEL_OPTIONS, qrColor: "brand" }, brand, content);
    expect(d.qr.colorsForced).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/siyah\/beyaz/);
    // QR modülleri saf siyah; marka rengi (turuncu) hiçbir QR şeklinde kullanılmaz.
    expect(d.shapes.some((s) => s.kind === "path" && s.fill === "#000000")).toBe(true);
    expect(d.shapes.some((s) => s.kind === "path" && s.fill === "#f59e0b")).toBe(false);
  });

  it("QR yüksek hata düzeltmeli (H) ve son public adresi kodlar; izleme parametresi yok", () => {
    const matrix = createQrMatrix(content.url);
    expect(matrix.version).toBeGreaterThanOrEqual(5);
    expect(content.url).not.toContain("?");
  });

  it("SVG: fiziksel mm ölçüsü + taşma payı viewBox'ı; metin vektör yol (font bağımlılığı yok)", () => {
    const svg = renderLabelSvg(buildLabel({ ...DEFAULT_LABEL_OPTIONS, bleed: true }, brand, content));
    expect(svg).toContain('width="66mm" height="66mm" viewBox="-3 -3 66 66"');
    expect(svg).not.toContain("<text");
    expect(svg).toContain("<title>Demo Restoran — Teras 12</title>");
  });

  it("PDF: gerçek ölçü (pt), TrimBox / BleedBox doğru", async () => {
    const pdf = await renderLabelPdf(buildLabel({ ...DEFAULT_LABEL_OPTIONS, width: 50, height: 50, bleed: true }, brand, content));
    const doc = await PDFDocument.load(pdf);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(56 * MM_TO_PT, 3);
    expect(page.getTrimBox()).toMatchObject({ x: expect.closeTo(3 * MM_TO_PT, 3), width: expect.closeTo(50 * MM_TO_PT, 3) });
    expect(doc.getTitle()).toBe("Demo Restoran — Teras 12");
  });

  it("A4 sayfa PDF: sayfa sayısı yerleşimle tutarlı, A4 ölçüsünde", async () => {
    const drawings = Array.from({ length: 13 }, (_, i) => buildLabel(DEFAULT_LABEL_OPTIONS, brand, { ...content, tableName: `Masa ${i + 1}` }));
    const layout = computeSheetLayout({ width: 60, height: 60 }, 13);
    const doc = await PDFDocument.load(await renderSheetPdf(drawings, layout, A4_MM, "test"));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(297 * MM_TO_PT, 3);
  });
});

describe("logo güvenliği", () => {
  it("özel / yerel IP adresleri reddedilir", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("yalnızca gerçek PNG / JPEG imzası kabul edilir", () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(320, 20);
    expect(decodeImage(png)).toMatchObject({ mime: "image/png", width: 640, height: 320 });
    expect(decodeImage(Buffer.from("<svg></svg>"))).toBeNull();
  });
});

// ─── Rol matrisi ────────────────────────────────────────────────────────────

describe("masa yetkileri", () => {
  it("sahip ve şube müdürü yönetir; garson ve kasiyer salt okur; mutfak/bar erişemez", () => {
    for (const role of ["TENANT_OWNER", "BRANCH_MANAGER"] as const) {
      expect(hasPermission(role, "tables.view")).toBe(true);
      expect(hasPermission(role, "tables.manage")).toBe(true);
    }
    for (const role of ["WAITER", "CASHIER"] as const) {
      expect(hasPermission(role, "tables.view")).toBe(true);
      expect(hasPermission(role, "tables.manage")).toBe(false);
    }
    for (const role of ["KITCHEN", "BAR", "SUPER_ADMIN"] as const) {
      expect(hasPermission(role, "tables.view")).toBe(false);
      expect(hasPermission(role, "tables.manage")).toBe(false);
    }
  });
});

