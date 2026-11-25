# Aircastle

Aircastle is a code-first, headless CMS with agentic capabilities designed to automate the slow, manual parts of managing written content.

## Layout

- `apps/web` is the landing page and a demo dashboard, built with Next.js.
- `apps/api` is the API, a FastAPI service.
- The root holds docs, agent instructions and a Bun workspace for `apps/web`. It has no app config.

## Web

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

Run the type check and the tests:

```sh
bun run typecheck
bun run test
```

The tests use Bun's built-in runner, `bun test`. Name a test file `*.test.ts`.

## API

The API is a FastAPI service in `apps/api`. Install [uv](https://docs.astral.sh/uv/), then run every command below from `apps/api`. uv installs Python 3.14 and the locked dependencies on first use.

Start local Postgres with [Docker](https://docs.docker.com/get-docker/). It listens on `localhost:5432`, with user, password and database all `aircastle`, which is what `.env.example` points at:

```sh
docker compose -f ../../infra/compose.yaml up -d --wait
```

Copy the example environment, migrate the database and start the API with auto-reload:

```sh
cp .env.example .env
uv run alembic upgrade head
uv run fastapi dev
```

Open http://localhost:8000/health to check it runs, http://localhost:8000/ready to check it reaches Postgres, and http://localhost:8000/docs for the Swagger UI.

Migrations live in `apps/api/migrations` and run against `DATABASE_URL`. Create one with `uv run alembic revision --autogenerate -m "<what changes>"`, and undo the last with `uv run alembic downgrade -1`.

The API reads its settings from the environment and from `apps/api/.env`. It refuses to start if a variable is missing or invalid, and the error names each bad variable. Secret values never appear in that error.

| Variable | Required | Value |
| --- | --- | --- |
| `ENVIRONMENT` | yes | `development`, `test` or `production` |
| `DATABASE_URL` | yes | A Postgres URL, such as `postgresql://user:password@host:5432/db` |
| `DATABASE_POOL_SIZE` | no | A positive integer. Defaults to 5. |
| `LOGFIRE_TOKEN` | no | A Logfire write token. Without it, traces stay local. |
| `LOG_LEVEL` | no | `debug`, `info`, `warning` or `error`. Defaults to `info`. |

Every request is traced with Logfire, and its spans and logs print to the console in every environment. Each response carries an `X-Request-ID` header. The API keeps an incoming `X-Request-ID` of up to 128 letters, digits and `._:-`, and otherwise generates one. Every span and log of the request carries the ID as `request_id`, so you can search Logfire for the ID a user reports. Log from app code with `logfire.info(...)` and its siblings.

Run the checks that CI runs:

```sh
uv run ruff check
uv run ruff format --check
uv run basedpyright
uv run pytest
```

The tests start their own disposable Postgres in Docker, so Docker must be running. They don't touch the compose database.

## API contract

The API's Pydantic models define every request and response. Two generated files carry them to the web app, and both are committed:

- `apps/api/openapi.json` is the OpenAPI document, exported from the app factory with no server running.
- `apps/web/src/lib/api/generated` is the typed web client, generated from that document by [`@hey-api/openapi-ts`](https://heyapi.dev/openapi-ts/get-started).

After you change a route or a model in the API, regenerate both and commit them with your change:

```sh
cd apps/api && uv run scripts/export_openapi.py
cd ../web && bun run generate:api
```

Never edit either one by hand. The next regeneration overwrites the edit, and CI fails until it's gone.

Call the API from the web app through the generated functions. Each one is named after its Python handler and typed from its models:

```ts
import { getMe } from '@/lib/api/generated'

const { data, error } = await getMe()
```

`src/lib/api/client-config.ts` configures the client. It reads the API's base URL from `NEXT_PUBLIC_API_URL`, which Next.js inlines at build time. For operations that need a signed-in user, it sends `Authorization: Bearer <token>` with the token from `setTokenGetter`. Pass it Clerk's `getToken` once the web app signs users in. Until then, no token is sent.

## CI

`.github/workflows/ci.yml` has one job per app, plus a contract job. The `web` job installs, type-checks, tests and builds `apps/web`. It runs only when `apps/web`, the root `package.json`, `bun.lock` or the workflow changes.

The `api` job installs `apps/api` with uv and runs ruff, basedpyright and pytest. It runs only when `apps/api` or the workflow changes.

The `contract` job runs when either app's job runs. It exports the OpenAPI document, regenerates the web client and fails if either differs from what's committed. Its error names the two commands from [API contract](#api-contract).
