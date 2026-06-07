import Image from "next/image";
import Link from "next/link";
import { BarChart3, UserCircle } from "lucide-react";

const destinations = [
  {
    label: "Wheel Screener",
    href: "/screeners",
    icon: BarChart3,
    variant:
      "bg-emerald-300 text-[#051626] shadow-[0_18px_45px_rgba(31,199,55,0.16)] hover:bg-emerald-200",
  },
  {
    label: "Account",
    href: "/account",
    icon: UserCircle,
    variant:
      "border border-white/15 bg-white/[0.06] text-white shadow-[0_16px_35px_rgba(0,0,0,0.18)] hover:bg-white/[0.1]",
  },
];

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#080a0c] text-white">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6 lg:px-8">
        <section className="flex flex-1 flex-col items-center justify-center gap-8 py-10 sm:gap-10 sm:py-14">
          <h1 className="sr-only">Alpha Dog</h1>

          <div className="relative flex w-full max-w-[780px] justify-center px-2">
            <div className="absolute inset-x-0 top-[18%] bottom-[12%] rounded-lg bg-[#eef7ef]/10 blur-3xl" />
            <Image
              alt="Alpha Dog"
              className="relative h-auto w-full drop-shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
              height={737}
              priority
              sizes="(max-width: 640px) 92vw, (max-width: 1024px) 82vw, 780px"
              src="/alpha-dog-logo-on-dark.png"
              width={980}
            />
          </div>

          <nav
            aria-label="Destination"
            className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {destinations.map((destination) => (
              <Link
                className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#080a0c] ${destination.variant}`}
                href={destination.href}
                key={destination.label}
              >
                <destination.icon className="size-5" />
                {destination.label}
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </main>
  );
}
