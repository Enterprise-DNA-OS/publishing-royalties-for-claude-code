# Test fixtures

Synthetic files for `npm test`. Every title, ISBN, name and figure is invented.

- `onix-synthetic.xml`: an ONIX 3.0 extract (two new editions of one work, and a price change on an existing ISBN).
- `contracts-synthetic.csv`: a royalty schedule, one row per rate line, with the balance the contract carries in.
- `sales-synthetic.csv`: a distributor sales file, including a repeated returns line that must load twice.
