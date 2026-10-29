#!/usr/bin/env python3
"""S1/A12a: observe an extracted Tauri bundle, never assemble an App tree."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="roundup-bundle-") as folder:
    extracted = Path(folder) / source.name
    shutil.copytree(source, extracted, symlinks=True)
    binaries = extracted / "Contents/MacOS"
    for name in ["roundup", "rupd", "rup", "terminal-owner", "sidecar/node"]:
        binary = binaries / name
        if (not binary.is_file() or not os.access(binary, os.X_OK)
                or not binary.resolve().is_relative_to(extracted)):
            raise SystemExit(f"missing executable: {binary}")
    sidecar = binaries / "sidecar"
    for path in sidecar.rglob("*"):
        if path.is_symlink() and not path.resolve().is_relative_to(extracted):
            raise SystemExit(f"sidecar depends on an external file: {path}")
    for name in ["list.mjs", "package.json", "NOTICES.md", "NODE-LICENSE",
                 "node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md"]:
        if not (sidecar / name).is_file():
            raise SystemExit(f"missing sidecar file: {name}")
    version = subprocess.check_output([sidecar / "node", "--version"], text=True).strip()
    if version != "v22.23.3":
        raise SystemExit(f"unexpected Node runtime: {version}")
    print(f"pinned Node: {version}", flush=True)
    # Import from the extracted module tree with the bundled runtime, not the checkout.
    subprocess.run([sidecar / "node", "--input-type=module", "-e",
                    "import {listSessions} from '@anthropic-ai/claude-agent-sdk';"
                    "if(typeof listSessions !== 'function') process.exit(1)"],
                   cwd=sidecar, check=True)
    print(json.dumps({"executables": str(binaries), "sidecar": "SDK import passed"}), flush=True)
    environment = os.environ.copy()
    for name in ["ROUNDUP_RUPD_BIN", "ROUNDUP_RUP_BIN", "ROUNDUP_SIDECAR_DIR",
                 "RUPD_TERMINAL_OWNER"]:
        environment.pop(name, None)
    environment["ROUNDUP_TEST_APP_BIN"] = str(binaries)
    subprocess.run([
        "cargo", "nextest", "run", "-p", "desktop", "-p", "terminal", "-p", "rup",
        "--test", "a12a", "--test", "durable_owner", "--test", "reopen", "-E",
        "binary(a12a) | binary(reopen) | test(=x8_reconnecting_keeps_the_original_program)",
    ], env=environment, check=True)
