import { GlassWater, HandPlatter, Layers2, MessageSquareText, Receipt, type LucideIcon } from "lucide-react";
import type { ServiceRequestType } from "@prisma/client";

/** Servis talebi tip ikonları (müşteri menüsü ve personel panosu ortak). */
export const SERVICE_TYPE_ICONS: Record<ServiceRequestType, LucideIcon> = {
  WAITER: HandPlatter,
  WATER: GlassWater,
  NAPKIN: Layers2,
  BILL: Receipt,
  CUSTOM: MessageSquareText,
};
