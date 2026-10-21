/**
 * Deterministik SAHTE Redis sunucusu (RESP2 / TCP) — gerçek Redis bulunmayan ortamda sağlayıcı sözleşme testleri ve
 * iki ayrı Next sürecinin paylaştığı tarayıcı testi için. Gerçek istemci (ioredis) gerçek protokolle konuşur; uygulama
 * kodu değişmez. Tek iş parçacıklı olay döngüsü → her komut ve MULTI/EXEC bloğu atomik (gerçek Redis gibi).
 *
 * Desteklenen alt küme: PING, ECHO, INFO, SELECT, CLIENT, QUIT, INCR, PEXPIRE (NX/XX/GT/LT), PTTL, DEL, GET, SET,
 * MULTI / EXEC / DISCARD, PUBLISH, SUBSCRIBE, UNSUBSCRIBE. Desteklenmeyen komut → hata (sessizce yutulmaz).
 * Komut satırından: node tests/support/fake-redis.ts <port>
 * NOT: Bu bir test aracıdır — gerçek Redis yerine üretimde KULLANILMAZ.
 */
import { createServer, type Server, type Socket } from "node:net";

type Entry = { value: string; expiresAt: number | null };
type Client = { socket: Socket; subscriptions: Set<string>; queue: string[][] | null };

const CRLF = "\r\n";
const simple = (s: string) => `+${s}${CRLF}`;
const error = (s: string) => `-${s}${CRLF}`;
const integer = (n: number) => `:${n}${CRLF}`;
const bulk = (s: string | null) => (s === null ? `$-1${CRLF}` : `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`);
const array = (items: string[]) => `*${items.length}${CRLF}${items.join("")}`;

/** RESP ayrıştırıcı: dizi / satır içi komutları tamponla. */
function parse(buffer: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = [];
  let offset = 0;
  const readLine = (from: number) => {
    const end = buffer.indexOf(CRLF, from);
    return end < 0 ? null : { line: buffer.toString("utf8", from, end), next: end + 2 };
  };
  while (offset < buffer.length) {
    if (buffer[offset] === 0x2a) {
      const header = readLine(offset);
      if (!header) break;
      const count = Number(header.line.slice(1));
      let cursor = header.next;
      const args: string[] = [];
      let complete = true;
      for (let i = 0; i < count; i++) {
        const len = readLine(cursor);
        if (!len) {
          complete = false;
          break;
        }
        const size = Number(len.line.slice(1));
        if (len.next + size + 2 > buffer.length) {
          complete = false;
          break;
        }
        args.push(buffer.toString("utf8", len.next, len.next + size));
        cursor = len.next + size + 2;
      }
      if (!complete) break;
      commands.push(args);
      offset = cursor;
    } else {
      const inline = readLine(offset);
      if (!inline) break;
      if (inline.line.trim()) commands.push(inline.line.trim().split(/\s+/));
      offset = inline.next;
    }
  }
  return { commands, rest: buffer.subarray(offset) };
}

export type FakeRedis = {
  port: number;
  stats: { commands: number; published: number; connections: number };
  close(): Promise<void>;
  /** Tüm istemci bağlantılarını kopar (ağ kesintisi / Redis yeniden başlatma benzetimi). */
  dropConnections(): void;
  flush(): void;
};

