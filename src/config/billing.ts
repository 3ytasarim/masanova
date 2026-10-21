import type { TenantPlan } from "@prisma/client";
import type { Feature } from "@/config/plans";

/**
 * Abonelik politikası (Sprint 20) — merkezi. Faturalama sağlayıcısı YOK: abonelikleri Super Admin elle yönetir.
 *
 *  - Deneme: yeni işletme DEFAULT_TRIAL_DAYS gün TRIAL_PLAN ile başlar (Super Admin başka paket seçebilir). Panelden
 *    deneme BAŞLATILAMAZ / uzatılamaz (yalnızca Super Admin) — deneme istismarı yok.
 *  - Deneme bitince: ek süre YOK → FALLBACK_PLAN (STARTER). Veri silinmez; QR menü açık kalır (hata: trial_expired).
 *  - Ücretli dönem bitince (ya da "ödeme gecikti" işaretlenince): GRACE_DAYS gün ek süre. Ek sürede abone olunan paket
 *    sürer, YALNIZCA maliyetli AI özellikleri (GRACE_DISABLED_FEATURES) kapanır. Ek süre bitince FALLBACK_PLAN
 *    (hata: subscription_expired). Dönem sonunda iptal planlanmışsa ek süre verilmez.
 *  - Faturalama askıya alma (SUSPENDED): FALLBACK_PLAN. İşletmenin operasyonel durumu (Tenant.status) ayrıdır.
 */
export const DEFAULT_TRIAL_DAYS = 14;
export const TRIAL_PLAN: TenantPlan = "AI";
export const GRACE_DAYS = 7;
export const FALLBACK_PLAN: TenantPlan = "STARTER";
export const GRACE_DISABLED_FEATURES: readonly Feature[] = ["voice_ai", "business_advisor"];
/** Deneme / dönem sonu yaklaşırken sahibine uyarı (gün). */
export const ENDING_SOON_DAYS = 3;
/** Limit uyarı eşikleri (yüzde) — engel yalnızca %100'de. */
export const LIMIT_WARNING_THRESHOLDS = [80, 90, 100] as const;
export const UPGRADE_CONTACT = { label: "Paket yükseltmek için iletişime geçin", href: "/#demo" } as const;
