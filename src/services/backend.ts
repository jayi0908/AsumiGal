import { GameInstance, SearchResult, ScreenshotItem, GameLogLine } from "../types/instance";
import { invoke } from "@tauri-apps/api/core";

export interface WineLaunchConfig {
  bottle_path: string;
  game_exe: string;
  crossover_app_path: string;
  run_mode: string;
  dry_run_active?: boolean;
  command_args?: string;
  env_vars?: string;
  work_dir?: string;
  screenshot_dir?: string;
  screenshot_target?: string;
  locale?: string;
  wine_debug?: string;
}

export interface MigrateGameFilesPayload {
  instance_id: string;
  game_file_status: string;
  disk_game_root: string;
  local_game_root: string;
  game_relative_dir: string;
  executable_path: string;
}

export interface MigrateGameFilesResult {
  new_executable_path: string;
  new_status: "disk" | "local";
}

export const BackendService = {
  // --- 实例存储 ---
  async loadInstances(): Promise<GameInstance[]> {
    const jsonString = await invoke<string>("load_instances");
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [];
  },

  async saveInstances(instances: GameInstance[]): Promise<void> {
    await invoke("save_instances", { data: JSON.stringify(instances, null, 2) });
  },

  // --- 启动与终止 ---
  async launchGame(instanceId: string, config: WineLaunchConfig): Promise<number> {
    return await invoke<number>("launch_game", { instanceId, config });
  },

  async stopGame(instanceId: string, config: WineLaunchConfig): Promise<number[]> {
    return await invoke<number[]>("stop_game", { instanceId, config });
  },

  async getInstanceLogs(instanceId: string): Promise<GameLogLine[]> {
    return await invoke<GameLogLine[]>("get_instance_logs", { instanceId });
  },

  async clearInstanceLogs(instanceId: string): Promise<void> {
    await invoke("clear_instance_logs", { instanceId });
  },

  // --- 容器与脚本 ---
  async getCrossoverBottles(path: string): Promise<string[]> {
    return await invoke<string[]>("get_crossover_bottles", { path });
  },

  async getPdVms(path: string): Promise<string[]> {
    return await invoke<string[]>("get_pd_vms", { path });
  },

  async getScripts(): Promise<string[]> {
    return await invoke<string[]>("get_scripts");
  },

  async readScript(name: string): Promise<string> {
    return await invoke<string>("read_script", { name });
  },

  async saveScript(name: string, content: string): Promise<void> {
    await invoke("save_script", { name, content });
  },

  // --- 目录扫描与文件迁移 ---
  async getDirectoryKeywords(path: string): Promise<string[]> {
    return await invoke<string[]>("get_directory_keywords", { path });
  },

  async scanGameDirectories(path: string): Promise<{ dir_name: string; executables: string[] }[]> {
    return await invoke<{ dir_name: string; executables: string[] }[]>("scan_game_directories", { path });
  },

  async migrateGameFiles(payload: MigrateGameFilesPayload): Promise<MigrateGameFilesResult> {
    return await invoke<MigrateGameFilesResult>("migrate_game_files", { payload });
  },

  // --- 搜索与发现 ---
  async searchGame(keyword: string, source: "touchgal" | "vndb", page = 1): Promise<SearchResult[]> {
    if (source === "touchgal") {
      return await invoke<SearchResult[]>("touchgal_search", { keyword, page });
    }
    return await invoke<SearchResult[]>("search_game", { keyword, source, page });
  },

  async touchgalSearch(keyword: string, page = 1): Promise<SearchResult[]> {
    return await invoke<SearchResult[]>("touchgal_search", { keyword, page });
  },

  async vndbSearch(keyword: string, page = 1): Promise<SearchResult[]> {
    return await invoke<SearchResult[]>("search_game", { keyword, source: "vndb", page });
  },

  async fetchYmgalNews<T = unknown>(page: number): Promise<T> {
    return await invoke<T>("fetch_ymgal_news", { page });
  },

  // --- 截图 ---
  async listInstanceScreenshots(
    instanceId: string,
    executablePath: string,
    customScreenshotDir: string
  ): Promise<ScreenshotItem[]> {
    return await invoke<ScreenshotItem[]>("list_instance_screenshots", {
      instanceId,
      executablePath,
      customScreenshotDir,
    });
  },

  async captureInstanceScreenshot(params: {
    instanceId: string;
    runMode: string;
    executablePath: string;
    customScreenshotDir: string;
    screenshotTarget: string;
  }): Promise<ScreenshotItem> {
    return await invoke<ScreenshotItem>("capture_instance_screenshot", params);
  },

  async captureGameScreenshot(params: {
    activeInstanceId: string;
    activeRunMode: string;
    activeExecutablePath: string;
    activeScreenshotDir: string;
    activeScreenshotTarget: string;
  }): Promise<{ instanceId: string | null; screenshot: ScreenshotItem }> {
    return await invoke<{ instanceId: string | null; screenshot: ScreenshotItem }>(
      "capture_game_screenshot",
      params
    );
  },

  async deleteInstanceScreenshot(params: {
    instanceId: string;
    executablePath: string;
    customScreenshotDir: string;
    fileName: string;
  }): Promise<void> {
    await invoke("delete_instance_screenshot", params);
  },

  async openScreenRecordingSettings(): Promise<void> {
    await invoke("open_screen_recording_settings");
  },

  // --- 系统工具与 CLI ---
  async getHomeDir(): Promise<string> {
    return await invoke<string>("get_home_dir");
  },

  async getSystemFonts(): Promise<string[]> {
    return await invoke<string[]>("get_system_fonts");
  },

  async takeCliCommand(): Promise<{ action: string; target?: string } | null> {
    return await invoke<{ action: string; target?: string } | null>("take_cli_command");
  },
};
