-- Demo data: an independent publisher in Wellington with an Australian imprint. Nine works, ten
-- contracts, sales across two closed royalty periods, two rights deals, and the usual loose ends:
-- a statement past its contract deadline, an advance due and unpaid, a late manuscript, an
-- unsigned contract for a book publishing soon, a legal deposit not made, a reversion clause that
-- has gone live, rights income that has not arrived, sales in a format the contract has no rate for,
-- and a GST-registered author with no tax invoice agreement. Every name here is invented.
-- Dates are relative to today so the demo always has something to say. A second run does nothing.
do $$ begin
if exists (select 1 from imprints where ref = 'KSP') then return; end if;
if exists (select 1 from imprints) then raise exception 'Demo seed requires an empty database'; end if;

insert into imprints (ref, name, country, currency) values
 ('KSP', 'Kowhai Street Press', 'NZ', 'NZD'),
 ('TDB', 'Tidepool Books', 'AU', 'AUD');

insert into contributors (ref, name, role, email, agent, tax_country, gst_registered, tax_invoice_agreement_on, treaty_rate_bps) values
 ('A01', 'Mere Paki', 'author', 'mere@example.com', '', 'NZ', true, null, null),
 ('A02', 'Daniel Ashworth', 'author', 'daniel@example.com', 'Hollis and Grey Literary', 'GB', false, null, 1000),
 ('A03', 'Sophie Tran', 'author', 'sophie@example.com', '', 'AU', true, current_date - 500, null),
 ('A04', 'Jack Morrow', 'illustrator', 'jack@example.com', '', 'NZ', false, null, null),
 ('A05', 'Rosa Delgado', 'author', 'rosa@example.com', 'Westbrook Agency', 'US', false, null, null),
 ('A06', 'Estate of Hugh Kerr', 'estate', 'kerr.estate@example.com', '', 'NZ', false, null, null),
 ('A07', 'Tom Baxter', 'author', 'tom.baxter@example.com', '', 'NZ', false, null, null),
 ('A08', 'Tom Bell', 'author', 'tom.bell@example.com', '', 'AU', false, null, null);

insert into works (ref, title, imprint_id, status, delivery_due_on, delivered_on, out_of_print_on)
select v.ref, v.title, i.id, v.status, v.due, v.delivered, v.oop
from (values
 ('W01', 'The Salt Road', 'KSP', 'published', current_date - 600, current_date - 610, null::date),
 ('W02', 'Night Ferry', 'KSP', 'published', current_date - 200, current_date - 210, null),
 ('W03', 'Coastal Kitchen', 'TDB', 'published', current_date - 250, current_date - 260, null),
 ('W04', 'Kiwi Ted Goes Fishing', 'KSP', 'published', current_date - 560, current_date - 560, null),
 ('W05', 'Dry Season', 'TDB', 'published', current_date - 600, current_date - 600, null),
 ('W06', 'High Country Letters', 'KSP', 'out_of_print', null, null, current_date - 730),
 ('W07', 'The Long Paddock', 'TDB', 'acquired', current_date - 15, null, null),
 ('W08', 'Glass Harbour', 'KSP', 'in_production', current_date - 100, current_date - 110, null),
 ('W09', 'Small Mercies', 'KSP', 'in_production', current_date - 40, current_date - 45, null)
) as v(ref, title, imprint, status, due, delivered, oop) join imprints i on i.ref = v.imprint;

insert into editions (ref, work_id, isbn, format, rrp_cents, pub_date, print_run, status)
select v.ref, w.id, v.isbn, v.format, v.rrp, v.pub, v.run, v.status
from (values
 ('W01-HB', 'W01', '9780000000011', 'hardback', 4500, current_date - 420, 3000, 'active'),
 ('W01-PB', 'W01', '9780000000028', 'paperback', 2999, current_date - 300, 8000, 'active'),
 ('W01-EB', 'W01', '9780000000035', 'ebook', 0, current_date - 420, null::int, 'active'),
 ('W02-PB', 'W02', '9780000000042', 'paperback', 3499, current_date - 40, 2500, 'active'),
 ('W03-HB', 'W03', '9780000000059', 'hardback', 5999, current_date - 10, 4000, 'active'),
 ('W04-PB', 'W04', '9780000000066', 'paperback', 2499, current_date - 400, 5000, 'active'),
 ('W04-AU', 'W04', '9780000000073', 'audio', 0, current_date - 300, null, 'active'),
 ('W05-PB', 'W05', '9780000000080', 'paperback', 3299, current_date - 420, 6000, 'active'),
 ('W05-AU', 'W05', '9780000000097', 'audio', 0, current_date - 420, null, 'active'),
 ('W06-PB', 'W06', '9780000000103', 'paperback', 2999, current_date - 3000, 2000, 'out_of_print'),
 ('W07-PB', 'W07', '9780000000110', 'paperback', 3299, current_date + 120, 3000, 'forthcoming'),
 ('W08-HB', 'W08', '9780000000127', 'hardback', 4499, current_date + 60, 2500, 'forthcoming'),
 ('W09-PB', 'W09', '9780000000134', 'paperback', 3499, current_date + 200, 3000, 'forthcoming')
) as v(ref, work, isbn, format, rrp, pub, run, status) join works w on w.ref = v.work;

