use super::*;

/// Check already-placed parts before storing them: together they are the Ask's words, in order.
pub(super) fn placed_parts(
    shared: &Intake,
    text: &str,
    parts: Vec<PlacedPart>,
) -> Result<Vec<Part>, RpcError> {
    let invalid = |message: &str| RpcError::new(code::INVALID_PARAMS, message);
    if parts.is_empty() || parts.iter().any(|part| part.text.is_empty()) {
        return Err(invalid("placed parts must be non-empty"));
    }
    if parts.iter().map(|part| part.text.len()).sum::<usize>() > text.len() {
        return Err(invalid("placed parts must be spans of the Ask text"));
    }
    parts
        .into_iter()
        .map(|part| {
            if !text.contains(&part.text) {
                return Err(invalid("placed parts must be spans of the Ask text"));
            }
            if let Place::Routed { workstream, .. } = &part.placement
                && shared.agents.shared.node(workstream)?.kind() != NodeKind::Workstream
            {
                return Err(invalid("target must be a Workstream"));
            }
            if let Place::New { title, .. } = &part.placement {
                Order::Work {
                    title: Some(title.clone()),
                    ask: part.text.clone(),
                    done: None,
                    limits: vec![],
                }
                .validate_explicit()
                .map_err(|err| invalid(&err.to_string()))?;
            }
            let state = if matches!(part.placement, Place::Unclear { .. }) {
                State::Waiting
            } else {
                State::Queued
            };
            Ok(Part {
                text: part.text,
                placement: part.placement,
                state,
                reason: None,
            })
        })
        .collect()
}
