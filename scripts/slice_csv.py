#!/usr/bin/env python3
"""Stream a row-slice and/or column-projection out of the GrantNav CSV.
usage: slice_csv.py IN OUT [--rows N] [--drop 'Col A,Col B'] [--keep 'Col A,Col B']"""
import argparse, csv, sys
csv.field_size_limit(1 << 30)

ap = argparse.ArgumentParser()
ap.add_argument("inp"); ap.add_argument("out")
ap.add_argument("--rows", type=int, default=0)
ap.add_argument("--drop", default="")
ap.add_argument("--keep", default="")
a = ap.parse_args()

drop = {c for c in a.drop.split(",") if c}
keep = [c for c in a.keep.split(",") if c]

with open(a.inp, newline="", encoding="utf-8-sig") as f, \
     open(a.out, "w", newline="", encoding="utf-8") as g:
    r = csv.reader(f); w = csv.writer(g)
    header = next(r)
    if keep:
        missing = [c for c in keep if c not in header]
        if missing:
            sys.exit(f"not in header: {missing}")
        idx = [header.index(c) for c in keep]
    else:
        idx = [i for i, h in enumerate(header) if h not in drop]
    w.writerow([header[i] for i in idx])
    n = 0
    for row in r:
        w.writerow([row[i] for i in idx])
        n += 1
        if a.rows and n >= a.rows:
            break
print(f"{a.out}: {n:,} rows, {len(idx)} columns", file=sys.stderr)
