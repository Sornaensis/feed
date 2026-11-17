"""Metadata cards stay optional, bounded, and tied to the original link."""
import importlib.util
from datetime import datetime, timedelta, timezone
from email.message import Message
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import link_preview as preview

spec = importlib.util.spec_from_file_location("collect_preview_tests", Path(__file__).resolve().parents[1] / "scripts/collect.py")
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)


class MetadataTests(unittest.TestCase):
    def test_open_graph_precedence_and_relative_images_survive_redirects(self):
        data = b'''<html><head><title>Fallback</title>
          <meta name="twitter:title" content="Tweet title">
          <meta property="og:title" content="A &amp; B">
          <meta name="description" content="Fallback description">
          <meta property="og:description" content="A short publisher preview.">
          <meta property="og:image" content="../images/cover.jpg">
          <meta property="og:site_name" content="Example News">
          </head><body>Full copyrighted article must not enter the result.</body></html>'''
        result = preview.parse_preview(data, "https://example.com/articles/story", "https://example.org/short")
        self.assertEqual(result, dict(url="https://example.org/short", title="A & B",
                         description="A short publisher preview.", imageUrl="https://example.com/images/cover.jpg",
                         siteName="Example News"))

    def test_twitter_and_html_title_fallbacks_and_encoding(self):
        html = '<head><title>Café story</title><meta name="twitter:description" content="Context"><meta name="twitter:image" content="//cdn.example.com/cover.png"></head>'
        result = preview.parse_preview(html.encode("latin1"), "https://example.com/news", charset="iso-8859-1")
        self.assertEqual(result["title"], "Café story")
        self.assertEqual(result["description"], "Context")
        self.assertEqual(result["imageUrl"], "https://cdn.example.com/cover.png")

    def test_unsafe_image_and_body_metadata_are_ignored(self):
        result = preview.parse_preview('''<head><title>Public title</title>
            <meta property="og:image" content="http://169.254.169.254/secrets">
            <script><meta property="og:description" content="Script text"></script>
            </head><body><meta property="og:description" content="Body text"></body>''', "https://example.com/")
        self.assertEqual(result["imageUrl"], "")
        self.assertEqual(result["description"], "")
        self.assertNotIn("Body text", json.dumps(result))

    def test_metadata_and_input_size_are_bounded(self):
        result = preview.parse_preview('<title>' + 'T' * 5000 + '</title><meta name="description" content="' + 'D' * 5000 + '">', "https://example.com/")
        self.assertEqual(len(result["title"]), 240)
        self.assertEqual(len(result["description"]), 400)
        self.assertIsNone(preview.parse_preview(b" " * preview.MAX_HTML_BYTES + b"<title>Too late</title>", "https://example.com/"))

    def test_submitted_url_is_not_html_unescaped(self):
        url = "https://example.com/?a=one&copy=two"
        result = preview.parse_preview("<title>Title</title>", url)
        self.assertEqual(result["url"], url)

    def test_cached_metadata_requires_exact_link_identity_and_public_urls(self):
        card = dict(url="https://example.com/a", title="Title", imageUrl="javascript:alert(1)")
        self.assertIsNone(preview.normalize_preview(card, "https://example.com/b"))
        self.assertEqual(preview.normalize_preview(card, card["url"])["imageUrl"], "")
        self.assertIsNone(preview.normalize_preview(dict(url="http://localhost/", title="Private"), "http://localhost/"))


