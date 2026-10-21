import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

/**
 * Platform (pazarlama) site haritası. Yeni public sayfalar bu listeye eklenir.
 * Kiracı QR menüleri yayına girdiğinde her kiracı alan adı kendi site haritasını üretecek (Sprint 2+).
 */
const publicRoutes: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: new URL(route.path, siteConfig.url).toString(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
