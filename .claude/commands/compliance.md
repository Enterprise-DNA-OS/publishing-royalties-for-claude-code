---
description: Check the records against the rules in docs/compliance.md (legal deposit, withholding, GST on royalties, statement deadlines) and report what is breached, due or missing, with the rule cited.
---

1. Read `docs/compliance.md`. Each rule has its source, what a breach looks like in the records, and the check that finds it.
2. Run `node scripts/royalties.mjs compliance --json`. States: breach, due, check (a detail is missing), info, ok.
3. Report as a table: rule, item, state, detail, source. Breaches first.
4. For each breach, propose the fix the operator approves: record a deposit (`deposit <edition>`), record a GST agreement date and number (`set contributor <ref> --agreement=YYYY-MM-DD --gst-number=...`), record a treaty rate once residence is evidenced (`--treaty-rate=10`), or run the overdue statement (`/royalty-run`). Never send anything.
5. If a rule in `docs/compliance.md` looks out of date, say so and stop. Do not guess at tax or deposit law. The operator confirms the current rule, then you update the doc, the `jurisdictions` row and the check together in a new migration.

Nothing here is tax or legal advice. The checks show the records against the rules the publisher has told the system to watch, with sources, so problems surface before a statement goes out.
