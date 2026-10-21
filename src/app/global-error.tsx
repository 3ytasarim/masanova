"use client";

import { ErrorView } from "@/components/shared/error-view";
import "./globals.css";

/** Kök layout dahil her şey çöktüğünde devreye girer; kendi <html>/<body>'sini üretmek zorundadır. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="tr">
      <body>
        <ErrorView error={error} reset={reset} />
      </body>
    </html>
  );
}
