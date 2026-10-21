"use client";

import { startTransition, useActionState, useRef, type FormEvent } from "react";

/**
 * Server Action'lı form gönderimi — kullanıcı girdisini KORUYAN sürüm.
 *
 * React 19, `<form action={fn}>` ile gönderilen formlarda eylem tamamlanınca kontrolsüz alanları sıfırlar;
 * eylem doğrulama hatası döndürse bile kullanıcının yazdıkları kaybolur. Bu kanca formu `onSubmit` ile
 * gönderir (sıfırlama olmaz); yalnızca `resetOnSuccess` verildiğinde başarıdan sonra form temizlenir
 * (ör. "ekle" formları).
 */
export function useFormAction<S>(
  action: (state: Awaited<S>, formData: FormData) => Promise<S>,
  initialState: Awaited<S>,
  options: { resetOnSuccess?: (state: Awaited<S>) => boolean } = {},
) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState<S, FormData>(async (prev, formData) => {
    const next = await action(prev, formData);
    if (options.resetOnSuccess?.(next)) formRef.current?.reset();
    return next;
  }, initialState);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => dispatch(formData));
  }

  return { state, pending, onSubmit, formRef };
}
