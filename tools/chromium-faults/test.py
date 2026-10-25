"""U26: a kernel file fault, held by libfuse until the observer sees it."""
from contextlib import contextmanager
import ctypes
import json
import os
from pathlib import Path
import select
import selectors
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent


def line(stream):
    value = bytearray()
    deadline = time.monotonic() + 30
    with selectors.DefaultSelector() as selector:
        selector.register(stream, selectors.EVENT_READ)
        while len(value) < 32768:
            if not selector.select(max(0, deadline - time.monotonic())):
                raise AssertionError("missing pipe acknowledgement")
            byte = os.read(stream.fileno(), 1)
            if not byte:
                raise AssertionError("pipe closed before acknowledgement")
            if byte == b"\n":
                return value.decode()
            value.extend(byte)
    raise AssertionError("oversized pipe acknowledgement")


@contextmanager
def file_fixture():
    with tempfile.TemporaryDirectory(prefix="u26-fault-") as directory:
        root = Path(directory)
        binary = root / "chrome"
        flags = subprocess.check_output(["pkg-config", "--cflags", "--libs", "fuse3"], text=True, timeout=10).split()
        subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", str(HERE / "held-file.c"), "-o", str(binary), *flags], check=True, timeout=30)
        mount = root / "mount"
        mount.mkdir()
        yield root, binary, mount


