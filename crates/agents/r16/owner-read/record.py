"""Record a command's exit, complete output and binary hashes without hiding failures."""
import hashlib, json, os, pathlib, subprocess, sys
output = pathlib.Path(sys.argv[1]).resolve()
name = sys.argv[2]
command = sys.argv[3:]
output.mkdir(parents=True, exist_ok=True)
log = output / (name + '.log')
if log.exists():
    raise SystemExit('Refusing to overwrite: ' + str(log))
with log.open('w') as stream:
    result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT)
row = dict(name=name, command=command, cwd=os.getcwd(), exit=result.returncode,
           env={k:os.environ.get(k) for k in ['RUSTFLAGS','CARGO_BUILD_RUSTFLAGS','CARGO_TARGET_DIR','SHELL']},
           hashes={arg:hashlib.sha256(pathlib.Path(arg).read_bytes()).hexdigest() for arg in command if pathlib.Path(arg).is_file()},
           load=os.getloadavg())
with (output/'commands.jsonl').open('a') as stream:
    stream.write(json.dumps(row)+'\n')
print(json.dumps(row))
raise SystemExit(result.returncode)
