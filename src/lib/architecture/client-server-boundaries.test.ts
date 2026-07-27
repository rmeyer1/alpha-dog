import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = path.join(process.cwd(), "src");
const forbiddenServerRoots = [
  path.join(sourceRoot, "lib", "alpaca"),
  path.join(sourceRoot, "lib", "wheel", "universe-scanner"),
  path.join(sourceRoot, "lib", "account", "simulated-positions"),
];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(target);
    }

    return /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
      ? [target]
      : [];
  });
}

function resolveLocalImport(fromFile: string, specifier: string) {
  const unresolved = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;

  if (!unresolved) {
    return null;
  }

  for (const candidate of [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return null;
}

function isTypeOnlyImport(node: ts.ImportDeclaration) {
  const clause = node.importClause;

  if (!clause || clause.isTypeOnly) {
    return true;
  }

  if (clause.name || !clause.namedBindings) {
    return false;
  }

  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function runtimeImports(file: string) {
  const source = fs.readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  for (const statement of parsed.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !isTypeOnlyImport(statement)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(parsed);

  return imports
    .map((specifier) => resolveLocalImport(file, specifier))
    .filter((resolved): resolved is string => resolved != null);
}

function isClientEntry(file: string) {
  const source = fs.readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const directive = parsed.statements[0];

  return Boolean(
    directive &&
      ts.isExpressionStatement(directive) &&
      ts.isStringLiteral(directive.expression) &&
      directive.expression.text === "use client",
  );
}

describe("client and server module ownership", () => {
  it("keeps provider and persistence facades outside every client graph", () => {
    const violations: string[] = [];

    for (const entry of sourceFiles(sourceRoot).filter(isClientEntry)) {
      const queue: Array<{ file: string; chain: string[] }> = [
        { file: entry, chain: [entry] },
      ];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift();

        if (!current || visited.has(current.file)) {
          continue;
        }

        visited.add(current.file);

        for (const imported of runtimeImports(current.file)) {
          const forbidden = forbiddenServerRoots.some(
            (root) =>
              imported === `${root}.ts` ||
              imported.startsWith(`${root}${path.sep}`),
          );

          if (forbidden) {
            violations.push(
              [...current.chain, imported]
                .map((item) => path.relative(process.cwd(), item))
                .join(" -> "),
            );
            continue;
          }

          queue.push({
            file: imported,
            chain: [...current.chain, imported],
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
