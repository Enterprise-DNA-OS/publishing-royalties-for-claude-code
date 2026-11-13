#!/usr/bin/env node
// The one CLI for Publishing Royalties for Claude Code. Every slash command drives this file.
//   node scripts/royalties.mjs <command> [args] [--json]
//   node scripts/royalties.mjs help
// Human tables by default, --json for machines. Names match case-insensitively, ids by prefix;
// an ambiguous name lists the candidates and exits 1. Percentages are typed as percentages
// (--rate=12.5) and stored as basis points.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, heading } from './lib/format.mjs';

// ------------------------------------------------------------------ records

const ENTITIES = {
  imprint: { table: 'imprints', name: 'name', fields: ['ref', 'name', 'country', 'currency'] },
  contributor: { table: 'contributors', prefix: 'A', name: 'name', fields: ['ref', 'name', 'role', 'email', 'agent', 'tax_country', 'gst_registered', 'gst_number', 'tax_invoice_agreement_on', 'treaty_rate_bps', 'active'] },
  work: { table: 'works', prefix: 'W', name: 'title', fields: ['ref', 'title', 'imprint_id', 'status', 'delivery_due_on', 'delivered_on', 'out_of_print_on'] },
  edition: { table: 'editions', name: 'isbn', fields: ['ref', 'work_id', 'isbn', 'format', 'rrp_cents', 'pub_date', 'print_run', 'prior_units', 'status'] },
  contract: { table: 'contracts', prefix: 'K', fields: ['ref', 'work_id', 'contributor_id', 'status', 'signed_on', 'territory', 'share_bps', 'statement_days', 'reversion_months', 'reversion_requested_on', 'reverted_on', 'opening_balance_cents', 'opening_as_of'] },
  advance: { table: 'advances', prefix: 'ADV', fields: ['ref', 'contract_id', 'trigger', 'amount_cents', 'paid_on'] },
  deal: { table: 'rights_deals', prefix: 'R', name: 'licensee', fields: ['ref', 'work_id', 'right_type', 'licensee', 'territory', 'language', 'status', 'signed_on', 'expires_on', 'advance_cents'] },
  income: { table: 'rights_income', prefix: 'RI', name: 'note', fields: ['ref', 'deal_id', 'expected_on', 'received_on', 'amount_cents', 'note'] },
  sale: { table: 'sales', prefix: 'SL', fields: ['ref', 'edition_id', 'sold_on', 'channel', 'units', 'receipts_cents', 'source'] },
  period: { table: 'royalty_periods', name: 'name', fields: ['ref', 'name', 'starts_on', 'ends_on'] },
  statement: { table: 'statements', fields: ['ref', 'status', 'sent_on', 'paid_on'] },
  deposit: { table: 'legal_deposits', prefix: 'LD', name: 'library', fields: ['ref', 'edition_id', 'library', 'copies', 'sent_on'] },
};
const FK = { imprint_id: 'imprint', work_id: 'work', contributor_id: 'contributor', contract_id: 'contract', deal_id: 'deal', edition_id: 'edition' };
const ALIAS = {
  imprint: 'imprint_id', work: 'work_id', contributor: 'contributor_id', person: 'contributor_id', contract: 'contract_id', deal: 'deal_id', edition: 'edition_id',
  rrp: 'rrp_cents', amount: 'amount_cents', advance: 'advance_cents', receipts: 'receipts_cents', opening_balance: 'opening_balance_cents', balance: 'opening_balance_cents',
  share: 'share_bps', treaty_rate: 'treaty_rate_bps', due: 'delivery_due_on', delivery_due: 'delivery_due_on', delivered: 'delivered_on', signed: 'signed_on',
  expires: 'expires_on', expected: 'expected_on', received: 'received_on', paid: 'paid_on', date: 'sold_on', pub: 'pub_date', starts: 'starts_on', ends: 'ends_on',
  agreement: 'tax_invoice_agreement_on', out_of_print: 'out_of_print_on', right: 'right_type', type: 'right_type', sent: 'sent_on',
};
const MONEY = /_cents$/;
const PCT = /_bps$/;
const DATES = /(_on|_date|_of)$/;
const BOOLS = new Set(['gst_registered', 'active']);
const INTS = new Set(['print_run', 'prior_units', 'statement_days', 'reversion_months', 'units', 'copies']);
const PRINT = new Set(['hardback', 'paperback']);

class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

function parseArgs(argv) {
  const pos = [], opt = {};
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/i.exec(a);
    if (m) opt[m[1].toLowerCase().replace(/-/g, '_')] = m[2] === undefined ? true : m[2];
    else pos.push(a);
  }
  return { pos, opt };
}

export function checkDate(v, what = 'date') {
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`Invalid calendar date for ${what}: ${v} (use YYYY-MM-DD)`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(`Invalid calendar date for ${what}: ${v}`);
  return s;
}
const toCents = (v, what, allowNegative = false) => {
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || (!allowNegative && n < 0)) fail(`Invalid amount for ${what}: ${v}`);
  return Math.round(n * 100);
};
const toBps = (v, what) => { const n = Number(String(v).replace(/%/g, '')); if (!Number.isFinite(n) || n < 0 || n > 100) fail(`Invalid percentage for ${what}: ${v} (0 to 100)`); return Math.round(n * 100); };
const isoToday = async (db) => (await db.query('select current_date::text as d'))[0].d;
const pct = (bps) => `${(Number(bps) / 100).toFixed(bps % 100 ? 2 : 0)}%`;