insert into contracts (ref, work_id, contributor_id, status, signed_on, territory, share_bps, statement_days, reversion_months)
select v.ref, w.id, p.id, v.status, v.signed, v.territory, v.share, v.days, v.rev
from (values
 ('K-101', 'W01', 'A01', 'signed', current_date - 700, 'World English', 10000, 90, 18),
 ('K-102', 'W02', 'A02', 'signed', current_date - 300, 'ANZ', 10000, 90, 18),
 ('K-103', 'W03', 'A03', 'signed', current_date - 600, 'World English', 10000, 90, null::int),
 ('K-104', 'W04', 'A07', 'signed', current_date - 560, 'World', 5000, 90, null),
 ('K-105', 'W04', 'A04', 'signed', current_date - 560, 'World', 5000, 90, null),
 ('K-106', 'W05', 'A05', 'signed', current_date - 500, 'ANZ', 10000, 30, null),
 ('K-107', 'W06', 'A06', 'signed', current_date - 3000, 'World English', 10000, 90, 18),
 ('K-108', 'W07', 'A08', 'signed', current_date - 200, 'World English', 10000, 90, 24),
 ('K-109', 'W08', 'A02', 'draft', null::date, 'ANZ', 10000, 90, 18),
 ('K-110', 'W09', 'A01', 'signed', current_date - 400, 'World English', 10000, 90, 18)
) as v(ref, work, person, status, signed, territory, share, days, rev)
join works w on w.ref = v.work join contributors p on p.ref = v.person;

insert into royalty_rates (contract_id, format, channel, basis, rate_bps, from_units)
select c.id, v.format, v.channel, v.basis, v.rate, v.from_units
from (values
 ('K-101', 'hardback', 'home', 'rrp', 1000, 0), ('K-101', 'hardback', 'export', 'net_receipts', 1000, 0),
 ('K-101', 'paperback', 'home', 'rrp', 1000, 0), ('K-101', 'paperback', 'home', 'rrp', 1250, 5000),
 ('K-101', 'paperback', 'export', 'net_receipts', 750, 0),
 ('K-101', 'ebook', 'home', 'net_receipts', 2500, 0), ('K-101', 'ebook', 'export', 'net_receipts', 2500, 0),
 ('K-102', 'paperback', 'home', 'rrp', 1000, 0), ('K-102', 'paperback', 'export', 'net_receipts', 750, 0),
 ('K-102', 'ebook', 'home', 'net_receipts', 2500, 0),
 ('K-103', 'hardback', 'home', 'rrp', 1000, 0), ('K-103', 'hardback', 'export', 'net_receipts', 1000, 0),
 ('K-104', 'paperback', 'home', 'rrp', 1000, 0), ('K-105', 'paperback', 'home', 'rrp', 1000, 0),
 ('K-106', 'paperback', 'home', 'rrp', 1000, 0), ('K-106', 'paperback', 'export', 'net_receipts', 1000, 0),
 ('K-106', 'audio', 'home', 'net_receipts', 2500, 0),
 ('K-107', 'paperback', 'home', 'rrp', 800, 0),
 ('K-108', 'paperback', 'home', 'rrp', 1000, 0), ('K-108', 'paperback', 'export', 'net_receipts', 750, 0),
 ('K-110', 'paperback', 'home', 'rrp', 1000, 0), ('K-110', 'ebook', 'home', 'net_receipts', 2500, 0)
) as v(contract, format, channel, basis, rate, from_units) join contracts c on c.ref = v.contract;

insert into advances (ref, contract_id, trigger, amount_cents, paid_on)
select v.ref, c.id, v.trigger, v.amount, v.paid
from (values
 ('ADV-101', 'K-101', 'signing', 500000, current_date - 700),
 ('ADV-102', 'K-101', 'publication', 500000, current_date - 380),
 ('ADV-103', 'K-102', 'signing', 300000, current_date - 300),
 ('ADV-104', 'K-102', 'publication', 300000, null::date),
 ('ADV-105', 'K-103', 'signing', 800000, current_date - 600),
 ('ADV-106', 'K-103', 'delivery', 700000, current_date - 250),
 ('ADV-107', 'K-104', 'signing', 150000, current_date - 560),
 ('ADV-108', 'K-105', 'signing', 150000, current_date - 560),
 ('ADV-109', 'K-106', 'signing', 200000, current_date - 500),
 ('ADV-110', 'K-108', 'signing', 400000, current_date - 195),
 ('ADV-111', 'K-108', 'delivery', 400000, null),
 ('ADV-112', 'K-110', 'signing', 400000, current_date - 400),
 ('ADV-113', 'K-110', 'delivery', 400000, null)
) as v(ref, contract, trigger, amount, paid) join contracts c on c.ref = v.contract;

