import { clsx, type ClassValue } from "clsx";

/** Koşullu sınıf birleştirme. Bileşen API'leri çakışan sınıf üretmeyecek şekilde tasarlandı (tailwind-merge gereksiz). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
