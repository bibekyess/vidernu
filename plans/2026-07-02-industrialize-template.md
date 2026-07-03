# Plan — 2026-07-02 — Industrialize the stack-agnostic multi-agent development template

Spec: `specs/2026-07-02-industrialize-template.md` (Ratified)
Branch: `feat/industrialize-template`

## Overview

**What is built.** Turn the target repo `agent-dev-template` (currently only `LICENSE`)
into an industry-standard, stack-agnostic multi-agent development template. Two layers:

1. **Base carried over intact** from the reference template
   `automate-development-with-agents`: the 6 agents, 2 hooks, `settings.json`, `AGENTS.md`,
   `CLAUDE.md`, `.gitignore`, the three lanes (`specs/ plans/ adr/`), and `README.md`.
2. **v1 industrialization additions** layered on top: a `justfile` gate contract,
   `.github/` scaffolding (PR template, CI, CODEOWNERS, issue templates), `.claude/commands/`
   slash commands, two new deterministic hooks (`protect-primary-checkout.sh`,
   `secret-scan.sh`), folded-in behavioral principles + fast-path + model-routing rationale
   in `AGENTS.md`, `TEMPLATE_VERSION`, `CHANGELOG.md`, and a `plans/TEMPLATE.md`.

**In scope:** everything in the spec's FR-0 … FR-9 (v1).
**Out of scope (v2, do NOT create):** `.claude/memory/` learning loop, `examples/` worked
reference, Copier/Cookiecutter templating. `/retro` ships but must NOT scaffold a memory
file — it surfaces lessons to the user only.

**Guiding constraint — LEANNESS.** Every added line is either deterministic
(hook/CI/gate) or reusable (command). No prose duplicated across `AGENTS.md`, `README.md`,
and command files. `AGENTS.md` must stay ≤ ~150 lines after all edits.

### Source → target path map (base carry-over)

Reference base root: `C:\Users\bibek\agentic_workspace\agents_workshop\automate-development-with-agents`
Target root (this worktree): repo root of `feat/industrialize-template`.

| Source (base) | Target | Edited later? |
|---|---|---|
| `.claude/agents/orchestrator.md` | same | yes (FR-6 fast-path xref, gate ref) |
| `.claude/agents/requirements-engineer.md` | same | no |
| `.claude/agents/researcher.md` | same | no |
| `.claude/agents/technical-planner.md` | same | yes (`just check` gate ref) |
| `.claude/agents/implementation-engineer.md` | same | yes (`just check` gate ref) |
| `.claude/agents/code-reviewer.md` | same | yes (`just check` gate ref) |
| `.claude/hooks/agent-write-guard.sh` | same | no |
| `.claude/hooks/prune-worktrees.sh` | same | no |
| `.claude/settings.json` | same | yes (wire 2 new hooks) |
| `AGENTS.md` | same | yes (FR-1/5/6/7) |
| `CLAUDE.md` | same | no (`@AGENTS.md` import only) |
| `.gitignore` | same | no |
| `specs/README.md`, `specs/TEMPLATE.md` | same | no |
| `plans/README.md` | same | no |
| `adr/README.md`, `adr/TEMPLATE.md` | same | no |
| `README.md` | same | yes (FR-9 rewrite) |

NOTE: the target worktree already contains `specs/2026-07-02-industrialize-template.md`
(this feature's spec) and, after planning, `plans/2026-07-02-industrialize-template.md`.
Those are commit artifacts of THIS change and must be preserved — do not overwrite them
when copying the base's `specs/`/`plans/` dirs (the base has no dated files there, only
`README.md`/`TEMPLATE.md`, so no collision occurs).

## Architecture & Design

### Modules affected / created

- **`.claude/agents/`** (6 files) — copied intact; 4 receive a one-word gate-reference edit.
- **`.claude/hooks/`** — 2 base hooks copied intact; 2 new bash hooks added.
- **`.claude/settings.json`** — PreToolUse `Write|Edit` matcher grows from 1 hook to 3.
- **`.claude/commands/`** (new dir) — 6 slash-command markdown files.
- **`justfile`** (new, repo root) — the gate contract.
- **`.github/`** (new dir tree) — PR template, CI workflow, CODEOWNERS, 2 issue templates.
- **`AGENTS.md`** — merged edits (gate refs, 2 net-new clauses, fast-path, model routing).
- **`README.md`** — rewritten to describe v1 capabilities at the existing lean bar.
- **`TEMPLATE_VERSION`, `CHANGELOG.md`** (new, repo root) — version markers.
- **`plans/TEMPLATE.md`** (new) — symmetry with the other lanes.
- **`adr/`** — 2 new ADRs land with the code (see ADR section).

