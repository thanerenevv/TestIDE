export interface SerialPort {
  port: string;
  description: string;
  hwid: string;
}

export interface BoardDefinition {
  id: string;
  name: string;
  platform: string;
  frameworks: string[];
  mcu: string;
}

export interface PioEnv {
  name: string;
  board: string | null;
  platform: string | null;
  framework: string | null;
  upload_port: string | null;
  monitor_speed: number | null;
}

export interface PlatformioProjectInfo {
  kind: "platformio";
  root: string;
  name: string;
  envs: PioEnv[];
}

export interface EspIdfProjectInfo {
  kind: "esp-idf";
  root: string;
  name: string;
  target: string | null;
  available_targets: string[];
  has_sdkconfig: boolean;
}

export interface UnknownProjectInfo {
  kind: "unknown";
  root: string;
  name: string;
}

export type ProjectInfo = PlatformioProjectInfo | EspIdfProjectInfo | UnknownProjectInfo;

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface EnvironmentStatus {
  pio_found: boolean;
  pio_path: string | null;
  pio_version: string | null;
}

export interface IdfEnvironmentStatus {
  idf_found: boolean;
  idf_path: string | null;
  idf_version: string | null;
  env_ready: boolean;
}

export interface ProcLine {
  id: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface ProcDone {
  id: string;
  success: boolean;
  code: number | null;
}

export type TaskKind = "build" | "upload" | "clean";

export interface TerminalOutputEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
}

export type ConnectionStatus =
  | "idle"
  | "building"
  | "uploading"
  | "success"
  | "error"
  | "monitoring";
