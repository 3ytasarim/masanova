/**
 * İletişim yapılandırması — bileşenlere telefon numarası YAZILMAZ. WhatsApp yalnızca NEXT_PUBLIC_CONTACT_WHATSAPP
 * (uluslararası biçim, yalnızca rakam; ör. 905xxxxxxxxx) ayarlıysa gösterilir.
 */
export function whatsappLink(raw: string | undefined | null, message = "Merhaba, MasaNova AI hakkında bilgi almak istiyorum."): string | null {
  const digits = (raw ?? "").replace(/[\s()+-]/g, "");
  if (!/^\d{10,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
