import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["infra/docker/with-postgres.journey.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
