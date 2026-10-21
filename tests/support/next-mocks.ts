import { vi } from "vitest";

/**
 * next/navigation'ın notFound/redirect'i Next.js'te özel hata fırlatır. Testlerde aynı davranış
 * (akışı durdurma) tanınabilir hatalarla taklit edilir.
 */
export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
export class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

export const navigationMock = {
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
  redirect: vi.fn((to: string) => {
    throw new RedirectSignal(to);
  }),
};
