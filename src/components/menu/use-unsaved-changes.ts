"use client";

import { useEffect, useState } from "react";

/**
 * Kaydedilmemiş değişiklik uyarısı: form değişince "kirli" olur; sayfadan ayrılırken tarayıcı onayı ister.
 * Kayıt başarılı olunca `markClean()` çağrılır.
 */
export function useUnsavedChanges() {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  return { dirty, markDirty: () => setDirty(true), markClean: () => setDirty(false) };
}
