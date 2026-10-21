import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { emailSchema, newPasswordSchema } from "@/lib/validation/schemas";
import { personNameSchema } from "@/lib/validation/tenant";

/**
 * Personel yönetimi şemaları. tenantId ve "kim kimi yönetebilir" kuralı BİLİNÇLİ OLARAK şemada yok —
 * sunucu (staff.service) oturumdan belirler. İşletme sahibi rolü panelden atanamaz.
 */
export const STAFF_ROLES = ["BRANCH_MANAGER", "CASHIER", "WAITER", "KITCHEN", "BAR"] as const satisfies readonly UserRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Operasyon rolleri: şube müdürünün yönetebildiği roller. */
export const OPERATIONAL_ROLES = ["CASHIER", "WAITER", "KITCHEN", "BAR"] as const satisfies readonly StaffRole[];

export const ROLE_HINTS: Record<StaffRole, string> = {
  BRANCH_MANAGER: "Menü, masa, sipariş, personel ve raporlar. Abonelik ve işletme ayarları hariç.",
  CASHIER: "Siparişler, ödemeler ve hesap talepleri.",
  WAITER: "Siparişler, servis çağrıları ve rezervasyonlar.",
  KITCHEN: "Mutfak ekranı (KDS) ve hazırlık akışı.",
  BAR: "Bar ekranı (KDS) ve hazırlık akışı.",
};

const roleSchema = z.enum(STAFF_ROLES, { error: "Geçerli bir rol seçin." });

export const staffCreateSchema = z.discriminatedUnion("passwordMode", [
  z.object({ passwordMode: z.literal("generate"), firstName: personNameSchema, lastName: personNameSchema, email: emailSchema, role: roleSchema }),
  z.object({ passwordMode: z.literal("manual"), firstName: personNameSchema, lastName: personNameSchema, email: emailSchema, role: roleSchema, password: newPasswordSchema }),
]);
export type StaffCreate = z.output<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({ firstName: personNameSchema, lastName: personNameSchema, role: roleSchema, active: z.boolean() });
export type StaffUpdate = z.output<typeof staffUpdateSchema>;

export const passwordChangeSchema = z
  .object({ current: z.string().min(1, "Mevcut parolanızı girin.").max(256), next: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Parolalar eşleşmiyor." })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Yeni parola mevcut paroladan farklı olmalı." });
