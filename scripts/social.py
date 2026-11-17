"""Public social feeds and bounded, opt-in X snapshots for the static reader.

Only X uses credentials. Its bearer token stays in an Authorization header in
the collector process; none of the public JSON files contain authentication.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config/social.json"
BSKY_API = "https://public.api.bsky.app/xrpc/"
BSKY_DEPTH = 6
MAX_COMMENTS = 500
MAX_EMBEDS = 20
MAX_QUOTE_DEPTH = 2
X_POSTS_PER_ACCOUNT = 5
X_REPLY_THREADS = 3
X_REPLIES_PER_THREAD = 10
SOCIAL_SOURCES = [
    dict(id="bluesky", name="Bluesky", homeUrl="https://bsky.app/", short="B",
         color="#222222", commentMode="snapshot", category="social"),
    dict(id="mastodon", name="Mastodon", homeUrl="https://mastodon.social/tags/technology", short="M",
         color="#222222", commentMode="snapshot", category="social"),
    dict(id="x", name="X / Twitter", homeUrl="https://x.com/", short="X",
         color="#222222", commentMode="snapshot", category="social", optional=True),
]


def _utc_now():
    return datetime.now(timezone.utc)


def _stamp(value=None):
    return (value or _utc_now()).isoformat(timespec="seconds").replace("+00:00", "Z")


def _date(value):
    try:
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return _stamp(stamp.replace(tzinfo=stamp.tzinfo or timezone.utc).astimezone(timezone.utc))
    except (TypeError, ValueError, OverflowError):
        return None


def _number(value):
    try:
        return int(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def _url(value):
    value = str(value or "").strip()
    try:
        parsed = urlsplit(value)
        if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
            return value
    except ValueError:
        pass
    return ""


def _short(value, limit=180):
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    return value if len(value) <= limit else value[:limit - 1].rstrip() + "…"


def _paragraph(value):
    return "<p>" + html.escape(str(value)).replace("\n", "<br>") + "</p>" if value else ""


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_endtag(self, tag):
        if tag in {"p", "div", "li", "blockquote"}:
            self.parts.append(" ")


def _plain(value):
    parser = _Text()
    parser.feed(str(value or ""))
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()


def _identity(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def _post(source, item_id, title, url, discussion_url, **values):
    post = dict(id=f"{source}:{item_id}", sourceId=source, sourceItemId=str(item_id),
                title=_short(title), url=_url(url) or _url(discussion_url),
                discussionUrl=_url(discussion_url), author="", publishedAt=None,
                score=None, commentCount=None, tags=[], excerpt="", bodyHtml="",
                bodyKind="post", commentsMode="snapshot", threadPath=None)
    post.update(values)
    return post


def _thread(post, comments, *, complete=False, truncated=False, notice=""):
    return dict(version=1, postId=post["id"], sourceId=post["sourceId"], fetchedAt=_stamp(),
                bodyHtml=post["bodyHtml"], embeds=post.get("embeds", []), sensitive=bool(post.get("sensitive")),
                contentWarning=post.get("contentWarning", ""), comments=comments, commentCount=post["commentCount"],
                complete=complete, truncated=truncated, notice=notice, stale=False)


def _unavailable(item_id, parent_id, url="", message="Parent post unavailable in this public snapshot."):
    return dict(id=str(item_id), parentId=parent_id, author="Unavailable", publishedAt=None,
                score=None, bodyHtml=_paragraph(message), url=_url(url), replyUrl=_url(url),
                children=[], embeds=[], sensitive=False, contentWarning="", unavailable=True)


def _missing_thread(post):
    post.update(bodyHtml=_paragraph("This post is no longer publicly available."),
                excerpt="", embeds=[], sensitive=False, contentWarning="", unavailable=True)
    return _thread(post, [], notice="This post was removed or is no longer publicly available.")


def _missing_error(error):
    return isinstance(error, HTTPError) and error.code in {404, 410}


def _config():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("social configuration must be an object")
    return config


def public_config():
    """Publish only the public source settings needed for browser reads."""
    try:
        config = _config()
    except (OSError, ValueError, TypeError):
        return {}
    if not isinstance(config, dict):
        return {}

    def valid_actor(value):
        if not isinstance(value, str):
            return False
        value = value.strip()
        if re.fullmatch(r"did:[a-z0-9]+:[A-Za-z0-9._:%-]+", value):
            return len(value) <= 2048
        labels = value.split(".")
        return (len(value) <= 253 and len(labels) >= 2
                and all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", part)
                        for part in labels)
                and re.match(r"[A-Za-z]", labels[-1]) is not None)

    result = {}
    bluesky = config.get("bluesky")
    actors = bluesky.get("actors") if isinstance(bluesky, dict) else None
    if isinstance(actors, list) and 1 <= len(actors) <= 10 and all(valid_actor(actor) for actor in actors):
        result["bluesky"] = {"actors": list(dict.fromkeys(actor.strip() for actor in actors))}

    mastodon = config.get("mastodon")
    if isinstance(mastodon, dict):
        raw_instance, raw_tag = mastodon.get("instance"), mastodon.get("tag", "technology")
        if isinstance(raw_instance, str) and isinstance(raw_tag, str):
            instance, tag = raw_instance.strip().rstrip("/"), raw_tag.strip().lstrip("#")
            try:
                parsed = urlsplit(instance)
                _ = parsed.port  # Invalid ports must not enter the published config.
                if (parsed.scheme == "https" and parsed.hostname and parsed.username is None and parsed.password is None
                        and not parsed.path and not parsed.query and not parsed.fragment
                        and not re.search(r"[\s\\]", instance) and re.fullmatch(r"\w+", tag)):
                    result["mastodon"] = {"instance": instance, "tag": tag}
            except ValueError:
                pass
    return result


def _previous_account(collector, source, account, limit):
    previous = getattr(collector, "previous", None)
    if not isinstance(previous, dict):
        try:
            previous = json.loads((collector.output / "data/feed.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
    return [dict(post, stale=True) for post in previous.get("posts", [])
            if isinstance(post, dict) and post.get("sourceId") == source
            and str(post.get("sourceAccount", "")).lower() == account.lower()][:limit]


def _interleave(groups, limit, identity):
    """Keep a busy account from crowding the other configured accounts out."""
    result, seen = [], set()
    for index in range(max((len(group) for group in groups), default=0)):
        for group in groups:
            if index >= len(group):
                continue
            item = group[index]
            key = identity(item)
            if key and key not in seen:
                seen.add(key)
                result.append(item)
                if len(result) >= limit:
                    return result
    return result


def _bsky_url(uri, author=None):
    match = re.fullmatch(r"at://([^/]+)/app\.bsky\.feed\.post/([^/?#]+)", str(uri or ""))
    if not match:
        return ""
    actor = (author or {}).get("did") or match[1]
    return f"https://bsky.app/profile/{quote(actor, safe=':')}/post/{quote(match[2], safe='')}"


def _bsky_text(text, facets):
    """Bluesky facet offsets are UTF-8 byte offsets, not character offsets."""
    encoded, cursor, parts = text.encode("utf-8"), 0, []
    for facet in sorted((f for f in facets or [] if isinstance(f, dict)),
                        key=lambda f: _number(f.get("index", {}).get("byteStart")) or 0):
        bounds = facet.get("index", {})
        start, end = _number(bounds.get("byteStart")), _number(bounds.get("byteEnd"))
        if start is None or end is None or start < cursor or not start < end <= len(encoded):
            continue
        link = ""
        for feature in facet.get("features", []):
            if not isinstance(feature, dict):
                continue
            if feature.get("$type") == "app.bsky.richtext.facet#link":
                link = _url(feature.get("uri"))
            elif feature.get("$type") == "app.bsky.richtext.facet#mention" and feature.get("did"):
                link = "https://bsky.app/profile/" + quote(str(feature["did"]), safe=":")
            if link:
                break
        if not link:
            continue
        try:
            before, label = encoded[cursor:start].decode("utf-8"), encoded[start:end].decode("utf-8")
        except UnicodeDecodeError:
            continue
        parts.extend([html.escape(before), f'<a href="{html.escape(link, quote=True)}">{html.escape(label)}</a>'])
        cursor = end
    parts.append(html.escape(encoded[cursor:].decode("utf-8")))
    return "<p>" + "".join(parts).replace("\n", "<br>") + "</p>" if text else ""


def _dimensions(value):
    if not isinstance(value, dict):
        return {}
    width, height = _number(value.get("width")), _number(value.get("height"))
    return dict(width=width, height=height) if width and height and 0 < width <= 100000 and 0 < height <= 100000 else {}


def _media_url(value):
    if not isinstance(value, str) or len(value) > 8192:
        return ""
    try:
        parsed = urlsplit(value.strip())
        _ = parsed.port
        if parsed.username is not None or parsed.password is not None or re.search(r"[\s\\]", value.strip()):
            return ""
    except ValueError:
        return ""
    return _url(value)


def _bsky_warning(view):
    value = view.get("record") if isinstance(view.get("record"), dict) else view.get("value")
    value = value if isinstance(value, dict) else {}
    record_labels = value.get("labels") if isinstance(value.get("labels"), dict) else {}
    labels = (view.get("labels") if isinstance(view.get("labels"), list) else []) + \
        (record_labels.get("values") if isinstance(record_labels.get("values"), list) else [])
    warning_labels = {"porn", "sexual", "nudity", "graphic-media", "gore", "corpse", "self-harm", "!warn", "!hide"}
    sensitive = any(isinstance(label, dict) and not label.get("neg") and label.get("val") in warning_labels for label in labels)
    return dict(sensitive=sensitive, contentWarning="Sensitive content" if sensitive else "")


def _bsky_embeds(value, depth=0, nesting=0):
    if not isinstance(value, dict) or depth > MAX_QUOTE_DEPTH or nesting > 8:
        return []
    result = []

    def add_image(image):
        if not isinstance(image, dict):
            return
        thumbnail = _media_url(image.get("thumb")) or _media_url(image.get("thumbnail"))
        url = _media_url(image.get("fullsize")) or thumbnail
        if url:
            result.append(dict(type="image", url=url, thumbnailUrl=thumbnail,
                               alt=str(image.get("alt") or "")[:3000], **_dimensions(image.get("aspectRatio"))))

    for image in (value.get("images") if isinstance(value.get("images"), list) else [])[:MAX_EMBEDS]:
        add_image(image)
    playlist = _media_url(value.get("playlist"))
    if playlist:
        result.append(dict(type="video", url=playlist, posterUrl=_media_url(value.get("thumbnail")),
                           alt=str(value.get("alt") or "")[:3000], mimeType="application/vnd.apple.mpegurl",
                           **_dimensions(value.get("aspectRatio"))))
    external = value.get("external") if isinstance(value.get("external"), dict) else {}
    url = _media_url(external.get("uri"))
    if url:
        result.append(dict(type="link", url=url, title=str(external.get("title") or "")[:300],
                           description=str(external.get("description") or "")[:1000], imageUrl=_media_url(external.get("thumb"))))
    if isinstance(value.get("media"), dict):
        result.extend(_bsky_embeds(value["media"], depth, nesting + 1))
    for item in (value.get("items") if isinstance(value.get("items"), list) else [])[:MAX_EMBEDS]:
        if not isinstance(item, dict):
            continue
        if item.get("fullsize") or item.get("thumb") or item.get("thumbnail") and not item.get("playlist"):
            add_image(item)
        elif item.get("playlist"):
            result.extend(_bsky_embeds(item, depth, nesting + 1))
    if depth < MAX_QUOTE_DEPTH and isinstance(value.get("record"), dict):
        quoted = value["record"].get("record") if isinstance(value["record"].get("record"), dict) else value["record"]
        author = quoted.get("author") if isinstance(quoted.get("author"), dict) else {}
        url = _bsky_url(quoted.get("uri"), author)
        unavailable = (quoted.get("notFound") or quoted.get("blocked") or quoted.get("detached")
                       or re.search(r"#view(?:NotFound|Blocked|Detached)$", str(quoted.get("$type") or "")))
        if url and unavailable:
            result.append(dict(type="quote", url=url, author="Unavailable", bodyHtml=_paragraph("This quoted post is unavailable."),
                               embeds=[], unavailable=True))
        elif url and isinstance(quoted.get("value"), dict):
            record_value = quoted["value"]
            embeds = []
            for embed in (quoted.get("embeds") if isinstance(quoted.get("embeds"), list) else [])[:MAX_EMBEDS]:
                embeds.extend(_bsky_embeds(embed, depth + 1, nesting + 1))
            result.append(dict(type="quote", url=url, author="@" + str(author.get("handle") or author.get("did") or "unknown"),
                               bodyHtml=_bsky_text(str(record_value.get("text") or ""), record_value.get("facets")),
                               publishedAt=_date(record_value.get("createdAt") or quoted.get("indexedAt")),
                               embeds=embeds[:MAX_EMBEDS], **_bsky_warning(quoted)))
    return result[:MAX_EMBEDS]


def _bsky_content(view):
    record = view.get("record") if isinstance(view.get("record"), dict) else {}
    text = str(record.get("text") or "")
    body = _bsky_text(text, record.get("facets"))
    embeds = _bsky_embeds(view["embed"] if isinstance(view.get("embed"), dict) else record.get("embed"))
    external = next((embed for embed in embeds if embed["type"] == "link"), {})
    if not body and not embeds:
        body = _paragraph("Open the original post on Bluesky.")
    return dict(title=external.get("title") or _short(text) or ("Bluesky media post" if embeds else "Bluesky post"),
                bodyHtml=body, excerpt=_short(text or external.get("description"), 320), url=external.get("url", ""),
                embeds=embeds, **_bsky_warning(view))


def _bsky_post(view, account):
    if view.get("blocked") or view.get("notFound") or view.get("deleted"):
        raise ValueError("Bluesky post is no longer public")
    uri = str(view.get("uri") or "")
    author = view.get("author") or {}
    canonical = _bsky_url(uri, author)
    if not canonical:
        raise ValueError("Bluesky post has no valid AT URI")
    content = _bsky_content(view)
    record = view.get("record") or {}
    tags = [tag for tag in record.get("tags", []) if isinstance(tag, str)]
    return _post("bluesky", _identity(uri), content["title"], content["url"] or canonical, canonical,
                 author="@" + str(author.get("handle") or author.get("did") or "unknown"),
                 publishedAt=_date(record.get("createdAt") or view.get("indexedAt")),
                 score=_number(view.get("likeCount")), commentCount=_number(view.get("replyCount")),
                 tags=tags, excerpt=content["excerpt"], bodyHtml=content["bodyHtml"], embeds=content["embeds"],
                 sensitive=content["sensitive"], contentWarning=content["contentWarning"], atUri=uri, sourceAccount=account)


def _bsky_thread(post, payload):
    root = payload.get("thread") if isinstance(payload, dict) else None
    if not isinstance(root, dict):
        raise ValueError("invalid Bluesky thread response")
    if root.get("notFound") or root.get("blocked"):
        return _missing_thread(post)
    if not isinstance(root.get("post"), dict):
        raise ValueError("Bluesky thread has no root post")
    if root["post"].get("uri") != post["atUri"]:
        raise ValueError("Bluesky thread returned a different root post")
    seen, budget, partial = {post["atUri"]}, [MAX_COMMENTS], [False]

    def walk(parent, parent_id, depth):
        children = parent.get("replies", [])
        if not isinstance(children, list):
            partial[0] = True
            children = []
        expected = _number((parent.get("post") or {}).get("replyCount"))
        if expected is None or expected > len(children):
            partial[0] = True
        result = []
        for node in children:
            if budget[0] <= 0 or depth > BSKY_DEPTH:
                partial[0] = True
                break
            if not isinstance(node, dict):
                partial[0] = True
                continue
            view = node.get("post") or {}
            uri = str(view.get("uri") or node.get("uri") or "")
            if not uri or uri in seen:
                partial[0] = True
                continue
            seen.add(uri)
            budget[0] -= 1
            if node.get("blocked") or node.get("notFound") or not view:
                comment = _unavailable(uri, parent_id, _bsky_url(uri),
                                       "This reply is unavailable or blocked in the public view.")
                partial[0] = True
            else:
                author = view.get("author") or {}
                canonical = _bsky_url(uri, author)
                content = _bsky_content(view)
                comment = dict(id=uri, parentId=parent_id,
                               author="@" + str(author.get("handle") or author.get("did") or "unknown"),
                               publishedAt=_date((view.get("record") or {}).get("createdAt")),
                               score=_number(view.get("likeCount")), bodyHtml=content["bodyHtml"], embeds=content["embeds"],
                               sensitive=content["sensitive"], contentWarning=content["contentWarning"],
                               url=canonical, replyUrl=canonical, children=[])
            comment["children"] = walk(node, uri, depth + 1)
            result.append(comment)
        return result

    comments = walk(root, None, 1)
    content = _bsky_content(root["post"])
    post.update({key: content[key] for key in ("bodyHtml", "excerpt", "embeds", "sensitive", "contentWarning")})
    return _thread(post, comments, complete=not partial[0], truncated=partial[0],
                   notice="Public Bluesky snapshot. Some replies may be unavailable; open Bluesky for the latest conversation.")


def collect_bluesky(collector):
    actors = _config().get("bluesky", {}).get("actors", [])
    if not isinstance(actors, list) or not actors or any(not isinstance(a, str) or not a.strip() for a in actors):
        raise ValueError("configure at least one Bluesky actor")
    actors = list(dict.fromkeys(a.strip() for a in actors))
    if len(actors) > 10:
        raise ValueError("configure at most ten Bluesky actors")
    limit = min(25, max(1, int(collector.limit)))
    per_account = max(1, (limit + len(actors) - 1) // len(actors))
    handled = []

    def fetch_account(actor):
        url = BSKY_API + "app.bsky.feed.getAuthorFeed?" + urlencode(
            dict(actor=actor, filter="posts_no_replies", limit=per_account))
        try:
            payload = collector.get_json(url)
        except HTTPError as error:
            if not _missing_error(error):
                raise
            handled.append(actor)  # A known removal must not revive old posts.
            return []
        if not isinstance(payload, dict) or not isinstance(payload.get("feed"), list):
            raise ValueError("invalid Bluesky account feed")
        items = [dict(account=actor, view=item["post"]) for item in payload["feed"][:per_account]
                 if isinstance(item, dict) and isinstance(item.get("post"), dict)]
        if payload["feed"] and not items:
            raise ValueError("Bluesky account feed has no usable post records")
        handled.append(actor)
        return items

    def old_account(actor):
        return [dict(previous=post) for post in _previous_account(collector, "bluesky", actor, per_account)]

    groups = collector.parallel(fetch_account, actors, old_account)
    tasks = _interleave(groups, limit, lambda item: (item.get("previous") or {}).get("id")
                        or "bluesky:" + _identity((item.get("view") or {}).get("uri")))
    if not tasks:
        if handled:
            return []
        raise ValueError("Bluesky accounts returned no usable posts")

    def fetch_post(item):
        if "previous" in item:
            return item["previous"]
        post = _bsky_post(item["view"], item["account"])

        def fetch_thread():
            url = BSKY_API + "app.bsky.feed.getPostThread?" + urlencode(
                dict(uri=post["atUri"], depth=BSKY_DEPTH, parentHeight=0))
            try:
                return _bsky_thread(post, collector.get_json(url))
            except HTTPError as error:
                if _missing_error(error):
                    return _missing_thread(post)
                raise

        collector.save_thread(post, fetch_thread)
        return post

    posts = collector.parallel(fetch_post, tasks,
                               lambda item: collector.previous_post("bluesky", _identity((item.get("view") or {}).get("uri"))))
    if not posts:
        raise ValueError("Bluesky returned no usable post records")
    return posts


def _nest_comments(comments, root_id, missing_url):
    """Retain absent parents and break malformed cycles without losing replies."""
    nodes = {node["id"]: node for node in comments if node["id"] != root_id}
    partial = len(nodes) != len(comments)
    for node in list(nodes.values()):
        parent = node.get("parentId")
        if parent == root_id:
            node["parentId"] = None
        elif parent and parent not in nodes:
            nodes[parent] = _unavailable(parent, None, missing_url(parent))
            partial = True
    roots = []
    for node in nodes.values():
        parent, seen = node.get("parentId"), {node["id"]}
        cursor = parent
        while cursor in nodes:
            if cursor in seen:
                node["parentId"] = parent = None
                partial = True
                break
            seen.add(cursor)
            cursor = nodes[cursor].get("parentId")
        if parent in nodes:
            nodes[parent]["children"].append(node)
        else:
            roots.append(node)
    return roots, partial


def _mastodon_body(status):
    body = str(status.get("content") or "")
    warning = str(status.get("spoiler_text") or "").strip()
    if warning:
        body = _paragraph("Content warning: " + warning) + body
    return body


def _mastodon_media(status):
    embeds = []
    for media in (status.get("media_attachments") if isinstance(status.get("media_attachments"), list) else [])[:MAX_EMBEDS]:
        if not isinstance(media, dict):
            continue
        url = _media_url(media.get("url")) or _media_url(media.get("remote_url"))
        if not url:
            continue
        meta = media.get("meta") if isinstance(media.get("meta"), dict) else {}
        base = dict(url=url, alt=str(media.get("description") or "")[:3000], **_dimensions(meta.get("original") or meta))
        if media.get("type") == "image":
            embeds.append(dict(type="image", **base, thumbnailUrl=_media_url(media.get("preview_url"))))
        elif media.get("type") in {"video", "gifv"}:
            embeds.append(dict(type="video", **base, posterUrl=_media_url(media.get("preview_url"))))
        elif media.get("type") == "audio":
            embeds.append(dict(type="audio", **base))
        else:
            embeds.append(dict(type="link", url=url, title=base["alt"] or "Attached media", description=""))
    card = status.get("card") if isinstance(status.get("card"), dict) else {}
    url = _media_url(card.get("url"))
    if url:
        embeds.append(dict(type="link", url=url, title=str(card.get("title") or "")[:300],
                           description=str(card.get("description") or "")[:1000], imageUrl=_media_url(card.get("image")),
                           siteName=str(card.get("provider_name") or "")[:120]))
    warning = str(status.get("spoiler_text") or "").strip()
    return dict(embeds=embeds[:MAX_EMBEDS], sensitive=bool(status.get("sensitive") or warning),
                contentWarning=warning or ("Sensitive content" if status.get("sensitive") else ""))


def _mastodon_post(status, instance, tag):
    local_id = str(status.get("id") or "")
    canonical = _url(status.get("url")) or _url(status.get("uri"))
    if not re.fullmatch(r"[0-9]+", local_id) or not canonical:
        raise ValueError("Mastodon status has no local ID or canonical URL")
    account = status.get("account") or {}
    text = _plain(status.get("content"))
    title = status.get("spoiler_text") or text or "Mastodon media post"
    return _post("mastodon", _identity(instance + "/" + local_id), title, canonical, canonical,
                 author="@" + str(account.get("acct") or account.get("username") or "unknown"),
                 publishedAt=_date(status.get("created_at")), score=_number(status.get("favourites_count")),
                 commentCount=_number(status.get("replies_count")), tags=[tag], excerpt=_short(text, 320),
                 bodyHtml=_mastodon_body(status), **_mastodon_media(status), mastodonLocalId=local_id, sourceInstance=instance)


def _mastodon_thread(post, payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("descendants"), list):
        raise ValueError("invalid Mastodon context response")
    comments = []
    for status in payload["descendants"][:60]:
        if (not isinstance(status, dict) or not status.get("id") or status.get("deleted") or status.get("removed")
                or status.get("visibility", "public") not in {"public", "unlisted"}):
            continue
        account = status.get("account") or {}
        canonical = _url(status.get("url")) or _url(status.get("uri"))
        parent_id = status.get("in_reply_to_id")
        comments.append(dict(id=str(status["id"]), parentId=str(parent_id) if parent_id else None,
                             author="@" + str(account.get("acct") or account.get("username") or "unknown"),
                             publishedAt=_date(status.get("created_at")), score=_number(status.get("favourites_count")),
                             bodyHtml=_mastodon_body(status), **_mastodon_media(status), url=canonical, replyUrl=canonical, children=[]))
    # A federated status ID belongs to the API instance. Only status.url is a
    # known canonical destination, so absent parents deliberately have no link.
    comments, partial = _nest_comments(comments, post["mastodonLocalId"], lambda _id: "")
    return _thread(post, comments, truncated=partial or len(payload["descendants"]) >= 60,
                   notice="Partial public Mastodon snapshot: this instance may not know every reply. "
                          "Anonymous context is limited to 60 descendants and 20 levels. Open the original for the full conversation.")


def collect_mastodon(collector):
    config = _config().get("mastodon", {})
    instance = _url(config.get("instance")).rstrip("/")
    parsed = urlsplit(instance)
    tag = str(config.get("tag") or "technology").strip().lstrip("#")
    if parsed.scheme != "https" or parsed.path or parsed.query or parsed.fragment or not tag:
        raise ValueError("Mastodon instance must be an HTTPS origin and tag must be nonempty")
    limit = min(25, max(1, int(collector.limit)))
    payload = collector.get_json(f"{instance}/api/v1/timelines/tag/{quote(tag, safe='')}?limit={limit}")
    if not isinstance(payload, list):
        raise ValueError("invalid Mastodon hashtag timeline")
    if payload and not any(isinstance(item, dict) for item in payload):
        raise ValueError("Mastodon timeline has no usable status records")
    statuses, seen = [], set()
    for item in payload[:limit]:
        if isinstance(item, dict):
            status = item.get("reblog") or item
            if (isinstance(status, dict) and str(status.get("id")) not in seen
                    and not status.get("deleted") and not status.get("removed")
                    and status.get("visibility", "public") in {"public", "unlisted"}):
                statuses.append(status)
                seen.add(str(status.get("id")))

    def fetch(status):
        post = _mastodon_post(status, instance, tag)

        def fetch_thread():
            try:
                payload = collector.get_json(f"{instance}/api/v1/statuses/{post['mastodonLocalId']}/context")
                return _mastodon_thread(post, payload)
            except HTTPError as error:
                if _missing_error(error):
                    return _missing_thread(post)
                raise

        collector.save_thread(post, fetch_thread)
        return post

    posts = collector.parallel(fetch, statuses, lambda status: collector.previous_post(
        "mastodon", _identity(instance + "/" + str(status.get("id") or ""))))
    if statuses and not posts:
        raise ValueError("Mastodon returned no usable status records")
    return posts


def _x_usernames():
    handles = [part.lstrip("@") for part in re.split(r"[\s,]+", os.getenv("X_USERNAMES", "").strip()) if part]
    handles = list(dict.fromkeys(handle.lower() for handle in handles))
    if not 1 <= len(handles) <= 3 or any(not re.fullmatch(r"[A-Za-z0-9_]{1,15}", handle) for handle in handles):
        return []
    return handles


def x_enabled():
    token = os.getenv("X_BEARER_TOKEN", "").strip()
    return (os.getenv("X_ENABLED", "").strip().lower() == "true" and bool(token)
            and not any(char.isspace() for char in token) and bool(_x_usernames()))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _x_json(path, params):
    """One paid API request, with no redirects, retries, or pagination."""
    if not x_enabled():
        raise RuntimeError("X collection is disabled")
    if not re.fullmatch(r"/2/(?:users/by|users/[0-9]+/tweets|tweets/search/recent)", path):
        raise ValueError("unsupported X endpoint")
    request = Request("https://api.x.com" + path + "?" + urlencode(params),
                      headers={"Authorization": "Bearer " + os.environ["X_BEARER_TOKEN"].strip(),
                               "User-Agent": "TechReader/1.0", "Accept": "application/json"}, method="GET")
    try:
        with build_opener(_NoRedirect()).open(request, timeout=20) as response:
            data = response.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise ValueError("response too large")
            payload = json.loads(data)
            if not isinstance(payload, dict):
                raise ValueError("invalid response")
            return payload
    except HTTPError as error:
        raise RuntimeError(f"X API request failed (HTTP {error.code}); check access and credit balance") from None
    except Exception:
        # Never stringify a request, an upstream body, or an exception that
        # could contain credentials. Public source status only gets this text.
        raise RuntimeError("X API request failed; no new snapshot was saved") from None


# The official executable quickstart and conversation guide use tweet.fields.
# The generated reference currently calls these post.fields instead. Responses
# are accepted under either naming convention; do not retry a paid request.
X_FIELDS = "author_id,created_at,public_metrics,conversation_id,referenced_tweets,entities,note_tweet"


def _x_url(item_id, username=""):
    username = str(username or "")
    prefix = username if re.fullmatch(r"[A-Za-z0-9_]{1,15}", username) else "i/web"
    return f"https://x.com/{prefix}/status/{quote(str(item_id), safe='')}"


def _x_content(item):
    note = item.get("note_tweet") or item.get("note_post") or {}
    text = str(note.get("text") or item.get("text") or "")
    entities = note.get("entities") or item.get("entities") or {}
    body, linked = _paragraph(text), set()
    for entry in entities.get("urls", []):
        link = _url(entry.get("expanded_url") or entry.get("url")) if isinstance(entry, dict) else ""
        if link and link not in linked:
            linked.add(link)
            body += f'<p><a href="{html.escape(link, quote=True)}">{html.escape(link)}</a></p>'
    tags = [entry["tag"] for entry in entities.get("hashtags", [])
            if isinstance(entry, dict) and isinstance(entry.get("tag"), str)]
    return text, body or _paragraph("Open this post on X to view its media."), tags


def _x_parent(item):
    references = item.get("referenced_tweets") or item.get("referenced_posts") or []
    return next((str(entry["id"]) for entry in references
                 if isinstance(entry, dict) and entry.get("type") == "replied_to" and entry.get("id")), None)


def _x_post(item, user):
    item_id = str(item.get("id") or "")
    if not re.fullmatch(r"[0-9]+", item_id):
        raise ValueError("X post has no numeric ID")
    text, body, tags = _x_content(item)
    metrics = item.get("public_metrics") or {}
    username = str(user.get("username") or "")
    canonical = _x_url(item_id, username)
    return _post("x", item_id, text or "X media post", canonical, canonical,
                 author="@" + username, publishedAt=_date(item.get("created_at")),
                 score=_number(metrics.get("like_count")), commentCount=_number(metrics.get("reply_count")),
                 tags=tags, excerpt=_short(text, 320), bodyHtml=body, sourceAccount=username.lower(),
                 sourceAccountId=str(user.get("id") or ""), conversationId=str(item.get("conversation_id") or item_id))


def _x_data(payload):
    if isinstance(payload.get("data"), list):
        return payload["data"]
    if not payload.get("errors") and (payload.get("meta") or {}).get("result_count") == 0:
        return []
    raise RuntimeError("X did not return a usable public response")


def _x_thread(post):
    # A small margin keeps the request inside X's rolling seven-day boundary.
    start = _utc_now() - timedelta(days=7) + timedelta(minutes=1)
    payload = _x_json("/2/tweets/search/recent", dict(
        query=f"conversation_id:{post['sourceItemId']} is:reply -is:retweet",
        start_time=_stamp(start), max_results=X_REPLIES_PER_THREAD, sort_order="recency",
        **{"tweet.fields": X_FIELDS, "expansions": "author_id", "user.fields": "username"}))
    users = {str(user.get("id")): user for user in (payload.get("includes") or {}).get("users", [])
             if isinstance(user, dict)}
    comments = []
    for item in _x_data(payload)[:X_REPLIES_PER_THREAD]:
        if not isinstance(item, dict) or not re.fullmatch(r"[0-9]+", str(item.get("id") or "")):
            continue
        if str(item["id"]) == post["sourceItemId"] or str(item.get("conversation_id") or post["sourceItemId"]) != post["sourceItemId"]:
            continue
        created = _date(item.get("created_at"))
        if created and datetime.fromisoformat(created.replace("Z", "+00:00")) < start:
            continue
        user = users.get(str(item.get("author_id")), {})
        canonical = _x_url(item["id"], user.get("username"))
        comments.append(dict(id=str(item["id"]), parentId=_x_parent(item),
                             author="@" + user["username"] if user.get("username") else "Unknown author",
                             publishedAt=created, score=_number((item.get("public_metrics") or {}).get("like_count")),
                             bodyHtml=_x_content(item)[1], url=canonical, replyUrl=canonical, children=[]))
    comments, _ = _nest_comments(comments, post["sourceItemId"], _x_url)
    return _thread(post, comments, truncated=True,
                   notice="Partial X reply sample: at most 10 replies from the last 7 days, without pagination. "
                          "Missing parents, older replies, and additional replies are available on X.")


def collect_x(collector):
    if not x_enabled():
        return []
    handles = _x_usernames()
    lookup = _x_json("/2/users/by", {"usernames": ",".join(handles), "user.fields": "username,protected"})
    if not isinstance(lookup.get("data", []), list):
        raise ValueError("invalid X user lookup response")
    users = {str(user.get("username") or "").lower(): user for user in lookup.get("data", [])
             if isinstance(user, dict)}
    removed = {str(error.get("value") or error.get("resource_id") or "").lower()
               for error in lookup.get("errors", []) if isinstance(error, dict)
               and str(error.get("type") or "").endswith("/resource-not-found")}
    valid, retained, handled = [], [], []
    for handle in handles:
        user = users.get(handle)
        if user and not user.get("protected") and re.fullmatch(r"[0-9]+", str(user.get("id") or "")):
            valid.append(user)
        elif handle in removed or (user and user.get("protected")):
            handled.append(handle)  # Explicit removal/privacy change is not a network failure.
        else:
            collector.problem("X @" + handle, RuntimeError("configured public account is unavailable"))
            retained.append(_previous_account(collector, "x", handle, X_POSTS_PER_ACCOUNT))

    def fetch(user):
        payload = _x_json(f"/2/users/{user['id']}/tweets", {
            "max_results": X_POSTS_PER_ACCOUNT, "exclude": "replies,retweets", "tweet.fields": X_FIELDS})
        data = _x_data(payload)
        posts = [_x_post(item, user) for item in data[:X_POSTS_PER_ACCOUNT]
                 if isinstance(item, dict) and not _x_parent(item)]
        if data and not posts:
            raise ValueError("X account returned no usable post records")
        handled.append(str(user["username"]))
        return posts

    groups = collector.parallel(fetch, valid,
                                lambda user: _previous_account(collector, "x", str(user["username"]), X_POSTS_PER_ACCOUNT))
    posts = _interleave(groups + retained, min(15, max(1, int(collector.limit))), lambda post: post["id"])
    if not posts:
        if handled:
            return []
        raise ValueError("X accounts returned no usable public posts")
    replies = os.getenv("X_FETCH_REPLIES", "").strip().lower() == "true"
    eligible = sorted((p for p in posts if not p.get("stale") and p.get("commentCount") != 0),
                      key=lambda post: post.get("publishedAt") or "", reverse=True)
    selected = {post["id"] for post in eligible[:X_REPLY_THREADS]} if replies else set()

    def save(post):
        if post.get("stale"):
            return post
        if post["id"] in selected:
            collector.save_thread(post, lambda: _x_thread(post))
        else:
            notice = ("Reply snapshots are limited to three posts per refresh. Open this post on X to read and reply."
                      if replies else "X reply collection is disabled. Open this post on X to read and reply.")
            collector.save_thread(post, lambda: _thread(post, [], notice=notice))
        return post

    return collector.parallel(save, posts, lambda post: post)
