An async read a view shows is a `createResource`: one call keyed by its inputs, with loading, error and latest-reply-wins built in. A list that several rows share keeps its rows in a `storage` that reconciles by id, and a view reads `latest`-style state from the resource, never from a counter, a `loaded` signal or a `failure` signal the read's own code sets.
_Avoid_: a `newest` counter compared after an `await`, a `mine !== newest` guard, a `setLoaded(true)` or `setFailure(message)` after a call, a `batch` that writes a reply and its status together, a fetcher that settles other state from its reply.
Detect: an `await` of an RPC in a function that then writes a signal or store (`anti-slop/no-stale-counter`).
Not-when: the call changes Daemon state (a mutation reports its outcome to its caller), or the read is a one-off that no view shows.
Cross-ref: derive-dont-repair; remote-call-has-a-third-outcome.
