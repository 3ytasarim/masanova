import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils/cn";
import adana from "@/assets/marketing/food/adana.webp";
import ayran from "@/assets/marketing/food/ayran.webp";
import ciger from "@/assets/marketing/food/ciger.webp";
import coban from "@/assets/marketing/food/coban.webp";
import kofte from "@/assets/marketing/food/kofte.webp";
import tavukSis from "@/assets/marketing/food/tavuk-sis.webp";
import urfa from "@/assets/marketing/food/urfa.webp";
import urfaDurum from "@/assets/marketing/food/urfa-durum.webp";

/**
 * Pazarlama sayfasındaki telefon / menü canlandırmaları için gerçek ürün fotoğrafları (yerel, optimize: WebP 800×600,
 * next/image ile duyarlı boyut + bulanık yer tutucu). Fotoğraflarda işletme logosu / marka yoktur. Görseller dekoratiftir
 * (çevreleyen kartta ürün adı yazılıdır) → alt="".
 */
export const FOOD_PHOTOS = { adana, ayran, ciger, coban, kofte, "tavuk-sis": tavukSis, urfa, "urfa-durum": urfaDurum } satisfies Record<string, StaticImageData>;
export type FoodPhotoKey = keyof typeof FOOD_PHOTOS;

export function FoodPhoto({ photo, sizes = "96px", priority = false, className }: { photo: FoodPhotoKey; sizes?: string; priority?: boolean; className?: string }) {
  return <Image src={FOOD_PHOTOS[photo]} alt="" sizes={sizes} priority={priority} placeholder="blur" className={cn("size-full object-cover", className)} />;
}
