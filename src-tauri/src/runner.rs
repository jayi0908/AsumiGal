use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager, command};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::thread;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

#[derive(serde::Deserialize)]
pub struct WineConfig {
    pub bottle_path: String,
    pub game_exe: String,
    pub crossover_app_path: String,
    pub run_mode: Option<String>,
    pub dry_run_active: Option<bool>,
    pub command_args: Option<String>,
    pub env_vars: Option<String>,
    pub work_dir: Option<String>,
    /// 用户自定义截图根目录（空 = 使用可执行文件所在目录/screen_shots 默认规则）
    pub screenshot_dir: Option<String>,
    /// 截图目标应用："game"（默认，实例游戏程序）| "focused"（当前焦点应用）
    pub screenshot_target: Option<String>,
    /// 区域语言："zh_CN.UTF-8" | "ja_JP.UTF-8" | "en_US.UTF-8"
    pub locale: Option<String>,
    /// Wine 调试日志级别："-all" | "+err,+warn"
    pub wine_debug: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct GameFinishedPayload {
    instance_id: String,
    duration_sec: u64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameLogLinePayload {
    pub instance_id: String,
    pub timestamp: String,
    pub level: String,
    pub line: String,
}

const MAX_LOG_LINES_PER_INSTANCE: usize = 800;

static INSTANCE_LOGS: OnceLock<Mutex<HashMap<String, Vec<GameLogLinePayload>>>> = OnceLock::new();

fn instance_logs() -> &'static Mutex<HashMap<String, Vec<GameLogLinePayload>>> {
    INSTANCE_LOGS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_hms() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 转为东八区或本地简单 HH:MM:SS（使用 date 命令兜底）
    let h = ((secs + 8 * 3600) % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

fn classify_log_level(line: &str) -> &'static str {
    let lower = line.to_lowercase();
    if lower.contains("err:") || lower.contains("error") || lower.contains("exception") || lower.contains("fatal") || lower.contains("失败") {
        "error"
    } else if lower.contains("warn:") || lower.contains("warning") || lower.contains("fixme:") {
        "warn"
    } else if lower.starts_with("[asumigal]") {
        "system"
    } else {
        "info"
    }
}

pub fn append_instance_log(app: Option<&AppHandle>, instance_id: &str, line: impl Into<String>) {
    let line_str = line.into();
    if line_str.trim().is_empty() {
        return;
    }
    let level = classify_log_level(&line_str).to_string();
    let entry = GameLogLinePayload {
        instance_id: instance_id.to_string(),
        timestamp: now_hms(),
        level,
        line: line_str,
    };

    if let Ok(mut map) = instance_logs().lock() {
        let vec = map.entry(instance_id.to_string()).or_default();
        if vec.len() >= MAX_LOG_LINES_PER_INSTANCE {
            let drain_count = vec.len() - MAX_LOG_LINES_PER_INSTANCE + 1;
            vec.drain(0..drain_count);
        }
        vec.push(entry.clone());
    }

    if let Some(handle) = app {
        let _ = handle.emit("game-log-line", entry);
    }
}

#[command]
pub fn get_instance_logs(instance_id: String) -> Vec<GameLogLinePayload> {
    instance_logs()
        .lock()
        .ok()
        .and_then(|map| map.get(&instance_id).cloned())
        .unwrap_or_default()
}

#[command]
pub fn clear_instance_logs(instance_id: String) {
    if let Ok(mut map) = instance_logs().lock() {
        map.remove(&instance_id);
    }
}

#[derive(Clone)]
struct RunningInstance {
    launcher_pid: u32,
    run_mode: String,
    game_exe: String,
    screenshot_dir: String,
    screenshot_target: String,
    /// 追踪到的「真正运行的游戏进程」pid（Loader 场景下与 game_exe 不同）
    real_pids: Vec<u32>,
}

#[derive(Clone)]
struct ProcessInfo {
    pid: u32,
    ppid: u32,
    command: String,
}

#[derive(Clone, Debug)]
pub struct TrackedInstance {
    pub instance_id: String,
    pub run_mode: String,
    pub game_exe: String,
    /// 用户自定义截图根目录（空 = 默认规则）
    pub screenshot_dir: String,
    /// 截图目标应用："game"（默认）| "focused"
    pub screenshot_target: String,
    /// 追踪到的「真正运行的游戏进程」pid
    pub real_pids: Vec<u32>,
}

pub fn get_running_instances() -> Vec<TrackedInstance> {
    running_instances()
        .lock()
        .ok()
        .map(|map| {
            map.iter()
                .map(|(id, info)| TrackedInstance {
                    instance_id: id.clone(),
                    run_mode: info.run_mode.clone(),
                    game_exe: info.game_exe.clone(),
                    screenshot_dir: info.screenshot_dir.clone(),
                    screenshot_target: info.screenshot_target.clone(),
                    real_pids: info.real_pids.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

static RUNNING_INSTANCES: OnceLock<Mutex<HashMap<String, RunningInstance>>> = OnceLock::new();

fn running_instances() -> &'static Mutex<HashMap<String, RunningInstance>> {
    RUNNING_INSTANCES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn track_running_instance(
    instance_id: &str,
    launcher_pid: u32,
    run_mode: &str,
    game_exe: &str,
    screenshot_dir: &str,
    screenshot_target: &str,
) {
    if let Ok(mut map) = running_instances().lock() {
        map.insert(
            instance_id.to_string(),
            RunningInstance {
                launcher_pid,
                run_mode: run_mode.to_string(),
                game_exe: game_exe.to_string(),
                screenshot_dir: screenshot_dir.to_string(),
                screenshot_target: screenshot_target.to_string(),
                real_pids: Vec::new(),
            },
        );
    }
}

/// 更新某实例追踪到的真实游戏进程 pid
fn update_running_instance_real_pids(instance_id: &str, pids: Vec<u32>) {
    if let Ok(mut map) = running_instances().lock() {
        if let Some(info) = map.get_mut(instance_id) {
            info.real_pids = pids;
        }
    }
}

fn get_tracked_instance(instance_id: &str) -> Option<RunningInstance> {
    running_instances()
        .lock()
        .ok()
        .and_then(|map| map.get(instance_id).cloned())
}

fn remove_running_instance(instance_id: &str) {
    if let Ok(mut map) = running_instances().lock() {
        map.remove(instance_id);
    }
}

fn parse_ps_line(line: &str) -> Option<ProcessInfo> {
    let mut rest = line.trim_start();
    if rest.is_empty() {
        return None;
    }

    let pid_end = rest.find(char::is_whitespace)?;
    let pid = rest[..pid_end].parse::<u32>().ok()?;
    rest = rest[pid_end..].trim_start();

    let ppid_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let ppid = rest[..ppid_end].parse::<u32>().ok()?;
    let command = if ppid_end < rest.len() {
        rest[ppid_end..].trim_start().to_string()
    } else {
        String::new()
    };

    Some(ProcessInfo { pid, ppid, command })
}

fn list_processes() -> Result<Vec<ProcessInfo>, String> {
    let output = Command::new("ps")
        .args(["-axww", "-o", "pid=,ppid=,command="])
        .output()
        .map_err(|e| format!("读取进程列表失败: {}", e))?;

    if !output.status.success() {
        return Err(format!("读取进程列表失败，退出码: {}", output.status));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut processes = Vec::new();
    for line in stdout.lines() {
        if let Some(p) = parse_ps_line(line) {
            processes.push(p);
        }
    }
    Ok(processes)
}

fn build_children_map(processes: &[ProcessInfo]) -> HashMap<u32, Vec<u32>> {
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in processes {
        children_map.entry(p.ppid).or_default().push(p.pid);
    }
    children_map
}

fn collect_descendants(root_pid: u32, children_map: &HashMap<u32, Vec<u32>>) -> Vec<u32> {
    let mut stack = vec![root_pid];
    let mut visited: HashSet<u32> = HashSet::new();
    let mut descendants = Vec::new();

    while let Some(pid) = stack.pop() {
        if let Some(children) = children_map.get(&pid) {
            for &child in children {
                if visited.insert(child) {
                    descendants.push(child);
                    stack.push(child);
                }
            }
        }
    }

    descendants
}

fn send_signal(pid: u32, signal: &str) -> bool {
    Command::new("kill")
        .arg(signal)
        .arg(pid.to_string())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn terminate_pids(mut pids: Vec<u32>) -> Vec<u32> {
    pids.sort_unstable();
    pids.dedup();

    let mut signaled = Vec::new();
    for pid in pids {
        if send_signal(pid, "-TERM") {
            signaled.push(pid);
        } else if send_signal(pid, "-KILL") {
            signaled.push(pid);
        }
    }
    signaled
}

fn is_wine_wrapper_command(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    lower.contains("winewrapper.exe")
        || lower.contains("/crossover/lib/wine/")
        || lower.contains("wineserver")
}

fn looks_like_windows_game_process(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    lower.contains(".exe") && !is_wine_wrapper_command(&lower)
}

/// 命令行是否为 CrossOver 中的 Windows 程序进程：
/// 形如 "C:\\...\\game.exe" 或 "winewrapper.exe --run -- ..."，且非 wine 系统目录。
/// 注意：CrossOver 的 Windows 进程 ppid 均为 1，只能靠命令行匹配来追踪。
fn looks_like_wine_exe_process(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    lower.contains(".exe") && !lower.contains("c:\\windows\\") && !lower.contains("wineserver")
}

/// 命令行是否对应该 exe（macOS 路径、Windows 路径候选或文件名）
fn wrapper_matches_exe(cmd: &str, exe_path: &Path, win_candidates: &[String]) -> bool {
    let exe_str = exe_path.to_string_lossy().to_string();
    if !exe_str.is_empty() && cmd.contains(&exe_str) {
        return true;
    }
    let name_lower = exe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !name_lower.is_empty() && cmd.to_lowercase().contains(&name_lower) {
        return true;
    }
    let cmd_norm = normalize_windows_path_for_match(cmd);
    win_candidates
        .iter()
        .any(|w| !w.is_empty() && cmd_norm.contains(&w.to_lowercase()))
}

/// 进程是否存活（kill(pid, 0)，不读取进程表，开销极小）
fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

/// 快照当前所有「疑似 Windows 程序」进程 pid（启动前已存在的属于其他会话）
fn list_existing_wine_exe_pids() -> HashSet<u32> {
    list_processes()
        .map(|procs| {
            procs
                .into_iter()
                .filter(|p| looks_like_wine_exe_process(&p.command))
                .map(|p| p.pid)
                .collect()
        })
        .unwrap_or_default()
}


/// 定位实际在运行游戏的相关进程树（自身 + 子孙 + 最多 5 层祖先，
/// 以覆盖 Cider 宿主进程代为绘窗口的场景）。返回空 vec 表示未找到。
pub fn find_game_process_pids(run_mode: &str, executable_path: &str) -> Vec<u32> {
    let exe = expand_tilde(executable_path.trim());
    let exe_str = exe.to_string_lossy().to_string();
    let exe_name_lower = exe
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    if exe_str.is_empty() || exe_name_lower.is_empty() {
        return Vec::new();
    }

    let processes = match list_processes() {
        Ok(p) if !p.is_empty() => p,
        _ => return Vec::new(),
    };
    let children_map = build_children_map(&processes);
    let parent_of: HashMap<u32, u32> = processes.iter().map(|p| (p.pid, p.ppid)).collect();

    let mut roots: Vec<u32> = Vec::new();
    match run_mode {
        "direct" => {
            roots = processes
                .iter()
                .filter(|p| p.command.contains(&exe_str))
                .map(|p| p.pid)
                .collect();
        }
        "parallels" => {
            // PD 窗口由 Parallels Desktop 进程渲染，走 owner 名称匹配即可
        }
        _ => {
            let wine_roots: Vec<u32> = processes
                .iter()
                .filter(|p| {
                    let cmd_lower = p.command.to_lowercase();
                    is_wine_wrapper_command(&p.command)
                        && (p.command.contains(&exe_str) || cmd_lower.contains(&exe_name_lower))
                })
                .map(|p| p.pid)
                .collect();

            if wine_roots.is_empty() {
                // 兜底：直接找命令行以该 exe 结尾的 Windows 游戏进程
                for p in &processes {
                    if looks_like_windows_game_process(&p.command)
                        && p.command.to_lowercase().ends_with(&exe_name_lower)
                    {
                        roots.push(p.pid);
                    }
                }
            } else {
                roots = wine_roots;
            }
        }
    }

    let mut set: HashSet<u32> = HashSet::new();
    let mut stack: Vec<u32> = roots;
    while let Some(pid) = stack.pop() {
        if !set.insert(pid) {
            continue;
        }
        if let Some(children) = children_map.get(&pid) {
            for &c in children {
                if !set.contains(&c) {
                    stack.push(c);
                }
            }
        }
        // 向上追溯父链，纳入代为绘窗的宿主进程
        let mut cur = parent_of.get(&pid).copied();
        let mut depth = 0;
        while let Some(ppid) = cur {
            if depth >= 5 || ppid == 0 || ppid == 1 {
                break;
            }
            if !set.insert(ppid) {
                break;
            }
            cur = parent_of.get(&ppid).copied();
            depth += 1;
        }
    }

    set.into_iter().collect()
}

fn normalize_windows_path_for_match(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

fn canonicalize_or_original(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn build_wine_windows_path_candidates(game_exe: &Path, bottle_path: &Path) -> Vec<String> {
    let mut candidates = Vec::new();
    let game_exe_abs = canonicalize_or_original(game_exe);
    let dosdevices_dir = bottle_path.join("dosdevices");

    if let Ok(entries) = fs::read_dir(&dosdevices_dir) {
        for entry in entries.flatten() {
            let drive_name = entry.file_name().to_string_lossy().to_string();
            if drive_name.len() != 2 || !drive_name.ends_with(':') {
                continue;
            }

            let mut chars = drive_name.chars();
            let drive = match chars.next() {
                Some(c) if c.is_ascii_alphabetic() => c.to_ascii_uppercase(),
                _ => continue,
            };

            let link_path = entry.path();
            let link_target = match fs::read_link(&link_path) {
                Ok(t) => t,
                Err(_) => continue,
            };

            let mut unix_base = if link_target.is_absolute() {
                link_target
            } else {
                dosdevices_dir.join(link_target)
            };

            unix_base = canonicalize_or_original(&unix_base);

            if !game_exe_abs.starts_with(&unix_base) {
                continue;
            }

            let rel = match game_exe_abs.strip_prefix(&unix_base) {
                Ok(r) => r,
                Err(_) => continue,
            };

            let rel_win = rel
                .to_string_lossy()
                .replace('/', "\\")
                .trim_start_matches('\\')
                .to_string();

            let win_path = if rel_win.is_empty() {
                format!("{}:\\", drive)
            } else {
                format!("{}:\\{}", drive, rel_win)
            };

            candidates.push(win_path);
        }
    }

    if candidates.is_empty() && game_exe_abs.is_absolute() {
        let rel_win = game_exe_abs
            .to_string_lossy()
            .replace('/', "\\")
            .trim_start_matches('\\')
            .to_string();
        if !rel_win.is_empty() {
            candidates.push(format!("Z:\\{}", rel_win));
        }
    }

    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

fn stop_direct_instance(
    _launcher_pid: Option<u32>,
    app_path: &Path,
    processes: &[ProcessInfo],
) -> Result<Vec<u32>, String> {
    let app_path_str = app_path.to_string_lossy().to_string();
    if app_path_str.is_empty() {
        return Err("无法解析 .app 路径".to_string());
    }

    let mut candidates = Vec::new();
    for p in processes {
        if p.command.contains(&app_path_str) {
            candidates.push(p.pid);
        }
    }

    let pkill_status = Command::new("pkill")
        .arg("-f")
        .arg(&app_path_str)
        .status()
        .map_err(|e| format!("执行 pkill 失败: {}", e))?;

    if !pkill_status.success() {
        return Err("未找到可终止的原生运行进程".to_string());
    }

    candidates.sort_unstable();
    candidates.dedup();
    Ok(candidates)
}

fn stop_crossover_instance(
    launcher_pid: Option<u32>,
    game_exe: &Path,
    bottle_path: &Path,
    processes: &[ProcessInfo],
) -> Result<Vec<u32>, String> {
    let children_map = build_children_map(processes);
    let mut launcher_pids = Vec::new();

    if let Some(pid) = launcher_pid {
        launcher_pids.push(pid);
    }

    let game_exe_str = game_exe.to_string_lossy().to_string();
    let game_exe_name_lower = game_exe
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    for p in processes {
        let cmd_lower = p.command.to_lowercase();
        if is_wine_wrapper_command(&p.command)
            && (p.command.contains(&game_exe_str)
                || (!game_exe_name_lower.is_empty() && cmd_lower.contains(&game_exe_name_lower)))
        {
            launcher_pids.push(p.pid);
        }
    }

    launcher_pids.sort_unstable();
    launcher_pids.dedup();

    if launcher_pids.is_empty() {
        return Err("未找到 CrossOver 启动器进程，无法定位运行进程".to_string());
    }

    let mut candidates = Vec::new();
    let windows_path_candidates = build_wine_windows_path_candidates(game_exe, bottle_path)
        .into_iter()
        .map(|p| normalize_windows_path_for_match(&p))
        .collect::<Vec<_>>();

    for pid in launcher_pids {
        let descendants = collect_descendants(pid, &children_map);
        for dpid in descendants {
            if let Some(proc_info) = processes.iter().find(|p| p.pid == dpid) {
                if looks_like_windows_game_process(&proc_info.command) {
                    candidates.push(dpid);
                }
            }
        }
    }

    if candidates.is_empty() {
        let exe_name_lower = game_exe
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        for p in processes {
            if !looks_like_windows_game_process(&p.command) {
                continue;
            }

            let cmd_norm = normalize_windows_path_for_match(&p.command);

            let path_hit = windows_path_candidates.iter().any(|w| {
                cmd_norm == *w || cmd_norm.ends_with(w) || cmd_norm.contains(w)
            });

            let exe_hit = !exe_name_lower.is_empty() && cmd_norm.ends_with(&exe_name_lower);

            if path_hit || exe_hit {
                candidates.push(p.pid);
            }
        }
    }

    if candidates.is_empty() {
        return Err("找到了启动器，但未定位到实际运行进程（已尝试全局回退匹配）".to_string());
    }

    let killed = terminate_pids(candidates);
    if killed.is_empty() {
        return Err("未能成功终止任何运行进程".to_string());
    }

    Ok(killed)
}

// 如果字符串以 ~/ 开头，则将其替换为真实的系统家目录
pub(crate) fn expand_tilde(path_str: &str) -> PathBuf {
    if path_str.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            // 去掉前缀 "~/"，把剩下的部分拼接到 home 目录后面
            return home.join(path_str.trim_start_matches("~/"));
        }
    }
    // 如果没有 ~，或者获取 Home 目录失败，直接返回原路径
    PathBuf::from(path_str)
}

// 将命令行参数字符串按 shell 规则拆分（支持单引号、双引号、转义），
// 返回可直接传给子进程的参数列表
fn shell_split(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut has_token = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
                has_token = true;
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
                has_token = true;
            }
            '\\' if !in_single_quote => {
                match chars.peek() {
                    Some(&next) if next == '"' || next == '\\' || next == '\'' || next.is_whitespace() => {
                        current.push(next);
                        chars.next();
                    }
                    _ => {
                        // 其他字符（如 Windows 路径 C:\Program）保持反斜杠原样
                        current.push('\\');
                    }
                }
                has_token = true;
            }
            c if c.is_whitespace() && !in_single_quote && !in_double_quote => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }

    if has_token {
        args.push(current);
    }

    args
}

#[command]
pub fn get_crossover_bottles(path: String) -> Result<Vec<String>, String> {
    let bottles_path = expand_tilde(&path);

    if !bottles_path.exists() {
        return Err(format!("未找到容器目录: {:?}", bottles_path));
    }

    let mut bottles = Vec::new();

    let entries = fs::read_dir(bottles_path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                bottles.push(name.to_string());
            }
        }
    }

    Ok(bottles)
}

fn extract_vm_name(path: &str) -> Option<String> {
    let path_obj = Path::new(path);
    if let Some(file_name) = path_obj.file_name().and_then(|n| n.to_str()) {
        if let Some(idx) = file_name.find(" Applications.localized") {
            return Some(file_name[..idx].to_string());
        }
        if let Some(idx) = file_name.find(" Applications") {
            return Some(file_name[..idx].to_string());
        }
    }
    None
}

fn resolve_prlctl_bin() -> &'static str {
    if Path::new("/usr/local/bin/prlctl").exists() {
        "/usr/local/bin/prlctl"
    } else if Path::new("/Applications/Parallels Desktop.app/Contents/MacOS/prlctl").exists() {
        "/Applications/Parallels Desktop.app/Contents/MacOS/prlctl"
    } else {
        "prlctl"
    }
}

/// 定位 Parallels 虚拟机对应的文件资源管理器代理 .app（兼容中文与英文系统）
fn find_parallels_explorer_app(vm_dir: &Path) -> Option<PathBuf> {
    for candidate in ["文件资源管理器.app", "File Explorer.app", "Windows Explorer.app"] {
        let p = vm_dir.join(candidate);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(entries) = fs::read_dir(vm_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("app") {
                return Some(p);
            }
        }
    }
    None
}

/// 检查 macOS 宿主进程表是否已存在该游戏的 Parallels 融合模式代理进程 (WinAppHelper)
fn find_parallels_host_helper_pids(exe_name_lower: &str, processes: &[ProcessInfo]) -> Vec<u32> {
    if exe_name_lower.is_empty() {
        return Vec::new();
    }
    let stem = exe_name_lower.trim_end_matches(".exe");
    processes
        .iter()
        .filter(|p| {
            let cmd = p.command.to_lowercase();
            cmd.contains("winapphelper")
                && (cmd.contains(exe_name_lower) || (!stem.is_empty() && cmd.contains(stem)))
        })
        .map(|p| p.pid)
        .collect()
}

/// 检查 Parallels 虚拟机在宿主机上是否仍在运行：
/// 先通过宿主机进程表快速判断 prl_vm_app 是否存活（零开销、不打扰 VM），
/// 找不到时再用 `prlctl status`（宿主机侧查询，不进入 Guest OS）兜底。
fn is_parallels_vm_running_on_host(vm_name: &str, processes: &[ProcessInfo]) -> bool {
    let vm_trimmed = vm_name.trim_matches(|c| c == '{' || c == '}').to_lowercase();
    let has_vm_proc = processes.iter().any(|p| {
        let cmd = p.command.to_lowercase();
        (cmd.contains("prl_vm_app") || cmd.contains("parallels desktop"))
            && (vm_trimmed.is_empty() || cmd.contains(&vm_trimmed) || cmd.contains("prl_vm_app"))
    });
    if has_vm_proc && vm_name.is_empty() {
        return true;
    }
    if !vm_name.is_empty() {
        if let Ok(out) = Command::new(resolve_prlctl_bin())
            .args(["status", vm_name])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
            // "exist running" 表示正在运行；suspended / stopped / paused 均视为非运行
            return s.contains("running");
        }
    }
    has_vm_proc
}

#[command]
pub async fn launch_game(app: AppHandle, instance_id: String, config: WineConfig) -> Result<u32, String> {
    println!("正在启动实例 ID: {}, 路径: {}", instance_id, config.game_exe);
    let mode = config.run_mode.as_deref().unwrap_or("crossover");
    append_instance_log(
        Some(&app),
        &instance_id,
        format!("[AsumiGal] 准备启动实例 (模式: {}, 路径: {})", mode, config.game_exe),
    );

    if mode == "parallels" {
        let vm_dir = expand_tilde(&config.bottle_path);
        let vm_app_path = find_parallels_explorer_app(&vm_dir).ok_or_else(|| {
            let msg = format!("找不到 Parallels 虚拟机应用目录或代理启动器: {:?}", vm_dir);
            append_instance_log(Some(&app), &instance_id, format!("[AsumiGal] 错误: {}", msg));
            msg
        })?;

        let exe_path = expand_tilde(&config.game_exe);
        if !exe_path.exists() {
            let msg = format!("找不到可执行文件，可能位于外接硬盘但未连接，请检查磁盘连接情况: {:?}", config.game_exe);
            append_instance_log(Some(&app), &instance_id, format!("[AsumiGal] 错误: {}", msg));
            return Err(msg);
        }

        // 获取要轮询的虚拟机名字和进程名
        let exe_name = exe_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let vm_name = extract_vm_name(&config.bottle_path).unwrap_or_else(|| "".to_string());
        append_instance_log(
            Some(&app),
            &instance_id,
            format!("[AsumiGal] 通过 Parallels 代理拉起: VM={}, EXE={}", vm_name, exe_name),
        );

        let mut child = Command::new("open")
            .arg("-a")
            .arg(&vm_app_path)
            .arg(&exe_path)
            .spawn()
            .map_err(|e| format!("无法启动 Parallels Desktop 实例: {}", e))?;

        let pid = child.id();
        let exe_for_track = exe_path.to_string_lossy().to_string();
        track_running_instance(
            &instance_id,
            pid,
            "parallels",
            &exe_for_track,
            config.screenshot_dir.as_deref().unwrap_or("").trim(),
            config.screenshot_target.as_deref().unwrap_or("game"),
        );

        if !config.dry_run_active.unwrap_or(false) {
            let app_handle = app.clone();
            let i_id = instance_id.clone();

            thread::spawn(move || {
                let start_time = Instant::now();
                let _ = child.wait();

                // 给 Parallels Desktop 启动虚拟机、挂载共享盘以及拉起游戏预留 15 秒缓冲
                thread::sleep(Duration::from_secs(15));

                if !vm_name.is_empty() && !exe_name.is_empty() {
                    let prlctl_bin = resolve_prlctl_bin();
                    let exe_name_lower = exe_name.to_lowercase();
                    // Windows tasklist /FI "IMAGENAME eq xxx" 精确过滤，且 /NH 免表头减少输出体积
                    let filter_arg = format!("IMAGENAME eq {}", exe_name);
                    // 兼容进程名超长被截断的场景（前 25 字符匹配）
                    let search_name: String = exe_name_lower.chars().take(25).collect();

                    let mut miss_count = 0u32;
                    let mut last_guest_poll: Option<Instant> = None;
                    // 关键优化：Guest 内部 prlctl exec 轮询间隔放宽到 20 秒，避免频繁在 Windows 内拉起 conhost/tasklist 造成游戏掉帧卡顿
                    let guest_poll_interval = Duration::from_secs(20);
                    let host_tick = Duration::from_secs(3);

                    loop {
                        // 实例如果已被手动停止（从 RUNNING_INSTANCES 移除），立即退出监听线程
                        if get_tracked_instance(&i_id).is_none() {
                            return;
                        }

                        let host_procs = list_processes().unwrap_or_default();

                        // 1) 宿主机侧零打扰检查：如果整个虚拟机已挂起或关闭，直接判定游戏结束
                        if !is_parallels_vm_running_on_host(&vm_name, &host_procs) {
                            append_instance_log(Some(&app_handle), &i_id, "[AsumiGal] 检测到 Parallels 虚拟机已挂起或关闭");
                            break;
                        }

                        // 2) 宿主机侧零打扰检查（Coherence 融合模式）：
                        //    如果宿主机能直接看到该游戏的 WinAppHelper 代理进程，说明游戏一定还在运行，无需执行 prlctl exec 打扰虚拟机！
                        let helper_pids = find_parallels_host_helper_pids(&exe_name_lower, &host_procs);
                        if !helper_pids.is_empty() {
                            miss_count = 0;
                            update_running_instance_real_pids(&i_id, helper_pids);
                            thread::sleep(host_tick);
                            continue;
                        }

                        // 3) 非融合模式或无宿主代理进程时，仅每 20 秒执行一次轻量级定向查询：
                        //    使用 `tasklist /NH /FI "IMAGENAME eq <exe>"` 替代全量 `tasklist`
                        let should_poll_guest = last_guest_poll
                            .map(|t| t.elapsed() >= guest_poll_interval)
                            .unwrap_or(true);

                        if should_poll_guest {
                            last_guest_poll = Some(Instant::now());
                            let output = Command::new(prlctl_bin)
                                .args(["exec", &vm_name, "tasklist", "/NH", "/FI", &filter_arg])
                                .output();

                            match output {
                                Ok(out) => {
                                    let stdout = String::from_utf8_lossy(&out.stdout).to_lowercase();
                                    if stdout.contains(&search_name) {
                                        miss_count = 0;
                                    } else {
                                        miss_count += 1;
                                    }
                                }
                                Err(_) => {
                                    miss_count += 1;
                                }
                            }

                            // 连续 2 次（间隔 20s）确认进程不存在，判定游戏已关闭
                            if miss_count >= 2 {
                                break;
                            }
                        }

                        thread::sleep(host_tick);
                    }
                }

                let duration = start_time.elapsed().as_secs();
                println!("游戏 {} 已退出，总时长: {}秒", i_id, duration);
                append_instance_log(
                    Some(&app_handle),
                    &i_id,
                    format!("[AsumiGal] 实例运行结束，本次游玩时长 {} 秒", duration),
                );
                remove_running_instance(&i_id);
                let _ = app_handle.emit("game-finished", GameFinishedPayload {
                    instance_id: i_id,
                    duration_sec: duration
                });
            });
        }

        return Ok(pid);
    }
    else if mode == "direct" {
        // 如果 bottle_path 不为空且不是 "Default"，则说明指定了前置执行脚本
        if !config.bottle_path.is_empty() && config.bottle_path != "Default" {
            let script_name = config.bottle_path.trim();
            if !script_name.contains('/') && !script_name.contains('\\') && !script_name.contains("..") {
                if let Ok(script_dir) = app.path().resolve("scripts", tauri::path::BaseDirectory::AppLocalData) {
                    let script_path = script_dir.join(format!("{}.sh", script_name));
                    if script_path.exists() {
                        append_instance_log(
                            Some(&app),
                            &instance_id,
                            format!("[AsumiGal] 执行前置脚本: {:?}", script_path),
                        );
                        match Command::new("sh").arg(&script_path).output() {
                            Ok(out) => {
                                for line in String::from_utf8_lossy(&out.stdout).lines() {
                                    append_instance_log(Some(&app), &instance_id, line);
                                }
                                for line in String::from_utf8_lossy(&out.stderr).lines() {
                                    append_instance_log(Some(&app), &instance_id, line);
                                }
                                if !out.status.success() {
                                    append_instance_log(
                                        Some(&app),
                                        &instance_id,
                                        format!("[AsumiGal] 脚本执行失败，退出码: {:?}", out.status.code()),
                                    );
                                } else {
                                    append_instance_log(Some(&app), &instance_id, "[AsumiGal] 前置脚本执行完成");
                                }
                            }
                            Err(e) => {
                                append_instance_log(
                                    Some(&app),
                                    &instance_id,
                                    format!("[AsumiGal] 无法执行脚本: {}", e),
                                );
                            }
                        }
                    }
                }
            }
        }

        let app_path = expand_tilde(&config.game_exe);
        if !app_path.exists() {
            let msg = format!("找不到指定的原生应用: {:?}", app_path);
            append_instance_log(Some(&app), &instance_id, format!("[AsumiGal] 错误: {}", msg));
            return Err(msg);
        }

        let mut child = Command::new("open")
            .arg("-W") // -W 阻塞等待应用被关闭
            .arg(&app_path)
            .spawn()
            .map_err(|e| format!("无法启动应用: {}", e))?;

        let pid = child.id();
        let exe_for_track = app_path.to_string_lossy().to_string();
        track_running_instance(
            &instance_id,
            pid,
            "direct",
            &exe_for_track,
            config.screenshot_dir.as_deref().unwrap_or("").trim(),
            config.screenshot_target.as_deref().unwrap_or("game"),
        );

        if !config.dry_run_active.unwrap_or(false) {
            let app_handle = app.clone();
            let i_id = instance_id.clone();

            thread::spawn(move || {
                let start_time = Instant::now();
                let _ = child.wait();
                let duration = start_time.elapsed().as_secs();
                println!("游戏 {} 已退出，总时长: {}秒", i_id, duration);
                append_instance_log(
                    Some(&app_handle),
                    &i_id,
                    format!("[AsumiGal] 原生应用已退出，本次游玩时长 {} 秒", duration),
                );
                remove_running_instance(&i_id);
                let _ = app_handle.emit("game-finished", GameFinishedPayload {
                    instance_id: i_id,
                    duration_sec: duration,
                });
            });
        }

        return Ok(pid);
    }

    let game_path = expand_tilde(&config.game_exe);
    if !game_path.exists() {
        let msg = format!("找不到可执行文件，可能位于外接硬盘但未连接，请检查磁盘连接情况: {:?}", config.game_exe);
        append_instance_log(Some(&app), &instance_id, format!("[AsumiGal] 错误: {}", msg));
        return Err(msg);
    }

    // 定位 CrossOver
    let crossover_app_dir = expand_tilde(&config.crossover_app_path);
    let crossover_bin = crossover_app_dir.join("Contents/SharedSupport/CrossOver/bin/wine");

    if !crossover_bin.exists() {
        let msg = format!("未找到 CrossOver 核心文件，请检查设置路径: {:?}", crossover_bin);
        append_instance_log(Some(&app), &instance_id, format!("[AsumiGal] 错误: {}", msg));
        return Err(msg);
    }

    // 解析容器名
    let bottle_path_buf = expand_tilde(&config.bottle_path);
    let bottle_name = bottle_path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法解析容器名称")?;

    let locale_val = config
        .locale
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("zh_CN.UTF-8");
    let wine_debug_val = config
        .wine_debug
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("-all");

    // 构建命令
    let mut cmd = Command::new(&crossover_bin);
    cmd.env("CX_BOTTLE", bottle_name);
    cmd.env("WINEPREFIX", &bottle_path_buf);
    cmd.env("LC_ALL", locale_val);
    cmd.env("LANG", locale_val);
    cmd.env("WINEDEBUG", wine_debug_val);

    // 附加环境变量（支持空格或换行分隔的 KEY=VALUE 形式）
    if let Some(env_vars) = &config.env_vars {
        let parsed = if env_vars.contains('\n') {
            env_vars.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
        } else {
            env_vars.clone()
        };
        for kv in shell_split(&parsed) {
            if let Some((k, v)) = kv.split_once('=') {
                cmd.env(k.trim(), v.trim());
            }
        }
    }

    // 工作目录：优先用户指定，否则默认使用可执行文件所在目录
    let work_dir = match config.work_dir.as_ref() {
        Some(wd) if !wd.trim().is_empty() => Some(wd.trim().to_string()),
        _ => game_path.parent().map(|p| p.to_string_lossy().into_owned()),
    };
    if let Some(wd) = &work_dir {
        cmd.arg("--workdir").arg(wd);
    }

    cmd.arg(&game_path);

    // 命令行参数透传给 Windows 应用
    if let Some(args_str) = &config.command_args {
        for arg in shell_split(args_str) {
            cmd.arg(arg);
        }
    }

    append_instance_log(
        Some(&app),
        &instance_id,
        format!(
            "[AsumiGal] CrossOver 启动参数: Bottle={}, LC_ALL={}, WINEDEBUG={}, WorkDir={}",
            bottle_name,
            locale_val,
            wine_debug_val,
            work_dir.as_deref().unwrap_or("(default)")
        ),
    );

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // 启动子进程
    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("启动失败: {}", e);
        append_instance_log(Some(&app), &instance_id, format!("[AsumiGal] 错误: {}", msg));
        msg
    })?;
    let pid = child.id();
    append_instance_log(
        Some(&app),
        &instance_id,
        format!("[AsumiGal] CrossOver 引导进程已拉起 (PID: {})", pid),
    );

    if let Some(stdout) = child.stdout.take() {
        let app_out = app.clone();
        let id_out = instance_id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                append_instance_log(Some(&app_out), &id_out, line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_err = app.clone();
        let id_err = instance_id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                append_instance_log(Some(&app_err), &id_err, line);
            }
        });
    }
    let exe_for_track = game_path.to_string_lossy().to_string();
    track_running_instance(
        &instance_id,
        pid,
        "crossover",
        &exe_for_track,
        config.screenshot_dir.as_deref().unwrap_or("").trim(),
        config.screenshot_target.as_deref().unwrap_or("game"),
    );
    
