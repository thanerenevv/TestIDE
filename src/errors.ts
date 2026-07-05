export interface ErrorHint {
  title: string;
  detail: string;
}

const PATTERNS: { test: RegExp; hint: ErrorHint }[] = [
  {
    test: /could not open port|serialexception|resource busy|permission denied.*tty|access is denied|could not exclusively lock port/i,
    hint: {
      title: "Port busy or inaccessible",
      detail:
        "Close any other program using this serial port (another monitor, Arduino IDE, screen, etc.) and try again. If it keeps happening, unplug and replug the board.",
    },
  },
  {
    test: /failed to connect to esp32|failed to connect to espressif device|invalid head of packet|timed out waiting for packet header|no serial data received/i,
    hint: {
      title: "Board not responding — check bootloader mode",
      detail:
        "Hold the BOOT button while the upload starts (or hold BOOT + tap RESET) on boards without auto-reset circuitry, then try flashing again.",
    },
  },
  {
    test: /no such file or directory.*tty|no device found|please specify `?upload_port`?|error: the port doesn't exist/i,
    hint: {
      title: "No board detected",
      detail:
        "Select a connected board from the Devices list in the sidebar, or plug in your device and wait for it to appear.",
    },
  },
  {
    test: /platform .* is not installed|unknown board id|unknowndevelopmentplatform|unknown development platform/i,
    hint: {
      title: "Missing platform or board package",
      detail:
        "PlatformIO needs to download platform files for this board. This usually happens automatically on first build — check your network connection and try again.",
    },
  },
  {
    test: /espcomm_upload_mem failed|hash of data verification failed|md5 of file does not match/i,
    hint: {
      title: "Upload verification failed",
      detail:
        "The flash write didn't verify correctly. Try a lower upload speed, a different USB cable, or a different USB port.",
    },
  },
];

export function classifyError(logText: string): ErrorHint {
  for (const p of PATTERNS) {
    if (p.test.test(logText)) return p.hint;
  }
  return {
    title: "Task failed",
    detail: "See the build output above for details.",
  };
}
