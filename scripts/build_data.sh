#!/usr/bin/env bash
# GrantNav CSV export -> the image the page loads.
#
#   1. project to the columns the interface reads, add Award Year / Amount
#      Band, split Description into its dict-encodable and plain halves, and
#      sort by funder, recipient, date (scripts/split_description.sql, which
#      explains each of those choices)
#   2. compile
#   3. compress twice: .br is what a host with Content-Encoding should serve,
#      .gz is the fallback the page unpacks itself where it cannot
#
# usage: scripts/build_data.sh [grantnav-export.csv]
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=$(realpath "${1:-data/grantnav.csv}")
CLI=${FACETFUL:-facetful}   # facetful's npm command, or FACETFUL=path/to/the/native/binary
mkdir -p build/stage data/site

echo "1/3  projecting, splitting descriptions, ordering"
duckdb -c "set variable csv = '$SRC';" -f scripts/split_description.sql

echo "2/3  compiling"
"$CLI" convert build/stage/app-sorted.csv data/site/grantnav.facetful
rm -f build/stage/app-sorted.csv

echo "3/3  compressing (brotli -q 11 takes a few minutes)"
gzip -9 -kf data/site/grantnav.facetful
brotli -q 11 -f -o data/site/grantnav.facetful.br data/site/grantnav.facetful

raw=$(stat -c %s data/site/grantnav.facetful)
gz=$(stat -c %s data/site/grantnav.facetful.gz)
br=$(stat -c %s data/site/grantnav.facetful.br)
awk -v r="$raw" -v g="$gz" -v b="$br" 'BEGIN{
  printf "\nimage  %7.1f MB\n", r/1e6
  printf "gzip   %7.1f MB  (%.2f:1)\n", g/1e6, r/g
  printf "brotli %7.1f MB  (%.2f:1)   <- serve this\n", b/1e6, r/b
}'
