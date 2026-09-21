# Account Researcher — how it works today

**Status: as-built documentation, 2026-09-20. No proposals, no Codex design.**
Read alongside `handoff/watcher-migration/AS-BUILT.md` (the task runner that drives unattended
runs) and `extract/claude-mem/prospect-research.md` (10,301 recorded observations of how it got
this way).

Sections 9 and 12 are the ones to read before touching anything: section 9 is where Claude is
load-bearing, and section 12 is production failures the current design exists to prevent.

---

## 1. What it is

Given a company name and URL, produce an enterprise-sales account brief for Figma AEs: company
point-of-view with an ICP score, decision-maker discovery, contact enrichment, per-persona
outreach hooks, and an Excel workbook plus a PDF.

It is **three repositories and a hosted database**, not one app.

| Repo | Path | Remote | Role |
|---|---|---|---|
| Pipeline | `~/M4S/prospect-research` | `dbarrett-art/prospect-research` | The research engine, M1–M7. Node. |
| Portal | `~/M4S/AccountResearcherPortal` | `dbarrett-art/AccountResearcherPortal` | React SPA AEs use. GitHub Pages. |
| Worker | `~/M4S/cloudflare-worker` | `dbarrett-art/cloudflare-worker` | Authenticated API + admission control |
| Supabase | hosted | — | Auth, database, storage |

**The three repos share code by copy, not by package.** See §4.4 — this is the single most
common way to break the system.

---

## 2. How a run starts

Four entry points, all converging on `app.js`:

| Path | Trigger | Notes |
|---|---|---|
| Portal | AE submits via the SPA → Worker `/submit` → GitHub Actions | The normal path. Arrives with the account already locked and the language already resolved |
| CLI | `node app.js "<name>" "<url>" --debug --cache` | Local, interactive |
| Batch | `node scripts/batch-run.js accounts.csv --concurrency=3` | CSV; the URL column is optional |
| Remote | `--remote` | Dispatches `run-pipeline.yml` via GitHub Actions, needs `GH_PAT` |

Plus the unattended path: a `cc-task-*.md` file picked up by `com.m4s.watcher`, which runs an
agent against this repo rather than running the pipeline itself.

### Run flags

| Flag | Effect |
|---|---|
| `--debug` | **Always include.** Structured debug log into `outputs/` |
| `--cache` | Use cached modules where available, skip the interactive prompt. Most common |
| `--fresh` / `--no-cache` | Force every module to re-run |
| `--no-contacts` | POV only — skips M2–M5. ~2 min and ~$0.50–1.00, versus $7+ for a full run |
| `--remote` | Run via GitHub Actions |
| `--home-language=<lang>` | 12 languages. Set on every portal run; the portal resolves language at domain-confirm time |
| `--whitespace-account-id=<sfdc id>` | Lock to a chosen whitespace account by Salesforce ID; skips all free-text matching |
| `--no-whitespace-data` | Net-new prospect, no whitespace record. **Mutually exclusive with the lock flag — both together exits 1** |

---

## 3. The pipeline

```
app.js  (orchestrator)
  │
  ├─ preflight.js            credential + config checks
  ├─ M1   01_company_pov.js          company POV + ICP score (7 signals)
  ├─ M1.5 m1-5-whitespace-enrichment.js   Figma commercial relationship for this account
  ├─ M2   02_persona_discovery.js    decision-makers, Apollo-first
  ├─ M3   03_enrichment.js           Apollo email enrichment
  ├─ M4   04_hooks.js                per-persona outreach hooks
  ├─ M5   05_sheets.js               Excel workbook
  ├─ M6   06_pdf_v2.js               PDF via Puppeteer  (06_pdf.js is the older generator)
  └─ M7   07_value_pyramid.js        value pyramid
```

