import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  EXPANSION_MAX_LENGTH,
  expand as expandEsm,
} from "brace-expansion";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const expandCommonJs = require("brace-expansion");

function requireFrom(specifier, parentRequire = require) {
  return createRequire(parentRequire.resolve(specifier));
}

function verifyMinimatchConsumer(label, consumerRequire, expectedMajor) {
  const minimatchPackagePath = consumerRequire.resolve("minimatch/package.json");
  const minimatchPackage = JSON.parse(readFileSync(minimatchPackagePath, "utf8"));
  const minimatchRequire = createRequire(minimatchPackagePath);
  const minimatchModule = minimatchRequire("minimatch");
  const minimatch =
    typeof minimatchModule === "function"
      ? minimatchModule
      : minimatchModule.minimatch;
  const braceExpansion = minimatchRequire("brace-expansion");
  const braceExpansionPackage = JSON.parse(
    readFileSync(
      minimatchRequire.resolve("brace-expansion/package.json"),
      "utf8",
    ),
  );

  assert.equal(Number(minimatchPackage.version.split(".")[0]), expectedMajor);
  assert.equal(braceExpansionPackage.version, "5.0.8");
  assert.equal(typeof braceExpansion, "function");
  assert.equal(braceExpansion.expand, braceExpansion);
  assert.equal(minimatch("src/app/page.tsx", "src/**/*.tsx"), true);
  assert.deepEqual(braceExpansion("file-{a,b}.txt"), [
    "file-a.txt",
    "file-b.txt",
  ]);

  return `${label}=minimatch@${minimatchPackage.version}`;
}

function assertSecureInstalledGraph() {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ls", "brace-expansion", "brace-expansion-safe", "--all", "--json"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    0,
    `npm ls failed:\n${result.stdout}\n${result.stderr}`,
  );

  const tree = JSON.parse(result.stdout);
  assert.deepEqual(tree.problems ?? [], []);

  const installedVersions = [];
  const visit = (node) => {
    for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
      if (name === "brace-expansion" || name === "brace-expansion-safe") {
        installedVersions.push(`${name}@${dependency.version}`);
        assert.equal(dependency.version, "5.0.8");
        assert.equal(dependency.invalid, undefined);
        assert.equal(dependency.extraneous, undefined);
      }
      visit(dependency);
    }
  };
  visit(tree);

  assert.ok(installedVersions.length > 0);
  return installedVersions;
}

function assertPackedAdapterMatchesSource() {
  const installedPath = dirname(
    rootRequire.resolve("brace-expansion/package.json"),
  );
  const sourcePath = join(process.cwd(), "vendor", "brace-expansion-compat");

  assert.equal(lstatSync(installedPath).isSymbolicLink(), false);
  for (const file of ["README.md", "index.cjs", "index.mjs", "package.json"]) {
    assert.deepEqual(
      readFileSync(join(installedPath, file)),
      readFileSync(join(sourcePath, file)),
      `${file} in the packed adapter differs from its reviewed source`,
    );
  }
}

function assertDefaultOptionsPocIsBounded() {
  const childSource = String.raw`
    const assert = require("node:assert/strict");
    const expand = require("brace-expansion");
    const result = expand("{a,b}".repeat(1500));
    const totalLength = result.reduce(
      (length, expansion) => length + expansion.length,
      0,
    );
    assert.ok(result.length > 0);
    assert.ok(totalLength <= expand.EXPANSION_MAX_LENGTH);
    process.stdout.write(JSON.stringify({
      resultCount: result.length,
      totalLength,
      maxLength: expand.EXPANSION_MAX_LENGTH,
    }));
  `;
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=512", "-e", childSource],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(
    result.status,
    0,
    `default-options advisory PoC failed:\n${result.stdout}\n${result.stderr}`,
  );

  const report = JSON.parse(result.stdout);
  assert.equal(report.maxLength, EXPANSION_MAX_LENGTH);
  assert.ok(report.totalLength <= EXPANSION_MAX_LENGTH);
  return report;
}

function assertWorkflowCompilation() {
  const generatedOutput = join(process.cwd(), ".well-known", "workflow");
  const outputExisted = existsSync(generatedOutput);
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "workflow.cmd" : "workflow",
  );
  const result = spawnSync(
    executable,
    ["build", "--target", "standalone"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  if (!outputExisted) {
    rmSync(generatedOutput, { force: true, recursive: true });
  }

  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    0,
    `Workflow compilation failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /workflows build complete \(\d+ steps, \d+ workflows/,
  );
  return `${result.stdout}\n${result.stderr}`.trim().split("\n").at(-1);
}

assert.equal(typeof expandCommonJs, "function");
assert.equal(expandCommonJs.expand, expandCommonJs);
assert.deepEqual(expandCommonJs("file-{a,b}.txt"), [
  "file-a.txt",
  "file-b.txt",
]);
assert.deepEqual(expandEsm("file-{a,b}.txt"), [
  "file-a.txt",
  "file-b.txt",
]);

const rootRequire = createRequire(join(process.cwd(), "package.json"));
const eslintRequire = requireFrom("eslint", rootRequire);
const filelistRequire = requireFrom("filelist", rootRequire);
const workflowRequire = requireFrom("workflow", rootRequire);
const workflowNestRequire = requireFrom("@workflow/nest", workflowRequire);
const swcRequire = requireFrom("@swc/cli", workflowNestRequire);
const oclifRequire = requireFrom("@oclif/core", rootRequire);
const typescriptEstreeRequire = requireFrom(
  "@typescript-eslint/typescript-estree",
  rootRequire,
);

const consumers = [
  verifyMinimatchConsumer("eslint", eslintRequire, 3),
  verifyMinimatchConsumer("filelist", filelistRequire, 5),
  verifyMinimatchConsumer("workflow/@swc/cli", swcRequire, 9),
  verifyMinimatchConsumer("@oclif/core", oclifRequire, 10),
  verifyMinimatchConsumer(
    "@typescript-eslint/typescript-estree",
    typescriptEstreeRequire,
    10,
  ),
];

const eslintConfig = await new ESLint().calculateConfigForFile(
  "src/app/page.tsx",
);
assert.ok(eslintConfig);

const installedVersions = assertSecureInstalledGraph();
assertPackedAdapterMatchesSource();
const pocReport = assertDefaultOptionsPocIsBounded();
const workflowReport = assertWorkflowCompilation();

console.log(
  [
    "brace-expansion compatibility and memory bound verified",
    `consumers: ${consumers.join(", ")}`,
    `installed: ${[...new Set(installedVersions)].join(", ")}`,
    `default PoC: ${pocReport.resultCount} results, ${pocReport.totalLength}/${pocReport.maxLength} characters`,
    `Workflow: ${workflowReport}`,
  ].join("\n"),
);
