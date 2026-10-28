import "server-only";
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import type { PublicMenuStyleKey } from "@/lib/public-menu/types";
import type { TenantScope } from "@/lib/tenant/scope";
import { MEDIA_ASSET_SELECT, resolveImage } from "@/server/media/urls";
import { getPublishedMenu, type PublishedMenu } from "@/server/services/menu/public-menu.service";

/**
 * Public menü önbelleği (okuma ağırlıklı; her QR açılışında veritabanına gidilmez).
 *
 * Anahtar: ["public-menu", tenantId, branchId, locale] — kiracı kimliği HER anahtarda; iki kiracının verisi aynı
 * girdiye asla düşemez (anahtar yalnızca güvenilir kapsamdan üretilir, istemci girdisinden değil).
 * Etiket: public-menu:<tenantId> — o kiracının tüm şube/dil girdileri tek etiketle geçersiz kılınır.
 * Geçersiz kılma: menü / tema / şube eylemleri (Server Action) → invalidatePublicMenu (updateTag: anında, okuyan
 * kendi değişikliğini görür). Emniyet ağı: 5 dk süre sonu.
 * Önbelleğe ALINMAYANLAR: QR token doğrulaması, masa/şube aktifliği (her istekte canlı kontrol).
 */
export const PUBLIC_MENU_REVALIDATE_SECONDS = 300;

export function publicMenuTag(tenantId: string): string {
  return `public-menu:${tenantId}`;
}

/** Önbellek anahtarı — testte kiracı/şube/dil ayrımı doğrulanır. */
export function publicMenuCacheKey(tenantId: string, branchId: string | null, locale: string): string[] {
  return ["public-menu", tenantId, branchId ?? "-", locale];
}

export function getCachedPublishedMenu(scope: TenantScope, options: { branchId: string | null; locale: string }): Promise<PublishedMenu> {
  const tenantId = scope.tenantId;
  return unstable_cache(() => getPublishedMenu(scope, options), publicMenuCacheKey(tenantId, options.branchId, options.locale), {
    tags: [publicMenuTag(tenantId)],
    revalidate: PUBLIC_MENU_REVALIDATE_SECONDS,
  })();
}

export type PublicPresentation = {
  restaurantName: string;
  defaultLocale: string;
  /** Gösterilecek logo: yüklenen varlık, yoksa harici adres. */
  logoUrl: string | null;
  /** Panel düzenleyicisi: harici (https) logo adresi ve yüklenen logo var mı. */
  logoExternalUrl: string | null;
  logoManaged: boolean;
  primaryColor: string | null;
  accentColor: string | null;
  style: PublicMenuStyleKey;
  welcomeText: string | null;
  googleReviewUrl: string | null;
  heroImageUrl: string | null;
  heroExternalUrl: string | null;
  heroManaged: boolean;
  showNutrition: boolean;
  showAllergens: boolean;
  showIngredients: boolean;
  showPreparationTime: boolean;
  showPoweredBy: boolean;
};

/** Kiracının public sunum ayarları (önbelleksiz — panel düzenleyicisi ve önbellekli sürüm kullanır). */
export async function loadPublicPresentation(scope: TenantScope): Promise<PublicPresentation> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    select: {
      name: true,
      settings: { select: { logoUrl: true, logoAsset: { select: MEDIA_ASSET_SELECT }, primaryColor: true, accentColor: true, defaultLocale: true } },
      publicMenuSettings: { include: { heroAsset: { select: MEDIA_ASSET_SELECT } } },
    },
  });
  const p = tenant.publicMenuSettings;
  return {
    restaurantName: tenant.name,
    defaultLocale: tenant.settings?.defaultLocale ?? "tr",
    logoUrl: resolveImage(tenant.settings?.logoAsset, tenant.settings?.logoUrl)?.url ?? null,
    logoExternalUrl: tenant.settings?.logoUrl ?? null,
    logoManaged: !!tenant.settings?.logoAsset,
    primaryColor: tenant.settings?.primaryColor ?? null,
    accentColor: tenant.settings?.accentColor ?? null,
    style: p?.style ?? "MODERN",
    welcomeText: p?.welcomeText ?? null,
    googleReviewUrl: p?.googleReviewUrl ?? null,
    heroImageUrl: resolveImage(p?.heroAsset, p?.heroImageUrl)?.url ?? null,
    heroExternalUrl: p?.heroImageUrl ?? null,
    heroManaged: !!p?.heroAsset,
    showNutrition: p?.showNutrition ?? true,
    showAllergens: p?.showAllergens ?? true,
    showIngredients: p?.showIngredients ?? true,
    showPreparationTime: p?.showPreparationTime ?? true,
    showPoweredBy: p?.showPoweredBy ?? true,
  };
}

export function getCachedPublicPresentation(scope: TenantScope): Promise<PublicPresentation> {
  return unstable_cache(() => loadPublicPresentation(scope), ["public-presentation", scope.tenantId], {
    tags: [publicMenuTag(scope.tenantId)],
    revalidate: PUBLIC_MENU_REVALIDATE_SECONDS,
  })();
}

/**
 * Kiracının public menü önbelleğini geçersiz kılar. Server Action içinde updateTag (anında); başka bağlamlarda
 * (ör. route handler, betik) revalidateTag ile hemen sona erdirir.
 */
export function invalidatePublicMenu(tenantId: string, context: "action" | "other" = "action"): void {
  try {
    if (context === "action") updateTag(publicMenuTag(tenantId));
    else revalidateTag(publicMenuTag(tenantId), { expire: 0 });
  } catch (error) {
    // Next istek bağlamı dışında (testler, seed) önbellek yoktur; sessizce geç.
    if (!(error instanceof Error) || !/static generation store|outside a request scope|was called outside/i.test(error.message)) throw error;
  }
  // Sesli menü dizini: menü değişti → eskimiş + gecikmeli yeniden kurulum (döngüsel içe aktarma olmasın diye dinamik).
  void import("@/server/services/ai/voice-index.service").then((m) => m.scheduleVoiceIndexRefresh(tenantId)).catch(() => undefined);
  // Panel düzenlemesi: yeni / değişen ürünlerin eksik çevirileri arka planda (art arda düzenlemeler tek işte toplanır).
  if (context === "action")
    void import("@/server/services/menu/auto-translate.service").then((m) => m.scheduleMenuAutoTranslate(tenantId, { force: true, delayMs: 30_000 })).catch(() => undefined);
}
