// Test ters vekili (Nginx + PM2 küme benzetimi): TEK genel adres (localhost:3820) arkasında İKİ uygulama süreci.
// Host başlığı DEĞİŞMEDEN iletilir (uygulama platform / kiracı host'unu doğru sınıflandırır), yanıtlar akışla aktarılır
// (SSE / NDJSON tamponlanmaz). Yönlendirme kuralı: müşteri yüzeyi (kiracı alt alanı, /q, /t) → A; panel / giriş /
// admin → B. "x-e2e-backend: A|B" başlığı yönü zorlar (hız sınırı testi). Arka uç kapalıysa 502 (yeniden deneme yolu).
const http = require("http");

function createProxy({ port, backends, route }) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const forced = req.headers["x-e2e-backend"];
    const target = backends[forced === "A" || forced === "B" ? forced : route(req)];
    const upstream = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("bad gateway");
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      }),
    ),
  );
}

/** Varsayılan kural: kiracı host'u ya da QR yolları → A (müşteri); diğer her şey → B (panel). */
function customerOnA(req) {
  const host = String(req.headers.host ?? "");
  if (/^[a-z0-9-]+\.localhost(:\d+)?$/i.test(host)) return "A";
  if (/^\/(q|t)\//.test(req.url ?? "")) return "A";
  return "B";
}

module.exports = { createProxy, customerOnA };
