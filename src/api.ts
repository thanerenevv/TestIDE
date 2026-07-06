import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiChatMessage,
  AiChatRequest,
  AiToolCallEvent,
  AiToolResultEvent,
  BoardDefinition,
  EnvironmentStatus,
  EspComponent,
  FileNode,
  IdfEnvironmentStatus,
  InstalledLibrary,
  LibraryDetail,
  LibrarySearchResult,
  NewStm32ProjectRequest,
  ProcDone,
  ProcLine,
  ProjectInfo,
  SerialPort,
  Stm32EnvironmentStatus,
  Stm32Flavor,
  Stm32FlashTool,
  TerminalExitEvent,
  TerminalOutputEvent,
} from "./types";

export const api = {
  checkEnvironment: () => invoke<EnvironmentStatus>("check_environment"),
  checkIdfEnvironment: () => invoke<IdfEnvironmentStatus>("check_idf_environment"),

  listBoards: () => invoke<SerialPort[]>("list_boards"),
  searchBoards: (query: string) =>
    invoke<BoardDefinition[]>("search_boards", { query }),

  openProject: (path: string) => invoke<ProjectInfo>("open_project", { path }),
  readProjectTree: (path: string) =>
    invoke<FileNode[]>("read_project_tree", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, contents: string) =>
    invoke<void>("write_file", { path, contents }),
  createFile: (path: string) => invoke<void>("create_file", { path }),
  createFolder: (path: string) => invoke<void>("create_folder", { path }),
  deleteEntry: (path: string) => invoke<void>("delete_entry", { path }),
  renameEntry: (from: string, to: string) =>
    invoke<void>("rename_entry", { from, to }),
  newProject: (req: {
    parent_dir: string;
    project_name: string;
    board_id: string;
    framework: string;
  }) => invoke<ProjectInfo>("new_project", { req }),
  newIdfProject: (req: {
    parent_dir: string;
    project_name: string;
    target: string;
  }) => invoke<ProjectInfo>("new_idf_project", { req }),

  buildProject: (project_path: string, env: string | null, task_id: string) =>
    invoke<string>("build_project", { projectPath: project_path, env, taskId: task_id }),
  uploadProject: (
    project_path: string,
    env: string | null,
    port: string | null,
    task_id: string,
  ) =>
    invoke<string>("upload_project", {
      projectPath: project_path,
      env,
      port,
      taskId: task_id,
    }),
  cleanProject: (project_path: string, env: string | null, task_id: string) =>
    invoke<string>("clean_project", { projectPath: project_path, env, taskId: task_id }),
  stopTask: (task_id: string) => invoke<void>("stop_task", { taskId: task_id }),

  startMonitor: (
    project_path: string,
    env: string | null,
    port: string,
    baud: number | null,
  ) =>
    invoke<void>("start_monitor", {
      projectPath: project_path,
      env,
      port,
      baud,
    }),
  stopMonitor: () => invoke<void>("stop_monitor"),

  idfBuild: (project_path: string, task_id: string) =>
    invoke<string>("idf_build", { projectPath: project_path, taskId: task_id }),
  idfUpload: (project_path: string, port: string | null, task_id: string) =>
    invoke<string>("idf_upload", { projectPath: project_path, port, taskId: task_id }),
  idfClean: (project_path: string, task_id: string) =>
    invoke<string>("idf_clean", { projectPath: project_path, taskId: task_id }),
  idfSetTarget: (project_path: string, target: string, task_id: string) =>
    invoke<string>("idf_set_target", {
      projectPath: project_path,
      target,
      taskId: task_id,
    }),
  idfMonitor: (project_path: string, port: string, baud: number | null) =>
    invoke<void>("idf_monitor", { projectPath: project_path, port, baud }),

  checkStm32Environment: () => invoke<Stm32EnvironmentStatus>("check_stm32_environment"),
  newStm32Project: (req: NewStm32ProjectRequest) =>
    invoke<ProjectInfo>("new_stm32_project", { req }),
  stm32Build: (
    project_path: string,
    flavor: Stm32Flavor,
    config: string | null,
    task_id: string,
  ) =>
    invoke<string>("stm32_build", {
      projectPath: project_path,
      flavor,
      config,
      taskId: task_id,
    }),
  stm32Flash: (
    project_path: string,
    flavor: Stm32Flavor,
    config: string | null,
    tool: Stm32FlashTool,
    task_id: string,
  ) =>
    invoke<string>("stm32_flash", {
      projectPath: project_path,
      flavor,
      config,
      tool,
      taskId: task_id,
    }),
  stm32Clean: (
    project_path: string,
    flavor: Stm32Flavor,
    config: string | null,
    task_id: string,
  ) =>
    invoke<string>("stm32_clean", {
      projectPath: project_path,
      flavor,
      config,
      taskId: task_id,
    }),

  searchLibraries: (query: string, page?: number) =>
    invoke<LibrarySearchResult>("search_libraries", { query, page: page ?? null }),
  getLibraryDetail: (idOrName: string) =>
    invoke<LibraryDetail>("get_library_detail", { idOrName }),
  listInstalledLibraries: (project_path: string, env: string) =>
    invoke<InstalledLibrary[]>("list_installed_libraries", {
      projectPath: project_path,
      env,
    }),
  installLibrary: (
    project_path: string,
    env: string,
    owner: string,
    name: string,
    version: string,
    task_id: string,
  ) =>
    invoke<string>("install_library", {
      projectPath: project_path,
      env,
      owner,
      name,
      version,
      taskId: task_id,
    }),
  uninstallLibrary: (project_path: string, env: string, name: string, task_id: string) =>
    invoke<string>("uninstall_library", {
      projectPath: project_path,
      env,
      name,
      taskId: task_id,
    }),

  listEspComponents: (project_path: string) =>
    invoke<EspComponent[]>("list_esp_components", { projectPath: project_path }),
  addEspComponent: (project_path: string, spec: string, task_id: string) =>
    invoke<string>("add_esp_component", {
      projectPath: project_path,
      spec,
      taskId: task_id,
    }),
  removeEspComponent: (project_path: string, name: string) =>
    invoke<void>("remove_esp_component", { projectPath: project_path, name }),

  aiSendMessage: (request: AiChatRequest) =>
    invoke<AiChatMessage[]>("ai_send_message", { request }),

  terminalSpawn: (id: string, cwd: string | null, cols: number, rows: number) =>
    invoke<void>("terminal_spawn", { id, cwd, cols, rows }),
  terminalWrite: (id: string, data: string) =>
    invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>("terminal_resize", { id, cols, rows }),
  terminalKill: (id: string) => invoke<void>("terminal_kill", { id }),
};

