import type { UserRole } from "@prisma/client";

/**
 * Rol → yetki matrisi. Arayüz (menü görünürlüğü) ve sunucu (guard'lar) aynı tabloyu okur;
 * ancak YETKİ KARARI her zaman sunucuda verilir — menüde gizlemek yalnızca kullanılabilirliktir.
 */
export const PERMISSIONS = [
  "platform.manage",
  "panel.view",
  "orders.view",
  "orders.manage",
  "menu.view",
  "menu.manage",
  "tables.view",
  "tables.manage",
  "orders.serve",
  "orders.cancel",
  "kds.view",
  "kds.manage",
  "stations.manage",
  "service.view",
  "service.manage",
  "service.bill",
  "service.override",
  "crm.view",
  "crm.manage",
  "loyalty.view",
  "loyalty.manage",
  "reservations.view",
  "reservations.manage",
  "reservations.override",
  "reservations.settings",
  "campaigns.view",
  "campaigns.manage",
  "payments.view",
  "payments.manage",
  "payments.refund",
  "ai.manage",
  "analytics.view",
  "analytics.export",
  "advisor.view",
  "advisor.manage",
  "branding.manage",
  "staff.manage",
  "settings.manage",
  /** Sprint 20 — abonelik sayfası: YALNIZCA işletme sahibi (müdür paket rozetini görür, abonelik ayrıntısını değil). */
  "billing.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const TENANT_ADMIN: readonly Permission[] = PERMISSIONS.filter((p) => p !== "platform.manage");

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set<Permission>(["platform.manage"]),
  TENANT_OWNER: new Set(TENANT_ADMIN),
  BRANCH_MANAGER: new Set(TENANT_ADMIN.filter((p) => p !== "branding.manage" && p !== "settings.manage" && p !== "billing.view")),
  // İşletme analitiği (satış, ürün, masa, operasyon, servis, AI) yalnızca sahip ve şube müdüründe (TENANT_ADMIN listesinden
  // gelir). Kasiyer / garson / mutfak / bar tam işletme analitiğini görmez; personel sıralaması zaten yoktur.
  // Rezervasyon: garson görür + yönetir (onay / masaya alma / walk-in), kasiyer yalnızca görür; kural aşma (override)
  // ve ayarlar sahip / müdürde. Mutfak / bar rezervasyon görmez.
  // CRM / sadakat (müşteri kişisel verisi) yalnızca sahip ve şube müdüründe; kasiyer / garson / mutfak / bar müşteri
  // iletişim bilgisi görmez (veri minimizasyonu). Operasyon rolleri menüyü yalnızca görüntüler (fiyat, alerjen, içerik bilgisi); düzenleyemez.
  // Garson ve kasiyer masa listesini salt okunur görür (QR adresi / token göremez); mutfak ve bar masa yönetimine erişmez.
  // Kasiyer servis panosunu görür, yalnızca HESAP taleplerini üstlenir / tamamlar (tip denetimi sunucuda).
  CASHIER: new Set<Permission>(["panel.view", "menu.view", "tables.view", "orders.view", "orders.manage", "service.view", "service.bill", "reservations.view", "payments.view", "payments.manage", "payments.refund"]),
  // Garson hazır siparişi "servis edildi" yapar; mutfak fişlerini değiştiremez.
  WAITER: new Set<Permission>(["panel.view", "menu.view", "tables.view", "orders.view", "orders.manage", "orders.serve", "service.view", "service.manage", "reservations.view", "reservations.manage"]),
  // Mutfak / bar: KDS fişlerini ilerletir; istasyon ayarlarını, sipariş kabul / servis / iptali değiştiremez.
  KITCHEN: new Set<Permission>(["panel.view", "menu.view", "orders.view", "kds.view", "kds.manage"]),
  BAR: new Set<Permission>(["panel.view", "menu.view", "orders.view", "kds.view", "kds.manage"]),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Kiracıya bağlı roller (SUPER_ADMIN dışındaki her rol bir tenantId taşımak zorunda). */
export function isTenantRole(role: UserRole): boolean {
  return role !== "SUPER_ADMIN";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Süper Yönetici",
  TENANT_OWNER: "İşletme Sahibi",
  BRANCH_MANAGER: "Şube Müdürü",
  WAITER: "Garson",
  CASHIER: "Kasiyer",
  KITCHEN: "Mutfak",
  BAR: "Bar",
};
