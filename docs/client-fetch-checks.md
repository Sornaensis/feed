# Direct browser fetch checks

This records the original 20-source check. The later [specialist expansion](source-catalog.md) adds 19 sources and four more direct browser feeds, bringing current totals to 39 sources and 11 direct feeds.

Checked **17 November 2026** in Chrome from the local preview origin, using standard `fetch` with CORS enabled and credentials omitted. A pass means the browser read and parsed the response body; an opaque response does not count. Separate bounded GETs with `Origin: https://example.github.io` checked the response headers. This was not a deployed GitHub Pages test.

## Results

| Source | Direct browser result | Enabled behavior |
| --- | --- | --- |
| Hacker News | Passed; existing support | Live listing and on-demand comments |
| DEV | Passed; existing support | Live listing, article, and comments |
| Bluesky | Feed and thread passed | Live configured-account feeds and on-demand public threads |
| Mastodon.social | Hashtag, status, and context passed | Live `#technology` feed and on-demand public replies |
| DW | Passed; XML with 131 items | Live feed previews |
| WIRED | Passed; XML with 50 items | Live feed previews |
| The Register | Original redirect failed; its official destination passed with 50 items | Live feed previews using the direct destination |
| Ars Technica, The Verge, Slashdot, BBC, The Guardian, Al Jazeera, PBS, ProPublica, ScienceDaily, 404 Media, Lobsters | Browser could not read; header probes found no allowed origin | Published snapshots |
| TechCrunch | Browser could not read; allows only `https://techcrunch.com` | Published snapshots |
| NPR | Browser could not read; allows only `https://apps.npr.org` | Published snapshots |
| X / Twitter | Not tested; no paid API request made | Optional collector integration only |

The five newly enabled sources returned `Access-Control-Allow-Origin: *`. The Register's direct endpoint is the destination observed in its normal feed redirect:

```text
https://api.theregister.com/api/v1/article?orderBy=published&site_id=2&remapper=rss&content=node
```

The unsuccessful browser requests reported `Failed to fetch`. The separate header checks explain why these endpoints do not currently allow a GitHub Pages origin. No proxy, credentials, or CORS-disable setting was used. Provider behavior can change, so live errors retain available saved data.

## Integration checks

- The production app, with its actual Content Security Policy, reported **20 sources · 7 refreshed live** and no app errors in the browser console.
- Opening a Bluesky discussion returned 11 current comments, labeled `Fetched just now`. Reply URLs matched each comment's own AT URI and author DID.
- Mastodon status and context endpoints were readable. The sampled current posts had no replies; empty public contexts are labeled honestly, and federated conversations remain partial. Fixture tests cover nested replies, absent parents, cycles, and remote canonical reply URLs.
- The browser parser matched all fields from the Python collector for three captured entries from each newly enabled publisher and one synthetic Atom case: **10 matching records**, including stable IDs. This preserves existing saved/read markers.
- Fixture tests cover per-account Bluesky fallback, successful empty feeds, confirmed removals, UTF-8 rich-text offsets, unsafe URLs, publisher identity normalization, and public configuration allowlisting.

Raw response metadata and the matching-origin header checks are in [client-fetch-checks.json](client-fetch-checks.json). Parser fixtures are in [live-feeds.json](../tests/fixtures/live-feeds.json).

To repeat the browser checks, serve the repository root (`python3 -m http.server 3000`) and open `/tests/browser/client-checks.html` or `/tests/browser/client-parser-check.html`. Both run only when their button is clicked. The feed check makes bounded public requests; the parser check uses local fixtures only. These diagnostic pages are outside the published `site/` directory.

The workflow still supplies the other 13 default sources, shared fallback snapshots, and the calendar archive. Direct Refresh updates recent listings; it does not provide arbitrary historical backfill.
