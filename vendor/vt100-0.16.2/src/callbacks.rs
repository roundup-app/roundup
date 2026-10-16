/// Observes handled text and terminal requests during parsing.
pub trait Callbacks {
    /// Called synchronously after each handled text character is applied to the
    /// screen, including writes that leave the glyph unchanged. The screen is
    /// the post-write state. Controls, escape sequences and unhandled characters
    /// do not call this method.
    ///
    /// To associate writes with raw completion offsets, feed one byte per
    /// Parser::process call and set the callback's offset before that call.
    /// UTF-8 decoding and escape recognition remain owned by the parser.
    /// No observations are retained by the library; callback storage is owned
    /// by the caller and cloned according to its Clone implementation.
    fn text(&mut self, _: &mut crate::Screen, _c: char) {}

    /// This callback is called when the terminal requests an audible bell
    /// (typically with `^G`).
    fn audible_bell(&mut self, _: &mut crate::Screen) {}
    /// This callback is called when the terminal requests a visual bell
    /// (typically with `\eg`).
    fn visual_bell(&mut self, _: &mut crate::Screen) {}
    /// This callback is called when the terminal requests a resize
    /// (typically with `\e[8;<rows>;<cols>t`).
    fn resize(&mut self, _: &mut crate::Screen, _request: (u16, u16)) {}
    /// This callback is called when the terminal requests the window title
    /// to be set (typically with `\e]1;<icon_name>\a`)
    fn set_window_icon_name(
        &mut self,
        _: &mut crate::Screen,
        _icon_name: &[u8],
    ) {
    }
    /// This callback is called when the terminal requests the window title
    /// to be set (typically with `\e]2;<title>\a`)
    fn set_window_title(&mut self, _: &mut crate::Screen, _title: &[u8]) {}
    /// This callback is called when the terminal requests data to be copied
    /// to the system clipboard (typically with `\e]52;<ty>;<data>\a`). Note
    /// that `data` will be encoded as base64.
    fn copy_to_clipboard(
        &mut self,
        _: &mut crate::Screen,
        _ty: &[u8],
        _data: &[u8],
    ) {
    }
    /// This callback is called when the terminal requests data to be pasted
    /// from the system clipboard (typically with `\e]52;<ty>;?\a`).
    fn paste_from_clipboard(&mut self, _: &mut crate::Screen, _ty: &[u8]) {}
    /// This callback is called when the terminal receives an escape sequence
    /// which is otherwise not implemented.
    fn unhandled_char(&mut self, _: &mut crate::Screen, _c: char) {}
    /// This callback is called when the terminal receives a control
    /// character which is otherwise not implemented.
    fn unhandled_control(&mut self, _: &mut crate::Screen, _b: u8) {}
    /// This callback is called when the terminal receives an escape sequence
    /// which is otherwise not implemented.
    fn unhandled_escape(
        &mut self,
        _: &mut crate::Screen,
        _i1: Option<u8>,
        _i2: Option<u8>,
        _b: u8,
    ) {
    }
    /// This callback is called when the terminal receives a CSI sequence
    /// (`\e[`) which is otherwise not implemented.
    fn unhandled_csi(
        &mut self,
        _: &mut crate::Screen,
        _i1: Option<u8>,
        _i2: Option<u8>,
        _params: &[&[u16]],
        _c: char,
    ) {
    }
    /// This callback is called when the terminal receives a OSC sequence
    /// (`\e]`) which is otherwise not implemented.
    fn unhandled_osc(&mut self, _: &mut crate::Screen, _params: &[&[u8]]) {}
}

impl Callbacks for () {}
