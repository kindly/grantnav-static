#!/usr/bin/env bash
# Does row order beat codec choice on the compiled image?
#
# PUDL saw a 2.8x swing on the gzipped size between a date-sorted and a
# generator-sorted image, because gzip's window is 32 KB and repeated values
# only pay off when they land inside it. This runs the same test on GrantNav.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=data/grantnav-app.csv
CLI=${FACETFUL:-facetful}   # facetful's npm command, or FACETFUL=path/to/the/native/binary
OUT=build/order
mkdir -p "$OUT"

run() {
  local name=$1 order=$2
  local csv="$OUT/$name.csv" img="$OUT/$name.facetful"

  if [ ! -f "$img" ]; then
    echo "== $name: $order"
    duckdb -c "
      set memory_limit='2GB';
      set preserve_insertion_order=false;
      copy (select * from read_csv('$SRC', header=true, all_varchar=true) $order)
        to '$csv' (header, format csv);
    "
    $CLI convert "$csv" "$img" > /dev/null
    rm -f "$csv"
  fi

  gzip -6 -kf "$img"
  local raw gz
  raw=$(stat -c %s "$img")
  gz=$(stat -c %s "$img.gz")
  awk -v n="$name" -v r="$raw" -v g="$gz" \
    'BEGIN{printf "%-22s raw %7.1f MB   gzip-6 %6.1f MB   %5.1f:1\n", n, r/1e6, g/1e6, r/g}'
}

run asis            ""
run by_year         'order by "Award Year", "Award Date"'
run by_recipient    'order by "Recipient Org:Identifier", "Award Date"'
run by_funder_recip 'order by "Funding Org:Name", "Recipient Org:Identifier", "Award Date"'
run by_funder_prog  'order by "Funding Org:Name", "Grant Programme:Title", "Recipient Org:Name", "Award Date"'
run by_title        'order by "Title", "Recipient Org:Name"'
