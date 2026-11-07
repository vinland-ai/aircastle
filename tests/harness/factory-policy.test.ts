import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { parse } from "yaml";

interface Unit {
  id: string;
  globs: string[];
  shared_inputs?: string[];
  depends_on: string[];
}

interface HoldRule {
  kind: string;
  security_lens?: boolean;
  detector?: { paths: string[] } | null;
}

interface Policy {
  branch: string;
  required_checks: string[];
  commands: { check: string[] };
  logins: { owner: string };
  holds: HoldRule[];
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

test("executable scripts require the security lens", () => {
  const scripts = trackedFiles.filter(
    (path) => path.split("/").includes("scripts") && /\.[cm]?[jt]s$/.test(path),
  );
  expect(scripts.length).toBeGreaterThan(0);
  const detectors = policy.holds
    .filter((hold) => hold.security_lens)
    .flatMap((hold) => hold.detector?.paths ?? []);
  const covered = new Set(engineMatches(detectors, scripts).flat());
  expect(scripts.filter((path) => !covered.has(path))).toEqual([]);
});

test("shared inputs and consumer edges invalidate affected units", () => {
  const cases: [string, string[]][] = [
    ["AGENTS.md", units.map((unit) => unit.id)],
    ["compose.yaml", ["scripts", "adapter-postgres", "repo-tests"]],
    [
      "apps/web/vite.config.ts",
      units.filter((unit) => unit.id.startsWith("web-")).map((unit) => unit.id),
    ],
    ["apps/web/src/theme.ts", ["web-error-recovery"]],
    ["apps/api/vite.config.ts", ["api-health", "api-content"]],
    ["packages/cli/src/index.ts", ["repo-tests"]],
    ["apps/api/src/app.ts", ["repo-tests"]],
  ];
  for (const [path, expected] of cases) {
    const affected = new Set(
      units
        .filter((unit) => engineMatches(unitGlobs(unit), [path]).flat().length > 0)
        .map((unit) => unit.id),
    );
    for (let previous = -1; previous !== affected.size;) {
      previous = affected.size;
      for (const unit of units)
        if (unit.depends_on.some((id) => affected.has(id))) affected.add(unit.id);
    }
    expect(
      expected.filter((id) => !affected.has(id)),
      path,
    ).toEqual([]);
  }
});

test("rulesets enforce strict protection and separate owner-reviewed pull requests", () => {
  const files = readdirSync(resolve(root, ".github/rulesets")).filter((name) =>
    name.endsWith(".json"),
  );
  expect(files.sort()).toEqual(["main-protection.json", "main-pull-requests.json"]);
  const common = {
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: [`refs/heads/${policy.branch}`], exclude: [] } },
  };
  expect(JSON.parse(readText(".github/rulesets/main-protection.json"))).toEqual({
    ...common,
    name: `${policy.branch}-protection`,
    bypass_actors: [],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: policy.required_checks.map((context) => ({ context })),
        },
      },
    ],
  });
  expect(JSON.parse(readText(".github/rulesets/main-pull-requests.json"))).toEqual({
    ...common,
    name: `${policy.branch}-pull-requests`,
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
    rules: [
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          require_code_owner_review: true,
          dismiss_stale_reviews_on_push: true,
          required_approving_review_count: 0,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
    ],
  });
});
