"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Hata sınırı görünümü. Üretimde Next.js hata mesajını zaten gizler (yalnızca `digest` gelir);
 * geliştirmede mesaj hata ayıklama için gösterilir.
 */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <p className="font-mono text-sm text-fg-subtle">Hata</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-fg-subtle">
        İsteğiniz tamamlanamadı. Tekrar deneyin; sorun sürerse destek ekibine aşağıdaki kodu iletin.
      </p>
      {process.env.NODE_ENV !== "production" && error.message ? (
        <pre className="mt-4 w-full overflow-x-auto rounded-md bg-surface-2 p-3 text-left font-mono text-xs text-danger">{error.message}</pre>
      ) : null}
      {error.digest ? <p className="mt-4 font-mono text-xs text-fg-subtle">Kod: {error.digest}</p> : null}
      <Button className="mt-6" variant="secondary" onClick={reset}>
        <RotateCcw aria-hidden="true" />
        Tekrar dene
      </Button>
    </div>
  );
}
