import { openUrl } from "@tauri-apps/plugin-opener";

export const PIO_INSTALL_URL =
  "https://docs.platformio.org/en/latest/core/installation/index.html";
export const IDF_INSTALL_URL =
  "https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html";

export function installPlatformio() {
  void openUrl(PIO_INSTALL_URL);
}

export function installEspIdf() {
  void openUrl(IDF_INSTALL_URL);
}
