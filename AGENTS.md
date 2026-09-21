# AccountResearcherPortal - agent instructions

React SPA for Figma AEs to submit account research requests, view briefs, and manage territory.
Deployed to GitHub Pages at `/AccountResearcherPortal/`.

This repo is the front door to the Account Researcher system. The load-bearing work is not just UI:
it locks the Salesforce account, forces an explicit domain choice, and passes enough state for the
pipeline to avoid free-text rematching.

---

## Commands

```bash
npm run dev
npm run build
npx tsc --noEmit
npm test
npm run lint
```

For the migration gate, `npm run build` and `npx tsc --noEmit` are Tier 1. `npm run lint` is known
red as of 2026-09-20 with 195 pre-existing problems, mostly `no-explicit-any`; use it for
before/after comparison, not as proof that a migration change broke the portal.

After UI or frontend behavior changes, run `npm run build`. The site is deployed from the built Vite
app, not a dev-server session.

---

## Non-Negotiables

- **Routing is real paths.** Keep `BrowserRouter` with `basename="/AccountResearcherPortal"`.
  GitHub Pages deep links depend on `public/404.html` rewriting to `?path=...`; switching to hashes
  or removing the shim breaks shared links.
- **Do not add new `lucide-react` imports.** Reuse icons already imported in the codebase. This rule
  exists to keep the bundle and visual language from drifting one icon at a time.
- **The Worker URL defaults to production.** Set `VITE_WORKER_BASE=http://127.0.0.1:8791` only when
  exercising a local `wrangler dev` endpoint. The Worker needs `CORS_ORIGIN=http://localhost:5173`
  in `.dev.vars` for that path.
- **Do not bypass the account picker.** Submit uses `AccountSearch`: a real `whitespace_accounts`
  row plus an explicit domain confirmation. Free-text company/website entry was the failure mode.
- **`domain_confirmed: false` means incomplete.** This is true even when only one domain is present;
  the old silent `primary_domain` choice pointed many accounts at a parent, subsidiary or mail host.
- **Unknown is not zero.** `--no-whitespace-data` / `no_whitespace_record` means there is no
  whitespace record. Render unknown usage as unknown, not `$0`.

---

## Design And UI Rules

This is an operational app for AEs and managers, not a marketing site. Make dense, scannable states
with restrained styling.

- Use existing CSS variables from `src/index.css`; do not invent one-off colors.
- Dark theme is the default and should be checked first.
- Keep panels at 8px radius or less unless the local pattern already says otherwise.
- Prefer unfilled chips with visible borders over low-contrast fills.
- Use `var(--accent)` for selected items, not for generic container decoration.
- Keep single-file components unless the code is genuinely becoming hard to follow.
- Text in cards, chips and buttons must fit at mobile widths without overlap.

For any M4S UI, visual, frontend, styling, token, table, chart, form, nav, badge, spacing, mockup or
design-review work, explicitly apply the `m4s-design-system` prompt port before editing. Codex
prompts do not auto-fire.

---

## Account Picker Semantics

`src/components/AccountSearch.tsx` asks two ordered questions:

1. Which account: select a `whitespace_accounts` row and lock the submission to its Salesforce ID.
2. Which domain: rank every domain and require the AE to confirm the one to research.

`src/lib/domain-rank.ts` is one of two copies of domain ranking. Rule 0 is the Salesforce `Website`;
then apex/shadowed relationship, account-name match and record order. It deliberately avoids a
public-suffix parser so the portal does not become another copy of the pipeline's `apexDomain`.

The account card must keep identity and measured values distinct:

- Owner and Salesforce link sit under the name because owner catches a wrong account quickly.
- Segment, region and employees are categorical chips.
- ARR, total whitespace, full seats and dev seats are the four metric slots.
- `src/lib/account-format.ts` renders `-` for null and the figure for zero. Collapsing them tells
  an AE the account was measured at zero when nobody has measured it.

The advisory domain check calls the Worker's `POST /domain-check`. It annotates options but never
picks, reorders or blocks. Passing rows have no chip; wrong-company gets red; `not_a_website` and
`couldnt_check` are neutral hairline chips. The description describes the site, not why the model
believes it passed.