Shared machinery: `research.js` (`callClaudeSDK()` plus research utilities), `scraper.js` (web
scraping, intelligence pipeline, distillation), `cache.js` (per-module TTL), `entity-check.mjs`
(per-document wrong-company pre-filter), `apollo.js` / `modules/lib/apollo-search.js`,
`whitespace-lookup.js`, `debug.js`.

`src/utils/` holds 24 pure helpers. The ones that carry correctness rules rather than plumbing:
`services-value`, `whitespace-total`, `whitespace-state`, `whitespace-claim-audit`,
`commercial-relationship`, `salesforce-id`, `domain-rank`, `language-detect`, `account-lock`,
`tier-enforcement`, `contact-reconciliation`, `text-sanitise`, `research-url`.

### 3.1 Prompts — the highest-value asset in the repo

| File | Role |
|---|---|
| `prompts/module1_system.txt` | M1 system prompt, `{{PLACEHOLDER}}` substitution |
| `prompts/psp_system.txt` | PSP system prompt, editable from the admin portal |
| `prompts/whitespace_data_guidance.txt` | Six state-gated blocks injected at `{{WHITESPACE_DATA_GUIDANCE}}` |
| `config/figma_expertise.md` | Figma product knowledge, **~53K tokens**, injected into M1 |
| `config/persona_discovery.md` | Champion/Coach tier calibration for M2 |

These are provider-agnostic text and survive any migration intact. The `figma_expertise.md`
injection is only affordable because of prompt caching — see §9.

---

## 4. Account identity — the correctness machinery

This is most of the hard-won logic in the repo, and it exists because getting it wrong produces
a confident brief about the wrong company.

### 4.1 Locking

A submission is locked to a **Salesforce account ID**, not free text. `lookupWhitespaceByAccountId`
does one exact-ID read; `lookupWhitespace` (free text) is the legacy path. `src/utils/salesforce-id.mjs`
widens 15-character IDs to 18 — `accounts` is 15-char and `whitespace.Id` is 18, and that mismatch
is what turned every `Id=like.<id>%` prefix match into a correct `Id=eq.`.

### 4.2 Domain choice

Two ordered questions: **which account**, then **which domain** — an explicit confirm for every
account, including single-domain ones. A selection returns `domain_confirmed: false` with every
domain on the record ranked, and a caller must treat that as an incomplete request.

`domain-rank` ranks: the Salesforce `Website` first (rule 0), then apex over subdomain, then a
domain label matching the account name, then the record's own order. It deliberately carries **no
public-suffix list** — a relative suffix comparison instead — so the portal does not become a
third copy of `apexDomain`.

Unattended paths (`account-lock.mjs`, `chooseDomain()`) have no confirm step, so the head of the
ranking is the answer.

### 4.3 Whitespace state

`src/utils/whitespace-state.mjs` owns `_meta.whitespace_data_state`, the single field the PDF and
the portal branch on. It keeps **"no whitespace record" separate from "a record measuring zero"**,
and holds `NO_WHITESPACE_SENTINEL`. `whitespace-total.mjs` is the one implementation of the TOTAL
WHITESPACE arithmetic and returns `null`, never `0`, for a brief with no whitespace section.

`services-value.mjs` counts the services figure **once per account**: `max(ARR × 0.25, 125000)` if
any trigger fired, zero if none did. Triggers are routes in and carry no money; `svc.value` is
deliberately never read, so re-rendering an old brief produces the corrected total.

### 4.4 The duplicated helpers

Three helpers exist as copies in more than one repo. **Change every copy in the same commit.**

| Helper | Copies | Where |
|---|---|---|
| `language-detect` | **3** | pipeline `src/utils/language-detect.mjs`, portal `src/lib/language-detect.ts`, worker `src/language-detect.js` |
| `services-value` | **2** | pipeline `src/utils/services-value.mjs`, portal `src/lib/services-value.ts` |
| `domain-rank` | **2** | pipeline `src/utils/domain-rank.mjs`, portal `src/lib/domain-rank.ts` |
| `whitespace-total` | **2** | pipeline `src/utils/whitespace-total.mjs`, portal `src/lib/whitespace-total.ts` |

