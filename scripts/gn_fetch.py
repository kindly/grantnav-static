#!/usr/bin/env python3
"""Fetch a GrantNav URL, solving its proof-of-work challenge the way the
challenge page's own script does: HEAD for x-challenge-string/-time, find a
nonce whose sha256 starts with the difficulty prefix, replay with the params.
A 429 is the soft queue page, which retries itself with a=1."""
import hashlib
import http.cookiejar
import shutil
import sys
import urllib.error
import urllib.parse as up
import urllib.request

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/140.0 Safari/537.36")
DIFFICULTY = "0000"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [("User-Agent", UA), ("Accept", "*/*")]


def solve(challenge):
    nonce = 0
    while True:
        nonce += 1
        h = hashlib.sha256(f"{challenge}{nonce}".encode()).hexdigest()
        if h.startswith(DIFFICULTY):
            return h, nonce


def add_params(url, extra):
    u = up.urlsplit(url)
    q = dict(up.parse_qsl(u.query, keep_blank_values=True))
    q.update(extra)
    return up.urlunsplit(u._replace(query=up.urlencode(q)))


def fetch(url, out, tries=8):
    for attempt in range(tries):
        try:
            with opener.open(url, timeout=1800) as r:
                print(f"  200 {r.headers.get('content-type')}", file=sys.stderr, flush=True)
                with open(out, "wb") as f:
                    shutil.copyfileobj(r, f, 1 << 20)
            return out
        except urllib.error.HTTPError as e:
            code = e.code
            e.read()
            print(f"  attempt {attempt}: HTTP {code}", file=sys.stderr, flush=True)
            if code == 429:
                url = add_params(url, {"a": "1"})
            elif code == 503:
                # the challenge headers ride on the 503 itself
                cs = e.headers.get("x-challenge-string")
                ct = e.headers.get("x-challenge-time")
                if not (cs and ct):
                    raise SystemExit("503 without challenge headers")
                sol, nonce = solve(cs)
                print(f"  solved pow nonce={nonce}", file=sys.stderr, flush=True)
                url = add_params(url, {"solution": sol, "nonce": str(nonce),
                                       "timestamp": ct})
            else:
                raise SystemExit(f"unexpected status {code}")
    raise SystemExit("gave up")


if __name__ == "__main__":
    p = fetch(sys.argv[1], sys.argv[2])
    import os
    n = os.path.getsize(p)
    print(f"{p}: {n} bytes ({n/1e6:.1f} MB)")
