import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test } from "vite-plus/test";

const root = resolve(import.meta.dirname, "../..");
const probeName = `lint-guard-probe-${process.pid}`;
const guardRules = new Set([
  "eslint(no-restricted-properties)",
  "eslint(no-restricted-imports)",
  "node(no-process-env)",
  "import(no-nodejs-modules)",
]);
const disabledTests = ["skip", "skipIf", "runIf", "todo", "fails", "fixme"];
const processRunner = ["Bun", "getBuiltinModule"];

const properties = (names: string[]) =>
  [
    "declare const probe: Record<string, unknown>;",
    `export const used = [${names.map((name) => `probe.${name}`).join(", ")}];`,
  ].join("\n");
const envReads = "export const env = [Bun.env, process.env];";
const imports = ["node:fs", "postgres", "@aircastle/core", "@aircastle/contracts"]
  .map((specifier) => `import "${specifier}";`)
  .join("\n");
const restricted = (names: string[]) => names.map((name) => `no-restricted-properties: ${name}`);

const testCode = `${properties([...disabledTests, "fail", "unsafe"])}\n${envReads}`;
const webTestCode = properties([...disabledTests, "fail", "unsafe", ...processRunner]);
const serverCode = `${properties(["unsafe"])}\n${envReads}`;
const browserFlagged = [
  "no-nodejs-modules: node:fs",
  "no-restricted-imports: @aircastle/core",
  "no-restricted-imports: postgres",
];

const probes: Array<{ file: string; source: string; flagged: string[] }> = [
  {
    file: `tests/${probeName}.ts`,
    source: testCode,
    flagged: restricted([...disabledTests, "unsafe"]),
  },
  {
    file: `packages/core/src/test-support/${probeName}.ts`,
    source: testCode,
    flagged: restricted([...disabledTests, "unsafe"]),
  },
  {
    file: `apps/web/src/${probeName}.test.tsx`,
    source: webTestCode,
    flagged: restricted([...disabledTests, "unsafe", ...processRunner]),
  },
  {
    file: `apps/web/e2e/${probeName}.ts`,
    source: webTestCode,
    flagged: restricted([...disabledTests, "unsafe", ...processRunner]),
  },
  ...["packages/adapter-postgres/src", "apps/api/src"].map((directory) => ({
    file: `${directory}/${probeName}.ts`,
    source: serverCode,
    flagged: [...restricted(["Bun.env", "unsafe"]), "no-process-env: process.env"],
  })),
  ...["apps/web/src", "packages/contracts/src", "packages/schema/src", "packages/client/src"].map(
    (directory) => ({
      file: `${directory}/${probeName}.ts`,
      source: imports,
      flagged: browserFlagged,
    }),
  ),
];

const sorted = (names: string[]) => [...names].sort((left, right) => left.localeCompare(right));
const flaggedByFile = new Map<string, string[]>();

beforeAll(() => {
  try {
    for (const probe of probes) writeFileSync(resolve(root, probe.file), `${probe.source}\n`);
    const lint = spawnSync(
      resolve(root, "node_modules/.bin/vp"),
      ["lint", "--format", "json", ...probes.map((probe) => probe.file)],
      { cwd: root, encoding: "utf8" },
    );
    const report: { diagnostics: Array<{ code: string; message: string; filename: string }> } =
      JSON.parse(lint.stdout);
    for (const { code, message, filename } of report.diagnostics) {
      if (!guardRules.has(code)) continue;
      const rule = code.slice(code.indexOf("(") + 1, -1);
      const name = /['`]([^'`]+)['`]/.exec(message)?.[1];
      flaggedByFile.set(filename, [...(flaggedByFile.get(filename) ?? []), `${rule}: ${name}`]);
    }
  } finally {
    for (const probe of probes) rmSync(resolve(root, probe.file), { force: true });
  }
});

test.each(probes.map((probe) => ({ ...probe, location: probe.file.replace(probeName, "*") })))(
  "lint flags exactly the banned uses in $location",
  ({ file, flagged }) => {
    expect(sorted(flaggedByFile.get(file) ?? [])).toEqual(sorted(flagged));
  },
);
