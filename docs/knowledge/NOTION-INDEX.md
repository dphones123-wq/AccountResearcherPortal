# Notion — verified index, 2026-09-20

Every ID below was fetched and confirmed on 2026-09-20. Two trees, one defect fixed, four pages
created.

## 📁 M4S — Research Portal  (Account Researcher)

Parent: `32bb8b1f-837c-8101-b7a8-d05226733b77`

| Page | ID | State |
|---|---|---|
| To Do List | `32bb8b1f-837c-8178-8242-c9d7e90ac597` | Active to 2026-08-24 |
| 🏗 Architecture — As-Built (2026-09-20) | `3e1b8b1f-837c-819b-a946-f4f99cc7e389` | **Created 2026-09-20** |
| ⚙️ Cloudflare Worker — As-Built (2026-09-20) | `3e1b8b1f-837c-81bd-92e9-d362bd6c92f6` | **Created 2026-09-20** — none existed |
| ⏱ Task Watchers — As-Built (2026-09-20) | `3e1b8b1f-837c-81fe-a13a-c6da581acf94` | **Created 2026-09-20** — none existed. Covers both watchers |
| 📅 Session Handovers | `337b8b1f-837c-81c9-b734-d1f971e8a084` | — |
| 🔧 Setup & Config | `337b8b1f-837c-8173-b1e1-da5205ac2e78` | — |
| 📋 Specs & Design | `337b8b1f-837c-8104-9fae-c5cd32d45513` | — |
| 🛠 CC Tasks — Completed | `337b8b1f-837c-81b9-ad76-e0fa2b567079` | — |
| 📊 Results & Analysis | `337b8b1f-837c-81c0-b551-de2b0aca5919` | — |
| 💬 Conversation Archive | `337b8b1f-837c-817b-8e75-c07025b34767` | — |

### The defect, fixed

`prospect-research/CLAUDE.md` listed `320b8b1f837c803e831cfc19f8635e0b` as the "Pipeline To-Do
List" and instructed every session to fetch it at startup. That ID belongs to a page titled
**"To Do List" under parent "📁 cc-webui"** — a different project, last edited 2026-03-28. The
paired Session Log ID was also cc-webui's. Neither errored, because the pages exist and return
content, so every session silently read another project's abandoned backlog.

Corrected in `CLAUDE.md` on 2026-09-20: the full verified table above, the startup instruction
now names the right page, and the wrong IDs are recorded with an explanation so nobody restores
them.

## Brian

Parent: `38db8b1f-837c-8113-b3bf-dff3e06631df`

| Page | ID | State |
|---|---|---|
| Brian — To-Do | `38db8b1f-837c-818b-bab3-d109fc95cd6c` | — |
| Brian — Session Log | `38db8b1f-837c-8118-946a-c94193ec7ab6` | Chronological from 2026-06-02 |
| Brian — GOTCHAs | `38db8b1f-837c-814b-88fa-f313dcc51d3f` | Entries 1–38 |
| Brian — Architecture | `38db8b1f-837c-81d5-a122-ccbeb7f1db50` | Last edited 2026-07-12. **Header callout added** pointing at the as-built page |
| 🏗 Architecture — As-Built (2026-09-20) | `3e1b8b1f-837c-8122-92cd-f63ca3359fa0` | **Created 2026-09-20** |
| ↳ Forecast Methodology | `39bb8b1f-837c-8147-b869-dbe470c431ed` | — |
| ↳ Diagram — System Overview | `38db8b1f-837c-8133-ae92-eb5aa15b8893` | — |
| ↳ Diagram — Semantic Layer & Execution Flows | `38db8b1f-837c-81b7-936d-eb4c19f16f38` | — |

The Brian parent page now cross-links the Task Watchers page, which lives in the M4S tree.

### Why the old Architecture page was not rewritten

It is the better *narrative* — design decisions, execution flows, the Dictionary rationale — and
rewriting it would have destroyed that to fix a counting problem. The split is now explicit:
**the old page is the rationale, the new page is the inventory**, and a callout at the top of the
old one says so. Measured drift is listed on the new page.

## Hard rules for both trees

- **Fetch a page immediately before updating it. No exceptions.**
- `update_content` takes exact `old_str` / `new_str` pairs.
- When a page gets large, create a sub-page rather than editing inline.
- Use `mention-page` to link. A bare `page` tag **moves** the page into the current one.
- After a shipped feature or a major decision, update To-Do and Session Log before reporting back.

---

## Correction log

**2026-09-20 — `sql/admission-controller.sql` was never unapplied.**
Three places said it was: the pipeline `CLAUDE.md`, the SQL file's own header comment, and the
as-built notes written from them. A direct check disproved all three — `admission_bucket` returns
HTTP 200, `admission_try_consume` returns the expected shape, the `pipeline-runs` row is live with
3 tokens, and all seven behavioural checks in `verify-admission-controller.mjs` pass.

So the live system has been running the real two-gate controller (3 tokens, one per 40s, ceiling
of 18), **not** the occupancy-below-2 fallback that every document claimed. Corrected in the
`CLAUDE.md` row, the SQL header, both Notion pages, and `handoff/account-researcher/AS-BUILT.md`.

The lesson is the one the Worker page already made in the other direction: **a document asserting
the state of a deployed system is a claim, not a fact.** Both the "code describes behaviour that
is not live" warning and this correction come from the same gap.
