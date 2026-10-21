import "server-only";
import { Prisma, type UserRole } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { TenantScope } from "@/lib/tenant/scope";
import { OPERATIONAL_ROLES, STAFF_ROLES, type StaffCreate, type StaffRole, type StaffUpdate } from "@/lib/validation/staff";
import { assertWithinLimit, EntitlementDeniedError } from "@/server/billing/entitlements";
import { isEmailTaken } from "@/server/repositories/user.repository";
import { recordAudit } from "@/server/services/audit.service";
import { generateTemporaryPassword } from "@/server/services/onboarding.service";

/**
 * Personel yönetimi (panel). Kurallar sunucuda:
 *   - Kiracı her zaman kapsamdan; hedef kullanıcı YALNIZCA bu kiracıda aranır (başka kiracının id'si → "bulunamadı").
 *   - İşletme sahibi tüm personel rollerini, şube müdürü yalnızca operasyon rollerini (kasiyer/garson/mutfak/bar) yönetir.
 *   - İşletme sahibi hesabı ve kişinin KENDİ hesabı buradan değiştirilemez (kendini kilitleme / yetki yükseltme yok).
 *   - Aktif personel sayısı paket limitine (maxStaffUsers) tabidir; pasif personel limite sayılmaz.
 *   - Pasifleştirme, rol değişikliği ve parola sıfırlama o kullanıcının tüm oturumlarını kapatır.
 * Parolalar yalnızca argon2id özeti olarak saklanır; geçici parola tek seferlik döner, denetim kaydına yazılmaz.
 */
export type StaffActor = { userId: string; role: UserRole; scope: TenantScope };

const STAFF_LIMIT_ERROR = "Paketinizin personel limitine ulaşıldı. Bir personeli pasifleştirin ya da paketinizi yükseltin.";
const NOT_FOUND = { ok: false as const, error: "Personel bulunamadı." };

export function assignableRoles(actorRole: UserRole): readonly StaffRole[] {
  if (actorRole === "TENANT_OWNER") return STAFF_ROLES;
  if (actorRole === "BRANCH_MANAGER") return OPERATIONAL_ROLES;
  return [];
}

/** Aktör hedef hesabı yönetebilir mi? (sahip hesabı, kendi hesabı ve yetki dışı roller hariç) */
export function canManageStaff(actor: { userId: string; role: UserRole }, target: { id: string; role: UserRole }): boolean {
  if (target.id === actor.userId) return false;
  return (assignableRoles(actor.role) as readonly UserRole[]).includes(target.role);
}

const countActiveStaff = (tx: Prisma.TransactionClient, tenantId: string) => () => tx.user.count({ where: { tenantId, active: true } });

export async function listStaff(scope: TenantScope) {
  const users = await prisma.user.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ active: "desc" }, { role: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      active: true,
      createdAt: true,
      sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
    },
  });
  return users.map(({ sessions, ...u }) => ({ ...u, lastSeenAt: sessions[0]?.lastSeenAt ?? null }));
}
export type StaffRow = Awaited<ReturnType<typeof listStaff>>[number];

async function findStaff(scope: TenantScope, id: string) {
  return prisma.user.findFirst({ where: { id, tenantId: scope.tenantId }, select: { id: true, role: true, active: true, firstName: true, lastName: true, email: true } });
}

export async function createStaff(actor: StaffActor, input: StaffCreate): Promise<ActionResult<{ temporaryPassword: string | null }>> {
  if (!(assignableRoles(actor.role) as readonly string[]).includes(input.role)) return { ok: false, error: "Bu rolü atama yetkiniz yok.", fieldErrors: { role: "Bu rolü atama yetkiniz yok." } };
  const emailTaken = { ok: false as const, error: "Bu e-posta ile kayıtlı bir hesap var.", fieldErrors: { email: "Bu e-posta ile kayıtlı bir hesap var." } };
  if (await isEmailTaken(input.email)) return emailTaken;

  const temporaryPassword = input.passwordMode === "generate" ? generateTemporaryPassword() : null;
  const passwordHash = await hashPassword(input.passwordMode === "manual" ? input.password : temporaryPassword!);
  const { tenantId } = actor.scope;
  try {
    const user = await prisma.$transaction(async (tx) => {
      await assertWithinLimit(tx, tenantId, "maxStaffUsers", countActiveStaff(tx, tenantId));
      return tx.user.create({
        data: { tenantId, email: input.email, firstName: input.firstName, lastName: input.lastName, role: input.role, passwordHash },
        select: { id: true },
      });
    });
    await recordAudit({
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      tenantId,
      userId: actor.userId,
      metadata: { email: input.email, role: input.role, passwordMode: temporaryPassword ? "temporary" : "manual" },
    });
    return { ok: true, data: { temporaryPassword }, message: "Personel eklendi." };
  } catch (error) {
    if (error instanceof EntitlementDeniedError) return { ok: false, error: STAFF_LIMIT_ERROR };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return emailTaken;
    throw error;
  }
}