class NetworkTests(unittest.TestCase):
    def test_rejects_non_public_and_credential_urls_without_connecting(self):
        for url in ("javascript:alert(1)", "file:///etc/passwd", "http://localhost/", "http://test.local/",
                    "http://127.0.0.1/", "http://10.1.2.3/", "http://169.254.169.254/", "http://100.64.0.1/",
                    "http://224.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/",
                    "https://user:password@example.com/", "https://@example.com/", "https://example.com:22/",
                    "https://example.com\\@127.0.0.1/", "https://example.com/\r\nX-Secret: yes"):
            with self.subTest(url=url), patch.object(preview.socket, "getaddrinfo") as resolve:
                self.assertIsNone(preview.fetch_link_preview(url))
                resolve.assert_not_called()

    def test_resolution_rejects_private_and_mixed_answers(self):
        private = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))
        public = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
        for addresses in ([], [private], [public, private]):
            with self.subTest(addresses=addresses), patch.object(preview.socket, "getaddrinfo", return_value=addresses):
                with self.assertRaises(ValueError):
                    preview._resolve("https://example.com/")

    def test_https_connect_is_pinned_but_tls_verifies_hostname(self):
        raw, tls = Mock(), Mock()
        connection = preview._PinnedHTTPS("example.com", 443, "8.8.8.8", 4)
        connection._context = Mock()
        connection._context.wrap_socket.return_value = tls
        with patch.object(preview.socket, "create_connection", return_value=raw) as connect:
            connection.connect()
        connect.assert_called_once_with(("8.8.8.8", 443), 4)
        connection._context.wrap_socket.assert_called_once_with(raw, server_hostname="example.com")

    @staticmethod
    def response(body=b"<title>Story</title>", status=200, content_type="text/html", **headers):
        response = Mock(status=status)
        response.headers = Message()
        response.headers["Content-Type"] = content_type
        for key, value in headers.items():
            response.headers[key] = value
        response.getheader.side_effect = lambda name, default=None: response.headers.get(name, default)
        cursor = [0]
        def read(size):
            part = body[cursor[0]:cursor[0] + size]
            cursor[0] += len(part)
            return part
        response.read1.side_effect = read
        return response

    def test_redirect_to_private_url_is_rejected_and_response_closed(self):
        response = self.response(status=302, Location="http://127.0.0.1/private")
        connection = Mock(sock=None)
        with patch.object(preview, "_response", return_value=(connection, response)) as request:
            with self.assertRaises(ValueError):
                preview.fetch_link_preview("https://example.com/a")
        request.assert_called_once()
        response.close.assert_called_once()
        connection.close.assert_called_once()

    def test_each_redirect_resolves_and_pins_the_new_host(self):
        connection1, connection2 = Mock(sock=None), Mock(sock=None)
        redirect = self.response(status=302, Location="https://other.example.com/news/a")
        final = self.response(b'<title>Redirected</title><meta property="og:image" content="cover.jpg">')
        with patch.object(preview, "_response", side_effect=[(connection1, redirect), (connection2, final)]) as request:
            result = preview.fetch_link_preview("https://example.com/a")
        self.assertEqual([call.args[0] for call in request.call_args_list], ["https://example.com/a", "https://other.example.com/news/a"])
        self.assertEqual(result["url"], "https://example.com/a")
        self.assertEqual(result["imageUrl"], "https://other.example.com/news/cover.jpg")

    def test_non_html_content_does_not_download_a_body(self):
        response = self.response(content_type="application/pdf")
        with patch.object(preview, "_response", return_value=(Mock(sock=None), response)):
            self.assertIsNone(preview.fetch_link_preview("https://example.com/a.pdf"))
        response.read1.assert_not_called()

    def test_download_stops_at_head_or_byte_limit(self):
        for body, expected_max in [(b"<title>Title</title></head>" + b"a" * preview.MAX_HTML_BYTES, 8192),
                                   (b"<title>Title</title>" + b"a" * (preview.MAX_HTML_BYTES * 2), preview.MAX_HTML_BYTES)]:
            response = self.response(body)
            with patch.object(preview, "_response", return_value=(Mock(sock=None), response)):
                result = preview.fetch_link_preview("https://example.com/")
            self.assertEqual(result["title"], "Title")
            self.assertLessEqual(sum(call.args[0] for call in response.read1.call_args_list), expected_max)

    def test_redirect_count_and_total_deadline_are_bounded(self):
        responses = [(Mock(sock=None), self.response(status=302, Location=f"/hop/{i}")) for i in range(10)]
        with patch.object(preview, "_response", side_effect=responses) as request:
            with self.assertRaises(ValueError):
                preview.fetch_link_preview("https://example.com/")
        self.assertEqual(request.call_count, preview.MAX_REDIRECTS + 1)
        with patch.object(preview.time, "monotonic", return_value=100):
            with self.assertRaises(TimeoutError):
                preview._remaining(99)


class CollectorPreviewTests(unittest.TestCase):
    @staticmethod
    def post(url="https://example.com/story"):
        return collect.base_post("hn", "1", "Story", url, "https://news.ycombinator.com/item?id=1")

    def test_fresh_preview_is_reused_and_failure_preserves_stale_preview(self):
        for age, expected_calls in [(timedelta(hours=1), 0), (timedelta(days=2), 1)]:
            with self.subTest(age=age), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                post = self.post()
                card = dict(url=post["url"], title="Publisher title", description="Preview", imageUrl="", siteName="Publisher",
                            fetchedAt=(datetime.now(timezone.utc) - age).isoformat())
                collect.atomic_json(output / "data/feed.json", dict(posts=[dict(post, linkPreview=card)]))
                fetch = Mock(side_effect=TimeoutError("offline"))
                worker = collect.Collector(output, get_preview=fetch)
                worker.enrich_link_preview(post)
                self.assertEqual(post["linkPreview"], card)
                self.assertEqual(fetch.call_count, expected_calls)
                self.assertEqual(worker.errors, [])

    def test_changed_url_never_inherits_old_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = self.post("https://example.com/old")
            old["linkPreview"] = dict(url=old["url"], title="Old page")
            collect.atomic_json(output / "data/feed.json", dict(posts=[old]))
            current = self.post("https://example.com/new")
            worker = collect.Collector(output, get_preview=Mock(return_value=None))
            worker.enrich_link_preview(current)
            self.assertNotIn("linkPreview", current)

    def test_text_posts_and_custom_fixture_transports_do_not_fetch_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            fetch = Mock()
            worker = collect.Collector(Path(directory), get_preview=fetch)
            worker.enrich_link_preview(self.post("https://news.ycombinator.com/item?id=1"))
            fetch.assert_not_called()
            fixture = collect.Collector(Path(directory), get_json=Mock())
            self.assertIsNone(fixture.get_preview)

    def test_hn_enrichment_is_saved_without_turning_preview_errors_into_source_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            def upstream(url):
                if url.endswith("topstories.json"):
                    return [1]
                if "firebaseio" in url:
                    return dict(id=1, title="Story", url="https://example.com/story", descendants=0)
                return dict(id=1, children=[])
            card = dict(url="https://example.com/story", title="Publisher title", description="Preview", imageUrl="https://example.com/cover.jpg")
            worker = collect.Collector(Path(directory), sources=["hn"], get_json=upstream, get_preview=Mock(return_value=card))
            result = worker.collect()
            self.assertEqual(result["posts"][0]["linkPreview"]["title"], "Publisher title")
            self.assertIn("fetchedAt", result["posts"][0]["linkPreview"])
            self.assertEqual(result["sources"][0]["status"], "ok")
            worker.previous = {}
            worker.get_preview = Mock(side_effect=OSError("blocked publisher"))
            result = worker.collect()
            self.assertEqual(result["sources"][0]["status"], "ok")
            self.assertNotIn("linkPreview", result["posts"][0])


if __name__ == "__main__":
    unittest.main()
