<h1 align="center">Publishing Royalties for Claude Code</h1>

<p align="center">
  <strong>The open-source publishing contracts, rights and royalties system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Klopotek data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=klopotek">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/klopotek?utm_source=github&utm_medium=readme&utm_campaign=klopotek">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-klopotek">Instead of Klopotek</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Publishing Royalties for Claude Code does the job you pay Klopotek for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Klopotek dashboard cannot.

Klopotek prices its cloud privately. The offers it publishes for members of publishers' associations start at US$400 a month for two full users and one read-only user, plus US$75 a month for every additional user ([Klopotek IBPA cloud offer](https://www.klopotek.com/ibpa-cloud-offer), checked 2026-11-13). That is US$4,800 a year before the team grows, and those are the discounted prices.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=klopotek).

It is built for independent book publishers in New Zealand and Australia: imprints, works and editions, author contracts with escalating royalty rates by format and channel, advances on signing, delivery and publication, sub-rights deals and the income they bring, distributor sales, and the six-monthly royalty run that turns all of it into statements and payments. It keeps the paperwork straight as it goes: legal deposit to the national library, withholding on overseas authors, GST on registered ones, and the statement deadline in every contract.

### Ten questions it answers on day one

1. Which statements are past the deadline in the author's contract, and by how many days?
2. Which advances are now due because the manuscript was delivered or the book published, and are still unpaid?
3. How much advance is still unearned across the list, and which of those titles sold nothing in the last 90 days?
4. Which paperbacks crossed their royalty escalator this period, and how many copies sold at the higher rate?
5. Which overseas authors are we withholding the full default rate from because no treaty rate is recorded?
6. Which GST-registered authors are being paid GST with no written agreement on file?
7. Which print editions published in the last year have not gone to the national library, and when was each due?
8. Which out-of-print titles have passed the reversion period in their contract?
9. Which rights payments are overdue from licensees, and what is the author's share of each?
10. Which sales are earning nothing because the contract has no rate for that format or channel?

### Your first hour: ten things to ask for

1. "What needs my attention today?" (`/attention`)
2. "Run the royalty statements for S2 as a dry run." (`/royalty-run`)
3. "Show me Mere Paki's statement line by line." (`/statements`)
4. "Which advances haven't earned out?" (`/unearned`)
5. "Which advances are due now?" (`/advances`)
6. "Are we compliant on legal deposit and tax?" (`/compliance`)
7. "What rights are still available on The Salt Road?" (`/rights-available`)
8. "What are we publishing in the next four months?" (`/schedule`)
9. "Draft the cover letter for Rosa Delgado's statement." (`/draft-statement-letter`)
10. "Add a field for the agent's commission rate to every contract." (`/customise`)

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/publishing-royalties-for-claude-code.git
cd publishing-royalties-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo publisher has two imprints, nine works and ten contracts, with one royalty period already paid and the next one due: a statement past its 30-day contract deadline, an advance due and unpaid, a late manuscript, a book publishing in 60 days with an unsigned contract, a missed legal deposit, a reversion clause gone live, overdue rights income, audio sales with no contract rate, and a GST-registered author with no tax invoice agreement.

`npm run view` writes the dashboards (this week, royalty position, rights, schedule) to `views/`. `npm run docs` writes royalty statements, remittance advices and advance information sheets to `docs-out/`, in your brand from `brand.json`.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/add` | Add an imprint, contributor, work, edition, contract, advance, rate, rights deal, income, sale or period from a plain description. |
| `/advances` | Advance instalments: paid, due and overdue. |
| `/attention` | Everything that needs the publisher today, in one list. |
| `/audit` | What changed recently and on which record. |
| `/card` | Show the full record for one work, edition, contract, contributor, deal or statement. |
| `/compliance` | Check the records against the rules in docs/compliance.md (legal deposit, withholding, GST on royalties, statement deadlines) and report what is breached, due or missing, with the rule cited. |
| `/contracts` | List author contracts, or show one contract's rates and position. |
| `/contributors` | Authors, illustrators and estates, with tax residence, GST and treaty details. |
| `/customise` | Make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it. |
| `/draft-rights-chase` | Draft a note to a licensee whose rights payment has not arrived. |
| `/draft-statement-letter` | Draft the cover note that goes with an author's royalty statement. |
| `/draft-weekly-review` | Save the Monday review as a draft file. |
| `/editions` | Every edition with lifetime sales, the last 90 days and receipts. |
| `/export` | Export every record to CSV and one JSON snapshot. |
| `/import` | Bring titles, contracts and sales across from Klopotek or another system. |
| `/legal-deposit` | Legal deposit: which published print editions have gone to the national library, and which are due or late. |
| `/manuscripts` | Manuscripts due and late. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/pay` | Record that royalty payments or advances have been paid. |
| `/rates` | Show the royalty rates on one contract, including escalators. |
| `/reversions` | Contracts where the author can ask for rights back, and requests in progress. |
| `/rights-available` | Which rights are still free to sell, work by work. |
| `/rights` | Every sub-rights licence, what it has paid and what is still owed. |
| `/royalty-run` | Run the royalty statements for a closed period, check them, and approve them. |
| `/sales` | Sales by edition and channel, for a work, an edition or a royalty period. |
| `/schedule` | The publishing schedule: what is coming out, with contract and manuscript state. |
| `/statements` | List statements by period, status or contract, or show one statement line by line. |
| `/titles` | List every work with its imprint, status, editions and contributors. |
| `/unearned` | Advances not yet earned out, contract by contract. |
| `/update` | Change a field on a record: dates, prices, status, tax details, statement days. |
| `/weekly-review` | The Monday review: what needs attention, statements still to go out, the schedule and the unearned advances. |

Every command drives one CLI: `node scripts/royalties.mjs help`.

## Instead of Klopotek

Three files come across, in order: your title list as an ONIX export (`import onix`), your royalty schedule with each contract's carried balance as CSV (`import contracts`), and your sales as CSV (`import sales`). Each has a dry run, and a carried balance means your first statement here picks up exactly where the last one left off. The guide, including what does not come across (statement history, the author portal): [docs/replace-klopotek.md](docs/replace-klopotek.md).

The rules the compliance checks enforce, with sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
publishing-royalties-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Publishing Royalties for Claude Code for your business, migrates your Klopotek data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=klopotek)
- Read more: [enterprisedna.co/omni/instead-of/klopotek](https://enterprisedna.co/omni/instead-of/klopotek?utm_source=github&utm_medium=readme&utm_campaign=klopotek)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