Parity is asserted by `verify-language-detect-parity.mjs`, `verify-services-value-parity.mjs`,
`verify-whitespace-total-parity.mjs` and `verify-account-search-parity.mjs`. Several of those need
**all three repos checked out** to run.

### 4.5 Output-side backstop

`whitespace-claim-audit.mjs` runs two audits and **reports, never rewrites**:
- `auditSurfaces()` — walks non-customer claims and invented figures on `no_record` / `unknown`
- `auditSuppliedFigures()` — on a brief that HAS a commercial block, every Figma figure must appear
  verbatim in it (`unsupported_figure` / `rounded_figure` / `hedged_figure`)

`auditModeFor()` picks between them based on the block, not the state. Findings persist via
`claim-audit-persist.mjs` into `claim_audit_findings` plus a run row in `claim_audit_runs`; the
writer never throws, so a failed write logs and the run completes.

### 4.6 Kill switches

All default `true`. Set false to restore pre-cutover behaviour.

| Switch | Off means |
|---|---|
| `ENTITY_CHECK_ENABLED` | Restore the pre-cutover lexical wrong-company pre-filter in M1 |
| `QUERY_CONSTRUCTION_FIX_ENABLED` | Bare-name search queries instead of identity-aware ones |
| `COMMERCIAL_BLOCK_ENABLED` | M1/M4 write without the commercial record, as before 2026-08-26 |

---

## 5. The portal

React 19 + TypeScript 5.9 + Vite 8 + Tailwind 3.4 + Supabase. Deployed to GitHub Pages at
`/AccountResearcherPortal/`; push to `main` auto-deploys via `deploy.yml`, with `ci.yml` on the
same branch.

Conventions that are load-bearing:

- **Do not add new `lucide-react` imports.** Reuse icons already imported elsewhere.
- Single-file components preferred.
- Supabase client via `src/lib/supabase.ts`; auth in `src/context/AuthContext.tsx`; theme in
  `ThemeContext.tsx`; run-status polling in `StatusContext.tsx`; route guarding in
  `components/ProtectedRoute.tsx`.
- **`BrowserRouter` with `basename="/AccountResearcherPortal"`** — real paths, not hashes. Deep
  links depend on the `public/404.html` `?path=` shim, which is a GitHub Pages workaround.
- `VITE_WORKER_BASE` defaults to production. Point it at a local `wrangler dev` to exercise an
  endpoint that is not deployed yet.

`src/components/AccountSearch.tsx` is the type-ahead over the real whitespace book via the
Worker's `GET /account-search`. The account card renders eight fields off the `whitespace_accounts`
row. Tests in `domain-rank.test.ts` assert named accounts: Entur, Nets, LVMH, HSBC, Toyota.

---

## 6. The Worker

`~/M4S/cloudflare-worker/src/` — `worker.js`, `account-search.js`, `domain-check.js`,
`brief-files.js`, `admission.js`, `language-detect.js`.

Routes: `/submit`, `/account-search`, `/domain-check`, `/brief-file`, `/health`.

### Admission control

`admission.js` replaced a flat `MAX_CONCURRENT_RUNS = 2`. **Two gates, both must be open:**

1. A **3-token bucket** dripping **one token per 40 seconds** — a continuous drip, not a 120-second reset.
2. An **in-flight ceiling of 18**, counted from **GitHub's own job state**, not `runs.status` —
   because `runs.status` cannot see the `test.yml` runs the prompt editor fires.

Everything above the `── I/O ──` line in that file is pure and unit-tested. `test/admission.test.mjs`
holds **32 tests** pinning N=3, 1-per-40s, C=18, the continuous drip, which gate reports first, both
degraded paths, and the queue-drain arithmetic.

