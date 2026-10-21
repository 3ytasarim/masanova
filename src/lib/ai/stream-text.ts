/**
 * Akış metnini konuşulabilir cümlelere bölen tampon (saf). Ses parça parça üretilir: ilk cümle bitince seslendirme başlar
 * (algılanan gecikme düşer). Her cümle seslendirilmeden ÖNCE güvenlik korumasından geçer (akış güvenliği atlamaz).
 * Cümle sonu = noktalama + boşluk (yalnızca devamı gelmişse; "₺380," gibi yarım sayılar beklenir). Çok kısa parçalar ve
 * kısaltmalar ("vb.", "Dr.") bir sonraki cümleyle birleştirilir.
 */
const ABBREV = /(?:^|\s)(?:vb|vs|bkz|örn|dr|mr|mrs|st|z\.b|u\.a|т\.е|т\.д)\.$/i;
const BOUNDARY = /[.!?…؟]+\s+|\n+/g;

export class SentenceBuffer {
  private buffer = "";

  constructor(private readonly minLength = 12) {}

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let start = 0;
    BOUNDARY.lastIndex = 0;
    for (let m = BOUNDARY.exec(this.buffer); m; m = BOUNDARY.exec(this.buffer)) {
      const end = m.index + m[0].length;
      const candidate = this.buffer.slice(start, end).trim();
      if (candidate.length < this.minLength || ABBREV.test(candidate)) continue; // sonrakine birleştir
      out.push(candidate);
      start = end;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest || null;
  }
}

export function splitSentences(text: string, minLength = 12): string[] {
  const b = new SentenceBuffer(minLength);
  const out = b.push(text);
  const tail = b.flush();
  return tail ? [...out, tail] : out;
}
