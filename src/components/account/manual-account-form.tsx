"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Mail, UserPlus } from "lucide-react";
import { ManualAccountChallenge } from "@/components/account/manual-account-challenge";
import {
  manualAccountErrorsFromPayload,
  validateManualAccountFields,
  type ManualAccountFieldErrors,
} from "@/lib/supabase/manual-account-ui";

interface ManualAccountAccepted {
  correlationId?: string;
  message?: string;
  status: "accepted";
}

function isManualAccountAccepted(
  payload: ManualAccountAccepted | unknown,
): payload is ManualAccountAccepted {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "status" in payload &&
      payload.status === "accepted",
  );
}

export function ManualAccountForm({
  challengeRequired,
  nextPath,
  turnstileSiteKey,
}: {
  challengeRequired: boolean;
  nextPath: string;
  turnstileSiteKey: string | null;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<ManualAccountFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"accepted" | "idle" | "submitting">(
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

    let response: Response;

    try {
      response = await fetch("/api/auth/manual-account", {
        body: JSON.stringify({
          ...(captchaToken ? { captchaToken } : {}),
          email,
          firstName,
          lastName,
          nextPath,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
    } catch {
      setStatus("idle");
      setCaptchaToken(null);
      setChallengeResetKey((value) => value + 1);
      setFormError("Manual account creation is temporarily unavailable.");
      return;
    }

    const payload = await response.json().catch(() => null) as
      | ManualAccountAccepted
      | Parameters<typeof manualAccountErrorsFromPayload>[0]
      | null;

    if (response.ok && isManualAccountAccepted(payload)) {
      setCaptchaToken(null);
      setChallengeResetKey((value) => value + 1);
      setStatus("accepted");
      return;
    }

    const mapped = manualAccountErrorsFromPayload(
      isManualAccountAccepted(payload) ? null : payload,
    );

    setStatus("idle");
    setCaptchaToken(null);
    setChallengeResetKey((value) => value + 1);
    setFieldErrors(mapped.fieldErrors);
    setFormError(mapped.formError);
  }

  const isSubmitting = status === "submitting";
  const isLocked = isSubmitting || status === "accepted";

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
            disabled={isLocked}
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
            disabled={isLocked}
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
          disabled={isLocked}
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

      <ManualAccountChallenge
        onToken={setCaptchaToken}
        required={challengeRequired}
        resetKey={challengeResetKey}
        siteKey={turnstileSiteKey}
      />

      {formError ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm text-red-100"
        >
          {formError}
        </p>
      ) : null}

      {status === "accepted" ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm text-emerald-100"
        >
          <CheckCircle2 className="mr-2 inline size-4" />
          If this email is eligible, an invitation will arrive shortly. Check
          your inbox to continue.
        </p>
      ) : null}

      <button
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
        disabled={
          isLocked ||
          (challengeRequired && (!turnstileSiteKey || !captchaToken))
        }
        type="submit"
      >
        <Mail className="size-4" />
        {isSubmitting ? "Requesting invite" : "Request invite"}
      </button>
    </form>
  );
}
