---
title: Abstract quality-gate contract via a justfile
date: 2026-07-02
status: Accepted
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
