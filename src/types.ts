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

export type Stm32Flavor = "cube-ide" | "makefile" | "cmake";

export interface Stm32FlashTools {
  programmer_cli: boolean;
  openocd: boolean;
}

export interface Stm32ProjectInfo {
  kind: "stm32";
  root: string;
  name: string;
  flavor: Stm32Flavor;
  build_configs: string[];
  mcu: string | null;
  flash_tools: Stm32FlashTools;
}

export interface UnknownProjectInfo {
  kind: "unknown";
  root: string;
  name: string;
}

export type ProjectInfo =
  | PlatformioProjectInfo
  | EspIdfProjectInfo
  | Stm32ProjectInfo
  | UnknownProjectInfo;

export type Stm32FlashTool = "programmer-cli" | "openocd";

export interface Stm32EnvironmentStatus {
  arm_gcc_found: boolean;
  arm_gcc_path: string | null;
  make_found: boolean;
  cmake_found: boolean;
  ninja_found: boolean;
  cubeide_found: boolean;
  cubeide_path: string | null;
  cubemx_found: boolean;
  cubemx_path: string | null;
  programmer_cli_found: boolean;
  openocd_found: boolean;
}

export interface NewStm32ProjectRequest {
  parent_dir: string;
  project_name: string;
  board: string | null;
  mcu: string | null;
  toolchain: Stm32Flavor;
}

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
  via_eim: boolean;
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

export interface LibrarySearchItem {
  id: number;
  name: string;
  owner: string;
  description: string;
  version: string;
  authors: string[];
  frameworks: string[];
}

export interface LibrarySearchResult {
  page: number;
  perpage: number;
  total: number;
  items: LibrarySearchItem[];
}

export interface LibraryVersion {
  name: string;
  released: string;
}

export interface LibraryDetail {
  id: number;
  name: string;
  owner: string;
  description: string;
  homepage: string;
  repository: string;
  authors: string[];
  versions: LibraryVersion[];
}

export interface InstalledLibrary {
  name: string;
  version: string;
  description: string;
  author: string;
}

export interface EspComponent {
  name: string;
  spec: string;
  version: string | null;
  description: string;
  url: string;
}

export interface AiProviderConfig {
  kind: "anthropic" | "gemini" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  apiVersion?: string;
  authStyle?: "bearer" | "api-key-header";
}

export interface AiToolCallData {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AiChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AiToolCallData[];
  toolCallId?: string;
  name?: string;
}

export interface AiChatRequest {
  provider: AiProviderConfig;
  messages: AiChatMessage[];
  projectPath?: string | null;
  activeFilePath?: string | null;
  activeFileContent?: string | null;
}

export interface AiToolCallEvent {
  name: string;
  arguments: unknown;
}

export interface AiToolResultEvent {
  name: string;
  ok: boolean;
  summary: string;
}
