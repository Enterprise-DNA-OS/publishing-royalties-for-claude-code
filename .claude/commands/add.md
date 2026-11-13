---
description: "Add an imprint, contributor, work, edition, contract, advance, rate, rights deal, income, sale or period from a plain description."
---

# add

Work out the record type and fields from what the operator said, then run `node scripts/royalties.mjs add <type> --field=value ...`. Percentages are typed as percentages (`--share=50`, `--treaty-rate=10`); money in dollars (`--amount=5000`). Rates: `add rate --contract= --format= --channel= --basis= --rate= [--from=]`. Sub-rights shares: `add share --contract= --right= --share=`. Show the new record with `/card`. If a name is ambiguous, list the candidates and ask.
