# Compliance: the rules this system watches

A publisher's records answer to three sets of rules: the national library's legal deposit law, the tax rules on royalties (withholding for overseas authors, GST for registered ones), and the author contracts themselves. Get them wrong during the year and a royalty run turns into a clean-up.

`node scripts/royalties.mjs compliance` (the `/compliance` command) checks the records against the rules below. The rates, copy counts and deadlines live in the `jurisdictions` table, so a rule change is one migration.

Checked against the sources on 2026-11-13. Confirm the current rule with the agency before relying on it; rules change.

## 1. New Zealand: legal deposit

- **Rule:** every publisher of a book gives the National Librarian copies within 20 working days after the date the book is first published. Two copies of most titles; one where the price is over $1,000 or fewer than 100 copies are published.
- **Source:** National Library Requirement (Books and Periodicals) Notice 2004, https://www.legislation.govt.nz/secondary-legislation/pco-drafted/2004/129/en/latest/ , made under Part 4 of the National Library of New Zealand (Te Puna Matauranga o Aotearoa) Act 2003; National Library, *Legal deposit*, https://natlib.govt.nz/publishers-and-authors/legal-deposit
- **In the data:** `jurisdictions` row `NZ` (2 copies, 20 working days). Each published hardback or paperback on an NZ imprint is checked through the `deposit_status` view; `legal_deposits` records what was sent.
- **Check:** no deposit after the deadline, or fewer copies than required (state `breach`); not yet deposited and still inside the deadline (state `due`).
- **Working days:** counted Monday to Friday. Public holidays are not removed, so a deadline near a holiday is a few days later than shown.
- **Not checked:** digital publications, which are deposited when the Library asks.

## 2. Australia: legal deposit

- **Rule:** a copy of published material goes to the National Library of Australia within one month of publication (Copyright Act 1968, section 195CD). Failing to deliver is a strict liability offence (section 195CB).
- **Source:** https://www6.austlii.edu.au/au/legis/cth/consol_act/ca1968133/s195cd.html ; National Library of Australia, *Legal deposit questions and answers*, https://www.library.gov.au/services-publishers-and-self-publishers/legal-deposit/legal-deposit-questions-and-answers
- **In the data:** `jurisdictions` row `AU` (1 copy, 1 month).
- **Check:** as for New Zealand.
- **Not checked:** each state and territory has its own deposit law and library. Add them as further `legal_deposits` rows if you want them tracked; the compliance check covers the national library only.

## 3. Withholding on royalties paid to an overseas author

- **Rule (Australia):** royalties paid to a foreign resident carry a final withholding tax of 30 percent, unless a tax treaty with the author's country sets a lower rate. The payer withholds, pays it to the ATO and reports it.
- **Source:** ATO, *Withholding from royalties paid to foreign residents*, https://www.ato.gov.au/individuals-and-families/coming-to-australia-or-going-overseas/australian-income-of-foreign-residents/withholding-from-royalties-paid-to-foreign-residents
- **Rule (New Zealand):** non-resident withholding tax on royalties is 15 percent where no double tax agreement applies; agreements usually cap it lower.
- **Source:** Inland Revenue, *NRWT rates for DTA countries*, https://www.ird.govt.nz/income-tax/withholding-taxes/non-resident-withholding-tax-nrwt/deduct-nrwt-at-the-right-rate/nrwt-rates-for-dta-countries
- **In the data:** `contributors.tax_country` and `contributors.treaty_rate_bps`; the default rate is `jurisdictions.withholding_default_bps` for the imprint's country. The royalty run withholds on every payment to a contributor resident outside the imprint's country.
- **Check:** an overseas payee with no treaty rate recorded (state `check`: the default rate is being withheld). Record the treaty rate only once the author has given evidence of residence.

## 4. GST on royalties paid to a registered author

- **Rule (New Zealand):** a GST-registered buyer may issue the taxable supply information for a GST-registered seller (buyer-created taxable supply information) where both agree. It shows both GST numbers, and both keep a copy.
- **Source:** Inland Revenue, *Buyer-created taxable supply information*, https://www.ird.govt.nz/gst/tax-invoices-for-gst/buyer-created-taxable-supply-information
- **Rule (Australia):** a recipient-created tax invoice needs both parties registered for GST and a written agreement that meets the Recipient Created Tax Invoice Determination 2023; the recipient keeps a copy for five years.
- **Source:** ATO, *Tax invoices*, https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices ; the Determination, https://www.ato.gov.au/law/view/pdf/ldt/li2023-020.pdf
- **In the data:** `contributors.gst_registered`, `contributors.tax_invoice_agreement_on`, `contributors.gst_number`. The royalty run adds GST at the imprint country's rate for a registered payee in the same country; the remittance advice shows it.
- **Checks:** GST-registered with no agreement date (state `breach`); agreement recorded but no GST number to print (state `check`).

## 5. Statement deadlines in the contract

- **Rule:** each contract says how many days after a period closes the statement goes out (`contracts.statement_days`, often 90; some agents negotiate 30 or 60).
- **Source:** the author contract.
- **Check:** every closed royalty period against every signed contract with a published edition: no statement sent after the due date (state `breach`), due within `statement_due_soon_days` (state `due`), sent late (state `info`).

## What this is not

Nothing here is tax or legal advice. The checks show your records against the rules you have told the system to watch, with sources, so problems surface before a statement goes out. Your accountant confirms the tax treatment; the contract decides the rest.