**`sql/admission-controller.sql` is APPLIED — verified 2026-09-20.** The table responds, the function
returns the expected shape, the `pipeline-runs` bucket row is live, and all seven behavioural checks
in `verify-admission-controller.mjs` pass. Three places in the repo described it as unapplied; they
were wrong and are now corrected. The bucket cannot live in Worker module scope: every request may
land in a fresh isolate and each would see three tokens, so the state has to be the atomic
`admission_try_consume()` in Postgres. The occupancy < 2 fallback remains in the code as a degraded
mode.

This repo has **no `CLAUDE.md` and no `.claude/` directory** — it never had agent instructions,
despite being load-bearing.

---

## 7. Data stores

### Supabase Storage

| Bucket | Visibility | Contents |
|---|---|---|
| `briefs` | **private** | Brief PDFs and debug events, read through the Worker's `GET /brief/:id/:artifact` |
| `whitespace-raw` | private | The Sigma CSV; service key only |
| `cc-reports` | **public on purpose** | Task reports opened from a Pushover notification with no session. **Do not change** |

`scripts/supabase-upload.mjs` returns the **object path**, not a URL, because `briefs` is private.
`verify-brief-file-paths.mjs` asserts the Worker's `storagePathFrom()` reads both column shapes
(pre-cutover public URL, post-cutover bare path) and refuses another bucket or a `..` segment.

### SQL — applied vs not

| File | Adds | State |
|---|---|---|
| `sql/whitespace-total-value.sql` | `runs.whitespace_total_value` | **Applied, verified 2026-08-29.** 262 of 346 rows hold a value |
| `sql/claim-audit-matched-briefs.sql` | Widens the `data_state` CHECK, adds `audit_mode`, `claimed_figure`, `supplied_value` | **Applied, verified 2026-08-29.** `claim_audit_findings` still empty, so the widened CHECK is untested in anger |
| `sql/whitespace-account-lock.sql` | `runs.whitespace_account_id` | Apply by hand; needed for queued runs to keep their lock |
| `sql/claim-audit-findings.sql` | Both audit tables + RLS | Apply by hand in the SQL Editor |
| `sql/admission-controller.sql` | `admission_bucket` + `admission_try_consume()` | **APPLIED — verified 2026-09-20** (the repo previously documented this as unapplied) |

`scripts/backfill-whitespace-total.mjs` backfills the first column. Dry by default, `--apply` to
write. No longer blocked — 84 of 346 rows are still empty.

---

## 8. Notion — and a defect

### 8.1 What the repo says

`prospect-research/CLAUDE.md` gives two page IDs and instructs every session, under
**Session startup**: *"Fetch the Notion To-Do List (page ID below) via Notion MCP. Do NOT use
Drive MCP or ask for a file upload."*

| Page as labelled in CLAUDE.md | ID |
|---|---|
| Pipeline To-Do List | `320b8b1f837c803e831cfc19f8635e0b` |
| Session Log | `320b8b1f837c81e79f70cc1e77d84a47` |

### 8.2 What those IDs actually resolve to — **verified 2026-09-20**

`320b8b1f837c803e831cfc19f8635e0b` is a page titled **"To Do List"** whose parent is
**"📁 cc-webui"** — a *different project*, the Claude Code browser UI. Its content is cc-webui's
backlog (code block styling, multi-session view, panel layout). **Last edited 2026-03-28**, almost
six months ago. That page links to a Session Log at exactly `320b8b1f837c81e79f70cc1e77d84a47`, so
both IDs belong to cc-webui.

**Every session that follows the startup instruction fetches the wrong project's abandoned
to-do list.** Nothing errors — the page exists and returns content — so the failure is silent.

### 8.3 The real Notion tree — verified 2026-09-20

