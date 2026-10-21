// Tarayıcı paketleri için DETERMİNİSTİK abonelik profili (Sprint 20). Her paket başlamadan önce regression.mjs demo
// kiracıyı açıkça bu profile getirir; paket içinde paket değiştiren testler de AYNI yardımcıyı kullanır ve kendi
// sonunda varsayılana döner. Tenant.plan aynadır (tetikleyici) — doğrudan yazılamaz.
const DEFAULT_PROFILE = { plan: "AI", status: "ACTIVE", internal: true };

/**
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} tenantId
 * @param {{ plan?: "STARTER"|"PRO"|"AI", status?: string, internal?: boolean, trialEndsAt?: Date|null, currentPeriodEnd?: Date|null, graceEndsAt?: Date|null, cancelAtPeriodEnd?: boolean, keepOverrides?: boolean }} [profile]
 */
async function setSubscription(db, tenantId, profile = {}) {
  const p = { ...DEFAULT_PROFILE, ...profile };
  const now = new Date();
  const data = {
    plan: p.plan,
    status: p.status,
    internal: p.internal,
    // Dönem başı, (geçmişteki) dönem sonundan önce olmalı (CHECK) — süresi dolmuş dönem simülasyonu için 30 gün geri.
    currentPeriodStart: p.currentPeriodEnd && p.currentPeriodEnd <= now ? new Date(p.currentPeriodEnd.getTime() - 30 * 86_400_000) : now,
    currentPeriodEnd: p.currentPeriodEnd ?? null,
    trialEndsAt: p.trialEndsAt ?? (p.status === "TRIALING" ? new Date(now.getTime() + 14 * 86_400_000) : null),
    graceEndsAt: p.graceEndsAt ?? (p.status === "PAST_DUE" || p.status === "GRACE" ? new Date(now.getTime() + 7 * 86_400_000) : null),
    cancelAtPeriodEnd: p.cancelAtPeriodEnd ?? false,
    cancelledAt: p.status === "CANCELLED" ? now : null,
  };
  await db.subscription.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  if (!p.keepOverrides) await db.entitlementOverride.deleteMany({ where: { tenantId } });
}

async function setDemoSubscription(db, profile = {}) {
  const t = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  await setSubscription(db, t.id, profile);
  return t.id;
}

module.exports = { DEFAULT_PROFILE, setSubscription, setDemoSubscription };
