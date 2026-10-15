"""U26: a kernel file fault, held by libfuse until the observer sees it."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
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


def held_command(binary, mount, endpoint):
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
            assert line(control) == "G"
            reader.stdin.write("G\n")
            reader.stdin.flush()
            assert line(fuse.stdout) == "HELD"
            send("HELD\n")
            assert line(control) == "R"
            fuse.stdin.write("R\n")
            fuse.stdin.flush()
            send(line(reader.stdout) + "\n")
            assert reader.wait(timeout=10) == 0
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


class FaultTest(unittest.TestCase):
    def test_u26_pending_file_fault_survives_until_completed(self):
        with file_fixture() as (root, binary, mount):
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(root / "control"))
                listener.listen(1)
                listener.settimeout(30)
                observer = subprocess.Popen([sys.executable, str(HERE / "observe.py"), "--log", str(root / "trace.jsonl"), "--", sys.executable, __file__, "held", str(binary), str(mount), str(root / "control")], stdout=subprocess.PIPE, text=True, bufsize=1)
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
                        outsider = subprocess.Popen([str(binary), "read", str(mount / "held")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
                        outside = line(outsider.stdout).split()
                        outside_pid = int(outside[1])
                        outsider.stdin.write("G\n")
                        outsider.stdin.flush()
                        send("G\n")
                        self.assertEqual(line(control), "HELD")
                        pending = self.event(observer.stdout, "pending", tid, address)
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
                        held_until_ns = time.monotonic_ns()
                        send("R\n")
                        self.assertEqual(line(control), "VALUE Q")
                        self.assertEqual(line(outsider.stdout), "VALUE Q")
                        self.assertEqual(outsider.wait(timeout=10), 0)
                        completed = self.event(observer.stdout, "completed", tid, address)
                        self.assertEqual(completed["entry_ns"], pending["entry_ns"])
                        self.assertEqual(completed["address"], address)
                        self.assertGreaterEqual(completed["duration_ns"], held_until_ns - pending["entry_ns"])
                        send("END\n")
                        finished = self.event(observer.stdout, "finished", None)
                        self.assertEqual(finished["command_status"], 37)
                    self.assertEqual(observer.wait(timeout=30), 37)
                    events = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                    self.assertFalse(any(event.get("pid") == outside_pid for event in events))
                    self.assertEqual(events[-1]["command_status"], 37)
                finally:
                    if control:
                        control.close()
                    if observer.poll() is None:
                        observer.wait(timeout=30)
                    observer.stdout.close()
                    if outsider:
                        if outsider.poll() is None:
                            outsider.kill()
                            outsider.wait(timeout=10)
                        outsider.stdin.close()
                        outsider.stdout.close()

    def test_u26_teardown_retains_a_fault_that_is_still_in_flight(self):
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
                # Kill only the command's waiting leader. Its renamed reader
                # remains in the real kernel fault while the tracer tears down.
                os.kill(attached["root_pid"], 15)
                finished = self.event(observer.stdout, "finished", None)
                self.assertEqual(observer.wait(timeout=30), -15)
                self.assertEqual(finished["still_pending"], 1)
                self.assertIn("D (disk sleep)", Path(f"/proc/{reader_tid}/status").read_text())
                events = [json.loads(row) for row in (root / "trace.jsonl").read_text().splitlines()]
                retained = [event for event in events if event.get("tid") == reader_tid and event.get("status") == "pending"]
                self.assertEqual(len(retained), 2)  # live and final evidence
                self.assertEqual(retained[-1]["entry_ns"], pending["entry_ns"])
                self.assertEqual(retained[-1]["address"], int(mapped[3], 16))
                self.assertIn(str(mount / "held"), retained[-1]["mapping"])
                fuse.stdin.write("R\n")
                fuse.stdin.flush()
                self.assertEqual(line(observer.stdout), "VALUE Q")
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

    def test_u26_tracer_launch_failure_preserves_the_command_exit(self):
        with tempfile.TemporaryDirectory(prefix="u26-no-tracer-") as directory:
            environment = dict(os.environ, PATH=directory)
            result = subprocess.run([sys.executable, str(HERE / "observe.py"), "--", sys.executable, "-c", "import sys; sys.exit(39)"], env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 39)
            events = [json.loads(row) for row in result.stdout.splitlines()]
            self.assertTrue(any(event["status"] == "error" for event in events))
            self.assertEqual(events[-1]["command_status"], 39)

    def test_u26_a_signalled_command_preserves_its_signal_without_tracing(self):
        with tempfile.TemporaryDirectory(prefix="u26-no-tracer-") as directory:
            for signum in (signal.SIGTERM, signal.SIGKILL):
                with self.subTest(signal=signum):
                    result = subprocess.run([sys.executable, str(HERE / "observe.py"), "--", sys.executable, "-c", f"import os; os.kill(os.getpid(),{int(signum)})"], env=dict(os.environ, PATH=directory), capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, -signum)

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
