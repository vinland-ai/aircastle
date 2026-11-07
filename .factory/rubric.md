# Review rubric for vinlandatelier/aircastle

## Severities

- `blocker`: the change is wrong or unsafe; it cannot land.
- `should`: the change must be fixed before landing unless the owner accepts the risk.
- `nit`: optional polish.
- `question`: the reviewer needs an answer; no change implied.

## Evidence grades

- `reproduced`: a command, its exit code and a log digest, or a failing test.
- `cited`: a file and line, or a URL with quoted text.
- `reasoned`: an argument with no artifact. Only nits and questions may rest on it.
- `owner`: an owner decision or requirement, with its decision id.

## Lenses

- Correctness: the line and the failure scenario.
- Rules and evidence: the repository's written rules and the grades above.
- Spec: behaviour changes against the approved spec revision.
- Unknowns: gaps in the verification matrix.
- Security: tooling, CI, dependency and `.factory/` changes, by an independent instance.

## Communication standard

A reader reaches the commands or the behaviour within the first screen. A diagram or code snippet replaces prose where it carries more, and is not added where prose is shorter.

Blocker and should findings need reproduced, cited or owner evidence. A fixed disposition needs reproduced evidence on the new head; refuted needs cited or reproduced evidence. Affirmations name what was checked and how. Ungraded claims are rejected.
