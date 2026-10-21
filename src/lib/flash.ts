import "server-only";
import { cookies } from "next/headers";

/**
 * Yönlendirme sonrası tek seferlik bildirim (toast). Çerez yalnızca kısa bir mesaj taşır — sır içermez;
 * istemcideki Toaster okuyup hemen siler. Server Action / Route Handler içinden çağrılır.
 */
export const FLASH_COOKIE = "mn_flash";

export type FlashTone = "success" | "error" | "info";

export async function setFlash(message: string, tone: FlashTone = "success"): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, JSON.stringify({ message: message.slice(0, 200), tone }), {
    path: "/",
    maxAge: 30,
    sameSite: "lax",
    httpOnly: false,
  });
}
