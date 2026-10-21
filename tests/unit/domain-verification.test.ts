import { describe, expect, it } from "vitest";
import { evaluateTxtRecords, lookupChallenge, verificationChallenge, type TxtResolver } from "@/server/services/domain-verification.service";

const token = "a1b2c3d4e5f6";
const host = "menu.restoran.com";
const challenge = verificationChallenge(host, token);

const resolverReturning = (records: string[][]): TxtResolver => ({ resolveTxt: async () => records });
const resolverFailing = (code: string): TxtResolver => ({
  resolveTxt: async () => {
    throw Object.assign(new Error(code), { code });
  },
});

describe("DNS TXT challenge", () => {
  it("kayıt adı ve değeri", () => {
    expect(challenge).toEqual({ name: "_masanova-verification.menu.restoran.com", type: "TXT", value: `masanova-verification=${token}` });
  });

  it("yalnızca birebir eşleşen değer doğrular (parçalı TXT dahil)", () => {
    expect(evaluateTxtRecords([["v=spf1 -all"], [challenge.value]], challenge.value)).toBe("VERIFIED");
    expect(evaluateTxtRecords([["masanova-verification=", token]], challenge.value)).toBe("VERIFIED");
    expect(evaluateTxtRecords([["masanova-verification=baska"]], challenge.value)).toBe("TXT_MISMATCH");
    expect(evaluateTxtRecords([[`${challenge.value}x`]], challenge.value)).toBe("TXT_MISMATCH");
    expect(evaluateTxtRecords([], challenge.value)).toBe("TXT_NOT_FOUND");
  });

  it("DNS hataları asla doğrulanmış sayılmaz", async () => {
    await expect(lookupChallenge(resolverFailing("ENOTFOUND"), host, token)).resolves.toBe("TXT_NOT_FOUND");
    await expect(lookupChallenge(resolverFailing("ENODATA"), host, token)).resolves.toBe("TXT_NOT_FOUND");
    await expect(lookupChallenge(resolverFailing("ETIMEOUT"), host, token)).resolves.toBe("DNS_ERROR");
    await expect(lookupChallenge(resolverFailing("ESERVFAIL"), host, token)).resolves.toBe("DNS_ERROR");
  });

  it("çözümleyici doğru adı sorgular", async () => {
    const asked: string[] = [];
    const resolver: TxtResolver = { resolveTxt: async (name) => (asked.push(name), [[challenge.value]]) };
    await expect(lookupChallenge(resolver, host, token)).resolves.toBe("VERIFIED");
    expect(asked).toEqual([challenge.name]);
  });

  it("gerçek DNS: TXT kaydı olmayan ad doğrulanmaz", async () => {
    const outcome = await lookupChallenge(
      { resolveTxt: async (name) => (await import("node:dns/promises")).resolveTxt(name) },
      `mn-test-${Date.now()}.invalid`,
      token,
    );
    expect(outcome === "TXT_NOT_FOUND" || outcome === "DNS_ERROR").toBe(true);
  });
});

it("çözümleyici fake kayıt döndürse bile farklı token doğrulanmaz", async () => {
  await expect(lookupChallenge(resolverReturning([["masanova-verification=attacker"]]), host, token)).resolves.toBe("TXT_MISMATCH");
});
