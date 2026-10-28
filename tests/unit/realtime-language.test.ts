import { describe, expect, it } from "vitest";
import { localizeToolOutput, realtimeToolDefinitions, toolLanguage } from "@/lib/ai/realtime-voice";

describe("sesli garson: misafirin dili", () => {
  it("her araç tanımında lang alanı var", () => {
    for (const def of realtimeToolDefinitions(["findMenuItems", "getPairings"])) {
      expect((def.parameters.properties as Record<string, { enum?: string[] }>).lang?.enum).toEqual(["tr", "en", "de", "ar", "ru"]);
    }
  });
  it("lang yalnızca bilinen kodları kabul eder", () => {
    expect(toolLanguage({ lang: "en", query: "x" })).toBe("en");
    expect(toolLanguage({ lang: "xx" })).toBeNull();
    expect(toolLanguage(null)).toBeNull();
  });
  it("Türkçe yönlendirme cümleleri misafirin diline çevrilir", () => {
    expect(localizeToolOutput({ ok: false, needs: "repeat", say: "Tam anlayamadım" }, "en")).toMatchObject({ say: expect.stringContaining("didn't catch"), replyLanguage: expect.stringContaining("English") });
    expect(localizeToolOutput({ ok: false, needs: "confirm", candidate: "Grilled Sea Bass", say: "«Grilled Sea Bass» mı demek istediniz?" }, "de").say).toBe("Meinten Sie «Grilled Sea Bass»?");
    const tr = { ok: false, reason: "not_on_menu", say: "Menümüzde bu isimde bir ürün bulamadım." };
    expect(localizeToolOutput(tr, "tr")).toBe(tr);
  });
});