export async function updateStaff(actor: StaffActor, id: string, input: StaffUpdate): Promise<ActionResult> {
  const before = await findStaff(actor.scope, id);
  if (!before) return NOT_FOUND;
  if (!canManageStaff(actor, before)) return { ok: false, error: "Bu hesabı düzenleme yetkiniz yok." };
  if (!(assignableRoles(actor.role) as readonly string[]).includes(input.role)) return { ok: false, error: "Bu rolü atama yetkiniz yok.", fieldErrors: { role: "Bu rolü atama yetkiniz yok." } };

  const { tenantId } = actor.scope;
  const revoke = (before.active && !input.active) || before.role !== input.role;
  try {
    await prisma.$transaction(async (tx) => {
      // Yeniden aktifleştirme limite tabidir (pasif personel sayılmaz).
      if (!before.active && input.active) await assertWithinLimit(tx, tenantId, "maxStaffUsers", countActiveStaff(tx, tenantId));
      await tx.user.update({ where: { id: before.id }, data: { firstName: input.firstName, lastName: input.lastName, role: input.role, active: input.active } });
      if (revoke) await tx.session.deleteMany({ where: { userId: before.id } });
    });
  } catch (error) {
    if (error instanceof EntitlementDeniedError) return { ok: false, error: STAFF_LIMIT_ERROR };
    throw error;
  }

  const changed = Object.fromEntries(
    (["firstName", "lastName", "role", "active"] as const).filter((k) => before[k] !== input[k]).map((k) => [k, { from: before[k], to: input[k] }]),
  );
  await recordAudit({ action: "USER_UPDATED", entity: "User", entityId: before.id, tenantId, userId: actor.userId, metadata: { email: before.email, changed, sessionsRevoked: revoke } });
  return { ok: true, data: undefined, message: !input.active && before.active ? "Personel pasifleştirildi; oturumları kapatıldı." : "Personel güncellendi." };
}

export async function resetStaffPassword(actor: StaffActor, id: string): Promise<ActionResult<{ temporaryPassword: string }>> {
  const target = await findStaff(actor.scope, id);
  if (!target) return NOT_FOUND;
  if (!canManageStaff(actor, target)) return { ok: false, error: "Bu hesabın parolasını sıfırlama yetkiniz yok." };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: target.id } }),
  ]);
  await recordAudit({ action: "USER_PASSWORD_RESET", entity: "User", entityId: target.id, tenantId: actor.scope.tenantId, userId: actor.userId, metadata: { email: target.email } });
  return { ok: true, data: { temporaryPassword }, message: "Parola sıfırlandı." };
}

/** Kişinin kendi parolası: mevcut parola doğrulanır; diğer cihazlardaki oturumlar kapatılır, bu oturum korunur. */
export async function changeOwnPassword(actor: StaffActor & { sessionId: string }, input: { current: string; next: string }): Promise<ActionResult> {
  const user = await prisma.user.findFirst({ where: { id: actor.userId, tenantId: actor.scope.tenantId }, select: { id: true, passwordHash: true } });
  if (!user) return NOT_FOUND;
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.current))) {
    return { ok: false, error: "Mevcut parola hatalı.", fieldErrors: { current: "Mevcut parola hatalı." } };
  }
  const passwordHash = await hashPassword(input.next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id, id: { not: actor.sessionId } } }),
  ]);
  await recordAudit({ action: "USER_PASSWORD_CHANGED", entity: "User", entityId: user.id, tenantId: actor.scope.tenantId, userId: actor.userId });
  return { ok: true, data: undefined, message: "Parolanız değiştirildi. Diğer cihazlardaki oturumlar kapatıldı." };
}
