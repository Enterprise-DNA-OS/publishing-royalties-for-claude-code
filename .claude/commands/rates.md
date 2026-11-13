---
description: "Show the royalty rates on one contract, including escalators."
---

# rates

Run `node scripts/royalties.mjs rates <contract> --json`. Explain each format and channel: the basis (RRP or net receipts), the rate, and where an escalator starts. To add or change a rate: `node scripts/royalties.mjs add rate --contract=<ref> --format=paperback --channel=home --basis=rrp --rate=10 [--from=5000]` after the operator confirms the clause.
