#!/usr/bin/env python3
"""A fake Anthropic Messages API for driving the real Claude Code with no model.

  python3 mock.py PORT LOG_DIR

Serves POST /v1/messages (SSE when "stream": true, JSON otherwise) and
/v1/messages/count_tokens. Every request, on any path, is appended to
LOG_DIR/requests.jsonl.

Replies come from a script loaded with POST /__load {"script": [...]} (which also clears the
consumed state). Each entry is {"match": {...}, "reply": {...}, "times": N (default 1)}.
The first entry whose match holds and whose times are not used up answers the request.

match keys (all optional):
  main              true (default): only requests that carry tools, the agent loop; false: only
                    requests with no tools (side calls); "any": both
  last_user_contains a substring of the last user turn's text
  has_tool_result   whether the last user turn holds a tool_result
reply kinds:
  {"text": "..."}                                 end_turn; "{tool_result}" and "{prompt}" expand
  {"tool_use": {"name": "...", "input": {...}}}   stop_reason tool_use
  {"error": {"status": 500, "type": "api_error", "message": "..."}}
  {"delay_ms": N, ...}                            wait before answering
A request no entry matches gets the text "MOCK-7f3a".
"""
import gzip
import json
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, LOG_DIR = int(sys.argv[1]), sys.argv[2]
DEFAULT_TEXT = "MOCK-7f3a"
lock = threading.Lock()
state = {"script": [], "used": []}


def log(record):
    with lock, open(f"{LOG_DIR}/requests.jsonl", "a") as out:
        out.write(json.dumps(record) + "\n")


def credential_kind(value):
    """Name the kind of credential sent, never its secret part."""
    if not value:
        return None
    value = value.removeprefix("Bearer ").strip()
    if value.startswith("sk-mock"):
        return value
    return "OTHER:" + value[:10]


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if block.get("type") == "text":
            parts.append(block["text"])
        elif block.get("type") == "tool_result":
            parts.append("[tool_result] " + text_of(block.get("content") or ""))
    return "\n".join(parts)


def last_user(body):
    users = [m for m in body.get("messages", []) if m.get("role") == "user"]
    return users[-1]["content"] if users else ""


def tool_result_text(content):
    if isinstance(content, str):
        return ""
    for block in content:
        if block.get("type") == "tool_result":
            return text_of(block.get("content") or "")
    return ""


def matches(match, body):
    tools = bool(body.get("tools"))
    main = match.get("main", True)
    if main != "any" and main != tools:
        return False
    content = last_user(body)
    if "last_user_contains" in match and match["last_user_contains"] not in text_of(
        content
    ):
        return False
    has_result = any(
        isinstance(b, dict) and b.get("type") == "tool_result"
        for b in (content if isinstance(content, list) else [])
    )
    if "has_tool_result" in match and match["has_tool_result"] != has_result:
        return False
    return True


def choose(body):
    with lock:
        for i, entry in enumerate(state["script"]):
            if state["used"][i] < entry.get("times", 1) and matches(
                entry.get("match", {}), body
            ):
                state["used"][i] += 1
                return i, entry["reply"]
    return None, {"text": DEFAULT_TEXT}


