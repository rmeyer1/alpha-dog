# Application security headers

Alpha Dog applies static response headers through `next.config.ts` and creates
a unique document nonce in `src/proxy.ts`. Proxy writes the same strict CSP to
the forwarded request (so Next.js can nonce framework tags) and the response.
The root layout reads request headers to force dynamic rendering, and document
responses are `private, no-store` so a nonce cannot be shared by a CDN.

## Policy

- Document responses use an origin-allowlisted nonce CSP. Scripts,
  connections, and frames may reach the application and Cloudflare Turnstile
  only. Images are first-party except for the exact observed Polymarket upload
  origin; untrusted avatar origins are discarded during provider
  normalization. Company logos are proxied through `/api/logos/[symbol]`.
- API, stream, and proxied-image responses use
  `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors
  'none'`.
- `frame-ancestors 'none'` and `X-Frame-Options: DENY` prevent clickjacking.
- The permissions policy disables browser capabilities the product does not
  use. `Cross-Origin-Opener-Policy: same-origin-allow-popups` preserves OAuth
  popup compatibility while isolating unrelated browsing contexts.
- Application code does not set HSTS. Vercel owns the existing
  `max-age=63072000; includeSubDomains; preload` value for its HTTPS deployment
  namespace; the exact-deployment verifier requires that value and rejects a
  weakened or duplicate application override.
- `poweredByHeader: false` removes the Next.js framework disclosure.

Production scripts and styles require a per-request nonce. Production also
sets `script-src-attr 'none'` and `style-src-attr 'none'`; application inline
style attributes were replaced with SVG attributes or classes. Development
alone permits React's required `unsafe-eval` and inline style debugging.
Nonce CSP intentionally makes document rendering dynamic and prevents shared
HTML caching. Release evidence must include a latency/caching comparison.

## Hydration-safe company timestamps

Company-route dates and times use UTC as their canonical display timezone.
`src/lib/company-date-time.ts` owns the shared formatters used by the route's
Server and Client Components, so prerendered markup does not depend on the
server or browser's local timezone or Intl/ICU implementation. The formatter
uses fixed English month names, UTC getters, fixed punctuation, and a literal
`UTC` suffix. Date-only input must be exact `YYYY-MM-DD`; instants must carry
`Z` or an explicit numeric offset. Invalid and zone-less values fail closed to
the existing `-` placeholder. Release browser coverage renders fixed
company-news data in both UTC and `America/New_York`, listens for unhandled
`pageerror` events before navigation, and verifies framework nonces, CSP
violations, console errors, visible content, and client-side navigation.

`src/lib/company-number.ts` owns hydration-visible currency, integer, and
compact market-cap formatting for company Client Components. It uses fixed
arithmetic and punctuation rather than runtime ICU data; this prevents compact
notation differences such as `$962.0B` on the server and `$962B` in the
browser.

## Supabase Auth cookies

Supabase SSR uses PKCE and requires the browser client to read the refresh
token, so its auth cookies are intentionally not `HttpOnly`. The server
adapter enforces `SameSite=Lax`, `Path=/`, and `Secure` in production while
preserving stricter `SameSite` values supplied by the library. Responses that
rotate tokens retain Supabase SSR cache-safety headers and must never be
shared by a CDN.

## Adding a third-party origin

1. Identify the narrow directive that needs the origin (`script-src`,
   `connect-src`, `img-src`, or `frame-src`). Never add `*`, a scheme-wide
   production source, or a second origin to `default-src`.
2. Prefer a first-party server proxy for data and images. Validate upstream
   status, media type, and response headers before proxying bytes.
3. Add the exact HTTPS origin in `src/lib/security/headers.ts`. Add a matching
   WSS origin only when the browser actually uses WebSockets. Supabase remains
   server-only today and is therefore absent from browser CSP.
4. Extend the unit and Playwright assertions, run the full browser flows, and
   inspect `securitypolicyviolation` events.
5. Run `npm run verify:security-headers -- <deployment-url>` against the exact
   preview. If deployment protection is enabled, set
   `VERCEL_AUTOMATION_BYPASS_SECRET`; the verifier uses it without printing it.
   Then run the MDN HTTP Observatory v2 scan for that hostname. Record the
   grade, raw findings, and exact Git/deployment identity before merge.

## Proxied content

The logo route requests PNG explicitly, accepts only `image/png`, and reads the
upstream stream through a hard 1 MB transport-time cap. Declared oversize or
malformed lengths are rejected and cancelled before reading; absent or
understated lengths remain bounded while streaming and are cancelled on
overflow. The route then verifies the eight-byte PNG signature, normalizes the
downstream type, and emits `nosniff`. HTML, SVG/XML, missing or malformed MIME,
spoofed PNG bodies, read failures, and oversized responses fail closed without
forwarding upstream headers or bytes.

Primary references:

- <https://nextjs.org/docs/app/guides/content-security-policy>
- <https://vercel.com/docs/cdn-security/security-headers>
- <https://developer.mozilla.org/en-US/observatory/docs/faq>
- <https://supabase.com/docs/guides/auth/server-side/advanced-guide>
