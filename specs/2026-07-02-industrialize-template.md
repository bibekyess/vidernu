---
title: Industrialize the stack-agnostic multi-agent development template
date: 2026-07-02
status: Delivered       # Draft | Ratified | Delivered
---

# 2026-07-02 — Industrialize the stack-agnostic multi-agent development template

## Objective

The target repo (`agent-dev-template`) currently contains only a `LICENSE`. We want it to
become an **industry-standard, stack-agnostic multi-agent development template**: the proven
base template (the `automate-development-with-agents` pipeline — orchestrator + five
specialist subagents, file-based artifact handoff via worktrees, lane dirs `specs/ plans/
adr/`, two deterministic hooks, `AGENTS.md`/`CLAUDE.md`) **brought over intact**, plus a set
of stack-agnostic improvements that make it directly usable on real projects.

Delivery is **phased**. **v1 (this spec, in-scope)** ships: the intact base, a quality-gate
contract (`justfile`), `.github/` scaffolding, reusable slash commands, two more guard hooks,
folded-in behavioral principles, a documented trivial-change fast-path, a documented
model-routing rationale, and version markers (`TEMPLATE_VERSION` + `CHANGELOG.md`).
**v2 (deferred, out of scope here)** would add a `.claude/memory/` learning loop and an
`examples/` worked reference feature.

The guiding thesis is **LEANNESS**: every line must earn its place, because bloated context
measurably lowers task success. Every addition must therefore be either **deterministic**
(hook / CI / gate contract that a machine enforces) or **reusable** (a command consumed on
demand) — never redundant prose duplicated across files.

## User stories

- As a **developer adopting the template**, I want to clone it and get a working agent
  pipeline plus a fillable quality gate, so that I can wire in my stack's real commands and
  start shipping without re-deriving the scaffolding.
- As an **AI agent operating in a template-derived repo**, I want one stable gate command
  (`just check`) and clear invariants, so that I run the right checks regardless of the
  underlying stack.
- As a **reviewer / CI system**, I want a PR template and a CI workflow that both run the
  same gate, so that local review and automated checks agree on the definition of "clean."
- As a **repo owner**, I want deterministic guards against editing the primary checkout on
  the default branch and against committing obvious secrets, so that the "work only in the
  worktree" rule and secret-hygiene are enforced, not merely documented.
- As a **future maintainer**, I want a `TEMPLATE_VERSION` marker and a `CHANGELOG.md`, so
  that derived repos can track which template baseline they came from and a later Copier/
  Cookiecutter migration (a possible v2) can happen without regret.

## Functional requirements

Requirements are grouped. Each is a testable statement of **what** the template must contain
or do — not how to implement it.

### FR-0 — Base template carried over intact

1. The target repo MUST contain, functionally equivalent to the reference base template:
   `.claude/agents/` (orchestrator, requirements-engineer, researcher, technical-planner,
   implementation-engineer, code-reviewer), `.claude/hooks/agent-write-guard.sh`,
   `.claude/hooks/prune-worktrees.sh`, `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`,
   and lane dirs `specs/`, `plans/`, `adr/` each with a `README.md` (and `TEMPLATE.md` where
   the reference has one), plus a `README.md`.
2. The carried-over pipeline behavior (worktree artifact bus, requirements gate, kick-back
   signals `NEEDS DECISION` / `NEEDS RESEARCH`, model routing, lane write-confinement) MUST
   remain intact and MUST NOT be regressed by the improvements below. "Brought over intact"
   = copied and then edited only where a specific improvement below requires it (e.g. FR-1
   gate references in `AGENTS.md`, FR-7 principle merges). No gratuitous rewrites.
3. A `plans/TEMPLATE.md` MUST be added for symmetry with `specs/TEMPLATE.md` and
   `adr/TEMPLATE.md` (the reference ships only `plans/README.md`).

### FR-1 — Abstract quality-gate contract (`justfile`)

4. The repo root MUST contain a `justfile` exposing named targets `format`, `lint`,
   `typecheck`, `test`, and `check`, where `check` runs the other four.
5. Each of `format`, `lint`, `typecheck`, `test` MUST be **present but empty/no-op**
   (stack-agnostic), with an inline comment marking where a derived project fills in the
   real command. The `justfile` MUST NOT hardcode any language-specific tool (no `eslint`,
   `ruff`, `tsc`, `pytest`, etc.).
