# Kira

A personal money tracker for Malaysia: net worth, monthly commitments, budget, debt payoff,
emergency fund, retirement (with EPF), zakat and income tax, all in ringgit.

It is a static page (no build step) that stores each person's figures in Supabase, behind
their own sign-in. Nothing personal lives in this repository.

## Files

- `index.html` – the whole app: page, styles and screen code.
- `kira-core.js` – the sums and data rules. Used by the page and by the test.
- `test.js` – checks the sums with hand-checkable examples: `node test.js`.
- `setup.sql` – the Supabase table and its row rules.
- `icon.svg` – the app icon; the PNGs are rendered from it.

## Storage

One table, `public.kira`: one row per person (`owner` = their user id), the whole document in
`data`, and `rev`, which goes up on every save. A save only lands on the version it started
from, so if two devices change Kira at the same time, the second one reloads instead of
overwriting. Row-level security limits every person to their own row.

Live sync: the table is in the `supabase_realtime` publication, so every open device hears when
its owner's row changes and reloads it. Coming back to the page also reloads, in case the live
connection dropped.

`SUPABASE_URL` and `SUPABASE_KEY` near the top of the script in `index.html` point at the
project. Both are meant to be public; the row rules are what protect the data.

## Testing on your own PC

Serve the folder on `127.0.0.1` and open it with `?test` in the address. The page then runs as
a test copy that keeps figures in the browser only and never touches Supabase:

    python -m http.server 8790 --bind 127.0.0.1
    http://127.0.0.1:8790/?test

## Moving from the PC version

`python wealth.py --export kira.json` in the PC version writes everything to one file. Sign in
here, open Your data, and load that file. Do not commit it: `.gitignore` keeps `.json` files
out of the repository.
