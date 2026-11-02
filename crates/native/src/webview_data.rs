//! N5467b: ask the invoking WebKit store for its directories, never infer a Library path.
use objc2::{msg_send, rc::Retained, runtime::AnyObject, sel};
use objc2_foundation::NSURL;
use std::path::PathBuf;

/// Reads configuration metadata only, on WebKit's main thread. No website records are fetched.
pub fn webview_data_path<R: tauri::Runtime>(view: &tauri::Webview<R>) -> Result<PathBuf, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        // SAFETY: Tauri supplies the live WKWebView on its owning thread. Each selector is
        // checked before use; WebKit's SPI declares these properties as objects/NSURLs.
        let result = unsafe {
            let webview = &*platform.inner().cast::<AnyObject>();
            let configuration: Retained<AnyObject> = msg_send![webview, configuration];
            let store: Retained<AnyObject> = msg_send![&*configuration, websiteDataStore];
            let available: bool = msg_send![&*store, respondsToSelector: sel!(_configuration)];
            if !available {
                Err("WebKit cannot report its browser data configuration".into())
            } else {
                let configuration: Retained<AnyObject> = msg_send![&*store, _configuration];
                let mut folders = Vec::new();
                for selector in [sel!(_webStorageDirectory), sel!(generalStorageDirectory)] {
                    let available: bool = msg_send![&*configuration, respondsToSelector: selector];
                    if available {
                        let url: Option<Retained<NSURL>> =
                            msg_send![&*configuration, performSelector: selector];
                        if let Some(path) = url.as_ref().and_then(|url| url.path()) {
                            let path = PathBuf::from(path.to_string());
                            if path.is_absolute() {
                                folders.push(path);
                            }
                        }
                    }
                }
                folders
                    .first()
                    .and_then(|first| {
                        first
                            .ancestors()
                            .find(|parent| folders.iter().all(|folder| folder.starts_with(parent)))
                    })
                    .filter(|folder| folder.components().count() > 4)
                    .map(PathBuf::from)
                    .ok_or_else(|| "WebKit did not report a bounded browser data folder".into())
            }
        };
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?
}
