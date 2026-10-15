"""Run an unchanged command with privileged, bounded Chromium fault evidence.

The kernel captures each blocked fault before browser teardown, including BTF
backing-file identity and the wait stack. Live pending reports wait 100 ms to
avoid flooding CI with ordinary disk reads; capture itself has no age filter.
Keep at most 1024 active faults and the longest 128 completed faults. Publish
at most 256 live fault pairs, plus the bounded final retained evidence. Every
limit or tracer failure is explicit and never changes the command's result.
"""
import argparse
import datetime
import heapq
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    command = options.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("a command is required")
    log = None
    log_error = None
    if options.log:
        try:
            log = options.log.open("w")
        except OSError as error:
            log_error = str(error)
    output_lock = threading.Lock()
    output_enabled = True

    def publish(event):
        nonlocal log, output_enabled
        with output_lock:
            value = json.dumps(event)
            if log:
                try:
                    log.write(value + "\n")
                    log.flush()
                except OSError as error:
                    log = None
                    if output_enabled:
                        print(json.dumps({"status": "error", "detail": f"fault log write: {error}"}), flush=True)
            if output_enabled:
                try:
                    print(value, flush=True)
                except BrokenPipeError:
                    output_enabled = False

    if log_error:
        publish({"status": "error", "detail": f"fault log unavailable: {log_error}"})

    # The pipe gates exec, not browser readiness. All probes attach before the
    # unchanged command runs with the caller's uid, environment and arguments.
    read_fd, write_fd = os.pipe()
    gate = "import os,sys; os.read(int(sys.argv[1]),1); os.close(int(sys.argv[1])); os.execvp(sys.argv[2],sys.argv[2:])"
    child = subprocess.Popen([sys.executable, "-c", gate, str(read_fd), *command], pass_fds=(read_fd,))
    os.close(read_fd)
    ready = threading.Event()
    condition = threading.Condition()
    attached = False
    stopped = False
    tracer = None
    readers = []
    pending = {}
    longest = []
    reports = 0
    diagnostics = 0
    active_limit = False

    def retain(data):
        nonlocal active_limit
        header, basename, stack = data.split("\n", 2)
        fields = header.split()
        status = fields[0].lower()
        pid, tid, address, offset, entry, start, end, map_offset, inode, device = map(int, fields[1:11])
        event = {"status": status, "pid": pid, "tid": tid, "address": address, "offset": offset, "entry_ns": entry, "vma_start": start, "vma_end": end, "vma_offset": map_offset, "inode": inode, "device": device, "file_basename": basename}
        key = (tid, entry)
        if status == "pending":
            event["stack"] = stack[:8192]
            try:
                # Resolve only the faulted data address. Kernel VMA, inode,
                # device and basename survive even an immediate unmap/exit.
                mapping = "mapping no longer present"
                with open(f"/proc/{pid}/maps") as maps:
                    for row in maps:
                        bounds = row.split()[0].split("-")
                        if int(bounds[0], 16) <= address < int(bounds[1], 16):
                            mapping = row.strip()[:4096]
                            break
                event["mapping"] = mapping
            except OSError as error:
                event["mapping"] = f"unavailable: {error}"
            with condition:
                if len(pending) < 1024:
                    pending[key] = event
                    condition.notify_all()
                elif not active_limit:
                    active_limit = True
                    publish({"status": "error", "detail": "1024 simultaneous pending fault limit reached"})
        else:
            event["duration_ns"] = int(fields[11])
            event["return"] = int(fields[12])
            with condition:
                prior = pending.pop(key, None)
                if prior:
                    event.update(mapping=prior["mapping"], stack=prior["stack"])
                    if prior.pop("reported", False):
                        publish(event)
                item = (event["duration_ns"], entry, tid, event)
                if len(longest) < 128:
                    heapq.heappush(longest, item)
                else:
                    heapq.heappushpop(longest, item)
                condition.notify_all()

    def consume():
        nonlocal attached, diagnostics
        try:
            for raw in tracer.stdout:
                if not raw.strip():
                    continue
                message = json.loads(raw)
                if message.get("type") == "attached_probes":
                    continue
                if message.get("type") != "printf":
                    if diagnostics < 16:
                        publish({"status": "error", "detail": str(message)[:2048]})
                        diagnostics += 1
                    continue
                data = message["data"]
                if data == "READY\n":
                    attached = True
                    publish({"status": "attached", "root_pid": child.pid, "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "clock": "kernel monotonic ns", "monotonic_ns": time.monotonic_ns(), "page_size": os.sysconf("SC_PAGE_SIZE")})
                    ready.set()
                elif data.startswith(("PENDING ", "COMPLETED ")):
                    retain(data)
                else:
                    publish({"status": "error", "detail": data[:2048]})
        except (ValueError, KeyError, IndexError, TypeError, OSError) as error:
            publish({"status": "error", "detail": f"tracer stream: {error}"})
        finally:
            if not attached:
                publish({"status": "error", "detail": "fault observer did not attach: permission, BTF or kernel probe support failure"})
            elif child.poll() is None:
                publish({"status": "error", "detail": "fault tracer stopped while the command was still running"})
            ready.set()

    def stderr():
        for number, raw in enumerate(tracer.stderr):
            if number < 16:
                publish({"status": "error" if any(word in raw for word in ("ERROR", "error:", "Lost")) else "diagnostic", "detail": raw[:2048].strip()})

    def announce():
        nonlocal reports
        with condition:
            while not stopped:
                due = [event for event in pending.values() if not event.get("reported") and not event.get("quiet")]
                now = time.monotonic_ns()
                for event in due:
                    if now - event["entry_ns"] >= 100_000_000:
                        if reports < 256:
                            publish(event)
                            event["reported"] = True
                            reports += 1
                        elif reports == 256:
                            publish({"status": "error", "detail": "live report cap reached; active faults and longest completions remain retained"})
                            reports += 1
                        if reports > 256:
                            event["quiet"] = True
                deadline = min((event["entry_ns"] + 100_000_000 for event in due), default=now + 1_000_000_000)
                # This timer reduces reporting noise; tests coordinate on the
                # report acknowledgement, never a sleep or a Chrome delay.
                condition.wait(max(0.001, (deadline - time.monotonic_ns()) / 1e9))

    def interrupted(signum, _frame):
        # Cancellation targets this run's command, never a host browser.
        if child.poll() is None:
            child.send_signal(signum)

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    result = 1
    try:
        tracer = subprocess.Popen(["sudo", "-n", "--", "env", "BPFTRACE_MAX_MAP_KEYS=4096", "BPFTRACE_PERF_RB_PAGES=64", "timeout", "--signal=INT", "--kill-after=5s", "15m", "bpftrace", "-k", "-f", "json", "-B", "line", str(HERE / "faults.bt"), str(child.pid), str(os.sysconf("SC_PAGE_SIZE"))], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        readers = [threading.Thread(target=target, daemon=True) for target in (consume, stderr, announce)]
        for reader in readers:
            reader.start()
        if not ready.wait(45):
            publish({"status": "error", "detail": "fault observer attachment exceeded 45 seconds"})
        os.write(write_fd, b"G")
        os.close(write_fd)
        write_fd = None
        result = child.wait()
    except OSError as error:
        publish({"status": "error", "detail": f"fault observer launch: {error}"})
        if write_fd is not None:
            os.write(write_fd, b"G")
            os.close(write_fd)
            write_fd = None
        result = child.wait()
    finally:
        if write_fd is not None:
            os.close(write_fd)
        if tracer and tracer.poll() is None:
            # sudo forwards to the timeout supervisor, which owns only this
            # tracer. Its 15-minute watchdog also bounds a lost control channel.
            try:
                subprocess.run(["sudo", "-n", "kill", "-INT", str(tracer.pid)], timeout=5, check=False)
                tracer.wait(timeout=10)
            except (OSError, subprocess.TimeoutExpired) as error:
                publish({"status": "error", "detail": f"tracer cleanup: {error}; its watchdog remains bounded to 15 minutes"})
        with condition:
            stopped = True
            condition.notify_all()
        for reader in readers:
            reader.join(timeout=5)
        if tracer:
            if all(not reader.is_alive() for reader in readers):
                tracer.stdout.close()
                tracer.stderr.close()
            if attached and tracer.returncode != 0:
                publish({"status": "error", "detail": f"fault observer exited {tracer.returncode}"})
        with condition:
            retained_pending = list(pending.values())
            retained_completed = list(longest)
        for event in retained_pending:
            event.pop("reported", None)
            event.pop("quiet", None)
            publish(event)
        for _, _, _, event in sorted(retained_completed, reverse=True):
            publish(event)
        publish({"status": "finished", "command_status": result, "still_pending": len(retained_pending), "completed_retained": len(retained_completed)})
        closing_error = None
        with output_lock:
            if log:
                try:
                    log.close()
                except OSError as error:
                    closing_error = str(error)
                log = None
        if closing_error:
            publish({"status": "error", "detail": f"fault log close: {closing_error}"})
    if result < 0:
        # SIGKILL cannot have a handler; every terminating signal still has
        # to reach the caller as a signal rather than a fabricated exit code.
        if -result != signal.SIGKILL:
            signal.signal(-result, signal.SIG_DFL)
        os.kill(os.getpid(), -result)
    return result


if __name__ == "__main__":
    sys.exit(main())
