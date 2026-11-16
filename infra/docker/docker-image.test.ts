import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { parse } from "yaml";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const exists = (file: string) => existsSync(new URL(`../../${file}`, import.meta.url));

test("the application image uses the repository's pinned Bun and Node versions", () => {
  const images = [...read("infra/docker/Dockerfile").matchAll(/^FROM (\S+)/gm)].map(
    (match) => match[1],
  );
  expect(images).toContain(`oven/bun:${read(".bun-version").trim()}-slim`);
  expect(images).toContain(`node:${read(".node-version").trim()}-bookworm-slim`);
});

test("the development image builds from the repository root with an ignore file beside its Dockerfile", () => {
  const { build } = parse(read("infra/docker/compose.development.yaml")).services.aircastle;
  expect(build.context).toBe(".");
  expect(exists(build.dockerfile)).toBe(true);
  const ignored = read(`${build.dockerfile}.dockerignore`).split("\n");
  expect(ignored).toEqual(expect.arrayContaining([".git", "**/node_modules", ".env"]));
});
