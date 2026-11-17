"""Shared source fixtures cover both snapshot and in-browser media adapters."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("social_embeds_snapshot", ROOT / "scripts/social.py")
social = importlib.util.module_from_spec(spec)
spec.loader.exec_module(social)
FIXTURE = json.loads((ROOT / "tests/fixtures/social-embeds.json").read_text())


def view(key, embed=None, text=""):
    return dict(uri=f"at://did:plc:alice/app.bsky.feed.post/{key}", author=dict(did="did:plc:alice", handle="alice.example"),
                record=dict(text=text, createdAt="2026-11-16T12:00:00Z"), embed=embed, replyCount=0)


def post(value):
    return social._bsky_post(value, "alice.example")


def status(item_id, **values):
    return dict(id=str(item_id), account=dict(acct="alice@example.social"), url=f"https://example.social/@alice/{item_id}",
                content="<p>Post body</p>", visibility="public", created_at="2026-11-16T12:00:00Z", replies_count=0, **values)


class SocialEmbedTests(unittest.TestCase):
    def test_image_gallery_and_video_keep_resolved_urls_and_accessibility(self):
        image = post(view("image", FIXTURE["image"]))
        self.assertEqual(image["bodyHtml"], "")
        self.assertEqual(image["embeds"][0], dict(type="image", url="https://cdn.example/full.jpg", thumbnailUrl="https://cdn.example/thumb.jpg",
                                                alt="A & <scene>", width=1920, height=1080))
        gallery = post(view("gallery", FIXTURE["gallery"]))
        self.assertEqual(gallery["embeds"][0]["thumbnailUrl"], "https://cdn.example/gallery-small.jpg")
        video = post(view("video", FIXTURE["video"]))
        self.assertEqual(video["embeds"][0]["mimeType"], "application/vnd.apple.mpegurl")
        self.assertEqual(video["embeds"][0]["posterUrl"], "https://video.example/poster.jpg")

    def test_external_cards_are_not_duplicated_in_text(self):
        linked = post(view("external", FIXTURE["external"]))
        self.assertEqual(linked["url"], "https://news.example/story?a=1&b=2")
        self.assertEqual(linked["embeds"][0]["title"], "An interesting <headline>")
        self.assertEqual(linked["embeds"][0]["description"], "A preview, not executable <script>.")
        self.assertEqual(linked["embeds"][0]["imageUrl"], "https://news.example/cover.jpg")
        self.assertEqual(linked["bodyHtml"], "")

    def test_record_with_media_keeps_nested_embeds_utf8_facets_and_source_warnings(self):
        root = post(view("quote", FIXTURE["recordWithMedia"], "A thought"))
        self.assertEqual([embed["type"] for embed in root["embeds"]], ["image", "quote"])
        quoted = root["embeds"][1]
        self.assertEqual(quoted["url"], "https://bsky.app/profile/did:plc:quoted/post/quoted-key")
        self.assertEqual(quoted["author"], "@quoted.example")
        self.assertEqual(quoted["bodyHtml"], '<p>☕ read <a href="https://news.example/">here</a></p>')
        self.assertEqual([embed["type"] for embed in quoted["embeds"]], ["video", "link"])
        self.assertTrue(quoted["sensitive"])
        self.assertEqual(quoted["contentWarning"], "Sensitive content")
        self.assertFalse(root["sensitive"])

    def test_current_thread_media_replaces_old_media_and_reply_urls_remain_precise(self):
        previous = post(view("root", FIXTURE["image"], "Old body"))
        current, reply = view("root", FIXTURE["video"], "Current body"), view("reply", FIXTURE["gallery"], "Reply body")
        current["replyCount"] = 1
        result = social._bsky_thread(previous, {"thread": {"post": current, "replies": [{"post": reply, "replies": []}]}})
        self.assertEqual(result["bodyHtml"], "<p>Current body</p>")
        self.assertEqual(result["embeds"][0]["type"], "video")
        self.assertEqual(previous["embeds"][0]["type"], "video")
        self.assertEqual(result["comments"][0]["embeds"][0]["url"], "https://cdn.example/gallery.jpg")
        self.assertEqual(result["comments"][0]["replyUrl"], "https://bsky.app/profile/did:plc:alice/post/reply")
        cleared = social._bsky_thread(previous, {"thread": {"post": view("root", text="Only text"), "replies": []}})
        self.assertEqual(cleared["embeds"], [])
        self.assertEqual(previous["embeds"], [])

    def test_invalid_urls_raw_blobs_and_blocked_quotes_do_not_expose_media(self):
        urls = ["javascript:alert(1)", "data:image/png;base64,AAAA", "file:///private.jpg", "https://user:password@media.example/p.jpg"]
        images = dict(images=[dict(fullsize=url, thumb=url, alt="invalid") for url in urls])
        self.assertEqual(post(view("unsafe", images))["embeds"], [])
        raw = view("raw")
        raw["record"]["embed"] = {"$type": "app.bsky.embed.images", "images": [{"image": {"ref": {"$link": "blob-id"}}, "alt": "Raw blob"}]}
        self.assertEqual(post(raw)["embeds"], [])
        blocked = post(view("blocked", FIXTURE["blockedQuote"]))
        self.assertTrue(blocked["embeds"][0]["unavailable"])
        self.assertEqual(blocked["embeds"][0]["embeds"], [])
        self.assertNotIn("MUST NOT LEAK", json.dumps(blocked))
        self.assertNotIn("cdn.example", json.dumps(blocked))

    def test_removed_roots_clear_previously_collected_media(self):
        previous = post(view("root", FIXTURE["image"]))
        previous["sensitive"] = True
        thread = social._bsky_thread(previous, {"thread": {"notFound": True}})
        self.assertTrue(previous["unavailable"])
        self.assertEqual(previous["embeds"], [])
        self.assertEqual(thread["embeds"], [])
        self.assertFalse(thread["sensitive"])

    def test_media_and_quote_limits_preserve_source_self_labels(self):
        gallery = copy.deepcopy(FIXTURE["gallery"])
        gallery["items"] *= 80
        self.assertLessEqual(len(post(view("many", gallery))["embeds"]), 20)
        quoted = copy.deepcopy(FIXTURE["recordWithMedia"]["record"])
        for _ in range(20):
            wrapper = copy.deepcopy(FIXTURE["recordWithMedia"]["record"])
            wrapper["record"]["embeds"] = [quoted]
            quoted = wrapper
        item = post(view("deep", quoted))["embeds"][0]
        depth = 0
        while item.get("type") == "quote":
            depth += 1
            item = next(iter(item["embeds"]), {})
        self.assertLessEqual(depth, 2)
        labelled = view("labelled", FIXTURE["image"])
        labelled["record"]["labels"] = {"values": [{"val": "nudity"}]}
        self.assertTrue(post(labelled)["sensitive"])

    def test_mastodon_root_and_reply_media_ignore_iframe_markup(self):
        root = social._mastodon_post(status(10, **FIXTURE["mastodon"]), "https://mastodon.social", "technology")
        self.assertEqual([item["type"] for item in root["embeds"]], ["image", "video", "audio", "link"])
        self.assertEqual(root["embeds"][0]["width"], 800)
        self.assertEqual(root["embeds"][3]["siteName"], "Example News")
        self.assertTrue(root["sensitive"])
        self.assertEqual(root["contentWarning"], "Source warning")
        self.assertNotIn("iframe", json.dumps(root))
        self.assertNotIn("evil.example", json.dumps(root))
        reply = status(11, **FIXTURE["mastodon"], in_reply_to_id="10")
        thread = social._mastodon_thread(root, {"descendants": [reply]})
        self.assertEqual(thread["embeds"][0]["type"], "image")
        self.assertEqual(thread["comments"][0]["embeds"][2]["type"], "audio")
        self.assertEqual(thread["comments"][0]["replyUrl"], "https://example.social/@alice/11")


if __name__ == "__main__":
    unittest.main()
