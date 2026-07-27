import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell } from "@/components/legal-page-shell";

export const metadata: Metadata = {
  description: "Terms for using Alpha Dog decision-support software.",
  title: "Terms | Alpha Dog",
};

export default function TermsPage() {
  return (
    <LegalPageShell
      description="These product terms set expectations for Alpha Dog accounts, decision-support output, acceptable use, and account termination."
      title="Terms of use"
    >
      <section>
        <h2>Decision support only</h2>
        <p className="mt-3">
          Alpha Dog provides research, ranking, simulation, and
          decision-support tools. It is not a broker, investment adviser, tax
          adviser, or trade-execution service. Market data can be delayed,
          incomplete, or unavailable. You remain responsible for independently
          validating any information before making a financial decision.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <p className="mt-3">
          Keep sign-in links and sessions secure, provide accurate account
          information, and use only data you are authorized to upload. Paper
          positions are simulations and do not represent holdings at a
          brokerage. Alpha Dog does not ask for or store brokerage login
          credentials.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul className="mt-3">
          <li>
            Do not bypass authentication, quotas, provider limits, or security
            controls.
          </li>
          <li>
            Do not upload malicious content or data that violates another
            person&apos;s rights.
          </li>
          <li>
            Do not use the service to automate abusive provider traffic or
            misrepresent simulated output as executed trading activity.
          </li>
        </ul>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p className="mt-3">
          Features and providers may change, pause, or fail. Alpha Dog may
          modify these terms or the product when needed for security,
          reliability, legal, or operational reasons. Material product notices
          should identify their effective date.
        </p>
      </section>

      <section>
        <h2>Privacy, export, and termination</h2>
        <p className="mt-3">
          The <Link href="/privacy">Privacy notice</Link> describes stored data,
          providers, retention, export, and deletion. You may permanently
          delete your account from the Account page. Alpha Dog may restrict or
          terminate access used for abuse or security compromise while
          preserving applicable export and deletion rights.
        </p>
      </section>

      <section>
        <h2>Support</h2>
        <p className="mt-3">
          Product questions can be filed in the{" "}
          <a
            href="https://github.com/rmeyer1/alpha-dog/issues"
            rel="noreferrer"
            target="_blank"
          >
            Alpha Dog issue tracker
          </a>
          . Never post financial records, credentials, or tokens in a public
          issue.
        </p>
      </section>
    </LegalPageShell>
  );
}
