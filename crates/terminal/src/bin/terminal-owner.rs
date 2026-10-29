//! Packaged opt-in PTY owner; ordinary Daemon startup does not invoke it.
#[tokio::main]
async fn main() -> Result<(), rpc::OpenError> {
    let project = std::env::args_os()
        .nth(1)
        .ok_or("Project data directory required")?;
    let params = serde_json::from_reader(std::io::stdin().lock())?;
    terminal::Terminals::serve_owner(std::path::Path::new(&project), params).await
}
