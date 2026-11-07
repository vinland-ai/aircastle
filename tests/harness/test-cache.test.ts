import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadConfigFromFile } from "vite-plus";
import { expect, test } from "vite-plus/test";

const workspaces = ["apps", "packages"].flatMap((directory) =>
  readdirSync(directory).map((name) => resolve(directory, name)),
);

for (const workspace of workspaces.filter((path) => existsSync(resolve(path, "vite.config.ts")))) {
  test(`${relative(".", workspace)} owns its module cache during parallel workspace tests`, async () => {
    const loaded = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      resolve(workspace, "vite.config.ts"),
      workspace,
    );
    const cachePath = loaded?.config.test?.fsModuleCachePath;
    expect(
      typeof cachePath,
      "Set test.fsModuleCachePath inside this workspace's node_modules to prevent concurrent cache deletion",
    ).toBe("string");
    if (typeof cachePath !== "string") throw new Error("Workspace module cache path is missing");
    expect(isAbsolute(cachePath)).toBe(true);
    const localPath = relative(resolve(workspace, "node_modules"), cachePath);
    expect(localPath).not.toBe("");
    expect(localPath.startsWith(`..${sep}`) || localPath === ".." || isAbsolute(localPath)).toBe(
      false,
    );
  });
}