export function onTaskLine(cb: (line: ProcLine) => void): Promise<UnlistenFn> {
  return listen<ProcLine>("task-line", (e) => cb(e.payload));
}
export function onTaskDone(cb: (done: ProcDone) => void): Promise<UnlistenFn> {
  return listen<ProcDone>("task-done", (e) => cb(e.payload));
}
export function onAiToolCall(cb: (e: AiToolCallEvent) => void): Promise<UnlistenFn> {
  return listen<AiToolCallEvent>("ai-tool-call", (e) => cb(e.payload));
}
export function onAiToolResult(cb: (e: AiToolResultEvent) => void): Promise<UnlistenFn> {
  return listen<AiToolResultEvent>("ai-tool-result", (e) => cb(e.payload));
}
export function onAiFileChanged(cb: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>("ai-file-changed", (e) => cb(e.payload));
}
export function onLibTaskLine(cb: (line: ProcLine) => void): Promise<UnlistenFn> {
  return listen<ProcLine>("lib-task-line", (e) => cb(e.payload));
}
export function onLibTaskDone(cb: (done: ProcDone) => void): Promise<UnlistenFn> {
  return listen<ProcDone>("lib-task-done", (e) => cb(e.payload));
}
export function onMonitorLine(
  cb: (line: ProcLine) => void,
): Promise<UnlistenFn> {
  return listen<ProcLine>("monitor-line", (e) => cb(e.payload));
}
export function onMonitorDone(
  cb: (done: ProcDone) => void,
): Promise<UnlistenFn> {
  return listen<ProcDone>("monitor-done", (e) => cb(e.payload));
}
export function onBoardsUpdated(
  cb: (boards: SerialPort[]) => void,
): Promise<UnlistenFn> {
  return listen<SerialPort[]>("boards-updated", (e) => cb(e.payload));
}
export function onMenuAction(cb: (action: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu-action", (e) => cb(e.payload));
}
export function onTerminalOutput(
  cb: (e: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>("terminal-output", (e) => cb(e.payload));
}
export function onTerminalExit(
  cb: (e: TerminalExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>("terminal-exit", (e) => cb(e.payload));
}
