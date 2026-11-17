# The Feed

A static news reader for GitHub Pages with 39 default sources spanning technology, Linux/open source, science, gaming, general news, and public social posts. One card-based reading list has an archive calendar alongside it. Posts and threaded discussions open in an inline reader with preview/discussion controls and collapsible replies. Every reply link opens the actual post or comment on its original site, where you can sign in and reply.

## Sources

| Source | Inline reading | Inline comments |
| --- | --- | --- |
| Hacker News | Submission text and article/link previews; supported media plays inline | Live, nested, loaded on demand; saved snapshot fallback |
| Lobsters | Submission text and article/link previews | Nested snapshot, updated by the collector |
| DEV Community | Public article text | Live nested comments; saved snapshot fallback |
| Ars Technica | Publisher feed preview | Original discussion link |
| The Verge | Publisher feed preview | Original article link |
| TechCrunch | Publisher feed preview | Original article link |
| Slashdot | Publisher feed preview | Original discussion link |
| The Register | Live publisher feed preview; snapshot fallback | Original article link |
| WIRED | Live publisher feed preview; snapshot fallback | Original article link |
| 404 Media | Public feed preview | Original article link |
| BBC World | Publisher feed preview | Original article link |
| The Guardian | Publisher feed preview | Original article link |
| NPR News | Publisher feed preview | Original article link |
| Al Jazeera | Publisher feed preview | Original article link |
| DW News | Live publisher feed preview; snapshot fallback | Original article link |
| PBS News | Publisher feed preview | Original article link |
| ProPublica | Publisher feed preview | Original article link |
| ScienceDaily | Publisher feed preview | Original article link |
| Bluesky | Public posts, images, videos, link cards, and quoted posts | Public threads and reply media loaded on demand; snapshot fallback |
| Mastodon | Public posts, media attachments, and link cards | Public replies loaded on demand; partial, with snapshot fallback |
| X / Twitter (optional) | Posts from configured accounts | Optional recent reply snapshots; partial |

### Specialist additions

| Area | Sources |
| --- | --- |
| Linux & open source | LWN.net, Linux Kernel Releases, Phoronix, This Week in Rust |
| Technology & engineering | Hackaday, KrebsOnSecurity, IEEE Spectrum |
| Science | Quanta Magazine, Science News, Nature, Physics World, NASA |
| Gaming | Aftermath, Remap, Rock Paper Shotgun, GamingOnLinux, Game Developer, GamesIndustry.biz, Digital Foundry |

All 19 additions show public feed previews and original article links. The [source catalog](docs/source-catalog.md) records their coverage, roles, feed URLs, and validation. Nature mixes research and news; NASA and kernel.org are primary announcements; This Week in Rust is a community digest. Paid articles and videos remain at their source. ScienceDaily is grouped under Science.

Includes a calendar, topic filters, search, balanced/newest/most-discussed sorting, unread filtering, saved stories, and light/dark themes. The balanced view introduces all six subject groups early and rotates sources so prolific publishers do not take every opening slot. Topic buttons work with search, calendar dates, unread filtering, and Saved. GamingOnLinux appears under both Gaming and Linux; This Week in Rust appears under Linux/open source and Technology. Search and filter views show matching story counts and offer a quick reset. Saved stories and preferences live only in your browser. `/` focuses search; Escape clears search or closes the focused inline reader. Loading more stories moves keyboard focus to the first new headline.

Select a day in the right-hand archive calendar to browse stories published on that day in your local time zone. Use the month arrows to browse; **All dates** clears the filter and returns to the recent feed. On smaller screens, the calendar becomes a compact disclosure above the reading column; the selected date and reset remain visible when it is collapsed. The collector retains 30 days of collected history and discussion snapshots; the calendar loads only the relevant day files. This is the history captured from the feeds, not a complete historical backfill from every publisher. The date filter also works with saved stories, search, and unread filtering.

## Run locally

