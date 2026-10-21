// e2e temizliği için (src/lib/tables/qr-token.ts ile aynı algoritma).
const { createHash, createHmac, randomBytes } = require("crypto");
exports.issueQrToken = (secret) => {
  const nonce = randomBytes(16).toString("base64url");
  const token = createHmac("sha256", secret).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
  return { token, nonce, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
};
