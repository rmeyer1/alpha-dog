import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)]
  );
}

describe("API route observability inventory", () => {
  it("keeps every API route method behind the machine-checked boundary", () => {
    const root = join(process.cwd(), "src/app/api");
    const routes = walk(root)
      .filter((file) => file.endsWith("/route.ts"))
      .sort();

    expect(routes.length).toBeGreaterThanOrEqual(42);

    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      const handlers = Array.from(
        source.matchAll(
          /async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)Handler\b/g,
        ),
      ).map((match) => match[1]);
      const wrappers = Array.from(
        source.matchAll(
          /export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = instrumentApiRoute\(/g,
        ),
      ).map((match) => match[1]);

      expect(source, relative(root, file)).toContain(
        'from "@/lib/observability/route"',
      );
      expect(
        source,
        `${relative(root, file)} exports an uninstrumented handler`,
      ).not.toMatch(
        /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/,
      );
      expect(wrappers, relative(root, file)).toEqual(handlers);
    }
  });
});
