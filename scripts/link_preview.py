"""Small, optional link cards collected alongside the static feed.

Only public HTTP(S) pages are requested. Connections are pinned to a validated
address, including after redirects, so an arbitrary submitted URL cannot turn
the collector into a request to a local or private service. No cookies, proxy
credentials, article bodies, or publisher scripts are retained.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from http.client import HTTPConnection, HTTPSConnection
import ipaddress
import re
import socket
import time
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

MAX_HTML_BYTES = 256 * 1024
MAX_REDIRECTS = 3
FETCH_SECONDS = 8
CACHE_SECONDS = 24 * 60 * 60
USER_AGENT = "TheFeed/1.0 (public link preview; Open Graph metadata only)"


def _text(value, limit):
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    return value if len(value) <= limit else value[:limit - 1].rstrip() + "…"


def _public_ip(value):
    try:
        address = ipaddress.ip_address(value)
        if address.version == 6 and address.ipv4_mapped:
            return _public_ip(address.ipv4_mapped)
        return (address.is_global and not address.is_multicast and not address.is_reserved
                and not address.is_unspecified and not address.is_loopback)
    except ValueError:
        return False


def public_url(value, base=""):
    """Check URL syntax without making a network request (also used by parsing)."""
    value = str(value or "").strip()
    if not value or len(value) > 8192 or re.search(r"[\x00-\x20\x7f\\]", value):
        return ""
    try:
        value = urljoin(base, value) if base else value
        parts = urlsplit(value)
        host = parts.hostname
        if (parts.scheme not in {"http", "https"} or not host
                or parts.username is not None or parts.password is not None
                or parts.port not in {None, 80, 443} or "%" in host):
            return ""
        host = host.rstrip(".").lower()
        if not host or host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
            return ""
        try:
            ipaddress.ip_address(host)
        except ValueError:
            host.encode("idna")
            if "." not in host or not re.fullmatch(r"[A-Za-z0-9._\-\u0080-\uffff]+", host):
                return ""
        else:
            if not _public_ip(host):
                return ""
        return value
    except (ValueError, UnicodeError):
        return ""


def _resolve(url):
    """Reject mixed public/private results before selecting the pinned address."""
    if not public_url(url):
        raise ValueError("link preview URL is not a public HTTP(S) URL")
    parts = urlsplit(url)
    host = parts.hostname.encode("idna").decode("ascii")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses or any(not _public_ip(address) for address in addresses):
        raise ValueError("link preview host does not resolve exclusively to public addresses")
    # IPv4 first avoids a long failed IPv6 connect on runners without IPv6.
    addresses.sort(key=lambda address: ipaddress.ip_address(address).version)
    return parts, host, port, addresses


class _PinnedHTTP(HTTPConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout)
        self.address = address

    def connect(self):
        self.sock = socket.create_connection((self.address, self.port), self.timeout)


class _PinnedHTTPS(HTTPSConnection):
    def __init__(self, host, port, address, timeout):
        super().__init__(host, port, timeout=timeout)
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, self.port), self.timeout)
        try:
            # Keep certificate verification and SNI tied to the hostname even
            # though the TCP connection uses a validated IP address.
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("link preview time budget exceeded")
    return remaining


def _response(url, deadline):
    parts, host, port, addresses = _resolve(url)
    path = urlunsplit(("", "", quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~"), parts.query, ""))
    cls = _PinnedHTTPS if parts.scheme == "https" else _PinnedHTTP
    connection = cls(host, port, addresses[0], _remaining(deadline))
    try:
        connection.request("GET", path, headers={"User-Agent": USER_AGENT,
                           "Accept": "text/html, application/xhtml+xml;q=0.9",
                           "Accept-Encoding": "identity", "Connection": "close"})
        if connection.sock:
            connection.sock.settimeout(_remaining(deadline))
        response = connection.getresponse()
        return connection, response
    except BaseException:
        connection.close()
        raise


class _Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.values, self.title = {}, []
        self.in_title, self.finished, self.hidden = False, False, 0

    def handle_starttag(self, tag, attrs):
        if self.finished:
            return
        if tag in {"script", "style", "template", "noscript"}:
            self.hidden += 1
            return
        if self.hidden:
            return
        if tag == "body":
            self.finished = True
        elif tag == "title":
            self.in_title = True
        elif tag == "meta":
            values = dict(attrs)
            name = str(values.get("property") or values.get("name") or "").lower()
            content = values.get("content")
            if name in {"og:title", "og:description", "og:image", "og:image:url", "og:image:secure_url",
                        "og:site_name", "twitter:title", "twitter:description", "twitter:image",
                        "twitter:image:src", "description"} and content:
                self.values.setdefault(name, str(content)[:8192])

    def handle_endtag(self, tag):
        if tag in {"script", "style", "template", "noscript"} and self.hidden:
            self.hidden -= 1
        elif tag == "title":
            self.in_title = False
        elif tag == "head":
            self.finished = True

    def handle_data(self, data):
        if self.in_title and not self.hidden and not self.finished:
            if sum(map(len, self.title)) < 2048:
                self.title.append(data[:2048])


def parse_preview(data, final_url, original_url=None, charset="utf-8"):
    """Extract only publisher metadata; use the submitted URL as card identity."""
    if not public_url(final_url) or not public_url(original_url or final_url):
        return None
    if isinstance(data, bytes):
        try:
            document = data[:MAX_HTML_BYTES].decode(charset, errors="replace")
        except (LookupError, TypeError):
            document = data[:MAX_HTML_BYTES].decode("utf-8", errors="replace")
    else:
        document = str(data)[:MAX_HTML_BYTES]
    parser = _Metadata()
    parser.feed(document)
    values = parser.values
    title = _text(values.get("og:title") or values.get("twitter:title") or "".join(parser.title), 240)
    description = _text(values.get("og:description") or values.get("twitter:description") or values.get("description"), 400)
    image = ""
    for name in ("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"):
        image = public_url(values.get(name), final_url)
        if image:
            break
    if not any((title, description, image)):
        return None
    return dict(url=original_url or final_url, title=title, description=description,
                imageUrl=image, siteName=_text(values.get("og:site_name") or urlsplit(final_url).hostname, 100))


def fetch_link_preview(url):
    """Fetch at most 256 KiB and three redirects within an eight-second budget."""
    original = public_url(url)
    if not original:
        return None
    current, seen = original, set()
    deadline = time.monotonic() + FETCH_SECONDS
    for redirect in range(MAX_REDIRECTS + 1):
        if current in seen:
            raise ValueError("link preview redirect loop")
        seen.add(current)
        connection, response = _response(current, deadline)
        try:
            if response.status in {301, 302, 303, 307, 308}:
                destination = public_url(response.getheader("Location"), current)
                if not destination or redirect == MAX_REDIRECTS:
                    raise ValueError("invalid or excessive link preview redirect")
                current = destination
                continue
            if response.status != 200:
                return None
            if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
                return None
            if response.getheader("Content-Encoding", "identity").lower() not in {"", "identity"}:
                return None
            data = bytearray()
            while len(data) < MAX_HTML_BYTES:
                if connection.sock:
                    connection.sock.settimeout(_remaining(deadline))
                else:
                    _remaining(deadline)
                chunk = response.read1(min(8192, MAX_HTML_BYTES - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                if b"</head" in data.lower():
                    break
            return parse_preview(bytes(data), current, original, response.headers.get_content_charset() or "utf-8")
        finally:
            response.close()
            connection.close()
    return None


def normalize_preview(preview, url):
    """Validate cached/injected metadata before it enters the public snapshot."""
    if not isinstance(preview, dict) or preview.get("url") != url or not public_url(url):
        return None
    result = dict(url=url, title=_text(preview.get("title"), 240),
                  description=_text(preview.get("description"), 400),
                  imageUrl=public_url(preview.get("imageUrl"), url),
                  siteName=_text(preview.get("siteName") or urlsplit(url).hostname, 100))
    if not any((result["title"], result["description"], result["imageUrl"])):
        return None
    fetched = preview.get("fetchedAt")
    if isinstance(fetched, str):
        result["fetchedAt"] = fetched
    return result


def preview_is_fresh(preview, now=None):
    try:
        fetched = datetime.fromisoformat(preview.get("fetchedAt", "").replace("Z", "+00:00"))
        if fetched.tzinfo is None:
            return False
        age = ((now or datetime.now(timezone.utc)) - fetched).total_seconds()
        return 0 <= age < CACHE_SECONDS
    except (AttributeError, TypeError, ValueError, OverflowError):
        return False