6. `AGENTS.md` MUST reference the gate by the stable command **`just check`** wherever it
   currently names or implies concrete build/test/lint commands, so the invariant is
   stack-agnostic and identical across `AGENTS.md`, CI (FR-2), the code-reviewer gate step,
   and the implementation-engineer verification step.
7. `just check` on a fresh clone (all bodies empty) MUST exit successfully (0), so the
   pipeline and CI are green before any real commands are wired in.

### FR-2 — `.github/` scaffolding

8. `.github/PULL_REQUEST_TEMPLATE.md` MUST mirror the code-reviewer's output shape: the
   five review passes (Correctness, Conventions & Rules, Interfaces & Compatibility,
   Architecture & ADR drift, Security), plus sections for what/why, files changed,
   intentional contract changes, ADRs added/updated, and links to the spec/plan.
9. `.github/workflows/ci.yml` MUST be a **GitHub Actions** workflow that invokes the same
   gate command `just check` (FR-1), and MUST run on `push` and `pull_request` to the
   default branch, so local gate and CI cannot diverge.
10. The CI workflow MUST make `just` available via a documented setup step (e.g. an install/
    setup action). On a fresh clone this MUST leave CI green because `just check` exits 0.
11. `.github/CODEOWNERS` MUST exist as a fillable stub (documented placeholder owners, not
    invented real handles).
12. `.github/ISSUE_TEMPLATE/` MUST provide at least a bug-report and a feature-request
    template.

### FR-3 — `.claude/commands/` reusable slash commands

13. The template MUST provide reusable slash commands for the pipeline stages: `/spec`,
    `/plan`, `/implement`, `/review`.
14. It MUST provide a **trivial fast-path** command `/quick-fix` that skips the spec and
    plan stages and runs implement + review only.
15. It MUST provide a retrospective command `/retro` that drives post-merge reflection.
    (Note: `/retro`'s persistence target, the `.claude/memory/` learning loop, is deferred
    to v2 — see Out of scope. For v1, `/retro` MAY surface lessons to the user without a
    dedicated memory store.)
16. Each command MUST invoke the existing pipeline/agents rather than duplicating agent
    prose; command bodies stay lean and delegate. Commands are Claude Code slash-command
    markdown files under `.claude/commands/`, one file per command.

### FR-4 — Two new deterministic hooks

17. A **protect-primary-checkout** hook MUST block `Write`/`Edit` targeting the primary
    checkout while it is on the default branch, enforcing "work only in the worktree." It
    MUST allow writes inside feature worktrees and MUST NOT block when the primary checkout
    is on a non-default branch.
18. A **secret-scan** hook MUST block `Write`/`Edit` whose content matches obvious secret
    patterns, returning a message the agent can act on.
19. Both hooks MUST be POSIX **bash `.sh`** scripts, consistent with the two existing hooks,
    and MUST be wired in `.claude/settings.json`, coexisting with `agent-write-guard` and
    `prune-worktrees` without breaking them.
20. Both hooks MUST fail safe and deterministic: block (exit 2) only on a real violation;
    never block legitimate work; the message fed back MUST state what was blocked and why.
21. "Default branch" detection for protect-primary-checkout MUST use the same method as
    `prune-worktrees.sh` (origin/HEAD, else local `main`/`master`). If detection fails
    (neither resolves), the hook MUST fail safe (allow the write) with a documented note.
22. The secret-scan pattern set MUST be **precision-over-recall**: a small curated set of
    high-precision patterns (PEM/private-key headers, AWS AKIA access keys, obvious
    `*_SECRET=`/`*_TOKEN=` assignments with high-entropy values), documented and easily
    extended, chosen so legitimate work is not blocked.
23. secret-scan MUST cover PreToolUse `Write`/`Edit` only (matching the existing hook model);
    a pre-commit secret-scan path is out of scope for v1.

### FR-5 — Fold four behavioral principles into `AGENTS.md` (no redundant block)

