#!/usr/bin/env python3
"""M15 native source probe, not adapter/MCP parity or full Issue #1552 acceptance.

Run: python3 crates/agents/src/claude_code/m15_interactive.py
Requires the installed Claude Code and a Unix PTY; uses no personal configuration.
The comparison must fail until a source works with F2's native Bash omission.
"""

import argparse
import json
import math
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import time


MOD = """export function register(on) {
  on('session.start', async ($, e, next) => {
    const output = {
      interactive: e.isInteractive,
      conversation: await $.session.id(),
      cwd: await $.session.cwd(),
      version: await $.session.version(),
      settings: await $.settings.read({}),
      configuredDefault: (await $.config.list()).filter(row => row.key === 'permissionMode'),
      tools: (await $.tool.list()).map(tool => tool.name),
      checks: [],
    };
    for (const command of ['echo hi', 'touch x', 'touch denied']) {
      try {
        output.checks.push({command, reply: await $.tool.check({tool: 'Bash', input: {command}})});
      } catch (error) {
        output.checks.push({command, error: String(error)});
      }
    }
    // A separate marker follows the completed write; Python never parses a partial reply.
    await $.fs.write('probe.json', JSON.stringify(output));
    await $.fs.write('probe.done', 'done');
    return next(e);
  });
}
"""


