-- Publishing Royalties for Claude Code: the schema.
-- Imprints, contributors, works and editions, author contracts with escalating royalty rates,
-- advances, sub-rights deals and income, sales, royalty periods and statements, and legal deposit,
-- for a book publisher in New Zealand or Australia.
-- Plain Postgres. Runs on any Postgres 14+ and on the embedded PGlite.

create table settings (key text primary key, value integer not null check (value >= 0), meaning text not null default '');
insert into settings values
 ('reserve_bps', 1500, 'Share of print royalties held back against returns each period, in basis points (1500 = 15%). Released on the next statement.'),
 ('minimum_payment_cents', 5000, 'A balance below this is carried forward, not paid.'),
 ('advance_due_days', 30, 'An advance instalment is due this many days after its trigger (signing, delivery, publication).'),
 ('statement_due_soon_days', 45, 'A statement due within this many days is flagged.'),
 ('rights_expiry_days', 90, 'A rights licence expiring within this many days is flagged.'),
 ('unsigned_pub_days', 90, 'An edition publishing within this many days with no signed contract is flagged.');

-- The rules that differ by country. Each row cites its sources (docs/compliance.md).
create table jurisdictions (
  country text primary key check (country in ('NZ', 'AU')),
  gst_bps integer not null check (gst_bps between 0 and 10000),
  withholding_default_bps integer not null check (withholding_default_bps between 0 and 10000),
  deposit_library text not null,
  deposit_copies integer not null check (deposit_copies > 0),
  deposit_period integer not null check (deposit_period > 0),
  deposit_unit text not null check (deposit_unit in ('working_days', 'months')),
  sources text not null);
