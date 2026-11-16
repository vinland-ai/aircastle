# Web UI

- Follow [ARCHITECTURE.md](../../ARCHITECTURE.md#web-app-structure) for the web app's structure and public entry points.
- Follow [VERIFICATION.md](VERIFICATION.md) before implementing behavior.
- Run `vp run test-web` for component behavior, `vp run test-web:e2e` for built-browser journeys and `vp run test-web:coverage` for coverage reports.
- Focus runs by file, case or `--grep`, for example `vp run test-web src/features/sign-in/index.test.tsx` or `vp run test-web:e2e metadata.spec.ts --grep long-text`.
- After changing `public/brand/logo-light.png` or `public/brand/logo-dark.png`, run `vp run --filter @aircastle/web generate:icons` to refresh the favicons. The dev and build commands also run it.
