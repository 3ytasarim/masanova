"use client";

import { useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/toast";

/** useActionState sonucunu bir kez toast olarak bildirir (başarı mesajı; hata formda kalır). */
export function useResultToast(state: ActionResult | null) {
  const toast = useToast();
  const seen = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (!state || seen.current === state) return;
    seen.current = state;
    if (state.ok && state.message) toast(state.message, "success");
  }, [state, toast]);
}
