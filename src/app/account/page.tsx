import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleUserRound,
  Database,
  KeyRound,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserPlus,
  UserCircle,
} from "lucide-react";
import { AccountShell } from "@/components/account/account-shell";
import { GoogleSignInButton } from "@/components/account/google-sign-in-button";
import { ProviderLinkingForm } from "@/components/account/provider-linking-form";
import { ProfileCompletionForm } from "@/components/account/profile-completion-form";
import { loadAccountHubState, type AccountHubState } from "@/lib/supabase/account-hub";
import {
  accountAuthNoticeFromSearchParams,
  accountNextPathFromSearchParams,
  accountProviderLinkPromptFromSearchParams,
  googleSignInPath,
  type AccountProviderLinkPrompt,
  type AccountSearchParams,
  type AuthUiNotice,
} from "@/lib/supabase/auth-ui";
import { manualAccountCreatePath } from "@/lib/supabase/manual-account-ui";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server-component";

export const dynamic = "force-dynamic";

function titleCase(value: string) {
  return value.replace(/(^|[_-])([a-z])/g, (_, separator: string, letter: string) =>
    `${separator === "_" || separator === "-" ? " " : ""}${letter.toUpperCase()}`);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <section className="min-h-32 rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        {icon}
        {label}
      </div>
      <p className="mt-4 break-words text-lg font-semibold text-white">
        {value}
      </p>
    </section>
  );
}

function AuthNoticeCard({ notice }: { notice: AuthUiNotice }) {
  if (!notice) {
    return null;
  }

  const tone = notice.status === "profile_required" ||
      notice.status === "email_conflict"
    ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
    : "border-red-300/25 bg-red-300/10 text-red-100";
  const isGoogleRetry = notice.status !== "email_conflict";

  return (
    <section className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-white">{notice.title}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {notice.message}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {isGoogleRetry ? (
            <GoogleSignInButton
              href={googleSignInPath(notice.nextPath)}
              label="Retry with Google"
            />
          ) : (
            <Link
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-3 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
              href="/account"
            >
              <UserCircle className="size-4" />
              Account hub
            </Link>
          )}
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
            href="/screeners"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

function ProviderLinkPromptCard({
  prompt,
}: {
  prompt: AccountProviderLinkPrompt | null;
}) {
  if (!prompt) {
    return null;
  }

  return (
    <section className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
          <UserCircle className="size-5" />
        </span>
        <div>
          <p className="text-sm font-medium uppercase text-cyan-200">
            Provider link confirmation
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-normal text-white">
            Link {titleCase(prompt.provider)} to this account?
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
            Confirm only if you are signed in to the account that should own
            this provider. {prompt.email
              ? `The provider reported ${prompt.email}.`
              : "The provider did not return a displayable email."} The client
            cannot merge accounts or override an existing account email.
          </p>
          <ProviderLinkingForm
            email={prompt.email}
            nextPath={prompt.nextPath}
            provider={prompt.provider}
          />
        </div>
      </div>
    </section>
  );
}

