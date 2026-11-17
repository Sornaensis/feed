"""Correctness checks for parsing, comment identity and failure preservation."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
spec = importlib.util.spec_from_file_location("collect", Path(__file__).resolve().parents[1] / "scripts/collect.py")
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)


class FeedTests(unittest.TestCase):
    def test_rss_namespaces_do_not_confuse_comment_count_and_url(self):
        feed = b'''<rss xmlns:slash="http://purl.org/rss/1.0/modules/slash/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
        <title>A &amp; B</title><link>https://example.com/a?utm_source=rss&amp;id=4</link>
        <guid>stable</guid><slash:comments>12</slash:comments><comments>https://example.com/a#comments</comments>
        <pubDate>Mon, 16 Nov 2026 10:30:00 -0500</pubDate><description>Summary</description>
        <content:encoded><![CDATA[<p>Article body</p>]]></content:encoded></item></channel></rss>'''
        post = collect.parse_feed(feed, "ars")[0]
        self.assertEqual(post["title"], "A & B")
        self.assertEqual(post["url"], "https://example.com/a?id=4")
        self.assertEqual(post["discussionUrl"], "https://example.com/a#comments")
        self.assertEqual(post["commentCount"], 12)
        self.assertEqual(post["publishedAt"], "2026-11-16T15:30:00Z")
        self.assertEqual(post["bodyHtml"], "<p>Article body</p>")
        self.assertEqual(post["bodyKind"], "excerpt")
        self.assertEqual(post["commentsMode"], "external")

    def test_atom_skips_self_link_preserves_body_and_unknown_counts(self):
        feed = b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <id>urn:item:1</id><title type="html">A &amp;amp; B</title>
        <link rel="self" href="https://example.com/a.xml"/>
        <link rel="alternate" href="https://example.com/a"/>
        <author><name>Alice</name></author><published>2026-11-16T15:30:00+01:00</published>
        <summary>Summary</summary><content type="html">&lt;p&gt;Body&lt;/p&gt;</content>
        <category term="Security"/></entry></feed>'''
        post = collect.parse_feed(feed, "verge")[0]
        self.assertEqual(post["title"], "A & B")
        self.assertEqual(post["url"], "https://example.com/a")
        self.assertEqual(post["author"], "Alice")
        self.assertEqual(post["publishedAt"], "2026-11-16T14:30:00Z")
        self.assertEqual(post["bodyHtml"], "<p>Body</p>")
        self.assertIsNone(post["commentCount"])
        self.assertEqual(post["tags"], ["Security"])

    def test_rdf_bytes_honor_declared_encoding(self):
        feed = '''<?xml version="1.0" encoding="ISO-8859-1"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><item>
        <title>Café</title><link>https://example.com/cafe</link><dc:date>2026-11-16T15:30:00Z</dc:date><description>Text</description></item></rdf:RDF>'''.encode("latin-1")
        post = collect.parse_feed(feed, "slashdot")[0]
        self.assertEqual(post["title"], "Café")
        self.assertEqual(post["publishedAt"], "2026-11-16T15:30:00Z")

    def test_preview_sources_prefer_publisher_summaries_in_rss_and_atom(self):
        feeds = [
            ("propublica", b'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
            <title>Story</title><link>https://example.com/story</link>
            <description><![CDATA[<p>Publisher &amp; preview</p>]]></description>
            <content:encoded>Full article text</content:encoded></item></channel></rss>'''),
            ("register", b'''<feed xmlns="http://www.w3.org/2005/Atom"><entry>
            <title>Story</title><link href="https://example.com/story"/>
            <summary type="html">&lt;p&gt;Publisher &amp;amp; preview&lt;/p&gt;</summary>
            <content>Full article text</content></entry></feed>'''),
        ]
        for source_id, feed in feeds:
            with self.subTest(source=source_id):
                post = collect.parse_feed(feed, source_id)[0]
                self.assertEqual(post["bodyHtml"], "<p>Publisher &amp; preview</p>")
                self.assertEqual(post["excerpt"], "Publisher & preview")
                self.assertEqual(post["bodyKind"], "excerpt")
                self.assertEqual(post["commentsMode"], "external")

    def test_preview_content_fallback_is_bounded_and_cannot_render_feed_html(self):
        content = "<script>hidden code</script><p>Preview &amp; context " + "article text " * 200 + "</p>"
        feed = f'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
        <title>Story</title><link>https://example.com/story</link>
        <description>&lt;p&gt;&lt;/p&gt;</description>
        <content:encoded><![CDATA[{content}]]></content:encoded></item></channel></rss>'''.encode()
        post = collect.parse_feed(feed, "media404")[0]
        preview = collect.plain(post["bodyHtml"])
        self.assertTrue(preview.startswith("Preview & context"))
        self.assertTrue(preview.endswith("…"))
        self.assertLessEqual(len(preview), collect.PREVIEW_LIMIT + 1)
        self.assertNotIn("hidden code", preview)
        self.assertNotIn("<script", post["bodyHtml"])
        self.assertIn("&amp;", post["bodyHtml"])

    def test_missing_dates_and_counts_are_not_invented(self):
        post = collect.parse_feed(b'<rss><channel><item><title>Story</title><link>https://example.com/1</link></item></channel></rss>', "techcrunch")[0]
        self.assertIsNone(post["publishedAt"])
        self.assertIsNone(post["commentCount"])
        self.assertIsNone(collect.iso_date("invalid"))

    def test_kernel_releases_keep_distinct_guids_sharing_the_homepage(self):
        feed = b'''<rss><channel>
          <item><title>7.4-rc3: mainline</title><link>https://www.kernel.org/</link>
            <guid isPermaLink="false">kernel.org,mainline,7.4-rc3,2026-11-15</guid></item>
          <item><title>7.3.4: stable</title><link>https://www.kernel.org/</link>
            <guid isPermaLink="false">kernel.org,stable,7.3.4,2026-11-10</guid></item>
          <item><title>Repeated stable release</title><link>https://www.kernel.org/</link>
            <guid isPermaLink="false">kernel.org,stable,7.3.4,2026-11-10</guid></item>
        </channel></rss>'''
        posts = collect.parse_feed(feed, "kernel")
        self.assertEqual([post["title"] for post in posts], ["7.4-rc3: mainline", "7.3.4: stable"])
        self.assertEqual(len({post["id"] for post in posts}), 2)
        self.assertTrue(all(post["url"] == "https://www.kernel.org/" for post in posts))
        # Other publisher feeds still deduplicate article URLs as before.
        self.assertEqual(len(collect.parse_feed(feed, "phoronix")), 1)

    def test_new_specialist_sources_keep_summaries_and_bound_content_fallback(self):
        article = "<script>hidden</script><p>Public &amp; context " + "article text " * 200 + "</p>"
        feed = f'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
          <item><title>Summary available</title><link>https://example.com/summary</link>
            <description>Publisher preview</description><content:encoded><![CDATA[{article}]]></content:encoded></item>
          <item><title>No summary</title><link>https://example.com/content</link>
            <content:encoded><![CDATA[{article}]]></content:encoded></item>
        </channel></rss>'''.encode()
        for source_id in ["lwn", "quanta", "aftermath"]:
            with self.subTest(source=source_id):
                summary, fallback = collect.parse_feed(feed, source_id)
                self.assertEqual(summary["bodyHtml"], "<p>Publisher preview</p>")
                preview = collect.plain(fallback["bodyHtml"])
                self.assertLessEqual(len(preview), collect.PREVIEW_LIMIT)
                self.assertTrue(preview.endswith("…"))
                self.assertNotIn("hidden", preview)
                self.assertNotIn("<script", fallback["bodyHtml"])
                self.assertEqual(fallback["bodyKind"], "excerpt")
                self.assertEqual(fallback["commentsMode"], "external")

    def test_invalid_links_cannot_become_clickable_posts(self):
        with self.assertRaises(ValueError):
            collect.parse_feed(b'<rss><item><title>Bad link</title><link>javascript:alert(1)</link></item></rss>', "ars")
        self.assertEqual(collect.safe_url("data:text/html,bad"), "")
        self.assertEqual(collect.safe_url("https://name:secret@example.com/"), "")


class CommentTests(unittest.TestCase):
    def test_hn_keeps_deleted_parents_and_exact_reply_target(self):
        nodes, truncated = collect.hn_comments([
            {"id": 11, "author": None, "text": "removed", "children": [
                {"id": 12, "author": "alice", "text": "<p>Reply</p>", "created_at_i": 1, "children": []}]}], "10")
        self.assertFalse(truncated)
        self.assertTrue(nodes[0]["deleted"])
        self.assertEqual(nodes[0]["bodyHtml"], "<p>[deleted comment]</p>")
        child = nodes[0]["children"][0]
        self.assertEqual(child["parentId"], "11")
        self.assertEqual(child["url"], "https://news.ycombinator.com/item?id=12")
        self.assertEqual(child["replyUrl"], "https://news.ycombinator.com/reply?id=12&goto=item%3Fid%3D10")
        self.assertEqual(collect.tree_count(nodes), 2)

    def test_dev_comment_identity_and_nested_parent(self):
        nodes, truncated = collect.dev_comments([{
            "id_code": "a1", "user": {"username": "alice"}, "body_html": "A", "children": [
                {"id_code": "b2", "user": {"username": "bob"}, "body_html": "B", "children": []}]}])
        child = nodes[0]["children"][0]
        self.assertFalse(truncated)
        self.assertEqual(child["parentId"], "a1")
        self.assertEqual(child["url"], "https://dev.to/bob/comment/b2")
        self.assertEqual(child["replyUrl"], child["url"])

    def test_lobsters_wires_out_of_order_deleted_parent_and_canonical_url(self):
        nodes, truncated = collect.lobsters_comments([
            {"short_id": "b", "parent_comment": "a", "comment": "Reply", "commenting_user": "bob", "url": "https://lobste.rs/s/story/title#c_b"},
            {"short_id": "a", "parent_comment": None, "comment": "private", "is_deleted": True, "commenting_user": "alice"},
        ])
        self.assertFalse(truncated)
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]["id"], "a")
        self.assertNotIn("private", nodes[0]["bodyHtml"])
        self.assertEqual(nodes[0]["children"][0]["replyUrl"], "https://lobste.rs/s/story/title#c_b")

    def test_lobsters_bad_cycles_cannot_create_cyclic_json(self):
        nodes, truncated = collect.lobsters_comments([
            {"short_id": "a", "parent_comment": "b"},
            {"short_id": "b", "parent_comment": "a"},
        ])
        self.assertTrue(truncated)
        self.assertEqual(collect.tree_count(nodes), 2)
        json.dumps(nodes)

    def test_comment_limit_reports_truncation(self):
        with patch.object(collect, "MAX_COMMENTS", 1):
            nodes, truncated = collect.hn_comments([
                {"id": 2, "author": "a", "children": []},
                {"id": 3, "author": "b", "children": []}], "1")
        self.assertTrue(truncated)
        self.assertEqual(len(nodes), 1)


class FailureTests(unittest.TestCase):
    def test_targeted_refresh_preserves_unselected_posts_threads_and_freshness(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            untouched = collect.base_post("hn", "42", "Retained post", "", "https://news.ycombinator.com/item?id=42",
                                          bodyHtml="<p>Original body</p>", threadPath="data/threads/hn-42.json")
            source = dict(collect.SOURCES[0], status="partial", lastSuccess="2026-01-01T00:00:00Z", error="Previous partial refresh.", postCount=1)
            collect.atomic_json(output / "data/feed.json", dict(version=1, sources=[source], posts=[untouched]))
            thread = dict(postId="hn:42", fetchedAt="2026-01-01T00:00:00Z", comments=[])
            collect.atomic_json(output / untouched["threadPath"], thread)
            called = []

            def rss(url):
                called.append(url)
                return b'<rss><channel><item><title>Fresh news</title><link>https://www.bbc.com/news/123</link><pubDate>Mon, 16 Nov 2026 14:00:00 GMT</pubDate><description>Summary</description></item></channel></rss>'

            result = collect.Collector(output, sources=["bbc"], get_bytes=rss).collect()
            self.assertEqual(called, [collect.FEEDS["bbc"]])
            self.assertEqual(next(p for p in result["posts"] if p["sourceId"] == "hn"), untouched)
            self.assertEqual(next(s for s in result["sources"] if s["id"] == "hn"), source)
            self.assertEqual(collect.read_json(output / untouched["threadPath"]), thread)
            fresh = next(p for p in result["posts"] if p["sourceId"] == "bbc")
            self.assertEqual(fresh["bodyKind"], "excerpt")
            self.assertEqual(fresh["commentsMode"], "external")
            self.assertEqual(fresh["publishedAt"], "2026-11-16T14:00:00Z")

    def test_unknown_target_source_is_rejected_without_changing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = dict(version=1, sources=[], posts=[])
            collect.atomic_json(output / "data/feed.json", old)
            worker = collect.Collector(output, sources=["unknown"])
            with self.assertRaises(ValueError):
                worker.collect()
            self.assertEqual(collect.read_json(output / "data/feed.json"), old)

    def test_dev_detail_failure_preserves_full_body_in_feed_and_thread(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = collect.base_post("dev", "1", "Old title", "https://dev.to/alice/story", "https://dev.to/alice/story",
                                    bodyHtml="<p>The complete previously fetched article.</p>", bodyKind="article")
            collect.atomic_json(output / "data/feed.json", dict(sources=[], posts=[old]))
            collect.atomic_json(output / "data/threads/dev-1.json", collect.base_thread(old, []))

            def upstream(url):
                if "/articles?" in url:
                    return [dict(id=1, title="Updated title", url=old["url"], description="Short excerpt", comments_count=0)]
                if "/articles/" in url:
                    raise OSError("temporary detail failure")
                return []

            worker = collect.Collector(output, get_json=upstream)
            with patch.object(collect, "SOURCES", [collect.SOURCES[2]]):
                result = worker.collect()
            post = result["posts"][0]
            self.assertEqual(post["title"], "Updated title")
            self.assertEqual(post["bodyHtml"], old["bodyHtml"])
            self.assertEqual(post["bodyKind"], "article")
            self.assertEqual(result["sources"][0]["status"], "partial")
            self.assertEqual(collect.read_json(output / post["threadPath"])["bodyHtml"], old["bodyHtml"])

    def test_success_prunes_only_old_unreferenced_threads(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old_time = (collect.datetime.now(collect.timezone.utc) - collect.timedelta(days=31)).isoformat()
            recent_time = (collect.datetime.now(collect.timezone.utc) - collect.timedelta(days=29)).isoformat()
            thread_dir = output / "data/threads"
            for filename, fetched_at in [("dev-keep.json", old_time), ("dev-expired.json", old_time), ("dev-recent.json", recent_time)]:
                collect.atomic_json(thread_dir / filename, dict(fetchedAt=fetched_at, comments=[]))
            fallback = collect.base_post("dev", "keep", "Retained story", "https://dev.to/alice/story", "https://dev.to/alice/story", threadPath="data/threads/dev-keep.json")
            collect.atomic_json(output / "data/feed.json", dict(sources=[], posts=[fallback]))
            worker = collect.Collector(output, get_json=lambda _: (_ for _ in ()).throw(OSError("offline")))
            with patch.object(collect, "SOURCES", [collect.SOURCES[2]]):
                worker.collect()
            self.assertTrue((thread_dir / "dev-keep.json").is_file())
            self.assertTrue((thread_dir / "dev-recent.json").is_file())
            self.assertFalse((thread_dir / "dev-expired.json").exists())

    def test_partial_item_failure_retains_old_post_but_not_deleted_items(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old_posts = [collect.base_post("hn", n, f"Old {n}", "", f"https://news.ycombinator.com/item?id={n}") for n in (1, 2)]
            collect.atomic_json(output / "data/feed.json", dict(sources=[], posts=old_posts))

            def upstream(url):
                if "topstories" in url:
                    return [1, 2, 3]
                if "/item/1.json" in url:
                    raise OSError("temporary failure")
                if "/item/2.json" in url:
                    return dict(id=2, deleted=True)
                if "/item/3.json" in url:
                    return dict(id=3, title="New 3", by="alice", descendants=0)
                return dict(id=3, children=[])

            worker = collect.Collector(output, get_json=upstream)
            with patch.object(collect, "SOURCES", [collect.SOURCES[0]]):
                result = worker.collect()
            self.assertEqual([p["id"] for p in result["posts"]], ["hn:1", "hn:3"])
            self.assertTrue(result["posts"][0]["stale"])
            self.assertEqual(result["sources"][0]["status"], "partial")

    def test_failed_source_preserves_previous_posts_and_success_time(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = dict(version=1, sources=[dict(id="ars", lastSuccess="2026-11-15T00:00:00Z")], posts=[dict(id="ars:old", sourceId="ars", title="Old story")])
            collect.atomic_json(output / "data/feed.json", old)
            worker = collect.Collector(output, get_bytes=lambda _: (_ for _ in ()).throw(OSError("offline")))
            with patch.object(collect, "SOURCES", [collect.SOURCES[3]]):
                result = worker.collect()
            self.assertEqual(result["posts"], old["posts"])
            self.assertEqual(result["sources"][0]["status"], "stale")
            self.assertEqual(result["sources"][0]["lastSuccess"], "2026-11-15T00:00:00Z")

    def test_failed_discussion_uses_old_snapshot_without_fresh_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            post = collect.base_post("hn", "1", "Story", "", "https://news.ycombinator.com/item?id=1")
            old = collect.base_thread(post, [])
            old["fetchedAt"] = "2026-11-15T00:00:00Z"
            path = output / "data/threads/hn-1.json"
            collect.atomic_json(path, old)
            worker = collect.Collector(output)
            worker.save_thread(post, lambda: (_ for _ in ()).throw(OSError("offline")))
            result = collect.read_json(path)
            self.assertEqual(post["threadPath"], "data/threads/hn-1.json")
            self.assertTrue(result["stale"])
            self.assertEqual(result["fetchedAt"], old["fetchedAt"])

    def test_total_failure_leaves_old_output_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = dict(version=1, sources=[], posts=[])
            collect.atomic_json(output / "data/feed.json", old)
            archive = dict(version=1, generatedAt="2026-11-15T00:00:00Z", retentionDays=30, days=[])
            collect.atomic_json(output / "data/archive/index.json", archive)
            worker = collect.Collector(output, get_bytes=lambda _: (_ for _ in ()).throw(OSError("offline")))
            with patch.object(collect, "SOURCES", [collect.SOURCES[3]]):
                with self.assertRaises(RuntimeError):
                    worker.collect()
            self.assertEqual(collect.read_json(output / "data/feed.json"), old)
            self.assertEqual(collect.read_json(output / "data/archive/index.json"), archive)


class ArchiveTests(unittest.TestCase):
    def post(self, source, identity, published, **values):
        return collect.base_post(source, identity, f"Story {identity}", "https://example.com/" + identity,
                                 "https://example.com/" + identity, publishedAt=published, **values)

    def test_archive_upserts_by_identity_and_expires_publication_days(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = self.post("hn", "1", "2026-11-15T10:00:00Z", bodyHtml="Old body")
            oldest_kept = self.post("ars", "2", "2026-10-18T00:00:00Z")
            expired = self.post("ars", "3", "2026-10-17T23:59:59Z")
            collect.atomic_json(output / "data/archive/2026-11-15.json", dict(version=1, date="2026-11-15", posts=[old]))
            collect.atomic_json(output / "data/archive/2026-10-17.json", dict(version=1, date="2026-10-17", posts=[expired]))
            collect.atomic_json(output / "data/feed.json", dict(posts=[old, oldest_kept, expired]))
            updated = dict(old, title="Updated title", bodyHtml="Latest body")
            worker = collect.Collector(output)
            archived = worker.write_archive([updated], [], "2026-11-16T12:00:00Z")
            self.assertEqual({p["id"] for p in archived}, {"hn:1", "ars:2"})
            self.assertEqual(next(p for p in archived if p["id"] == "hn:1")["bodyHtml"], "Latest body")
            manifest = collect.read_json(output / "data/archive/index.json")
            self.assertEqual(manifest["retentionDays"], 30)
            self.assertEqual(manifest["days"], [
                dict(date="2026-11-15", count=1, path="data/archive/2026-11-15.json"),
                dict(date="2026-10-18", count=1, path="data/archive/2026-10-18.json"),
            ])
            self.assertFalse((output / "data/archive/2026-10-17.json").exists())

    def test_archive_dates_use_utc_and_reject_unknown_or_future_publication_times(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            posts = [
                self.post("ars", "offset", "2026-11-16T00:30:00+02:00"),
                self.post("ars", "tomorrow", "2026-11-17T00:00:00Z"),
                self.post("ars", "later", "2026-11-16T13:00:00Z"),
                self.post("ars", "unknown", None),
                self.post("ars", "invalid", "not a date"),
            ]
            archived = collect.Collector(output).write_archive(posts, [], "2026-11-16T12:00:00Z")
            self.assertEqual([p["id"] for p in archived], ["ars:offset"])
            day = collect.read_json(output / "data/archive/2026-11-15.json")
            self.assertEqual(day["date"], "2026-11-15")
            self.assertEqual(day["posts"][0]["publishedAt"], "2026-11-15T22:30:00Z")

    def test_targeted_refresh_archives_displaced_posts_and_keeps_archive_threads(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            current = collect.datetime.now(collect.timezone.utc)
            stamp = lambda days: (current - collect.timedelta(days=days, hours=1)).isoformat()
            previous_news = self.post("bbc", "previous", stamp(1))
            untouched = self.post("hn", "untouched", stamp(2))
            historical = self.post("lobsters", "historical", stamp(3), threadPath="data/threads/lobsters-historical.json")
            day = collect.iso_date(historical["publishedAt"])[:10]
            collect.atomic_json(output / f"data/archive/{day}.json", dict(version=1, date=day, posts=[historical]))
            collect.atomic_json(output / "data/feed.json", dict(sources=[], posts=[previous_news, untouched]))
            thread = dict(fetchedAt=stamp(31), comments=[])
            collect.atomic_json(output / historical["threadPath"], thread)
            collect.atomic_json(output / "data/threads/unreferenced.json", thread)
            fresh = (f'<rss><channel><item><title>Fresh news</title><link>https://example.com/fresh</link>'
                     f'<pubDate>{stamp(0)}</pubDate></item></channel></rss>').encode()
            called = []
            def upstream(url):
                called.append(url)
                return fresh
            result = collect.Collector(output, sources=["bbc"], get_bytes=upstream).collect()
            self.assertEqual(called, [collect.FEEDS["bbc"]])
            self.assertNotIn(previous_news["id"], {p["id"] for p in result["posts"]})
            manifest = collect.read_json(output / "data/archive/index.json")
            archived = [p for entry in manifest["days"]
                        for p in collect.read_json(output / entry["path"])["posts"]]
            self.assertEqual(len(archived), 4)
            self.assertTrue({previous_news["id"], untouched["id"], historical["id"]} <= {p["id"] for p in archived})
            self.assertTrue((output / historical["threadPath"]).exists())
            self.assertFalse((output / "data/threads/unreferenced.json").exists())

    def test_known_removals_and_disabled_sources_do_not_return_through_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = [self.post(source, identity, "2026-11-15T10:00:00Z")
                   for source, identity in [("hn", "1"), ("bluesky", "2"), ("x", "3"), ("dev", "4"), ("dev", "5")]]
            collect.atomic_json(output / "data/feed.json", dict(posts=old))
            worker = collect.Collector(output)
            worker.removed_ids.add("hn:1")
            sources = [dict(id="x", status="disabled", postCount=0), dict(id="bluesky", status="ok", postCount=0)]
            archived = worker.write_archive([dict(old[3], unavailable=True), old[4]], sources, "2026-11-16T12:00:00Z")
            self.assertEqual([p["id"] for p in archived], ["dev:5"])


if __name__ == "__main__":
    unittest.main()
