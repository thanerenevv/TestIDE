import type { ConnectionStatus, FileNode, ProjectInfo, SerialPort } from "./types";

export interface OpenTab {
  path: string;
  name: string;
  dirty: boolean;
}

export interface AppState {
  project: ProjectInfo | null;
  fileTree: FileNode[];
  ports: SerialPort[];
  selectedPort: string | null;
  selectedEnv: string | null;
  tabs: OpenTab[];
  activeTab: string | null;
  status: ConnectionStatus;
  statusMessage: string;
  activeTaskId: string | null;
  bottomTab: "build" | "monitor" | "terminal";
  bottomPanelOpen: boolean;
  monitorRunning: boolean;
  pioFound: boolean | null;
  idfFound: boolean | null;
}

type Listener = (state: AppState) => void;

class Store extends EventTarget {
  state: AppState = {
    project: null,
    fileTree: [],
    ports: [],
    selectedPort: null,
    selectedEnv: null,
    tabs: [],
    activeTab: null,
    status: "idle",
    statusMessage: "No board selected",
    activeTaskId: null,
    bottomTab: "build",
    bottomPanelOpen: true,
    monitorRunning: false,
    pioFound: null,
    idfFound: null,
  };

  private listeners: Listener[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  get(): AppState {
    return this.state;
  }
}

export const store = new Store();
