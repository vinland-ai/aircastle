# API agent tools

- From the repository root, run `vp run hono-api --help`, then `vp run hono-api routes src/cli.ts` to list routes and `vp run hono-api request /api/health src/cli.ts --runtime bun` to send one.
- Use `vp run hono-api batch - src/cli.ts` for JSONL request sequences. Batch runs on Node; the pinned CLI does not support Bun for it.
- The CLI loads the app through native module resolution, because the pinned CLI bundles CommonJS dependencies incorrectly. It runs from `apps/api`.
- Use the CLI to explore the API without a server. Keep regression tests in Vitest and run them with `vp run test-api`.
- For built API startup, CLI/SDK durability, request limits and shutdown, run `vp run build`, then `vp run db:test -- vp test tests/content-workflow.test.ts` from the repository root.
