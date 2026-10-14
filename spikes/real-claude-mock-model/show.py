#!/usr/bin/env python3
"""Print a log directory's requests, hook events, MCP calls and proxy hits, one line each, by time."""
import json
import os
import sys

log_dir = sys.argv[1]
rows = []


def load(name):
    path = os.path.join(log_dir, name)
    return [json.loads(line) for line in open(path)] if os.path.exists(path) else []


for r in load("requests.jsonl"):
    if r["path"] in ("/ready",):
        continue
    if "model" in r:
        served = r.get("served", {})
        reply = served.get("reply", {}) if isinstance(served, dict) else served
        kind = (
            "tool_use:" + reply["tool_use"]["name"]
            if "tool_use" in reply
            else ("error" if "error" in reply else "text")
        )
        tail = r.get("last_user_tail", "").replace("\n", " ")[-70:]
        rows.append(
            (
                r["t"],
                f"API  {r['path'][:22]:22} model={r['model']} tools={r['n_tools']} mcp={r['mcp_tools']} msgs={r['n_messages']} stream={r['stream']} -> {kind} | tail={tail!r} result={r.get('tool_result','')[:40]!r}",
            )
        )
    else:
        rows.append(
            (r["t"], f"API  {r['method']} {r['path']} served={r.get('served')}")
        )
for h in load("hooks.jsonl"):
    p = h["payload"]
    keys = sorted(
        k
        for k in p
        if k not in ("session_id", "transcript_path", "cwd", "hook_event_name")
    )
    detail = {
        k: p[k] for k in ("source", "tool_name", "reason", "error", "prompt") if k in p
    }
    rows.append(
        (h["t"], f"HOOK {h['event']:18} keys={keys} {json.dumps(detail)[:160]}")
    )
for m in load("mcp.jsonl"):
    if "call" in m:
        rows.append((m["t"], f"MCP  tools/call {json.dumps(m['call'])}"))
for x in load("proxy.jsonl"):
    rows.append((x["t"], f"PROXY {x['request']}"))
t0 = min((t for t, _ in rows), default=0)
for t, line in sorted(rows):
    print(f"{t - t0:7.2f}s {line}")
api = [r for r in load("requests.jsonl") if r["path"] != "/ready"]
print("  endpoints:", sorted({(r["method"], r["path"]) for r in api}))
print("  models:", sorted({r.get("model") for r in api if "model" in r}))
print("  credentials:", sorted({f"x-api-key={r.get('x_api_key')} authorization={r.get('authorization')}" for r in api if "model" in r}))
print("  proxy hits (traffic not to the mock):", len(load("proxy.jsonl")))
