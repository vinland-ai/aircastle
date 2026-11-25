# Aircastle

Aircastle is a code-first, headless CMS with agentic capabilities designed to automate the slow, manual parts of managing written content.

This repository holds the landing page and a demo dashboard, built with Next.js.

## Development

Install [Bun](https://bun.sh), then install dependencies and start the dev server:

```sh
bun install
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

## API

The API is a FastAPI service in `apps/api`. Install [uv](https://docs.astral.sh/uv/), then run every command below from `apps/api`. uv installs Python 3.14 and the locked dependencies on first use.

Copy the example environment and start the API with auto-reload:

```sh
cp .env.example .env
uv run fastapi dev
```

Open http://localhost:8000/health to check it runs and http://localhost:8000/docs for the Swagger UI.

The API reads its settings from the environment and from `apps/api/.env`. It refuses to start if a variable is missing or invalid, and the error names each bad variable. Secret values never appear in that error.

| Variable | Required | Value |
| --- | --- | --- |
| `ENVIRONMENT` | yes | `development`, `test` or `production` |
| `DATABASE_URL` | yes | A Postgres URL, such as `postgresql://user:password@host:5432/db` |
| `DATABASE_POOL_SIZE` | no | A positive integer. Defaults to 5. |

Run the checks that CI runs:

```sh
uv run ruff check
uv run ruff format --check
uv run basedpyright
uv run pytest
```
