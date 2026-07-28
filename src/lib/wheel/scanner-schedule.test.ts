import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function workflow(name: string) {
  return readFileSync(
    join(process.cwd(), ".github/workflows", name),
    "utf8",
  );
}

describe("scanner schedules", () => {
  it("offsets scanner triggers from high-contention clock boundaries", () => {
    expect(workflow("wheel-screener-refresh.yml")).toContain(
      'cron: "7,22,37,52 13-23 * * 1-5"',
    );
    expect(workflow("wheel-screener-refresh.yml")).toContain(
      'cron: "7,22,37,52 20-23 * * 0"',
    );
    expect(workflow("wheel-deep-scan-coverage.yml")).toContain(
      'cron: "10,25,40,55 12-21 * * 1-5"',
    );
  });

  it("keeps the scheduled trigger workflows independent", () => {
    expect(workflow("wheel-screener-refresh.yml")).toContain(
      "WHEEL_SCREENER_CRON_URL",
    );
    expect(workflow("wheel-deep-scan-coverage.yml")).toContain(
      "WHEEL_DEEP_SCAN_CRON_URL",
    );
  });
});
