#!/usr/bin/env python3
"""Fetch public feeds and discussion snapshots for a static GitHub Pages reader.

Uses only Python's standard library. Run from any directory:
    python3 scripts/collect.py --output site --limit 25
Previously collected sources and threads survive temporary upstream failures.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from threading import Lock
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from social import SOCIAL_SOURCES, collect_bluesky, collect_mastodon, collect_x, public_config, x_enabled
from link_preview import fetch_link_preview, normalize_preview, preview_is_fresh

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
MAX_COMMENTS = 2000
MAX_DEPTH = 75
ARCHIVE_DAYS = 30
TIMEOUT = 20
USER_AGENT = "TheFeed/1.0 (public RSS and API reader; no scraping)"
# Forem's anonymous limits are 2 requests/second and 25/minute. One shared
# start-time gate covers both listing and detail requests across worker threads.
DEV_INTERVAL = 2.6
_dev_lock = Lock()
_dev_next_start = 0.0
_DEFAULT_PREVIEW = object()
SOURCES = [
    dict(id="hn", name="Hacker News", homeUrl="https://news.ycombinator.com/", short="Y", color="#ef6a32", commentMode="live", category="technology"),
    dict(id="lobsters", name="Lobsters", homeUrl="https://lobste.rs/", short="L", color="#ba4b46", commentMode="snapshot", category="technology"),
    dict(id="dev", name="DEV Community", homeUrl="https://dev.to/", short="DEV", color="#6366f1", commentMode="live", category="technology"),
    dict(id="ars", name="Ars Technica", homeUrl="https://arstechnica.com/", short="ars", color="#ed4e28", commentMode="external", category="technology"),
    dict(id="verge", name="The Verge", homeUrl="https://www.theverge.com/", short="V", color="#9f55dd", commentMode="external", category="technology"),
    dict(id="techcrunch", name="TechCrunch", homeUrl="https://techcrunch.com/", short="TC", color="#229b55", commentMode="external", category="technology"),
    dict(id="slashdot", name="Slashdot", homeUrl="https://slashdot.org/", short="/.", color="#25868b", commentMode="external", category="technology"),
    dict(id="bbc", name="BBC World", homeUrl="https://www.bbc.com/news/world", short="BBC", color="#222222", commentMode="external", category="news"),
    dict(id="guardian", name="The Guardian", homeUrl="https://www.theguardian.com/world", short="G", color="#222222", commentMode="external", category="news"),
    dict(id="npr", name="NPR News", homeUrl="https://www.npr.org/sections/news/", short="NPR", color="#222222", commentMode="external", category="news"),
    dict(id="aljazeera", name="Al Jazeera", homeUrl="https://www.aljazeera.com/", short="AJ", color="#222222", commentMode="external", category="news"),
    dict(id="dw", name="DW News", homeUrl="https://www.dw.com/en/", short="DW", color="#222222", commentMode="external", category="news"),
    dict(id="register", name="The Register", homeUrl="https://www.theregister.com/", short="R", color="#d6292f", commentMode="external", category="technology"),
    dict(id="wired", name="WIRED", homeUrl="https://www.wired.com/", short="W", color="#222222", commentMode="external", category="technology"),
    dict(id="pbs", name="PBS News", homeUrl="https://www.pbs.org/newshour/", short="PBS", color="#2875ce", commentMode="external", category="news"),
    dict(id="propublica", name="ProPublica", homeUrl="https://www.propublica.org/", short="PP", color="#236a8d", commentMode="external", category="news"),
    dict(id="sciencedaily", name="ScienceDaily", homeUrl="https://www.sciencedaily.com/", short="SD", color="#357d5d", commentMode="external", category="science"),
    dict(id="media404", name="404 Media", homeUrl="https://www.404media.co/", short="404", color="#c4542f", commentMode="external", category="technology"),
    dict(id="lwn", name="LWN.net", homeUrl="https://lwn.net/", short="LWN", color="#397751", commentMode="external", category="linux", description="Kernel internals and free-software reporting"),
    dict(id="kernel", name="Linux Kernel Releases", homeUrl="https://www.kernel.org/", short="K", color="#397751", commentMode="external", category="linux", description="Official mainline, stable, and long-term kernel releases"),
    dict(id="phoronix", name="Phoronix", homeUrl="https://www.phoronix.com/", short="P", color="#397751", commentMode="external", category="linux", description="Linux hardware, graphics drivers, and performance"),
    dict(id="rustweekly", name="This Week in Rust", homeUrl="https://this-week-in-rust.org/", short="RS", color="#397751", commentMode="external", category="linux", topics=["technology"], description="Weekly Rust development and community digest"),
    dict(id="hackaday", name="Hackaday", homeUrl="https://hackaday.com/", short="H", color="#64748b", commentMode="external", category="technology", description="Electronics, hardware hacking, and maker projects"),
    dict(id="krebs", name="KrebsOnSecurity", homeUrl="https://krebsonsecurity.com/", short="KS", color="#64748b", commentMode="external", category="technology", description="Cybersecurity and cybercrime investigations"),
    dict(id="spectrum", name="IEEE Spectrum", homeUrl="https://spectrum.ieee.org/", short="IEEE", color="#64748b", commentMode="external", category="technology", description="Engineering, robotics, semiconductors, and energy"),
    dict(id="quanta", name="Quanta Magazine", homeUrl="https://www.quantamagazine.org/", short="Q", color="#466ca8", commentMode="external", category="science", description="Mathematics, physics, biology, and theoretical computing"),
    dict(id="sciencenews", name="Science News", homeUrl="https://www.sciencenews.org/", short="SN", color="#466ca8", commentMode="external", category="science", description="Independent reporting across the sciences"),
    dict(id="nature", name="Nature", homeUrl="https://www.nature.com/nature/", short="N", color="#466ca8", commentMode="external", category="science", description="Research, science news, and policy"),
    dict(id="physicsworld", name="Physics World", homeUrl="https://physicsworld.com/", short="PW", color="#466ca8", commentMode="external", category="science", description="Physics research and applications"),
    dict(id="nasa", name="NASA", homeUrl="https://www.nasa.gov/", short="NASA", color="#466ca8", commentMode="external", category="science", description="Official mission, science, and engineering news releases"),
    dict(id="aftermath", name="Aftermath", homeUrl="https://aftermath.site/", short="A", color="#8c5294", commentMode="external", category="gaming", description="Independent games, labor, and internet-culture reporting"),
    dict(id="remap", name="Remap", homeUrl="https://remapradio.com/", short="RM", color="#8c5294", commentMode="external", category="gaming", description="Independent written reviews, features, and criticism"),
    dict(id="rps", name="Rock Paper Shotgun", homeUrl="https://www.rockpapershotgun.com/", short="RPS", color="#8c5294", commentMode="external", category="gaming", description="PC games, indie discovery, criticism, and reviews"),
    dict(id="gamingonlinux", name="GamingOnLinux", homeUrl="https://www.gamingonlinux.com/", short="GOL", color="#8c5294", commentMode="external", category="gaming", topics=["linux"], description="Linux gaming, Steam Deck, Proton, and compatibility"),
    dict(id="gamedeveloper", name="Game Developer", homeUrl="https://www.gamedeveloper.com/", short="GD", color="#8c5294", commentMode="external", category="gaming", description="Game development, design, production, and industry reporting"),
    dict(id="gamesindustry", name="GamesIndustry.biz", homeUrl="https://www.gamesindustry.biz/", short="GI", color="#8c5294", commentMode="external", category="gaming", description="Game studios, business, labor, and industry reporting"),
    dict(id="digitalfoundry", name="Digital Foundry", homeUrl="https://www.digitalfoundry.net/", short="DF", color="#8c5294", commentMode="external", category="gaming", description="Technical game, graphics, hardware, and performance analysis"),
] + SOCIAL_SOURCES
FEEDS = {
    "ars": "https://feeds.arstechnica.com/arstechnica/index",
    "verge": "https://www.theverge.com/rss/index.xml",
    "techcrunch": "https://techcrunch.com/feed/",
    "slashdot": "https://rss.slashdot.org/Slashdot/slashdotMain",
    "bbc": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "guardian": "https://www.theguardian.com/world/rss",
    "npr": "https://feeds.npr.org/1001/rss.xml",
    "aljazeera": "https://www.aljazeera.com/xml/rss/all.xml",
    "dw": "https://rss.dw.com/rdf/rss-en-all",
    "register": "https://www.theregister.com/headlines.atom",
    "wired": "https://www.wired.com/feed/rss",
    "pbs": "https://www.pbs.org/newshour/feeds/rss/headlines",
    "propublica": "https://www.propublica.org/feeds/propublica/main",
    "sciencedaily": "https://www.sciencedaily.com/rss/top.xml",
    "media404": "https://www.404media.co/rss/",
    "lwn": "https://lwn.net/headlines/Features",
    "kernel": "https://www.kernel.org/feeds/kdist.xml",
    "phoronix": "https://www.phoronix.com/rss.php",
    "rustweekly": "https://this-week-in-rust.org/rss.xml",
    "hackaday": "https://hackaday.com/feed/",
    "krebs": "https://krebsonsecurity.com/feed/",
    "spectrum": "https://spectrum.ieee.org/feeds/feed.rss",
    "quanta": "https://www.quantamagazine.org/feed/",
    "sciencenews": "https://www.sciencenews.org/feed",
    "nature": "https://www.nature.com/nature.rss",
    "physicsworld": "https://physicsworld.com/feed/",
    "nasa": "https://www.nasa.gov/news-release/feed/",
    "aftermath": "https://aftermath.site/rss/",
    "remap": "https://remapradio.com/rss/",
    "rps": "https://www.rockpapershotgun.com/feed",
    "gamingonlinux": "https://www.gamingonlinux.com/article_rss.php",
    "gamedeveloper": "https://www.gamedeveloper.com/rss.xml",
    "gamesindustry": "https://www.gamesindustry.biz/feed",
    "digitalfoundry": "https://www.digitalfoundry.net/feeds/latest",
}
# These publishers are preview sources: prefer their public summaries and keep
# even content-only feed entries to a short excerpt, never a full article.
PREVIEW_ONLY_SOURCES = {
    "register", "wired", "pbs", "propublica", "sciencedaily", "media404",
    "lwn", "kernel", "phoronix", "rustweekly", "hackaday", "krebs", "spectrum",
    "quanta", "sciencenews", "nature", "physicsworld", "nasa",
    "aftermath", "remap", "rps", "gamingonlinux", "gamedeveloper", "gamesindustry", "digitalfoundry",
}
PREVIEW_LIMIT = 1200


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def iso_date(value) -> str | None:
    """Normalize timestamps; missing/invalid upstream dates stay unknown."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value, timezone.utc)
        else:
            try:
                dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
            except ValueError:
                dt = parsedate_to_datetime(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return None


def number(value) -> int | None:
    try:
        return int(value) if value is not None and value != "" else None
    except (ValueError, TypeError):
        return None


def safe_url(value, fallback="") -> str:
    value = html.unescape(str(value or "")).strip()
    try:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
            return fallback
        return value
    except ValueError:
        return fallback


def canonical_url(value) -> str:
    """Remove marketing parameters while retaining meaningful source identifiers."""
    value = safe_url(value)
    if not value:
        return ""
    parts = urlsplit(value)
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                       if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"p", "br", "div", "li", "blockquote", "h1", "h2", "h3"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.hidden:
            self.hidden -= 1
        elif tag in {"p", "div", "li", "blockquote"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value, limit=None) -> str:
    parser = PlainText()
    parser.feed(str(value or ""))
    value = re.sub(r"\s+", " ", "".join(parser.parts)).strip()
    if limit and len(value) > limit:
        return value[:limit].rsplit(" ", 1)[0].rstrip() + "…"
    return value


def request_bytes(url: str) -> bytes:
    global _dev_next_start
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1"})
    for attempt in range(2):
        if urlsplit(url).hostname == "dev.to":
            with _dev_lock:
                delay = max(0, _dev_next_start - time.monotonic())
                if delay:
                    time.sleep(delay)
                _dev_next_start = time.monotonic() + DEV_INTERVAL
        try:
            with urlopen(request, timeout=TIMEOUT) as response:
                length = number(response.headers.get("Content-Length"))
                if length is not None and length > MAX_BYTES:
                    raise ValueError("upstream response exceeds 8 MiB")
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError("upstream response exceeds 8 MiB")
                return data
        except HTTPError as error:
            if error.code != 429 or attempt:
                raise
            retry_after = error.headers.get("Retry-After", "30")
            delay = number(retry_after)
            if delay is None:
                date = iso_date(retry_after)
                delay = (datetime.fromisoformat(date.replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() if date else 30
            # Long rate-limit windows are a source failure; do not retry early.
            if delay > 60:
                raise
            time.sleep(max(1, delay))


def request_json(url: str):
    return json.loads(request_bytes(url))


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def base_post(source_id, item_id, title, url, discussion_url, **values):
    post = dict(id=f"{source_id}:{item_id}", sourceId=source_id, sourceItemId=str(item_id),
                title=plain(title), url=safe_url(url, safe_url(discussion_url)),
                discussionUrl=safe_url(discussion_url, safe_url(url)), author="", publishedAt=None,
                score=None, commentCount=None, tags=[], excerpt="", bodyHtml="", bodyKind="post",
                commentsMode="external", threadPath=None)
    post.update(values)
    return post


def base_thread(post, comments, *, complete=True, truncated=False):
    return dict(version=1, postId=post["id"], sourceId=post["sourceId"], fetchedAt=now(),
                bodyHtml=post["bodyHtml"], comments=comments, commentCount=post["commentCount"],
                complete=complete, truncated=truncated, stale=False)


def tree_count(comments):
    count, pending = 0, list(comments)
    while pending:
        node = pending.pop()
        count += 1
        pending.extend(node.get("children", []))
    return count


def hn_comments(raw, story_id):
    budget = [MAX_COMMENTS]
    truncated = [False]

    def walk(nodes, parent_id, depth=0):
        result = []
        for node in nodes or []:
            if not isinstance(node, dict) or node.get("id") is None:
                continue
            if depth > MAX_DEPTH or budget[0] <= 0:
                truncated[0] = True
                break
            budget[0] -= 1
            cid = str(node["id"])
            deleted = bool(node.get("deleted") or node.get("dead") or not node.get("author"))
            result.append(dict(id=cid, parentId=str(parent_id), author=plain(node.get("author") or "[deleted]"),
                               publishedAt=iso_date(node.get("created_at") or node.get("created_at_i")),
                               score=number(node.get("points")),
                               bodyHtml="<p>[deleted comment]</p>" if deleted else str(node.get("text") or ""),
                               url=f"https://news.ycombinator.com/item?id={cid}",
                               replyUrl=f"https://news.ycombinator.com/reply?id={cid}&goto=item%3Fid%3D{story_id}",
                               deleted=deleted, children=walk(node.get("children"), cid, depth + 1)))
        return result

    return walk(raw, story_id), truncated[0]


def dev_comments(raw):
    budget = [MAX_COMMENTS]
    truncated = [False]

    def walk(nodes, parent_id=None, depth=0):
        result = []
        for node in nodes or []:
            if not isinstance(node, dict) or not node.get("id_code"):
                continue
            if depth > MAX_DEPTH or budget[0] <= 0:
                truncated[0] = True
                break
            budget[0] -= 1
            cid = str(node["id_code"])
            user = node.get("user") or {}
            username = str(user.get("username") or "")
            deleted = not username or bool(node.get("deleted"))
            # The comment permalink is the exact native reply target, including login.
            url = f"https://dev.to/{username}/comment/{cid}" if username else f"https://dev.to/comment/{cid}"
            result.append(dict(id=cid, parentId=parent_id, author=plain(username or "[deleted]"),
                               publishedAt=iso_date(node.get("created_at")), score=None,
                               bodyHtml="<p>[deleted comment]</p>" if deleted else str(node.get("body_html") or ""),
                               url=url, replyUrl=url, deleted=deleted,
                               children=walk(node.get("children"), cid, depth + 1)))
        return result

    return walk(raw), truncated[0]


def lobsters_comments(raw):
    """Wire flat comment IDs, retaining deleted parents so replies stay nested."""
    nodes, parent_ids, order = {}, {}, []
    for item in (raw or [])[:MAX_COMMENTS]:
        cid = str(item.get("short_id") or "")
        if not cid or cid in nodes:
            continue
        parent = item.get("parent_comment")
        if isinstance(parent, dict):
            parent = parent.get("short_id")
        parent_ids[cid] = str(parent) if parent else None
        deleted = bool(item.get("is_deleted") or item.get("is_moderated"))
        url = safe_url(item.get("url"), safe_url(item.get("short_id_url"), f"https://lobste.rs/c/{cid}"))
        nodes[cid] = dict(id=cid, parentId=parent_ids[cid], author=plain(item.get("commenting_user") or "[deleted]"),
                          publishedAt=iso_date(item.get("created_at")), score=number(item.get("score")),
                          bodyHtml="<p>[deleted comment]</p>" if deleted else str(item.get("comment") or ""),
                          url=url, replyUrl=url, deleted=deleted, children=[])
        order.append(cid)
    roots = []
    truncated = len(raw or []) > MAX_COMMENTS
    for cid in order:
        parent = parent_ids[cid]
        seen, ancestor = {cid}, parent
        # An invalid upstream cycle must not create a cyclic JSON object.
        while ancestor in nodes and ancestor not in seen and len(seen) <= MAX_DEPTH:
            seen.add(ancestor)
            ancestor = parent_ids[ancestor]
        if parent in nodes and ancestor not in seen and len(seen) <= MAX_DEPTH:
            nodes[parent]["children"].append(nodes[cid])
        else:
            if parent in nodes:
                truncated = True
            elif parent:
                # Keep the actual parent ID, but do not claim an orphaned tree is complete.
                truncated = True
            roots.append(nodes[cid])
    return roots, truncated


def xml_name(element):
    return element.tag.rsplit("}", 1)[-1]


def child_text(element, local_name, default=""):
    for child in element:
        if xml_name(child) == local_name:
            return "".join(child.itertext()).strip()
    return default


def parse_feed(data: bytes, source_id: str, limit=25):
    root = ET.fromstring(data)
    atom = xml_name(root) == "feed"
    entries = [e for e in root.iter() if xml_name(e) == ("entry" if atom else "item")]
    posts, seen = [], set()
    for entry in entries:
        if len(posts) >= limit:
            break
        if atom:
            links = [e for e in entry if xml_name(e) == "link"]
            url = next((e.get("href") for e in links if e.get("rel", "alternate") == "alternate"), "")
            discussion = next((e.get("href") for e in links if e.get("rel") == "replies" and "html" in e.get("type", "")), url)
            identity = child_text(entry, "id", url)
            author = next((child_text(e, "name") for e in entry if xml_name(e) == "author"), "")
            date = child_text(entry, "published") or child_text(entry, "updated")
            summary = child_text(entry, "summary")
            body = child_text(entry, "content") or summary
            tags = [e.get("term", "") for e in entry if xml_name(e) == "category"]
        else:
            url = child_text(entry, "link")
            # RSS's unnamespaced <comments> is a URL; slash:comments is a count.
            discussion = next(("".join(e.itertext()).strip() for e in entry if xml_name(e) == "comments" and safe_url("".join(e.itertext()))), url)
            identity = child_text(entry, "guid", url)
            author = child_text(entry, "creator") or child_text(entry, "author")
            date = child_text(entry, "pubDate") or child_text(entry, "date")
            summary = child_text(entry, "description")
            body = child_text(entry, "encoded") or summary
            tags = ["".join(e.itertext()) for e in entry if xml_name(e) in {"category", "subject"}]
        if source_id in PREVIEW_ONLY_SOURCES:
            preview = plain(summary, PREVIEW_LIMIT) or plain(body, PREVIEW_LIMIT)
            body = f"<p>{html.escape(preview)}</p>" if preview else ""
            summary = body
        url = canonical_url(url)
        title = plain(child_text(entry, "title"))
        identity = canonical_url(identity) or identity or url
        # kernel.org links every release to its homepage; its distinct GUIDs
        # identify the individual mainline, stable, and long-term releases.
        dedupe_key = identity if source_id == "kernel" else url
        if not url or not title or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        item_id = hashlib.sha256(identity.encode()).hexdigest()[:20]
        count = next((number(e.text) for e in entry if xml_name(e) == "comments" and number(e.text) is not None), None)
        posts.append(base_post(source_id, item_id, title, url, canonical_url(discussion) or url,
                               author=plain(author), publishedAt=iso_date(date), commentCount=count,
                               tags=[plain(t) for t in tags if t][:8], excerpt=plain(summary or body, 320),
                               bodyHtml=body, bodyKind="excerpt"))
    if not posts:
        raise ValueError("feed returned no usable articles")
    return posts


class Collector:
    def __init__(self, output: Path, limit=25, get_json=request_json, get_bytes=request_bytes, sources=None,
                 get_preview=_DEFAULT_PREVIEW):
        self.output, self.limit = output, limit
        self.get_json, self.get_bytes = get_json, get_bytes
        # Fixture/custom transports never cause an unexpected real metadata
        # request. They may inject get_preview explicitly when testing cards.
        self.get_preview = (fetch_link_preview if get_json is request_json and get_bytes is request_bytes else None) \
            if get_preview is _DEFAULT_PREVIEW else get_preview
        self.previous = read_json(output / "data/feed.json", {}) or {}
        self.errors = []
        self.removed_ids = set()
        self.source_ids = set(sources) if sources is not None else None

    def problem(self, label, error):
        message = f"{label}: {type(error).__name__}: {error}"
        self.errors.append(message)
        print(message, file=sys.stderr, flush=True)

    def previous_post(self, source_id, item_id):
        identity = f"{source_id}:{item_id}"
        previous = next((p for p in self.previous.get("posts", []) if isinstance(p, dict) and p.get("id") == identity), None)
        return dict(previous, stale=True) if previous else None

    def enrich_link_preview(self, post):
        url = post["url"]
        if url == post["discussionUrl"] or post.get("unavailable"):
            return
        previous = self.previous_post(post["sourceId"], post["sourceItemId"])
        cached = normalize_preview(previous.get("linkPreview"), url) if previous and previous.get("url") == url else None
        if cached:
            post["linkPreview"] = cached
        if self.get_preview is None or cached and preview_is_fresh(cached):
            return
        try:
            preview = normalize_preview(self.get_preview(url), url)
            if preview:
                post["linkPreview"] = dict(preview, fetchedAt=now())
        except Exception:
            # A blocked publisher, missing metadata, or timeout must never
            # discard a discussion or turn a healthy source into a failure.
            pass

    def parallel(self, function, items, fallback=None):
        def guarded(item):
            try:
                return function(item)
            except Exception as error:
                self.problem(str(item)[:100], error)
                return fallback(item) if fallback else None
        with ThreadPoolExecutor(max_workers=4) as pool:
            return [item for item in pool.map(guarded, items) if item is not None]

    def save_thread(self, post, fetch):
        relative = f"data/threads/{post['sourceId']}-{post['sourceItemId']}.json"
        path = self.output / relative
        try:
            thread = fetch()
            atomic_json(path, thread)
            post["threadPath"] = relative
        except Exception as error:
            self.problem(post["id"] + " discussion", error)
            old = read_json(path)
            if old and old.get("postId") == post["id"] and isinstance(old.get("comments"), list):
                old["stale"] = True
                old["error"] = "The latest discussion could not be fetched; showing the previous snapshot."
                atomic_json(path, old)
                post["threadPath"] = relative

    def hn(self):
        ids = self.get_json("https://hacker-news.firebaseio.com/v0/topstories.json")
        if not isinstance(ids, list):
            raise ValueError("invalid Hacker News feed")

        def fetch(item_id):
            item = self.get_json(f"https://hacker-news.firebaseio.com/v0/item/{int(item_id)}.json")
            if not item or item.get("deleted") or item.get("dead"):
                self.removed_ids.add(f"hn:{item_id}")
                return None
            sid = str(item["id"])
            discussion = f"https://news.ycombinator.com/item?id={sid}"
            body = str(item.get("text") or "")
            post = base_post("hn", sid, item.get("title"), item.get("url"), discussion,
                             author=plain(item.get("by")), publishedAt=iso_date(item.get("time")),
                             score=number(item.get("score")), commentCount=number(item.get("descendants")),
                             bodyHtml=body, excerpt=plain(body, 320), commentsMode="live", tags=[item.get("type", "story")])
            self.enrich_link_preview(post)

            def thread():
                raw = self.get_json(f"https://hn.algolia.com/api/v1/items/{sid}")
                if not isinstance(raw, dict) or str(raw.get("id")) != sid or not isinstance(raw.get("children"), list):
                    raise ValueError("invalid Hacker News discussion")
                comments, truncated = hn_comments(raw.get("children"), sid)
                complete = not truncated and tree_count(comments) >= (post["commentCount"] or 0)
                result = base_thread(post, comments, complete=complete, truncated=truncated)
                result["provider"] = "Hacker News via Algolia"
                return result
            self.save_thread(post, thread)
            return post
        return self.parallel(fetch, ids[:self.limit], lambda sid: self.previous_post("hn", sid))

    def lobsters(self):
        items = self.get_json("https://lobste.rs/hottest.json")
        if not isinstance(items, list):
            raise ValueError("invalid Lobsters feed")

        def fetch(item):
            sid = str(item["short_id"])
            if not re.fullmatch(r"[a-zA-Z0-9]+", sid):
                raise ValueError("invalid Lobsters item ID")
            discussion = item.get("comments_url") or item.get("short_id_url") or f"https://lobste.rs/s/{sid}"
            body = str(item.get("description") or "")
            post = base_post("lobsters", sid, item.get("title"), item.get("url"), discussion,
                             author=plain(item.get("submitter_user")), publishedAt=iso_date(item.get("created_at")),
                             score=number(item.get("score")), commentCount=number(item.get("comment_count")),
                             bodyHtml=body, excerpt=plain(body, 320), commentsMode="snapshot", tags=item.get("tags", []))
            self.enrich_link_preview(post)

            def thread():
                raw = self.get_json(f"https://lobste.rs/s/{sid}.json")
                if not isinstance(raw, dict) or str(raw.get("short_id")) != sid or not isinstance(raw.get("comments"), list):
                    raise ValueError("invalid Lobsters discussion")
                post["bodyHtml"] = str(raw.get("description") or body)
                post["commentCount"] = number(raw.get("comment_count"))
                comments, truncated = lobsters_comments(raw["comments"])
                return base_thread(post, comments, complete=not truncated, truncated=truncated)
            self.save_thread(post, thread)
            return post
        return self.parallel(fetch, items[:self.limit], lambda item: self.previous_post("lobsters", item.get("short_id")))

    def dev(self):
        items = self.get_json(f"https://dev.to/api/articles?top=7&per_page={self.limit}")
        if not isinstance(items, list):
            raise ValueError("invalid DEV feed")

        def fetch(item):
            sid = str(int(item["id"]))
            post = base_post("dev", sid, item.get("title"), item.get("url"), item.get("url"),
                             author=plain((item.get("user") or {}).get("username")),
                             publishedAt=iso_date(item.get("published_at") or item.get("published_timestamp")),
                             score=number(item.get("public_reactions_count")), commentCount=number(item.get("comments_count")),
                             tags=item.get("tag_list", []), excerpt=plain(item.get("description"), 320),
                             bodyHtml=html.escape(str(item.get("description") or "")), bodyKind="excerpt", commentsMode="live")
            try:
                article = self.get_json(f"https://dev.to/api/articles/{sid}")
                if not isinstance(article, dict) or str(article.get("id")) != sid or not isinstance(article.get("body_html"), str):
                    raise ValueError("invalid DEV article")
                post["bodyHtml"], post["bodyKind"] = article["body_html"], "article"
            except Exception as error:
                self.problem(post["id"] + " article", error)
                previous = self.previous_post("dev", sid)
                if previous and previous.get("bodyKind") == "article" and isinstance(previous.get("bodyHtml"), str):
                    post["bodyHtml"], post["bodyKind"] = previous["bodyHtml"], previous["bodyKind"]

            def thread():
                raw = self.get_json(f"https://dev.to/api/comments?a_id={sid}")
                if not isinstance(raw, list):
                    raise ValueError("invalid DEV discussion")
                comments, truncated = dev_comments(raw)
                return base_thread(post, comments, complete=not truncated, truncated=truncated)
            self.save_thread(post, thread)
            return post
        return self.parallel(fetch, items[:self.limit], lambda item: self.previous_post("dev", item.get("id")))

    def write_archive(self, posts, sources, generated_at=None):
        """Retain collected posts by UTC publication day, not by collection day.

        The recent feed stays small. Calendar views load only the requested day
        files through the manifest. This stores observed history; it does not
        imply that every post published on a day was collected.
        """
        generated_at = generated_at or now()
        collected_at = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        today = collected_at.date()
        cutoff = today - timedelta(days=ARCHIVE_DAYS - 1)
        archive_dir = self.output / "data/archive"
        old_files = [path for path in archive_dir.glob("*.json")
                     if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", path.name)]
        by_id = {}

        def merge(items):
            for post in items if isinstance(items, list) else []:
                if (isinstance(post, dict) and isinstance(post.get("id"), str)
                        and isinstance(post.get("sourceId"), str)
                        and post["id"].startswith(post["sourceId"] + ":")):
                    by_id[post["id"]] = dict(post)

        for path in sorted(old_files):
            if not cutoff.isoformat() <= path.stem <= today.isoformat():
                continue
            day = read_json(path, {})
            if isinstance(day, dict):
                merge(day.get("posts"))
        merge(self.previous.get("posts"))
        merge(posts)

        # A disabled connection or a successful intentional-empty social result
        # must not silently reappear through the calendar. Temporary failures
        # keep their old history, just as they keep their recent snapshot.
        removed_sources = {source["id"] for source in sources
                           if source.get("status") == "disabled"
                           or (source.get("id") in {"bluesky", "mastodon", "x"}
                               and source.get("status") == "ok" and source.get("postCount") == 0)}
        days = {}
        for identity, post in by_id.items():
            if (identity in self.removed_ids or post["sourceId"] in removed_sources
                    or post.get("unavailable") or post.get("deleted") or post.get("dead")):
                continue
            stamp = iso_date(post.get("publishedAt"))
            if not stamp:
                continue
            published = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if published > collected_at or not cutoff <= published.date() <= today:
                continue
            post["publishedAt"] = stamp
            days.setdefault(published.date().isoformat(), []).append(post)

        manifest_days, archive_posts = [], []
        for date in sorted(days, reverse=True):
            day_posts = sorted(days[date], key=lambda post: (post["publishedAt"], post["id"]), reverse=True)
            relative = f"data/archive/{date}.json"
            atomic_json(self.output / relative, dict(version=1, date=date, posts=day_posts))
            manifest_days.append(dict(date=date, count=len(day_posts), path=relative))
            archive_posts.extend(day_posts)
        atomic_json(archive_dir / "index.json", dict(version=1, generatedAt=generated_at,
                                                    retentionDays=ARCHIVE_DAYS, days=manifest_days))
        # Publish the new manifest before removing days which it no longer lists.
        for path in old_files:
            if path.stem not in days:
                try:
                    path.unlink()
                except OSError as error:
                    self.problem(path.name + " archive cleanup", error)
        return archive_posts

    def prune_threads(self, posts):
        """Discard old unreferenced snapshots only after saving a usable feed."""
        referenced = {post.get("threadPath") for post in posts if post.get("threadPath")}
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        for path in (self.output / "data/threads").glob("*.json"):
            if path.relative_to(self.output).as_posix() in referenced:
                continue
            snapshot = read_json(path)
            stamp = iso_date(snapshot.get("fetchedAt")) if isinstance(snapshot, dict) else None
            if stamp and datetime.fromisoformat(stamp.replace("Z", "+00:00")) < cutoff:
                try:
                    path.unlink()
                except OSError as error:
                    # Failed cleanup must not discard an otherwise successful refresh.
                    self.problem(path.name + " cleanup", error)

    def collect(self):
        specs = {source["id"]: source for source in SOURCES}
        selected = set(specs) if self.source_ids is None else self.source_ids
        if not selected or selected - specs.keys():
            raise ValueError("select one or more known sources: " + ", ".join(specs))
        previous_sources = {s["id"]: s for s in self.previous.get("sources", []) if isinstance(s, dict) and "id" in s}
        # A targeted refresh must not re-date, mark stale, or discard untouched
        # sources. Keep their complete posts and original freshness metadata.
        posts = [dict(p) for p in self.previous.get("posts", [])
                 if isinstance(p, dict) and p.get("sourceId") not in selected] if self.source_ids is not None else []
        sources = [{**source, **specs.get(sid, {})} for sid, source in previous_sources.items()
                   if sid not in selected] if self.source_ids is not None else []
        for spec in SOURCES:
            source = dict(spec)
            sid = spec["id"]
            if sid not in selected:
                continue
            if sid == "x" and not x_enabled():
                source.update(status="disabled", postCount=0, lastSuccess=None, error=None)
                sources.append(source)
                print(f"{spec['name']}: not connected", flush=True)
                continue
            before = len(self.errors)
            try:
                social_adapters = {"bluesky": collect_bluesky, "mastodon": collect_mastodon, "x": collect_x}
                if sid in social_adapters:
                    source_posts = social_adapters[sid](self)
                elif sid in {"hn", "lobsters", "dev"}:
                    source_posts = getattr(self, sid)()
                else:
                    source_posts = parse_feed(self.get_bytes(FEEDS[sid]), sid, self.limit)
                if not source_posts and sid not in social_adapters:
                    raise ValueError("source returned no usable posts")
                partial = len(self.errors) > before
                source.update(status="partial" if partial else "ok", lastSuccess=now(),
                              error=f"{len(self.errors) - before} item or discussion fetches failed." if partial else None)
            except Exception as error:
                self.problem(spec["name"], error)
                source_posts = [p for p in self.previous.get("posts", []) if isinstance(p, dict) and p.get("sourceId") == sid]
                source.update(status="stale" if source_posts else "error", lastSuccess=previous_sources.get(sid, {}).get("lastSuccess"),
                              error="Could not refresh this source. Showing the previous snapshot." if source_posts else "This source is temporarily unavailable.")
            source["postCount"] = len(source_posts)
            sources.append(source)
            posts.extend(source_posts)
            print(f"{spec['name']}: {len(source_posts)} posts ({source['status']})", flush=True)
        result = dict(version=1, generatedAt=now(), sources=sources, posts=posts, clientConfig=public_config())
        if not posts:
            raise RuntimeError("no usable sources; leaving the previous output untouched")
        archive_posts = self.write_archive(posts, sources, result["generatedAt"])
        atomic_json(self.output / "data/feed.json", result)
        self.prune_threads(posts + archive_posts)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "site", help="Static site directory (default: site)")
    parser.add_argument("--limit", type=int, default=25, help="Maximum posts per source, 1–50 (default: 25)")
    parser.add_argument("--sources", help="Refresh only these comma-separated source IDs; retain all other saved sources")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error("--limit must be between 1 and 50")
    source_ids = [value.strip() for value in args.sources.split(",") if value.strip()] if args.sources is not None else None
    if source_ids is not None and (not source_ids or set(source_ids) - {source["id"] for source in SOURCES}):
        parser.error("--sources must name known sources: " + ",".join(source["id"] for source in SOURCES))
    try:
        Collector(args.output, args.limit, sources=source_ids).collect()
    except Exception as error:
        print(f"Collection failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
