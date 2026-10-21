import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import * as COPY from "@/content/marketing/copy";
import { PLAN_ORDER, planHasFeature } from "@/config/plans";
import { whatsappLink } from "@/lib/marketing/contact";
import { MARKETING_EVENT_NAME, trackMarketing } from "@/lib/marketing/events";
import { parallaxOffset, prefersReducedMotion, shouldAnimate, shouldParallax } from "@/lib/marketing/motion";
import { MARKETING_FEATURES, planCards, PRICE_LABEL } from "@/lib/marketing/plans";
import { buildHomeJsonLd, buildHomeMetadata, serializeJsonLd } from "@/lib/marketing/seo";
import { activeLocale, finalVoiceState, INITIAL_VOICE_STATE, nextVoiceState, visibleMessages, type VoiceDemoState } from "@/lib/marketing/voice-demo";
import { classifyHost } from "@/lib/tenant/host";
import { proxy } from "@/proxy";

/** Sprint 14 — pazarlama ana sayfası: host ayrımı, metin doğruluğu, paket sunumu, hareket, sesli demo, SEO, olaylar. */

describe("platform / kiracı host ayrımı (ana sayfa yalnızca platformda)", () => {
  it("kök alan adı platform, alt alan / özel alan kiracı", () => {
    expect(classifyHost("localhost:3000", "localhost").kind).toBe("platform");
    expect(classifyHost("www.masanovai.com", "masanovai.com").kind).toBe("platform");
    expect(classifyHost("demo.masanovai.com", "masanovai.com").kind).toBe("subdomain");
    expect(classifyHost("menu.restoran.com", "masanovai.com").kind).toBe("custom");
  });

  it("proxy: platform kökünde / olduğu gibi; kiracı alan adında / → /site (pazarlama sayfası gösterilmez)", () => {
    const platform = proxy(new NextRequest("http://localhost:3000/", { headers: { host: "localhost:3000" } }));
    expect(platform.headers.get("x-middleware-rewrite")).toBeNull();
    const tenant = proxy(new NextRequest("http://demo.localhost:3000/", { headers: { host: "demo.localhost:3000" } }));
    expect(new URL(tenant.headers.get("x-middleware-rewrite")!).pathname).toBe("/site");
  });
});

describe("pazarlama metni (merkezi, doğrulanabilir iddialar)", () => {
  const text = JSON.stringify(COPY).toLocaleLowerCase("tr");

  it("uydurma sosyal kanıt yok (müşteri / restoran / sipariş sayısı, puan, yorum)", () => {
    expect(text).not.toMatch(/\d[\d.,]*\+?\s*(restoran|işletme|müşteri|kullanıcı|sipariş işlendi)/);
    expect(text).not.toMatch(/★|yıldız|puan|rating|review/);
    expect(text).not.toMatch(/insan gibi|human-like|kusursuz anla|%100 doğru/);
  });

  it("ödeme vaadi yok; kâr / marj yalnızca olumsuz tanımda", () => {
    expect(text).not.toMatch(/online ödeme|kartla öde|ödeme al(?!ınmaz)/);
    expect(text.match(/kâr|marj/g)?.length).toBe(2);
    expect(COPY.ANALYTICS.definition).toContain("değildir");
    expect(COPY.SERVICE.note).toContain("ödeme alınmaz");
  });

  it("sesli AI: tam 5 dil; menü arayüzü için genel 'Rusça menü' iddiası yok", () => {
    expect(COPY.VOICE.languages.map((l) => l.code)).toEqual(["TR", "EN", "DE", "AR", "RU"]);
    expect(COPY.VOICE.languagesTitle).toBe("5 dilde sesli konuşma");
    expect(text).not.toMatch(/rusça menü|menü\s+5 dilde/);
  });

  it("analitik örnek değerleri açıkça 'örnek' olarak işaretli; hikâye sırası tam", () => {
    expect(COPY.ANALYTICS.sampleNote.toLocaleLowerCase("tr")).toContain("örnek");
    expect(COPY.MENU.sampleNote.toLocaleLowerCase("tr")).toContain("örnek");
    expect(COPY.NAV.map((n) => n.label)).toEqual(["Ürün", "Voice AI", "Özellikler", "Analitik", "Paketler"]);
    expect(COPY.HOW.steps).toHaveLength(4);
    expect(COPY.FEATURES.items.length).toBeLessThanOrEqual(12);
  });

  it("Super Admin bağlantısı yok", () => {
    expect(text).not.toContain("/admin");
  });
});

