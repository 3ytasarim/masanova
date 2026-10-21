"use client";

import { useState } from "react";
import { slugify } from "@/lib/utils/slugify";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Ad + kısa ad: kısa ad addan otomatik önerilir; kullanıcı kısa adı elle değiştirince öneri durur.
 * Benzersizlik (kiracı içinde) sunucuda denetlenir.
 */
export function NameSlugFields({
  idPrefix,
  defaultName = "",
  defaultSlug = "",
  errors = {},
  nameLabel = "Ad",
  onChange,
}: {
  idPrefix: string;
  defaultName?: string;
  defaultSlug?: string;
  errors?: Record<string, string | undefined>;
  nameLabel?: string;
  onChange?: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  const [touched, setTouched] = useState(defaultSlug !== "" && defaultSlug !== slugify(defaultName, 80));
  const effectiveSlug = touched ? slug : slugify(name, 80);
  const nameId = `${idPrefix}-name`;
  const slugId = `${idPrefix}-slug`;

  return (
    <>
      <Field id={nameId} label={nameLabel} required error={errors.name}>
        <Input
          id={nameId}
          name="name"
          value={name}
          maxLength={120}
          required
          onChange={(e) => {
            setName(e.target.value);
            onChange?.();
          }}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy(nameId, { error: errors.name })}
        />
      </Field>
      <Field id={slugId} label="Kısa ad (URL)" required hint="Addan önerilir. Bu işletmede benzersiz olmalı." error={errors.slug}>
        <Input
          id={slugId}
          name="slug"
          value={effectiveSlug}
          maxLength={80}
          required
          className="font-mono"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value.toLowerCase());
            onChange?.();
          }}
          aria-invalid={errors.slug ? true : undefined}
          aria-describedby={describedBy(slugId, { hint: true, error: errors.slug })}
        />
      </Field>
    </>
  );
}
