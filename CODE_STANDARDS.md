# Code standards

Review and refactor agents check changes against these standards. [ARCHITECTURE.md](ARCHITECTURE.md) holds the module map and feature pattern. [The guardrails skill](.agents/skills/guardrails/SKILL.md) lists the rules that checks already enforce.

## Architecture

- Design deep modules: small explicit interfaces, clear ownership and cohesive implementations. Keep each feature's implementation, types and public-interface tests together.
- Keep the CMS core independent of frontend frameworks and HTTP routing. Keep HTTP contexts and SQL-driver types inside their adapters.
- Browser code reaches the server only through HTTP and browser-safe shared contracts. It must not import server implementations, database adapters or executable collection configuration.
- For backend operations, pass dependencies explicitly and return expected failures as discriminated results. Construct runtime resources at application startup and follow the established pattern for each concern.
- Validate external configuration and document input at entry points. Keep internal operations typed.
- Keep field validation rules separate from editor presentation settings. Changing an editor must preserve the field's data contract.
- Enforce database-dependent guarantees, such as uniqueness, in the persistence layer.
- Verify expected type errors with isolated negative fixtures and explicit compiler diagnostics.
- Reuse existing tools and checks. Before writing infrastructure such as a test harness, runner, server lifecycle, client, parser, validator, retry loop or report format, check the version-matched docs of repository tools and well-known libraries. Write custom code only for a gap no stock option covers, and name that gap with a docs link in the PR body.
- Fix the class, not only the instance. A fix for a defect or review finding adds or extends the check that would have caught it, following [the guardrails skill](.agents/skills/guardrails/SKILL.md), and shows it failing on a planted violation.
- Before changing behavior an earlier commit chose deliberately, read its history. Keep its intent or ask the owner.
- Every exemption, such as a lint override, knip ignore, policy allowance or type cast, states its reason in the allowance's reason string, or else in the commit and PR body that add it.

## API

- Keep route schemas and handlers together and preserve inferred router return types. When a route declares a schema, use ArkType with `describeRoute`/`resolver` for OpenAPI and `satisfies typeof schema.infer` for the response type, as `features/health` does. Content routes have no ArkType schemas yet: their `describeRoute` calls set only a summary and tags, and their handlers check input by hand. Keep typed-client assertions in feature tests.

## Web

- Keep UI copy focused on the user's current task. Add explanations, caveats or disclaimers only when they help the user complete that task or make a meaningful decision, or when asked. Omit implementation details that do not change what the user needs to know or do.
- Marketing pages use a larger type scale than the dashboard. `[data-theme-scope='marketing']` in `apps/web/src/index.css` sets an 18px base at the normal weight; marketing text inherits both rather than using `text-sm`. Do not bold or add heavier weights to marketing text unless asked.
- Use semantic colour tokens in shared UI components. `apps/web/src/index.css` owns the light and dark `marketing` and `dashboard` palettes. Declare `data-theme-scope` on page layouts, with marketing as the public-page default. Keep palette choices out of individual buttons, inputs and overlays.
- Add directories when working code needs them. Do not keep empty scaffolding or placeholder folders.
- Use icon libraries instead of handwritten or copied SVG paths: `lucide-react` for UI icons, `@primer/octicons-react` for GitHub icons and `@icons-pack/react-simple-icons` for other third-party brand logos. Keep custom product branding in `apps/web/public/brand`.
- Every enabled clickable control shows a pointer cursor on hover. Use native interactive elements or the correct accessible role so the shared rule in `apps/web/src/index.css` applies.
- Preserve text-entry cursors on editable inputs and disabled cursors on disabled controls. Maintain the shared cursor rule instead of adding cursor styles to individual components.
- App-wide favicon theme handling belongs in `apps/web/src/App.tsx`, so public pages follow the same preference.
