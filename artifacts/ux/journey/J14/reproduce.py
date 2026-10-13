"""Run J14's recorded observer through capture ownership, restoring temporary files."""
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[4]
desktop = root / "apps/desktop"
source = desktop / "src/testing/j14_audit.test.ts"
package = desktop / "package.json"
if source.exists():
    raise SystemExit("temporary observer already exists; move it before reproducing")
original = package.read_bytes()
try:
    source.write_bytes(pathlib.Path(__file__).with_name("observer.ts.txt").read_bytes())
    body = json.loads(original)
    body["scripts"]["test"] = "vitest run src/testing/j14_audit.test.ts --reporter=default"
    package.write_text(json.dumps(body, indent=2) + "\n")
    result = subprocess.run(["just", "capture", "J14"], cwd=root, check=False)
finally:
    package.write_bytes(original)
    source.unlink()
raise SystemExit(result.returncode)