def held_command(binary, mount, endpoint, pressure=""):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.connect(endpoint)
        control = connection.makefile("r", buffering=1)
        send = lambda value: connection.sendall(value.encode())
        fuse = subprocess.Popen([binary, mount], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        reader = None
        try:
            assert line(fuse.stdout) == "MOUNTED"
            reader = subprocess.Popen([binary, "read", mount + "/held"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
            send(line(reader.stdout) + "\n")
            if pressure:
                assert line(control) == "B"
                subprocess.run([binary, "burst", pressure], check=True, timeout=60, stdout=subprocess.DEVNULL)
                send("BURST\n")
            assert line(control) == "G"
            reader.stdin.write("G\n")
            reader.stdin.flush()
            assert line(fuse.stdout) == "HELD"
            send("HELD\n")
            if pressure:
                for _ in range(2):
                    assert line(control) == "B"
                    subprocess.run([binary, "burst", pressure], check=True, timeout=60, stdout=subprocess.DEVNULL)
                    send("BURST\n")
            assert line(control) == "R"
            fuse.stdin.write("R\n")
            fuse.stdin.flush()
            send(line(reader.stdout) + "\n")
            assert reader.wait(timeout=10) == 0
            if pressure:
                send("EXITED\n")
            assert line(control) == "END"
        finally:
            fuse.stdin.write("R\n")
            fuse.stdin.flush()
            if reader and reader.poll() is None:
                reader.kill()
                reader.wait(timeout=10)
            subprocess.run(["fusermount3", "-u", mount], check=True, timeout=10)
            fuse.wait(timeout=10)
            fuse.stdin.close()
            fuse.stdout.close()
            if reader:
                reader.stdin.close()
                reader.stdout.close()
            control.close()


@contextmanager
def artifact_watch(path):
    # Linux inotify acknowledges artifact writes without a polling sleep.
    libc = ctypes.CDLL(None, use_errno=True)
    descriptor = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    if descriptor < 0:
        raise OSError(ctypes.get_errno(), "inotify_init1")
    try:
        path.touch()
        if libc.inotify_add_watch(descriptor, os.fsencode(path), 2) < 0:  # IN_MODIFY
            raise OSError(ctypes.get_errno(), "inotify_add_watch")
        yield descriptor
    finally:
        os.close(descriptor)


def fill_pipe(descriptor):
    written = 0
    block = b"X" * 4096
    while True:
        try:
            written += os.write(descriptor, block)
        except BlockingIOError:
            if len(block) > 1:
                block = b"X"
            else:
                assert written > 0
                return


class FaultTest(unittest.TestCase):
    def test_u26_consumer_hold_preserves_fault_identity_and_lifecycle(self):
        # Both generations run actual filemap_fault probes. Stop only bpftrace's
        # userspace consumer; its attached kernel programs continue on one CPU.
        with file_fixture() as (root, binary, mount):
            with socket.socket(socket.AF_UNIX) as listener, artifact_watch(root / "trace.jsonl") as watch:
                listener.bind(str(root / "control"))
                listener.listen(1)
                listener.settimeout(60)
                observer = subprocess.Popen(["taskset", "-c", str(min(os.sched_getaffinity(0))), sys.executable, str(HERE / "observe.py"), "--log", str(root / "trace.jsonl"), "--", sys.executable, __file__, "held", str(binary), str(mount), str(root / "control"), str(root / "burst")], stdout=subprocess.DEVNULL)
                tracer_pid = None
                try:
                    connection, _ = listener.accept()
                    with connection, connection.makefile("r", buffering=1) as control:
                        send = lambda value: connection.sendall(value.encode())
                        mapped = line(control).split()
                        pid, tid, address = int(mapped[1]), int(mapped[2]), int(mapped[3], 16)
                        descendants = [observer.pid]
                        for parent in descendants:
                            children = Path(f"/proc/{parent}/task/{parent}/children").read_text().split()
                            descendants.extend(map(int, children))
                        backing = (mount / "held").stat()
                        tracer_pid = next(pid for pid in descendants if Path(f"/proc/{pid}/comm").read_text().strip() == "bpftrace")

                        def stop_consumer():
                            subprocess.run(["sudo", "-n", "kill", "-STOP", str(tracer_pid)], check=True, timeout=5)
                            # waitid cannot reap a non-child: /proc is the
                            # independent acknowledgement of the stop signal.
                            # kill returns once SIGSTOP is queued; the thread
                            # group stops when the target next runs, so poll
                            # until it does and fail with the last state.
                            deadline = time.monotonic() + 10
                            while True:
                                state = Path(f"/proc/{tracer_pid}/status").read_text()
                                if "T (stopped)" in state or time.monotonic() >= deadline:
                                    break
                                time.sleep(0.01)
                            self.assertIn("T (stopped)", state)

                        def resume_consumer():
                            subprocess.run(["sudo", "-n", "kill", "-CONT", str(tracer_pid)], check=True, timeout=5)

                        stop_consumer()
                        send("B\n")
                        self.assertEqual(line(control), "BURST")
                        send("G\n")
                        self.assertEqual(line(control), "HELD")
                        resume_consumer()
                        pending = self.artifact_event(root / "trace.jsonl", watch, "pending", tid, address)
                        self.assertEqual(pending["pid"], pid)
                        self.assertEqual(pending["file_basename"], "held")
                        self.assertEqual(pending["inode"], backing.st_ino)
                        # FUSE has acknowledged the held read, and no VALUE
                        # acknowledgement can exist before the separate release.
                        self.assertFalse(select.select([connection], [], [], 0)[0])
                        stop_consumer()
                        send("B\n")
                        self.assertEqual(line(control), "BURST")
                        burst_done = time.monotonic_ns()
                        resume_consumer()
                        snapshot = self.artifact_event(root / "trace.jsonl", watch, "live_snapshot", None, after_ns=burst_done)
                        self.assertTrue(snapshot["kernel_integrity"])
                        self.assertIn([tid, pending["entry_ns"]], snapshot["pending"])
                        # Fill again before completion so its notification,
                        # too, must survive loss or be reconciled independently.
                        stop_consumer()
                        send("B\n")
                        self.assertEqual(line(control), "BURST")
                        send("R\n")
                        self.assertEqual(line(control), "VALUE Q")
                        self.assertEqual(line(control), "EXITED")
                        self.assertFalse(Path(f"/proc/{tid}").exists())
                        resume_consumer()
                        send("END\n")
                        self.assertEqual(observer.wait(timeout=30), 37)
                        events = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                        self.assertEqual(events[-1]["still_pending"], 0, events[-1])
                        self.assertTrue(events[-1]["live_state_verified"], [event for event in events if event["status"] in ("error", "finished")])
                        self.assertFalse(events[-1]["history_complete"])
                        self.assertTrue(any("lost_events" in event.get("detail", "") for event in events))
                        self.assertTrue(any(event.get("tid") == tid and event.get("entry_ns") == pending["entry_ns"] and event.get("status") in ("completed", "terminated") for event in events))
                finally:
                    if tracer_pid and Path(f"/proc/{tracer_pid}").exists():
                        subprocess.run(["sudo", "-n", "kill", "-CONT", str(tracer_pid)], timeout=5, check=False)
                    if observer.poll() is None:
                        # Closing control lets the fixture release FUSE before
                        # terminating its supervisor could orphan the mount.
                        try:
                            observer.wait(timeout=30)
                        except subprocess.TimeoutExpired:
                            observer.terminate()
                            observer.wait(timeout=30)

    def test_u26_pending_file_fault_survives_until_completed(self):
        self.held_fault(None)

    def test_u26_full_stdout_at_attachment_preserves_capture_and_exit(self):
        self.held_fault("attachment")

    def test_u26_full_stdout_during_capture_preserves_fault_completion(self):
        self.held_fault("capture")

    def test_u26_full_stdout_at_final_reporting_preserves_exit(self):
        self.held_fault("final")

    def held_fault(self, backpressure):
        with file_fixture() as (root, binary, mount):
            with socket.socket(socket.AF_UNIX) as listener, artifact_watch(root / "trace.jsonl") as watch:
                listener.bind(str(root / "control"))
                listener.listen(1)
                listener.settimeout(30)
                read_fd, write_fd = os.pipe2(os.O_NONBLOCK | os.O_CLOEXEC)
                if backpressure == "attachment":
                    fill_pipe(write_fd)
                observer = subprocess.Popen([sys.executable, str(HERE / "observe.py"), "--log", str(root / "trace.jsonl"), "--", sys.executable, __file__, "held", str(binary), str(mount), str(root / "control")], stdout=write_fd if backpressure else subprocess.PIPE, text=True, bufsize=1)
                event = lambda status, tid, address=None: self.artifact_event(root / "trace.jsonl", watch, status, tid, address) if backpressure else self.event(observer.stdout, status, tid, address)
                outsider = None
                control = None
                try:
                    connection, _ = listener.accept()
                    with connection:
                        control = connection.makefile("r", buffering=1)
                        send = lambda value: connection.sendall(value.encode())
                        mapped = line(control).split()
                        self.assertEqual(mapped[0], "MAPPED")
                        pid, tid, address = int(mapped[1]), int(mapped[2]), int(mapped[3], 16)
                        if backpressure == "capture":
                            fill_pipe(write_fd)
                        outsider = subprocess.Popen([str(binary), "read", str(mount / "held")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
                        outside = line(outsider.stdout).split()
                        outside_pid = int(outside[1])
                        outsider.stdin.write("G\n")
                        outsider.stdin.flush()
                        send("G\n")
                        self.assertEqual(line(control), "HELD")
                        pending = event("pending", tid, address)
                        live = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                        self.assertTrue(any(event.get("status") == "pending" and event.get("tid") == tid for event in live))
                        self.assertEqual(pending["pid"], pid)
                        self.assertEqual(pending["address"], address)
                        self.assertEqual(pending["offset"], 4096)
                        self.assertIn(str(mount / "held"), pending["mapping"])
                        self.assertGreater(pending["entry_ns"], 0)
                        backing = (mount / "held").stat()
                        self.assertEqual(pending["inode"], backing.st_ino)
                        # Linux s_dev uses dev_t's kernel encoding, not libc st_dev.
                        self.assertEqual(pending["device"], (os.major(backing.st_dev) << 20) | os.minor(backing.st_dev))
                        self.assertEqual(pending["file_basename"], "held")
                        self.assertIn("filemap_fault", pending["stack"])
                        self.assertIn("folio_wait_bit_common", pending["stack"])
                        # Independently prove the reader has not completed its real load.
                        self.assertIn("D (disk sleep)", Path(f"/proc/{tid}/status").read_text())
                        self.assertIn("D (disk sleep)", Path(f"/proc/{outside_pid}/status").read_text())
                        if backpressure in ("attachment", "capture"):
                            loss = self.artifact_event(root / "trace.jsonl", watch, "error", None)
                            self.assertIn("stdout disabled", loss["detail"])
                        held_until_ns = time.monotonic_ns()
                        send("R\n")
                        self.assertEqual(line(control), "VALUE Q")
                        self.assertEqual(line(outsider.stdout), "VALUE Q")
                        self.assertEqual(outsider.wait(timeout=10), 0)
                        completed = event("completed", tid, address)
                        self.assertEqual(completed["entry_ns"], pending["entry_ns"])
                        self.assertEqual(completed["address"], address)
                        self.assertGreaterEqual(completed["duration_ns"], held_until_ns - pending["entry_ns"])
                        if backpressure == "final":
                            fill_pipe(write_fd)
                        send("END\n")
                        finished = event("finished", None)
                        self.assertEqual(finished["command_status"], 37)
                        self.assertEqual(finished["still_pending"], 0)
                    self.assertEqual(observer.wait(timeout=30), 37)
                    events = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                    self.assertFalse(any(event.get("pid") == outside_pid for event in events))
                    self.assertEqual(events[-1]["command_status"], 37)
                    if backpressure:
                        self.assertEqual(sum(item.get("status") == "error" and "stdout disabled" in item.get("detail", "") for item in events), 1)
                        self.assertFalse(any("tracer stream:" in item.get("detail", "") or "stopped while" in item.get("detail", "") for item in events))
                finally:
                    if control:
                        control.close()
                    if observer.poll() is None:
                        observer.wait(timeout=30)
                    if observer.stdout:
                        observer.stdout.close()
                    os.close(read_fd)
                    os.close(write_fd)
                    if outsider:
                        if outsider.poll() is None:
                            outsider.kill()
                            outsider.wait(timeout=10)
                        outsider.stdin.close()
                        outsider.stdout.close()

    def test_u26_teardown_retains_a_fault_that_is_still_in_flight(self):
        self.teardown_fault(False)

    def test_u26_tracer_death_invalidates_unmatched_live_fault_evidence(self):
        self.teardown_fault(True)

    def teardown_fault(self, tracer_death):
        with file_fixture() as (root, binary, mount):
            fuse = subprocess.Popen([str(binary), str(mount)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
            observer = None
            reader_tid = None
            try:
                self.assertEqual(line(fuse.stdout), "MOUNTED")
                observer = subprocess.Popen([sys.executable, str(HERE / "observe.py"), "--log", str(root / "trace.jsonl"), "--", str(binary), "read", str(mount / "held")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
                attached = self.event(observer.stdout, "attached", None)
                mapped = line(observer.stdout).split()
                self.assertEqual(mapped[0], "MAPPED")
                reader_tid = int(mapped[2])
                observer.stdin.write("G\n")
                observer.stdin.flush()
                self.assertEqual(line(fuse.stdout), "HELD")
                pending = self.event(observer.stdout, "pending", reader_tid, int(mapped[3], 16))
                if tracer_death:
                    # Kill only this run's tracer after the held fault's live
                    # acknowledgement. No final kernel snapshot can follow.
                    descendants = [observer.pid]
                    for parent in descendants:
                        descendants.extend(map(int, Path(f"/proc/{parent}/task/{parent}/children").read_text().split()))
                    tracer_pid = next(pid for pid in descendants if Path(f"/proc/{pid}/comm").read_text().strip() == "bpftrace")
                    subprocess.run(["sudo", "-n", "kill", "-KILL", str(tracer_pid)], check=True, timeout=5)
                # Kill only the command's waiting leader. Its renamed reader
                # remains in the real kernel fault while the tracer tears down.
                os.kill(attached["root_pid"], 15)
                if tracer_death:
                    self.assertEqual(observer.wait(timeout=30), -15)
                    events = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                    finished = events[-1]
                else:
                    finished = self.event(observer.stdout, "finished", None)
                self.assertEqual(observer.wait(timeout=30), -15)
                self.assertEqual(finished["still_pending"], 0 if tracer_death else 1)
                self.assertEqual(finished["live_state_verified"], not tracer_death)
                if tracer_death:
                    self.assertFalse(finished["history_complete"])
                    self.assertEqual(finished["unverified_pending"], 1)
                self.assertIn("D (disk sleep)", Path(f"/proc/{reader_tid}/status").read_text())
                events = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                retained = [event for event in events if event.get("tid") == reader_tid and event.get("status") == ("unverified" if tracer_death else "pending")]
                self.assertEqual(len(retained), 1 if tracer_death else 2)  # live and final evidence
                self.assertEqual(retained[-1]["entry_ns"], pending["entry_ns"])
                self.assertEqual(retained[-1]["address"], int(mapped[3], 16))
                self.assertIn(str(mount / "held"), retained[-1]["mapping"])
                fuse.stdin.write("R\n")
                fuse.stdin.flush()
                value = line(observer.stdout)
                while tracer_death and value.startswith("{"):
                    value = line(observer.stdout)
                self.assertEqual(value, "VALUE Q")
            finally:
                fuse.stdin.write("R\n")
                fuse.stdin.flush()
                if observer:
                    if observer.poll() is None:
                        observer.terminate()
                        observer.wait(timeout=30)
                    observer.stdin.close()
                    observer.stdout.close()
                subprocess.run(["fusermount3", "-u", str(mount)], check=True, timeout=10)
                fuse.wait(timeout=10)
                fuse.stdin.close()
                fuse.stdout.close()

    def test_u26_a_completion_that_trails_the_snapshot_missing_it_is_still_reported(self):
        # bpftrace reads a printed map when userspace handles it, but a printf
        # crosses per-CPU buffers: a snapshot can precede the COMPLETED record
        # of a fault it no longer lists. This stands in for sudo and bpftrace.
        tracer = r"""#!/usr/bin/env python3
import json, os, signal, sys, time
def printf(text): print(json.dumps({"type": "printf", "data": text}), flush=True)
def snapshot(opening, closing, live, stack):
    printf(opening)
    for name, data in (("@live", {"0": [0] * 9 + [""], **live}), ("@stack", stack), ("@integrity", 0)):
        print(json.dumps({"type": "map", "data": {name: data}}), flush=True)
    printf(closing)
if "bpftrace" not in sys.argv:
    arguments = sys.argv[2:] if sys.argv[1] == "-n" else sys.argv[1:]
    os.execvp(arguments[0], arguments)
tid, entry = int(sys.argv[-2]), time.monotonic_ns()
done = []
signal.signal(signal.SIGTERM, lambda *_: done.append(1))
printf("READY\n")
snapshot("SNAPSHOT\n", "SNAPSHOT_END\n", {str(tid): [tid, 4096, 4096, entry, 4096, 8192, 4096, 2, 49, "held"]}, {f"{tid},{entry}": "folio_wait_bit_common+307"})
time.sleep(0.5)
snapshot("SNAPSHOT\n", "SNAPSHOT_END\n", {}, {})
printf(f"COMPLETED {tid} {tid} 4096 4096 {entry} 4096 8192 4096 2 49 500000000 0\nheld\n")
while not done: time.sleep(0.01)
snapshot("FINAL\n", "FINAL_END\n", {}, {})
"""
        with tempfile.TemporaryDirectory(prefix="u26-trailing-completion-") as directory:
            fake = Path(directory) / "sudo"
            fake.write_text(tracer)
            fake.chmod(0o755)
            log = Path(directory) / "trace.jsonl"
            result = subprocess.run([sys.executable, str(HERE / "observe.py"), "--log", str(log), "--", sys.executable, "-c", "import time; time.sleep(2)"], env=dict(os.environ, PATH=f"{directory}:{os.environ['PATH']}"), capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            events = [json.loads(row) for row in log.read_text().splitlines()]
            lifecycle = [event["status"] for event in events if "entry_ns" in event]
            self.assertEqual(lifecycle, ["pending", "resolved", "completed", "completed"], events)  # live and final evidence
            self.assertEqual(events[-1]["still_pending"], 0)

    def test_u26_tracer_launch_failure_preserves_the_command_exit(self):
        with tempfile.TemporaryDirectory(prefix="u26-no-tracer-") as directory:
            environment = dict(os.environ, PATH=directory)
            result = subprocess.run([sys.executable, str(HERE / "observe.py"), "--", sys.executable, "-c", "import sys; sys.exit(39)"], env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 39)
            events = [json.loads(row) for row in result.stdout.splitlines()]
            self.assertTrue(any(event["status"] == "error" for event in events))
            self.assertEqual(events[-1]["command_status"], 39)

    def test_u26_reporting_failures_do_not_prevent_command_execution(self):
        with tempfile.TemporaryDirectory(prefix="u26-report-failure-") as directory:
            read_fd, write_fd = os.pipe2(os.O_NONBLOCK | os.O_CLOEXEC)
            try:
                fill_pipe(write_fd)
                marker = Path(directory) / "ran"
                result = subprocess.run([sys.executable, str(HERE / "observe.py"), "--log", "/dev/full", "--", sys.executable, "-c", "import pathlib,sys; pathlib.Path(sys.argv[1]).touch(); sys.exit(37)", str(marker)], env=dict(os.environ, PATH=directory), stdout=write_fd, stderr=subprocess.PIPE, timeout=10)
                self.assertTrue(marker.exists())
                self.assertEqual(result.returncode, 37, result.stderr)
                self.assertNotIn(b"Traceback", result.stderr)
            finally:
                os.close(read_fd)
                os.close(write_fd)

    def test_u26_a_signalled_command_preserves_its_signal_without_tracing(self):
        with tempfile.TemporaryDirectory(prefix="u26-no-tracer-") as directory:
            for signum in (signal.SIGTERM, signal.SIGKILL):
                with self.subTest(signal=signum):
                    result = subprocess.run([sys.executable, str(HERE / "observe.py"), "--", sys.executable, "-c", f"import os; os.kill(os.getpid(),{int(signum)})"], env=dict(os.environ, PATH=directory), capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, -signum)

    def artifact_event(self, path, watch, status, tid, address=None, after_ns=0):
        deadline = time.monotonic() + 30
        with selectors.DefaultSelector() as selector:
            selector.register(watch, selectors.EVENT_READ)
            while True:
                # Only newline-terminated records have been flushed by publish.
                for row in path.read_bytes().splitlines(keepends=True):
                    if not row.endswith(b"\n"):
                        continue
                    item = json.loads(row)
                    if item.get("status") == status and item.get("tid") == tid and (address is None or item.get("address") == address) and item.get("observed_ns", after_ns) >= after_ns:
                        return item
                if not selector.select(max(0, deadline - time.monotonic())):
                    self.fail(f"artifact missing {status} for {tid}: {path.read_text()}")
                os.read(watch, 65536)

    def event(self, stream, status, tid, address=None):
        while True:
            event = json.loads(line(stream))
            if event.get("status") == status and event.get("tid") == tid and (address is None or event.get("address") == address):
                return event
            self.assertNotEqual(event.get("status"), "error", event)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "held":
        held_command(*sys.argv[2:])
        sys.exit(37)
    else:
        unittest.main()
