import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const nodeVersion = (
  await readFile(new URL("../.nvmrc", import.meta.url), "utf8")
).trim();
const expectedPackageManager = packageJson.packageManager;
const npmUserAgent = process.env.npm_config_user_agent ?? "";
const actualPackageManager = npmUserAgent.split(" ")[0].replace("/", "@");

const mismatches = [];

if (process.version !== `v${nodeVersion}`) {
  mismatches.push(`Node ${nodeVersion} is required; found ${process.version}.`);
}

if (expectedPackageManager !== "npm@10.9.4") {
  mismatches.push(
    `packageManager must be npm@10.9.4; found ${expectedPackageManager}.`,
  );
}

if (actualPackageManager !== expectedPackageManager) {
  mismatches.push(
    `${expectedPackageManager} is required; found ${actualPackageManager || "an unknown npm version"}.`,
  );
}

if (mismatches.length > 0) {
  console.error(mismatches.join("\n"));
  process.exit(1);
}

console.log(`Toolchain verified: Node ${nodeVersion}, ${expectedPackageManager}.`);
