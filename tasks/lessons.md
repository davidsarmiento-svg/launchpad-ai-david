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

## L2 — Don't try to fix LLM recall with prompt MANDATORY language (2026-05-23)

**Mistake**: Phase 9.1 reconciliation agent kept missing
`DUPLICATE_PAY_PERIOD`, hallucinating the employer-match formula, and
emitting issues whose own `agent_explanation` said "no issue to emit".
I iterated the skill prompt three times with increasingly bold
MANDATORY / MUST / DO NOT language. Compliance went from ~40% to
~60%. Each prompt round burned ~15 minutes of verification time.

**Trigger**: any time the agent fails the same check the same way
across two consecutive verification rounds despite skill updates.

**Rule**: stop tightening the prompt. Move enforcement to one of:

1. **Deterministic detection in the runner**, BEFORE the agent runs.
   Pre-compute everything the agent would compute (expected values,
   exact-equality cross-run checks). Inject the results into the
   context payload. The agent now reads facts instead of computing
   them. Pass system-detected issues as `system_detected_issues[]`
   so the agent doesn't duplicate. This is what the architecture doc
   means by `validate_payroll_run` / `reconcile_payroll_run` —
   programmatic checks alongside agent-driven detection, not instead
   of.
2. **Boundary guard in the tool handler.** Validate the model's tool
   input against the contract BEFORE persisting. If the
   `agent_explanation` contradicts the issue's own existence, return
   `{ok:false, error: '…'}` so the model sees the rejection and moves
   on. This is the last-line backstop for skill anti-patterns.

**Heuristic**: if you're writing a third "MUST" / "MANDATORY" /
"YOU MUST NOT" rule into a skill, stop. That rule belongs in code,
not in a prompt.

**Anti-pattern**: blaming the model. The model is non-deterministic;
the system should be deterministic where it matters. Math, exact
equality, and self-contradiction checks are deterministic. Treating
them as "the agent's job" is asking the wrong tool to do the work.

**Doesn't violate the non-negotiable**: deterministic detection in
the runner still writes `actor_type='system'` audit rows and creates
`reconciliation_issues` (proposals), not data mutations. The
non-negotiable forbids agents silently changing **data**; it does
not forbid systems deterministically detecting **issues**.
