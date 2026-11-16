# Aircastle agent instructions

Aircastle is a headless CMS with code-defined collections.

- Follow [ARCHITECTURE.md](ARCHITECTURE.md). Update it in the same change when modules move. These updates are authorized; keep the map at module level.
- Start local services only through committed configuration and repository commands. Do not create ad hoc containers.
- Use `vp run db:test -- <command>` for disposable Postgres. Never reset another worktree's database.
- Define observable behavior and failure cases before you write code.
- Write the test first and confirm it fails for the intended reason.
- Test through the module's public interface. Each test must exercise Aircastle code, not only a dependency.
- Never weaken assertions or skip failing checks.
- Run only the smallest relevant checks: the test files, cases and package scripts the change affects.