| Page | ID | Notes |
|---|---|---|
| 📁 M4S — Research Portal | `32bb8b1f-837c-8101-b7a8-d05226733b77` | Parent |
| To Do List | `32bb8b1f-837c-8178-8242-c9d7e90ac597` | The real one. Active to at least 2026-08-24 |
| 📅 Session Handovers | — | e.g. "Session Handover — 2026-03-29" |
| 🔧 Setup & Config | — | "M4S — SETUP" |
| 📋 Specs & Design | — | Figma Make spec, Wave A performance spec |
| 🛠 CC Tasks — Completed | — | Archive of finished task specs |

Sub-pages of To Do List carry live work — "🔎 Account picker review — 3 CC tasks (2026-08-24)" is
the Nexi/Nets domain-lock review, three task specs, and a guard that the `whitespace` and
`accounts` tables must not be touched because they are hand-imported partial copies. That guard
was accurate on 2026-08-24 and is **now out of date** — those tables have since been dropped. See
§12.9.

**Whether this content is in the repo at all:** it is not. The Notion tree holds review findings,
task specs and session handovers that exist nowhere else.

---

## 9. Where Claude appears

Everything above is provider-agnostic except this.

| Surface | Detail |
|---|---|
| Runtime dependency | `@anthropic-ai/sdk ^0.78.0` in `package.json` |
| Client construction | **14 places across 7 files** — `scraper.js` (4), `research.js` (4), `04_hooks.js` (2), `m1-5-whitespace-enrichment.js` (1), `lib/apollo-search.js` (1), `entity-check.mjs` (1), `02_persona_discovery.js` (1). **There is no seam.** Counted 2026-09-20 with `grep -rc 'new Anthropic' modules src app.js`. An earlier figure of 10 across 4 files in this document was wrong — the command that produced it ended in `| head`, which caps output at 10 lines, and the truncation was read as the total |
| Server-side `web_search` | Tool defined at `research.js:114` and `:653` (`type: 'web_search_20250305'`). Response-block parsing at `research.js:23–141`. Used across **8 production files** |
| Server-side `web_fetch` | `scraper.js`, `text-sanitise.mjs` |
| Prompt caching | `cache_control` in `research.js`, `scraper.js`, `entity-check.mjs` — what makes the 53K-token `figma_expertise.md` injection affordable |
| Models | 157 references to `claude-sonnet-4-6`, 66 to `claude-haiku-4-5-*`, 32 to `claude-opus-4-6` |
| Key resolution | `callClaudeSDK()` checks `ANTHROPIC_API_KEY` first, **falls back to the macOS Keychain** (`security find-generic-password -s "Claude Code" -w`) |
| Extended-thinking runner | `scripts/extended-thinking-runner.mjs` — raw SDK, no filesystem, used by `cc-task-opus-*` and `cc-task-extended-*` |
| GHA secret | `ANTHROPIC_API_KEY` in `run-pipeline.yml` |

**Two keys, never conflated.** Keychain `Claude Code` is the **Figma SSO** key used by interactive
sessions and dies with the seat. `ANTHROPIC_API_KEY` in `.env` and as a GHA secret is the **project**
key used by pipeline runs. The fallback means a dead Keychain entry produces a silent 401 rather
than a loud failure.

`scripts/` holds roughly 441 files referencing `web_search`; the overwhelming majority are dated
experiments, not production code.

---

## 10. Integrations and credentials

Variable names only; values live in `~/M4S/prospect-research/.env`.

| Service | Variables | Used for |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | The pipeline's reasoning and search |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Auth, database, storage |
| SerpAPI | `SERPAPI_KEY` | Search — **already present and already used** |
| Apollo | `APOLLO_API_KEY` | Persona discovery and email enrichment |
| Enrichment | `ENRICHLAYER_API_KEY`, `AUTOBOUND_API_KEY`, `BUILTWITH_API_KEY`, `DIFFBOT_API_KEY` | Contact and company data |
| GitHub | `GH_PAT` | Remote runs, deploys |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_TASKS_FOLDER_ID` | Inbound task PDFs |
| Gmail | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Email task intake |
| Resend | `RESEND_API_KEY` | Mail |
| Pushover | `PUSHOVER_TOKEN`, `PUSHOVER_USER` | Notifications |
| Notion | OAuth via MCP | Session-start to-do fetch (see §8) |

Required: `ANTHROPIC_API_KEY`, `SERPAPI_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Everything
else is optional. Full detail in `docs/reference/api-integrations.md`.

