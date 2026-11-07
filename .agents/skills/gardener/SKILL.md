---
name: gardener
description: Produce the factory:garden audit plan for selected units or the nightly repository audit. Audit, challenge and deduplicate evidence into tasks for factory workers.
disable-model-invocation: true
---

# Gardener

Invoke as `factory:garden [units]`, by hand or from the nightly factory schedule. This skill produces a plan. The factory tick dispatches workers and publishes results.

Read `AGENTS.md`, `ARCHITECTURE.md`, `.factory/units.json`, `.factory/policy.json` and `.factory/rubric.md`. Resolve paths in the target-branch checkout. Holds and mechanical detectors come from `.factory/policy.json`; do not copy the hold list here.

## Inputs and output

Inputs are optional unit ids, the factory store's prior audits, findings, dispositions and tasks, and the run deadline. With no ids, select all units. Reject unknown ids before planning. Use the provider tiers in `.factory/providers.json`.

Output is an audit plan naming units, their shared inputs and dependencies, auditor and challenger roles, deadlines and result paths. Workers emit immutable evidence. The tick records deduplicated survivors as tasks in the store; the plan producer does not implement, push, open PRs or merge.

## Plan

1. Select units and relevant signals from tests, checks, history and prior findings. Give each auditor a short code map with public entry points and affected paths.
2. Plan `factory:audit` workers per unit at the strongest tier, in isolated read-only worktrees. Audit failure classes that make agents write wrong, unverified or needlessly complex code. Every concern cites repository evidence and its grade under the rubric.
3. Plan independent `factory:challenge` workers with the evidence, using another vendor when available. Keep only concerns the challenger cannot refute with cited or reproduced evidence. Record both sides and unresolved objections; disputed findings follow the factory council policy or raise an owner hold.
4. Deduplicate survivors by failure class and scope against stored findings and tasks. A completed finding reopens on recurrence. Superseded findings are not rejected. A rejection records its assumption and scope and expires when that scope changes. A closed PR alone does not reject a class forever.
5. Rank survivors by consequence and how often an agent encounters them. Emit dependency-ordered tasks with evidence, bounded outcomes, affected units and observable verification. Each defect task requires a guardrail and a planted violation following `.agents/skills/guardrails/SKILL.md`.
6. Record holds from `.factory/policy.json` on affected tasks and carry them into review. The factory may land only after every active owner hold is satisfied. Security findings follow the independent security lens and keep sensitive details out of public reports.
7. Write the plan and partial results by the deadline. Report unplanned work and blockers. Review and fix cycles continue on surviving findings without a fixed round cap; deadlines and owner holds remain binding.

Implementers never score their own work. The scorecard reconciler owns score updates. Public-document audits apply the rubric's communication standard, including whether a diagram or code snippet carries more than prose.
