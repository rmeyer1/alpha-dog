"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FlaskConical } from "lucide-react";
import type { DeploymentHealth } from "@/lib/env-types";

type BannerState =
  | { status: "hidden" }
  | { health: DeploymentHealth; status: "visible" };

function bannerContent(health: DeploymentHealth) {
  if (health.status === "demo") {
    return {
      detail:
        "Every sample result is simulated and must not be used as live market data.",
      icon: FlaskConical,
      label: "Demo mode — sample data only",
      tone: "border-amber-300/35 bg-amber-300 text-[#2b1700]",
    };
  }

  const firstIssue = health.issues[0];

  return {
    detail:
      firstIssue?.message ??
      "Live providers are not fully configured for this environment.",
    icon: AlertTriangle,
    label: health.status === "invalid"
      ? "Live data unavailable — configuration required"
      : "Development mode — provider configuration incomplete",
    tone: health.status === "invalid"
      ? "border-red-300/35 bg-red-300 text-[#2b0707]"
      : "border-cyan-300/35 bg-cyan-200 text-[#05202b]",
  };
}

export function DeploymentStatusBanner() {
  const [state, setState] = useState<BannerState>({ status: "hidden" });

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/health/configuration", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => await response.json() as DeploymentHealth)
      .then((health) => {
        if (health.status !== "ready") {
          setState({ health, status: "visible" });
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "hidden" });
        }
      });

    return () => controller.abort();
  }, []);

  if (state.status === "hidden") {
    return null;
  }

  const content = bannerContent(state.health);

  return (
    <div
      className={`pointer-events-none sticky top-0 z-[100] border-b px-4 py-2 shadow-lg ${content.tone}`}
      data-deployment-mode={state.health.mode}
      data-testid="deployment-status-banner"
      role={state.health.status === "invalid" ? "alert" : "status"}
    >
      <div className="mx-auto flex max-w-7xl items-start gap-2 sm:items-center">
        <content.icon className="mt-0.5 size-4 shrink-0 sm:mt-0" />
        <p className="text-sm font-semibold">
          {content.label}
          <span className="ml-2 font-normal opacity-80">{content.detail}</span>
        </p>
      </div>
    </div>
  );
}
