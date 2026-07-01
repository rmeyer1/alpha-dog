"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Save } from "lucide-react";

interface FieldErrors {
  firstName?: string;
  lastName?: string;
}

function validateName(value: string, label: string) {
  return value.trim() ? null : `${label} is required.`;
}

export function ProfileCompletionForm({
  email,
  firstName = "",
  lastName = "",
  nextPath,
}: {
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nextPath: string;
}) {
  const router = useRouter();
  const [firstNameValue, setFirstNameValue] = useState(firstName ?? "");
  const [lastNameValue, setLastNameValue] = useState(lastName ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = {
      firstName: validateName(firstNameValue, "First name") ?? undefined,
      lastName: validateName(lastNameValue, "Last name") ?? undefined,
    };

    setErrors(nextErrors);
    setServerError(null);

    if (nextErrors.firstName || nextErrors.lastName) {
      return;
    }

    setStatus("saving");

    const response = await fetch("/api/auth/profile", {
      body: JSON.stringify({
        firstName: firstNameValue,
        lastName: lastNameValue,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });

    const payload = await response.json().catch(() => null) as
      | { error?: { message?: string } }
      | null;

    if (!response.ok) {
      setStatus("idle");
      setServerError(
        payload?.error?.message ?? "Profile could not be saved.",
      );
      return;
    }

    setStatus("saved");
    router.refresh();
    router.push(nextPath);
  }

  const isSaving = status === "saving";

  return (
    <form className="mt-6 grid gap-5" onSubmit={onSubmit}>
      <section className="rounded-lg border border-white/10 bg-black/20 p-4">
        <p className="text-xs font-medium uppercase text-zinc-500">
          Sign-in email
        </p>
        <p className="mt-2 break-words font-mono text-sm text-zinc-100">
          {email ?? "Email unavailable"}
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          This email comes from Supabase Auth and cannot be changed from this
          profile form.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm" htmlFor="firstName">
          <span className="font-medium text-zinc-300">First name</span>
          <input
            aria-describedby={errors.firstName ? "firstName-error" : undefined}
            aria-invalid={Boolean(errors.firstName)}
            autoComplete="given-name"
            className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none transition focus:border-emerald-300/70"
            id="firstName"
            onChange={(event) => setFirstNameValue(event.target.value)}
            required
            value={firstNameValue}
          />
          {errors.firstName ? (
            <span className="text-xs text-red-200" id="firstName-error">
              {errors.firstName}
            </span>
          ) : null}
        </label>

        <label className="grid gap-1.5 text-sm" htmlFor="lastName">
          <span className="font-medium text-zinc-300">Last name</span>
          <input
            aria-describedby={errors.lastName ? "lastName-error" : undefined}
            aria-invalid={Boolean(errors.lastName)}
            autoComplete="family-name"
            className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none transition focus:border-emerald-300/70"
            id="lastName"
            onChange={(event) => setLastNameValue(event.target.value)}
            required
            value={lastNameValue}
          />
          {errors.lastName ? (
            <span className="text-xs text-red-200" id="lastName-error">
              {errors.lastName}
            </span>
          ) : null}
        </label>
      </div>

      {serverError ? (
        <p className="rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm text-red-100">
          {serverError}
        </p>
      ) : null}

      {status === "saved" ? (
        <p className="inline-flex items-center gap-2 text-sm text-emerald-100">
          <CheckCircle2 className="size-4" />
          Profile saved.
        </p>
      ) : null}

      <button
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
        disabled={isSaving}
        type="submit"
      >
        <Save className="size-4" />
        {isSaving ? "Saving profile" : "Save profile"}
      </button>
    </form>
  );
}
