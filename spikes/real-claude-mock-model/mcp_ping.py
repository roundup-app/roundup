#!/usr/bin/env python3
"""A stdio MCP server with one tool, `ping`; each call is appended to $SPIKE_LOG/mcp.jsonl."""
import json
import os
import sys
import time

log_dir = os.environ.get("SPIKE_LOG", "/tmp/fake-claude-research/spike/logs")


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def note(record):
    with open(f"{log_dir}/mcp.jsonl", "a") as out:
        out.write(json.dumps({"t": round(time.time(), 3), **record}) + "\n")


note(
    {
        "started": True,
        # What reached this child from settings `env` blocks and the process environment.
        "env": {
            k: v
            for k, v in os.environ.items()
            if k.startswith(("ANTHROPIC", "SPIKE_FROM", "CLAUDE_CODE_", "DISABLE_"))
        },
    }
)
for line in sys.stdin:
    request = json.loads(line)
    method, rid = request.get("method"), request.get("id")
    note({"method": method})
    if rid is None:
        continue
    if method == "initialize":
        result = {
            "protocolVersion": request["params"].get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "spike", "version": "0.1"},
        }
    elif method == "tools/list":
        result = {
            "tools": [
                {
                    "name": "ping",
                    "description": "Answers PONG with the given word.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"word": {"type": "string"}},
                    },
                }
            ]
        }
    elif method == "tools/call":
        note({"call": request["params"]})
        word = request["params"].get("arguments", {}).get("word", "")
        result = {"content": [{"type": "text", "text": f"PONG-91c2 {word}"}]}
    else:
        send(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": "no such method"},
            }
        )
        continue
    send({"jsonrpc": "2.0", "id": rid, "result": result})
