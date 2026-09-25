#!/usr/bin/env python3
"""Streaming profile of the GrantNav CSV: rows, and per column the distinct
count, null count and total text bytes. Distinct sets are capped so the pass
stays inside available memory."""
import csv, sys
csv.field_size_limit(1 << 30)

CAP = 400_000  # stop tracking distincts past this; we only need to know "many"

path = sys.argv[1]
subset_path = sys.argv[2] if len(sys.argv) > 2 else None
subset_n = int(sys.argv[3]) if len(sys.argv) > 3 else 0

with open(path, newline="", encoding="utf-8-sig") as f:
    r = csv.reader(f)
    header = next(r)
    ncol = len(header)
    distinct = [set() for _ in range(ncol)]
    capped = [False] * ncol
    nulls = [0] * ncol
    nbytes = [0] * ncol
    rows = 0
    out = None
    if subset_path:
        out = csv.writer(open(subset_path, "w", newline="", encoding="utf-8"))
        out.writerow(header)
    for row in r:
        rows += 1
        if out and rows <= subset_n:
            out.writerow(row)
        for i, v in enumerate(row):
            if not v:
                nulls[i] += 1
                continue
            nbytes[i] += len(v.encode())
            if not capped[i]:
                distinct[i].add(v)
                if len(distinct[i]) > CAP:
                    capped[i] = True
                    distinct[i] = set()
        if rows % 250_000 == 0:
            print(f"  {rows:,} rows", file=sys.stderr, flush=True)

print(f"\nrows: {rows:,}   columns: {ncol}\n")
print(f"{'column':<52}{'distinct':>12}{'null%':>8}{'text MB':>10}")
for i, h in enumerate(header):
    d = f">{CAP:,}" if capped[i] else f"{len(distinct[i]):,}"
    print(f"{h[:50]:<52}{d:>12}{100*nulls[i]/rows:>7.1f}%{nbytes[i]/1e6:>10.1f}")
print(f"\ntotal text: {sum(nbytes)/1e6:,.0f} MB")