24. The four principles MUST be **merged into existing `AGENTS.md` sections** ("Working
    principles" / "Verify your work"), NOT appended as a new redundant block. ~70% already
    exists; only the net-new clauses are added.
25. Net-new clause A: "If multiple interpretations exist, present them — don't choose
    silently." MUST be added (folded into Working principles / the "ask when blocked" clause).
26. Net-new clause B: "Turn each task into a verifiable goal — for a bug, write the failing
    test first, then make it pass." MUST be added (folded into "Verify your work").
27. Meta-narration MUST be trimmed: any "these guidelines are working if…" style rubric MUST
    be removed to preserve leanness. (If the source `AGENTS.md` contains no such rubric, this
    clause is a no-op.)
28. `AGENTS.md` MUST remain under its ~150-line cap after all edits (FR-1, FR-5, FR-6, FR-7).

### FR-6 — Documented trivial-change fast-path in `AGENTS.md`

29. `AGENTS.md` MUST document a trivial-change fast-path: small fixes skip spec + plan and go
    straight to implement + review. This MUST be consistent with the `/quick-fix` command
    (FR-3) and with the orchestrator's existing "scale to the task" guidance.
30. The fast-path MUST state the **boundary condition** for "trivial": a localized fix with
    no new dependency, interface, or schema change, and nothing that would trigger an ADR.
    Anything outside this boundary is NOT trivial and MUST use the full pipeline.

### FR-7 — Documented model-routing rationale

31. `AGENTS.md` MUST document the model-routing rationale as a principle: haiku = cheap
    breadth (research), opus = high-stakes reasoning (requirements, planning, review),
    sonnet = implementation.
32. The rationale MUST be stated once, concisely, and MUST match the `model:` fields already
    declared in the agent definitions (no contradiction between prose and config).

### FR-8 — Version markers

33. The repo root MUST contain a `TEMPLATE_VERSION` file recording the current template
    version (v1 baseline), so derived repos can track their template origin and a future
    Copier/Cookiecutter migration can reason about the baseline.
34. The repo root MUST contain a `CHANGELOG.md` documenting the v1 baseline as its first
    entry, following a conventional changelog shape (versioned, dated sections).

### FR-9 — Discoverability

35. The `README.md` MUST describe the new v1 capabilities (gate `just check`, slash
    commands, the two new hooks, version markers) at the same lean bar as the existing
    README, without duplicating agent prose.

## Out of scope (deferred to v2)

- **`.claude/memory/` learning loop.** A durable, length-capped `learnings.md`, its
  prune/graduate rule, and `/retro` writing to it. In v1, `/retro` exists (FR-3) but has no
  dedicated memory store.
- **`examples/` worked reference feature.** A fully worked spec → plan → ADR → PR chain.
- **Copier/Cookiecutter templating.** v1 is a **static GitHub template** repo. The
  `TEMPLATE_VERSION` marker (FR-8) is added now specifically to enable a later migration.

## Edge cases

- **Empty gate on fresh clone.** `just check` with no bodies must exit 0 so CI (FR-2) and
  the reviewer's gate step pass on a clean template — otherwise every derived repo starts red.
- **`just` not installed in CI.** The CI workflow's setup step must make `just` available;
  absence of `just` must be surfaced as a setup failure, not a silent skip.
- **Secret-scan false positive.** A legitimate file containing a token-shaped-but-fake
  string (e.g. an example in docs, or this spec) must not be permanently blocked; the pattern
  set is precise and there is a documented way to proceed.
- **protect-primary-checkout during setup.** Initial template setup / carry-over commits to
  `main` are done by a human, not an agent — the hook governs agent `Write`/`Edit`, not human
  git operations. It must not deadlock legitimate first-time setup.
- **Hook interaction.** protect-primary-checkout and agent-write-guard both run on
  `PreToolUse(Write|Edit)`; their combined effect must be well-defined (both must pass).
- **Default-branch detection failure.** If neither origin/HEAD nor local main/master
  resolves, protect-primary-checkout fails safe (allows the write) with a documented note.
- **Windows runtime.** The dev environment is Windows; the bash hooks depend on a bash being
  available (Git Bash / WSL) and on `jq`. This dependency must be documented.

## Acceptance criteria

Binary and testable, in Given/When/Then form.

**Gate contract (FR-1)**
- **Given** a fresh clone of the template, **when** `just check` is run with no bodies filled
  in, **then** it exits 0 and no language-specific tool is invoked.
- **Given** the root `justfile`, **when** targets are listed, **then** `format`, `lint`,
  `typecheck`, `test`, and `check` all exist and `check` invokes the other four.
- **Given** `AGENTS.md`, **when** searched for concrete build/test/lint tool names in the
  gate context, **then** none are found; the gate is referenced only as `just check`.

**`.github/` (FR-2)**
- **Given** the PR template, **when** opened, **then** it contains the five reviewer-pass
  headings plus what/why, files changed, contract changes, ADRs, and spec/plan links.
- **Given** `.github/workflows/ci.yml`, **when** inspected, **then** it is a GitHub Actions
  workflow that runs `just check`, triggers on `push` and `pull_request` to the default
  branch, and includes a step that makes `just` available.
- **Given** a fresh clone, **when** CI runs, **then** it passes (green) because `just check`
  exits 0.
- **Given** the `.github/` dir, **when** listed, **then** `PULL_REQUEST_TEMPLATE.md`,
  `workflows/ci.yml`, `CODEOWNERS`, and at least two issue templates are present.

**Commands (FR-3)**
- **Given** `.claude/commands/`, **when** listed, **then** `/spec`, `/plan`, `/implement`,
  `/review`, `/quick-fix`, and `/retro` command files all exist.
- **Given** `/quick-fix`, **when** read, **then** it explicitly runs implement + review and
  skips spec + plan.
- **Given** any command file, **when** read, **then** it delegates to the existing agents
  rather than re-stating their full prose.

**Hooks (FR-4)**
- **Given** an agent on the primary checkout while it is on the default branch, **when** it
  attempts `Write`/`Edit`, **then** the protect-primary-checkout hook blocks (exit 2) with an
  actionable message.
- **Given** an agent writing inside a feature worktree, **when** it attempts `Write`/`Edit`,
  **then** protect-primary-checkout does NOT block.
- **Given** the primary checkout on a non-default branch, **when** an agent writes, **then**
  protect-primary-checkout does NOT block.
- **Given** content containing an obvious secret (e.g. a PEM private-key header or an AKIA
  key), **when** an agent attempts to `Write`/`Edit` it, **then** the secret-scan hook blocks
  (exit 2) with a message naming the matched pattern.
- **Given** ordinary source content, **when** written, **then** secret-scan does NOT block.
- **Given** both new hooks, **when** inspected, **then** they are bash `.sh` scripts.
- **Given** `.claude/settings.json`, **when** inspected, **then** all four hooks
  (agent-write-guard, prune-worktrees, protect-primary-checkout, secret-scan) are wired.

**Principles & docs (FR-5, FR-6, FR-7)**
- **Given** `AGENTS.md`, **when** read, **then** it contains clause A (present multiple
  interpretations) and clause B (write the failing test first for bugs), folded into existing
  sections, with no separate redundant principles block and no "these guidelines are working
  if…" rubric.
- **Given** `AGENTS.md`, **when** line-counted, **then** it is ≤ ~150 lines.
- **Given** `AGENTS.md`, **when** read, **then** it documents the trivial-change fast-path
  with the boundary condition (localized fix; no new dependency/interface/schema; nothing
  ADR-worthy), and the model-routing rationale (haiku/opus/sonnet) matching the agents'
  declared `model:` fields.

**Version markers (FR-8) & discoverability (FR-9)**
- **Given** the repo root, **when** listed, **then** `TEMPLATE_VERSION` and `CHANGELOG.md`
  both exist; `TEMPLATE_VERSION` records the v1 baseline and `CHANGELOG.md`'s first entry
  documents it.
- **Given** `README.md`, **when** read, **then** it describes the gate (`just check`), the
  slash commands, the two new hooks, and the version markers.

**Base intact (FR-0)**
- **Given** the target repo after the change, **when** compared to the reference, **then**
  all base pipeline files exist and the pipeline (worktree bus, requirements gate, kick-backs,
  lane confinement, model routing) is unchanged except where an improvement above requires an
  edit.
- **Given** the lane dirs, **when** listed, **then** `specs/`, `plans/`, and `adr/` each have
  a `README.md` and a `TEMPLATE.md` (including the newly added `plans/TEMPLATE.md`).

## Non-functional requirements

- **Leanness (overriding).** Every added file/line is deterministic (hook/CI/gate) or
  reusable (command). No prose duplicated across `AGENTS.md`, README, and commands.
  `AGENTS.md` stays ≤ ~150 lines.
- **Stack-agnostic.** No language- or framework-specific tool names anywhere in the template
  defaults (`justfile` bodies empty; CI calls the gate).
- **Deterministic guardrails.** Hooks and CI must be reproducible and fail safe; no
  reliance on model judgement for what a machine can enforce.
- **Portability.** The template targets a standard developer setup. Windows is the current
  dev OS; the bash hooks require a bash (Git Bash/WSL) and `jq` — this constraint MUST be
  documented. `just` is a required tool for the gate and MUST be documented as a dependency.
- **Discoverability.** The `README.md` describes the new capabilities at the existing lean
  bar (FR-9).
- **No secrets committed.** Consistent with `AGENTS.md`; the secret-scan hook reinforces it.

## Assumptions & open questions

All previously-open HIGH/MEDIUM/LOW items have been resolved by the user (accepted-by-user).
No open question remains unresolved; the spec is `Ratified`.

**Resolved by user decision (accepted-by-user):**
- `[ASSUMPTION | accepted-by-user]` **Task-runner = `justfile`.** Gate is a root `justfile`
  with named-but-empty `format`/`lint`/`typecheck`/`test` and `check` = all four; the stable
  command is `just check`, used by `AGENTS.md`, CI, reviewer, and implementer. (FR-1, FR-2)
- `[ASSUMPTION | accepted-by-user]` **Distribution = static GitHub template for v1**, WITH a
  `TEMPLATE_VERSION` file + `CHANGELOG.md` added now. No Copier/Cookiecutter in v1 (deferred
  to a possible v2); the version marker enables a later migration without regret. (FR-8)
- `[ASSUMPTION | accepted-by-user]` **Scope is phased.** v1 in-scope = base intact,
  `justfile` gate, `.github/`, `.claude/commands/` (incl. `/quick-fix`, `/retro`), the two
  new bash hooks, folded principles, documented fast-path, documented model-routing,
  `TEMPLATE_VERSION` + `CHANGELOG.md`. v2 deferred = `.claude/memory/` learning loop and
  `examples/` worked feature (see Out of scope).
- `[ASSUMPTION | accepted-by-user]` **New hooks are bash `.sh`**, consistent with the two
  existing hooks. Documented dependency: Git Bash/WSL + `jq`. (FR-4)
- `[ASSUMPTION | accepted-by-user]` **Secret-scan = precision-over-recall** — small curated
  high-precision pattern set that must not block legitimate work. (FR-4)
- `[ASSUMPTION | accepted-by-user]` **Fast-path "trivial" boundary** = localized fix, no new
  dependency/interface/schema, nothing ADR-worthy. (FR-6)
- `[ASSUMPTION | accepted-by-user]` Gate target names/semantics = `format`, `lint`,
  `typecheck`, `test`, `check`. (FR-1)
- `[ASSUMPTION | accepted-by-user]` Default-branch detection matches `prune-worktrees.sh`;
  fails safe (allows write) if unresolved. (FR-4)
- `[ASSUMPTION | accepted-by-user]` "Brought over intact" = copy + minimal required edits
  only. (FR-0)
- `[ASSUMPTION | accepted-by-user]` GitHub Actions is the CI host, running on push +
  pull_request to the default branch. (FR-2)
- `[ASSUMPTION | accepted-by-user]` Commands are `.claude/commands/*.md` slash-command files.
  (FR-3)
- `[ASSUMPTION | accepted-by-user]` CI installs/sets up `just` via a documented step; empty
  `just check` keeps CI green on a fresh clone. (FR-2)
- `[ASSUMPTION | accepted-by-user]` Add `plans/TEMPLATE.md` for symmetry with the other
  lanes. (FR-0)
- `[ASSUMPTION | accepted-by-user]` secret-scan covers PreToolUse Write/Edit only; pre-commit
  scanning is out of scope for v1. (FR-4)
- `[ASSUMPTION | accepted-by-user]` If the source `AGENTS.md` has no "guidelines working if…"
  rubric, the trim clause is a no-op. (FR-5)
