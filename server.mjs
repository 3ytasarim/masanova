// MasaNova AI — üretim başlatıcısı (PM2: deploy/ecosystem.config.cjs).
//
// Neden `next start -H 127.0.0.1` değil: Next 16'da proxy (middleware) rewrite'ı "kendi sunucusu mu" diye karşılaştırılırken
// sunucu tarafı -H değerini AYNEN (127.0.0.1), proxy tarafı ise NextURL ile normalize edilmiş hâlini (localhost) kullanır.
// İki origin eşleşmeyince kiracı rewrite'ı (/site) DIŞ adres sayılır ve Next kendi portuna X-Forwarded-Proto şemasıyla
// bağlanmaya çalışır: nginx arkasında https://localhost:<port>/site → düz HTTP porta TLS → EPROTO → 500.
// (https://github.com/vercel/next.js/issues/94745 — Next 16.4.0'da açık.)
//
// Çözüm: dinleme adresi ile Next'in iç URL adını ayırırız.
//   - Soket YALNIZCA loopback'e bağlanır (BIND_HOST, varsayılan 127.0.0.1) → nginx upstream'i değişmez, port dışarı açılmaz.
//   - Next'e iç URL adı olarak "localhost" verilir → her iki taraf aynı origin'i görür → rewrite süreç İÇİNDE uygulanır.
// X-Forwarded-Proto yine güvenilir (nginx https bilgisi korunur); host sınıflandırması (src/proxy.ts) değişmez.
import { createServer } from "node:http";
import next from "next";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const bindHost = process.env.BIND_HOST || "127.0.0.1";
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT geçerli bir port değil.");

// hostname yalnızca Next'in iç URL / rewrite karşılaştırması içindir; soketi aşağıda biz açarız.
const app = next({ dev: false, hostname: "localhost", port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    // Next kendi hata sayfasını üretir; buraya yalnızca beklenmeyen işleyici hataları düşer (ayrıntı istemciye gitmez).
    console.error(JSON.stringify({ level: "error", msg: "server.unhandled", errorName: error instanceof Error ? error.name : "unknown" }));
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  });
});
// nginx upstream keepalive (varsayılan 60 sn) kapanmadan Node kapatmasın → yarış kaynaklı 502 olmaz.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(port, bindHost, () => {
  console.log(JSON.stringify({ level: "info", msg: "server.listening", host: bindHost, port }));
});

// Yeni bağlantı kabulünü durdur; uygulama kaynakları (SSE, Redis, Prisma) src/server/lifecycle/shutdown.ts ile kapanır.
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