### Control flow — hook wiring

`.claude/settings.json` `hooks.PreToolUse` has one entry with matcher `Write|Edit` and a
single hook command. After this change that entry's `hooks` array holds **three** commands
run in order: `agent-write-guard.sh`, `protect-primary-checkout.sh`, `secret-scan.sh`.
Claude Code runs all matched hooks; if any exits non-zero (2), the tool call is blocked and
that hook's stderr is fed back to the agent. Combined effect must be "all must pass"
(spec edge case: hook interaction). `prune-worktrees.sh` stays under `SessionEnd`, untouched.

### New dependency

- **`just`** (the command runner, https://github.com/casey/just) — required to run the gate.
  Not vendored; documented as a required dev tool (README, CI installs it). Version: pin the
  CI setup action to a released `just` version (see CI step). No language-specific tool is
  introduced — `just` is stack-agnostic.
- Existing runtime deps (documented, not new): a POSIX **bash** (Git Bash/WSL on Windows)
  and **`jq`** for the hooks. These already back the base hooks.

## Architecture Decisions (ADRs)

Two ADRs are genuine decisions worth recording. Write each as a file following
`adr/TEMPLATE.md`, status `Proposed` (the implementer flips to `Accepted` on this branch
since merging is acceptance). The two new hooks do NOT warrant a separate ADR — they are a
routine extension of the already-established deterministic-hook pattern (agent-write-guard /
prune-worktrees); note them under ADR-B's consequences instead of inventing a third record.

### ADR to add #1 — `adr/2026-07-02-quality-gate-contract-justfile.md`

```markdown
---
title: Abstract quality-gate contract via a justfile
date: 2026-07-02
status: Proposed        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-02 — Abstract quality-gate contract via a justfile

## Context
The template is stack-agnostic: it cannot know whether a derived project uses eslint,
ruff, tsc, pytest, or none of these. Yet three consumers must agree on one definition of
"clean": `AGENTS.md` (what agents run before claiming done), CI (`.github/workflows/ci.yml`),
and the code-reviewer / implementation-engineer gate steps. Hardcoding tool names in each
place would fragment that definition and leak a language choice into a language-agnostic
template. We need a single, stable, indirection point that a fresh clone can run green and a
derived repo fills in.

## Decision
We will expose the quality gate as a root `justfile` with named recipes `format`, `lint`,
`typecheck`, `test`, and `check`, where `check` runs the other four. The four leaf recipes
ship **empty / no-op** with an inline comment marking where a derived project inserts its
real command; they contain no language-specific tool. The stable command `just check` is the
single gate reference used by `AGENTS.md`, CI, the reviewer, and the implementer. `just`
becomes a required dev/CI dependency.

## Alternatives considered
- **Hardcode per-language commands (npm/pytest/etc.) in each consumer** — rejected: not
  stack-agnostic; forces a language choice on every derived repo and duplicates the gate
  definition across `AGENTS.md`, CI, and the agents.
- **A shell script `scripts/check.sh`** — viable but reinvents a task runner; `just` gives
  named sub-targets (`format`/`lint`/…) for free with a clean self-documenting interface and
  is a widely adopted, language-neutral tool.
- **Makefile** — rejected: `.PHONY` boilerplate, tab-sensitivity, and weaker cross-platform
  ergonomics than `just`; `just` is purpose-built for command running.

## Consequences
- One place to fill in real commands; the gate cannot diverge between local, CI, and review.
- Adds `just` as a required tool (documented; CI installs it). A fresh clone with empty
  bodies exits 0, so CI and the reviewer's gate step are green before any command is wired.
- Derived projects must remember to fill the bodies; an empty gate silently "passes" until
  they do — accepted trade-off, called out in the `justfile` comments and README.
```

### ADR to add #2 — `adr/2026-07-02-static-github-template-versioning.md`

```markdown
---
title: Distribute as a static GitHub template with a TEMPLATE_VERSION marker
date: 2026-07-02
status: Proposed        # Proposed | Accepted | Superseded
supersedes:
superseded-by:
---

# 2026-07-02 — Distribute as a static GitHub template with a TEMPLATE_VERSION marker

## Context
The template must be adoptable today and evolvable later. Derived repos need to know which
baseline they came from so a future upgrade path (e.g. a Copier/Cookiecutter migration) can
reason about what changed. A full templating engine now would add tooling and a variable
syntax the v1 scope does not need, and would complicate the "clone and go" story.

## Decision
We will distribute v1 as a **static GitHub template repository** (used via GitHub's "Use
this template"), and record the baseline in a root `TEMPLATE_VERSION` file plus a
`CHANGELOG.md` whose first entry documents the v1 baseline. No Copier/Cookiecutter in v1;
the version marker exists specifically to enable that migration later without regret.

## Alternatives considered
- **Copier / Cookiecutter now** — rejected for v1: adds a templating engine, variable
  interpolation, and update tooling that the current scope does not require; deferred to a
  possible v2 that the `TEMPLATE_VERSION` marker is designed to enable.
- **No version marker** — rejected: derived repos could not tell which baseline they came
  from, making any future migration a guess.

## Consequences
- Adoption is trivial ("Use this template" / clone); no engine to learn.
- `TEMPLATE_VERSION` + `CHANGELOG.md` must be kept current as the template evolves.
- A later Copier/Cookiecutter migration can key off the recorded baseline. This ADR would be
  superseded by that migration's ADR when it lands.
- The two new deterministic guard hooks (`protect-primary-checkout.sh`, `secret-scan.sh`)
  ship as part of this static template; they extend the existing hook pattern and need no
  separate ADR.
```

### Relevant existing ADRs for the implementer

None. The target repo's `adr/` has no records yet (index is empty). The implementer creates
the two ADRs above and updates `adr/README.md`'s Index table with both rows.

## Implementation Steps (ordered)

Ordering rationale: the base must exist before its files can be edited; `AGENTS.md` gate
edits and `settings.json` hook wiring depend on the base being present; the `justfile` must
exist before `AGENTS.md`/agents can reference `just check`.

### Phase A — Carry the base over intact (FR-0)

1. **Copy `.claude/agents/`** — create all 6 files verbatim from the base:
   `orchestrator.md`, `requirements-engineer.md`, `researcher.md`, `technical-planner.md`,
   `implementation-engineer.md`, `code-reviewer.md`. Preserve YAML frontmatter (including
   `model:` fields: orchestrator=opus, requirements-engineer=opus, researcher=haiku,
   technical-planner=opus, implementation-engineer=sonnet, code-reviewer=opus). (FR-0.1, FR-7.32)
2. **Copy `.claude/hooks/`** — `agent-write-guard.sh` and `prune-worktrees.sh` verbatim.
   Ensure the executable bit is set (`git update-index --chmod=+x` on commit, or
   `chmod +x`). (FR-0.1)
3. **Copy `.claude/settings.json`** verbatim (edited in Phase D). (FR-0.1)
4. **Copy `CLAUDE.md`** verbatim (single line `@AGENTS.md`). (FR-0.1)
5. **Copy `AGENTS.md`** verbatim (edited in Phase C). (FR-0.1)
6. **Copy `.gitignore`** verbatim (`.claude/worktrees`, `.env`). (FR-0)
7. **Copy the lanes:** `specs/README.md`, `specs/TEMPLATE.md`, `plans/README.md`,
   `adr/README.md`, `adr/TEMPLATE.md` verbatim. Do NOT overwrite the existing
   `specs/2026-07-02-industrialize-template.md` or the plan in `plans/`. (FR-0.1)
8. **Copy `README.md`** verbatim as a placeholder (rewritten in Phase G). (FR-0.1)
9. **Add `plans/TEMPLATE.md`** — the base lacks it. Create it mirroring the shape of a plan
   (this document's own section list): frontmatter (`title`, `date`, `status` — but note
   plans have no status lifecycle; use a minimal header) then headings **Overview**,
   **Architecture & Design**, **Architecture Decisions (ADRs)**, **Implementation Steps
   (ordered)**, **Interface & Compatibility**, **Data / Migration Notes**, **Test Strategy**,
   **Risk & Sequencing**. Keep it lean, matching the density of `specs/TEMPLATE.md` /
   `adr/TEMPLATE.md` (placeholder bullets, not prose). (FR-0.3)

### Phase B — Quality-gate contract (FR-1)

10. **Create root `justfile`** with exactly these recipes (no language-specific tools):

    ```makefile
    # Quality gate — stack-agnostic. Fill each recipe with your project's real command.
    # `just check` is the single gate command used by AGENTS.md, CI, and the reviewer.

    # Run the whole gate.
    check: format lint typecheck test

    # Format code. Fill in, e.g.: prettier --write . / ruff format .
    format:
        @echo "format: no-op (fill in your formatter)"

    # Lint. Fill in, e.g.: eslint . / ruff check .
    lint:
        @echo "lint: no-op (fill in your linter)"

    # Type-check. Fill in, e.g.: tsc --noEmit / mypy .
    typecheck:
        @echo "typecheck: no-op (fill in your type checker)"

    # Tests. Fill in, e.g.: npm test / pytest
    test:
        @echo "test: no-op (fill in your test runner)"
    ```

    Each leaf recipe is a no-op `@echo` (exit 0) with an inline comment marking where the
    real command goes; `check` depends on the other four. Verify `just check` exits 0.
    (FR-1.4, FR-1.5, FR-1.7; edge case "empty gate on fresh clone")

### Phase C — `AGENTS.md` merges (FR-1.6, FR-5, FR-6, FR-7)

All edits are to the copied `AGENTS.md`. Keep the file ≤ ~150 lines (it starts at ~69, so
there is headroom, but stay lean — fold, don't append). (FR-5.28, FR-5.24)

11. **Gate reference (FR-1.6).** In the "Verify your work" principle, replace "Run the
    relevant build, tests, and linter" with a reference to the stable gate command
    **`just check`** (e.g. "Run `just check` (the project's quality gate — see the root
    `justfile`) before claiming a task is done."). In "Git & commits", change "Run tests and
    linters before committing" to "Run `just check` before committing". Ensure NO
    concrete tool name (eslint/ruff/tsc/pytest/npm/etc.) appears in the gate context.
    (FR-1.6; acceptance: AGENTS.md searched for tool names → none found)
12. **Net-new clause A (FR-5.25).** Fold into the "Ask when genuinely blocked" principle:
    add "If multiple interpretations exist, present them — don't choose silently." (one
    clause, not a new block).
13. **Net-new clause B (FR-5.26).** Fold into "Verify your work": add "Turn each task into a
    verifiable goal — for a bug, write the failing test first, then make it pass."
14. **Trim meta-narration (FR-5.27).** The source `AGENTS.md` has no "these guidelines are
    working if…" rubric — this is a **no-op**; confirm none was introduced. Do not add one.
15. **Trivial-change fast-path (FR-6).** Add a short subsection (2–4 lines) — e.g. under
    "Working principles" or a new "Scope to the task" note — documenting: a trivial change
    (a localized fix with **no new dependency, interface, or schema change, and nothing that
    would trigger an ADR**) skips the spec + plan stages and goes straight to implement +
    review; anything outside that boundary uses the full pipeline. Keep it consistent with
    the orchestrator's "scale to the task" line and the `/quick-fix` command. (FR-6.29, FR-6.30)
16. **Model-routing rationale (FR-7).** Add one concise line/bullet: "Model routing: haiku =
    cheap breadth (research); opus = high-stakes reasoning (requirements, planning, review);
    sonnet = implementation." State once; it must match the agents' `model:` fields
    (verified in step 1). (FR-7.31, FR-7.32)
17. **Line-count check.** Confirm `AGENTS.md` is ≤ ~150 lines after all edits. (FR-5.28)

### Phase D — Gate references in agents (FR-1.6)

The gate command must read `just check` wherever the agents name/imply the gate. Make the
minimal edit only; no gratuitous rewrites (FR-0.2). Concrete spots to update:

18. **`code-reviewer.md`** — Workflow step 3: "Run the quality gate (format, lint,
    type-check, tests — see AGENTS.md)" → "Run the quality gate: `just check` (see AGENTS.md)".
    Also the "Auto-reject triggers" line "Quality-gate failure" may reference `just check`
    parenthetically. (FR-1.6)
19. **`implementation-engineer.md`** — Phase 4 step 7: "Run the project's full gate … see
    `AGENTS.md`" → reference `just check` explicitly. Rules #3 "The quality gate must be
    green" may name `just check`. (FR-1.6)
20. **`technical-planner.md`** — Implementation-Steps guidance "Final step: run the
    project's full quality gate (see AGENTS.md)" → "Final step: run `just check` (the project's
    quality gate)". (FR-1.6)