export function startFakeRedis(port = 0, host = "127.0.0.1"): Promise<FakeRedis> {
  const store = new Map<string, Entry>();
  const clients = new Set<Client>();
  const stats = { commands: 0, published: 0, connections: 0 };
  const now = () => Date.now();
  const live = (key: string): Entry | null => {
    const e = store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= now()) {
      store.delete(key);
      return null;
    }
    return e;
  };

  function exec(client: Client, args: string[]): string {
    const [rawName, ...rest] = args;
    const name = (rawName ?? "").toUpperCase();
    stats.commands += 1;
    switch (name) {
      case "PING":
        return client.subscriptions.size ? array([bulk("pong"), bulk(rest[0] ?? "")]) : rest[0] ? bulk(rest[0]) : simple("PONG");
      case "ECHO":
        return bulk(rest[0] ?? "");
      case "INFO":
        return bulk("# Server\r\nredis_version:7.2.0-fake\r\n# Persistence\r\nloading:0\r\n");
      case "SELECT":
      case "CLIENT":
        return simple("OK");
      case "INCR": {
        const key = rest[0]!;
        const e = live(key);
        const next = (e ? Number(e.value) : 0) + 1;
        if (!Number.isInteger(next)) return error("ERR value is not an integer or out of range");
        store.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
        return integer(next);
      }
      case "PEXPIRE": {
        const [key, ms, flag] = rest;
        const e = live(key!);
        if (!e) return integer(0);
        const f = (flag ?? "").toUpperCase();
        if (f === "NX" && e.expiresAt !== null) return integer(0);
        if (f === "XX" && e.expiresAt === null) return integer(0);
        e.expiresAt = now() + Number(ms);
        return integer(1);
      }
      case "PTTL": {
        const e = live(rest[0]!);
        if (!e) return integer(-2);
        return integer(e.expiresAt === null ? -1 : Math.max(0, e.expiresAt - now()));
      }
      case "DEL": {
        let n = 0;
        for (const k of rest) if (store.delete(k)) n += 1;
        return integer(n);
      }
      case "GET":
        return bulk(live(rest[0]!)?.value ?? null);
      case "SET":
        store.set(rest[0]!, { value: rest[1] ?? "", expiresAt: null });
        return simple("OK");
      case "PUBLISH": {
        const [channel, message] = rest;
        let receivers = 0;
        for (const c of clients) {
          if (!c.subscriptions.has(channel!)) continue;
          receivers += 1;
          c.socket.write(array([bulk("message"), bulk(channel!), bulk(message ?? "")]));
        }
        stats.published += 1;
        return integer(receivers);
      }
      case "SUBSCRIBE": {
        let out = "";
        for (const ch of rest) {
          client.subscriptions.add(ch);
          out += array([bulk("subscribe"), bulk(ch), integer(client.subscriptions.size)]);
        }
        return out;
      }
      case "UNSUBSCRIBE": {
        const targets = rest.length ? rest : [...client.subscriptions];
        let out = "";
        for (const ch of targets) {
          client.subscriptions.delete(ch);
          out += array([bulk("unsubscribe"), bulk(ch), integer(client.subscriptions.size)]);
        }
        return out || array([bulk("unsubscribe"), bulk(null), integer(0)]);
      }
      case "QUIT":
        setImmediate(() => client.socket.end());
        return simple("OK");
      default:
        return error(`ERR unknown command '${rawName}' (fake redis)`);
    }
  }

  function handle(client: Client, args: string[]): string {
    const name = (args[0] ?? "").toUpperCase();
    if (name === "MULTI") {
      client.queue = [];
      return simple("OK");
    }
    if (name === "DISCARD") {
      client.queue = null;
      return simple("OK");
    }
    if (name === "EXEC") {
      if (!client.queue) return error("ERR EXEC without MULTI");
      const queued = client.queue;
      client.queue = null;
      // Atomik: kuyruktaki komutlar araya başka istemci girmeden tek seferde uygulanır.
      return `*${queued.length}${CRLF}${queued.map((q) => exec(client, q)).join("")}`;
    }
    if (client.queue) {
      client.queue.push(args);
      return simple("QUEUED");
    }
    return exec(client, args);
  }

  const server: Server = createServer((socket) => {
    const client: Client = { socket, subscriptions: new Set(), queue: null };
    clients.add(client);
    stats.connections += 1;
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const { commands, rest } = parse(pending);
      pending = rest;
      for (const args of commands) socket.write(handle(client, args));
    });
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actual,
        stats,
        dropConnections() {
          for (const c of clients) c.socket.destroy();
          clients.clear();
        },
        flush() {
          store.clear();
        },
        close: () =>
          new Promise<void>((done) => {
            for (const c of clients) c.socket.destroy();
            clients.clear();
            server.close(() => done());
          }),
      });
    });
  });
}

// Komut satırı: node tests/support/fake-redis.ts 6390
if (process.argv[1] && /fake-redis\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2] ?? "6390");
  void startFakeRedis(port).then((r) => console.log(`fake-redis listening on 127.0.0.1:${r.port}`));
}
