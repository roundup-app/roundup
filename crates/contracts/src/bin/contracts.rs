fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contracts/generated")
        });
    contracts::export::generate(&root)
}
