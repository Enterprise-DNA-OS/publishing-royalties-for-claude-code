---
description: "List statements by period, status or contract, or show one statement line by line."
---

# statements

Run `node scripts/royalties.mjs statements [--period=] [--status=draft|approved|sent|paid] [--contract=] --json`. For one statement, `node scripts/royalties.mjs statement <ref> --json` gives every line: edition, channel, basis, rate, units and royalty. A negative carry forward is advance not yet earned out.