describe("paket sunumu (config/plans tablosundan türetilir)", () => {
  const cards = planCards();

  it("sıra STARTER → PRO → AI; fiyat UYDURULMAZ", () => {
    expect(cards.map((c) => c.plan)).toEqual([...PLAN_ORDER]);
    for (const c of cards) {
      expect(c.priceLabel).toBe(PRICE_LABEL);
      expect(c.priceLabel).not.toMatch(/\d|₺|TL/);
    }
  });

  it("her özellik, tablonun onu İLK içerdiği pakette listelenir (elle yazılmış eşleme yok)", () => {
    const [starter, voice, pro, ai] = cards;
    expect(voice!.adds).toEqual(["Sesli AI asistan (5 dilde konuşma)"]);
    expect(voice!.includesPrevious).toBe("Starter");
    expect(starter!.adds).toEqual(["QR menü", "Masa & güvenli QR yönetimi", "Baskıya hazır QR etiketleri", "Tema ve marka renkleri"]);
    expect(pro!.adds).toEqual(["Masadan sipariş", "Mutfak ekranı ve istasyonlar", "Garson çağrısı ve servis talepleri", "Online rezervasyon", "Müşteriler, sadakat ve kuponlar", "Analitik paneli"]);
    expect(ai!.adds).toEqual(["Sesli AI asistan (5 dilde konuşma)", "AI İşletme Danışmanı"]);
    expect(pro!.includesPrevious).toBe("Starter");
    for (const f of MARKETING_FEATURES) {
      const first = PLAN_ORDER.find((p) => planHasFeature(p, f.key));
      expect(cards.find((c) => c.plan === first)!.adds).toContain(f.label);
    }
  });

  it("öne çıkan paket AI; ai_analytics gibi henüz olmayan özellik gösterilmez", () => {
    expect(cards.filter((c) => c.highlighted).map((c) => c.plan)).toEqual(["AI"]);
    expect(JSON.stringify(cards)).not.toMatch(/AI analitik/);
  });
});

describe("hareket yardımcıları", () => {
  const mm = (reduce: boolean) => (q: string) => ({ matches: reduce && q.includes("reduce") });
  it("azaltılmış hareket ve veri tasarrufu animasyonu kapatır", () => {
    expect(prefersReducedMotion({ matchMedia: mm(true) })).toBe(true);
    expect(shouldAnimate({ matchMedia: mm(false) })).toBe(true);
    expect(shouldAnimate({ matchMedia: mm(true) })).toBe(false);
    expect(shouldAnimate({ matchMedia: mm(false), saveData: true })).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion({ matchMedia: () => { throw new Error("x"); } })).toBe(false);
  });
  it("paralaks yalnızca geniş ekranda; kayma sınırlı", () => {
    expect(shouldParallax({ matchMedia: mm(false), width: 390 })).toBe(false);
    expect(shouldParallax({ matchMedia: mm(false), width: 1440 })).toBe(true);
    expect(shouldParallax({ matchMedia: mm(true), width: 1440 })).toBe(false);
    expect(parallaxOffset(0)).toBe(24);
    expect(parallaxOffset(1)).toBe(-24);
    expect(parallaxOffset(5)).toBe(-24);
    expect(parallaxOffset(0.5)).toBe(0);
  });
});

