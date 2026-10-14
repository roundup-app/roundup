"""U26: a kernel file fault, held by libfuse until the observer sees it."""
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def line(stream):
    with selectors.DefaultSelector() as selector:
        selector.register(stream, selectors.EVENT_READ)
        if not selector.select(30):
            raise AssertionError("missing pipe acknowledgement")
    value = stream.readline()
    if not value:
        raise AssertionError("pipe closed before acknowledgement")
    return value.strip()


def held_command(binary, mount, endpoint):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.connect(endpoint)
        control = connection.makefile("rw", buffering=1)
        fuse = subprocess.Popen([binary, mount], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        reader = None
        try:
            assert line(fuse.stdout) == "MOUNTED"
            reader = subprocess.Popen([binary, "read", mount + "/held"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
            control.write(line(reader.stdout) + "\n")
            assert line(control) == "G"
            reader.stdin.write("G\n")
            reader.stdin.flush()
            assert line(fuse.stdout) == "HELD"
            control.write("HELD\n")
            assert line(control) == "R"
            fuse.stdin.write("R\n")
            fuse.stdin.flush()
            control.write(line(reader.stdout) + "\n")
            assert reader.wait(timeout=10) == 0
            assert line(control) == "END"
        finally:
            if reader and reader.poll() is None:
                reader.kill()
                reader.wait(timeout=10)
            subprocess.run(["fusermount3", "-u", mount], check=True, timeout=10)
            fuse.wait(timeout=10)


class FaultTest(unittest.TestCase):
    def test_u26_pending_file_fault_survives_until_completed(self):
        with tempfile.TemporaryDirectory(prefix="u26-fault-") as directory:
            root = Path(directory)
            binary = root / "chrome"
            flags = subprocess.check_output(["pkg-config", "--cflags", "--libs", "fuse3"], text=True).split()
            subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", str(HERE / "held-file.c"), "-o", str(binary), *flags], check=True, timeout=30)
            mount = root / "mount"
            mount.mkdir()
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(root / "control"))
                listener.listen(1)
                listener.settimeout(30)
                observer = subprocess.Popen([sys.executable, str(HERE / "observe.py"), "--", sys.executable, __file__, "held", str(binary), str(mount), str(root / "control")], stdout=subprocess.PIPE, text=True, bufsize=1)
                try:
                    connection, _ = listener.accept()
                    with connection:
                        control = connection.makefile("rw", buffering=1)
                        mapped = line(control).split()
                        self.assertEqual(mapped[0], "MAPPED")
                        pid, tid, address = int(mapped[1]), int(mapped[2]), int(mapped[3], 16)
                        control.write("G\n")
                        self.assertEqual(line(control), "HELD")
                        pending = self.event(observer.stdout, "pending", tid)
                        self.assertEqual(pending["pid"], pid)
                        self.assertEqual(pending["address"], address)
                        self.assertEqual(pending["offset"], 4096)
                        self.assertIn(str(mount / "held"), pending["mapping"])
                        self.assertGreater(pending["entry_ns"], 0)
                        self.assertIn("filemap_fault", pending["stack"])
                        self.assertIn("fuse", pending["stack"])
                        # Independently prove the reader has not completed its real load.
                        self.assertIn("D (disk sleep)", Path(f"/proc/{tid}/status").read_text())
                        control.write("R\n")
                        self.assertEqual(line(control), "VALUE Q")
                        completed = self.event(observer.stdout, "completed", tid)
                        self.assertEqual(completed["entry_ns"], pending["entry_ns"])
                        self.assertEqual(completed["address"], address)
                        self.assertGreater(completed["duration_ns"], 0)
                        control.write("END\n")
                    self.assertEqual(observer.wait(timeout=30), 0)
                finally:
                    if observer.poll() is None:
                        observer.terminate()
                        observer.wait(timeout=30)

    def event(self, stream, status, tid):
        while True:
            event = json.loads(line(stream))
            if event.get("status") == status and event.get("tid") == tid:
                return event
            self.assertNotEqual(event.get("status"), "error", event)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "held":
        held_command(*sys.argv[2:])
    else:
        unittest.main()
