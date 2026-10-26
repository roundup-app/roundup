fn main() -> std::process::ExitCode {
    match desktop::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        // run reports through the native sink when available. Debug-printing its error here
        // would disclose foreign plugin messages and Project paths on a failed launch.
        Err(_) => std::process::ExitCode::FAILURE,
    }
}
