---
description: "Sales by edition and channel, for a work, an edition or a royalty period."
---

# sales

Run `node scripts/royalties.mjs sales [--work=] [--edition=] [--period=] --json`. Returns are negative units. To load a distributor file use `/import`; to add one line by hand: `node scripts/royalties.mjs add sale --edition=<ref or ISBN> --sold-on=YYYY-MM-DD --channel=home|export --units=N [--receipts=]`.
