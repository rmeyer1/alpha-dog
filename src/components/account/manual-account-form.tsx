"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Mail, UserPlus } from "lucide-react";
import {
  manualAccountConflictPath,
  manualAccountErrorsFromPayload,
  manualAccountRedirectTo,
  validateManualAccountFields,
  type ManualAccountFieldErrors,
} from "@/lib/supabase/manual-account-ui";

interface ManualAccountSuccess {
  account?: {
    email?: string;
  };
  status: "invite_sent";
}

function isManualAccountSuccess(
  payload: ManualAccountSuccess | unknown,
): payload is ManualAccountSuccess {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "status" in payload &&
      payload.status === "invite_sent",
  );
}

export function ManualAccountForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ManualAccountFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "invite_sent">(
    "idle",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const fields = { email, firstName, lastName };
    const nextFieldErrors = validateManualAccountFields(fields);
    setFieldErrors(nextFieldErrors);
    setFormError(null);

    if (
      nextFieldErrors.email ||
      nextFieldErrors.firstName ||
      nextFieldErrors.lastName
    ) {
      return;
    }

    setStatus("submitting");

    const response = await fetch("/api/auth/manual-account", {
      body: JSON.stringify({
        email,
        firstName,
        lastName,
        redirectTo: manualAccountRedirectTo(window.location.origin, nextPath),
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = await response.json().catch(() => null) as
      | ManualAccountSuccess
      | Parameters<typeof manualAccountErrorsFromPayload>[0]
      | null;

    if (response.ok && isManualAccountSuccess(payload)) {
      setInviteEmail(payload.account?.email ?? email.trim());
      setStatus("invite_sent");
      return;
    }

    const mapped = manualAccountErrorsFromPayload(
      isManualAccountSuccess(payload) ? null : payload,
    );

    if (mapped.conflict) {
      router.push(manualAccountConflictPath(nextPath));
      return;
    }

    setStatus("idle");
    setFieldErrors(mapped.fieldErrors);
    setFormError(mapped.formError);
  }

  const isSubmitting = status === "submitting";

  return (
    <form
      className="mt-5 grid gap-4 rounded-lg border border-white/10 bg-black/20 p-4"
      onSubmit={onSubmit}
    >
      <div className="flex items-center gap-2">
        <UserPlus className="size-4 text-emerald-200" />
        <h3 className="font-semibold text-white">Create manual account</h3>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm" htmlFor="manualFirstName">
          <span className="font-medium text-zinc-300">First name</span>
          <input
            aria-describedby={fieldErrors.firstName ? "manualFirstName-error" : undefined}
            aria-invalid={Boolean(fieldErrors.firstName)}
            autoComplete="given-name"
            className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none transition focus:border-emerald-300/70"
            disabled={isSubmitting}
            id="manualFirstName"
            onChange={(event) => setFirstName(event.target.value)}
            required
            value={firstName}
          />
          {fieldErrors.firstName ? (
            <span className="text-xs text-red-200" id="manualFirstName-error">
              {fieldErrors.firstName}
            </span>
          ) : null}
        </label>

        <label className="grid gap-1.5 text-sm" htmlFor="manualLastName">
          <span className="font-medium text-zinc-300">Last name</span>
          <input
            aria-describedby={fieldErrors.lastName ? "manualLastName-error" : undefined}
            aria-invalid={Boolean(fieldErrors.lastName)}
            autoComplete="family-name"
            className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none transition focus:border-emerald-300/70"
            disabled={isSubmitting}
            id="manualLastName"
            onChange={(event) => setLastName(event.target.value)}
            required
            value={lastName}
          />
          {fieldErrors.lastName ? (
            <span className="text-xs text-red-200" id="manualLastName-error">
              {fieldErrors.lastName}
            </span>
          ) : null}
        </label>
      </div>

      <label className="grid gap-1.5 text-sm" htmlFor="manualEmail">
        <span className="font-medium text-zinc-300">Email</span>
        <input
          aria-describedby={fieldErrors.email ? "manualEmail-error" : undefined}
          aria-invalid={Boolean(fieldErrors.email)}
          autoComplete="email"
          className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none transition focus:border-emerald-300/70"
          disabled={isSubmitting}
          id="manualEmail"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
        {fieldErrors.email ? (
          <span className="text-xs text-red-200" id="manualEmail-error">
            {fieldErrors.email}
          </span>
        ) : null}
      </label>

      {formError ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm text-red-100"
        >
          {formError}
        </p>
      ) : null}

      {status === "invite_sent" ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm text-emerald-100"
        >
          <CheckCircle2 className="mr-2 inline size-4" />
          Invite sent{inviteEmail ? ` to ${inviteEmail}` : ""}. Check your email
          to continue.
        </p>
      ) : null}

      <button
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
        disabled={isSubmitting}
        type="submit"
      >
        <Mail className="size-4" />
        {isSubmitting ? "Creating account" : "Create account"}
      </button>
    </form>
  );
}
