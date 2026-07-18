# Architecture Decision Records

Each ADR captures one significant, deliberate architectural decision — its context,
the choice made, the alternatives weighed, and the consequences accepted. An ADR is
immutable once `Accepted`: to change a decision, add a new ADR and mark the old one
`Superseded`.

## ADRs vs. AGENTS.md

- **AGENTS.md** holds always-apply *invariants* every agent follows on every task
  (style, prohibitions, workflow). Read it always.
- **adr/** holds discrete, dated *decisions* with the reasoning behind them. Read the
  ones relevant to the task — not the whole corpus.

If a rule applies to every change regardless of context, it belongs in AGENTS.md. If
it records a specific choice made at a point in time (with alternatives that were
real), it belongs here.

## Naming

`YYYY-MM-DD-<kebab-slug>.md` — date-prefixed, so records sort chronologically and
never collide across parallel branches. Copy `TEMPLATE.md` to start one.

## Status lifecycle

`Proposed` → `Accepted` → `Superseded`. **Merging a branch is the act of acceptance.**

- **Proposed** — the planner drafts the ADR when the decision is made.
- **Accepted** — the implementer sets this on the branch that implements the decision.
  Because ADRs live in the branch, the `Accepted` status only reaches `main` when the
  branch merges — so it is correct by construction, and an abandoned branch never leaks
  an `Accepted` ADR onto `main`. The reviewer confirms the status before approving.
- **Superseded** — when a later ADR replaces this one: set `superseded-by:` here and
  `supersedes:` on the new ADR.

An ADR stays `Proposed` until a branch that implements it is ready to merge.

## Index

| Date | Title | Status |
|------|-------|--------|
| 2026-07-02 | Abstract quality-gate contract via a justfile | Accepted |
| 2026-07-02 | Distribute as a static GitHub template with a TEMPLATE_VERSION marker | Accepted |
| 2026-07-03 | Offscreen document owns WebGPU model inference; service worker is a thin relay | Accepted |
| 2026-07-03 | Render Vidernu's panel by injecting into YouTube's page DOM, not via chrome.sidePanel | Accepted |
| 2026-07-04 | Model-load stall timeout and error-detail propagation contract | Accepted |
| 2026-07-04 | Bundle ORT runtime locally to satisfy MV3 CSP — no remote scripts | Accepted |
| 2026-07-04 | Split the single combined inference contract into two independent phase contracts | Accepted |
| 2026-07-04 | User-initiated Stop reuses cooperative supersession, not a hard GPU abort | Accepted |
