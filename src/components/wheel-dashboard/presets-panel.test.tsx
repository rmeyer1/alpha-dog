import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { personas } from "@/lib/wheel/personas";
import type { SavedPreset } from "@/lib/wheel/types";
import { PresetsPanel } from "./presets-panel";

const defaultPersona = personas.find((persona) => persona.default) ?? personas[0];

function renderPanel(presets: SavedPreset[] = []) {
  return renderToStaticMarkup(
    <PresetsPanel
      defaultPersona={defaultPersona}
      initialPersonas={personas}
      onDelete={vi.fn()}
      onLoad={vi.fn()}
      onNameChange={vi.fn()}
      onSave={vi.fn()}
      presetName="Balanced 21-30 DTE"
      presets={presets}
    />,
  );
}

describe("PresetsPanel", () => {
  it("renders an accessible save control and empty state", () => {
    const markup = renderPanel();

    expect(markup).toContain("Saved Presets");
    expect(markup).toContain("Preset name");
    expect(markup).toContain("Save Current Filters");
    expect(markup).toContain("No saved presets yet.");
  });

  it("renders saved preset actions with delete button names", () => {
    const markup = renderPanel([
      {
        basePersona: "balanced_wheel",
        createdAt: "2026-06-30T01:00:00.000Z",
        filters: {
          dteMin: 21,
          dteMax: 30,
          deltaMin: 0.15,
          deltaMax: 0.3,
          maxSpreadPctOfMid: 0.2,
          maxSpreadWidth: 10,
          minOpenInterest: 100,
          minPremiumYield: 0.01,
          minSpreadReturnOnRisk: 0.2,
          minVolume: 50,
        },
        id: "preset-1",
        name: "Income desk",
        updatedAt: "2026-06-30T01:00:00.000Z",
      },
    ]);

    expect(markup).toContain("Income desk");
    expect(markup).toContain("DTE 21-30");
    expect(markup).toContain('aria-label="Delete Income desk"');
  });
});