insert into subrights_shares (contract_id, right_type, author_share_bps)
select c.id, v.right_type, v.share
from (values ('K-101', 'translation', 8000), ('K-101', 'audio', 5000), ('K-106', 'translation', 7500), ('K-102', 'us', 8000)) as v(contract, right_type, share)
join contracts c on c.ref = v.contract;

insert into rights_deals (ref, work_id, right_type, licensee, territory, language, status, signed_on, expires_on, advance_cents)
select v.ref, w.id, v.right_type, v.licensee, v.territory, v.language, v.status, v.signed, v.expires, v.advance
from (values
 ('R-201', 'W05', 'translation', 'Ostwind Verlag', 'Germany, Austria, Switzerland', 'German', 'signed', current_date - 200, current_date + 2400, 450000),
 ('R-202', 'W01', 'audio', 'Larkspur Audio', 'World', 'English', 'signed', current_date - 330, current_date + 60, 200000),
 ('R-203', 'W02', 'us', 'Harrow and Pine', 'United States', 'English', 'offered', null::date, null::date, 0)
) as v(ref, work, right_type, licensee, territory, language, status, signed, expires, advance)
join works w on w.ref = v.work;

insert into rights_income (ref, deal_id, expected_on, received_on, amount_cents, note)
select v.ref, d.id, v.expected, v.received, v.amount, v.note
from (values
 ('RI-301', 'R-202', current_date - 110, current_date - 100, 200000, 'Audio advance on signature'),
 ('RI-302', 'R-201', current_date - 20, null::date, 450000, 'Translation advance on signature')
) as v(ref, deal, expected, received, amount, note) join rights_deals d on d.ref = v.deal;

-- Two closed six-month periods and the current one.
insert into royalty_periods (ref, name, starts_on, ends_on) values
 ('S1', 'Six months to ' || to_char(current_date - 230, 'DD Mon YYYY'), current_date - 409, current_date - 230),
 ('S2', 'Six months to ' || to_char(current_date - 50, 'DD Mon YYYY'), current_date - 229, current_date - 50),
 ('S3', 'Six months to ' || to_char(current_date + 130, 'DD Mon YYYY'), current_date - 49, current_date + 130);

insert into sales (ref, edition_id, sold_on, channel, units, receipts_cents, source)
select v.ref, e.id, current_date + v.day, v.channel, v.units, v.receipts, 'Demo distributor'
from (values
 ('SL-1001', 'W01-HB', -350, 'home', 900, 2025000), ('SL-1002', 'W01-HB', -340, 'export', 100, 225000),
 ('SL-1003', 'W01-PB', -280, 'home', 4800, 7917360), ('SL-1004', 'W01-EB', -330, 'home', 600, 660000),
 ('SL-1005', 'W01-HB', -150, 'home', 150, 337500), ('SL-1006', 'W01-HB', -120, 'home', -40, -90000),
 ('SL-1007', 'W01-PB', -100, 'home', 400, 659780), ('SL-1008', 'W01-EB', -110, 'home', 200, 220000),
 ('SL-1009', 'W04-PB', -330, 'home', 2000, 2749000), ('SL-1010', 'W04-PB', -150, 'home', 1500, 2061750),
 ('SL-1011', 'W04-AU', -140, 'home', 120, 144000),
 ('SL-1012', 'W05-PB', -350, 'home', 3000, 5443350), ('SL-1013', 'W05-PB', -345, 'export', 500, 750000),
 ('SL-1014', 'W05-AU', -340, 'home', 300, 420000), ('SL-1015', 'W05-PB', -150, 'home', 1200, 2177340),
 ('SL-1016', 'W02-PB', -20, 'home', 350, 673750)
) as v(ref, edition, day, channel, units, receipts) join editions e on e.ref = v.edition;

insert into legal_deposits (ref, edition_id, library, copies, sent_on)
select 'LD-01', e.id, 'National Library of New Zealand', 2, current_date - 405 from editions e where e.ref = 'W01-HB';
insert into legal_deposits (ref, edition_id, library, copies, sent_on)
select 'LD-02', e.id, 'National Library of New Zealand', 2, current_date - 290 from editions e where e.ref = 'W01-PB';
insert into legal_deposits (ref, edition_id, library, copies, sent_on)
select 'LD-03', e.id, 'National Library of New Zealand', 2, current_date - 395 from editions e where e.ref = 'W04-PB';
insert into legal_deposits (ref, edition_id, library, copies, sent_on)
select 'LD-04', e.id, 'National Library of Australia', 1, current_date - 410 from editions e where e.ref = 'W05-PB';
insert into legal_deposits (ref, edition_id, library, copies, sent_on)
select 'LD-05', e.id, 'National Library of New Zealand', 2, current_date - 2990 from editions e where e.ref = 'W06-PB';
end $$;
