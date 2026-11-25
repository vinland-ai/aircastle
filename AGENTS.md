## Layout

- `apps/web` is the Next.js app. It owns its `package.json`, config and scripts.
- The root `package.json` only declares the Bun workspace and its install settings. Add no app config at the root.
- `bun.lock` lives at the root. Run `bun install` from the root or from any app.
- `.github/workflows/ci.yml` has one job per app, each gated by a path filter in the `changes` job. A new app gets its own filter and job.

## Commands

Run these from `apps/web`:

- `bun run dev` starts the dev server on port 3000.
- `bun run typecheck` runs `next typegen` and `tsc`.
- `bun run build` builds the app. CI runs `typecheck` and `build`.
- `bun run start` serves the last build.

## Next.js

This repo runs a Next.js version newer than most training data. Before writing Next.js code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` and follow its deprecation notices. Bun installs packages per workspace, so `next` is not in the root `node_modules`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `vinland-ai/aircastle`, used through `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, plus `bug` and `enhancement`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root, created lazily. See `docs/agents/domain.md`.
