use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};

use crate::terminal::TerminalSession;

pub type SharedChild = Arc<Mutex<Child>>;

#[derive(Default)]
pub struct AppState {
    /// Currently running build/upload/clean task, keyed by task id.
    pub tasks: Mutex<HashMap<String, SharedChild>>,
    /// Currently running serial monitor process, if any.
    pub monitor: Mutex<Option<SharedChild>>,
    /// Open integrated terminal sessions, keyed by terminal id.
    pub terminals: Mutex<HashMap<String, TerminalSession>>,
}
