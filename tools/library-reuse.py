#!/usr/bin/env python3
"""Use the installed ast-grep grammars; no source parser or runtime dependency download."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

TELLTALES = {"cloneNode", "important-style", "polling-wait", "system-time"}
SKIP = {"node_modules", "target", "generated", "artifacts", ".git", "vendor"}


def rule(name, language, matcher, **extra):
    return dict(id=name, language=language, rule=matcher, severity="info", message=name, **extra)


def named(kind, name="name"):
    return {"all": [{"kind": kind}, {"has": {"field": name, "pattern": "$NAME"}}]}


def macro_call(name, pattern):
    # Macro arguments have token nodes; requiring the identifier excludes string-only mentions.
    return {"all": [
        {"kind": "token_tree"}, {"regex": pattern},
        {"has": {"kind": "identifier", "regex": f"^{name}$", "stopBy": "end"}},
    ]}


def rules():
    here = Path(__file__).resolve().parent
    # Reuse the existing lint's call/style rules, including its CSS property catalogue.
    existing = (here / "lint/rules.json").read_text()
    properties = json.loads((here.parent / "node_modules/mdn-data/css/properties.json").read_text())
    names = list(properties) + [re.sub(r"-([a-z])", lambda match: match[1].upper(), name) for name in properties]
    css = r"(--[a-zA-Z_][a-zA-Z0-9_-]*|" + "|".join(re.escape(name) for name in sorted(set(names))) + ")"
    existing = json.loads(existing.replace("$CSS_PROPERTY", json.dumps(css)[1:-1]))
    result = [
        rule("symbol", "Rust", named("function_item")),
        rule("owner", "Rust", named("impl_item", "type")),
        rule("module", "Rust", named("mod_item")),
        rule("system-time", "Rust", {"pattern": "$CLOCK::now()"},
             constraints={"CLOCK": {"regex": r"(^|::\s*)SystemTime$"}}),
        rule("polling-wait", "Rust", {"all": [
            {"any": [{"kind": kind} for kind in ("loop_expression", "while_expression", "for_expression")]},
            {"has": {"any": [
                {"pattern": "$CHILD.try_wait($$$)"},
                macro_call("try_wait", r"\.\s*try_wait\s*\("),
            ], "stopBy": "end"}},
            {"has": {"pattern": "$THREAD::sleep($$$)", "stopBy": "end"}},
        ]}, constraints={"THREAD": {"regex": r"(^|::\s*)thread$"}}),
    ]
    result.append(rule("system-time", "Rust", macro_call("SystemTime", r"\bSystemTime\s*::\s*now\s*\(\s*\)")))
    for language in ("TypeScript", "Tsx"):
        result += [
            rule("symbol", language, {"any": [named("function_declaration"), named("variable_declarator")]}),
            rule("cloneNode", language, existing["dom-clone"]),
            rule("important-style", language, existing["style-override"]),
        ]
    # Each document has its own language; duplicate metadata ids are intentionally shared.
    return "\n---\n".join(json.dumps(item) for item in result)


def exceptions(root):
    path = root / "tools/library-reuse-exceptions.json"
    entries = json.loads(path.read_text())
    if not isinstance(entries, list):
        raise ValueError("exception list must be an array")
    allowed = set()
    helpers = 0
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - {"telltale", "file", "symbol", "reason", "helper"}:
            raise ValueError("invalid exception entry")
        if any(not isinstance(entry.get(key), str) or not entry[key].strip()
               for key in ("telltale", "file", "symbol", "reason")):
            raise ValueError("exception requires telltale, exact file/symbol and a nonempty reason")
        file = Path(entry["file"])
        if (entry["telltale"] not in TELLTALES or file.is_absolute() or ".." in file.parts
                or any(char in entry["file"] + entry["symbol"] for char in "*?[]")
                or not (entry["file"].startswith("apps/desktop/src/") or entry["file"].startswith("crates/"))
                or file.suffix not in {".rs", ".ts", ".tsx"}):
            raise ValueError("invalid exception file, symbol or telltale")
        if "helper" in entry and (entry["helper"] is not True or entry["telltale"] != "system-time"):
            raise ValueError("only a system-time exception can designate a helper")
        helpers += int(entry.get("helper", False))
        key = (entry["telltale"], entry["file"], entry["symbol"])
        if key in allowed:
            raise ValueError("duplicate exception")
        allowed.add(key)
    if helpers > 1:
        raise ValueError("at most one SystemTime helper is allowed")
    return allowed


def bounds(match):
    span = match["range"]["byteOffset"]
    return span["start"], span["end"]


def contains(outer, inner):
    start, end = bounds(outer)
    first, last = bounds(inner)
    return start <= first and last <= end


def main():
    root = Path(sys.argv[1]).resolve(strict=True)
    if not root.is_dir() or not root.stat().st_mode & 0o444:
        raise ValueError("unreadable root")
    allowed = exceptions(root)
    paths = [path for path in (root / "apps/desktop/src", root / "crates") if path.is_dir()]
    if not paths:
        raise ValueError("root has no App or crate source")
    # os.walk raises through onerror, including inaccessible subtrees that ast-grep might skip.
    def unreadable(error):
        raise error
    for path in paths:
        for directory, dirs, files in os.walk(path, onerror=unreadable):
            dirs[:] = sorted(name for name in dirs if name not in SKIP)
            for item in [Path(directory)] + [Path(directory) / name for name in files if Path(name).suffix in {".rs", ".ts", ".tsx"}]:
                if not item.stat().st_mode & 0o444:
                    raise ValueError(f"unreadable source: {item.relative_to(root)}")
    binary = Path(__file__).resolve().parent.parent / "node_modules/.bin/ast-grep"
    command = [str(binary), "scan", "--inline-rules", rules(), "--json=compact"]
    command += [f"--no-ignore={kind}" for kind in ("hidden", "dot", "exclude", "global", "parent", "vcs")]
    for directory in sorted(SKIP):
        command += ["--globs", f"!**/{directory}/**"]
    command += [str(path) for path in paths]
    scan = subprocess.run(command, capture_output=True, text=True, check=False, timeout=30)
    if scan.returncode != 0:
        raise ValueError(f"ast-grep failed: {scan.stderr.strip()}")
    matches = json.loads(scan.stdout)
    by_file = {}
    for match in matches:
        by_file.setdefault(match["file"], []).append(match)
    violations = set()
    for file, items in by_file.items():
        for match in items:
            telltale = match["ruleId"]
            if telltale not in TELLTALES:
                continue
            enclosing = [item for item in items if item["ruleId"] == "symbol" and contains(item, match)]
            scope = min(enclosing, key=lambda item: bounds(item)[1] - bounds(item)[0], default=None)
            owners = [item for item in items if item["ruleId"] in {"owner", "module"} and contains(item, match)]
            owners.sort(key=lambda item: bounds(item)[0])
            names = [item["metaVariables"]["single"]["NAME"]["text"] for item in owners + ([scope] if scope else [])]
            symbol = "::".join(names) if names else "<module>"
            relative = Path(file).relative_to(root).as_posix()
            if (telltale, relative, symbol) not in allowed:
                violations.add((relative, match["range"]["start"]["line"] + 1, telltale, symbol))
    for file, line, telltale, symbol in sorted(violations):
        print(f"{file}:{line}: {telltale} in {symbol}")
    return int(bool(violations))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(f"library-reuse guard: {error}", file=sys.stderr)
        sys.exit(2)
