import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const composePath = /infra\/docker\/compose\./g;
const composeWord = /\bcompose["'`\s]/g;
const rootProjectDirectory = /--project-directory[=\s"',]+(?:\.|root|\$\{root\})["'`,\s]/;

function isMarkdownCommand(lines: readonly string[], line: number): boolean {
  const fences = lines.slice(0, line - 1).filter((text) => text.startsWith("```")).length;
  return fences % 2 === 1 || (lines[line - 1]?.includes("docker compose") ?? false);
}

/**
 * Returns `file:line` for each mention of an infra/docker Compose file whose command does not set
 * the repository root as the project directory. Markdown mentions count only inside fenced code
 * blocks and on `docker compose` lines, so prose may name the files.
 */
function unrootedComposeCommands(file: string, text: string): string[] {
  const lines = text.split("\n");
  return [...text.matchAll(composePath)].flatMap(({ index }) => {
    const before = text.slice(0, index);
    const line = before.split("\n").length;
    if (file.endsWith(".md") && !isMarkdownCommand(lines, line)) return [];
    const start = [...before.matchAll(composeWord)].at(-1)?.index;
    const rooted = start !== undefined && rootProjectDirectory.test(before.slice(start));
    return rooted ? [] : [`${file}:${line}`];
  });
}

const readsComposeFilesAsData: Record<string, string> = {
  "infra/docker/docker-image.test.ts":
    "parses the development Compose file without running Compose",
  "tests/harness/compose-commands.test.ts": "holds this guard's flagged and accepted fixtures",
};

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(?:[cm]?[jt]sx?|json|md|ya?ml)$/.test(file))
  .filter(
    (file) => !file.startsWith("infra/docker/compose.") && !(file in readsComposeFilesAsData),
  );

test("every Compose command for infra/docker sets the repository root as its project directory", () => {
  const texts = trackedFiles.map((file) => [file, readFileSync(file, "utf8")] as const);
  expect(
    texts.filter(([, text]) => text.includes("infra/docker/compose.")).map(([file]) => file),
  ).toEqual(
    expect.arrayContaining([
      "README.md",
      "infra/docker/auth-image.journey.ts",
      "infra/docker/with-postgres.journey.ts",
      "infra/docker/with-postgres.ts",
      "package.json",
    ]),
  );
  expect(texts.flatMap(([file, text]) => unrootedComposeCommands(file, text))).toEqual([]);
});

test.each([
  ["--file=", "docker compose --file=infra/docker/compose.yaml up"],
  ["./ prefix", "docker compose -f ./infra/docker/compose.yaml up"],
  ["$ROOT/ prefix", 'docker compose -f "$ROOT/infra/docker/compose.yaml" up'],
  ["path join", '["compose", "-f", join(root, "infra/docker/compose.yaml")]'],
  ["COMPOSE_FILE", "COMPOSE_FILE=infra/docker/compose.yaml docker compose up"],
  ["multiline shell", "docker compose \\\n  -f infra/docker/compose.yaml \\\n  up"],
  [
    "single-quoted call after a rooted one",
    "docker compose --project-directory . -f infra/docker/compose.yaml up\n['compose', '-f', 'infra/docker/compose.yaml']",
  ],
  ["no compose word", "see --project-directory .\nrun -f infra/docker/compose.yaml"],
  [
    "infra/docker as project directory",
    "docker compose --project-directory infra/docker -f infra/docker/compose.yaml up",
  ],
])("flags a Compose command without a root project directory: %s", (_, text) => {
  expect(unrootedComposeCommands("probe.ts", text)).not.toEqual([]);
});

test("flags a Markdown command split across lines without a root project directory", () => {
  const text = "```sh\ndocker compose \\\n  -f infra/docker/compose.yaml up\n```";
  expect(unrootedComposeCommands("probe.md", text)).toEqual(["probe.md:3"]);
});

test.each([
  ["probe.ts", "docker compose --project-directory . -f infra/docker/compose.yaml up"],
  ["probe.ts", "docker compose \\\n  --project-directory . \\\n  -f infra/docker/compose.yaml up"],
  [
    "probe.ts",
    '["compose", "--project-directory", root, "-f", `${root}infra/docker/compose.yaml`]',
  ],
  ["probe.md", "The committed `infra/docker/compose.yaml` pins Postgres."],
])("accepts a rooted Compose command or a prose mention in %s: %j", (file, text) => {
  expect(unrootedComposeCommands(file, text)).toEqual([]);
});
