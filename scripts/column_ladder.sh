#!/usr/bin/env bash
# What does each column actually cost, once the file is ordered and gzipped?
#
# All variants use the same row order (funder, recipient, date) so only the
# column set differs. Columns are removed in the order "least used by the
# interface first", so each step answers "what would dropping this buy".
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=data/grantnav-app.csv
CLI=${FACETFUL:-facetful}   # facetful's npm command, or FACETFUL=path/to/the/native/binary
OUT=build/ladder
mkdir -p "$OUT"

ORDER='order by "Funding Org:Name", "Recipient Org:Name", "Award Date"'

FACETS='"Funding Org:Identifier", "Funding Org:Name", "Funding Org: Org Type (additional data)",
        "Recipient Org: Org Type (additional data)", "Grant Programme:Title",
        "Best Available Region (additional data)", "Best Available District (additional data)",
        "Best Available County", "Type of Recipient", "Grant Type",
        "Award Year", "Amount Band", "Amount Awarded", "Award Date"'

build() {
  local name=$1 cols=$2 note=$3
  local csv="$OUT/$name.csv" img="$OUT/$name.facetful"

  if [ ! -f "$img" ]; then
    duckdb -c "
      set memory_limit='2GB';
      set preserve_insertion_order=false;
      copy (select $cols from read_csv('$SRC', header=true, all_varchar=true) $ORDER)
        to '$csv' (header, format csv);
    " > /dev/null
    $CLI convert "$csv" "$img" > /dev/null
    rm -f "$csv"
  fi
  gzip -6 -kf "$img"

  local raw gz ncol
  raw=$(stat -c %s "$img")
  gz=$(stat -c %s "$img.gz")
  ncol=$(grep -o ',' <<<"$cols" | wc -l)
  awk -v n="$name" -v c="$((ncol + 1))" -v r="$raw" -v g="$gz" -v note="$note" \
    'BEGIN{printf "%-12s %2d cols  raw %6.1f MB   gzip %5.1f MB   %s\n", n, c, r/1e6, g/1e6, note}'
}

build full20 "$FACETS, \"Identifier\", \"Title\", \"Recipient Org:Name\",
  \"Recipient Org:Identifier\", \"Recipient Org:Charity Number\", \"Recipient Org:Postal Code\"" \
  "everything the prep script keeps"

build drop_unused "$FACETS, \"Identifier\", \"Title\", \"Recipient Org:Name\"" \
  "-recipient org id, charity no, postcode (UI reads none of them)"

build drop_ident "$FACETS, \"Title\", \"Recipient Org:Name\"" \
  "-Identifier (loses the deep link to grantnav)"

build drop_title "$FACETS, \"Recipient Org:Name\"" \
  "-Title (no longer a usable results list)"

build facets_only "$FACETS" \
  "the floor: facets and amounts only"
