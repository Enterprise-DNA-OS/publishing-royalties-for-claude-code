---
description: "Bring titles, contracts and sales across from Klopotek or another system."
---

# import

Read `docs/replace-klopotek.md` first. Order matters: titles, then contracts, then sales.

1. Titles: `node scripts/royalties.mjs import onix --file=<titles.xml> --imprint=<ref> --dry-run --json`.
2. Contracts and rates: `node scripts/royalties.mjs import contracts --file=<schedule.csv> --dry-run --json`. Each contract's carried balance needs the date it was struck.
3. Sales: `node scripts/royalties.mjs import sales --file=<sales.csv> --dry-run --json`. A repeat import skips rows already loaded.

Show the counts and warnings from each dry run. Different column names take `--mapping=<file.json>`. Run without `--dry-run` only when the operator says go. Then `/contributors` to fill in tax residence and GST details for anyone new.
