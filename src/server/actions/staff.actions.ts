"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { getCurrentSession } from "@/lib/auth/session";
import { passwordChangeSchema, staffCreateSchema, staffUpdateSchema } from "@/lib/validation/staff";
import { changeOwnPassword, createStaff, resetStaffPassword, updateStaff, type StaffActor } from "@/server/services/staff.service";

/**
 * Personel eylemleri. requireTenantUser({ permission: "staff.manage", write: true }) — işletme sahibi ve şube müdürü;
 * Super Admin destek modu (salt okunur) reddedilir. Kim kimi yönetebilir kuralı staff.service'te.
 */
type FormState = ActionResult | null;
export type TempPasswordState = ActionResult<{ temporaryPassword: string | null }> | null;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};
const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);
const badId = { ok: false as const, error: "Personel bulunamadı." };

async function staffActor(): Promise<StaffActor> {
  const ctx = await requireTenantUser({ permission: "staff.manage", write: true });
  return { userId: ctx.user.id, role: ctx.user.role, scope: ctx.scope };
}

const refresh = () => revalidatePath("/panel/personel");

export async function createStaffAction(_prev: TempPasswordState, fd: FormData): Promise<TempPasswordState> {
  const actor = await staffActor();
  const parsed = staffCreateSchema.safeParse({
    passwordMode: str(fd, "passwordMode") === "manual" ? "manual" : "generate",
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    email: str(fd, "email"),
    role: str(fd, "role"),
    password: str(fd, "password"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await createStaff(actor, parsed.data);
  if (result.ok) refresh();
  return result;
}

export async function updateStaffAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await staffActor();
  if (!idSchema.safeParse(id).success) return badId;
  const parsed = staffUpdateSchema.safeParse({ firstName: str(fd, "firstName"), lastName: str(fd, "lastName"), role: str(fd, "role"), active: fd.get("active") === "on" });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateStaff(actor, id, parsed.data);
  if (result.ok) refresh();
  return result;
}

export async function resetStaffPasswordAction(id: string, _prev: TempPasswordState, _fd: FormData): Promise<TempPasswordState> {
  const actor = await staffActor();
  if (!idSchema.safeParse(id).success) return badId;
  return resetStaffPassword(actor, id);
}

/** Kendi parolası: yalnızca panel kullanıcısının kendisi (staff.manage gerekmez); destek modu reddedilir. */
export async function changeOwnPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireTenantUser({ write: true });
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "Oturum bulunamadı." };
  const parsed = passwordChangeSchema.safeParse({ current: str(fd, "current"), next: str(fd, "next"), confirm: str(fd, "confirm") });
  if (!parsed.success) return invalid(parsed.error);
  return changeOwnPassword({ userId: ctx.user.id, role: ctx.user.role, scope: ctx.scope, sessionId: session.id }, parsed.data);
}