def m15_interactive_source(claude, version, role, cli_allow, timeout):
    """Compare one interactive vendor instance's permission-only source with M15."""
    with tempfile.TemporaryDirectory(prefix="m15-interactive-") as root:
        folder = Path(root)
        config = folder / "config"
        project = folder / "project"
        mod = folder / "mod"
        config.mkdir()
        project.mkdir()
        (mod / ".claude-plugin").mkdir(parents=True)
        (mod / "hooks").mkdir()
        key = "m15-permission-only-fixture"
        (config / ".claude.json").write_text(json.dumps({
            "hasCompletedOnboarding": True,
            "theme": "dark",
            "lastOnboardingVersion": version.split()[0],
            "customApiKeyResponses": {"approved": [key[-20:]], "rejected": []},
            "projects": {str(project): {"hasTrustDialogAccepted": True}},
        }))
        (mod / ".claude-plugin/plugin.json").write_text(json.dumps({
            "name": "m15-source-probe", "version": "0.0.1",
        }))
        (mod / "hooks/hooks.json").write_text(json.dumps({"modules": ["./register.js"]}))
        (mod / "hooks/register.js").write_text(MOD)
        # Discard inherited vendor credentials/configuration; HOME also belongs to the fixture.
        env = {name: value for name, value in os.environ.items()
               if not name.startswith(("ANTHROPIC_", "CLAUDE_")) and name != "CLAUDECODE"}
        env.update({
            "HOME": str(folder), "XDG_CONFIG_HOME": str(config),
            "CLAUDE_CONFIG_DIR": str(config), "ANTHROPIC_API_KEY": key,
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "TERM": "xterm-256color",
        })
        argv = [
            claude, "--permission-mode", "manual", "--setting-sources", "project,local",
            "--settings", json.dumps({"permissions": {
                "allow": ["Bash(echo:*)"], "deny": ["Bash(touch denied:*)"],
            }}),
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--plugin-dir", str(mod),
        ]
        if role == "Door":
            argv += ["--tools", "Read,Grep,Glob,ToolSearch"]
        if cli_allow:
            argv += ["--allowedTools", "Bash(touch:*)"]
        row = {"role": role, "cliAllow": cli_allow, "argv": argv, "failures": []}
        master, slave = pty.openpty()
        try:
            program = subprocess.Popen(argv, cwd=project, env=env, stdin=slave,
                                       stdout=slave, stderr=slave, start_new_session=True)
        finally:
            os.close(slave)
        terminal = bytearray()
        deadline = time.monotonic() + timeout
        try:
            while not (project / "probe.done").exists():
                if program.poll() is not None:
                    row["failures"].append("vendor exited before the source replied")
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    row["failures"].append("interactive source timed out")
                    break
                ready, _, _ = select.select([master], [], [], min(remaining, 0.1))
                if ready:
                    try:
                        terminal.extend(os.read(master, 65536))
                        del terminal[:-4000]
                    except OSError as error:
                        row["failures"].append(f"PTY closed before the source replied: {error}")
                        break
            if (project / "probe.done").exists():
                try:
                    source = json.loads((project / "probe.json").read_text())
                    row["source"] = source
                    if not isinstance(source, dict):
                        raise ValueError("source must be an object")
                    checks = source.get("checks")
                    commands = ["echo hi", "touch x", "touch denied"]
                    if not isinstance(checks, list) or len(checks) != len(commands):
                        raise ValueError("source must contain the three requested checks")
                    for command, check in zip(commands, checks):
                        if not isinstance(check, dict) or check.get("command") != command:
                            raise ValueError("source check does not identify its requested command")
                        reply = check.get("reply")
                        error = check.get("error")
                        if error is not None:
                            if not isinstance(error, str) or not error or reply is not None:
                                raise ValueError("source check error must be a nonempty string without a reply")
                        elif not isinstance(reply, dict) or reply.get("decision") not in ("allow", "ask", "deny"):
                            raise ValueError("source check must contain an allow, ask or deny reply")
                    if (not isinstance(source.get("conversation"), str) or not source["conversation"]
                            or not isinstance(source.get("tools"), list)
                            or not all(isinstance(tool, str) for tool in source["tools"])):
                        raise ValueError("source must identify its conversation and tool list")
                    expected = ["allow", "allow" if cli_allow else "ask", "deny"]
                    actual = [check["reply"]["decision"] if check.get("error") is None else None
                              for check in checks]
                    row["expected"] = expected
                    row["actual"] = actual
                    if actual != expected:
                        row["failures"].append("native permission-only source differs from M15")
                    if source["interactive"] is not True or source["cwd"] != str(project):
                        row["failures"].append("source does not identify this interactive Project")
                    if ("Bash" in source["tools"]) != (role == "Agent"):
                        row["failures"].append("native Bash availability differs from F2")
                except (OSError, ValueError, KeyError, TypeError) as error:
                    row["failures"].append(f"malformed source response: {error}")
            else:
                row["startupOutput"] = terminal.decode(errors="replace")[-4000:]
            if (project / "x").exists() or (project / "denied").exists():
                row["failures"].append("a permission-only check executed its command")
        finally:
            # Only this fixture's child is interrupted, terminated or killed, then reaped.
            if program.poll() is None:
                os.write(master, b"\x03\x03")
                try:
                    program.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    program.terminate()
                    try:
                        program.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        program.kill()
                        program.wait(timeout=5)
            os.close(master)
            row["exit"] = program.returncode
        if row["exit"] != 0:
            row["failures"].append(f"vendor exited {row['exit']}")
        return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claude", default="claude")
    parser.add_argument("--timeout", type=float, default=25)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("--timeout must be positive")
    version = subprocess.run([args.claude, "--version"], text=True, capture_output=True,
                             timeout=args.timeout, check=True).stdout.strip()
    rows = [m15_interactive_source(args.claude, version, role, grant, args.timeout)
            for role in ("Agent", "Door") for grant in (False, True)]
    failed = any(row["failures"] for row in rows)
    print(json.dumps({
        "vendor": version, "comparisonExit": int(failed), "fixtures": rows,
        "coverage": "Native source only; no adapter implementation or MCP parity.",
        "remaining": ["live Attempt binding", "current mode distinct from configured default",
                      "user, Project, local and managed sources with source errors",
                      "next-call file edits, in-memory approvals and mode changes",
                      "adapter missing-source, exit, malformed-response and timeout handling"],
    }, indent=2))
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
