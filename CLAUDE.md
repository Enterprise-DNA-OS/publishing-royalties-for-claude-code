# Publishing Royalties for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs me today? | `/attention` |
| List the titles | `/titles` |
| How is an edition selling? | `/editions` |
| Show a contract and its rates | `/contracts` |
| Who are our authors, and their tax details? | `/contributors` |
| What are the rates on a contract? | `/rates` |
| Which advances are due or paid? | `/advances` |
| What has not earned out? | `/unearned` |
| Run the royalty statements | `/royalty-run` |
| Show statements or one statement | `/statements` |
| Record a payment | `/pay` |
| Sales for a title or period | `/sales` |
| Rights deals and income | `/rights` |
| What rights can we still sell? | `/rights-available` |
| What are we publishing soon? | `/schedule` |
| Which manuscripts are late? | `/manuscripts` |
| Legal deposit | `/legal-deposit` |
| Reversions | `/reversions` |
| Are we compliant? | `/compliance` |
| Monday review | `/weekly-review` |
| Save the Monday review | `/draft-weekly-review` |
| Cover letter for a statement | `/draft-statement-letter` |
| Chase a licensee for payment | `/draft-rights-chase` |
| Add a record | `/add` |
| Change a field | `/update` |
| Show one record | `/card` |
| What changed? | `/audit` |
| Bring data across from Klopotek | `/import` |
| Export everything | `/export` |
| Change a field, rule or stage | `/customise` |
| Add a dashboard page | `/new-view` |

If an ask fits nothing here, run the CLI directly (`node scripts/royalties.mjs help`) and then propose a new command for it.

## House rules for a publisher

- Royalty figures, advances and tax details are private to the author they belong to. Never put one author's numbers in another's draft.
- A statement is approved only on the operator's yes, after a dry run they have seen. Approved statements are never edited: fix the record and run the next period.
- Record a payment, a deposit or rights income only when the operator confirms it happened, with the date it happened.
- Contract terms come from the contract. If a rate, share or clause is not recorded, ask; never assume an industry default.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Klopotek.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/klopotek
