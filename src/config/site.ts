import { PLATFORM_ORIGIN } from "@/lib/domain/get-platform-url";

export const siteConfig = {
  name: "MasaNova AI",
  shortName: "MasaNova",
  company: "3Y Tasarım & Yazılım Hizmetleri",
  tagline: "Restoranınızın yeni dijital garsonu.",
  description: "QR menü, masadan sipariş, mutfak ekranı, garson çağırma, analitik ve sesli AI asistan — restoran operasyonunuz tek platformda.",
  url: PLATFORM_ORIGIN,
  locale: "tr_TR",
  themeColor: "#0c0a09",
} as const;
