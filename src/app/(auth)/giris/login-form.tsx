"use client";

import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginFormState } from "@/server/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: LoginFormState = {};
const INPUT = "h-12 rounded-xl border-stone-200 bg-white/90 pl-11 text-[0.9375rem] shadow-[inset_0_1px_2px_rgb(12_10_9/0.04)] focus-visible:border-orange-400 focus-visible:ring-orange-400/30";

export function LoginForm({ next }: { next?: "kasa" } = {}) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [show, setShow] = useState(false);
  const emailError = state.fieldErrors?.email;
  const passwordError = state.fieldErrors?.password;

  return (
    <form action={formAction} noValidate className="mt-8 grid gap-5">
      {next ? <input type="hidden" name="sonra" value={next} /> : null}
      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <Field id="email" label="E-posta" error={emailError}>
        <div className="relative">
          <Mail aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-[1.125rem] -translate-y-1/2 text-stone-400" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            placeholder="ornek@restoran.com"
            defaultValue={state.email}
            className={INPUT}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={describedBy("email", { error: emailError })}
          />
        </div>
      </Field>

      <Field id="password" label="Parola" error={passwordError}>
        <div className="relative">
          <Lock aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-[1.125rem] -translate-y-1/2 text-stone-400" />
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${INPUT} pr-12`}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={describedBy("password", { error: passwordError })}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Parolayı gizle" : "Parolayı göster"}
            aria-pressed={show}
            className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            {show ? <EyeOff aria-hidden="true" className="size-[1.125rem]" /> : <Eye aria-hidden="true" className="size-[1.125rem]" />}
          </button>
        </div>
      </Field>

      <Button
        type="submit"
        size="lg"
        loading={pending}
        className="group mt-1 h-12 w-full rounded-xl border-0 bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-[0.9375rem] text-white shadow-[0_14px_30px_-12px_rgb(220_38_38/0.7)] transition-[transform,box-shadow] hover:shadow-[0_18px_36px_-12px_rgb(220_38_38/0.8)] active:scale-[0.99]"
      >
        Giriş yap {pending ? null : <ArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />}
      </Button>
    </form>
  );
}
