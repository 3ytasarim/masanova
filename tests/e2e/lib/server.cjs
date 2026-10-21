// Tarayıcı test paketleri için sunucu süreci yardımcıları (Windows + POSIX). Her paket TAZE süreçle başlar: bellek içi
// hız sınırı sayaçları / önbellek / olay yolu bir paketten diğerine TAŞINMAZ (Sprint 9/10'daki etkileşim sorununun çözümü).
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const isWin = process.platform === "win32";

function pidsOnPort(port) {
  try {
    if (isWin) {
      return [...new Set(execSync("netstat -ano", { encoding: "utf8" }).split(/\r?\n/).filter((l) => new RegExp(`[:.]${port}\\s.*LISTENING`).test(l)).map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && p !== "0"))];
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, { encoding: "utf8" }).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Porttaki dinleyiciyi (ve alt süreç ağacını) sert biçimde durdur — "süreç çöktü / öldürüldü" benzetimi de budur. */
function killPort(port) {
  for (const pid of pidsOnPort(port)) {
    try {
      if (isWin) execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      else process.kill(Number(pid), "SIGKILL");
    } catch {
      /* zaten bitti */
    }
  }
}

/** next start (önceden derlenmiş) — env ile; log dosyasına yazar. */
function startServer(port, env = {}, logName = `server-${port}.log`) {
  const logDir = path.join(ROOT, "tmp/e2e");
  fs.mkdirSync(logDir, { recursive: true });
  const fd = fs.openSync(path.join(logDir, logName), "a");
  const child = spawn(isWin ? "cmd" : "npx", isWin ? ["/c", `npx next start -p ${port}`] : ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    // next start her zaman NODE_ENV=production (test araçlarının .env yüklemesi development sızdırmasın); profil APP_ENV ile.
    env: { ...process.env, ...env, NODE_ENV: "production" },
    detached: !isWin,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  child.unref();
  return child;
}

async function waitHealthy(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return await res.json();
    } catch {
      /* henüz açılmadı */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server on ${port} not healthy`);
}

module.exports = { ROOT, killPort, startServer, waitHealthy, pidsOnPort };
