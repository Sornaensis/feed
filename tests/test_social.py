"""Fixture-only checks for social identity, reply trees, and paid API bounds."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location("social", Path(__file__).resolve().parents[1] / "scripts/social.py")
social = importlib.util.module_from_spec(spec)
spec.loader.exec_module(social)


class FixtureCollector:
    def __init__(self, get_json=None, previous=(), limit=25):
        self.limit = limit
        self.previous = {"posts": list(previous)}
        self.errors, self.calls, self.threads = [], [], {}
        self.response = get_json

    def get_json(self, url):
        self.calls.append(url)
        if self.response is None:
            raise AssertionError("unexpected network request")
        return self.response(url)

    def problem(self, label, error):
        self.errors.append(f"{label}: {error}")

    def previous_post(self, source, item_id):
        return next((dict(post, stale=True) for post in self.previous["posts"]
                     if post["id"] == f"{source}:{item_id}"), None)

    def parallel(self, function, items, fallback=None):
        result = []
        for item in items:
            try:
                value = function(item)
            except Exception as error:
                self.problem("fixture", error)
                value = fallback(item) if fallback else None
            if value is not None:
                result.append(value)
        return result

    def save_thread(self, post, fetch):
        try:
            self.threads[post["id"]] = fetch()
            post["threadPath"] = f"data/threads/{post['sourceId']}-{post['sourceItemId']}.json"
        except Exception as error:
            self.problem(post["id"], error)


def bsky_view(actor="alice", key="same-key", text="A public post", replies=0):
    return dict(uri=f"at://did:plc:{actor}/app.bsky.feed.post/{key}",
                author={"did": f"did:plc:{actor}", "handle": actor + ".example"},
                record={"text": text, "createdAt": "2026-11-16T12:00:00Z"},
                replyCount=replies, likeCount=2)


def masto_status(item_id="10", parent=None, url="https://remote.example/@alice/900"):
    return dict(id=item_id, in_reply_to_id=parent, url=url, content="<p>A public status</p>",
                created_at="2026-11-16T12:00:00Z", account={"acct": "alice@remote.example"},
                replies_count=1, favourites_count=2, visibility="public")


class PublicConfigTests(unittest.TestCase):
    def test_only_public_fields_are_published(self):
        config = {
            "bluesky": {"actors": [" arstechnica.com ", "arstechnica.com", "did:plc:wld6fad6xsm4tz4kfkoikun2"],
                        "password": "private"},
            "mastodon": {"instance": "https://mastodon.social/", "tag": " #technology ", "token": "private"},
            "x": {"bearerToken": "private", "usernames": ["alice"]},
            "secret": "private",
        }
        with patch.object(social, "_config", return_value=config):
            self.assertEqual(social.public_config(), {
                "bluesky": {"actors": ["arstechnica.com", "did:plc:wld6fad6xsm4tz4kfkoikun2"]},
                "mastodon": {"instance": "https://mastodon.social", "tag": "technology"},
            })

    def test_invalid_actor_sections_are_omitted(self):
        for actors in ([], "arstechnica.com", [None], ["https://example.com"], ["alice@example.com"],
                       ["invalid..example"], ["example.123"], ["a.example"] * 11):
            with self.subTest(actors=actors), patch.object(social, "_config", return_value={"bluesky": {"actors": actors}}):
                self.assertEqual(social.public_config(), {})

    def test_invalid_or_credentialed_origins_are_omitted(self):
        instances = ["http://mastodon.social", "https://alice:secret@mastodon.social", "https://@mastodon.social", "https://mastodon.social/api",
                     "https://mastodon.social?token=secret", "https://mastodon.social#token", "https://bad host",
                     "https://mastodon.social:invalid", "https://mastodon.social:99999", "https://mastodon.social\\evil"]
        for instance in instances:
            with self.subTest(instance=instance), patch.object(social, "_config", return_value={
                "bluesky": {"actors": ["arstechnica.com"]}, "mastodon": {"instance": instance, "tag": "technology"},
            }):
                self.assertEqual(social.public_config(), {"bluesky": {"actors": ["arstechnica.com"]}})

    def test_missing_or_invalid_configuration_does_not_break_other_sources(self):
        for error in (OSError("missing"), ValueError("invalid JSON")):
            with self.subTest(error=error), patch.object(social, "_config", side_effect=error):
                self.assertEqual(social.public_config(), {})
        with patch.object(social, "_config", return_value={"bluesky": None, "mastodon": {"instance": None}}):
            self.assertEqual(social.public_config(), {})


class BlueskyTests(unittest.TestCase):
    def test_full_uri_identity_external_only_body_and_utf8_links(self):
        first, second = bsky_view("alice", text=""), bsky_view("bob", text="")
        first["embed"] = {"external": {"title": "A real headline", "description": "Full <script> description",
                                         "uri": "https://news.example/story?a=1&b=2"}}
        a, b = social._bsky_post(first, "alice.example"), social._bsky_post(second, "bob.example")
        self.assertNotEqual(a["sourceItemId"], b["sourceItemId"])
        self.assertEqual(a["atUri"], first["uri"])
        self.assertEqual(a["title"], "A real headline")
        self.assertEqual(a["bodyHtml"], "")
        self.assertEqual(a["embeds"], [dict(type="link", url="https://news.example/story?a=1&b=2", title="A real headline",
                                          description="Full <script> description", imageUrl="")])
        self.assertEqual(a["discussionUrl"], "https://bsky.app/profile/did:plc:alice/post/same-key")
        text = "☕ read here"
        rendered = social._bsky_text(text, [{"index": {"byteStart": 9, "byteEnd": 13},
                                           "features": [{"$type": "app.bsky.richtext.facet#link", "uri": "https://news.example/"}]}])
        self.assertIn('☕ read <a href="https://news.example/">here</a>', rendered)

    def test_nested_and_unavailable_replies_keep_their_exact_parent(self):
        root, reply = bsky_view("root", replies=1), bsky_view("reply")
        missing_uri = "at://did:plc:missing/app.bsky.feed.post/parent"
        payload = {"thread": {"post": root, "replies": [
            {"$type": "app.bsky.feed.defs#blockedPost", "blocked": True, "uri": missing_uri,
             "replies": [{"post": reply, "replies": []}]}]}}
        thread = social._bsky_thread(social._bsky_post(root, "root.example"), payload)
        parent = thread["comments"][0]
        self.assertTrue(parent["unavailable"])
        self.assertFalse(thread["complete"])
        child = parent["children"][0]
        self.assertEqual(child["parentId"], missing_uri)
        self.assertEqual(child["replyUrl"], "https://bsky.app/profile/did:plc:reply/post/same-key")

    def test_accounts_share_limit_and_transient_failures_retain_only_their_posts(self):
        old = social._bsky_post(bsky_view("bad"), "bad.example")
        views = {actor: [bsky_view(actor, str(i)) for i in range(9)] for actor in ("good", "other")}
        by_uri = {view["uri"]: view for group in views.values() for view in group}

        def response(url):
            query = parse_qs(urlsplit(url).query)
            if "actor" in query:
                actor = query["actor"][0].split(".")[0]
                if actor == "bad":
                    raise OSError("temporary failure")
                self.assertEqual(query["limit"], ["9"])
                return {"feed": [{"post": view} for view in views[actor]]}
            return {"thread": {"post": by_uri[query["uri"][0]], "replies": []}}

        collector = FixtureCollector(response, [old])
        config = {"bluesky": {"actors": ["good.example", "bad.example", "other.example"]}}
        with patch.object(social, "_config", return_value=config):
            posts = social.collect_bluesky(collector)
        self.assertEqual(len(posts), 19)
        self.assertTrue(next(post for post in posts if post["sourceAccount"] == "bad.example")["stale"])
        self.assertEqual(len(collector.threads), 18)
        self.assertLessEqual(len(posts), 25)

    def test_known_removal_and_valid_empty_do_not_revive_old_posts(self):
        config = {"bluesky": {"actors": ["gone.example"]}}
        old = social._bsky_post(bsky_view("gone"), "gone.example")
        removed = Mock(side_effect=HTTPError("https://public.api.bsky.app/", 404, "Not found", {}, None))
        with patch.object(social, "_config", return_value=config):
            collector = FixtureCollector(removed, [old])
            self.assertEqual(social.collect_bluesky(collector), [])
            self.assertEqual(collector.errors, [])
            self.assertEqual(social.collect_bluesky(FixtureCollector(lambda _: {"feed": []}, [old])), [])
            with self.assertRaises(ValueError):
                social.collect_bluesky(FixtureCollector(Mock(side_effect=OSError("offline"))))
            with self.assertRaises(ValueError):
                social.collect_bluesky(FixtureCollector(lambda _: {"feed": [{"post": {"uri": "invalid"}}]}))


class MastodonTests(unittest.TestCase):
    def test_federated_urls_and_missing_parents_are_not_fabricated(self):
        root = masto_status()
        child = masto_status("13", "12", "https://different.example/@bob/1234")
        grandchild = masto_status("14", "13", "https://different.example/@carol/9876")

        def response(url):
            self.assertTrue(url.startswith("https://mastodon.social/api/v1/"))
            if "/timelines/" in url:
                return [root]
            self.assertEqual(url, "https://mastodon.social/api/v1/statuses/10/context")
            return {"ancestors": [], "descendants": [grandchild, child]}

        config = {"mastodon": {"instance": "https://mastodon.social", "tag": "technology"}}
        collector = FixtureCollector(response)
        with patch.object(social, "_config", return_value=config):
            post = social.collect_mastodon(collector)[0]
        self.assertEqual(post["discussionUrl"], root["url"])
        thread = collector.threads[post["id"]]
        self.assertFalse(thread["complete"])
        missing = thread["comments"][0]
        self.assertEqual(missing["id"], "12")
        self.assertTrue(missing["unavailable"])
        self.assertEqual(missing["replyUrl"], "")
        reply = missing["children"][0]
        self.assertEqual(reply["replyUrl"], child["url"])
        self.assertEqual(reply["children"][0]["replyUrl"], grandchild["url"])
        self.assertIn("60 descendants", thread["notice"])
        with patch.object(social, "_config", return_value=config):
            with self.assertRaises(ValueError):
                social.collect_mastodon(FixtureCollector(lambda _: ["invalid status"]))


X_ENV = {"X_ENABLED": "true", "X_BEARER_TOKEN": "fixture-secret-never-send", "X_USERNAMES": "alpha,beta,gamma"}


class XTests(unittest.TestCase):
    def test_paid_adapter_is_disabled_without_complete_valid_opt_in(self):
        cases = [{}, {**X_ENV, "X_ENABLED": "false"}, {**X_ENV, "X_BEARER_TOKEN": ""},
                 {**X_ENV, "X_USERNAMES": ""}, {**X_ENV, "X_USERNAMES": "a,b,c,d"}]
        for env in cases:
            with self.subTest(env=env.get("X_USERNAMES")), patch.dict(os.environ, env, clear=True), \
                    patch.object(social, "_x_json") as request:
                collector = FixtureCollector()
                self.assertFalse(social.x_enabled())
                self.assertEqual(social.collect_x(collector), [])
                request.assert_not_called()
                self.assertEqual(collector.calls, [])

    def test_posts_and_partial_reply_search_are_bounded_without_pagination(self):
        clock = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
        calls = []

        def api(path, params):
            calls.append((path, params))
            if path == "/2/users/by":
                return {"data": [{"id": str(i), "username": handle} for i, handle in enumerate(["alpha", "beta", "gamma"], 1)]}
            if path.endswith("/tweets"):
                uid = int(path.split("/")[3])
                return {"data": [{"id": str(uid * 100 + i), "text": "Root <post>", "created_at": social._stamp(clock),
                                  "public_metrics": {"reply_count": 20}, "conversation_id": str(uid * 100 + i)}
                                 for i in range(8)], "meta": {"next_token": "must-not-follow"}}
            self.assertEqual(path, "/2/tweets/search/recent")
            self.assertEqual(params["max_results"], 10)
            self.assertIn("referenced_tweets", params["tweet.fields"])
            start = datetime.fromisoformat(params["start_time"].replace("Z", "+00:00"))
            self.assertGreaterEqual(start, clock - timedelta(days=7))
            self.assertLess(start, clock - timedelta(days=6))
            root = params["query"].split()[0].split(":")[1]
            return {"data": [
                {"id": root + "1", "author_id": "42", "text": "Parent", "created_at": social._stamp(clock),
                 "referenced_tweets": [{"type": "replied_to", "id": root}]},
                {"id": root + "2", "author_id": "42", "text": "Truncated", "created_at": social._stamp(clock),
                 "note_post": {"text": "Full long reply"}, "referenced_posts": [{"type": "replied_to", "id": root + "1"}]},
                {"id": root + "3", "author_id": "42", "text": "Orphan", "created_at": social._stamp(clock),
                 "referenced_tweets": [{"type": "replied_to", "id": "99999"}]},
                {"id": root + "4", "text": "Too old", "created_at": social._stamp(clock - timedelta(days=8))},
            ], "includes": {"users": [{"id": "42", "username": "reply_author"}]}, "meta": {"next_token": "must-not-follow"}}

        collector = FixtureCollector()
        with patch.dict(os.environ, {**X_ENV, "X_FETCH_REPLIES": "true"}, clear=True), \
                patch.object(social, "_x_json", side_effect=api), patch.object(social, "_utc_now", return_value=clock):
            posts = social.collect_x(collector)
        self.assertEqual(len(posts), 15)
        self.assertEqual(len(calls), 7)  # one lookup, three timelines, three reply samples
        self.assertEqual(len([p for p, _ in calls if p.endswith("/tweets")]), 3)
        self.assertTrue(all(params["max_results"] == 5 for path, params in calls if path.endswith("/tweets")))
        sampled = [thread for thread in collector.threads.values() if thread["comments"]]
        self.assertEqual(len(sampled), 3)
        for thread in sampled:
            self.assertFalse(thread["complete"])
            self.assertTrue(thread["truncated"])
            self.assertIn("last 7 days", thread["notice"])
            parent = thread["comments"][0]
            self.assertEqual(parent["children"][0]["bodyHtml"], "<p>Full long reply</p>")
            self.assertEqual(parent["replyUrl"], f"https://x.com/reply_author/status/{parent['id']}")
            self.assertTrue(thread["comments"][1]["unavailable"])
            self.assertNotIn("Too old", json.dumps(thread))
        self.assertNotIn(X_ENV["X_BEARER_TOKEN"], json.dumps([posts, collector.threads, collector.errors]))

    def test_known_removed_or_protected_accounts_do_not_revive_saved_posts(self):
        old = social._x_post({"id": "10", "text": "Old public post"}, {"id": "1", "username": "alpha"})
        lookup = {"data": [{"id": "2", "username": "beta", "protected": True}],
                  "errors": [{"type": "https://api.x.com/2/problems/resource-not-found", "value": "alpha"}]}
        with patch.dict(os.environ, {**X_ENV, "X_USERNAMES": "alpha,beta"}, clear=True), \
                patch.object(social, "_x_json", return_value=lookup) as api:
            collector = FixtureCollector(previous=[old])
            self.assertEqual(social.collect_x(collector), [])
            self.assertEqual(collector.errors, [])
            self.assertEqual(api.call_count, 1)

    def test_token_is_only_in_authorization_header_and_errors_are_redacted(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"data":[]}'
        opener = Mock()
        opener.open.return_value = response
        with patch.dict(os.environ, X_ENV, clear=True), patch.object(social, "build_opener", return_value=opener):
            social._x_json("/2/users/by", {"usernames": "alpha"})
            request = opener.open.call_args.args[0]
            self.assertNotIn(X_ENV["X_BEARER_TOKEN"], request.full_url)
            self.assertEqual(request.get_header("Authorization"), "Bearer " + X_ENV["X_BEARER_TOKEN"])
            opener.open.side_effect = OSError("unsafe upstream detail " + X_ENV["X_BEARER_TOKEN"])
            with self.assertRaises(RuntimeError) as error:
                social._x_json("/2/users/by", {"usernames": "alpha"})
            self.assertNotIn(X_ENV["X_BEARER_TOKEN"], str(error.exception))


if __name__ == "__main__":
    unittest.main()
