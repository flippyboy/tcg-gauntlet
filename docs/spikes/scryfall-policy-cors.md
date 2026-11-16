# Spike 5: Scryfall policy and CORS

Run on 2026-11-15 with `curl`, User-Agent `tcg-gauntlet-spike/0.1`, 14 requests in total, at least 300 ms apart, to `api.scryfall.com` and `cards.scryfall.io` only. No `scryfall.com/docs` page, mirror or archive was fetched.

## Result

* `cards.scryfall.io` answers every image request with `access-control-allow-origin: *`, with and without an `Origin` header, and answers a CORS preflight with 204 and the same header. A cross-origin `fetch()` of these images is expected to succeed.
* The browser test was **not run** (no browser was available). The expectation rests on the headers below.
* The four policy statements are **Not verified (docs pages not fetched by policy)**. The author must read them in a browser.

## CORS headers

Cards (API step):

| Card | Scryfall id | Notes |
|---|---|---|
| Lightning Bolt | `7673784e-db4b-43a1-8d55-1bb9fc1e284f` | `exact=` returned printing msc/806; `layout: normal` |
| Delver of Secrets // Insectile Aberration | `6904ea20-e504-47da-95a0-08739fdde260` | printing inr/60; `layout: transform`; no top-level `image_uris`, one per `card_faces[]` |

Image URLs (timestamp query string as returned):

* Lightning Bolt large: `https://cards.scryfall.io/large/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg?1783903008`
* Lightning Bolt png: `https://cards.scryfall.io/png/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.png?1783903008`
* Delver front large: `https://cards.scryfall.io/large/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173`
* Delver front png: `https://cards.scryfall.io/png/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.png?1783908173`
* Delver back large: `https://cards.scryfall.io/large/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173`
* Delver back png: `https://cards.scryfall.io/png/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.png?1783908173`

### Image host, Lightning Bolt large, no Origin (`curl -sI`)

```
HTTP/2 200 
date: Mon, 09 Nov 2026 11:16:33 GMT
content-type: image/jpeg
content-length: 125145
etag: "fa85fc111d2b005aef85e0ae5a0420f7"
last-modified: Mon, 29 Jun 2026 01:26:29 GMT
vary: Authorization
accept-ranges: bytes
access-control-allow-origin: *
cache-control: public, max-age=31556952
content-disposition: inline; filename="msc-806-lightning-bolt.jpg"
server: ScryfallEdgeCDN (scryfall.io)
strict-transport-security: max-age=15552000; includeSubDomains; preload
x-content-type-options: nosniff
age: 552291
scyfall-cache-status: hit-fresh
scyfall-node: eu
access-control-allow-methods: GET, OPTIONS
access-control-allow-headers: Accept, Accept-Charset, Accept-Language, Cache-Control, Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer, User-Agent, X-Requested-With
```

