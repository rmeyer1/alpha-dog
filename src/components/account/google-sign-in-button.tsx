import Link from "next/link";

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px]"
      viewBox="0 0 18 18"
    >
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86a5.38 5.38 0 0 1-5.06-3.71H.93v2.33A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.94 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.93a9 9 0 0 0 0 8.08l3.01-2.33Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .93 4.96l3.01 2.33A5.38 5.38 0 0 1 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function GoogleSignInButton({
  href,
  label = "Sign in with Google",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      aria-label={label}
      className="inline-flex min-h-11 items-center justify-center gap-3 rounded border border-[#dadce0] bg-white px-4 text-sm font-medium text-[#3c4043] shadow-sm transition hover:bg-[#f7f8f8] focus:outline-none focus:ring-2 focus:ring-[#4285f4] focus:ring-offset-2 focus:ring-offset-[#151718]"
      href={href}
    >
      <GoogleMark />
      {label}
    </Link>
  );
}
