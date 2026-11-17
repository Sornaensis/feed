# Specialist source catalog

**Checked 17 November 2026.** These 19 additions broaden the existing 20-source selection across Linux/open source, engineering, science and gaming. They combine reporting, criticism, research, primary announcements and curated digests; those roles are identified below.

All additions use bounded public feed previews and links to the original publisher. Full articles, subscriber content, video and publisher discussions remain at their source. This batch adds no publisher comment API.

## Linux & open source

| Source | Feed | Role | Coverage | Parsed items |
| --- | --- | --- | --- | ---: |
| [LWN.net](https://lwn.net/) | [RSS](https://lwn.net/headlines/Features) | Journalism | Kernel internals and free-software reporting; recent full articles may require a subscription. | 20 |
| [Linux Kernel Releases](https://www.kernel.org/) | [RSS](https://www.kernel.org/feeds/kdist.xml) | Primary project | Official mainline, stable and long-term kernel release announcements. | 10 |
| [Phoronix](https://www.phoronix.com/) | [RSS](https://www.phoronix.com/rss.php) | Journalism | Kernel changes, open graphics drivers, hardware benchmarks and Linux performance. | 25 |
| [This Week in Rust](https://this-week-in-rust.org/) | [RSS](https://this-week-in-rust.org/rss.xml) | Community digest | Weekly Rust development, articles and project updates; a curated community digest. | 4 |

## Technology & engineering

| Source | Feed | Role | Coverage | Parsed items |
| --- | --- | --- | --- | ---: |
| [Hackaday](https://hackaday.com/) | [RSS](https://hackaday.com/feed/) | Journalism | Electronics, hardware hacking, reverse engineering and maker projects. | 7 |
| [KrebsOnSecurity](https://krebsonsecurity.com/) | [RSS](https://krebsonsecurity.com/feed/) | Journalism | Original cybersecurity and cybercrime investigations. | 10 |
| [IEEE Spectrum](https://spectrum.ieee.org/) | [RSS](https://spectrum.ieee.org/feeds/feed.rss) | Journalism | Engineering, computing, robotics, semiconductors and energy. | 25 |

## Science

| Source | Feed | Role | Coverage | Parsed items |
| --- | --- | --- | --- | ---: |
| [Quanta Magazine](https://www.quantamagazine.org/) | [RSS](https://www.quantamagazine.org/feed/) | Journalism | Mathematics, theoretical physics, computing and basic life sciences. | 5 |
| [Science News](https://www.sciencenews.org/) | [RSS](https://www.sciencenews.org/feed) | Journalism | Independent broad science reporting; premium articles remain at the source. | 20 |
| [Nature](https://www.nature.com/nature/) | [RSS](https://www.nature.com/nature.rss) | Research + journalism | Research papers, science news and policy; this is a mixed feed, not news-only. | 25 |
| [Physics World](https://physicsworld.com/) | [RSS](https://physicsworld.com/feed/) | Journalism | Specialist physics and research reporting; may include sponsored material. | 25 |
| [NASA](https://www.nasa.gov/) | [RSS](https://www.nasa.gov/news-release/feed/) | Primary institution | NASA mission, science and engineering releases; institutional communications. | 10 |

## Gaming

| Source | Feed | Role | Coverage | Parsed items |
| --- | --- | --- | --- | ---: |
| [Aftermath](https://aftermath.site/) | [RSS](https://aftermath.site/rss/) | Journalism | Worker-owned games reporting, labor coverage, criticism and internet culture. | 15 |
| [Remap](https://remapradio.com/) | [RSS](https://remapradio.com/rss/) | Journalism | Independent written reviews, features and criticism; subscriber entries stay previews. | 15 |
| [Rock Paper Shotgun](https://www.rockpapershotgun.com/) | [RSS](https://www.rockpapershotgun.com/feed) | Journalism | PC games, indie discovery, criticism and reviews, alongside news and guides. | 25 |
| [GamingOnLinux](https://www.gamingonlinux.com/) | [RSS](https://www.gamingonlinux.com/article_rss.php) | Journalism | Linux gaming, Steam Deck, Proton, compatibility and open-source tools. | 25 |
| [Game Developer](https://www.gamedeveloper.com/) | [RSS](https://www.gamedeveloper.com/rss.xml) | Journalism | Industry reporting, interviews, production and design; also contributed blogs. | 25 |
| [GamesIndustry.biz](https://www.gamesindustry.biz/) | [RSS](https://www.gamesindustry.biz/feed) | Journalism | Games business, studios, labor and industry reporting. | 25 |
| [Digital Foundry](https://www.digitalfoundry.net/) | [RSS](https://www.digitalfoundry.net/feeds/latest) | Technical journalism | Technical graphics, frame-rate and hardware analysis; videos stay at the source. | 25 |

## Fetching and limits

Counts are from the checked responses, capped at 25 posts per feed. Feeds vary in length and cadence: a weekly digest or a small public feed is not a complete archive. The calendar stores collected history.

The kernel feed contains 10 distinct release GUIDs that all link to the same homepage. The collector now deduplicates this feed by release GUID and retains all 10.

**Direct browser fetching enabled:** This Week in Rust, Quanta, NASA and Game Developer passed real-browser CORS reads and collector-ID comparisons for all 44 returned records. Together with the seven previously supported sources, 11 sources now refresh directly. The other new feeds use collector snapshots. Tests used the local browser preview with separate GitHub Pages-origin header checks; provider policies can change.

LWN requests at least 15 minutes between feed polls; the existing hourly collector respects that interval. Science News has discontinued on-site article comments. Nature mixes research and editorial/news material; NASA is an institutional source. The source label and original link keep these distinctions visible.

ESA was considered but not enabled: the feed linked from its official RSS directory returned HTTP 404.

Response metadata, exact checked URLs, and primary publisher/project provenance links are recorded in [source-checks.json](source-checks.json). No source is treated as a substitute for complete coverage of its field.

To repeat the four direct-feed checks, serve the repository root (`python3 -m http.server 3000`) and open `/tests/browser/source-check.html`. The button performs bounded public reads. It compares IDs where current stories overlap the captured collector records and explicitly skips that comparison when none remain.
