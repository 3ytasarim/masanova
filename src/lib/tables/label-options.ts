import { BLEED_MM, LABEL_SIZE_PRESETS, type LabelSizePreset } from "@/lib/tables/label-geometry";

/**
 * Etiket tasarım seçenekleri — istemci (düzenleyici) ve sunucu (çizim, doğrulama) ortak sözlüğü.
 * URL'de kısa anahtarlarla taşınır (önizleme ve indirme GET istekleri); sunucu her zaman Zod ile yeniden doğrular.
 */

export const LABEL_TEMPLATES = {
  minimal: { label: "Minimal", description: "Beyaz zemin, sade tipografi." },
  modern: { label: "Modern", description: "Marka renginde üst bant, vurgulu masa adı." },
  dark: { label: "Koyu", description: "Koyu zemin; QR beyaz plaka üzerinde." },
  luxury: { label: "Lüks", description: "Krem zemin, ince çerçeve, serif başlık." },
  cafe: { label: "Kafe", description: "Sıcak tonlar, yumuşak dekoratif şekiller." },
  signature: { label: "İmza", description: "Tam marka rengi zemin, beyaz QR kartı, okutma çerçevesi." },
  wave: { label: "Dalga", description: "Marka renginde kavisli üst bant, QR bandın üstünde." },
  noir: { label: "Noir", description: "Koyu zemin, marka renginde ışıltı, vurgu köşeleri." },
  tableCard: { label: "Masa Kartı", description: "Büyük masa adı üstte; uzaktan okunur, çerçeveli QR." },
} as const;

export type LabelTemplate = keyof typeof LABEL_TEMPLATES;
export const LABEL_TEMPLATE_KEYS = Object.keys(LABEL_TEMPLATES) as LabelTemplate[];

export const CTA_PRESETS = ["Menüyü Görüntüle", "QR Kodu Okutun", "Sesli sipariş için okutun"] as const;
export const DEFAULT_CTA = CTA_PRESETS[0];
export const CTA_MAX = 40;
export const INFO_MAX = 60;

export type LabelOptions = {
  template: LabelTemplate;
  size: LabelSizePreset | "custom";
  /** mm — size "custom" değilse ön ayardan gelir. */
  width: number;
  height: number;
  bleed: boolean;
  cta: string;
  showLogo: boolean;
  showName: boolean;
  poweredBy: boolean;
  /** Küçük bilgi satırı (ör. ileride Wi-Fi). Boşsa çizilmez. */
  info: string;
  /** "brand": marka rengi — yalnızca kontrast güvenliyse; değilse otomatik siyah. */
  qrColor: "brand" | "black";
};

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  template: "minimal",
  size: "60x60",
  width: LABEL_SIZE_PRESETS["60x60"].width,
  height: LABEL_SIZE_PRESETS["60x60"].height,
  bleed: false,
  cta: DEFAULT_CTA,
  showLogo: true,
  showName: true,
  poweredBy: true,
  info: "",
  qrColor: "black",
};

export function labelBleedMm(options: Pick<LabelOptions, "bleed">): number {
  return options.bleed ? BLEED_MM : 0;
}

/** Seçenekler → URL parametreleri (kısa anahtarlar). */
export function labelOptionsToParams(options: LabelOptions): Record<string, string> {
  return {
    sablon: options.template,
    boyut: options.size,
    en: String(options.width),
    boy: String(options.height),
    tasma: options.bleed ? "1" : "0",
    cta: options.cta,
    logo: options.showLogo ? "1" : "0",
    ad: options.showName ? "1" : "0",
    imza: options.poweredBy ? "1" : "0",
    bilgi: options.info,
    qr: options.qrColor,
  };
}
