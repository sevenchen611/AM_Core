"""Server-side client. Importing this file performs no network or send operations.

Set LINE_IO_BASE_URL and LINE_IO_API_KEY in the caller's environment.
Persist nextCursor only after the entire page has been processed successfully.
"""
import json
import os
from urllib.parse import urlencode, urlsplit, quote
from urllib.request import Request, urlopen


_DEFAULT_NOTIFY = object()


class LineIO:
    def __init__(self, base_url=None, api_key=None):
        self.base_url = (base_url or os.environ["LINE_IO_BASE_URL"]).rstrip("/")
        self.api_key = api_key or os.environ["LINE_IO_API_KEY"]
        parsed = urlsplit(self.base_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.query or parsed.fragment:
            raise ValueError("Use the deployment HTTPS base URL")

    def _request(self, method, path, body=None, key=None, timeout=30):
        headers = {"Authorization": f"Bearer {self.api_key}"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        if key:
            headers["Idempotency-Key"] = key
        request = Request(f"{self.base_url}/api/v1/line{path}", data=data, headers=headers, method=method)
        # HTTPError exposes status/body. On uncertain send outcome, retain the
        # original body and idempotency key for a bounded retry; do not invent one.
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)

    def groups(self):
        return self._request("GET", "/groups")

    def directory_groups(self, after="", limit=25):
        return self._request("GET", "/directory/groups?" + urlencode({"after": after, "limit": limit}), timeout=60)

    def directory_members(self, group_id, after="", limit=25):
        return self._request("GET", "/directory/groups/" + quote(group_id, safe="") + "/members?" +
                             urlencode({"after": after, "limit": limit}), timeout=60)

    def iter_directory_groups(self):
        after = ""
        while True:
            page = self.directory_groups(after=after)
            yield from page["groups"]
            if not page["hasMore"]:
                return
            if not page["nextCursor"] or page["nextCursor"] == after:
                raise ValueError("Directory cursor did not advance")
            after = page["nextCursor"]

    def iter_active_members(self, group_id):
        after = ""
        while True:
            page = self.directory_members(group_id, after=after)
            yield from (user for user in page["users"] if user["active"])
            if not page["hasMore"]:
                return
            if not page["nextCursor"] or page["nextCursor"] == after:
                raise ValueError("Member cursor did not advance")
            after = page["nextCursor"]

    def events(self, after="0", limit=100):
        return self._request("GET", "/events?" + urlencode({"after": after, "limit": limit}))

    def send_text(self, group_id, text, idempotency_key, notify_user_id=_DEFAULT_NOTIFY):
        if not idempotency_key:
            raise ValueError("A stable idempotency key is required")
        body = {"groupId": group_id, "text": text}
        if notify_user_id is not _DEFAULT_NOTIFY:
            body["notifyUserId"] = notify_user_id
        return self._request("POST", "/messages", body, idempotency_key)


# Usage in your daily program (explicit calls; no automatic approvals):
# line = LineIO()
# page = line.events(after=load_saved_cursor())
# for item in page["events"]:
#     process_once(item["event"]["webhookEventId"], item)
# save_cursor(page["nextCursor"])
# line.send_text(group_id, report_text, "daily-review-2026-09-28-part-1")
