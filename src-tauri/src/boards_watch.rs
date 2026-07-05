use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::pio::{list_boards, SerialPort};

const POLL_INTERVAL: Duration = Duration::from_millis(1500);

/// Polls `pio device list` in the background and emits `boards-updated`
/// whenever the set of connected ports changes, so the sidebar reflects
/// USB hotplug/unplug without the user manually refreshing.
pub fn start_watching(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Vec<SerialPort> = Vec::new();
        loop {
            if let Ok(boards) = list_boards() {
                if !same_ports(&last, &boards) {
                    let _ = app.emit("boards-updated", &boards);
                    last = boards;
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn same_ports(a: &[SerialPort], b: &[SerialPort]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut a_ports: Vec<&str> = a.iter().map(|p| p.port.as_str()).collect();
    let mut b_ports: Vec<&str> = b.iter().map(|p| p.port.as_str()).collect();
    a_ports.sort_unstable();
    b_ports.sort_unstable();
    a_ports == b_ports
}
