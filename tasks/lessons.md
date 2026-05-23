# Session Lessons

Patterns to internalize so the same mistake doesn't repeat.

## L1 — Use subagents by default for multi-step work (2026-05-22)

**Mistake**: I ran a 3-phase task (commit Phases 5+6+7, build Phase 7.5,
build Phase 8) entirely on the main thread. Read 12+ source files
inline during planning, hunk-staged three commits inline, ran Phase 7.5
verification inline. This bloated my context window with code I had
already used and slowed every subsequent step.

**Trigger**: any task that has either:
- 3+ distinct sub-tasks with disjoint code surfaces, or
- a research phase that touches >5 files of pre-existing code, or
- a mechanical phase (commits, hunk-staging, build verification) that
  doesn't need ongoing model judgment.

**Rule**:
- **Plan-mode research**: spawn `explore` subagents in parallel for
  each disjoint area (e.g. "audit the DAL", "audit the agent runner +
  tools registry", "audit the route handlers") and consume their
  summaries instead of reading source inline.
- **Mechanical commits / verification**: spawn a `shell` subagent with
  the exact recipe (commands + expected outputs). Resume and inspect
  the summary instead of streaming output through main context.
- **Self-contained build chunks**: once a sub-spec is detailed enough
  to hand off (skill + tools + route + UI for a phase), spawn a
  `generalPurpose` subagent with the spec and verify the result.
- **Run subagents in parallel** whenever they touch disjoint files.
  One message, multiple Task tool calls.

**Heuristic**: before reading the 4th file in a row inline, stop and
ask "should this be a subagent?" If the answer is "yes" or "maybe",
spawn one.

**Anti-pattern**: using `Task` only after the user prompts for it.
CLAUDE.md says "use subagents liberally" — that means by default, not
on request.
