"""U2875d captures: a fresh, isolated headless agent-browser session only."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import uuid

origin, output = sys.argv[1:]
if not output:
    raise ValueError("U2875d requires an explicit capture directory")
directory = Path(output)
session = "u2875d-" + uuid.uuid4().hex
records = []


def browser(*args):
    result = subprocess.run(
        ["agent-browser", "--session", session, "--json", *args],
        text=True, capture_output=True, timeout=40,
    )
    if result.returncode or not result.stdout:
        raise RuntimeError(result.stderr or result.stdout)
    reply = json.loads(result.stdout)
    if not reply["success"]:
        raise RuntimeError(reply)
    return reply["data"]


def evaluate(script):
    return browser("eval", script)["result"]


def capture(step):
    checks = evaluate("window.__checks()")
    directory.mkdir(parents=True, exist_ok=True)
    (directory / ("observer-" + step + ".checks.json")).write_text(json.dumps(checks) + "\n")
    browser("screenshot", str(directory / ("observer-" + step + ".png")))
    records.append({"step": step, "checks": checks})


with TemporaryDirectory(prefix="u2875d-profile-") as profile:
    try:
        browser("--profile", profile, "open", origin + "harness.html?seed=tree-40&import=dense")
        browser("set", "viewport", "1512", "950")
        browser("set", "media", "dark")
        browser("wait", ".rail-import")
        browser("wait", "--fn", "document.querySelectorAll('.rail-row').length > 30")
        evaluate("document.fonts.ready")
        capture("rail")
        browser("click", ".rail-import")
        browser("wait", "--fn", "document.querySelectorAll('.import-check').length === 10")
        capture("dense")
        browser("click", ".import-list li:nth-child(1) .import-check")
        browser("wait", "--fn", "document.querySelectorAll('.import-check[data-state=checked]').length === 1")
        browser("click", ".import-list li:nth-child(2) .import-check")
        browser("wait", "--fn", "document.querySelectorAll('.import-check[data-state=checked]').length === 2")
        browser("click", ".import-confirm")
        browser("wait", "--fn", "!!document.querySelector('.import-error [role=alert]') && !document.querySelector('.import-confirm').disabled")
        browser("scrollintoview", ".import-error")
        capture("partial-failure")
        browser("scrollintoview", ".import-unavailable")
        capture("unavailable")
        print(json.dumps(records))
    finally:
        browser("close")
