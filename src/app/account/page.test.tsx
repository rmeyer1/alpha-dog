import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountPage from "./page";

describe("AccountPage", () => {
  it("renders the account landmark, heading, and navigation links", () => {
    const markup = renderToStaticMarkup(<AccountPage />);

    expect(markup).toContain("<main");
    expect(markup).toContain("Account");
    expect(markup).toContain('aria-label="Account navigation"');
    expect(markup).toContain('href="/screeners"');
    expect(markup).toContain('href="/traders"');
    expect(markup).toContain('href="/account"');
  });

  it("keeps credential and security copy on the account surface", () => {
    const markup = renderToStaticMarkup(<AccountPage />);

    expect(markup).toContain("Credentials");
    expect(markup).toContain("Server-side only");
    expect(markup).toContain("Saved presets");
    expect(markup).toContain("Trade execution");
    expect(markup).toContain("Disabled");
  });
});