With `Origin: https://example.com` the response is identical (same headers and values; `age` 552292). There is no `Vary: Origin` on GET responses; `*` is sent unconditionally. (The `date` and `age` values reflect the CDN's cached copy header, not the time of the request.)

### Delver front large (`Origin: https://example.com`; the no-Origin response was identical)

```
HTTP/2 200 
date: Tue, 10 Nov 2026 11:40:54 GMT
content-type: image/jpeg
content-length: 130620
etag: "516629c0a1a2af75d4a77131c743c96d"
last-modified: Mon, 29 Jun 2026 13:54:08 GMT
vary: Authorization
accept-ranges: bytes
access-control-allow-origin: *
cache-control: public, max-age=31556952
content-disposition: inline; filename="inr-60-delver-of-secrets.jpg"
server: ScryfallEdgeCDN (scryfall.io)
strict-transport-security: max-age=15552000; includeSubDomains; preload
x-content-type-options: nosniff
age: 464431
scyfall-cache-status: hit-fresh
scyfall-node: eu
access-control-allow-methods: GET, OPTIONS
access-control-allow-headers: Accept, Accept-Charset, Accept-Language, Cache-Control, Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer, User-Agent, X-Requested-With
```

### Delver back large (`Origin: https://example.com`; the no-Origin response was identical)

```
HTTP/2 200 
date: Mon, 09 Nov 2026 21:38:41 GMT
content-type: image/jpeg
content-length: 126793
etag: "26c60d8da24f9f4f6274efe05c0dec5c"
last-modified: Mon, 29 Jun 2026 13:54:16 GMT
vary: Authorization
accept-ranges: bytes
access-control-allow-origin: *
cache-control: public, max-age=31556952
content-disposition: inline; filename="inr-60-insectile-aberration.jpg"
server: ScryfallEdgeCDN (scryfall.io)
strict-transport-security: max-age=15552000; includeSubDomains; preload
x-content-type-options: nosniff
age: 514965
scyfall-cache-status: hit-fresh
scyfall-node: eu
access-control-allow-methods: GET, OPTIONS
access-control-allow-headers: Accept, Accept-Charset, Accept-Language, Cache-Control, Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer, User-Agent, X-Requested-With
```

### Preflight (`OPTIONS`, `Origin: https://example.com`, `Access-Control-Request-Method: GET`, Lightning Bolt large)

```
HTTP/2 204 
date: Sun, 15 Nov 2026 20:41:26 GMT
access-control-allow-methods: GET, OPTIONS
access-control-max-age: 2592000
access-control-allow-origin: *
vary: Origin
server: ScryfallEdgeCDN (scryfall.io)
strict-transport-security: max-age=15552000; includeSubDomains; preload
x-content-type-options: nosniff
access-control-allow-headers: Accept, Accept-Charset, Accept-Language, Cache-Control, Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer, User-Agent, X-Requested-With
scyfall-node: eu
age: 0
scyfall-cache-status: skipped
```

No redirects were seen on any image request. The PNG response (Lightning Bolt) has the same CORS headers, `content-type: image/png`, `content-length: 843984`, and `content-disposition: attachment; filename="msc-806-lightning-bolt.png"`.

### API response headers (`GET /cards/named?exact=Lightning%20Bolt`, 200)

```
access-control-allow-headers: Accept, Accept-Charset, Accept-Language, Authorization, Cache-Control, Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer, User-Agent, X-Requested-With
access-control-allow-methods: GET, POST, DELETE, OPTIONS
access-control-allow-origin: *
access-control-max-age: 300
cache-control: public, max-age=172800
content-type: application/json; charset=utf-8
etag: W/"cce897e6c3279649f51addcd92cfe1f8"
vary: Accept,Accept-Encoding
x-action-cache: HIT
x-scryfall-card: https://scryfall.com/card/msc/806/lightning-bolt?utm_source=api
x-scryfall-card-image: https://cards.scryfall.io/display/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.webp?1783903008
server: cloudflare
cf-cache-status: HIT
```

(Other headers omitted: date, NEL, report-to, HSTS, x-frame-options and similar.) The response carried **no rate-limit headers** (no `x-ratelimit-*` or `retry-after`) and no policy text. No error bodies were encountered.

## URL pattern check

Observed pattern: `https://cards.scryfall.io/<size>/<front|back>/<id[0]>/<id[1]>/<id>.<ext>?<timestamp>`

* Lightning Bolt id `7673784e-...` gives directory `7/6/`. Delver id `6904ea20-...` gives `6/9/`. Both match `id[0]`/`id[1]`.
* The DFC back image uses the **same top-level card id** as the front; only `front` becomes `back`. The id is the card's own `id`, not a per-face id.
* Extension depends on size: `small`, `normal`, `large`, `border_crop`, `art_crop` are `.jpg`; `png` is `.png`; `thumb`, `grid`, `display`, `art`, `crop` are `.webp`. (The `jpeg` key is an alias to the `normal` URL.)
* The query string is a numeric timestamp (`1783903008` is a Unix time, approximately 2026-07-12) that changes when the image is updated. Without it, `.../large/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg` returned 200 with the same ETag and `content-length`, and the same CORS header. Only the Lightning Bolt URL was checked without the timestamp. The timestamp acts as a cache buster. Building URLs from the id alone works but may lag image updates until the 1-year `max-age` expires in browsers.
* Not checked: whether a back URL exists for single-faced cards (not needed; the design only allows `back` when a back face exists).

## Browser test page

`spikes/scryfall-cors/index.html` calls `fetch(url, {mode: "cors"})` for the Lightning Bolt front, Delver front and Delver back large images, reads each as a Blob, and prints size and type or the error. Serve it with `python3 -m http.server 8000` in `spikes/scryfall-cors/` and open `http://localhost:8000/`.

**The browser test was not run.** From the headers: a simple GET with no custom request headers needs no preflight, and the response has `access-control-allow-origin: *` for any `Origin`. There is no credentials mode, so `*` is acceptable. A cross-origin `fetch()` should therefore succeed and let the page read the Blob. The preflight also succeeds if a browser sends one (204, `*`, GET allowed). Caveat: this was checked from `curl` with a fake Origin, not from a real browser, and Scryfall can change the CDN config at any time.

## Policy check (for the author)

All four statements: **Not verified (docs pages not fetched by policy)**. The docs pages refuse automated access, so the author must read these in a browser and record the date and the wording:

1. "Hotlinking from `*.scryfall.io` is allowed" - Not verified.
2. "Those hosts have no rate limit" - Not verified.
3. "High-volume users should cache their own copies" - Not verified.
4. "Images must not be cropped, distorted or watermarked, and artist and copyright lines must stay visible" - Not verified.

Pages to read:

* <https://scryfall.com/docs/api> - the general policy: required `User-Agent` and `Accept` headers, any statement on hotlinking and caching, and the data-use terms.
* <https://scryfall.com/docs/api/images> - image sizes and formats, hotlinking and caching wording, and the rules on cropping, distortion, watermarks and the artist and copyright lines. Also check any note on the `?timestamp` query parameter.
* <https://scryfall.com/docs/api/rate-limits> - request rate limits for `api.scryfall.com` and whether `cards.scryfall.io` (or `*.scryfall.io`) is exempt.

Policy hints seen in responses: none. The only hint is indirect: the API response sets `access-control-allow-origin: *`, and the image host does too, which suggests browser use is intended, but this is not a statement of policy.

## Implications for the design

Facts:

* CORS is open on the image host, so direct browser `fetch()` of `large` JPEGs (and PNGs) for the proxy PDF appears technically possible. The PDF could then be built in the browser with no `/img` route and no server image cache.
* Images are served with `cache-control: public, max-age=31556952`, so the browser's own HTTP cache already covers repeats.

Trade-offs for the author (no decision made here):

* Removing `/img` removes the route, rate limiter, LRU cache, `IMAGE_CACHE_MAX_MB`, the User-Agent handling and server-side bandwidth. The app would no longer cache copies itself, which matters for policy statement 3 ("high-volume users should cache"), though each user's browser cache serves that role.
* Keeping `/img` keeps PDF building working if Scryfall changes its CORS headers (rejected-alternative at line 843 of the design gives this as the reason), and lets the server send a descriptive User-Agent (browsers cannot set it) and limit concurrency in one place. It costs disk, code and an abuse surface that needs rate limiting.
* The decision depends on the human-read policy (statements 1 to 4); in particular, statement 4 applies to the PDF layout either way.
* Risk R4 and the design's "decision can be revisited" note remain relevant: CORS headers are observable behaviour, not documented here.

## Open issues

* Browser test not run; confirm with a real browser, ideally in Chrome and Firefox.
* All four policy statements need to be read in a browser and recorded with the date.
* Timestamp-less URLs were verified only for one image; PNG and DFC back were not retested without it.
* Header `date`/`age` values on image responses come from the CDN cache, so they do not match the request time.
* The `Lightning Bolt` `exact=` lookup returned a recent Mystery/Secret Lair-style printing (msc/806), so the id in this spike is that printing's, not the original.