---

## 11. Tests and local setup

```
npm test                    → node scripts/run-tests.mjs   (fixtures, no API calls)
npm run hooks:install       → git config core.hooksPath .githooks   (also runs via `prepare`)
npm run check:imports       → node scripts/check-pushed-imports.mjs --staged
```

Targeted verifiers, each asserting one correctness rule:

| Script | Asserts |
|---|---|
| `verify-services-count-once.mjs` | One services value; both PDF generators agree. Real briefs: Cint, Entur, Deloitte, Telstra, plus a one-trigger and a zero-trigger account |
| `verify-whitespace-total.mjs` / `-parity.mjs` | The total equals what both PDF generators draw; 12 synthetic cases plus all stored briefs |
| `verify-language-detect-parity.mjs` | Three copies agree over the whole map and all **35,529** domains in `account_domains` |
| `verify-account-search-parity.mjs` | Worker, pipeline and portal ranking agree. **Needs all three repos** |
| `verify-whitespace-lock.mjs` | Locked vs unlocked resolution on the known wrong-company cases |
| `verify-commercial-block.mjs` | Pre-M1 block and M1.5's locked lookup agree on row and figures |
| `verify-whitespace-states.mjs` | Both PDF generators in all five whitespace states, none blank. **Not in `npm test`** — loads Puppeteer |
| `verify-admission-controller.mjs` | Live in-flight count, whether the SQL is applied, what a submission now would get |
| `verify-ae-role-endpoints.mjs` | `/account-search` + `/domain-check` under a real AE JWT, not just the admin |
| `verify-submit-cutover.mjs` | Submit end to end. **Spends credits and dispatches real runs** — `--dry` first |
| `submission-lock-split.mjs` | How every run resolved its account: locked / declared-absent / free text |
| `services-total-restatement.mjs` | Read-only: every stored brief whose total moves, before → after |
| `claim-audit-stats.mjs` | Per-detector hit counts over a date range, with the denominator |

**Pre-push import guard.** `.githooks/pre-push` fails any push where a JS/MJS/TS file imports a
relative path not tracked in the commits being pushed — the `3d0c458` / `5b75e7d` failure mode,
where an import works locally off an untracked file and dies on a clean checkout. Bypass with
`SKIP_IMPORT_CHECK=1 git push`.

**Deploy.** `/deploy` skill, or by hand: source `.env` for `GH_PAT`, embed it in the remote URL,
push, strip it. Claude Code runs as a LaunchAgent **without Keychain access**, which is the whole
reason for the embed-then-strip dance.

---

## 12. Scar tissue

**12.1 The wrong domain on the right account.** Whitespace record `001PX00000QVdcQYAT` is Nets
(Denmark, 3,351 employees, owner George Harding), with `DOMAINS__C` =
`nexigroup.com,external.nexigroup.com,nets.eu` and ZoomInfo ultimate parent Nexi SpA. Salesforce
`Website` on the same ID is `www.nets.eu`. A "Nexi" query matched legitimately, but the picker
locked the **parent's** domain — so research would run against Nexi Group SpA in Milan while the
CRM record is Nets Denmark. This is why rule 0 of `domain-rank` is the Salesforce `Website`.

**12.2 1,010 accounts pointing at the wrong site.** `primary_domain` — the first entry in the
`DOMAINS__C` cell — was being taken silently. For 1,010 accounts it pointed somewhere Salesforce
does not consider theirs. Hence the explicit domain-confirm step on **every** account.

