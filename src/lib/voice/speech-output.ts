/**
 * Yanıt sesi oynatıcısı (yalnızca istemci). Tek bir <audio> öğesi; yeni oynatma / araya girme / panel kapanışı öncekini
 * durdurur. Sessize alınmışsa hiç oynatmaz. Nesne URL'leri her oynatmadan sonra serbest bırakılır.
 */
export type SpeechPlayer = {
  play: (blob: Blob) => Promise<void>;
  stop: () => void;
  isPlaying: () => boolean;
};

export function createSpeechPlayer(): SpeechPlayer {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let resolveCurrent: (() => void) | null = null;

  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
    const r = resolveCurrent;
    resolveCurrent = null;
    r?.();
  };

  return {
    play(blob) {
      this.stop();
      url = URL.createObjectURL(blob);
      audio ??= new Audio();
      audio.src = url;
      return new Promise<void>((resolve) => {
        resolveCurrent = resolve;
        audio!.onended = release;
        audio!.onerror = release;
        audio!.play().catch(release);
      });
    },
    stop() {
      if (audio && !audio.paused) audio.pause();
      if (audio) audio.removeAttribute("src");
      release();
    },
    isPlaying: () => !!audio && !audio.paused && !audio.ended,
  };
}