// Working days (Monday to Friday) after `from`, counting `days`. Public holidays are not removed;
// docs/compliance.md says so.
export function addWorkingDays(from, days) {
  const d = new Date(`${from}T00:00:00Z`);
  let n = 0;
  while (n < days) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return d.toISOString().slice(0, 10);
}
export function addMonths(from, months) {
  const d = new Date(`${from}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const addDays = (from, days) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Resolve a record from what a person typed: exact ref, exact name, id prefix, then a partial match.
export async function resolve(db, entity, text) {
  const e = ENTITIES[entity] || fail(`Unknown record type: ${entity}`);
  const q = String(text ?? '').trim();
  if (!q) fail(`Say which ${entity}`);
  const label = e.name ? `ref || ' ' || coalesce(${e.name}, '')` : 'ref';
  const tries = [
    [`select id, ref, ${label} as label from ${e.table} where lower(ref) = lower($1)`, q],
    e.name && [`select id, ref, ${label} as label from ${e.table} where lower(${e.name}) = lower($1)`, q],
    /^[0-9a-f-]{4,36}$/i.test(q) && [`select id, ref, ${label} as label from ${e.table} where id::text like lower($1) || '%'`, q],
    [`select id, ref, ${label} as label from ${e.table} where ref ilike '%' || $1 || '%'${e.name ? ` or ${e.name} ilike '%' || $1 || '%'` : ''} order by ref limit 20`, q.replace(/[%_\\]/g, (c) => '\\' + c)],
  ].filter(Boolean);
  for (const [sql, p] of tries) {
    const rows = await db.query(sql, [p]);
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) fail(`Ambiguous ${entity} "${q}". Candidates:\n${rows.map((r) => `  ${r.ref}  ${String(r.label).slice(r.ref.length + 1, r.ref.length + 61)}  (${r.id.slice(0, 8)})`).join('\n')}`);
  }
  fail(`No ${entity} matches "${q}"`);
}

async function nextRef(db, entity) {
  const e = ENTITIES[entity];
  const rows = await db.query(`select ref from ${e.table} where ref ~ $1`, [`^${e.prefix}-[0-9]+$`]);
  const n = rows.reduce((m, r) => Math.max(m, Number(r.ref.split('-').at(-1))), 100) + 1;
  return `${e.prefix}-${n}`;
}

async function toColumns(db, entity, opt) {
  const e = ENTITIES[entity];
  const cols = {};
  for (const [k0, v] of Object.entries(opt)) {
    if (['json', 'dry_run'].includes(k0)) continue;
    const k = ALIAS[k0] || (e.fields.includes(`${k0}_bps`) ? `${k0}_bps` : e.fields.includes(`${k0}_cents`) ? `${k0}_cents` : k0);
    if (!e.fields.includes(k)) fail(`Unknown ${entity} field: ${k0}. Fields: ${e.fields.map((f) => f.replace(/_id$|_cents$|_bps$/, '')).join(', ')}`);
    const empty = v === '' || v === 'none';
    if (FK[k]) cols[k] = empty ? null : (await resolve(db, FK[k], v)).id;
    else if (MONEY.test(k)) cols[k] = toCents(v, k0, k === 'opening_balance_cents' || k === 'receipts_cents');
    else if (PCT.test(k)) cols[k] = empty ? null : toBps(v, k0);
    else if (DATES.test(k)) cols[k] = empty ? null : checkDate(v, k0);
    else if (BOOLS.has(k)) cols[k] = v === true || /^(yes|true|y|1)$/i.test(String(v));
    else if (INTS.has(k)) { if (empty) cols[k] = null; else { const n = Number(v); if (!Number.isInteger(n)) fail(`${k0} must be a whole number`); cols[k] = n; } }
    else cols[k] = v === true ? 'true' : String(v);
    if (k === 'tax_country' || k === 'country' || k === 'currency') cols[k] = String(cols[k]).toUpperCase();
  }
  return cols;
}

async function addRecord(db, entity, opt) {
  const e = ENTITIES[entity] || fail(`Unknown record type: ${entity}. Types: ${Object.keys(ENTITIES).join(', ')}, rate, share`);
  if (entity === 'statement') fail('Statements are created by run-statements <period>');
  const cols = await toColumns(db, entity, opt);
  if (entity === 'edition' && !cols.ref) {
    if (!cols.work_id || !cols.format) fail('An edition needs --work and --format (hardback, paperback, ebook, audio)');
    const [w] = await db.query('select ref from works where id = $1', [cols.work_id]);
    cols.ref = `${w.ref}-${{ hardback: 'HB', paperback: 'PB', ebook: 'EB', audio: 'AU' }[cols.format] || cols.format.toUpperCase()}`;
  }
  if (!cols.ref) { if (!e.prefix) fail(`A ${entity} needs --ref`); cols.ref = await nextRef(db, entity); }
  if (entity === 'sale' && !cols.edition_id) fail('A sale needs --edition');
  const keys = Object.keys(cols);
  const [row] = await db.query(`insert into ${e.table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, keys.map((k) => cols[k]));
  return row;
}

async function setRecord(db, entity, ref, opt) {
  const e = ENTITIES[entity] || fail(`Unknown record type: ${entity}`);
  if (entity === 'statement') fail('Statements change through approve, mark-sent and mark-paid');
  const r = await resolve(db, entity, ref);
  const cols = await toColumns(db, entity, opt);
  if (!Object.keys(cols).length) fail('Nothing to change: give at least one --field=value');
  const keys = Object.keys(cols);
  const [row] = await db.query(`update ${e.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`, [r.id, ...keys.map((k) => cols[k])]);
  return row;
}

// A royalty rate line on a contract. Several lines for one format and channel make an escalator.
async function addRate(db, opt) {
  const c = await resolve(db, 'contract', opt.contract || fail('Say which contract: --contract=K-101'));
  const format = opt.format || fail('Give --format=hardback|paperback|ebook|audio');
  const channel = opt.channel || 'home';
  const basis = (opt.basis || 'rrp').replace('-', '_');
  const rate = toBps(opt.rate ?? fail('Give --rate as a percentage, for example --rate=10'), 'rate');
  const from = Number(opt.from || 0);
  if (!Number.isInteger(from) || from < 0) fail('--from is the unit count the rate starts at, a whole number');
  return db.query(`insert into royalty_rates (contract_id, format, channel, basis, rate_bps, from_units) values ($1, $2, $3, $4, $5, $6)
    on conflict (contract_id, format, channel, from_units) do update set basis = excluded.basis, rate_bps = excluded.rate_bps returning *`, [c.id, format, channel, basis, rate, from]);
}

async function addShare(db, opt) {
  const c = await resolve(db, 'contract', opt.contract || fail('Say which contract: --contract=K-101'));
  const right = opt.right || opt.type || fail('Give --right=translation|audio|film_tv|serial|us|uk|large_print|other');
  const share = toBps(opt.share ?? fail('Give the author share as a percentage: --share=80'), 'share');
  return db.query(`insert into subrights_shares (contract_id, right_type, author_share_bps) values ($1, $2, $3)
    on conflict (contract_id, right_type) do update set author_share_bps = excluded.author_share_bps returning *`, [c.id, right, share]);
}

async function tx(db, fn) {
  await db.exec('BEGIN');
  try { const out = await fn(); await db.exec('COMMIT'); return out; }
  catch (err) { await db.exec('ROLLBACK'); throw err; }
}
const setting = async (db, key) => Number((await db.query('select value from settings where key = $1', [key]))[0].value);

// ------------------------------------------------------------------ reads

const READS = {
  imprints: `select ref, name, country, currency from imprints order by ref`,
  periods: `select rp.ref, rp.name, rp.starts_on, rp.ends_on, count(s.id) as statements,
              count(s.id) filter (where s.status in ('sent', 'paid')) as sent, count(s.id) filter (where s.status = 'draft') as drafts
            from royalty_periods rp left join statements s on s.period_id = rp.id group by rp.id order by rp.starts_on`,
  contributors: `select p.ref, p.name, p.role, p.agent, p.tax_country, p.gst_registered, p.gst_number, p.tax_invoice_agreement_on, p.treaty_rate_bps, p.email from contributors p order by p.ref`,
  titles: `select w.ref, w.title, i.ref as imprint, w.status, w.delivery_due_on, w.delivered_on,
             string_agg(e.format || ' ' || coalesce(e.pub_date::text, 'no date'), ', ' order by e.pub_date) as editions,
             (select string_agg(p.name, ' and ' order by c.ref) from contracts c join contributors p on p.id = c.contributor_id where c.work_id = w.id) as contributors
           from works w join imprints i on i.id = w.imprint_id left join editions e on e.work_id = w.id group by w.id, i.ref order by w.ref`,
  editions: `select edition, title, format, isbn, pub_date, status, lifetime_units, units_90_days, receipts_cents, currency from edition_sales order by edition`,
  contracts: `select c.ref, w.title, p.name as contributor, c.status, c.signed_on, c.territory, c.share_bps, c.statement_days, coalesce(c.reversion_months::text, '') as reversion_months
              from contracts c join works w on w.id = c.work_id join contributors p on p.id = c.contributor_id order by c.ref`,
  unearned: `select contract, title, contributor, advances_paid_cents, earned_to_date_cents,
               greatest(advances_paid_cents - earned_to_date_cents, 0) as unearned_cents,
               case when advances_paid_cents > 0 then round(100.0 * earned_to_date_cents / advances_paid_cents) end as pct_earned, last_period, currency
             from contract_position where status = 'signed' and advances_paid_cents > 0 order by unearned_cents desc, contract`,
  rights: `select d.ref, w.title, d.right_type, d.licensee, d.territory, d.language, d.status, d.signed_on, d.expires_on, d.advance_cents,
             coalesce((select sum(ri.amount_cents) from rights_income ri where ri.deal_id = d.id and ri.received_on is not null), 0)::bigint as received_cents,
             coalesce((select sum(ri.amount_cents) from rights_income ri where ri.deal_id = d.id and ri.received_on is null), 0)::bigint as outstanding_cents, i.currency
           from rights_deals d join works w on w.id = d.work_id join imprints i on i.id = w.imprint_id order by d.ref`,
  manuscripts: `select w.ref, w.title, i.ref as imprint, w.status, w.delivery_due_on, w.delivered_on,
                  case when w.delivered_on is null and w.delivery_due_on < current_date then current_date - w.delivery_due_on end as days_late,
                  (select min(e.pub_date) from editions e where e.work_id = w.id) as first_pub
                from works w join imprints i on i.id = w.imprint_id where w.delivery_due_on is not null order by w.delivered_on nulls first, w.delivery_due_on`,
  audit: `select at, entity, action, data->>'ref' as ref from audit_events order by id desc limit 25`,
};

async function statements(db, opt) {
  const where = [], p = [];
  if (opt.period) { p.push((await resolve(db, 'period', opt.period)).id); where.push(`s.period_id = $${p.length}`); }
  if (opt.status) { p.push(opt.status); where.push(`s.status = $${p.length}`); }
  if (opt.contract) { p.push((await resolve(db, 'contract', opt.contract)).id); where.push(`s.contract_id = $${p.length}`); }
  return db.query(`select s.ref, rp.ref as period, c.ref as contract, w.title, p.name as payee, s.status, s.opening_cents, s.earned_cents, s.subrights_cents,
      s.reserve_held_cents, s.gross_payable_cents, s.withholding_cents, s.gst_cents, s.net_payment_cents, s.carry_forward_cents, s.due_on, s.sent_on, s.paid_on, s.currency
    from statements s join royalty_periods rp on rp.id = s.period_id join contracts c on c.id = s.contract_id join works w on w.id = c.work_id join contributors p on p.id = c.contributor_id
    ${where.length ? 'where ' + where.join(' and ') : ''} order by rp.starts_on, c.ref`, p);
}

async function statementCard(db, ref) {
  const s = await resolve(db, 'statement', ref);
  const [head] = await statements(db, {}).then((rows) => rows.filter((r) => r.ref === s.ref));
  const lines = await db.query(`select coalesce(e.ref, '') as edition, l.line_type, l.description, l.format, l.channel, l.basis, l.rate_bps, l.units, l.base_cents, l.royalty_cents, st.currency
    from statement_lines l join statements st on st.id = l.statement_id left join editions e on e.id = l.edition_id where l.statement_id = $1 order by l.line_type, e.ref, l.channel, l.rate_bps`, [s.id]);
  return { statement: [head], lines };
}

async function sales(db, opt) {
  const where = [], p = [];
  if (opt.edition) { p.push((await resolve(db, 'edition', opt.edition)).id); where.push(`s.edition_id = $${p.length}`); }
  if (opt.work) { p.push((await resolve(db, 'work', opt.work)).id); where.push(`e.work_id = $${p.length}`); }
  if (opt.period) {
    const [rp] = await db.query('select starts_on, ends_on from royalty_periods where id = $1', [(await resolve(db, 'period', opt.period)).id]);
    p.push(rp.starts_on, rp.ends_on); where.push(`s.sold_on between $${p.length - 1} and $${p.length}`);
  }
  return db.query(`select e.ref as edition, w.title, e.format, s.channel, sum(s.units)::int as units, sum(s.receipts_cents)::bigint as receipts_cents, min(s.sold_on) as first, max(s.sold_on) as last, i.currency
    from sales s join editions e on e.id = s.edition_id join works w on w.id = e.work_id join imprints i on i.id = w.imprint_id
    ${where.length ? 'where ' + where.join(' and ') : ''} group by e.id, w.title, s.channel, i.currency order by e.ref, s.channel`, p);
}

async function rates(db, ref) {
  const c = await resolve(db, 'contract', ref);
  return db.query(`select format, channel, basis, rate_bps, from_units from royalty_rates where contract_id = $1 order by format, channel, from_units`, [c.id]);
}

// Each instalment with the date its trigger happened and the date payment falls due.
async function advances(db, opt) {
  const days = await setting(db, 'advance_due_days');
  const rows = await db.query(`select a.ref, c.ref as contract, w.title, p.name as payee, a.trigger, a.amount_cents, a.paid_on, i.currency,
      case a.trigger when 'signing' then c.signed_on when 'delivery' then w.delivered_on
        else (select min(e.pub_date) from editions e where e.work_id = w.id and e.pub_date <= current_date) end as triggered_on
    from advances a join contracts c on c.id = a.contract_id join works w on w.id = c.work_id join contributors p on p.id = c.contributor_id join imprints i on i.id = w.imprint_id
    order by a.paid_on nulls first, a.ref`);
  const today = await isoToday(db);
  const out = rows.map((r) => ({ ...r, due_on: r.triggered_on ? addDays(r.triggered_on, days) : null, days_overdue: !r.paid_on && r.triggered_on && addDays(r.triggered_on, days) < today ? daysBetween(addDays(r.triggered_on, days), today) : null }));
  return opt.unpaid ? out.filter((r) => !r.paid_on) : out;
}

async function deposits(db) {
  const today = await isoToday(db);
  const rows = await db.query('select * from deposit_status order by pub_date desc');
  return rows.map((r) => {
    const deadline = r.deposit_unit === 'months' ? addMonths(r.pub_date, r.deposit_period) : addWorkingDays(r.pub_date, r.deposit_period);
    const state = r.copies_sent >= r.copies_required ? 'ok' : r.copies_sent > 0 ? 'short' : deadline < today ? 'late' : 'due';
    return { edition: r.edition, title: r.title, format: r.format, pub_date: r.pub_date, library: r.library, copies_required: r.copies_required, copies_sent: r.copies_sent, deposited_on: r.deposited_on, deadline, state };
  });
}

async function schedule(db, opt) {
  const days = Number(opt.days || 120);
  return db.query(`select e.ref as edition, w.title, e.format, e.isbn, e.pub_date, e.pub_date - current_date as days_to_pub, e.rrp_cents, i.currency,
      case when exists (select 1 from contracts c where c.work_id = w.id and c.status = 'signed') then 'signed'
           when exists (select 1 from contracts c where c.work_id = w.id) then 'not signed' else 'no contract' end as contract,
      case when w.delivered_on is not null then 'delivered' else 'not delivered' end as manuscript
    from editions e join works w on w.id = e.work_id join imprints i on i.id = w.imprint_id
    where e.pub_date between current_date - 30 and current_date + $1::int order by e.pub_date`, [days]);
}

// Right types with no live licence, per published or forthcoming work.
const RIGHT_TYPES = ['translation', 'audio', 'film_tv', 'serial', 'us', 'uk', 'large_print'];
async function rightsAvailable(db, opt) {
  const where = opt.work ? 'and w.id = $1' : '';
  const p = opt.work ? [(await resolve(db, 'work', opt.work)).id] : [];
  const works = await db.query(`select w.id, w.ref, w.title from works w where w.status <> 'out_of_print' ${where} order by w.ref`, p);
  const out = [];
  for (const w of works) {
    const live = await db.query(`select right_type, status, licensee from rights_deals where work_id = $1 and status in ('offered', 'signed') and (expires_on is null or expires_on > current_date)`, [w.id]);
    for (const t of RIGHT_TYPES) {
      const d = live.find((x) => x.right_type === t);
      out.push({ work: w.ref, title: w.title, right_type: t, state: d ? `${d.status} to ${d.licensee}` : 'available' });
    }
  }
  return out;
}

async function reversions(db) {
  return db.query(`select c.ref as contract, w.title, p.name as contributor, c.reversion_months, w.out_of_print_on,
      case when w.out_of_print_on is not null then (extract(year from age(current_date, w.out_of_print_on)) * 12 + extract(month from age(current_date, w.out_of_print_on)))::int end as months_out_of_print,
      (select coalesce(sum(s.units), 0) from sales s join editions e on e.id = s.edition_id where e.work_id = w.id and s.sold_on > current_date - 365)::int as units_last_12_months,
      c.reversion_requested_on, c.reverted_on, c.status
    from contracts c join works w on w.id = c.work_id join contributors p on p.id = c.contributor_id
    where c.reversion_months is not null and (w.status = 'out_of_print' or c.reversion_requested_on is not null or c.status = 'reverted')
    order by c.ref`);
}

// ------------------------------------------------------------------ the royalty run

// Split `units` sold, starting from lifetime count `cum`, across escalator tiers.
export function allocate(cum, units, tiers) {
  if (!tiers.length) return [];
  if (units <= 0) {
    const at = Math.max(cum + units, 0);
    const t = [...tiers].reverse().find((x) => x.from_units <= at) || tiers[0];
    return [{ tier: t, units }];
  }
  const out = [];
  tiers.forEach((t, i) => {
    const start = t.from_units, end = tiers[i + 1] ? tiers[i + 1].from_units : Infinity;
    const n = Math.max(0, Math.min(cum + units, end) - Math.max(cum, start));
    if (n > 0) out.push({ tier: t, units: n });
  });
  return out;
}

const ELIGIBLE = `c.status = 'signed' or (c.status = 'reverted' and c.reverted_on >= rp.starts_on)`;
const HAS_ACTIVITY = `(exists (select 1 from editions e where e.work_id = c.work_id and e.pub_date <= rp.ends_on)
  or exists (select 1 from rights_income ri join rights_deals d on d.id = ri.deal_id where d.work_id = c.work_id and ri.received_on between rp.starts_on and rp.ends_on))`;

async function computeStatement(db, period, contractId) {
  const reserveBps = await setting(db, 'reserve_bps');
  const minimum = await setting(db, 'minimum_payment_cents');
  const [c] = await db.query(`select c.*, w.ref as work_ref, i.country, i.currency, j.gst_bps, j.withholding_default_bps,
      p.tax_country, p.gst_registered, p.treaty_rate_bps
    from contracts c join works w on w.id = c.work_id join imprints i on i.id = w.imprint_id join jurisdictions j on j.country = i.country
    join contributors p on p.id = c.contributor_id where c.id = $1`, [contractId]);
  const [prev] = await db.query(`select s.*, rp.ends_on as period_end, rp.ref as period_ref from statements s join royalty_periods rp on rp.id = s.period_id
    where s.contract_id = $1 and rp.ends_on < $2 order by rp.ends_on desc limit 1`, [contractId, period.starts_on]);
  if (prev && prev.status === 'draft') fail(`${c.ref}: the ${prev.period_ref} statement is still a draft. Approve it before running ${period.ref}.`);
  const opening = prev ? Number(prev.carry_forward_cents) : Number(c.opening_balance_cents);
  const windowStart = prev ? prev.period_end : c.opening_as_of || '0001-01-01';
  const [adv] = await db.query(`select coalesce(sum(amount_cents), 0)::bigint as c from advances where contract_id = $1 and paid_on > $2 and paid_on <= $3`, [contractId, windowStart, period.ends_on]);
  const advancesPaid = Number(adv.c);

  const rateRows = await db.query('select format, channel, basis, rate_bps, from_units from royalty_rates where contract_id = $1 order by from_units', [contractId]);
  const groups = await db.query(`select e.id as edition_id, e.ref, e.format, e.rrp_cents, s.channel, sum(s.units)::int as units, sum(s.receipts_cents)::bigint as receipts,
      e.prior_units + coalesce((select sum(x.units) from sales x where x.edition_id = e.id and x.sold_on < $2), 0)::int as cum
    from sales s join editions e on e.id = s.edition_id where e.work_id = $1 and s.sold_on between $2 and $3
    group by e.id, s.channel order by e.ref, s.channel`, [c.work_id, period.starts_on, period.ends_on]);
  const lines = [];
  const cumByEdition = {};
  for (const g of groups) {
    const cum = cumByEdition[g.edition_id] ?? g.cum;
    cumByEdition[g.edition_id] = cum + g.units;
    const tiers = rateRows.filter((r) => r.format === g.format && r.channel === g.channel);
    if (!tiers.length) {
      lines.push({ edition_id: g.edition_id, line_type: 'sales', description: `No rate in the contract for ${g.format} ${g.channel} sales`, format: g.format, channel: g.channel, basis: null, rate_bps: 0, units: g.units, base_cents: 0, royalty_cents: 0 });
      continue;
    }
    let receiptsLeft = Number(g.receipts);
    const parts = allocate(cum, g.units, tiers);
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const base = part.tier.basis === 'rrp' ? part.units * Number(g.rrp_cents)
        : last ? receiptsLeft : Math.round((Number(g.receipts) * part.units) / g.units);
      if (part.tier.basis !== 'rrp') receiptsLeft -= base;
      const royalty = Math.round((base * part.tier.rate_bps * c.share_bps) / 1e8);
      lines.push({ edition_id: g.edition_id, line_type: 'sales', description: `${g.ref} ${g.channel}${part.tier.from_units ? ` from ${part.tier.from_units} copies` : ''}`, format: g.format, channel: g.channel, basis: part.tier.basis, rate_bps: part.tier.rate_bps, units: part.units, base_cents: base, royalty_cents: royalty });
    });
  }
  const income = await db.query(`select ri.ref, ri.amount_cents, d.right_type, d.licensee, coalesce(ss.author_share_bps, 0) as share
    from rights_income ri join rights_deals d on d.id = ri.deal_id left join subrights_shares ss on ss.contract_id = $1 and ss.right_type = d.right_type
    where d.work_id = $2 and ri.received_on between $3 and $4 order by ri.ref`, [contractId, c.work_id, period.starts_on, period.ends_on]);
  for (const r of income) {
    lines.push({ edition_id: null, line_type: 'subrights', description: `${r.right_type} rights, ${r.licensee} (${r.ref})${Number(r.share) ? '' : ': no author share in the contract'}`, format: null, channel: null, basis: null, rate_bps: Number(r.share), units: 0, base_cents: Number(r.amount_cents), royalty_cents: Math.round((Number(r.amount_cents) * Number(r.share) * c.share_bps) / 1e8) });
  }
  const sum = (xs) => xs.reduce((m, l) => m + l.royalty_cents, 0);
  const earned = sum(lines.filter((l) => l.line_type === 'sales'));
  const subrights = sum(lines.filter((l) => l.line_type === 'subrights'));
  const print = sum(lines.filter((l) => l.line_type === 'sales' && PRINT.has(l.format)));
  const reserveHeld = print > 0 ? Math.round((print * reserveBps) / 10000) : 0;
  const reserveReleased = prev ? Number(prev.reserve_held_cents) : 0;
  const balance = opening - advancesPaid + earned + subrights + reserveReleased - reserveHeld;
  const gross = balance >= minimum ? balance : 0;
  const nonResident = c.tax_country !== c.country;
  const whtBps = nonResident ? (c.treaty_rate_bps ?? c.withholding_default_bps) : 0;
  const withholding = Math.round((gross * whtBps) / 10000);
  const gst = c.gst_registered && !nonResident ? Math.round((gross * c.gst_bps) / 10000) : 0;
  return {
    contract: c, lines,
    row: {
      ref: `${period.ref}-${c.ref}`, period_id: period.id, contract_id: contractId, currency: c.currency,
      opening_cents: opening, advances_paid_cents: advancesPaid, earned_cents: earned, subrights_cents: subrights,
      reserve_released_cents: reserveReleased, reserve_held_cents: reserveHeld, balance_cents: balance,
      gross_payable_cents: gross, withholding_cents: withholding, gst_cents: gst, net_payment_cents: gross - withholding + gst,
      carry_forward_cents: gross ? 0 : balance, due_on: addDays(period.ends_on, c.statement_days),
    },
  };
}