**12.3 Four ARR values on one row, same load.** `ARRORG__C` 36,060 (what the picker rendered as
"$36K"), `FORECASTED_ARR_EOM` 34,702, `ACTUAL_CURRENT_ARR_DS` 29,160, `Calculated ARR` 22,200. If
the brief reads a different field to the picker, the two disagree about the same account.

**12.4 Six copies, six answers.** The TOTAL WHITESPACE arithmetic was inlined in six places and
produced six different numbers. Now one helper, with a parity script asserting both PDF generators
agree over every stored brief.

**12.5 Absence read as zero.** `whitespace_account_id: null` was indistinguishable from a failed
lookup, and "no whitespace record" is not the claim "no Figma usage". Rendering unknown as `$0`
tells an AE the account has no opportunity when nobody has looked. Hence the tri-state, the
sentinel, and `whitespace-total` returning `null` rather than `0`.

**12.6 15 vs 18 character Salesforce IDs.** `accounts` is 15-char, `whitespace.Id` is 18. Every
lookup was a `Id=like.<id>%` prefix match. `toEighteenCharId` made them `Id=eq.`.

**12.7 The import that worked locally.** Commits `3d0c458` and `5b75e7d` passed locally because the
imported file existed on disk untracked, and died on a clean checkout. Hence the pre-push guard.

**12.8 Drive result delivery retired 2026-03-28.** Results now go to Supabase `cc-reports` and the
public URL goes into the Pushover notification. Drive is still used for *inbound* task PDFs only.
`cc-watcher.sh` and `drive-watcher.sh` remain on disk but are orphaned — no LaunchAgent.

**12.9 A guard that outlived its tables.** A standing guard, recorded 2026-08-24, said the
`whitespace` and `accounts` tables were hand-imported partial copies and must not be touched.
**Both tables have since been dropped** — `sql/whitespace-legacy-rename.sql` then
`sql/whitespace-legacy-drop.sql`. Verified 2026-09-20: both return 404.

The live tables are `whitespace_accounts` (21,636 rows) and `account_domains` (35,529 rows — the
figure `verify-language-detect-parity.mjs` asserts against), written through staging tables and an
atomic `whitespace_swap` in `sql/whitespace-loader.sql`. The guard's *intent* survives: the data is
loader-managed, so run the loader rather than writing rows directly, and hand schema changes back
as SQL for the dashboard editor rather than running DDL from a terminal.

The guard was carried verbatim into this document, two Notion pages and the Worker's `AGENTS.md`
before anyone probed the database. It is the third stale claim this migration has propagated by
trusting a document over a live check — after the `gh` auth rule and the admission-controller SQL.
The pattern is the point: **a document asserting the state of a deployed system is a claim, not a
fact.**

---

## 13. Things a rebuild must decide

1. **`web_search` has no drop-in replacement.** `SERPAPI_KEY` is already configured and
   `scripts/serpapi-websearch-sidebyside.mjs` already exists to compare the two. The open question
   is whether SerpAPI plus `scraper.js` holds M2 discovery quality.
2. **Prompt caching and the 53K-token injection.** Measure cost per brief before assuming
   `figma_expertise.md` can still ship whole.
3. **The quality guardrails are calibrated to Claude's citation shape.** `entity-check` and
   `whitespace-claim-audit` will need recalibrating, and `claim-audit-stats.mjs` is the instrument.
4. **The Keychain fallback.** It converts a dead credential into a silent 401.
5. **The Notion IDs in `CLAUDE.md` are wrong** (§8.2). Whatever replaces that file needs the real
   ones, and the session-start instruction needs to point at `32bb8b1f-837c-8178-8242-c9d7e90ac597`.
6. ~~`cloudflare-worker` has no agent instructions~~ — **resolved 2026-09-20**: `AGENTS.md` written, covering the pinned constants, the applied SQL, the duplicated helper and the standing guards.
7. ~~`sql/admission-controller.sql` is unapplied~~ — **resolved 2026-09-20**: it was already applied; the docs were stale.
