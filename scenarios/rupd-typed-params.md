# Typed params in rupd

Module: `crates/rupd`. Ids: C6629a, C6629b, C6629c.

Three `rupd` params are still checked by hand inside their handlers, so the type that parses the field accepts a value the handler then refuses. Each becomes a type whose `Deserialize` refuses the bad value, so `rpc::params` answers `INVALID_PARAMS` before any handler runs (as C6493b does for a mismatched shape). Messages keep their current text. Tests are in `crates/rupd`; the wire shapes and `contracts/generated/` do not move (C6493c).

**C6629a a Fork name is refused by its type.** Given `fork` params whose `name` is empty, longer than 40 characters, or holds a control character, when the params are parsed, then parsing fails with the message the check in `crates/rupd/src/fork.rs` `fork` gives today and `fork` holds no name check of its own (`c6629a_a_bad_fork_name_fails_to_parse`). A name of 1 to 40 characters with no control character parses and forks as before.

**C6629b a wake id list is refused by its type.** Given `wake` params whose `ids` is empty or holds more than 20 ids, when the params are parsed, then parsing fails with `ids must name 1 to 20 Agents` and `INVALID_PARAMS`, and `parse_request` in `crates/rupd/src/wake.rs` holds no length check (`c6629b_a_bad_wake_ids_list_fails_to_parse`). One to twenty ids parse as before.

**C6629c the queue cap is refused by its type.** Given `queue.cap` params whose `cap` is neither null nor a whole number from 1 to `u32::MAX` (a string, a fraction, 0, a negative, a number above `u32::MAX`), when the params are parsed, then parsing fails with `cap must be a whole number of 1 or more, or null` and `set_cap` in `crates/rupd/src/queue.rs` matches no `Value` (`c6629c_a_bad_queue_cap_fails_to_parse`). Null clears the cap and a whole number in range sets it, as before.
