#!/usr/bin/env node
// npm test: a temporary embedded database, the migration, the demo data, every command, the royalty
// arithmetic and the rules that keep the records honest. Runs on Windows and Linux. Prints PASS or exits 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { execute, allocate, addWorkingDays, addMonths } from './royalties.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'publishing-royalties-test-'));
process.env.DATABASE_URL = '';
process.env.DATA_DIR = path.join(scratch, 'db');
process.env.OUTPUT_DIR = path.join(scratch, 'output');
const db = await getDb();
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} ${name}`); };
const run = (...args) => execute(db, args);
const bad = (args, re) => assert.rejects(() => run(...args), re);
const q = (sql, p) => db.query(sql, p);
const fixture = (name, text) => { const p = path.join(scratch, name); fs.writeFileSync(p, text); return p; };
const st = async (ref) => (await q('select * from statements where ref = $1', [ref]))[0];
const n = (v) => Number(v);
let closed = false;
try {
  await test('migration and seed are repeatable', async () => {
    assert.equal((await migrate(db)).ran.length, 1);
    assert.equal((await migrate(db)).ran.length, 0);
    await seed(db); await seed(db);
    assert.equal((await run('titles')).length, 9);
    assert.equal((await run('contracts')).length, 10);
    assert.equal((await run('statements', '--period=S1')).length, 5);
  });

  await test('every read command returns records', async () => {
    for (const c of ['titles', 'editions', 'contracts', 'contributors', 'imprints', 'periods', 'advances', 'unearned', 'statements', 'sales', 'rights', 'rights-available', 'schedule', 'manuscripts', 'deposits', 'reversions', 'compliance', 'attention', 'audit'])
      assert(Array.isArray(await run(c)), c);
    assert.equal((await run('rates', 'K-101')).length, 7);
    assert.match((await run('help')).help, /import onix/);
    const w = await run('weekly-review');
    assert.deepEqual(w.attention, await run('attention'));
  });

  await test('the demo surfaces every kind of loose end', async () => {
    const a = await run('attention');
    for (const c of ['Statement overdue', 'Statement due soon', 'Advance due', 'Manuscript late', 'Contract not signed', 'Legal deposit', 'Rights income overdue', 'Rights licence expiring', 'Reversion clause live', 'No royalty rate', 'Tax details'])
      assert(a.some((x) => x.category === c), c);
    assert(a.some((x) => x.category === 'Statement overdue' && x.item === 'S2 K-106'));
    assert(a.some((x) => x.category === 'Advance due' && x.item.startsWith('ADV-104')));
    assert(!a.some((x) => x.item.startsWith('ADV-111')), 'a delivery advance is not due before delivery');
  });

  await test('escalators split units across tiers, returns sit in the tier they fall back into', () => {
    const tiers = [{ from_units: 0, rate_bps: 1000 }, { from_units: 5000, rate_bps: 1250 }];
    assert.deepEqual(allocate(4800, 400, tiers).map((p) => [p.tier.rate_bps, p.units]), [[1000, 200], [1250, 200]]);
    assert.deepEqual(allocate(0, 300, tiers).map((p) => [p.tier.rate_bps, p.units]), [[1000, 300]]);
    assert.deepEqual(allocate(5100, -40, tiers).map((p) => [p.tier.rate_bps, p.units]), [[1250, -40]]);
    assert.deepEqual(allocate(5010, -40, tiers).map((p) => [p.tier.rate_bps, p.units]), [[1000, -40]]);
  });

  await test('first statements: royalties, advances, reserve, GST and withholding', async () => {
    // The Salt Road: 900 HB home at $45 x 10%, 100 HB export $2,250 receipts x 10%, 4,800 PB home at $29.99 x 10%, ebook $6,600 x 25%.
    const k101 = await st('S1-K-101');
    assert.equal(n(k101.earned_cents), 405000 + 22500 + 1439520 + 165000);
    assert.equal(n(k101.reserve_held_cents), Math.round((405000 + 22500 + 1439520) * 0.15));
    assert.equal(n(k101.advances_paid_cents), 1000000);
    assert.equal(n(k101.gross_payable_cents), 2032020 - 1000000 - 280053);
    assert.equal(n(k101.gst_cents), Math.round(751967 * 0.15));
    assert.equal(n(k101.withholding_cents), 0);
    // Dry Season: a US author on the Australian imprint with no treaty rate recorded, so 30% is withheld.
    const k106 = await st('S1-K-106');
    assert.equal(n(k106.earned_cents), 989700 + 75000 + 105000);
    assert.equal(n(k106.withholding_cents), Math.round(n(k106.gross_payable_cents) * 0.3));
    assert.equal(n(k106.gst_cents), 0);
    assert.equal(n(k106.net_payment_cents), n(k106.gross_payable_cents) - n(k106.withholding_cents));
    // Co-authored picture book: each contract earns half.
    assert.equal(n((await st('S1-K-104')).earned_cents), Math.round(2000 * 2499 * 0.1 * 0.5));
    assert.equal((await st('S1-K-107')).status, 'sent');
  });

  await test('the next run carries the reserve, crosses the escalator and adds the rights share', async () => {
    await bad(['run-statements', 'S3', '--early'], /no statement for S2/);
    await bad(['run-statements', 'S3'], /Run statements once the period has closed/);
    const r = await run('run-statements', 'S2');
    assert.equal(r.created.length, 5);
    assert(r.created.find((x) => x.contract === 'K-104').warnings.some((w) => /No rate in the contract for audio home/.test(w)));
    const s = await st('S2-K-101');
    const lines = await q(`select format, rate_bps, units, royalty_cents, line_type from statement_lines where statement_id = $1`, [s.id]);
    const pb = lines.filter((l) => l.format === 'paperback').map((l) => [l.rate_bps, l.units, n(l.royalty_cents)]).sort();
    assert.deepEqual(pb, [[1000, 200, 59980], [1250, 200, 74975]]);
    assert.equal(lines.find((l) => l.format === 'hardback').units, 110);
    assert.equal(n(lines.find((l) => l.line_type === 'subrights').royalty_cents), 100000);
    assert.equal(n(s.reserve_released_cents), n((await st('S1-K-101')).reserve_held_cents));
    assert.equal(n(s.balance_cents), 49500 + 134955 + 55000 + 100000 + 280053 - Math.round((49500 + 134955) * 0.15));
    await bad(['run-statements', 'S3', '--early'], /still a draft/);
    // A rerun replaces drafts and keeps anything already approved.
    await run('approve', 'S2-K-107');
    const again = await run('run-statements', 'S2');
    assert.equal(again.created.length, 4); assert.equal(again.kept[0].contract, 'K-107');
  });

  await test('statements move draft, approved, sent, paid and never skip a step', async () => {
    await bad(['mark-sent', 'S2-K-101'], /is draft/);
    await run('approve', 'S2');
    await run('mark-sent', 'S2');
    assert.equal((await st('S2-K-106')).status, 'sent');
    assert(!(await run('attention')).some((x) => x.item === 'S2 K-106'));
    assert((await run('attention')).some((x) => x.category === 'Payment not made' && x.item === 'S2-K-106'));
    await run('mark-paid', 'S2-K-106');
    assert.equal((await st('S2-K-106')).status, 'paid');
    await bad(['mark-paid', 'S2-K-107'], /with a payment due/);
    await bad(['mark-paid', 'S2-K-101', '--date=2999-01-01'], /today or earlier/);
    const pos = (await run('unearned')).find((r) => r.contract === 'K-102');
    assert.equal(n(pos.unearned_cents), 300000, 'Night Ferry has earned nothing on a statement yet');
    assert.equal(n((await run('unearned')).find((r) => r.contract === 'K-104').unearned_cents), 0);
  });

  await test('compliance: deposit deadlines, GST agreements and withholding rates', async () => {
    assert.equal(addWorkingDays('2026-11-13', 1), '2026-11-16');
    assert.equal(addWorkingDays('2026-11-02', 20), '2026-11-30');
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    let c = await run('compliance');
    assert.equal(c[0].state, 'breach');
    assert(c.some((x) => x.item === 'W02-PB' && x.state === 'breach'));
    assert(c.some((x) => x.item === 'W03-HB' && x.state === 'due'));
    assert(c.some((x) => x.item === 'A01 Mere Paki' && x.state === 'breach'));
    assert(c.some((x) => x.item === 'A05 Rosa Delgado' && x.state === 'check'));
    assert(c.some((x) => x.item === 'S1 K-106' && x.state === 'info'), 'sent after its 30-day deadline');
    await run('deposit', 'W02-PB');
    await run('set', 'contributor', 'A01', '--agreement=2026-01-15');
    assert(( await run('compliance')).some((x) => x.item === 'A01 Mere Paki' && x.state === 'check'));
    await run('set', 'contributor', 'A01', '--gst-number=123-456-789');
    await run('set', 'contributor', 'A05', '--treaty-rate=5');
    c = await run('compliance');
    assert(c.some((x) => x.item === 'W02-PB' && x.state === 'ok'));
    assert(c.some((x) => x.item === 'A01 Mere Paki' && x.state === 'ok'));
    assert(c.some((x) => x.item === 'A05 Rosa Delgado' && /treaty rate 5%/.test(x.detail)));
    const deposits = await run('deposits');
    assert.equal(deposits.find((d) => d.edition === 'W02-PB').copies_sent, 2);
    assert.equal(deposits.find((d) => d.edition === 'W03-HB').copies_required, 1);
  });

  await test('names, refs and id prefixes resolve; ambiguity fails with candidates', async () => {
    assert.equal((await run('card', 'contributor', 'mere paki'))[0].ref, 'A01');
    const w = (await run('card', 'work', 'salt road'))[0];
    assert.equal((await run('card', 'work', w.id.slice(0, 8)))[0].id, w.id);
    await bad(['card', 'contributor', 'Tom'], /Ambiguous contributor[\s\S]*A07[\s\S]*A08/);
    await bad(['card', 'work', 'nothing-like-this'], /No work/);
    await bad(['card', 'contributor', '%'], /No contributor/);
  });

  await test('writes validate dates, percentages, formats and fields; workflow steps update records', async () => {
    await bad(['add', 'work', '--title=Bad', '--imprint=KSP', '--due=2026-02-30'], /Invalid calendar date/);
    await bad(['add', 'rate', '--contract=K-102', '--format=paperback', '--rate=150'], /Invalid percentage/);
    await bad(['set', 'work', 'W01', '--colour=red'], /Unknown work field/);
    await bad(['add', 'edition', '--work=W01', '--format=scroll'], /check constraint/);
    await bad(['set', 'contract', 'K-109', '--status=signed'], /check constraint/);
    await run('add', 'rate', '--contract=K-104', '--format=audio', '--basis=net_receipts', '--rate=20');
    assert(!(await run('attention')).some((x) => x.category === 'No royalty rate' && x.item.startsWith('K-104')));
    await run('add', 'share', '--contract=K-102', '--right=translation', '--share=75');
    assert.equal((await q(`select author_share_bps from subrights_shares ss join contracts c on c.id = ss.contract_id where c.ref = 'K-102' and right_type = 'translation'`))[0].author_share_bps, 7500);
    await run('pay-advance', 'ADV-104');
    await bad(['pay-advance', 'ADV-104'], /already paid/);
    await run('deliver', 'W07');
    assert(!(await run('attention')).some((x) => x.category === 'Manuscript late'));
    assert((await run('advances', '--unpaid')).some((a) => a.ref === 'ADV-111' && a.days_overdue === null));
    await run('receive', 'RI-302');
    assert(!(await run('attention')).some((x) => x.category === 'Rights income overdue'));
    await run('request-reversion', 'K-107');
    assert((await run('attention')).some((x) => x.category === 'Reversion requested'));
    await run('revert', 'K-107');
    assert.equal((await run('card', 'contract', 'K-107'))[0].status, 'reverted');
    assert(!(await run('attention')).some((x) => /Reversion/.test(x.category)));
    assert((await run('rights-available', '--work=W01')).some((r) => r.right_type === 'audio' && /signed to Larkspur/.test(r.state)));
    assert((await q(`select * from audit_events where entity = 'contracts' and action = 'UPDATE'`)).length > 0);
  });

  await test('imports: ONIX titles, the royalty schedule and distributor sales, with dry runs and rollback', async () => {
    const dir = path.join(REPO_ROOT, 'tests', 'fixtures');
    const dry = await run('import', 'onix', `--file=${path.join(dir, 'onix-synthetic.xml')}`, '--imprint=KSP', '--dry-run');
    assert.equal(dry.products, 3); assert.equal(dry.works_new, 1); assert.equal(dry.editions_new, 2); assert.equal(dry.editions_updated, 1);
    assert.equal((await q(`select * from works where title like 'Harbour Bells%'`)).length, 0);
    await run('import', 'onix', `--file=${path.join(dir, 'onix-synthetic.xml')}`, '--imprint=KSP');
    const [hb] = await q(`select e.ref, e.format, e.rrp_cents, e.pub_date::text as pub from editions e where e.isbn = '9780000000141'`);
    assert.equal(hb.format, 'paperback'); assert.equal(n(hb.rrp_cents), 3299); assert.equal(hb.pub, '2026-03-01');
    assert.equal(n((await q(`select rrp_cents from editions where isbn = '9780000000042'`))[0].rrp_cents), 3699, 'the NZD price wins for an NZ imprint');
    assert.equal((await run('import', 'onix', `--file=${path.join(dir, 'onix-synthetic.xml')}`, '--imprint=KSP')).editions_updated, 3);

    const k = await run('import', 'contracts', `--file=${path.join(dir, 'contracts-synthetic.csv')}`);
    assert.equal(k.contracts_new, 1); assert.equal(k.contributors_new, 1); assert.equal(k.rates, 4);
    const [c] = await q(`select status, opening_balance_cents, opening_as_of::text as asof, share_bps from contracts where ref = 'K-201'`);
    assert.equal(c.status, 'signed'); assert.equal(n(c.opening_balance_cents), -150000); assert.equal(c.asof, '2026-01-31');
    assert.equal((await run('rates', 'K-201')).length, 4);

    const s1 = await run('import', 'sales', `--file=${path.join(dir, 'sales-synthetic.csv')}`);
    assert.equal(s1.imported, 5);
    const again = await run('import', 'sales', `--file=${path.join(dir, 'sales-synthetic.csv')}`);
    assert.equal(again.imported, 0); assert.equal(again.skipped_already_loaded, 5);
    const pbSales = await run('sales', '--edition=9780000000141');
    assert.deepEqual(pbSales.map((r) => [r.channel, r.units]), [['export', 20], ['home', 90]]);

    const before = (await q('select count(*)::int n from audit_events'))[0].n;
    const broken = fixture('broken.csv', 'ISBN,Date,Units,Net receipts\n9780000000141,2026-06-30,10,100\n9999999999999,2026-06-30,10,100\n');
    await bad(['import', 'sales', `--file=${broken}`], /CSV row 3: no edition with ISBN 9999999999999/);
    assert.equal((await q('select count(*)::int n from audit_events'))[0].n, before);
    await bad(['import', 'sales', `--file=${fixture('cols.csv', 'Foo,Bar\n1,2\n')}`], /Could not find the isbn, date, units column/);
    const mapped = fixture('mapped.csv', 'EAN13,Month end,Qty\n9780000000158,2026-06-30,12\n');
    const map = fixture('map.json', JSON.stringify({ isbn: 'EAN13', date: 'Month end', units: 'Qty' }));
    assert.equal((await run('import', 'sales', `--file=${mapped}`, `--mapping=${map}`)).imported, 1);
    await bad(['import', 'onix', `--file=${fixture('notonix.xml', '<x/>')}`, '--imprint=KSP'], /No <Product> records/);
  });

  await test('drafts carry the real records; export refuses to overwrite', async () => {
    for (const cmd of [['draft-statement-letter', 'S1-K-106'], ['draft-rights-chase', 'RI-302'], ['draft-weekly-review']]) {
      const { file } = await run(...cmd);
      const text = fs.readFileSync(file, 'utf8');
      assert(text.includes('DRAFT'), cmd[0]);
      if (cmd[0] === 'draft-statement-letter') { assert(text.includes('Westbrook Agency')); assert(text.includes('withholding tax')); }
      if (cmd[0] === 'draft-rights-chase') assert(text.includes('Ostwind Verlag'));
    }
    const dir = path.join(scratch, 'export');
    const e = await run('export', `--out=${dir}`);
    assert.equal(e.counts.contracts, 11);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
    assert.equal(snap.tables.statements.length, e.counts.statements);
    assert(fs.readFileSync(path.join(dir, 'statements.csv'), 'utf8').startsWith('id,'));
    await bad(['export', `--out=${dir}`], /EEXIST/);
  });

  await test('HTML output escapes record text', async () => {
    await run('set', 'work', 'W01', '--title=<script>alert(1)</script>');
    await db.close(); closed = true;
    const p = spawnSync(process.execPath, ['scripts/docs.mjs', 'royalty-statement'], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const dir = path.join(process.env.OUTPUT_DIR, 'docs-out', 'royalty-statement');
    const html = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>alert'));
  });

  await test('the CLI exits 1 with candidates on an ambiguous name', async () => {
    const p = spawnSync(process.execPath, ['scripts/royalties.mjs', 'card', 'contributor', 'Tom', '--json'], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /A07[\s\S]*A08/);
  });

  await test('every view and document renders', async () => {
    for (const name of ['view', 'docs']) {
      const p = spawnSync(process.execPath, [`scripts/${name}.mjs`], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
      assert.equal(p.status, 0, p.stderr);
    }
    for (const v of ['week', 'royalty-position', 'rights', 'schedule']) assert(fs.existsSync(path.join(process.env.OUTPUT_DIR, 'views', `${v}.html`)), v);
    assert.equal(fs.readdirSync(path.join(process.env.OUTPUT_DIR, 'docs-out', 'royalty-statement')).length, 10);
    assert(fs.readdirSync(path.join(process.env.OUTPUT_DIR, 'docs-out', 'remittance-advice')).length >= 4);
    assert(fs.readdirSync(path.join(process.env.OUTPUT_DIR, 'docs-out', 'advance-information-sheet')).length >= 3);
  });

  console.log(`PASS: ${checks} end-to-end checks on an isolated embedded database.`);
} finally {
  if (!closed) await db.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
