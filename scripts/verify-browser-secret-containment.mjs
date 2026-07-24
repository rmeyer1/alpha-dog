import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const sentinels = {
  APCA_API_KEY_ID: "AD009_ALPACA_KEY_ID_SENTINEL_1a4f8c2e",
  APCA_API_SECRET_KEY: "AD009_ALPACA_SECRET_SENTINEL_2b5e9d3f",
  FINNHUB_API_KEY: "AD009_FINNHUB_SECRET_SENTINEL_3c6fae40",
  OPENAI_API_KEY: "AD009_OPENAI_SECRET_SENTINEL_4d70bf51",
  API_ABUSE_HMAC_SECRET: "AD009_API_ABUSE_SECRET_SENTINEL_5e81c062",
  TURNSTILE_SECRET_KEY: "AD009_TURNSTILE_SECRET_SENTINEL_6f92d173",
  ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY:
    "AD009_ALPHA_DOG_SERVICE_SENTINEL_7f1c4e4f",
  SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY:
    "AD009_SIGNAL_SCRIBE_SERVICE_SENTINEL_8a2d5f5a",
  SUPABASE_SERVICE_ROLE_KEY:
    "AD009_LEGACY_SERVICE_SENTINEL_9b3e6a6b",
  CRON_SECRET: "AD009_CRON_SECRET_SENTINEL_ac4f7b7c",
};

const build = spawnSync("npm", ["run", "build"], {
  env: {
    ...process.env,
    ALPHA_DOG_DEPLOYMENT_MODE: "development",
    APCA_API_KEY_ID: sentinels.APCA_API_KEY_ID,
    APCA_API_SECRET_KEY: sentinels.APCA_API_SECRET_KEY,
    FINNHUB_API_KEY: sentinels.FINNHUB_API_KEY,
    OPENAI_API_KEY: sentinels.OPENAI_API_KEY,
    API_ABUSE_HMAC_SECRET: sentinels.API_ABUSE_HMAC_SECRET,
    TURNSTILE_SECRET_KEY: sentinels.TURNSTILE_SECRET_KEY,
    ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY:
      sentinels.ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY,
    ALPHA_DOG_SUPABASE_URL: "https://ad009-alpha-dog.supabase.test",
    SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY:
      sentinels.SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY,
    SIGNAL_SCRIBE_SUPABASE_URL: "https://ad009-signal-scribe.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: sentinels.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: "https://ad009-legacy.supabase.test",
    CRON_SECRET: sentinels.CRON_SECRET,
  },
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const buildRoot = ".next";
const files = new Set();

function walk(directory, include) {
  if (!existsSync(directory)) {
    return;
  }

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, include);
    } else if (include(path)) {
      files.add(path);
    }
  }
}

walk(join(buildRoot, "static"), () => true);
walk(join(buildRoot, "server", "app"), (path) => {
  const extension = extname(path);
  return (
    extension === ".html" ||
    extension === ".rsc" ||
    extension === ".txt" ||
    path.endsWith("client-reference-manifest.js")
  );
});
walk(join(buildRoot, "server", "pages"), (path) => {
  const extension = extname(path);
  return extension === ".html" || extension === ".json";
});
walk(buildRoot, (path) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith("manifest.json") || name.endsWith("manifest.js");
});

const forbidden = [
  ...Object.entries(sentinels).map(([name, value]) => ({
    label: `${name} sentinel`,
    value,
  })),
  ...Object.keys(sentinels).map((name) => ({
    label: `${name} variable name`,
    value: name,
  })),
];
const matches = [];

for (const file of files) {
  const contents = readFileSync(file, "utf8");
  for (const token of forbidden) {
    if (contents.includes(token.value)) {
      matches.push({
        file: relative(process.cwd(), file),
        token: token.label,
      });
    }
  }
}

if (matches.length > 0) {
  for (const match of matches) {
    process.stderr.write(
      `Browser secret containment failure: ${match.token} in ${match.file}\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(
  `Browser secret containment passed: ${files.size} emitted client/static, ` +
    "manifest, source-map, and rendered asset files inspected; zero server " +
    "credential sentinel or variable-name matches.\n",
);
