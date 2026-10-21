import type { Metadata } from "next";
import { SEO } from "@/content/marketing/copy";

/**
 * Ana sayfa SEO — saf (birim testli). Yalnızca doğru bilgiler: puan, yorum, fiyat UYDURULMAZ (offers / aggregateRating yok).
 */
export function buildHomeMetadata(site: { name: string; locale: string }): Metadata {
  return {
    title: { absolute: SEO.title },
    description: SEO.description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: site.locale,
      url: "/",
      siteName: site.name,
      title: SEO.ogTitle,
      description: SEO.description,
    },
    twitter: { card: "summary_large_image", title: SEO.ogTitle, description: SEO.description },
    robots: { index: true, follow: true },
  };
}

export function buildHomeJsonLd(site: { name: string; company: string; url: string }) {
  const org = `${site.url}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": org, name: site.company, url: site.url, brand: { "@type": "Brand", name: site.name } },
      { "@type": "WebSite", "@id": `${site.url}/#website`, url: site.url, name: site.name, inLanguage: "tr-TR", publisher: { "@id": org } },
      {
        "@type": "SoftwareApplication",
        "@id": `${site.url}/#software`,
        name: site.name,
        url: site.url,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Restaurant management",
        operatingSystem: "Web",
        description: SEO.description,
        featureList: SEO.featureList,
        availableLanguage: ["tr", "en", "de", "ar", "ru"],
        inLanguage: "tr-TR",
        publisher: { "@id": org },
      },
    ],
  };
}

/** JSON-LD'yi <script> içine güvenle gömmek için ("</script>" kaçışı). */
export function serializeJsonLd(value: unknown): string {
  // U+2028 / U+2029 satır ayırıcıları da kaçırılır (eski JS ayrıştırıcılarında betik içinde satır sonu sayılır).
  return JSON.stringify(value).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
}