describe("sesli demo durum makinesi (gerçek mikrofon / AI yok)", () => {
  const script = COPY.VOICE_SCRIPT;
  it("TR soru → düşünme → yanıt → kartlar → EN'ye geçiş → son kare; bir kez oynar", () => {
    let s: VoiceDemoState = INITIAL_VOICE_STATE;
    const seen: string[] = [];
    for (let i = 0; i < 20 && s.phase !== "done"; i++) {
      s = nextVoiceState(s, script);
      seen.push(`${s.turn}:${s.phase}`);
    }
    expect(seen).toEqual(["0:listening", "0:user", "0:thinking", "0:reply", "0:cards", "1:listening", "1:user", "1:thinking", "1:reply", "1:done"]);
    expect(nextVoiceState(s, script)).toEqual(s); // son karede kalır (dilleri sonsuza döndürmez)
  });

  it("görünür mesajlar faza göre; son kare tüm konuşmayı içerir", () => {
    expect(visibleMessages({ turn: 0, phase: "listening" }, script)).toEqual([]);
    expect(visibleMessages({ turn: 0, phase: "thinking" }, script).map((m) => m.role)).toEqual(["user"]);
    expect(visibleMessages({ turn: 0, phase: "reply" }, script)[1]!.cards).toBeUndefined();
    expect(visibleMessages({ turn: 0, phase: "cards" }, script)[1]!.cards).toHaveLength(2);
    const final = visibleMessages(finalVoiceState(script), script);
    expect(final.map((m) => `${m.role}:${m.locale}`)).toEqual(["user:tr", "assistant:tr", "user:en", "assistant:en"]);
    expect(final[3]!.text).toMatch(/^Of course/);
  });

  it("dil rozeti TR → EN; boş senaryo güvenli", () => {
    expect(activeLocale({ turn: 0, phase: "reply" }, script)).toBe("tr");
    expect(activeLocale({ turn: 1, phase: "listening" }, script)).toBe("en");
    expect(nextVoiceState(INITIAL_VOICE_STATE, [])).toEqual({ turn: 0, phase: "done" });
  });
});

describe("SEO", () => {
  const site = { name: "MasaNova AI", company: "3Y Tasarım & Yazılım Hizmetleri", url: "https://masanovai.com", locale: "tr_TR" };
  it("başlık, açıklama, canonical, OG / Twitter, robots", () => {
    const m = buildHomeMetadata(site);
    expect(m.title).toEqual({ absolute: "MasaNova AI | Yapay Zeka Destekli QR Menü ve Restoran Yönetimi" });
    const d = String(m.description);
    for (const k of ["QR menü", "sipariş", "mutfak ekranı", "AI asistan", "garson"]) expect(d.toLocaleLowerCase("tr")).toContain(k.toLocaleLowerCase("tr"));
    expect(d.length).toBeLessThanOrEqual(170);
    expect(m.alternates?.canonical).toBe("/");
    expect(m.openGraph).toMatchObject({ type: "website", locale: "tr_TR", url: "/" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it("JSON-LD: Organization + WebSite + SoftwareApplication; puan / yorum / fiyat UYDURULMAZ; güvenli gömme", () => {
    const ld = buildHomeJsonLd(site);
    expect(ld["@graph"].map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    const raw = JSON.stringify(ld);
    expect(raw).not.toMatch(/aggregateRating|review|offers|price/i);
    const embedded = serializeJsonLd({ x: "</script><script>alert(1)</script>" + String.fromCharCode(0x2028) });
    expect(embedded).not.toContain("</script>");
    expect(embedded).toContain("\\u003c/script>");
    expect(embedded).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(embedded).x).toContain("</script>");
  });
});

describe("pazarlama olayları ve iletişim", () => {
  it("tipli olay CustomEvent ile yayınlanır; bilinmeyen ad yok sayılır", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    target.addEventListener(MARKETING_EVENT_NAME, (e) => handler((e as CustomEvent).detail));
    expect(trackMarketing(target, "MARKETING_DEMO_CTA", "hero")).toMatchObject({ event: "MARKETING_DEMO_CTA", placement: "hero" });
    expect(trackMarketing(target, "EVIL_EVENT")).toBeNull();
    expect(trackMarketing(undefined, "MARKETING_DEMO_CTA")).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp yalnızca yapılandırılmışsa ve geçerli numarayla", () => {
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink("")).toBeNull();
    expect(whatsappLink("abc")).toBeNull();
    expect(whatsappLink("+90 (532) 000-00-00")).toMatch(/^https:\/\/wa\.me\/905320000000\?text=/);
  });
});
