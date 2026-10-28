import { describe, expect, it } from "vitest";
import { chunkItems, parseTranslationResponse, translationSystemPrompt, translationUserPrompt, type TranslationItem } from "@/lib/menu/auto-translate";

const items: TranslationItem[] = [
  { kind: "product", id: "p1", source: { name: "Levrek Izgara", shortDescription: null, description: "Közde pişmiş taze levrek" } },
  { kind: "category", id: "c1", source: { name: "Mezeler" } },
  { kind: "variant", id: "v1", source: { name: "Büyük boy" } },
];

describe("menu auto-translate", () => {
  it("sends only short refs and present fields to the model (no internal ids)", () => {
    const payload = JSON.parse(translationUserPrompt(items));
    expect(Object.keys(payload)).toEqual(["i0", "i1", "i2"]);
    expect(payload.i0).toEqual({ name: "Levrek Izgara", description: "Közde pişmiş taze levrek" });
    expect(JSON.stringify(payload)).not.toContain("p1");
    expect(translationSystemPrompt("tr", "en")).toContain("Turkish to English");
  });

  it("accepts only requested refs and fields; drops empty names; trims to limits", () => {
    const out = parseTranslationResponse(
      {
        i0: { name: "  Grilled Sea Bass ", shortDescription: "invented", description: "Fresh sea bass cooked over charcoal" },
        i1: { name: "" },
        i2: { name: "L".repeat(200) },
        i9: { name: "Injected" },
      },
      items,
    );
    expect(out[0]).toEqual({ name: "Grilled Sea Bass", shortDescription: null, description: "Fresh sea bass cooked over charcoal" });
    expect(out[1]).toBeNull();
    expect(out[2]!.name.length).toBe(80);
    expect(out).toHaveLength(3);
  });

  it("tolerates non-object responses", () => {
    expect(parseTranslationResponse(null, items)).toEqual([null, null, null]);
    expect(parseTranslationResponse(["x"], items)).toEqual([null, null, null]);
  });

  it("chunks by count and by size", () => {
    const many = Array.from({ length: 60 }, (_, i): TranslationItem => ({ kind: "product", id: `p${i}`, source: { name: `Ürün ${i}` } }));
    expect(chunkItems(many, 25).map((c) => c.length)).toEqual([25, 25, 10]);
    const long = Array.from({ length: 4 }, (_, i): TranslationItem => ({ kind: "product", id: `p${i}`, source: { name: "x", description: "y".repeat(2500) } }));
    expect(chunkItems(long, 25, 6000).map((c) => c.length)).toEqual([2, 2]);
  });
});
