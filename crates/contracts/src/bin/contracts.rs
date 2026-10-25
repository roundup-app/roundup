fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = std::env::args_os()
        .nth(1)
        .ok_or("usage: contracts <output-directory>")?;
    contracts::export::generate(std::path::Path::new(&root))
}
