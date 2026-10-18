//! Optional worktrunk adapter under construction at #2628's internal seam.
fn parse(_bytes: &[u8]) -> Result<serde_json::Value, String> {
    Err("unsupported worktrunk schema".into())
}
#[cfg(test)]
mod tests;
