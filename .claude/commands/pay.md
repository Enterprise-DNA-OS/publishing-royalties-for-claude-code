---
description: "Record that royalty payments or advances have been paid."
---

# pay

For statements: `node scripts/royalties.mjs mark-paid <statement|period> [--date=YYYY-MM-DD]` (only sent statements with a payment due). For advances: `node scripts/royalties.mjs pay-advance <ref> [--date=]`. Record a payment only when the operator confirms the money has left the account. Then run `/attention` to show what is still owed.
