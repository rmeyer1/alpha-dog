# Alpha Dog

[![CI](https://github.com/rmeyer1/alpha-dog/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rmeyer1/alpha-dog/actions/workflows/ci.yml)

Alpha Dog is a Next.js application for researching and managing
options-trading workflows.

## Reproducible setup

The local and pull-request CI toolchain is pinned to Node.js 22.22.0 with npm
10.9.4. Version managers can read `.nvmrc`; `package.json` declares the exact
package manager and compatible Node 22/npm 10 deployment engines.

```bash
nvm use
npm --version
npm ci
npm run verify:toolchain
npm run verify:market-calendar
```

`npm ci` is the only supported clean-install command. It fails if
`package.json` and `package-lock.json` drift rather than rewriting the lockfile.

Copy `.env.example` to `.env.local` when local provider configuration is
needed, then start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality gates

Run the same commands required by pull-request CI:

```bash
npm run verify:toolchain
npm run verify:market-calendar
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
```

The browser suite builds and starts the application without live provider
credentials. Network-sensitive application calls are intercepted or exercise
the fail-closed configuration boundary. The production-only manual-account
challenge uses a browser-local Turnstile test double and public test site key;
no server secret or external challenge request is required.

The pull-request workflow is independent of the scheduled cron-trigger
workflows in `.github/workflows/`.
