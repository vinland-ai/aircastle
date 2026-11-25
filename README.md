# Aircastle

Aircastle is a code-first, headless CMS with agentic capabilities designed to automate the slow, manual parts of managing written content.

## Layout

- `apps/web` is the landing page and a demo dashboard, built with Next.js.
- The root holds docs, agent instructions and a Bun workspace that lists the apps. It has no app config.

## Development

Install [Bun](https://bun.sh), then install dependencies from the repo root. One install covers every app in the workspace.

```sh
bun install
```

Run every other command from `apps/web`. Start the dev server:

```sh
cd apps/web
bun run dev
```

Open http://localhost:3000 for the landing page and http://localhost:3000/dash for the dashboard.

Build and serve the production app:

```sh
bun run build
bun run start
```

`next build` prerenders the landing page and the demo dashboard (`/dash/workspaces/demo/projects/demo/...`) as static HTML. Other workspace and project ids show a skeleton, then render in the browser.

Run the type check:

```sh
bun run typecheck
```

## CI

`.github/workflows/ci.yml` has one job per app. The `web` job installs, type-checks and builds `apps/web`. It runs only when `apps/web`, the root `package.json`, `bun.lock` or the workflow changes.
