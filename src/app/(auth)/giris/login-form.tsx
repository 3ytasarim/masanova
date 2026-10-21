"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "@/server/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const emailError = state.fieldErrors?.email;
  const passwordError = state.fieldErrors?.password;

  return (
    <form action={formAction} noValidate className="mt-8 grid gap-5">
      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <Field id="email" label="E-posta" error={emailError}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          defaultValue={state.email}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy("email", { error: emailError })}
        />
      </Field>

      <Field id="password" label="Parola" error={passwordError}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={describedBy("password", { error: passwordError })}
        />
      </Field>

      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        Giriş yap
      </Button>
    </form>
  );
}