    if !config.dry_run_active.unwrap_or(false) {
        let app_handle = app.clone();
        let i_id = instance_id.clone();
        let loader_path = game_path.clone();
        let thread_bottle = bottle_path_buf.clone();

        thread::spawn(move || {
            let mut child = child;
            let start_time = Instant::now();
            let loader_win_candidates: Vec<String> =
                build_wine_windows_path_candidates(&loader_path, &thread_bottle)
                    .into_iter()
                    .map(|p| normalize_windows_path_for_match(&p))
                    .collect();
            // 启动前已存在的 Windows 进程属于其他会话，排除
            let pre_exe_pids = list_existing_wine_exe_pids();
            let mut loader_pids: HashSet<u32> = HashSet::new();
            let mut real_pids: HashSet<u32> = HashSet::new();
            let mut continue_logged = false;
            let mut empty_confirmations = 0u32;

            // 内存/CPU 优化：仅在需要时做全量进程扫描，其余时间用 kill(pid,0) 做存活检查
            // - 每 3s 全量扫描一次（发现真实游戏 / 刷新 loader 存活）
            // - 每 1s 廉价存活检查
            // - 追踪集合为空时立即全量扫描确认（避免漏掉刚启动的真实游戏）
            let scan_interval = Duration::from_secs(3);
            let tick = Duration::from_secs(1);
            let mut last_scan: Option<Instant> = None;

            loop {
                let tracked_empty = loader_pids.is_empty() && real_pids.is_empty();
                let scan_due = last_scan
                    .map(|t| t.elapsed() >= scan_interval)
                    .unwrap_or(true);

                if scan_due || tracked_empty {
                    let processes = list_processes().unwrap_or_default();
                    let alive: HashSet<u32> = processes.iter().map(|p| p.pid).collect();
                    loader_pids.retain(|p| alive.contains(p));
                    real_pids.retain(|p| alive.contains(p));

                    let other_exe_names: Vec<String> = get_running_instances()
                        .into_iter()
                        .filter(|i| i.instance_id != i_id)
                        .filter_map(|i| {
                            Path::new(&i.game_exe)
                                .file_name()
                                .map(|n| n.to_string_lossy().to_lowercase())
                        })
                        .filter(|n| !n.is_empty())
                        .collect();

                    for p in &processes {
                        if !looks_like_wine_exe_process(&p.command) {
                            continue;
                        }
                        // 先判定 launcher（Loader），避免被“启动前快照”误排除
                        if wrapper_matches_exe(&p.command, &loader_path, &loader_win_candidates) {
                            loader_pids.insert(p.pid);
                            continue;
                        }
                        if pre_exe_pids.contains(&p.pid) {
                            continue;
                        }
                        let cmd_lower = p.command.to_lowercase();
                        // 排除其他实例的游戏进程
                        if other_exe_names.iter().any(|n| cmd_lower.contains(n)) {
                            continue;
                        }
                        real_pids.insert(p.pid);
                    }
                    last_scan = Some(Instant::now());
                } else {
                    loader_pids.retain(|p| process_alive(*p));
                    real_pids.retain(|p| process_alive(*p));
                }

                update_running_instance_real_pids(&i_id, real_pids.iter().copied().collect());

                if !continue_logged && loader_pids.is_empty() && !real_pids.is_empty() {
                    continue_logged = true;
                    let msg = format!(
                        "[AsumiGal] Loader 引导已移交，继续追踪真实游戏进程 {:?}（计时延续）",
                        real_pids
                    );
                    println!("{}", msg);
                    append_instance_log(Some(&app_handle), &i_id, msg);
                }

                let child_exited = match child.try_wait() {
                    Ok(Some(_)) => true,
                    Ok(None) => false,
                    Err(_) => true,
                };

                if child_exited && loader_pids.is_empty() && real_pids.is_empty() {
                    // 连续两次确认为空后再结束，给刚启动的真实游戏留出发现时间
                    empty_confirmations += 1;
                    if empty_confirmations >= 2 {
                        break;
                    }
                } else {
                    empty_confirmations = 0;
                }

                thread::sleep(tick);
            }

            let duration = start_time.elapsed().as_secs();
            println!("游戏 {} 完全退出，时长: {}秒", i_id, duration);
            append_instance_log(
                Some(&app_handle),
                &i_id,
                format!("[AsumiGal] 游戏进程已全部退出，本次游玩时长 {} 秒", duration),
            );
            remove_running_instance(&i_id);
            let _ = app_handle.emit("game-finished", GameFinishedPayload {
                instance_id: i_id,
                duration_sec: duration,
            });
        });
    }

