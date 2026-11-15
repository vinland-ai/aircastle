import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test } from "vite-plus/test";

const root = resolve(import.meta.dirname, "../..");
const probeName = `lint-guard-probe-${process.pid}`;
const guardRules = new Set([
  "eslint(no-restricted-properties)",
  "eslint(no-restricted-imports)",
  "eslint(no-restricted-globals)",
  "import(no-dynamic-require)",
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
const envImport =
  'import { env as imported } from "node:process";\nexport const envImport = imported;';
const runnerImports = [
  'import { spawn } from "bun";',
  'import { execa } from "execa";',
  'import { build } from "vite";',
  "export const runners = [spawn, execa, build, Bun];",
  "export const load = (name: string) => import(name);",
].join("\n");
const imports = ["node:fs", "postgres", "@aircastle/core", "@aircastle/contracts"]
  .map((specifier) => `import "${specifier}";`)
  .join("\n");
const restricted = (names: string[]) => names.map((name) => `no-restricted-properties: ${name}`);

const testCode = `${properties([...disabledTests, "fail", "unsafe"])}\n${envReads}`;
const webTestCode = `${runnerImports}\n${properties([...disabledTests, "fail", "unsafe", ...processRunner])}`;
const webTestFlagged = [
  ...restricted([...disabledTests, "unsafe", ...processRunner]),
  "no-restricted-imports: spawn from bun",
  "no-restricted-imports: execa",
  "no-restricted-imports: build from vite",
  "no-restricted-globals: Bun",
  "no-dynamic-require: ",
];
const serverCode = `${envImport}\n${properties(["unsafe"])}\n${envReads}`;
const browserFlagged = [
  "no-nodejs-modules: node:fs",
  "no-restricted-imports: @aircastle/core",
  "no-restricted-imports: postgres",
];

const probes: Array<{ file: string; source: string; flagged: string[] }> = [
  {
    file: `tests/${probeName}.mts`,
    source: testCode,
    flagged: restricted([...disabledTests, "unsafe"]),
  },
  {
    file: `packages/core/src/${probeName}.test.ts`,
    source: testCode,
    flagged: restricted([...disabledTests, "unsafe"]),
  },
  {
    file: `packages/core/src/test-support/${probeName}.mts`,
    source: testCode,
    flagged: restricted([...disabledTests, "unsafe"]),
  },
  {
    file: `apps/web/${probeName}.mts`,
    source: webTestCode,
    flagged: webTestFlagged,
  },
  {
    file: `apps/web/e2e/${probeName}.mts`,
    source: webTestCode,
    flagged: webTestFlagged,
  },
  ...["packages/adapter-postgres/src", "apps/api/src"].map((directory) => ({
    file: `${directory}/${probeName}.mts`,
    source: serverCode,
    flagged: [
      ...restricted(["Bun.env", "unsafe"]),
      "no-process-env: process.env",
      "no-restricted-imports: env from node:process",
    ],
  })),
  ...["apps/web/src", "packages/contracts/src", "packages/schema/src", "packages/client/src"].map(
    (directory) => ({
      file: `${directory}/${probeName}.mts`,
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
      const name = [...message.matchAll(/['`]([^'`]+)['`]/g)]
        .map((match) => match[1])
        .join(" from ");
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