function SignInActions({ nextPath }: { nextPath: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <GoogleSignInButton href={googleSignInPath(nextPath)} />
      <Link
        aria-label="Create a manual account"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
        href={manualAccountCreatePath(nextPath)}
      >
        <UserPlus className="size-5" />
        Create manual account
      </Link>
      <div className="sm:col-span-2 sm:flex sm:justify-center">
        <Link
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718] sm:w-[calc(50%-0.375rem)]"
          href="/screeners"
        >
          Continue to public screeners
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function UnauthenticatedState({ notice }: { notice: AuthUiNotice }) {
  const nextPath = notice?.nextPath ?? "/account";

  return (
    <AccountShell
      eyebrow="Account access"
      icon={<LockKeyhole className="size-6" />}
      showAccountControl={false}
      title="Sign in to manage your account"
    >
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid gap-4">
          <AuthNoticeCard notice={notice} />
          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <SignInActions nextPath={nextPath} />
          </section>
        </section>
      </div>
    </AccountShell>
  );
}

function IncompleteProfileState({
  linkPrompt,
  nextPath,
  notice,
  state,
}: {
  linkPrompt: AccountProviderLinkPrompt | null;
  nextPath: string;
  notice: AuthUiNotice;
  state: Extract<AccountHubState, { status: "incomplete_profile" }>;
}) {
  return (
    <AccountShell
      eyebrow="Profile required"
      icon={<AlertTriangle className="size-6" />}
      title="Complete your account profile"
    >
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6 lg:px-8">
        <AuthNoticeCard notice={notice} />
        <ProviderLinkPromptCard prompt={linkPrompt} />
        <section className="rounded-lg border border-amber-300/25 bg-[#151718] p-5">
          <p className="text-sm font-medium uppercase text-amber-200">
            Missing profile fields
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
            Account features are paused until your profile is complete.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            The signed-in account {state.email ? `for ${state.email}` : ""}
            needs {state.missingFields.join(", ") || "profile details"} before
            saved presets and account-owned workflows are available.
          </p>
          <ProfileCompletionForm
            email={state.email}
            firstName={state.firstName}
            lastName={state.lastName}
            nextPath={nextPath}
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricTile
              icon={<CircleUserRound className="size-4 text-amber-200" />}
              label="Profile status"
              value="Incomplete"
            />
            <MetricTile
              icon={<KeyRound className="size-4 text-cyan-200" />}
              label="Account id"
              value={state.userId}
            />
            <MetricTile
              icon={<ShieldCheck className="size-4 text-zinc-300" />}
              label="Next step"
              value="Profile completion"
            />
          </div>
        </section>
      </div>
    </AccountShell>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <AccountShell
      eyebrow="Account unavailable"
      icon={<AlertTriangle className="size-6" />}
      title="Account state could not be loaded"
    >
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-red-300/25 bg-[#151718] p-5">
          <p className="text-sm leading-6 text-zinc-300">{message}</p>
        </section>
      </div>
    </AccountShell>
  );
}

function ReadyState({
  linkPrompt,
  notice,
  state,
}: {
  linkPrompt: AccountProviderLinkPrompt | null;
  notice: AuthUiNotice;
  state: Extract<AccountHubState, { status: "ready" }>;
}) {
  const fullName = `${state.firstName} ${state.lastName}`;

  return (
    <AccountShell
      eyebrow="Account hub"
      icon={<CheckCircle2 className="size-6" />}
      title={fullName}
    >
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <section className="grid gap-4">
          <AuthNoticeCard notice={notice} />
          <ProviderLinkPromptCard prompt={linkPrompt} />
          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-medium uppercase text-emerald-200">
                  Profile complete
                </p>
                <h2 className="mt-2 break-words text-2xl font-semibold tracking-normal text-white">
                  {state.email}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                  Saved presets and account-owned workflows are scoped to this
                  Supabase user.
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100">
                <CheckCircle2 className="size-4" />
                Ready
              </span>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <MetricTile
              icon={<CircleUserRound className="size-4 text-emerald-200" />}
              label="Identity"
              value={state.userId}
            />
            <MetricTile
              icon={<Database className="size-4 text-cyan-200" />}
              label="Saved presets"
              value={`${state.presetCount}`}
            />
            <MetricTile
              icon={<ShieldCheck className="size-4 text-amber-200" />}
              label="Primary provider"
              value={state.primaryProvider ? titleCase(state.primaryProvider) : "Not set"}
            />
          </div>

          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <h2 className="text-lg font-semibold text-white">
              Connected providers
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              These providers are linked to this signed-in account. Future
              provider emails, including Apple private relay addresses, are
              shown exactly as recorded by the backend.
            </p>
            {state.identities.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                No provider identity rows have been recorded yet.
              </p>
            ) : (
              <div className="mt-4 grid gap-3">
                {state.identities.map((identity) => (
                  <div
                    className="rounded-lg border border-white/10 bg-black/20 p-4"
                    key={`${identity.provider}-${identity.providerEmail ?? "none"}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-white">
                          {titleCase(identity.provider)}
                        </p>
                        <p className="mt-1 break-words text-sm text-zinc-400">
                          {identity.providerEmail ?? "Provider email unavailable"}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-500">
                        Added {formatDateTime(identity.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <Save className="size-5 text-emerald-200" />
            <h2 className="mt-4 text-lg font-semibold text-white">
              Preset ownership
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Saved presets are account-owned Supabase records protected by
              server route guards and RLS.
            </p>
          </section>

          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <KeyRound className="size-5 text-amber-200" />
            <h2 className="mt-4 text-lg font-semibold text-white">
              Profile updated
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {formatDateTime(state.profileUpdatedAt)}
            </p>
          </section>
        </aside>
      </div>
    </AccountShell>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams?: Promise<AccountSearchParams>;
}) {
  const resolvedSearchParams = await searchParams ?? {};
  const authNotice = accountAuthNoticeFromSearchParams(
    resolvedSearchParams,
  );
  const linkPrompt = accountProviderLinkPromptFromSearchParams(
    resolvedSearchParams,
  );
  const nextPath = authNotice?.nextPath ??
    accountNextPathFromSearchParams(resolvedSearchParams);
  const state = await loadAccountHubState(
    await createSupabaseServerComponentClient(),
  );

  if (state.status === "unauthenticated") {
    return <UnauthenticatedState notice={authNotice} />;
  }

  if (state.status === "incomplete_profile") {
    return (
      <IncompleteProfileState
        linkPrompt={linkPrompt}
        nextPath={nextPath}
        notice={authNotice}
        state={state}
      />
    );
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} />;
  }

  return (
    <ReadyState
      linkPrompt={linkPrompt}
      notice={authNotice}
      state={state}
    />
  );
}
