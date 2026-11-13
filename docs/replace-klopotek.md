# Moving off Klopotek

Three things come across: your title list, your contracts with their rates and balances, and your sales history. Do them in that order, each with a dry run first. Plan a day for a small list, longer if your contracts have unusual clauses.

The same steps work from any other royalty system or from the spreadsheets many publishers keep: only the column names change.

## 1. Titles: an ONIX export

Klopotek produces ONIX for your metadata feeds (its Metadata Export Manager). Export your full list as ONIX 3.0, one file per imprint.

```bash
node scripts/royalties.mjs add imprint --ref=KSP --name="Your Imprint" --country=NZ --currency=NZD
node scripts/royalties.mjs import onix --file=titles.xml --imprint=KSP --dry-run
```

What maps: ISBN-13 (ProductIDType 15), the title, the product form (BB hardback, BC paperback, ED and EA ebook, AJ and AN audio), the publication date (role 01) and the price in the imprint's currency. Editions with the same title become one work. Running it again updates prices and dates on ISBNs already loaded.

What does not: descriptions, contributors' biographies, subjects and supply detail stay in your ONIX system. ONIX 2.1 short tags are not read; export with reference tags.

## 2. Contracts: the royalty schedule

Run a report of every contract's royalty lines from Klopotek's reporting (or copy your royalty spreadsheet) and save it as CSV, one row per rate line:

| Column | Example | Notes |
|---|---|---|
| Contract | K-201 | your contract number |
| Title | Harbour Bells | must match a title from step 1 |
| Contributor | Ana Ruru | created if new; fill in tax details after |
| Signed | 2025-11-02 | blank leaves the contract as a draft |
| Share | 100 | the payee's share, for co-authors |
| Format | Paperback | hardback, paperback, ebook, audio |
| Channel | Home | home or export |
| Basis | RRP | RRP or net receipts |
| Rate | 10 | percent |
| From units | 3000 | where an escalator starts; 0 for the first rate |
| Balance | -1500.00 | the balance carried on the last statement you sent: negative is unearned advance |
| Balance date | 2026-01-31 | the end of that statement's period |

```bash
node scripts/royalties.mjs import contracts --file=schedule.csv --dry-run
```

Different column names take a small mapping file: `--mapping=map.json` with `{"contract": "Contract No", "rate": "Royalty %"}`.

The balance is what makes the switch clean: the first statement you run here opens with it, and only advances paid after the balance date are counted again. Then add what the schedule does not carry: advance instalments still to pay (`add advance`), sub-rights shares (`add share`), statement days and reversion clauses (`set contract`), and each contributor's tax residence, GST registration and treaty rate (`/contributors`).

## 3. Sales

Load the sales your distributors and retailers report, from the balance date forward, as CSV with ISBN, date, channel, units and net receipts. Returns are negative units. A channel naming the imprint's own country (or "home", "domestic") is home; anything else is export.

```bash
node scripts/royalties.mjs import sales --file=sales.csv --dry-run
```

A repeat import skips rows already loaded, so you can load each month's file as it arrives. If you want escalators to count copies sold before the switch, set the edition's lifetime units: `set edition <ref> --prior-units=4800`.

## 4. Check, then run

```bash
node scripts/royalties.mjs add period --ref=2026-H2 --name="July to December 2026" --starts-on=2026-07-01 --ends-on=2026-12-31
node scripts/royalties.mjs run-statements 2026-H2 --dry-run
```

Compare the dry run with the last statements Klopotek produced for the same contracts before you approve anything.

## What does not come across

- **Statement history.** Past statements stay in Klopotek or as PDFs. Only the closing balance carries over, which is all the next statement needs.
- **The author portal.** Statements here are documents you send (`npm run docs -- royalty-statement`). A portal where authors log in is something Enterprise DNA builds into a customised version.
- **Editorial workflow, production schedules and ONIX feeds out.** This system reads ONIX; it does not send it to retailers.
- **Multi-currency rights income.** Record rights income in the imprint's currency at the rate you banked it.
