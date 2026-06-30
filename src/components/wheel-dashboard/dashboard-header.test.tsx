import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { personas } from "@/lib/wheel/personas";
import { DashboardHeader } from "./dashboard-header";

function renderHeader(overrides: Partial<Parameters<typeof DashboardHeader>[0]> = {}) {
  return renderToStaticMarkup(
    <DashboardHeader
      canAnalyze
      canRefresh
      initialPersonas={personas}
      onAnalyze={vi.fn()}
      onForceRefresh={vi.fn()}
      onPersonaChange={vi.fn()}
      onTickerChange={vi.fn()}
      personaId="balanced_wheel"
      refreshInProgress={false}
      requestState="idle"
      ticker="AAPL"
      {...overrides}
    />,
  );
}

describe("DashboardHeader", () => {
  it("exposes stable workspace navigation and form controls", () => {
    const markup = renderHeader();

    expect(markup).toContain('aria-label="Workspace"');
    expect(markup).toContain('href="/screeners"');
    expect(markup).toContain('href="/traders"');
    expect(markup).toContain('href="/account"');
    expect(markup).toContain('aria-label="Ticker symbol"');
    expect(markup).toContain("Strategy persona");
    expect(markup).toContain("Analyze");
    expect(markup).toContain("Refresh");
  });

  it("announces refresh progress through the visible button state", () => {
    const markup = renderHeader({
      refreshInProgress: true,
      requestState: "refreshing",
    });

    expect(markup).toContain("Refreshing");
    expect(markup).toContain("disabled");
  });
});
