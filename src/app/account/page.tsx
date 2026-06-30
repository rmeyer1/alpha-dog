import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleUserRound,
  Database,
  KeyRound,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import { loadAccountHubState, type AccountHubState } from "@/lib/supabase/account-hub";
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

function AccountShell({
  children,
  eyebrow,
  icon,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <main className="min-h-screen bg-[#080a0c] text-zinc-100">
      <header className="border-b border-white/10 bg-[#111314]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <Link
              className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
              href="/"
            >
              <ArrowLeft className="size-4" />
              Alpha Dog
            </Link>
            <p className="mt-4 text-sm font-medium uppercase text-emerald-200">
              {eyebrow}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-emerald-100">
                {icon}
              </span>
              <h1 className="text-3xl font-semibold tracking-normal text-white">
                {title}
              </h1>
            </div>
          </div>
          <nav
            aria-label="Account navigation"
            className="max-w-full overflow-x-auto rounded-lg border border-white/10 bg-black/25 p-1"
          >
            <div className="flex w-max gap-1">
              <Link
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                href="/screeners"
              >
                Screeners
              </Link>
              <Link
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                href="/traders"
              >
                Traders
              </Link>
              <Link
                className="rounded-md bg-emerald-300 px-3 py-2 text-sm font-medium text-black"
                href="/account"
              >
                Account
              </Link>
            </div>
          </nav>
        </div>
      </header>
      {children}
    </main>
  );
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

function UnauthenticatedState() {
  return (
    <AccountShell
      eyebrow="Session required"
      icon={<LockKeyhole className="size-6" />}
      title="Sign in to manage your account"
    >
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
          <h2 className="text-2xl font-semibold tracking-normal text-white">
            Account-owned settings need a Supabase session.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Sign in to view profile status, connected providers, saved presets,
            and account-owned controls.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
              href="/api/auth/oauth/google?next=/account"
            >
              <UserCircle className="size-5" />
              Sign in with Google
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
              href="/screeners"
            >
              Continue to public screeners
            </Link>
          </div>
        </section>
        <aside className="rounded-lg border border-white/10 bg-[#151718] p-5">
          <ShieldCheck className="size-5 text-cyan-200" />
          <h2 className="mt-4 text-lg font-semibold text-white">
            Server-checked access
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Account data is read server-side from Supabase Auth and
            account-owned RLS tables.
          </p>
        </aside>
      </div>
    </AccountShell>
  );
}

function IncompleteProfileState({ state }: {
  state: Extract<AccountHubState, { status: "incomplete_profile" }>;
}) {
  return (
    <AccountShell
      eyebrow="Profile required"
      icon={<AlertTriangle className="size-6" />}
      title="Complete your account profile"
    >
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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

function ReadyState({ state }: {
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

export default async function AccountPage() {
  const state = await loadAccountHubState(
    await createSupabaseServerComponentClient(),
  );

  if (state.status === "unauthenticated") {
    return <UnauthenticatedState />;
  }

  if (state.status === "incomplete_profile") {
    return <IncompleteProfileState state={state} />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} />;
  }

  return <ReadyState state={state} />;
}
