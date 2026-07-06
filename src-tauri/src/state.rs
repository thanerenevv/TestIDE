use std::collections::{HashMap, VecDeque};
use std::process::Child;
use std::sync::{Arc, Mutex};

use crate::terminal::TerminalSession;

pub type SharedChild = Arc<Mutex<Child>>;

/// Cap on retained serial monitor lines — enough for the AI assistant's
/// `read_serial_monitor` tool to have useful recent context without letting
/// a chatty device grow this unbounded over a long monitoring session.
pub const MONITOR_BUFFER_CAP: usize = 500;

#[derive(Default)]
pub struct AppState {
    /// Currently running build/upload/clean task, keyed by task id.
    pub tasks: Mutex<HashMap<String, SharedChild>>,
    /// Currently running serial monitor process, if any.
    pub monitor: Mutex<Option<SharedChild>>,
    /// Open integrated terminal sessions, keyed by terminal id.
    pub terminals: Mutex<HashMap<String, TerminalSession>>,
    /// Recent serial monitor output lines, newest at the back — populated by
    /// a global `monitor-line` event listener (see `lib.rs`) so the AI
    /// assistant can read recent device output without a live tap.
    pub monitor_buffer: Mutex<VecDeque<String>>,
}
