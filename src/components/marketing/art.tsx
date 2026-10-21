import { cn } from "@/lib/utils/cn";

/**
 * Pazarlama görselleri — saf SVG (fotoğraf indirmesi yok, LCP'yi bekletmez, her boyutta keskin). Örnek / temsilidir;
 * işletmelerin yüklediği görseller burada KULLANILMAZ.
 */
export type FoodArtKind = "grill" | "salad" | "dessert" | "drink";

export function FoodArt({ kind, className }: { kind: FoodArtKind; className?: string }) {
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" className={cn("block size-full", className)} preserveAspectRatio="xMidYMid slice">
      <rect width="120" height="90" fill={kind === "salad" ? "#ecf3e6" : kind === "dessert" ? "#f6efe4" : kind === "drink" ? "#fbefd9" : "#f4e8de"} />
      {kind === "grill" ? (
        <g>
          <ellipse cx="60" cy="52" rx="44" ry="24" fill="#fff" />
          <ellipse cx="60" cy="52" rx="36" ry="18" fill="#f3efe9" />
          <ellipse cx="40" cy="50" rx="13" ry="9" fill="#f7f1e3" />
          <circle cx="36" cy="48" r="1.3" fill="#e8dcc4" />
          <circle cx="43" cy="51" r="1.3" fill="#e8dcc4" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={54 + i * 9} y={38 + (i % 2) * 4} width="8" height="20" rx="4" fill="#7a3f22" transform={`rotate(${-12 + i * 6} ${58 + i * 9} 48)`} />
          ))}
          <path d="M80 60c6-10 14-12 16-8-4 2-8 8-13 12z" fill="#2f7d32" />
          <path d="M74 64c8-4 15-3 16 0-6 1-11 3-16 3z" fill="#c2410c" />
        </g>
      ) : kind === "salad" ? (
        <g>
          <path d="M18 46h84c0 18-19 30-42 30S18 64 18 46z" fill="#fff" />
          <path d="M22 46c4-10 14-16 24-12 6-8 20-8 26 0 10-4 22 2 26 12z" fill="#4d8a3a" />
          <path d="M30 44c6-6 12-6 16-2M60 40c6-4 12-3 16 2" stroke="#7fb069" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="44" cy="42" r="5" fill="#d9381e" />
          <circle cx="72" cy="43" r="4.5" fill="#d9381e" />
          {[
            [56, 38],
            [62, 44],
            [36, 40],
            [84, 42],
            [50, 45],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="#9d1b3a" />
          ))}
          <path d="M64 36l5 3-4 3z" fill="#c9a36b" />
        </g>
      ) : kind === "dessert" ? (
        <g>
          <ellipse cx="60" cy="70" rx="34" ry="8" fill="#e7dccb" />
          <path d="M34 40h52v26c0 5-12 9-26 9s-26-4-26-9z" fill="#fff" />
          <ellipse cx="60" cy="40" rx="26" ry="8" fill="#c8813b" />
          <ellipse cx="60" cy="39" rx="20" ry="5" fill="#a85f22" opacity="0.6" />
          <circle cx="52" cy="38" r="2" fill="#6b3a17" />
          <circle cx="64" cy="40" r="1.6" fill="#6b3a17" />
          <circle cx="70" cy="37" r="1.2" fill="#6b3a17" />
        </g>
      ) : (
        <g>
          <path d="M44 22h32l-4 52c0 3-5 5-12 5s-12-2-12-5z" fill="#fff" opacity="0.9" />
          <path d="M46 36h28l-3 37c0 2-4 4-11 4s-11-2-11-4z" fill="#f2c94c" />
          <circle cx="56" cy="50" r="3" fill="#fff" opacity="0.7" />
          <circle cx="63" cy="60" r="2" fill="#fff" opacity="0.7" />
          <path d="M70 14l-8 26" stroke="#2f7d32" strokeWidth="3" strokeLinecap="round" />
          <circle cx="72" cy="30" r="7" fill="#9ccc65" />
        </g>
      )}
    </svg>
  );
}

/**
 * Temsili QR deseni (deterministik; gerçek bir adres KODLAMAZ — okutulursa hiçbir yere gitmez). Üç konum işareti
 * gerçek QR görünümünü verir.
 */
export function QrArt({ className, seed = 7, color = "#0c0a09" }: { className?: string; seed?: number; color?: string }) {
  const n = 21;
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  const cells: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inFinder(x, y) && rand() > 0.52) cells.push([x, y]);
  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`}>
      <rect x={x} y={y} width="7" height="7" fill={color} />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill={color} />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} aria-hidden="true" className={cn("block", className)} shapeRendering="crispEdges">
      <rect x="-1" y="-1" width={n + 2} height={n + 2} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} />
      ))}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  );
}
