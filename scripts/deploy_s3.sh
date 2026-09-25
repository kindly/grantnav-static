#!/usr/bin/env bash
# Publish the data image to S3. The app itself is on GitHub Pages
# (.github/workflows/pages.yml), which builds it with VITE_DATA_URL pointing
# here.
#
# S3 does no content negotiation: whatever Content-Encoding you set on an
# object is sent to every client, regardless of Accept-Encoding. So the brotli
# bytes (58 MB) are uploaded under the plain key with `Content-Encoding: br`,
# and browsers unpack them natively; every current browser accepts br over
# https. That is the only way to use brotli in a browser: DecompressionStream
# has no brotli anywhere. The .gz sibling (83 MB) goes up too, as the fallback
# the page unpacks itself if the header is ever dropped.
#
# The page and the data are different origins, so the bucket needs CORS: GET
# and HEAD from the page's origin, exposing ETag (the page keys its on-device
# copy off it) and Content-Length / Content-Encoding (how it picks br or gz).
#
# usage: scripts/deploy_s3.sh s3://bucket[/prefix]
#
#   AWS=...          the aws command (default `aws`), e.g. AWS="uvx --from awscli aws"
#   ACL=...          a canned ACL for the objects, e.g. ACL=public-read on a
#                    bucket that grants reads per object rather than by policy
#   CORS_ORIGIN=...  also set the bucket's CORS to allow this origin, e.g.
#                    https://kindly.github.io. This REPLACES any existing CORS
#                    configuration on the bucket.
#
# The image is then at https://<bucket>.s3.<region>.amazonaws.com/<prefix>/data/grantnav.facetful
set -euo pipefail

cd "$(dirname "$0")/.."
DEST=${1:?usage: deploy_s3.sh s3://bucket[/prefix]}
DEST=${DEST%/}
AWS=${AWS:-aws}
ACL_ARGS=()
[ -n "${ACL:-}" ] && ACL_ARGS=(--acl "$ACL")
BUCKET=${DEST#s3://}
BUCKET=${BUCKET%%/*}

if [ ! -f data/site/grantnav.facetful.br ]; then
  echo "missing data/site/grantnav.facetful.br — run scripts/build_data.sh first" >&2
  exit 1
fi

# immutable per build: a rebuilt image is a new ETag, so a new on-device copy
IMMUTABLE="public, max-age=31536000, immutable"

echo "==> data image (brotli bytes under the plain key)"
$AWS s3 cp data/site/grantnav.facetful.br "$DEST/data/grantnav.facetful" \
  --content-type application/octet-stream --content-encoding br \
  --cache-control "$IMMUTABLE" "${ACL_ARGS[@]}" --only-show-errors

echo "==> data image (gzip fallback)"
$AWS s3 cp data/site/grantnav.facetful.gz "$DEST/data/grantnav.facetful.gz" \
  --content-type application/octet-stream \
  --cache-control "$IMMUTABLE" "${ACL_ARGS[@]}" --only-show-errors

if [ -n "${CORS_ORIGIN:-}" ]; then
  echo "==> CORS on $BUCKET for $CORS_ORIGIN"
  $AWS s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{
    \"CORSRules\": [{
      \"AllowedOrigins\": [\"$CORS_ORIGIN\"],
      \"AllowedMethods\": [\"GET\", \"HEAD\"],
      \"AllowedHeaders\": [\"*\"],
      \"ExposeHeaders\": [\"ETag\", \"Content-Length\", \"Content-Encoding\", \"Last-Modified\"],
      \"MaxAgeSeconds\": 3600
    }]
  }"
fi

cat <<'NOTE'

Done. To check what a browser will receive:

  curl -sI -H 'Origin: https://kindly.github.io' https://<bucket>.s3.<region>.amazonaws.com/<prefix>/data/grantnav.facetful \
    | grep -i 'content-encoding\|content-length\|etag\|access-control'
NOTE