Requires Python 3.10+; Node 20+ is only needed for the JavaScript tests. No packages to install.

```sh
python3 scripts/collect.py --output site --limit 25
python3 -m http.server 3000 --directory site
```

Open `http://localhost:3000`. If feed collection is unavailable, the browser can still load Hacker News, DEV, DW, WIRED, The Register, Quanta, NASA, Game Developer, and This Week in Rust directly. Social live reads also work when a saved feed snapshot provides their public configuration.

## GitHub Pages

In repository **Settings → Pages**, choose **GitHub Actions** as the source. The included workflow fetches public feeds and publishes `site/` on pushes to `main` or `master`, manual runs, and an hourly schedule. The default sources need no API keys or personal tokens. The workflow only has repository read access plus permission to deploy Pages.

GitHub schedules can be delayed and are disabled in public repositories after 60 days without repository activity. Re-enable the workflow from the Actions tab if necessary. Loading the app or using **Refresh** checks eleven sources directly: **Hacker News, DEV, Bluesky, Mastodon, DW, WIRED, The Register, Quanta, NASA, Game Developer, and This Week in Rust**. Other sources refresh when a new feed snapshot is published.

The collector caches the previous snapshot and archive so a failing source can keep its last working data. The app reports loading failures and labels partial conversations. A snapshot is never presented as a live discussion. Old saved stories remain readable locally; historical discussions can always be opened at their source.

## Direct browser fetching

The browser reads the eleven supported sources without a proxy, API key, or signed-in session. Refresh fetches their recent listings; opening a discussion fetches current HN, DEV, Bluesky, or Mastodon replies. Publisher RSS access provides article previews, not publisher comment APIs. Successful live results are cached in this browser, and unavailable live reads fall back to available saved data. A confirmed removed post does not revive its old discussion.

The Register uses the official destination of its public feed redirect, because the redirect itself does not permit cross-origin browser access. The other tested feeds (including Lobsters) remain collected snapshots because their endpoints do not permit the app's origin. X remains an optional collector-only integration; its bearer token never enters browser code.

[Original browser test results](docs/client-fetch-checks.md) and the [specialist expansion checks](docs/source-checks.json) record endpoints and results from 17 November 2026. The four new direct feeds passed browser reads and matched all 44 tested IDs from the collector. Provider CORS policies and rate limits can change. The workflow still supplies the remaining 28 sources, shared fallback copies, and calendar history. Refresh updates the current feed; it does not backfill arbitrary historical dates.

## Social sources

Edit `config/social.json` to choose Bluesky accounts and a Mastodon instance/hashtag. The defaults include Ars Technica, The Verge, and AP on Bluesky, plus `#technology` on mastodon.social. These are public source feeds, not your signed-in home timelines. Images, video, link cards, and quoted posts render in the inline reader; replies can contain media too.

The collector publishes only those public account/instance/hashtag settings as `clientConfig` in `data/feed.json`; it never publishes X credentials or extra configuration keys. After changing them, regenerate the snapshot. Direct access depends on the chosen Mastodon instance allowing anonymous HTTPS API reads and CORS; the default was tested with mastodon.social.

Bluesky threads may omit blocked, deleted, or depth-limited replies. Mastodon only returns the public conversation known to the selected instance, so its threads are always labeled partial. Reply links preserve each post's canonical URL, including posts originating on another Mastodon server.

## Media and link previews

Open a post to view its images, videos, quoted posts, and external-link cards. Images retain their source alt text and link to the full-size original. Media marked sensitive by its source stays behind a reveal control. Videos start only when clicked and keep their place during background refreshes. Bluesky HLS playback uses the included, locally served hls.js player where supported, with native HLS as a fallback. No runtime CDN script or API key is required.

Hacker News and Lobsters article cards use title, description, and preview-image metadata collected by the existing workflow. The collector reuses metadata for 24 hours and retains the last useful card when a publisher cannot be reached. Live browser refresh preserves a saved preview only while the submitted URL is unchanged. Newly arrived links still show a clickable title/domain card; richer metadata appears after collection. Full articles remain at their publishers.

