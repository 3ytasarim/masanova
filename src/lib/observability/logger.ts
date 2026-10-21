import { redact } from "@/lib/observability/redact";

/**
 * Yapılandırılmış log (satır başına bir JSON). Alanlar her zaman redact() süzgecinden geçer: anahtar, QR tokenı,
 * kanıt, oturum, parola, ham ses ve müşteri konuşma metni loglanmaz. Önerilen alanlar:
 *   requestId (correlation), route, durationMs, status, code (ERROR_CODES), tenant (iç kimlik — tarayıcıya değil),
 *   provider, model, latencyMs, category, reconnects.
 *
 * Satıcıdan bağımsız kanca: setErrorReporter() ile Sentry / OpenTelemetry vb. sonradan bağlanır (bu sprintte harici hesap
 * gerekmez). Kanca da yalnızca kırpılmış alanları alır.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;
export type ErrorReporter = (event: string, fields: LogFields) => void;

let reporter: ErrorReporter | null = null;
let sink: (line: string, level: Level) => void = (line, level) => (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);

export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

/** Testler için: çıktıyı yakala. */
export function setLogSink(fn: ((line: string, level: Level) => void) | null): void {
  sink = fn ?? ((line, level) => (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`));
}

function threshold(): number {
  const l = process.env.LOG_LEVEL as Level | undefined;
  return ORDER[l && l in ORDER ? l : process.env.NODE_ENV === "test" ? "warn" : "info"];
}

function write(level: Level, event: string, fields: LogFields = {}) {
  if (ORDER[level] < threshold()) return;
  const safe = redact(fields) as LogFields;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, pid: process.pid, ...safe });
  try {
    sink(line, level);
  } catch {
    /* log hatası uygulamayı durdurmaz */
  }
  if (level === "error" && reporter) {
    try {
      reporter(event, safe);
    } catch {
      /* raporlayıcı hatası yutulur */
    }
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
  /** Aynı bağlamı (requestId, route…) taşıyan alt logger. */
  with(context: LogFields) {
    return {
      debug: (event: string, fields?: LogFields) => write("debug", event, { ...context, ...fields }),
      info: (event: string, fields?: LogFields) => write("info", event, { ...context, ...fields }),
      warn: (event: string, fields?: LogFields) => write("warn", event, { ...context, ...fields }),
      error: (event: string, fields?: LogFields) => write("error", event, { ...context, ...fields }),
    };
  },
};