def blocks_for(reply, body):
    content = last_user(body)
    blocks = []
    if "text" in reply:
        text = reply["text"].replace("{tool_result}", tool_result_text(content))
        text = text.replace("{prompt}", text_of(content)[-200:])
        blocks.append({"type": "text", "text": text})
    if "tool_use" in reply:
        use = reply["tool_use"]
        blocks.append(
            {
                "type": "tool_use",
                "id": "toolu_" + uuid.uuid4().hex[:20],
                "name": use["name"],
                "input": use["input"],
            }
        )
    return blocks, ("tool_use" if "tool_use" in reply else "end_turn")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def read_body(self):
        raw = self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.headers.get("content-encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw

    def send_json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("request-id", "req_mock_" + uuid.uuid4().hex[:12])
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def record(self, raw, extra):
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            body = {"_unparsed": raw[:200].decode(errors="replace")}
        record = {
            "t": round(time.time(), 3),
            "method": self.command,
            "path": self.path,
            "user_agent": self.headers.get("user-agent"),
            "beta": self.headers.get("anthropic-beta"),
            "x_api_key": credential_kind(self.headers.get("x-api-key")),
            "authorization": credential_kind(self.headers.get("authorization")),
        }
        if isinstance(body, dict) and "messages" in body:
            tools = body.get("tools") or []
            system = body.get("system")
            system_text = system if isinstance(system, str) else text_of(system or [])
            content = last_user(body)
            record.update(
                {
                    "model": body.get("model"),
                    "stream": body.get("stream", False),
                    "max_tokens": body.get("max_tokens"),
                    "n_messages": len(body.get("messages", [])),
                    "n_tools": len(tools),
                    "mcp_tools": [
                        t.get("name")
                        for t in tools
                        if str(t.get("name", "")).startswith("mcp__")
                    ],
                    "tool_names": [t.get("name") for t in tools],
                    "body_keys": sorted(body),
                    "output_config": body.get("output_config"),
                    "thinking": body.get("thinking"),
                    "system_head": system_text[:100],
                    # Markers a check plants in a prompt file, to see where the text landed.
                    "marks_in_system": sorted(set(re.findall(r"MARK-[0-9a-f]{4}", system_text))),
                    "marks_anywhere": sorted(set(re.findall(r"MARK-[0-9a-f]{4}", raw.decode(errors="replace")))),
                    "last_user": text_of(content)[:200],
                    "last_user_tail": text_of(content)[-200:],
                    "tool_result": tool_result_text(content)[:200],
                    "roles": [m.get("role") for m in body.get("messages", [])],
                    "user_texts": [
                        text_of(m["content"])[-60:] for m in body.get("messages", []) if m.get("role") == "user"
                    ],
                }
            )
        record.update(extra)
        log(record)
        return body

    def do_GET(self):
        self.record(b"", {})
        self.send_json(
            404,
            {
                "type": "error",
                "error": {"type": "not_found_error", "message": "mock: no such path"},
            },
        )

    do_HEAD = do_GET
    do_DELETE = do_GET

    def do_POST(self):
        raw = self.read_body()
        path = self.path.split("?")[0]
        if path == "/__load":
            with lock:
                state["script"] = json.loads(raw)["script"]
                state["used"] = [0] * len(state["script"])
            return self.send_json(200, {"ok": True})
        if path == "/v1/messages/count_tokens":
            self.record(raw, {"served": "count_tokens"})
            return self.send_json(200, {"input_tokens": 42})
        if path != "/v1/messages":
            self.record(raw, {"served": "404"})
            return self.send_json(
                404,
                {
                    "type": "error",
                    "error": {"type": "not_found_error", "message": "mock"},
                },
            )
        body = json.loads(raw)
        index, reply = choose(body)
        self.record(raw, {"served": {"entry": index, "reply": reply}})
        if reply.get("delay_ms"):
            time.sleep(reply["delay_ms"] / 1000)
        if "error" in reply:
            error = reply["error"]
            return self.send_json(
                error.get("status", 500),
                {
                    "type": "error",
                    "error": {
                        "type": error.get("type", "api_error"),
                        "message": error.get("message", "mock error"),
                    },
                },
            )
        blocks, stop = blocks_for(reply, body)
        model = body.get("model", "mock")
        message_id = "msg_mock_" + uuid.uuid4().hex[:16]
        usage = {
            "input_tokens": 10,
            "output_tokens": 5,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }
        if not body.get("stream"):
            return self.send_json(
                200,
                {
                    "id": message_id,
                    "type": "message",
                    "role": "assistant",
                    "model": model,
                    "content": blocks,
                    "stop_reason": stop,
                    "stop_sequence": None,
                    "usage": usage,
                },
            )
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("request-id", "req_mock_" + uuid.uuid4().hex[:12])
        self.send_header("connection", "close")
        self.end_headers()

        def event(kind, data):
            self.wfile.write(f"event: {kind}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        start = {
            "id": message_id,
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [],
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {**usage, "output_tokens": 1},
        }
        event("message_start", {"type": "message_start", "message": start})
        for index, block in enumerate(blocks):
            if block["type"] == "text":
                event(
                    "content_block_start",
                    {
                        "type": "content_block_start",
                        "index": index,
                        "content_block": {"type": "text", "text": ""},
                    },
                )
                event(
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {"type": "text_delta", "text": block["text"]},
                    },
                )
            else:
                head = {**block, "input": {}}
                event(
                    "content_block_start",
                    {
                        "type": "content_block_start",
                        "index": index,
                        "content_block": head,
                    },
                )
                event(
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": json.dumps(block["input"]),
                        },
                    },
                )
            event("content_block_stop", {"type": "content_block_stop", "index": index})
        event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop, "stop_sequence": None},
                "usage": {"output_tokens": 5},
            },
        )
        event("message_stop", {"type": "message_stop"})
        self.close_connection = True


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
