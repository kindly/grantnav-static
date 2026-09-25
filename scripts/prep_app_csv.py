#!/usr/bin/env python3
"""Project the GrantNav dump down to the columns the interface actually reads,
and add the derived columns that keep facet queries off per-row scalar
functions: Award Year (int) and Amount Band (ordered label).

Column choice is the biggest lever on file size: four free-text columns are 75%
of the image while all thirteen facet columns together are 9%, so anything the
UI never displays or filters on is dropped here. Recipient Org:Identifier,
Charity Number and Postal Code cost 61 MB between them and were read by
nothing. Streams; never loads the CSV into memory."""
import argparse, csv, sys
csv.field_size_limit(1 << 30)

KEEP = [
    "Identifier", "Title", "Amount Awarded", "Award Date",
    "Funding Org:Identifier", "Funding Org:Name",
    "Funding Org: Org Type (additional data)",
    "Recipient Org:Name",
    "Recipient Org: Org Type (additional data)",
    "Grant Programme:Title",
    "Best Available Region (additional data)",
    "Best Available District (additional data)",
    "Best Available County",
    "Type of Recipient", "Grant Type",
]

BANDS = [
    (500, "01 Under £500"), (1_000, "02 £500 - £1k"), (2_000, "03 £1k - £2k"),
    (5_000, "04 £2k - £5k"), (10_000, "05 £5k - £10k"), (50_000, "06 £10k - £50k"),
    (100_000, "07 £50k - £100k"), (500_000, "08 £100k - £500k"),
    (1_000_000, "09 £500k - £1m"), (float("inf"), "10 Over £1m"),
]


def band(v):
    try:
        x = float(v)
    except ValueError:
        return ""
    for hi, label in BANDS:
        if x < hi:
            return label
    return ""


ap = argparse.ArgumentParser()
ap.add_argument("inp"); ap.add_argument("out")
ap.add_argument("--rows", type=int, default=0)
ap.add_argument("--with-description", action="store_true")
a = ap.parse_args()

keep = list(KEEP)
if a.with_description:
    keep.insert(2, "Description")

with open(a.inp, newline="", encoding="utf-8-sig") as f, \
     open(a.out, "w", newline="", encoding="utf-8") as g:
    r = csv.reader(f); w = csv.writer(g)
    header = next(r)
    idx = [header.index(c) for c in keep]
    i_date = header.index("Award Date")
    i_amt = header.index("Amount Awarded")
    w.writerow(keep + ["Award Year", "Amount Band"])
    n = 0
    for row in r:
        d = row[i_date]
        w.writerow([row[i] for i in idx] + [d[:4] if len(d) >= 4 else "", band(row[i_amt])])
        n += 1
        if a.rows and n >= a.rows:
            break
        if n % 500_000 == 0:
            print(f"  {n:,}", file=sys.stderr, flush=True)
print(f"{a.out}: {n:,} rows, {len(keep) + 2} columns", file=sys.stderr)
