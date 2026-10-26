# Attached startup notification

The parent launches `rupd <project> --attached --notify-bound` with fresh owned
stdin, stdout and stderr pipes. `--notify-bound` requires `--attached`. Without
the opt-in, stdout and the human stderr diagnostics keep their existing behavior.

After Project open and successful socket bind, before serving requests, rupd
writes exactly the 11 bytes `rupd-bound\n` to stdout once. No Project name, path
or diagnostic text is part of this signal. The write uses Tokio's nonblocking
pipe sender with a one-second timeout. A closed reader, a non-pipe stdout, or a
write failure/timeout ends startup through Terminal shutdown and exits with an
error; it never proceeds to serve. No blocking stdin reader is started until
notification succeeds, so notification failure can exit even if stdin is open.

The signal authorizes only an attempt to connect and call `daemon.ping`. Only
its successful reply proves readiness. The parent must await both under its
single startup deadline, race early child exit, retain stderr diagnostics, and
close stdin for shutdown. EOF, partial bytes or any other bytes are not success.
The pipe grants no RPC or Agent authority. Closing the notification reader after
receiving the signal has no further effect; stdin remains the lifetime pipe.

Consumer work remains in #3830; this producer does not remove Desktop's poll.
