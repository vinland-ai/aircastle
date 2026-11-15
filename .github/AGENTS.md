# Repository automation

Follow [the architecture map](../ARCHITECTURE.md) for tooling ownership.

- `ci.yml` owns deterministic pull-request verification. It runs checks as parallel jobs and shards browser journeys with a matrix. The `Lint, typecheck and test` gate job needs every check job and fails unless all succeeded; it is the only required status check, so a new check job must join its `needs` list. Schema coverage below the thresholds in `packages/schema/vite.config.ts` fails the gate; the coverage table and the 10 slowest browser journeys are in the run's summary page, not a PR comment. Each browser shard uploads its Playwright JSON report as a `browser-results-<shard>` artifact.
- `mutation.yml` runs full schema and contract mutation testing nightly or on demand. It is not a pull-request check.
- `rulesets/main-protection.json` requires the `Lint, typecheck and test` check with strict up-to-date enforcement and prevents force pushes and deletions, with no bypass. It replaces existing ruleset 25795103 in place. `rulesets/main-pull-requests.json` requires squash pull requests and code-owner review, dismisses stale reviews, and allows the repository-admin role to bypass only the pull-request rule. The owner creates and verifies the pull-request ruleset before rewriting the existing protection ruleset. Keep the required check passing on the current base before landing. The squash commit credits commit authors as co-authors.
- `CODEOWNERS` names the paths whose PRs the repository owner reviews before merge: workflows and automation, agent instructions, auth, migrations and public documentation. Agents open PRs as `abyan-ai-integration` so the owner can approve them.
- Workflows run no AI models. AI review runs locally.
- Pin third-party actions by full commit SHA. Keep ordinary pull-request CI read-only and checkout credential persistence disabled.
