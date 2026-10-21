"use server";

import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/guards";
import { loginSchema } from "@/lib/validation/schemas";
import { login, logout } from "@/server/services/auth.service";

export type LoginFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
  email?: string;
};

const ERROR_MESSAGES = {
  invalid_credentials: "E-posta veya parola hatalı.",
  tenant_inactive: "İşletme hesabınız şu anda aktif değil. Lütfen MasaNova destek ekibiyle iletişime geçin.",
} as const;

export async function loginAction(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const rawEmail = typeof formData.get("email") === "string" ? String(formData.get("email")).slice(0, 254) : "";

  if (!parsed.success) {
    const fieldErrors: LoginFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "email" || key === "password") && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors, email: rawEmail };
  }

  const result = await login(parsed.data);
  if (!result.ok) {
    if (result.error === "rate_limited") {
      const minutes = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 60) / 60));
      return { error: `Çok fazla başarısız deneme. Lütfen ${minutes} dakika sonra tekrar deneyin.`, email: parsed.data.email };
    }
    return { error: ERROR_MESSAGES[result.error], email: parsed.data.email };
  }

  redirect(result.redirectTo);
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect(LOGIN_PATH);
}
