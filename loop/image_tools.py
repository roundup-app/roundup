"""L121: what the boxd image gives a run besides its programs: the owner's instructions and the code index."""
import shutil
import subprocess
from pathlib import Path


def codex_files(home):
    """Copy the image's Codex instructions, `~/.codex/AGENTS.md` when it exists, into the Codex home `home`, the only place
    a run's Codex reads them, and return the `config.toml` text that gives it the codegraph MCP server when `codegraph`
    is on PATH, else ''."""
    instructions = Path.home() / '.codex/AGENTS.md'
    if instructions.is_file():
        shutil.copyfile(instructions, home / 'AGENTS.md')
    return '\n[mcp_servers.codegraph]\ncommand = "codegraph"\nargs = ["serve", "--mcp"]\n' if shutil.which('codegraph') else ''


def sync_index():
    """Bring the codegraph index of the current directory, when it has one and `codegraph` is installed, up to date. A
    failed sync warns and the run goes on with the older index: the index helps, it does not gate."""
    if not Path('.codegraph').is_dir() or not shutil.which('codegraph'):
        return
    try:
        subprocess.run(['codegraph', 'sync', '.'], check=True, capture_output=True, text=True, timeout=300)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f'::warning::codegraph sync failed, the run goes on with the older index: {error}')
