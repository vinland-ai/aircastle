import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { parse } from "yaml";

interface Unit {
  id: string;
  globs: string[];
  shared_inputs?: string[];
}

interface HoldRule {
  kind: string;
  detector?: { paths: string[] } | null;
}

interface Policy {
  required_checks: string[];
  commands: { check: string[] };
  logins: { owner: string };
  holds: HoldRule[];
}

interface Rule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] };
}

const root = resolve(import.meta.dirname, "../..");
const ownerReviewedHold = "owner-reviewed-path";

function readText(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const policy: Policy = JSON.parse(readText(".factory/policy.json"));
const { units }: { units: Unit[] } = JSON.parse(readText(".factory/units.json"));
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "");

/**
 * Matches paths with `Bun.Glob`, the matcher the factory engine uses, because this suite runs on
 * Node, whose `path.matchesGlob` treats dotfiles differently.
 */
function engineMatches(globs: readonly string[], paths: readonly string[]): string[][] {
  const matcher = `const { globs, paths } = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify(globs.map((glob) => { const g = new Bun.Glob(glob); return paths.filter((path) => g.match(path)); })));`;
  const result = spawnSync("bun", ["-e", matcher], {
    cwd: root,
    input: JSON.stringify({ globs, paths }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

function unitGlobs(unit: Unit): string[] {
  return [...unit.globs, ...(unit.shared_inputs ?? [])];
}

/** Converts a CODEOWNERS pattern to the glob a hold detector uses for the same paths. */
function codeownersGlob(pattern: string): string {
  const anchored = pattern.startsWith("/")
    ? pattern.slice(1)
    : pattern.startsWith("**/")
      ? pattern
      : `**/${pattern}`;
  return anchored.endsWith("/") ? `${anchored}**` : anchored;
}

test("every .factory JSON file parses", () => {
  const jsonFiles = readdirSync(resolve(root, ".factory")).filter((name) => name.endsWith(".json"));
  expect(jsonFiles.sort()).toEqual(["policy.json", "providers.json", "units.json"]);
  for (const name of jsonFiles)
    expect(() => JSON.parse(readText(`.factory/${name}`)), name).not.toThrow();
});

test("every unit glob and shared input matches a tracked file", () => {
  const globs = [...new Set(units.flatMap(unitGlobs))];
  const matches = engineMatches(globs, trackedFiles);
  const unmatched = globs.filter((_glob, index) => matches[index]?.length === 0);
  expect(unmatched).toEqual([]);
});

test("every tracked file belongs to a unit", () => {
  const globs = [...new Set(units.flatMap(unitGlobs))];
  const covered = new Set(engineMatches(globs, trackedFiles).flat());
  expect(trackedFiles.filter((path) => !covered.has(path))).toEqual([]);
});

test("every check command runs a root package script", () => {
  const { scripts }: { scripts: Record<string, string> } = JSON.parse(readText("package.json"));
  expect(policy.commands.check.length).toBeGreaterThan(0);
  for (const command of policy.commands.check) {
    const script = /^vp run ([\w:-]+)$/.exec(command)?.[1];
    expect(script, command).toBeDefined();
    expect(Object.keys(scripts), command).toContain(script);
  }
});

test("the required checks are the CI gate job", () => {
  const jobs: Record<string, { name?: string; if?: string }> = parse(
    readText(".github/workflows/ci.yml"),
  ).jobs;
  const gates = Object.entries(jobs)
    .filter(([, job]) => job.if === "${{ always() }}")
    .map(([id, job]) => job.name ?? id);
  expect(policy.required_checks).toEqual(gates);
});

test("the owner-reviewed paths are exactly the CODEOWNERS entries", () => {
  const entries = readText(".github/CODEOWNERS")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
  for (const [pattern, ...owners] of entries)
    expect(owners, pattern).toEqual([`@${policy.logins.owner}`]);
  const holds = policy.holds.filter((hold) => hold.kind === ownerReviewedHold);
  expect(holds).toHaveLength(1);
  const detected = holds[0]?.detector?.paths ?? [];
  expect([...detected].sort()).toEqual(
    entries.map(([pattern = ""]) => codeownersGlob(pattern)).sort(),
  );
  expect(detected).toContain(".factory/**");
});

test("every ruleset parses and requires exactly the policy's checks", () => {
  const files = readdirSync(resolve(root, ".github/rulesets")).filter((name) =>
    name.endsWith(".json"),
  );
  const requiring = files.flatMap((name) => {
    const { rules }: { rules: Rule[] } = JSON.parse(readText(`.github/rulesets/${name}`));
    return rules
      .filter((rule) => rule.type === "required_status_checks")
      .map((rule) => ({
        name,
        contexts: (rule.parameters?.required_status_checks ?? []).map((check) => check.context),
      }));
  });
  expect(requiring.length).toBeGreaterThan(0);
  for (const { name, contexts } of requiring)
    expect(contexts, name).toEqual(policy.required_checks);
});
