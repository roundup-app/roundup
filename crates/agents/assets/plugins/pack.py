#!/usr/bin/env python3
"""Reproduce the bundle from a local checkout; never used at Agent startup."""
import gzip
import hashlib
import json
import pathlib
import subprocess
import sys

PIN = "595eda0e3b477d1af1daad82f395073d4f912c8d"
source = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).parent
files = subprocess.check_output(
    ["git", "-C", str(source), "ls-tree", "-r", PIN, "hope", "hunch", "hold", "LICENSE"],
    text=True,
).splitlines()
assets = []
for row in files:
    metadata, path = row.split("\t")
    mode, kind, blob = metadata.split()
    assert kind == "blob" and mode in ("100644", "100755"), row
    content = subprocess.check_output(["git", "-C", str(source), "cat-file", "blob", blob])
    assets.append(dict(path=path, mode=int(mode[-3:], 8), sha256=hashlib.sha256(content).hexdigest(),
                       blob=blob, content=content.decode("utf-8")))
bundle = dict(repository="https://github.com/saadshahd/moo.md", commit=PIN, assets=assets)
encoded = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode()
packed = gzip.compress(encoded, compresslevel=9, mtime=0)
(out / "moo.json.gz").write_bytes(packed)
(out / "moo.sha256").write_text(hashlib.sha256(packed).hexdigest() + "\n")
(out / "inventory.tsv").write_text("path\tgit-mode\tgit-blob\tsha256\n" + "".join(
    f'{a["path"]}\t{a["mode"]:03o}\t{a["blob"]}\t{a["sha256"]}\n' for a in assets))
print(f"{len(assets)} pinned files, {len(packed)} compressed bytes")