YouTube and Vimeo links open a player inline after a click. Direct image, audio, and video links also render inline, including supported media links inside comments. Other websites receive a link card rather than an arbitrary embedded page. A publisher can restrict media playback or hotlinking; the original link remains available. Existing article HTML can show validated images, but its scripts and embedded players are never executed.

### Optional X / Twitter connection

X stays off unless explicitly configured. It requires your own developer API access and prepaid usage credits; collection can incur charges under [X's pricing](https://docs.x.com/x-api/getting-started/pricing). Its adapter has fixture tests but has not been verified against a paid live account.

For GitHub Actions, add these in **Settings → Secrets and variables → Actions**:

| Setting | Kind | Value |
| --- | --- | --- |
| `X_BEARER_TOKEN` | Secret | Your X API bearer token |
| `X_ENABLED` | Variable | `true` |
| `X_USERNAMES` | Variable | Up to three comma-separated public account handles |
| `X_FETCH_REPLIES` | Variable | Optional `true`; defaults to off |

The same names work as local environment variables. Keep the token out of source files and browser code. The collector fetches at most five posts per account without automatic pagination. If replies are enabled, it checks at most three posts for up to ten recent replies each. Recent search covers only the available recent window, so these conversations are explicitly partial; missing parent comments retain placeholders. Hourly collection repeats these API reads. Disable `X_ENABLED` to stop them.

Refresh only selected sources during local development:

```sh
python3 scripts/collect.py --output site --sources bbc,guardian,bluesky,mastodon
```

Other saved sources and their original refresh timestamps remain intact.

## Design and correctness

- Plain HTML, CSS, and JavaScript ES modules. No app server, database, framework, public CORS proxy, authentication, or client secrets.
- A Python standard-library collector fetches all configured sources for shared snapshots and calendar history. The browser also fetches the eleven sources that passed direct cross-origin checks, with bounded requests and saved-data fallback.
- The kernel.org release feed is deduplicated by release GUID because distinct releases share its homepage link. Other publisher feeds deduplicate article URLs as before.
- HN comments use the official Firebase API, loading a bounded batch of children on demand. The collector uses the Algolia HN index for fallback discussion snapshots.
- Comment parent relationships are preserved, including placeholders for removed comments. Counts may differ from rendered comments because of moderation, API timing, or explicit limits.
- Source HTML is rebuilt through a tag allowlist. Scripts, styles, forms, source-provided iframes, event handlers, and unsafe URLs are discarded. Validated images load lazily; structured media uses app-created controls. External links use `noopener noreferrer`. Opening media or previews requests files from their original hosts.
- Article-preview collection is bounded and only fetches public HTTP(S) destinations; each redirect is checked. It stores metadata, never article HTML. Preview failures do not make an otherwise healthy feed fail.
- Reply links use native exact-comment URLs: HN `reply?id=…`, Lobsters' supplied comment permalink, DEV `/{user}/comment/{id}`, and each social reply's original post URL. No comments are posted by this app.
- Publisher previews are explicitly labeled. Full external articles and unavailable comments remain on their publishers' sites.

## Check

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

## Source documentation

- [Hacker News API](https://github.com/HackerNews/API)
- [Algolia Hacker News API](https://hn.algolia.com/api)
- [Forem / DEV API](https://developers.forem.com/api/v1)
- [Lobsters source](https://github.com/lobsters/lobsters)
- [Ars Technica RSS feeds](https://arstechnica.com/rss-feeds/)
- [Bluesky public feed API](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed)
- [Mastodon status and context API](https://docs.joinmastodon.org/methods/statuses/)
- [X recent-search API](https://docs.x.com/x-api/posts/search/quickstart/recent-search)
- [GitHub Pages](https://docs.github.com/en/pages)

Feed articles and comments belong to their respective authors and publishers.
