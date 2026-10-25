"""L23: the clock of a Builder run's engine phase: one wall-clock deadline for Codex and Claude Code together, and an idle
limit on each child, so a run ends in time for `keep` to push what it committed."""
import contextlib
import os
import signal
import threading
import time

ENGINE_SECONDS = 25 * 60
IDLE_SECONDS = 10 * 60
# L23: no Claude Code shell command runs past ten minutes, so one hung command cannot hold the engine's clock.
BASH_LIMITS = {'BASH_DEFAULT_TIMEOUT_MS': '600000', 'BASH_MAX_TIMEOUT_MS': '600000'}
# The monotonic time the engine phase ends: `builder.py engine` runs at once on start, so its process start is the engine's.
ends = time.monotonic() + ENGINE_SECONDS


def lines(run, stop=None, idle=IDLE_SECONDS):
    """The stdout lines of the Popen `run`, which must lead its own process group. Kills the group when the monotonic time
    `stop` (none: no limit) passes or `idle` seconds go by with no line, after one `::warning::` naming which."""
    def kill(why):
        print(f'::warning::engine killed: {why}', flush=True)
        with contextlib.suppress(ProcessLookupError):
            os.killpg(run.pid, signal.SIGKILL)
    clock = threading.Timer(max(0, stop - time.monotonic()), kill, ['deadline passed']) if stop else None
    quiet = None
    try:
        if clock:
            clock.start()
        for line in iter(run.stdout.readline, ''):
            if quiet:
                quiet.cancel()
            quiet = threading.Timer(idle, kill, [f'no output for {idle} s'])
            quiet.start()
            yield line
    finally:
        for timer in (clock, quiet):
            if timer:
                timer.cancel()
