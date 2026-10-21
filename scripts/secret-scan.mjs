#!/usr/bin/env node
/**
 * Depo sır taraması — git'in izleyeceği TÜM dosyalar (izlenen + .gitignore'a takılmayan yeni dosyalar) taranır.
 * Bulgu çıktısı yalnızca dosya:satır + kalıp ADI içerir; eşleşen değer ASLA yazdırılmaz.
 * Bilerek sahte değer içeren test satırı "secret-scan:allow" işaretiyle muaf tutulabilir.
 *   npm run secrets:scan        → bulgu varsa çıkış kodu 1
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

export const PATTERNS = [
  ["openai-key", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ["postgres-url-with-password", /\bpostgres(?:ql)?:\/\/[^\s:@/"'`]+:[^\s@/"'`]{6,}@[^\s"'`]+/],
  ["redis-url-with-password", /\brediss?:\/\/[^\s@/"'`]*:[^\s@/"'`]{6,}@[^\s"'`]+/],
  ["neon-host-credentials", /npg_[A-Za-z0-9]{8,}/],
  ["qr-secret-assignment", /\bQR_TOKEN_SECRET\s*[=:]\s*["']?(?!\s|["']|$|<|\$\{|process)[A-Za-z0-9+/_=-]{24,}/],
  ["session-secret-assignment", /\b(?:AUTH|SESSION)_SECRET\s*[=:]\s*["']?(?!\s|["']|$|<|\$\{|process)[A-Za-z0-9+/_=-]{24,}/],
  ["payment-secret-assignment", /\bPAYMENT_(?:API_KEY|WEBHOOK_SECRET)\s*[=:]\s*["']?(?!\s|["']|$|<|\$\{|process)[A-Za-z0-9+/_=-]{16,}/],
  ["seed-password-assignment", /\bSEED_[A-Z_]*PASSWORD\s*[=:]\s*["']?(?!\s|["']|$|<|\$\{|process)[^\s"']{8,}/],
  ["ai-key-assignment", /\b(?:AI|VOICE_STT|VOICE_TTS)_API_KEY\s*[=:]\s*["']?(?!\s|["']|$|<|\$\{|process)[A-Za-z0-9_-]{20,}/],
  ["private-key-block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
];

export function scanText(text, file = "<text>") {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes("secret-scan:allow")) return;
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push({ file, line: index + 1, pattern: name });
  });
  return findings;
}

function listFiles() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

const SKIP = /(^|\/)(package-lock\.json|\.env\.example)$|\.(png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|otf|wav|mp3|webm|zip)$/i;

if (process.argv[1] && /secret-scan.mjs$/.test(process.argv[1])) {
  const findings = [];
  let scanned = 0;
  for (const file of listFiles()) {
    if (SKIP.test(file)) continue;
    try {
      if (statSync(file).size > 2 * 1024 * 1024) continue;
      findings.push(...scanText(readFileSync(file, "utf8"), file));
      scanned += 1;
    } catch {
      /* okunamayan dosya atlanır */
    }
  }
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.pattern}`);
  console.log(`secret-scan: ${scanned} dosya tarandı, ${findings.length} bulgu`);
  process.exitCode = findings.length ? 1 : 0;
}
