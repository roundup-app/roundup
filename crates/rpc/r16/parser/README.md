# R16 Client object allocation

Existing `reply` and Client seams retain complete results, errors and events. The Client currently grows each JSON object map from zero capacity. The release fixture compares that path with a capacity hint of 16, a smaller hint of four, and collecting entries before constructing the map. It also isolates line acquisition. No field, row, protocol or workload is removed.

The R16 JSON-value test checks numeric limits, negative zero, escaped strings/keys, nested/empty/wide objects, duplicate-key value and order, and routing after malformed frames. These are preservation assertions and pass before the allocation repair; the release profile, rather than a new functional failure, identifies avoidable work.

This is an investigation under #1374. Existing production ownership repair #1375 remains intact. Full acceptance still requires nine supported-class comparisons; a parsing saving alone cannot close the Issue.
