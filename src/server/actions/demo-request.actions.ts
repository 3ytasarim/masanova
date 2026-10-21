"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { demoRequestSchema, demoRequestUpdateSchema } from "@/lib/validation/tenant";
import { submitDemoRequest, updateDemoRequestStatus } from "@/server/services/demo-request.service";

type FormState = ActionResult | null;

const str = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

/** Public demo talep formu (kimlik yok): Zod + bot tuzağı + IP/e-posta hız sınırı. */
export async function submitDemoRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = demoRequestSchema.safeParse({
    name: str(formData, "name"),
    businessName: str(formData, "businessName"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    city: str(formData, "city"),
    tableCount: str(formData, "tableCount"),
    message: str(formData, "message"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await submitDemoRequest(parsed.data, { honeypot: !!str(formData, "website") });
  return result.ok ? { ok: true, data: undefined, message: "Talebiniz alındı. Ekibimiz en kısa sürede sizinle iletişime geçecek." } : result;
}

export async function updateDemoRequestAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, platform } = await requireSuperAdmin();
  const parsed = demoRequestUpdateSchema.safeParse({ status: str(formData, "status"), notes: str(formData, "notes") });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateDemoRequestStatus({ userId: user.id, platform }, id, parsed.data);
  revalidatePath("/admin/demo-talepleri", "layout");
  return result;
}
