import "server-only";
import { Prisma } from "@prisma/client";
import { translatableLocales } from "@/config/menu";
import { prisma } from "@/lib/db/prisma";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { buildAuditRow, type AuditEvent } from "@/server/services/audit.service";

/**
 * Menü servislerinin ortak parçaları. Aktör her zaman requireTenantUser({ permission: "menu.manage",
 * write: true }) sonucundan kurulur; kapsam (tenantId) asla girdiden gelmez.
 */
export type MenuActor = { userId: string; scope: TenantScope; meta: RequestMeta };

export function menuAudit(actor: MenuActor, event: Omit<AuditEvent, "tenantId" | "userId">) {
  return buildAuditRow({ ...event, tenantId: actor.scope.tenantId, userId: actor.userId }, actor.meta);
}

export type MenuLocaleConfig = { defaultLocale: string; currency: string; translatable: string[] };

export async function getMenuLocaleConfig(scope: TenantScope): Promise<MenuLocaleConfig> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: scope.tenantId },
    select: { defaultLocale: true, defaultCurrency: true },
  });
  const defaultLocale = settings?.defaultLocale ?? "tr";
  return { defaultLocale, currency: settings?.defaultCurrency ?? "TRY", translatable: translatableLocales(defaultLocale) };
}

/**
 * Çeviri girdisini planlar: varsayılan dil ve desteklenmeyen diller atılır; tamamen boş diller silinir.
 * `requiredField` boşsa (ör. ad) o dilin satırı silinir — yarım çeviri tutulmaz.
 */
export function planTranslations<V extends Record<string, string | null>>(
  input: Partial<Record<string, V>>,
  allowedLocales: readonly string[],
  requiredField: keyof V,
): { upserts: { locale: string; values: V }[]; deletes: string[] } {
  const upserts: { locale: string; values: V }[] = [];
  const deletes: string[] = [];
  for (const locale of allowedLocales) {
    const values = input[locale];
    if (!values || !values[requiredField]) {
      if (values !== undefined) deletes.push(locale);
      continue;
    }
    upserts.push({ locale, values });
  }
  return { upserts, deletes };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Sıralı listede iki kaydın sortOrder'ını takas etmek için normalize edilmiş sıra değerleri. */
export function swapOrders<T extends { id: string }>(ordered: readonly T[], id: string, direction: "up" | "down"): { id: string; sortOrder: number }[] | null {
  const index = ordered.findIndex((item) => item.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ordered.length) return null;
  const ids = ordered.map((item) => item.id);
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  return ids.map((itemId, i) => ({ id: itemId, sortOrder: (i + 1) * 10 }));
}
