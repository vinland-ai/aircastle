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

`next build` prerenders the landing page as static HTML. Dashboard pages are partially prerendered and stream the parts that depend on the URL.

Run the type check:

```sh
bun run typecheck
```
