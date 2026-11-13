---
description: "Run the royalty statements for a closed period, check them, and approve them."
---

# royalty-run

1. `node scripts/royalties.mjs periods --json` to find the period. Statements run only after a period has closed and in period order.
2. `node scripts/royalties.mjs run-statements <period> --dry-run --json` and show the operator each contract's earnings, balance and payment, plus every warning (sales with no contract rate, rights income with no author share).
3. Fix warnings with the operator first (`/rates`, `add share`), then run `node scripts/royalties.mjs run-statements <period> --json`. Drafts can be rerun; approved statements are kept.
4. Walk through any statement the operator wants to check with `node scripts/royalties.mjs statement <ref> --json`.
5. `node scripts/royalties.mjs approve <statement|period>` only on the operator's yes. Then `npm run docs -- royalty-statement` and `npm run docs -- remittance-advice` render the paperwork. Sending is done by a person; record it with `node scripts/royalties.mjs mark-sent <statement|period> --date=YYYY-MM-DD`.
