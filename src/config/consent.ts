import type { ConsentType } from "@prisma/client";

/**
 * Onay metinleri — TEK yer ve SÜRÜMLÜ. Metin değişirse sürüm artırılır; eski onay kayıtları kendi sürümünü korur.
 *
 * ⚠️ HUKUKİ İNCELEME BEKLİYOR: aşağıdaki kısa metinler ürün içi yer tutucudur (KVKK / GDPR uyumuna HAZIRLIK). Nihai
 * aydınlatma metni ve açık rıza metinleri işletmenin / hukuk danışmanının onayından sonra burada güncellenmelidir.
 * Uyumluluk otomatik olarak İDDİA EDİLMEZ.
 */
export const CONSENT_VERSION = "2026-10-v1";

export type ConsentCopy = { label: string; description: string };

export const CONSENT_COPY: Record<"tr" | "en", Record<ConsentType, ConsentCopy>> = {
  tr: {
    PRIVACY: { label: "Aydınlatma metnini okudum", description: "Bilgilerim yalnızca bu restoranın sadakat ve müşteri hizmetleri için işlenir." },
    LOYALTY: { label: "Sadakat programına katılıyorum", description: "Servis edilen siparişlerimden puan kazanırım." },
    MARKETING_EMAIL: { label: "E-posta ile kampanya almak istiyorum", description: "İstediğiniz zaman geri alabilirsiniz." },
    MARKETING_SMS: { label: "SMS ile kampanya almak istiyorum", description: "İstediğiniz zaman geri alabilirsiniz." },
    MARKETING_WHATSAPP: { label: "WhatsApp ile kampanya almak istiyorum", description: "İstediğiniz zaman geri alabilirsiniz." },
  },
  en: {
    PRIVACY: { label: "I have read the privacy notice", description: "My details are processed only for this restaurant's loyalty and customer service." },
    LOYALTY: { label: "I join the loyalty program", description: "I earn points from my served orders." },
    MARKETING_EMAIL: { label: "Send me offers by email", description: "You can withdraw at any time." },
    MARKETING_SMS: { label: "Send me offers by SMS", description: "You can withdraw at any time." },
    MARKETING_WHATSAPP: { label: "Send me offers on WhatsApp", description: "You can withdraw at any time." },
  },
};

export const MARKETING_TYPES = ["MARKETING_EMAIL", "MARKETING_SMS", "MARKETING_WHATSAPP"] as const satisfies readonly ConsentType[];
export type MarketingType = (typeof MARKETING_TYPES)[number];

/** Pazarlama kanalı ↔ gereken iletişim bilgisi. */
export const MARKETING_CHANNEL_NEEDS: Record<MarketingType, "email" | "phone"> = { MARKETING_EMAIL: "email", MARKETING_SMS: "phone", MARKETING_WHATSAPP: "phone" };
