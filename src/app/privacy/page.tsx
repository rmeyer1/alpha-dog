import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page-shell";

export const metadata: Metadata = {
  description:
    "How Alpha Dog collects, uses, retains, exports, and deletes account data.",
  title: "Privacy | Alpha Dog",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      description="This notice explains the account and financial-history data Alpha Dog stores, why it is used, how long it is retained, and how you can export or delete it."
      title="Privacy notice"
    >
      <section>
        <h2>Data we store</h2>
        <ul className="mt-3">
          <li>
            Account profile and sign-in identity details, including name,
            email, and linked provider identifiers.
          </li>
          <li>
            Saved screener presets and analysis-request history used to provide
            account features and troubleshoot provider operations.
          </li>
          <li>
            Paper-account settings, simulated positions, legs, events, equity
            lots, and their market-data provenance.
          </li>
          <li>
            Broker-statement import metadata, normalized rows, reconciliation
            groups, review decisions, and audit events. Alpha Dog does not store
            brokerage login credentials.
          </li>
        </ul>
      </section>

      <section>
        <h2>Providers and purposes</h2>
        <p className="mt-3">
          Supabase provides authentication and database storage. Vercel hosts
          the application and durable workflows. Features you invoke may use
          Alpaca, Finnhub, Polymarket, and OpenAI for market data or analysis.
          We use these services to authenticate accounts, produce requested
          decision-support results, maintain paper-account history, prevent
          abuse, and monitor reliability. We do not use Alpha Dog to execute
          brokerage trades.
        </p>
      </section>

      <section>
        <h2>Retention</h2>
        <ul className="mt-3">
          <li>Failed or unfinished statement imports: 30 days.</li>
          <li>Raw normalized rows for completed imports: 90 days.</li>
          <li>
            Completed import headers, reconciliation metadata, and review
            audit: 365 days.
          </li>
          <li>Provider-derived analysis-request history: 90 days.</li>
          <li>
            Pseudonymous deletion audit and retention-run history: 90 days.
          </li>
          <li>
            Active profile, preset, and paper-account data: until account
            deletion or the applicable retention rule above.
          </li>
        </ul>
        <p className="mt-3">
          A daily database job applies these rules and records bounded outcome
          counts and error codes without copying account contents into logs.
        </p>
      </section>

      <section>
        <h2>Export and deletion</h2>
        <p className="mt-3">
          The Account page provides a versioned JSON export of the signed-in
          user&apos;s profile, identities, presets, imports and decisions,
          paper-account settings, positions, legs, events, and equity lots.
          Database row-level security prevents one account from exporting
          another account&apos;s records.
        </p>
        <p className="mt-3">
          Permanent deletion requires a sign-in no more than ten minutes old,
          the account email, an exact confirmation phrase, and an
          irreversibility acknowledgement. Alpha Dog revokes refresh sessions,
          removes application data, then hard-deletes the Supabase Auth user.
          Previously issued access-token JWTs can remain cryptographically
          valid until their short expiry, but the deleted account no longer has
          application data or account authorization.
        </p>
      </section>

      <section>
        <h2>Backups and irreversibility</h2>
        <p className="mt-3">
          Deletion removes the account from active product systems. Encrypted
          disaster-recovery backups may retain deleted bytes until the hosting
          provider&apos;s normal backup expiration cycle. They are not
          available through the product and are not used to restore individual
          accounts. Once the product confirms Auth deletion, the account cannot
          be recovered through Alpha Dog.
        </p>
      </section>

      <section>
        <h2>Support</h2>
        <p className="mt-3">
          For a privacy or account-lifecycle question, open a support request in
          the{" "}
          <a
            href="https://github.com/rmeyer1/alpha-dog/issues"
            rel="noreferrer"
            target="_blank"
          >
            Alpha Dog issue tracker
          </a>
          . Do not include broker statements, financial account data,
          credentials, access tokens, or other secrets in a public issue.
        </p>
      </section>
    </LegalPageShell>
  );
}
