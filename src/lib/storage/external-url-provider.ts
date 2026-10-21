import type { StorageProvider } from "@/lib/storage/types";

const MAX_URL_LENGTH = 2048;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|.*\.local$|.*\.internal$)/i;

/**
 * Harici https görsel adresi. Sunucu bu adrese istek ATMAZ (SSRF yok); tarayıcı yükler.
 * Yine de yerel/özel ağ adresleri ve kimlik bilgisi içeren URL'ler reddedilir.
 */
export const externalUrlProvider: StorageProvider = {
  id: "external",
  supportsUpload: false,
  publicUrl: (key) => key,
  validateKey(key) {
    const value = key.trim();
    if (!value || value.length > MAX_URL_LENGTH) return { ok: false, error: "Geçerli bir görsel adresi girin." };
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, error: "Geçerli bir görsel adresi girin." };
    }
    if (url.protocol !== "https:") return { ok: false, error: "Görsel adresi https:// ile başlamalı." };
    if (url.username || url.password) return { ok: false, error: "Adres kullanıcı adı/parola içeremez." };
    if (PRIVATE_HOST.test(url.hostname)) return { ok: false, error: "Yerel veya özel ağ adresleri kullanılamaz." };
    return { ok: true, key: url.toString() };
  },
};