insert into jurisdictions values
 ('NZ', 1500, 1500, 'National Library of New Zealand', 2, 20, 'working_days',
  'https://www.legislation.govt.nz/secondary-legislation/pco-drafted/2004/129/en/latest/ ; https://natlib.govt.nz/publishers-and-authors/legal-deposit ; https://www.ird.govt.nz/income-tax/withholding-taxes/non-resident-withholding-tax-nrwt/deduct-nrwt-at-the-right-rate/nrwt-rates-for-dta-countries'),
 ('AU', 1000, 3000, 'National Library of Australia', 1, 1, 'months',
  'https://www6.austlii.edu.au/au/legis/cth/consol_act/ca1968133/s195cd.html ; https://www.ato.gov.au/individuals-and-families/coming-to-australia-or-going-overseas/australian-income-of-foreign-residents/withholding-from-royalties-paid-to-foreign-residents');

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table imprints (
  id uuid primary key default gen_random_uuid(), ref text unique not null, name text not null,
  country text not null references jurisdictions,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table contributors (
  id uuid primary key default gen_random_uuid(), ref text unique not null, name text not null,
  role text not null default 'author' check (role in ('author', 'illustrator', 'translator', 'editor', 'estate')),
  email text not null default '', agent text not null default '',
  tax_country text not null default 'NZ' check (tax_country ~ '^[A-Z]{2}$'),
  gst_registered boolean not null default false,
  gst_number text not null default '', tax_invoice_agreement_on date,
  treaty_rate_bps integer check (treaty_rate_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table works (
  id uuid primary key default gen_random_uuid(), ref text unique not null, title text not null,
  imprint_id uuid not null references imprints,
  status text not null default 'acquired' check (status in ('acquired', 'in_production', 'published', 'out_of_print')),
  delivery_due_on date, delivered_on date, out_of_print_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table editions (
  id uuid primary key default gen_random_uuid(), ref text unique not null, work_id uuid not null references works,
  isbn text unique, format text not null check (format in ('hardback', 'paperback', 'ebook', 'audio')),
  rrp_cents bigint not null default 0 check (rrp_cents >= 0),
  pub_date date, print_run integer check (print_run >= 0),
  prior_units integer not null default 0,
  status text not null default 'forthcoming' check (status in ('forthcoming', 'active', 'out_of_print')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table contracts (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  work_id uuid not null references works, contributor_id uuid not null references contributors,
  status text not null default 'draft' check (status in ('draft', 'signed', 'reverted', 'terminated')),
  signed_on date, territory text not null default 'World English',
  share_bps integer not null default 10000 check (share_bps between 1 and 10000),
  statement_days integer not null default 90 check (statement_days > 0),
  reversion_months integer check (reversion_months > 0),
  reversion_requested_on date, reverted_on date,
  opening_balance_cents bigint not null default 0, opening_as_of date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'signed' or signed_on is not null));

create table royalty_rates (
  id uuid primary key default gen_random_uuid(), contract_id uuid not null references contracts on delete cascade,
  format text not null check (format in ('hardback', 'paperback', 'ebook', 'audio')),
  channel text not null check (channel in ('home', 'export')),
  basis text not null check (basis in ('rrp', 'net_receipts')),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  from_units integer not null default 0 check (from_units >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (contract_id, format, channel, from_units));

create table advances (
  id uuid primary key default gen_random_uuid(), ref text unique not null, contract_id uuid not null references contracts,
  trigger text not null check (trigger in ('signing', 'delivery', 'publication')),
  amount_cents bigint not null check (amount_cents > 0), paid_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table subrights_shares (
  id uuid primary key default gen_random_uuid(), contract_id uuid not null references contracts on delete cascade,
  right_type text not null check (right_type in ('translation', 'audio', 'film_tv', 'serial', 'us', 'uk', 'large_print', 'other')),
  author_share_bps integer not null check (author_share_bps between 0 and 10000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (contract_id, right_type));

create table rights_deals (
  id uuid primary key default gen_random_uuid(), ref text unique not null, work_id uuid not null references works,
  right_type text not null check (right_type in ('translation', 'audio', 'film_tv', 'serial', 'us', 'uk', 'large_print', 'other')),
  licensee text not null, territory text not null default '', language text not null default '',
  status text not null default 'offered' check (status in ('offered', 'signed', 'expired', 'cancelled')),
  signed_on date, expires_on date, advance_cents bigint not null default 0 check (advance_cents >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table rights_income (
  id uuid primary key default gen_random_uuid(), ref text unique not null, deal_id uuid not null references rights_deals,
  expected_on date, received_on date, amount_cents bigint not null check (amount_cents > 0), note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table sales (
  id uuid primary key default gen_random_uuid(), ref text unique not null, edition_id uuid not null references editions,
  sold_on date not null, channel text not null check (channel in ('home', 'export')),
  units integer not null, receipts_cents bigint not null default 0,
  source text not null default '', import_key text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table royalty_periods (
  id uuid primary key default gen_random_uuid(), ref text unique not null, name text not null default '',
  starts_on date not null, ends_on date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_on > starts_on));

create table statements (
  id uuid primary key default gen_random_uuid(), ref text unique not null,
  period_id uuid not null references royalty_periods, contract_id uuid not null references contracts,
  currency text not null,
  opening_cents bigint not null, advances_paid_cents bigint not null, earned_cents bigint not null,
  subrights_cents bigint not null, reserve_released_cents bigint not null, reserve_held_cents bigint not null,
  balance_cents bigint not null, gross_payable_cents bigint not null, withholding_cents bigint not null,
  gst_cents bigint not null, net_payment_cents bigint not null, carry_forward_cents bigint not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'paid')),
  due_on date not null, sent_on date, paid_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (period_id, contract_id));

create table statement_lines (
  id uuid primary key default gen_random_uuid(), statement_id uuid not null references statements on delete cascade,
  edition_id uuid references editions, line_type text not null default 'sales' check (line_type in ('sales', 'subrights')),
  description text not null default '', format text, channel text, basis text,
  rate_bps integer not null default 0, units integer not null default 0,
  base_cents bigint not null default 0, royalty_cents bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table legal_deposits (
  id uuid primary key default gen_random_uuid(), ref text unique not null, edition_id uuid not null references editions,
  library text not null, copies integer not null check (copies > 0), sent_on date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table audit_events (
  id bigserial primary key, at timestamptz not null default now(), entity text not null, action text not null,
  row_id uuid, data jsonb);

create or replace function audit_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    insert into audit_events(entity, action, row_id, data) values (tg_table_name, tg_op, old.id, to_jsonb(old));
    return old;
  end if;
  insert into audit_events(entity, action, row_id, data) values (tg_table_name, tg_op, new.id, to_jsonb(new));
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['imprints','contributors','works','editions','contracts','royalty_rates','advances','subrights_shares','rights_deals','rights_income','sales','royalty_periods','statements','legal_deposits'] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
  end loop;
end $$;

create index on editions (work_id);
create index on contracts (work_id);
create index on sales (edition_id, sold_on);
create index on statements (contract_id);
create index on rights_income (deal_id) where received_on is null;

-- Where every contract stands: advances paid, royalties earned on statements, and what is still unearned.
create view contract_position as
select c.id as contract_id, c.ref as contract, w.ref as work, w.title, p.name as contributor, c.status, i.currency,
       coalesce((select sum(a.amount_cents) from advances a where a.contract_id = c.id and a.paid_on is not null), 0)::bigint as advances_paid_cents,
       coalesce((select sum(a.amount_cents) from advances a where a.contract_id = c.id and a.paid_on is null), 0)::bigint as advances_unpaid_cents,
       coalesce((select sum(s.earned_cents + s.subrights_cents) from statements s where s.contract_id = c.id and s.status <> 'draft'), 0)::bigint as earned_to_date_cents,
       (select s.carry_forward_cents from statements s join royalty_periods rp on rp.id = s.period_id
          where s.contract_id = c.id and s.status <> 'draft' order by rp.ends_on desc limit 1) as last_carry_forward_cents,
       (select rp.ref from statements s join royalty_periods rp on rp.id = s.period_id
          where s.contract_id = c.id and s.status <> 'draft' order by rp.ends_on desc limit 1) as last_period,
       w.id as work_id, p.id as contributor_id
from contracts c join works w on w.id = c.work_id join imprints i on i.id = w.imprint_id join contributors p on p.id = c.contributor_id;

-- Lifetime net units per edition, including units sold before the records came across.
create view edition_sales as
select e.id as edition_id, e.ref as edition, w.ref as work, w.title, e.format, e.isbn, e.pub_date, e.status,
       e.prior_units + coalesce(sum(s.units), 0)::integer as lifetime_units,
       coalesce(sum(s.units) filter (where s.sold_on > current_date - 90), 0)::integer as units_90_days,
       coalesce(sum(s.receipts_cents), 0)::bigint as receipts_cents, i.currency, w.id as work_id
from editions e join works w on w.id = e.work_id join imprints i on i.id = w.imprint_id left join sales s on s.edition_id = e.id
group by e.id, w.id, i.currency;

-- Every published print edition against its national legal deposit rule.
create view deposit_status as
select e.id as edition_id, e.ref as edition, w.title, e.format, e.pub_date, i.country, j.deposit_library as library,
       case when e.rrp_cents > 100000 or coalesce(e.print_run, 1000) < 100 then 1 else j.deposit_copies end as copies_required,
       j.deposit_period, j.deposit_unit,
       (select min(d.sent_on) from legal_deposits d where d.edition_id = e.id and d.library = j.deposit_library) as deposited_on,
       (select coalesce(sum(d.copies), 0) from legal_deposits d where d.edition_id = e.id and d.library = j.deposit_library)::integer as copies_sent
from editions e join works w on w.id = e.work_id join imprints i on i.id = w.imprint_id join jurisdictions j on j.country = i.country
where e.format in ('hardback', 'paperback') and e.pub_date is not null and e.pub_date <= current_date;
