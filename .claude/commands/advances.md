---
description: "Advance instalments: paid, due and overdue."
---

# advances

Run `node scripts/royalties.mjs advances --unpaid --json` (or without `--unpaid` for the full list). An instalment falls due `advance_due_days` after its trigger (signing, delivery of the manuscript, publication). Record a payment with `node scripts/royalties.mjs pay-advance <ref> [--date=YYYY-MM-DD]` only when the operator confirms the money has gone.