21. **`orchestrator.md`** — no gate-command reference to change; leave intact except confirm
    "Scale to the task" wording is consistent with the AGENTS.md fast-path (no edit required
    unless it contradicts — it does not). (FR-0.2)

### Phase E — Two new hooks + wiring (FR-4)

22. **Create `.claude/hooks/protect-primary-checkout.sh`** (bash, exit 2 on violation).
    Behavior (FR-4.17, 4.20, 4.21; edge cases):
    - `set -uo pipefail`; read hook JSON from stdin; extract `tool_input.file_path` via `jq`
      (mirror `agent-write-guard.sh`'s parsing). If no file_path → `exit 0`.
    - Resolve the target file's absolute path. Determine the git toplevel that owns it
      (`git -C <dir> rev-parse --show-toplevel`).
    - **Worktree allowance:** if the owning toplevel is a linked worktree (i.e. NOT the
      primary checkout — detect via `git rev-parse --git-common-dir` differing from
      `--git-dir`, or path under `.claude/worktrees/`), `exit 0` (writes in feature
      worktrees are always allowed). (FR-4.17)
    - **Default-branch detection** — use the SAME method as `prune-worktrees.sh`:
      `git symbolic-ref --quiet refs/remotes/origin/HEAD`, else local `main`/`master` via
      `git show-ref --verify`. If neither resolves → **fail safe, `exit 0`** with a comment
      documenting the fallback. (FR-4.21; edge case "default-branch detection failure")
    - If the write targets the **primary checkout** AND its current branch
      (`git rev-parse --abbrev-ref HEAD`) equals the detected default branch → block:
      `exit 2` with a stderr message naming the file and instructing the agent to work in a
      feature worktree (`git worktree add .claude/worktrees/<slug> -b feat/<slug>`). (FR-4.17, 4.20)
    - If the primary checkout is on a **non-default** branch → `exit 0`. (FR-4.17)
    - Human git operations are unaffected (the hook only governs agent `Write`/`Edit`). (edge case)
23. **Create `.claude/hooks/secret-scan.sh`** (bash, exit 2 on match). Behavior (FR-4.18,
    4.20, 4.22, 4.23):
    - `set -uo pipefail`; read hook JSON from stdin; extract the content to be written. For
      `Write` use `tool_input.content`; for `Edit` use `tool_input.new_string` (fall back to
      both via `jq` so either tool is covered). If empty → `exit 0`.
    - Match against a **small curated, high-precision** pattern set (precision-over-recall),
      documented inline and easy to extend:
      - PEM/private-key header: `-----BEGIN [A-Z ]*PRIVATE KEY-----`
      - AWS access key id: `AKIA[0-9A-Z]{16}`
      - High-entropy secret/token assignment: a `*_SECRET`/`*_TOKEN`/`*_API_KEY` (case-insens.)
        assignment whose value is a long (≥ ~20 char) high-entropy quoted/unquoted string —
        NOT placeholder words like `changeme`, `example`, `xxxx`, `<...>`, `your-...`.
    - On a match: `exit 2` with a stderr message naming which pattern matched and telling the
      agent to remove the secret / use an env var (per `AGENTS.md`'s "don't commit secrets").
      (FR-4.18, 4.20, 4.22)
    - On no match / ordinary source: `exit 0`. Pattern set is precise so docs/spec files with
      fake token-shaped strings are not permanently blocked. (edge case "secret-scan false positive")
    - **PreToolUse `Write`/`Edit` only** — no pre-commit path. (FR-4.23)
    - Set executable bits on both new hooks (as in step 2). (FR-4.19)
24. **Wire both hooks into `.claude/settings.json`** (FR-4.19, 4.24). In the existing
    `hooks.PreToolUse` entry with `"matcher": "Write|Edit"`, extend the `hooks` array to
    three commands, in order:
    ```json
    { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/agent-write-guard.sh" },
    { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-primary-checkout.sh" },
    { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/secret-scan.sh" }
    ```
    Leave `SessionEnd` → `prune-worktrees.sh` and the `permissions`/`agent`/`language` keys
    untouched. Validate the JSON parses. Combined effect = all three must pass. (FR-4.19,
    4.24; edge case "hook interaction")

### Phase F — `.claude/commands/` slash commands (FR-3)

Create one lean markdown file per command under `.claude/commands/`. Each body **delegates
to the existing agents** (names the stage/agent to spawn) rather than restating agent prose
(FR-3.16, acceptance: commands delegate, don't re-state). Suggested shape: a one-line
frontmatter `description:` plus 2–6 lines invoking the pipeline stage(s).

25. **`.claude/commands/spec.md`** — invoke the requirements pipeline (orchestrator →
    `requirements-engineer`), run the requirements gate to `Ratified`. (FR-3.13)
26. **`.claude/commands/plan.md`** — invoke `technical-planner` on the ratified spec. (FR-3.13)
27. **`.claude/commands/implement.md`** — invoke `implementation-engineer` on the plan. (FR-3.13)
28. **`.claude/commands/review.md`** — invoke `code-reviewer` on the PR/branch; loop on
    REQUEST_CHANGES. (FR-3.13)
29. **`.claude/commands/quick-fix.md`** — the trivial fast-path: **explicitly skip spec + plan**
    and run implement + review only. Must state the trivial boundary (matches AGENTS.md
    FR-6). (FR-3.14; acceptance: quick-fix explicitly runs implement+review, skips spec+plan)
30. **`.claude/commands/retro.md`** — drive post-merge reflection and **surface lessons to the
    user in the response**. Must NOT create or reference `.claude/memory/` (v2-deferred);
    no memory file scaffolding. State inline that persistence is a future v2 capability.
    (FR-3.15; spec Out-of-scope)

### Phase G — `.github/` scaffolding (FR-2)

31. **`.github/PULL_REQUEST_TEMPLATE.md`** — mirror the code-reviewer's output shape:
    the five review-pass headings (**Correctness**, **Conventions & Rules**, **Interfaces &
    Compatibility**, **Architecture & ADR drift**, **Security**), plus sections: **What & why**,
    **Files changed**, **Intentional contract changes**, **ADRs added/updated**, and
    **Spec / plan links**. Checkbox/heading form. (FR-2.8; acceptance: PR template contents)
32. **`.github/workflows/ci.yml`** — GitHub Actions workflow:
    - `on: [push, pull_request]` scoped to the default branch (`branches: [main]`). (FR-2.9)
    - One job (`ubuntu-latest`): `actions/checkout`, a step to **install `just`** (e.g.
      `extractions/setup-just@v2`, pinned), then `run: just check`. (FR-2.10; edge case
      "`just` not installed in CI" → explicit setup step, not a silent skip)
    - A fresh clone passes because `just check` exits 0. (FR-2 acceptance: CI green)
33. **`.github/CODEOWNERS`** — fillable stub with a documented placeholder owner (e.g.
    `# * @your-org/your-team`), NOT invented real handles. (FR-2.11)
34. **`.github/ISSUE_TEMPLATE/bug_report.md`** and
    **`.github/ISSUE_TEMPLATE/feature_request.md`** — at least these two templates.
    (FR-2.12; acceptance: ≥2 issue templates)

### Phase H — Version markers + discoverability (FR-8, FR-9)

35. **`TEMPLATE_VERSION`** (repo root) — record the v1 baseline (e.g. a single line `1.0.0`
    or `v1`). (FR-8.33)
36. **`CHANGELOG.md`** (repo root) — conventional changelog (Keep-a-Changelog style):
    versioned, dated sections; the first entry documents the v1 baseline (Added: base
    pipeline carried over, `justfile` gate, `.github/` scaffolding, `.claude/commands/`,
    two new hooks, folded principles + fast-path + model-routing, `TEMPLATE_VERSION`).
    (FR-8.34)
37. **Rewrite `README.md`** (FR-9) at the existing lean bar. Keep the base's pipeline/lanes/
    hooks/AGENTS-rationale sections, and add concise coverage of the v1 capabilities: the
    gate (`just check` + `justfile`), the slash commands, the two new hooks
    (`protect-primary-checkout`, `secret-scan`), and the version markers
    (`TEMPLATE_VERSION`/`CHANGELOG.md`). Document the tool prerequisites in one place:
    **`just`** (required for the gate) and **bash (Git Bash/WSL) + `jq`** for the hooks
    (Windows note). Do NOT duplicate agent prose. (FR-9.35; NFR portability; edge case
    "Windows runtime")

### Phase I — Update the ADR index + create ADR files

38. **Create the two ADR files** from the content in the "Architecture Decisions" section
    above: `adr/2026-07-02-quality-gate-contract-justfile.md` and
    `adr/2026-07-02-static-github-template-versioning.md`. Set both to `Accepted` (this
    branch implements them and merging is acceptance). (per implementation-engineer Phase 2.5)
39. **Update `adr/README.md`** Index table — replace the `_none yet_` row with two rows, one
    per ADR (Date `2026-07-02`, Title, Status `Accepted`).

### Phase J — Verify (final quality gate)

40. **Run `just check`** at the repo root — must exit 0 (all bodies empty). (FR-1.7)
41. **Run the structural + hook verification** described in the Test Strategy below; all
    checks must pass. This is the project's quality gate for a scaffolding repo.

## Interface & Compatibility

- **`just check` is the stable gate command** — the observable contract shared by
  `AGENTS.md`, CI, reviewer, implementer. It must exist and exit 0 on a fresh clone. Any
  future change to the gate must preserve this command name. (FR-1)
- **Hook contract** — hooks receive the Claude Code PreToolUse JSON on stdin and signal a
  block with exit code 2 (stderr fed back). New hooks must match this contract exactly so
  they coexist with `agent-write-guard.sh`. (FR-4)
- **Agent `model:` fields** — must not change; the model-routing prose in `AGENTS.md` is
  derived from them and must not contradict them. (FR-7.32)
- **Base pipeline behavior** (worktree bus, requirements gate, `NEEDS DECISION`/`NEEDS
  RESEARCH` kick-backs, lane write-confinement) — preserved; edited only where a specific FR
  requires it. No gratuitous rewrites. (FR-0.2)
- **`.claude/settings.json` keys** `language`, `agent`, `permissions`, `SessionEnd` —
  preserved unchanged; only the PreToolUse `Write|Edit` hooks array is extended.

## Data / Migration Notes

No datastore, schema, or persisted data. The only "migration"-like concern is the
`TEMPLATE_VERSION` marker enabling a future Copier/Cookiecutter migration (v2) — recorded in
ADR #2. No `.claude/memory/` or `examples/` directories are created (v2-deferred).

## Test Strategy

No application code and no app test framework — so verification is a **runnable shell/CI
check** that the deterministic pieces behave and all required files exist. Provide these as
concrete, repeatable commands (run locally in Git Bash/WSL and mirrored by CI's `just check`
where applicable). The implementer runs them as the final gate; no test files are committed
beyond what already exists (this is a scaffolding repo).

### T1 — Structural existence (maps to FR-0, FR-2, FR-3, FR-8 acceptance)
Assert every required path exists:
- Agents: `.claude/agents/{orchestrator,requirements-engineer,researcher,technical-planner,implementation-engineer,code-reviewer}.md`
- Hooks: `.claude/hooks/{agent-write-guard,prune-worktrees,protect-primary-checkout,secret-scan}.sh`
- `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `README.md`, `justfile`,
  `TEMPLATE_VERSION`, `CHANGELOG.md`
- Lanes: `specs/{README,TEMPLATE}.md`, `plans/{README,TEMPLATE}.md`, `adr/{README,TEMPLATE}.md`
- Commands: `.claude/commands/{spec,plan,implement,review,quick-fix,retro}.md`
- `.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `.github/CODEOWNERS`,
  `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`
- ADRs: the two `adr/2026-07-02-*.md` files.

### T2 — Gate contract (maps to FR-1 acceptance)
- `just check` at repo root exits 0. (Happy path — empty bodies.)
- `just --summary` (or reading the `justfile`) lists `format lint typecheck test check`, and
  `check` depends on the other four.
- `grep -Eiw 'eslint|ruff|tsc|pytest|npm|prettier|mypy|jest'` over the gate context in
  `AGENTS.md` returns no matches (stack-agnostic gate reference). (Negative/validation.)

### T3 — protect-primary-checkout hook (maps to FR-4 acceptance)
Drive the hook by piping crafted PreToolUse JSON to it and asserting exit codes:
- **Blocks (exit 2):** JSON whose `file_path` is in the primary checkout while it is on the
  default branch → exit 2, stderr names the file. (auth/guard failure path)
- **Allows (exit 0):** `file_path` inside a feature worktree (e.g. under
  `.claude/worktrees/<slug>/`). (Happy path.)
- **Allows (exit 0):** primary checkout on a non-default branch. (Since this branch itself is
  `feat/industrialize-template`, the live run naturally exercises the non-default-branch
  allow — confirm the implementer's own writes are not blocked.)
- **Fail-safe (exit 0):** simulate default-branch detection failure (e.g. run where neither
  origin/HEAD nor main/master resolves) → exit 0. (Detection-failure edge case.)

### T4 — secret-scan hook (maps to FR-4 acceptance)
- **Blocks (exit 2):** content with a PEM header `-----BEGIN RSA PRIVATE KEY-----` → exit 2,
  stderr names the matched pattern.
- **Blocks (exit 2):** content with an `AKIA` + 16-char key → exit 2.
- **Allows (exit 0):** ordinary source content, and a docs/spec string like
  `AWS_SECRET=changeme` / `token: <your-token>` (placeholder) → exit 2 must NOT fire. (False-
  positive edge case.)

### T5 — Hook wiring + JSON validity (maps to FR-4.24 acceptance)
- `jq . .claude/settings.json` parses (valid JSON).
- The PreToolUse `Write|Edit` hooks array contains all three commands; `SessionEnd` still has
  `prune-worktrees.sh`.
- All four hook `.sh` files are executable (`test -x`).

### T6 — CI YAML validity (maps to FR-2 acceptance)
- `.github/workflows/ci.yml` parses as YAML (e.g. `jq`-via-`yq`, a Python `yaml.safe_load`, or
  a linter); triggers on `push` + `pull_request` to the default branch; contains a `just`
  install step and a `just check` run step.

### T7 — AGENTS.md constraints (maps to FR-5, FR-6, FR-7 acceptance)
- Line count ≤ ~150.
- Contains clause A ("multiple interpretations … present them") and clause B ("failing test
  first"), folded (no separate "Principles" block, no "guidelines are working if" rubric).
- Documents the fast-path with the boundary condition, and the model-routing rationale
  (haiku/opus/sonnet) matching the agents' `model:` fields.

Deliverable form: the implementer MAY commit a small `scripts/verify-template.sh` ONLY if it
adds durable value; otherwise run T1–T7 as ad-hoc shell commands and report results. Do NOT
create `examples/` or `.claude/memory/`.

## Risk & Sequencing

- **Ordering dependency (highest risk):** Phase A (base) must complete before Phases C/D
  (AGENTS.md + agent gate edits) and Phase E (settings wiring) — those edit files that only
  exist after the copy. The `justfile` (Phase B) must exist before `just check` references
  are added (Phases C, D, G). Mitigation: follow the phase order strictly.
- **Not overwriting this change's own artifacts:** copying the base `specs/`/`plans/` must
  not clobber `specs/2026-07-02-industrialize-template.md` or the plan. Mitigation: copy only
  `README.md`/`TEMPLATE.md` from the base lanes (base has no dated files there).
- **Windows/bash portability:** hooks require bash + `jq`; the dev OS is Windows. Mitigation:
  documented in README (Git Bash/WSL + `jq`); hook logic mirrors the proven base hooks.
- **secret-scan false positives** (blocking legitimate docs/spec content, incl. this plan and
  the spec, which mention `AKIA`/`*_SECRET`): mitigate with precision-over-recall patterns and
  placeholder exclusions (T4). Note: this plan itself contains token-shaped example strings —
  confirm the implementer's writes are not self-blocked (patterns must exclude
  `changeme`/`example`/`your-`/`<...>` placeholders).
- **CI `just` availability:** absence of `just` must fail as a setup error, not a silent skip
  — pinned setup action (Phase G step 32).
- **Hook interaction:** three PreToolUse hooks run together; all must pass. Mitigation: each
  hook returns exit 0 for cases outside its concern, and T3/T4/T5 verify the combination.
- **Leanness regression:** folding into AGENTS.md risks bloat. Mitigation: T7 line-count and
  no-redundant-block checks; fold clauses into existing bullets rather than adding sections.