export async function runStatements(db, periodRef, opt = {}) {
  const pr = await resolve(db, 'period', periodRef || fail('Say which royalty period: run-statements S2'));
  const [period] = await db.query('select id, ref, starts_on::text, ends_on::text from royalty_periods where id = $1', [pr.id]);
  const today = await isoToday(db);
  if (period.ends_on >= today && !opt.early) fail(`${period.ref} ends ${period.ends_on}. Run statements once the period has closed, or pass --early for a preview.`);
  const only = opt.contract ? (await resolve(db, 'contract', opt.contract)).id : null;
  const contracts = await db.query(`select c.id, c.ref from contracts c cross join royalty_periods rp where rp.id = $1 and (${ELIGIBLE}) and ${HAS_ACTIVITY} ${only ? 'and c.id = $2' : ''} order by c.ref`, only ? [period.id, only] : [period.id]);
  // An earlier period with an eligible contract and no statement means the run order is broken.
  for (const c of contracts) {
    const gaps = await db.query(`select rp.ref from royalty_periods rp, contracts c where c.id = $1 and rp.ends_on < $2 and (${ELIGIBLE}) and ${HAS_ACTIVITY}
      and (c.opening_as_of is null or rp.ends_on > c.opening_as_of) and not exists (select 1 from statements s where s.period_id = rp.id and s.contract_id = c.id)`, [c.id, period.starts_on]);
    if (gaps.length) fail(`${c.ref} has no statement for ${gaps.map((g) => g.ref).join(', ')}. Run the periods in order.`);
  }
  const result = { period: period.ref, created: [], kept: [], dry_run: !!opt.dry_run };
  await db.exec('BEGIN');
  try {
    for (const c of contracts) {
      const [existing] = await db.query('select id, status from statements where period_id = $1 and contract_id = $2', [period.id, c.id]);
      if (existing && existing.status !== 'draft') { result.kept.push({ contract: c.ref, status: existing.status }); continue; }
      if (existing) await db.query('delete from statements where id = $1', [existing.id]);
      const { row, lines } = await computeStatement(db, period, c.id);
      const keys = Object.keys(row);
      const [st] = await db.query(`insert into statements (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id, ref`, keys.map((k) => row[k]));
      for (const l of lines) {
        await db.query(`insert into statement_lines (statement_id, edition_id, line_type, description, format, channel, basis, rate_bps, units, base_cents, royalty_cents)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [st.id, l.edition_id, l.line_type, l.description, l.format, l.channel, l.basis, l.rate_bps, l.units, l.base_cents, l.royalty_cents]);
      }
      result.created.push({ ref: st.ref, contract: c.ref, earned_cents: row.earned_cents + row.subrights_cents, balance_cents: row.balance_cents, net_payment_cents: row.net_payment_cents, currency: row.currency, warnings: lines.filter((l) => /^No rate|no author share/.test(l.description) || /no author share/.test(l.description)).map((l) => l.description) });
    }
    await db.exec(opt.dry_run ? 'ROLLBACK' : 'COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
  return result;
}

// approve, mark-sent and mark-paid take one statement ref or a whole period.
async function moveStatements(db, target, from, to, opt) {
  if (!target) fail('Say which statement or period');
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  if (date > await isoToday(db)) fail('The date is today or earlier');
  let ids;
  const [period] = await db.query('select id from royalty_periods where lower(ref) = lower($1)', [target]);
  if (period) ids = (await db.query('select id from statements where period_id = $1 and status = $2', [period.id, from])).map((r) => r.id);
  else {
    const s = await resolve(db, 'statement', target);
    const [cur] = await db.query('select status, net_payment_cents from statements where id = $1', [s.id]);
    if (cur.status !== from) fail(`${s.ref} is ${cur.status}; this applies to a ${from} statement`);
    ids = [s.id];
  }
  if (to === 'paid') ids = (await db.query('select id from statements where id = any($1::uuid[]) and net_payment_cents > 0', [ids])).map((r) => r.id);
  if (!ids.length) fail(`No ${from} statements to move${to === 'paid' ? ' with a payment due' : ''}`);
  const col = to === 'sent' ? ', sent_on = $2' : to === 'paid' ? ', paid_on = $2' : '';
  return db.query(`update statements set status = '${to}'${col} where id = any($1::uuid[]) returning ref, status, sent_on, paid_on`, col ? [ids, date] : [ids]);
}

// ------------------------------------------------------------------ compliance

async function compliance(db) {
  const out = [];
  const today = await isoToday(db);
  const soon = await setting(db, 'statement_due_soon_days');
  const juris = Object.fromEntries((await db.query('select * from jurisdictions')).map((j) => [j.country, j]));
  for (const d of await deposits(db)) {
    const country = d.library.includes('Australia') ? 'AU' : 'NZ';
    const j = juris[country];
    const rule = `Legal deposit: ${d.copies_required} cop${d.copies_required === 1 ? 'y' : 'ies'} to the ${d.library} within ${j.deposit_period} ${j.deposit_unit === 'months' ? 'month' : 'working days'} of publication`;
    const state = { ok: 'ok', short: 'breach', late: 'breach', due: 'due' }[d.state];
    const detail = d.state === 'ok' ? `Deposited ${d.deposited_on}` : d.state === 'short' ? `${d.copies_sent} of ${d.copies_required} copies sent` : `${d.edition} ${d.title} published ${d.pub_date}; deadline ${d.deadline}; nothing recorded`;
    out.push({ rule, item: d.edition, state, detail, source: j.sources.split(' ; ')[0] });
  }
  const payees = await db.query(`select distinct p.ref, p.name, p.tax_country, p.gst_registered, p.gst_number, p.tax_invoice_agreement_on, p.treaty_rate_bps, i.country, j.withholding_default_bps, j.gst_bps, j.sources
    from contracts c join contributors p on p.id = c.contributor_id join works w on w.id = c.work_id join imprints i on i.id = w.imprint_id join jurisdictions j on j.country = i.country
    where c.status = 'signed' order by p.ref`);
  for (const p of payees) {
    if (p.tax_country !== p.country) {
      const rule = `${p.country === 'AU' ? 'Australian' : 'New Zealand'} withholding on royalties paid to a non-resident: ${pct(p.withholding_default_bps)} unless a tax treaty sets a lower rate`;
      out.push(p.treaty_rate_bps === null
        ? { rule, item: `${p.ref} ${p.name}`, state: 'check', detail: `Resident in ${p.tax_country}; no treaty rate recorded, so ${pct(p.withholding_default_bps)} is withheld. Record the treaty rate once residence is evidenced.`, source: p.sources.split(' ; ').at(-1) }
        : { rule, item: `${p.ref} ${p.name}`, state: 'ok', detail: `Resident in ${p.tax_country}; treaty rate ${pct(p.treaty_rate_bps)} recorded`, source: p.sources.split(' ; ').at(-1) });
    } else if (p.gst_registered) {
      const rule = `GST on royalties to a registered ${p.country === 'AU' ? 'Australian' : 'New Zealand'} payee: the publisher issues the tax invoice only under a written agreement with them`;
      const source = p.country === 'AU' ? 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices' : 'https://www.ird.govt.nz/gst/tax-invoices-for-gst/buyer-created-taxable-supply-information';
      if (!p.tax_invoice_agreement_on) out.push({ rule, item: `${p.ref} ${p.name}`, state: 'breach', detail: `GST-registered, ${pct(p.gst_bps)} is added to payments, and no agreement date is recorded`, source });
      else if (!p.gst_number) out.push({ rule, item: `${p.ref} ${p.name}`, state: 'check', detail: 'Agreement recorded but no GST number to print on the remittance', source });
      else out.push({ rule, item: `${p.ref} ${p.name}`, state: 'ok', detail: `Agreement dated ${p.tax_invoice_agreement_on}`, source });
    }
  }
  for (const s of await statementDeadlines(db)) {
    const late = s.due_on < today;
    const state = s.status === 'sent' || s.status === 'paid' ? (s.sent_on > s.due_on ? 'info' : 'ok') : late ? 'breach' : daysBetween(today, s.due_on) <= soon ? 'due' : 'ok';
    if (state === 'ok' && s.status !== 'sent' && s.status !== 'paid') continue;
    out.push({ rule: `Statements go out within the days the contract sets (${s.statement_days} days for ${s.contract})`, item: `${s.period} ${s.contract}`, state,
      detail: s.status === 'sent' || s.status === 'paid' ? `Sent ${s.sent_on}, due ${s.due_on}` : `${s.status === 'none' ? 'No statement run yet' : `Statement is ${s.status}`}; due ${s.due_on}${late ? `, ${daysBetween(s.due_on, today)} days late` : ''}`, source: 'The author contract' });
  }
  const rank = { breach: 0, due: 1, check: 2, info: 3, ok: 4 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || a.item.localeCompare(b.item));
}

// Every closed period against every contract that should have a statement for it.
async function statementDeadlines(db) {
  return db.query(`select rp.ref as period, c.ref as contract, c.statement_days, (rp.ends_on + c.statement_days)::text as due_on,
      coalesce(s.status, 'none') as status, s.sent_on::text as sent_on
    from royalty_periods rp cross join contracts c left join statements s on s.period_id = rp.id and s.contract_id = c.id
    where rp.ends_on < current_date and (${ELIGIBLE}) and ${HAS_ACTIVITY} and (c.opening_as_of is null or rp.ends_on > c.opening_as_of)
    order by rp.ends_on, c.ref`);
}

// ------------------------------------------------------------------ attention

async function missingRates(db) {
  return db.query(`select distinct c.ref as contract, e.ref as edition, e.format, s.channel
    from sales s join editions e on e.id = s.edition_id join contracts c on c.work_id = e.work_id
    where c.status = 'signed' and s.sold_on > current_date - 400
      and not exists (select 1 from royalty_rates r where r.contract_id = c.id and r.format = e.format and r.channel = s.channel)
    order by c.ref, e.ref`);
}

async function attention(db) {
  const s = {};
  for (const k of ['statement_due_soon_days', 'rights_expiry_days', 'unsigned_pub_days']) s[k] = await setting(db, k);
  const today = await isoToday(db);
  const out = [];
  const add = (category, item, why) => out.push({ category, item, why });
  for (const r of await statementDeadlines(db)) {
    if (r.status === 'sent' || r.status === 'paid') continue;
    const what = r.status === 'none' ? 'no statement run yet' : `statement is ${r.status}`;
    if (r.due_on < today) add('Statement overdue', `${r.period} ${r.contract}`, `${what}; the contract says ${r.statement_days} days, due ${r.due_on}, ${daysBetween(r.due_on, today)} days late`);
    else if (daysBetween(today, r.due_on) <= s.statement_due_soon_days) add('Statement due soon', `${r.period} ${r.contract}`, `${what}; due ${r.due_on}`);
  }
  for (const r of await db.query(`select s.ref, s.net_payment_cents, s.currency, s.sent_on from statements s where s.status = 'sent' and s.net_payment_cents > 0 order by s.sent_on`))
    add('Payment not made', r.ref, `${money(r.net_payment_cents, r.currency)} on a statement sent ${r.sent_on}`);
  for (const r of await advances(db, { unpaid: true })) if (r.days_overdue !== null) add('Advance due', `${r.ref} ${r.title}`, `${money(r.amount_cents, r.currency)} on ${r.trigger} to ${r.payee}, due ${r.due_on}, ${r.days_overdue} days overdue`);
  for (const r of await db.query(READS.manuscripts)) if (r.days_late) add('Manuscript late', `${r.ref} ${r.title}`, `due ${r.delivery_due_on}, ${r.days_late} days late${r.first_pub ? `; publishing ${r.first_pub}` : ''}`);
  for (const r of await schedule(db, { days: s.unsigned_pub_days })) if (r.contract !== 'signed' && r.days_to_pub >= 0) add('Contract not signed', `${r.edition} ${r.title}`, `publishes in ${r.days_to_pub} days and the contract is ${r.contract}`);
  for (const r of await deposits(db)) if (r.state !== 'ok') add('Legal deposit', `${r.edition} ${r.title}`, r.state === 'due' ? `${r.copies_required} to the ${r.library} by ${r.deadline}` : `${r.copies_sent} of ${r.copies_required} copies to the ${r.library}; deadline was ${r.deadline}`);
  for (const r of await db.query(`select ri.ref, d.licensee, ri.amount_cents, ri.expected_on, i.currency, current_date - ri.expected_on as days from rights_income ri join rights_deals d on d.id = ri.deal_id join works w on w.id = d.work_id join imprints i on i.id = w.imprint_id where ri.received_on is null and ri.expected_on < current_date order by ri.expected_on`))
    add('Rights income overdue', `${r.ref} ${r.licensee}`, `${money(r.amount_cents, r.currency)} expected ${r.expected_on}, ${r.days} days ago`);
  for (const r of await db.query(`select d.ref, d.licensee, d.right_type, w.title, d.expires_on, d.expires_on - current_date as days from rights_deals d join works w on w.id = d.work_id where d.status = 'signed' and d.expires_on between current_date and current_date + $1::int order by d.expires_on`, [s.rights_expiry_days]))
    add('Rights licence expiring', `${r.ref} ${r.title}`, `${r.right_type} licence to ${r.licensee} ends ${r.expires_on}, in ${r.days} days`);
  for (const r of await reversions(db)) {
    if (r.status === 'reverted') continue;
    if (r.reversion_requested_on) add('Reversion requested', `${r.contract} ${r.title}`, `${r.contributor} asked for the rights back on ${r.reversion_requested_on}`);
    else if (r.months_out_of_print >= r.reversion_months) add('Reversion clause live', `${r.contract} ${r.title}`, `out of print ${r.months_out_of_print} months; the contract lets ${r.contributor} ask for the rights back after ${r.reversion_months}`);
  }
  for (const r of await missingRates(db)) add('No royalty rate', `${r.contract} ${r.edition}`, `${r.format} ${r.channel} sales recorded and the contract has no rate for them, so they earn nothing on the statement`);
  for (const r of await compliance(db)) if (r.state === 'breach' && /GST|withholding/.test(r.rule)) add('Tax details', r.item, r.detail);
  return out;
}

// ------------------------------------------------------------------ workflow

async function payAdvance(db, ref, opt) {
  const a = await resolve(db, 'advance', ref);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  return db.query(`update advances set paid_on = $2 where id = $1 and paid_on is null returning ref, amount_cents, paid_on`, [a.id, date])
    .then((rows) => rows.length ? rows : fail(`${a.ref} is already paid`));
}

async function deliverManuscript(db, ref, opt) {
  const w = await resolve(db, 'work', ref);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  return db.query(`update works set delivered_on = $2, status = case when status = 'acquired' then 'in_production' else status end where id = $1 returning ref, title, delivered_on, status`, [w.id, date]);
}

async function recordDeposit(db, ref, opt) {
  const e = await resolve(db, 'edition', ref);
  const [d] = await db.query(`select library, copies_required from deposit_status where edition_id = $1`, [e.id]);
  if (!d && !opt.library) fail(`${e.ref} is not a published print edition; give --library to record it anyway`);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  return [await addRecord(db, 'deposit', { edition: e.id, library: opt.library || d.library, copies: opt.copies || d.copies_required, sent_on: date })];
}

async function receiveIncome(db, ref, opt) {
  const r = await resolve(db, 'income', ref);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  const amount = opt.amount ? toCents(opt.amount, 'amount') : null;
  return db.query(`update rights_income set received_on = $2, amount_cents = coalesce($3, amount_cents) where id = $1 returning ref, amount_cents, received_on`, [r.id, date, amount]);
}

async function reversionStep(db, ref, opt, step) {
  const c = await resolve(db, 'contract', ref);
  const date = opt.date ? checkDate(opt.date) : await isoToday(db);
  if (step === 'request') return db.query(`update contracts set reversion_requested_on = $2 where id = $1 returning ref, reversion_requested_on`, [c.id, date]);
  return db.query(`update contracts set status = 'reverted', reverted_on = $2 where id = $1 returning ref, status, reverted_on`, [c.id, date]);
}

// ------------------------------------------------------------------ import and export

const DEFAULT_SALES_MAP = { isbn: ['ISBN', 'ISBN13', 'EAN', 'Product'], date: ['Date', 'Sale date', 'Period end', 'Month'], channel: ['Channel', 'Market', 'Territory'], units: ['Units', 'Net units', 'Qty', 'Quantity'], receipts: ['Net receipts', 'Receipts', 'Net value', 'Value'] };
const loadMap = (opt, dflt) => { const custom = opt.mapping ? JSON.parse(fs.readFileSync(opt.mapping, 'utf8')) : {}; return Object.fromEntries(Object.entries(dflt).map(([k, v]) => [k, custom[k] ? [custom[k]] : v])); };
const needColumns = (rows, map, keys) => {
  if (!rows.length) fail('The file has no rows');
  const header = Object.keys(rows[0]);
  const missing = keys.filter((k) => !map[k].some((c) => header.some((h) => h.toLowerCase() === c.toLowerCase())));
  if (missing.length) fail(`Could not find the ${missing.join(', ')} column. Columns in the file: ${header.join(', ')}. Pass --mapping=<file.json> naming them.`);
};
const cleanIsbn = (v) => String(v).replace(/[^0-9Xx]/g, '').toUpperCase();
function excelDate(v, at) {
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return checkDate(s.slice(0, 10), at);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return checkDate(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, at);
  if (/^\d{8}$/.test(s)) return checkDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`, at);
  return fail(`${at}: date "${v}" is not YYYY-MM-DD or DD/MM/YYYY`);
}

// Distributor or retailer sales: one row per ISBN, date and channel. Repeat imports skip rows already loaded.
export async function importSales(db, opt) {
  if (!opt.file) fail('Give the sales file: --file=<sales.csv>');
  const map = loadMap(opt, DEFAULT_SALES_MAP);
  const rows = parseCsv(fs.readFileSync(opt.file, 'utf8'));
  needColumns(rows, map, ['isbn', 'date', 'units']);
  const stats = { rows: rows.length, imported: 0, skipped_already_loaded: 0, warnings: [] };
  const seen = {};
  await db.exec('BEGIN');
  try {
    for (const [i, r] of rows.entries()) {
      const at = `CSV row ${i + 2}`;
      const isbn = cleanIsbn(pick(r, ...map.isbn));
      const [e] = await db.query(`select e.id, i.country from editions e join works w on w.id = e.work_id join imprints i on i.id = w.imprint_id where e.isbn = $1`, [isbn]);
      if (!e) fail(`${at}: no edition with ISBN ${isbn || '(blank)'}. Import the title list first (import onix) or add the edition.`);
      const date = excelDate(pick(r, ...map.date), at);
      const ch = pick(r, ...map.channel).trim().toLowerCase();
      const channel = !ch || ['home', 'domestic', 'local'].includes(ch) || ch === e.country.toLowerCase() || (e.country === 'NZ' && /new zealand/.test(ch)) || (e.country === 'AU' && /australia/.test(ch)) ? 'home' : 'export';
      const units = Number(pick(r, ...map.units));
      if (!Number.isInteger(units)) fail(`${at}: units "${pick(r, ...map.units)}" is not a whole number`);
      const rawReceipts = pick(r, ...map.receipts);
      const receipts = rawReceipts === '' ? 0 : toCents(rawReceipts, `${at} receipts`, true);
      const base = [isbn, date, channel, units, receipts].join('|');
      seen[base] = (seen[base] || 0) + 1;
      const key = createHash('sha1').update(`${base}|${seen[base]}`).digest('hex');
      const [exists] = await db.query('select 1 from sales where import_key = $1', [key]);
      if (exists) { stats.skipped_already_loaded++; continue; }
      await db.query(`insert into sales (ref, edition_id, sold_on, channel, units, receipts_cents, source, import_key) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [await nextRef(db, 'sale'), e.id, date, channel, units, receipts, opt.source || path.basename(opt.file), key]);
      stats.imported++;
      if (rawReceipts === '') stats.warnings.push(`${at}: no receipts value; net receipts royalties on this row will be zero`);
    }
    await db.exec(opt.dry_run ? 'ROLLBACK' : 'COMMIT');
  } catch (err) { await db.exec('ROLLBACK'); throw err; }
  return { ...stats, dry_run: !!opt.dry_run };
}

// ONIX 3.0 (and 2.1 reference-tag) product records: ISBN, title, format, price and publication date.
const ONIX_FORM = { BB: 'hardback', BC: 'paperback', BA: 'paperback', BZ: 'paperback', ED: 'ebook', EA: 'ebook', EB: 'ebook', DG: 'ebook', AJ: 'audio', AN: 'audio', AE: 'audio', AC: 'audio' };
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? m[1].trim() : ''; };
const unxml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
export async function importOnix(db, opt) {
  if (!opt.file) fail('Give the ONIX file: --file=<titles.xml>');
  const imprint = await resolve(db, 'imprint', opt.imprint || fail('Say which imprint these titles belong to: --imprint=<ref>'));
  const [imp] = await db.query('select currency from imprints where id = $1', [imprint.id]);
  const xml = fs.readFileSync(opt.file, 'utf8');
  const products = xml.match(/<Product(?:\s[^>]*)?>[\s\S]*?<\/Product>/g) || fail('No <Product> records in the file. Is it an ONIX file?');
  const stats = { products: products.length, works_new: 0, editions_new: 0, editions_updated: 0, warnings: [] };
  await db.exec('BEGIN');
  try {
    for (const [i, p] of products.entries()) {
      const at = `Product ${i + 1}`;
      const ids = p.match(/<ProductIdentifier>[\s\S]*?<\/ProductIdentifier>/g) || [];
      const isbnBlock = ids.find((b) => ['15', '03'].includes(tag(b, 'ProductIDType'))) || '';
      const isbn = cleanIsbn(tag(isbnBlock, 'IDValue') || tag(p, 'ISBN'));
      if (!isbn) fail(`${at}: no ISBN-13 (ProductIDType 15)`);
      const title = unxml(tag(tag(p, 'TitleElement') || tag(p, 'Title') || p, 'TitleText') || tag(p, 'DistinctiveTitle'));
      if (!title) fail(`${at} (${isbn}): no title`);
      const formCode = tag(p, 'ProductForm');
      const format = ONIX_FORM[formCode] || fail(`${at} (${isbn}): product form "${formCode}" is not a book, ebook or audio format this system tracks`);
      const dateBlock = (p.match(/<PublishingDate>[\s\S]*?<\/PublishingDate>/g) || []).find((b) => tag(b, 'PublishingDateRole') === '01') || '';
      const rawDate = tag(dateBlock, 'Date') || tag(p, 'PublicationDate');
      const pub = rawDate ? excelDate(rawDate.slice(0, 8), `${at} publication date`) : null;
      const prices = p.match(/<Price>[\s\S]*?<\/Price>/g) || [];
      const price = prices.find((b) => tag(b, 'CurrencyCode') === imp.currency) || prices[0] || '';
      const rrp = price ? toCents(tag(price, 'PriceAmount'), `${at} price`) : 0;
      if (price && tag(price, 'CurrencyCode') && tag(price, 'CurrencyCode') !== imp.currency) stats.warnings.push(`${at} (${isbn}): no ${imp.currency} price; used ${tag(price, 'CurrencyCode')}`);
      let [work] = await db.query('select id, ref from works where lower(title) = lower($1)', [title]);
      if (!work) { [work] = await db.query(`insert into works (ref, title, imprint_id, status) values ($1, $2, $3, $4) returning id, ref`, [await nextRef(db, 'work'), title, imprint.id, pub && pub <= (await isoToday(db)) ? 'published' : 'in_production']); stats.works_new++; }
      const [existing] = await db.query('select id from editions where isbn = $1', [isbn]);
      if (existing) {
        await db.query('update editions set format = $2, rrp_cents = $3, pub_date = coalesce($4, pub_date) where id = $1', [existing.id, format, rrp, pub]);
        stats.editions_updated++;
      } else {
        let ref = `${work.ref}-${{ hardback: 'HB', paperback: 'PB', ebook: 'EB', audio: 'AU' }[format]}`;
        if ((await db.query('select 1 from editions where ref = $1', [ref])).length) ref = `${ref}-${isbn.slice(-4)}`;
        await db.query(`insert into editions (ref, work_id, isbn, format, rrp_cents, pub_date, status) values ($1, $2, $3, $4, $5, $6, $7)`,
          [ref, work.id, isbn, format, rrp, pub, pub && pub <= (await isoToday(db)) ? 'active' : 'forthcoming']);
        stats.editions_new++;
      }
    }
    await db.exec(opt.dry_run ? 'ROLLBACK' : 'COMMIT');
  } catch (err) { await db.exec('ROLLBACK'); throw err; }
  return { ...stats, dry_run: !!opt.dry_run };
}

// The royalty schedule: one row per contract rate line, plus the balance each contract carries in.
const DEFAULT_CONTRACT_MAP = { contract: ['Contract', 'Contract no', 'Contract number'], title: ['Title', 'Work'], contributor: ['Contributor', 'Author', 'Payee'], signed: ['Signed', 'Contract date'], share: ['Share', 'Share %'], format: ['Format', 'Binding'], channel: ['Channel', 'Market'], basis: ['Basis'], rate: ['Rate', 'Rate %', 'Royalty rate'], from: ['From units', 'From', 'Escalator from'], balance: ['Balance', 'Opening balance'], balance_date: ['Balance date', 'As of'] };
const FORMAT_WORDS = { hardback: 'hardback', hardcover: 'hardback', hb: 'hardback', paperback: 'paperback', pb: 'paperback', 'trade paperback': 'paperback', tpb: 'paperback', ebook: 'ebook', 'e-book': 'ebook', audio: 'audio', audiobook: 'audio' };
export async function importContracts(db, opt) {
  if (!opt.file) fail('Give the royalty schedule: --file=<contracts.csv>');
  const map = loadMap(opt, DEFAULT_CONTRACT_MAP);
  const rows = parseCsv(fs.readFileSync(opt.file, 'utf8'));
  needColumns(rows, map, ['contract', 'title', 'contributor', 'format', 'rate']);
  const stats = { rows: rows.length, contracts_new: 0, contributors_new: 0, rates: 0, warnings: [] };
  await db.exec('BEGIN');
  try {
    for (const [i, r] of rows.entries()) {
      const at = `CSV row ${i + 2}`;
      const ref = pick(r, ...map.contract).trim() || fail(`${at}: no contract number`);
      const title = pick(r, ...map.title).trim();
      const works = await db.query('select w.id, i.country from works w join imprints i on i.id = w.imprint_id where lower(w.title) = lower($1) or lower(w.ref) = lower($1)', [title]);
      if (works.length !== 1) fail(`${at}: ${works.length ? 'more than one work' : 'no work'} called "${title}". Import the title list first (import onix).`);
      const name = pick(r, ...map.contributor).trim() || fail(`${at}: no contributor`);
      let [person] = await db.query('select id from contributors where lower(name) = lower($1)', [name]);
      if (!person) { [person] = await db.query(`insert into contributors (ref, name, tax_country) values ($1, $2, $3) returning id`, [await nextRef(db, 'contributor'), name, works[0].country]); stats.contributors_new++; stats.warnings.push(`${at}: added ${name}; check their tax residence and GST details`); }
      let [c] = await db.query('select id, work_id, contributor_id from contracts where ref = $1', [ref]);
      if (c && (c.work_id !== works[0].id || c.contributor_id !== person.id)) fail(`${at}: contract ${ref} already belongs to another work or contributor`);
      if (!c) {
        const signed = pick(r, ...map.signed) ? excelDate(pick(r, ...map.signed), `${at} signed`) : null;
        const share = pick(r, ...map.share) ? toBps(pick(r, ...map.share), `${at} share`) : 10000;
        const balance = pick(r, ...map.balance) ? toCents(pick(r, ...map.balance), `${at} balance`, true) : 0;
        const asOf = pick(r, ...map.balance_date) ? excelDate(pick(r, ...map.balance_date), `${at} balance date`) : null;
        if (balance && !asOf) fail(`${at}: a carried balance needs the date it was struck (Balance date)`);
        [c] = await db.query(`insert into contracts (ref, work_id, contributor_id, status, signed_on, share_bps, opening_balance_cents, opening_as_of) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [ref, works[0].id, person.id, signed ? 'signed' : 'draft', signed, share, balance, asOf]);
        stats.contracts_new++;
      }
      const format = FORMAT_WORDS[pick(r, ...map.format).trim().toLowerCase()] || fail(`${at}: format "${pick(r, ...map.format)}" is not hardback, paperback, ebook or audio`);
      const ch = pick(r, ...map.channel).trim().toLowerCase();
      const channel = !ch || ['home', 'domestic'].includes(ch) ? 'home' : ['export', 'overseas'].includes(ch) ? 'export' : fail(`${at}: channel "${ch}" is not home or export`);
      const b = pick(r, ...map.basis).trim().toLowerCase();
      const basis = !b || /rrp|retail|published/.test(b) ? 'rrp' : /net|receipt/.test(b) ? 'net_receipts' : fail(`${at}: basis "${b}" is not RRP or net receipts`);
      const from = pick(r, ...map.from) ? Number(pick(r, ...map.from)) : 0;
      if (!Number.isInteger(from) || from < 0) fail(`${at}: escalator start "${pick(r, ...map.from)}" is not a whole number`);
      await db.query(`insert into royalty_rates (contract_id, format, channel, basis, rate_bps, from_units) values ($1, $2, $3, $4, $5, $6)
        on conflict (contract_id, format, channel, from_units) do update set basis = excluded.basis, rate_bps = excluded.rate_bps`, [c.id, format, channel, basis, toBps(pick(r, ...map.rate), `${at} rate`), from]);
      stats.rates++;
    }
    await db.exec(opt.dry_run ? 'ROLLBACK' : 'COMMIT');
  } catch (err) { await db.exec('ROLLBACK'); throw err; }
  return { ...stats, dry_run: !!opt.dry_run };
}

const TABLES = ['imprints', 'contributors', 'works', 'editions', 'contracts', 'royalty_rates', 'advances', 'subrights_shares', 'rights_deals', 'rights_income', 'sales', 'royalty_periods', 'statements', 'statement_lines', 'legal_deposits', 'audit_events', 'settings', 'jurisdictions'];
const csvCell = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function exportAll(db, opt) {
  const dir = path.resolve(opt.out || path.join(process.env.OUTPUT_DIR || REPO_ROOT, 'exports', new Date().toISOString().slice(0, 10)));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const snap = { exported_at: new Date().toISOString(), tables: {} };
  const counts = {};
  for (const t of TABLES) {
    const rows = await db.query(`select * from ${t}`);
    snap.tables[t] = rows; counts[t] = rows.length;
    const cols = rows.length ? Object.keys(rows[0]) : [];
    fs.writeFileSync(path.join(dir, `${t}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  }
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snap, null, 1), { flag: 'wx', mode: 0o600 });
  return { dir, counts };
}

// ------------------------------------------------------------------ drafts (never sent)

function writeDraft(name, lines) {
  const dir = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${name}.md`);
  fs.writeFileSync(file, ['> DRAFT: written by Publishing Royalties for Claude Code. Read it, change it, a person sends it.', '', ...lines, ''].join('\n'), { mode: 0o600 });
  return { file };
}
const mdTable = (rows, cols) => rows.length ? [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)] : ['Nothing to report.'];

async function draftStatementLetter(db, ref) {
  const { statement: [s], lines } = await statementCard(db, ref);
  const [p] = await db.query(`select p.name, p.agent, rp.name as period from statements st join contracts c on c.id = st.contract_id join contributors p on p.id = c.contributor_id join royalty_periods rp on rp.id = st.period_id where st.ref = $1`, [s.ref]);
  const m = (v) => money(v, s.currency);
  return writeDraft(`statement-letter-${s.ref}`, [
    `# Royalty statement: ${s.title}`, '', `Dear ${p.agent ? `${p.name} (care of ${p.agent})` : p.name},`, '',
    `Your statement for ${s.title}, ${p.period}, is attached. In short:`, '',
    `- Royalties earned this period: ${m(s.earned_cents)}`, ...(Number(s.subrights_cents) ? [`- Your share of rights income: ${m(s.subrights_cents)}`] : []),
    `- Reserve held against returns: ${m(s.reserve_held_cents)}`,
    Number(s.net_payment_cents) > 0 ? `- Payment to you: ${m(s.net_payment_cents)}${Number(s.withholding_cents) ? ` after ${m(s.withholding_cents)} withholding tax` : ''}${Number(s.gst_cents) ? `, including ${m(s.gst_cents)} GST` : ''}`
      : Number(s.carry_forward_cents) < 0 ? `- The advance is not yet earned out: ${m(-s.carry_forward_cents)} to go` : `- ${m(s.carry_forward_cents)} carries forward to the next statement`,
    '', '## Sales this period', ...mdTable(lines.filter((l) => l.line_type === 'sales'), ['edition', 'channel', 'units', 'rate_bps', 'royalty_cents']), '',
  ]);
}

async function draftRightsChase(db, ref) {
  const r = await resolve(db, 'income', ref);
  const [x] = await db.query(`select ri.ref, ri.amount_cents, ri.expected_on, ri.note, d.licensee, d.right_type, d.language, d.signed_on, w.title, i.currency
    from rights_income ri join rights_deals d on d.id = ri.deal_id join works w on w.id = d.work_id join imprints i on i.id = w.imprint_id where ri.id = $1`, [r.id]);
  return writeDraft(`rights-chase-${x.ref}`, [
    `# ${x.title}: payment due under our ${x.right_type} licence`, '', `Hello ${x.licensee},`, '',
    `Under the ${x.language ? `${x.language} ` : ''}${x.right_type} licence for ${x.title} signed ${x.signed_on}, ${money(x.amount_cents, x.currency)} (${x.note || 'payment'}) was due on ${x.expected_on}. We have no record of receiving it.`, '',
    'Could you confirm when it was paid, or when it will be, so we can account for it to the author?',
  ]);
}

async function weeklyReview(db) {
  return { attention: await attention(db), statements_due: (await statementDeadlines(db)).filter((r) => !['sent', 'paid'].includes(r.status)), unearned: await db.query(READS.unearned), schedule: await schedule(db, { days: 60 }) };
}

async function draftWeeklyReview(db) {
  const w = await weeklyReview(db);
  return writeDraft('weekly-review', [
    '# Monday review', '', '## Needs attention', ...mdTable(w.attention, ['category', 'item', 'why']), '',
    '## Statements still to go out', ...mdTable(w.statements_due, ['period', 'contract', 'status', 'due_on']), '',
    '## Publishing in the next 60 days', ...mdTable(w.schedule, ['edition', 'title', 'pub_date', 'contract', 'manuscript']), '',
    '## Advances not yet earned out', ...mdTable(w.unearned.map((r) => ({ ...r, unearned: money(r.unearned_cents, r.currency) })), ['contract', 'title', 'unearned', 'pct_earned']),
  ]);
}

// ------------------------------------------------------------------ router

const HELP = `Publishing Royalties for Claude Code

Reads:   titles | editions | contracts | contributors | imprints | periods | rates <contract> | advances [--unpaid]
         unearned | statements [--period= --status= --contract=] | statement <ref> | sales [--edition= --work= --period=]
         rights | rights-available [--work=] | schedule [--days=120] | manuscripts | deposits | reversions
         compliance | attention | weekly-review | card <type> <name> | audit
Writes:  add <type> --field=value ... | set <type> <name> --field=value ...
         add rate --contract= --format= --channel=home|export --basis=rrp|net_receipts --rate=10 [--from=5000]
         add share --contract= --right=translation --share=80
         pay-advance <ref> [--date=]   deliver <work> [--date=]   deposit <edition> [--copies= --date= --library=]
         receive <income> [--date= --amount=]   request-reversion <contract> [--date=]   revert <contract> [--date=]
Run:     run-statements <period> [--contract= --dry-run --early]   approve <statement|period>
         mark-sent <statement|period> [--date=]   mark-paid <statement|period> [--date=]
Moving:  import onix --file=<titles.xml> --imprint=<ref> [--dry-run]
         import contracts --file=<schedule.csv> [--mapping=<map.json> --dry-run]
         import sales --file=<sales.csv> [--mapping=<map.json> --source= --dry-run]
         export [--out=<dir>]
Drafts:  draft-statement-letter <statement> | draft-rights-chase <income> | draft-weekly-review   (written to drafts/, never sent)
Types:   ${Object.keys(ENTITIES).join(', ')}, rate, share
Add --json to any command for machine output. Percentages are typed as percentages: --rate=12.5`;

export async function execute(db, argv) {
  const { pos, opt } = parseArgs(argv);
  const [cmd, a, b] = pos;
  switch (cmd) {
    case undefined: case 'help': return { help: HELP };
    case 'titles': case 'editions': case 'contracts': case 'contributors': case 'imprints': case 'periods': case 'unearned': case 'rights': case 'manuscripts': case 'audit': return db.query(READS[cmd]);
    case 'rates': return rates(db, a);
    case 'advances': return advances(db, opt);
    case 'statements': return statements(db, opt);
    case 'statement': return statementCard(db, a);
    case 'sales': return sales(db, opt);
    case 'rights-available': return rightsAvailable(db, opt);
    case 'schedule': return schedule(db, opt);
    case 'deposits': return deposits(db);
    case 'reversions': return reversions(db);
    case 'compliance': return compliance(db);
    case 'attention': return attention(db);
    case 'weekly-review': return weeklyReview(db);
    case 'card': { const e = ENTITIES[a] || fail(`Unknown record type: ${a}`); const r = await resolve(db, a, b); return db.query(`select * from ${e.table} where id = $1`, [r.id]); }
    case 'add':
      if (a === 'rate') return tx(db, () => addRate(db, opt));
      if (a === 'share') return tx(db, () => addShare(db, opt));
      return [await tx(db, () => addRecord(db, a, opt))];
    case 'set': return [await tx(db, () => setRecord(db, a, b, opt))];
    case 'pay-advance': return payAdvance(db, a, opt);
    case 'deliver': return deliverManuscript(db, a, opt);
    case 'deposit': return recordDeposit(db, a, opt);
    case 'receive': return receiveIncome(db, a, opt);
    case 'request-reversion': return reversionStep(db, a, opt, 'request');
    case 'revert': return reversionStep(db, a, opt, 'revert');
    case 'run-statements': return runStatements(db, a, opt);
    case 'approve': return tx(db, () => moveStatements(db, a, 'draft', 'approved', opt));
    case 'mark-sent': return tx(db, () => moveStatements(db, a, 'approved', 'sent', opt));
    case 'mark-paid': return tx(db, () => moveStatements(db, a, 'sent', 'paid', opt));
    case 'import':
      if (a === 'onix') return importOnix(db, opt);
      if (a === 'sales') return importSales(db, opt);
      if (a === 'contracts') return importContracts(db, opt);
      return fail('Import source: onix, contracts or sales');
    case 'export': return exportAll(db, opt);
    case 'draft-statement-letter': return draftStatementLetter(db, a);
    case 'draft-rights-chase': return draftRightsChase(db, a);
    case 'draft-weekly-review': return draftWeeklyReview(db);
    default: fail(`Unknown command: ${cmd}\n\n${HELP}`);
  }
}

// ------------------------------------------------------------------ printing

function columnsFor(rows) {
  return Object.keys(rows[0]).filter((k) => k !== 'id' && !/_id$/.test(k) && k !== 'currency' && k !== 'warnings').map((k) => ({
    key: k, label: k.replace(/_cents$/, '').replace(/_bps$/, ' %').replace(/_/g, ' '),
    align: /_cents$|_bps$|units|days|pct|statements|sent|drafts|copies|months/.test(k) ? 'right' : 'left', width: 70,
    format: /_cents$/.test(k) ? (v, r) => (v === null || v === undefined ? '' : money(v, r.currency || 'NZD'))
      : /_bps$/.test(k) ? (v) => (v === null || v === undefined ? '' : pct(v))
      : (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v),
  }));
}
function print(out) {
  if (out?.help) return console.log(out.help);
  if (Array.isArray(out)) return console.log(out.length ? table(out, columnsFor(out)) : '  (none)');
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) { console.log(heading(k.replace(/_/g, ' '))); console.log(v.length ? table(v, columnsFor(v)) : '  (none)'); }
    else console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const db = await getDb();
  try {
    const out = await execute(db, argv);
    if (json) console.log(JSON.stringify(out, null, 2)); else print(out);
  } catch (err) {
    console.error(err instanceof UserError ? err.message : `Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