    Ok(pid)
}

fn stop_parallels_instance(
    exe_path: &Path,
    bottle_path: &str,
    processes: &[ProcessInfo],
) -> Result<Vec<u32>, String> {
    let exe_name = exe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    if exe_name.is_empty() {
        return Err("无法解析可执行文件名称".to_string());
    }

    let vm_name = extract_vm_name(bottle_path).unwrap_or_default();
    let mut killed = Vec::new();

    // 1) 如果在融合模式下存在宿主机 WinAppHelper 代理进程，先记录并清理
    let helper_pids = find_parallels_host_helper_pids(&exe_name.to_lowercase(), processes);
    if !helper_pids.is_empty() {
        killed.extend(terminate_pids(helper_pids));
    }

    // 2) 通过 prlctl exec taskkill 终止虚拟机内的 Windows 游戏进程
    if !vm_name.is_empty() {
        let out = Command::new(resolve_prlctl_bin())
            .args(["exec", &vm_name, "taskkill", "/F", "/IM", &exe_name])
            .output()
            .map_err(|e| format!("执行 prlctl taskkill 失败: {}", e))?;

        if out.status.success() || !killed.is_empty() {
            if killed.is_empty() {
                killed.push(0);
            }
            return Ok(killed);
        }
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("未能终止 Parallels 虚拟机内的进程 {}: {}", exe_name, detail));
    }

    if killed.is_empty() {
        return Err("未找到对应的 Parallels 虚拟机或运行进程".to_string());
    }
    Ok(killed)
}

