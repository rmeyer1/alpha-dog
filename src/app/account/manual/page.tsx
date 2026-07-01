import Link from "next/link";
import { ArrowLeft, Mail, UserPlus } from "lucide-react";
import { AccountShell } from "@/components/account/account-shell";
import { ManualAccountForm } from "@/components/account/manual-account-form";
import {
  accountNextPathFromSearchParams,
  type AccountSearchParams,
} from "@/lib/supabase/auth-ui";

export const dynamic = "force-dynamic";

export default async function ManualAccountPage({
  searchParams,
}: {
  searchParams?: Promise<AccountSearchParams>;
}) {
  const resolvedSearchParams = await searchParams ?? {};
  const nextPath = accountNextPathFromSearchParams(resolvedSearchParams);

  return (
    <AccountShell
      eyebrow="Manual account"
      icon={<UserPlus className="size-6" />}
      showAccountControl={false}
      title="Create a manual account"
    >
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
            href={`/account?next=${encodeURIComponent(nextPath)}`}
          >
            <ArrowLeft className="size-4" />
            Back to sign in
          </Link>
          <h2 className="mt-5 text-2xl font-semibold tracking-normal text-white">
            Request an email account invite.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Use this when Google sign-in is not the right fit. We will send an
            invite to the email you enter and keep account-owned features tied
            to that address.
          </p>
          <ManualAccountForm nextPath={nextPath} />
        </section>

        <aside className="rounded-lg border border-white/10 bg-[#151718] p-5">
          <Mail className="size-5 text-cyan-200" />
          <h2 className="mt-4 text-lg font-semibold text-white">
            Email verification required
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Manual accounts are created through the same server-side Supabase
            flow, then completed from the invite email.
          </p>
        </aside>
      </div>
    </AccountShell>
  );
}
