# Knowledge base

## What this is

Working knowledge exported from Claude before that tooling was retired. It is **context, not
code** — nothing here runs. It exists so an agent picking up this repo does not have to
re-derive six months of decisions.

## How to use it

`AGENTS.md` at the repo root is the instruction file — read that first, every session. This
folder is what it points at when you need the reasoning behind a rule.

**Two cautions, both learned the hard way during the migration:**

1. **These notes record what was true when written.** If one names a file, function, flag or
   table, check it still exists before acting on it. Four claims in this set were found stale by
   probing the live system — a dropped table, an auth status, an applied migration, and a count
   that came from a truncated command.
2. **An index line is a pointer, not a source.** Read the file, not the one-line summary of it.
   A rule was reversed in a memory file and its index entry was never updated; the stale version
   then propagated into four documents.

## Layout

| Path | What |
|---|---|
| `AS-BUILT.md` | Current-state spec across all three Account Researcher repos |
| `NOTION-INDEX.md` | Verified Notion page IDs |

The fuller set — distilled sessions, the quality baseline, the exported memory notes — lives in
`~/M4S/prospect-research/docs/knowledge/`. Several verification scripts need more than one of
these repos checked out side by side, so it is worth having them all.