#[command]
pub async fn stop_game(instance_id: String, config: WineConfig) -> Result<Vec<u32>, String> {
    let mode = config.run_mode.as_deref().unwrap_or("crossover");

    let tracked = get_tracked_instance(&instance_id);
    if let Some(info) = tracked.as_ref() {
        if info.run_mode != mode {
            println!(
                "停止实例模式与记录不一致: tracked={}, requested={}, instance={}",
                info.run_mode, mode, instance_id
            );
        }
    }

    let processes = list_processes()?;
    let launcher_pid = tracked.as_ref().map(|i| i.launcher_pid);
    let exe_path = tracked
        .as_ref()
        .map(|i| PathBuf::from(&i.game_exe))
        .unwrap_or_else(|| expand_tilde(&config.game_exe));

    let mut killed = if mode == "direct" {
        stop_direct_instance(launcher_pid, &exe_path, &processes)?
    } else if mode == "parallels" {
        stop_parallels_instance(&exe_path, &config.bottle_path, &processes)?
    } else {
        let bottle_path = expand_tilde(&config.bottle_path);
        stop_crossover_instance(launcher_pid, &exe_path, &bottle_path, &processes)?
    };

    // Loader 场景：真正运行的游戏进程与 launcher 不同，直接终止追踪到的真实进程
    if let Some(info) = tracked.as_ref() {
        if !info.real_pids.is_empty() {
            for pid in terminate_pids(info.real_pids.clone()) {
                if !killed.contains(&pid) {
                    killed.push(pid);
                }
            }
        }
    }

    remove_running_instance(&instance_id);
    Ok(killed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wine_process_classification() {
        // 真实游戏进程（Windows 路径，非系统目录）
        assert!(looks_like_wine_exe_process(r"Z:\Volumes\Jayi\games\Game\real.exe"));
        // wine wrapper 形式的真实游戏
        assert!(looks_like_wine_exe_process(
            "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/winewrapper.exe --run -- /Volumes/Jayi/games/Game/real.exe"
        ));
        // wine 系统进程应排除
        assert!(!looks_like_wine_exe_process(r"C:\windows\system32\services.exe"));
        assert!(!looks_like_wine_exe_process(r"C:\windows\system32\conhost.exe --server 0x30"));
        // 非 exe 进程
        assert!(!looks_like_wine_exe_process("wineserver -p"));
    }

    #[test]
    fn loader_matching() {
        let loader = Path::new("/Volumes/Jayi/games/OusamaRenai/OusamaRenai_cn.exe");
        // 直接以 macOS 路径出现在 wrapper 里
        assert!(wrapper_matches_exe(
            "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/winewrapper.exe --run -- /Volumes/Jayi/games/OusamaRenai/OusamaRenai_cn.exe",
            loader,
            &[]
        ));
        // 以 Windows 路径/文件名出现
        assert!(wrapper_matches_exe(r"Z:\Volumes\Jayi\games\OusamaRenai\OusamaRenai_cn.exe", loader, &[]));
        // 另一个程序不应匹配 loader
        assert!(!wrapper_matches_exe(
            "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/winewrapper.exe --run -- /Volumes/Jayi/games/OusamaRenai/real_game.exe",
            loader,
            &[]
        ));
    }
}
