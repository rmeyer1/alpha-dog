import Link from "next/link";

export function LegalFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#080a0c] px-4 py-5 text-zinc-400 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p>Alpha Dog provides decision support, not investment advice.</p>
        <nav aria-label="Legal and support" className="flex flex-wrap gap-4">
          <Link className="hover:text-white" href="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-white" href="/terms">
            Terms
          </Link>
          <a
            className="hover:text-white"
            href="https://github.com/rmeyer1/alpha-dog/issues"
            rel="noreferrer"
            target="_blank"
          >
            Support
          </a>
        </nav>
      </div>
    </footer>
  );
}