---

## Duplicated Helpers

These helpers are copied by hand across repos. **Every copy changes in the same commit.**

| Helper | Copies |
|---|---|
| `language-detect` | portal `src/lib/language-detect.ts`; pipeline `src/utils/language-detect.mjs`; worker `src/language-detect.js` |
| `services-value` | portal `src/lib/services-value.ts`; pipeline `src/utils/services-value.mjs` |
| `domain-rank` | portal `src/lib/domain-rank.ts`; pipeline `src/utils/domain-rank.mjs` |
| `whitespace-total` | portal `src/lib/whitespace-total.ts`; pipeline `src/utils/whitespace-total.mjs` |

Run the parity scripts from `~/M4S/prospect-research` after touching them. A one-copy edit can make
the UI and generated brief disagree about the same account.

---

## Briefs, Storage And API Boundaries

- The portal talks to Supabase via `src/lib/supabase.ts`, auth through
  `src/context/AuthContext.tsx`, theme through `ThemeContext.tsx`, run polling through
  `StatusContext.tsx`, and route protection through `components/ProtectedRoute.tsx`.
- Brief PDFs and debug events live in the private `briefs` bucket. Do not turn stored paths into
  direct public links; read them through the Worker route that signs or streams the object.
- `cc-reports` is public on purpose in the pipeline system because Pushover report links must open
  without a logged-in browser session. Do not generalize that visibility to `briefs`.
- `VITE_WORKER_BASE` unset means production Worker. Be explicit when testing local Worker changes.

---

## Layout

| Path | Role |
|---|---|
| `src/pages/` | Route-level pages: Submit, MyBriefs, BriefView, Territory, Admin, Preview |
| `src/components/` | Shared UI: Layout, Sidebar, StatusBadge, AccountSearch |
| `src/context/` | Auth, theme and status providers |
| `src/hooks/` | Custom hooks |
| `src/lib/` | Supabase, account formatting, submissions and copied helpers |
| `public/404.html` | GitHub Pages deep-link shim |
| `vite.config.ts` | Base path `/AccountResearcherPortal/` |

`/preview/account-search` is an admin-only review harness. It exercises live account-search and
domain-check endpoints but cannot submit a run.

---

## Deploy

Push to `main` triggers the GitHub Pages workflow. Before pushing, run the build/typecheck gate and
confirm the actual branch and SHA. Never force-push to paper over a failed deploy. If a task runner
or LaunchAgent context ever needs `GH_PAT` in the remote URL, inject it only for the push and strip
it immediately afterwards; those contexts do not have Keychain access.

---

## Related Repos

| Repo | Why it matters |
|---|---|
| `~/M4S/prospect-research` | Pipeline, prompts, SQL, parity verifiers and generated briefs |
| `~/M4S/cloudflare-worker` | Authenticated API, account search, domain check, brief serving and admission control |

Architecture and history live under the M4S - Research Portal Notion tree. Fetch pages immediately
before updating them; do not trust older copied IDs without verification.

---

## The account picker, in detail

**How the domain ranking works** — `src/lib/domain-rank.ts`, in order:

1. The Salesforce `Website` host. If it matches a candidate, or is a parent/child of one, that
   candidate wins.
2. Apex over subdomain where both are on the record.
3. A domain label matching the account name.
4. The record's own order.

It deliberately carries **no public-suffix list** — a relative suffix comparison instead — so the
portal does not become a third copy of `apexDomain`. `domain-rank` is one of the helpers duplicated
in the pipeline; **both copies move together or the two disagree about the same account.**

**What the advisory domain check does** — it calls the Worker's `POST /domain-check`, which fetches
the domain's root URL, reads the `<title>` and meta description, and asks a model whether the page
presents itself as that company. A fetch or model failure reads "couldn't check" — it never guesses.

It is **advisory only**: it annotates, and must never pick, reorder or block a domain option.
**A passing row carries no chip at all** — the absence *is* the pass. That is the part a
well-meaning UI change breaks, by adding a green tick and making silence look like a missing check.
