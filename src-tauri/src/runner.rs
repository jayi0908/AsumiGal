use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, command};
use std::time::Instant;
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
}

#[derive(serde::Serialize, Clone)]
struct GameFinishedPayload {
    instance_id: String,
    duration_sec: u64,
}

#[derive(Clone)]
struct RunningInstance {
    launcher_pid: u32,
    run_mode: String,
    game_exe: String,
}

#[derive(Clone)]
struct ProcessInfo {
    pid: u32,
    ppid: u32,
    command: String,
}

static RUNNING_INSTANCES: OnceLock<Mutex<HashMap<String, RunningInstance>>> = OnceLock::new();

fn running_instances() -> &'static Mutex<HashMap<String, RunningInstance>> {
    RUNNING_INSTANCES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn track_running_instance(instance_id: &str, launcher_pid: u32, run_mode: &str, game_exe: &str) {
    if let Ok(mut map) = running_instances().lock() {
        map.insert(
            instance_id.to_string(),
            RunningInstance {
                launcher_pid,
                run_mode: run_mode.to_string(),
                game_exe: game_exe.to_string(),
            },
        );
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
fn expand_tilde(path_str: &str) -> PathBuf {
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

#[command]
pub async fn launch_game(app: AppHandle, instance_id: String, config: WineConfig) -> Result<u32, String> {
    println!("正在启动实例 ID: {}, 路径: {}", instance_id, config.game_exe);
    let mode = config.run_mode.as_deref().unwrap_or("crossover");

    if mode == "parallels" {
        let vm_app_path = expand_tilde(&config.bottle_path).join("文件资源管理器.app");
        if !vm_app_path.exists() {
            return Err(format!("找不到 Parallels 虚拟机路径: {:?}", vm_app_path));
        }

        let exe_path = expand_tilde(&config.game_exe);
        if !exe_path.exists() {
            return Err(format!("找不到可执行文件，可能位于外接硬盘但未连接，请检查磁盘连接情况: {:?}", config.game_exe));
        }

        // 获取要轮询的虚拟机名字和进程名
        let exe_name = exe_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let vm_name = extract_vm_name(&config.bottle_path).unwrap_or_else(|| "".to_string());

        // 使用 open 启动，这里不再需要 -W，因为它无论如何都会闪退，我们改用手动轮询
        let mut child = Command::new("open")
            .arg("-a")
            .arg(&vm_app_path)
            .arg(&exe_path)
            .spawn()
            .map_err(|e| format!("无法启动 Parallels Desktop 实例: {}", e))?;

        let pid = child.id();
        let exe_for_track = expand_tilde(&config.game_exe).to_string_lossy().to_string();
        track_running_instance(&instance_id, pid, "parallels", &exe_for_track);

        if !config.dry_run_active.unwrap_or(false) {
            let app_handle = app.clone();
            let i_id = instance_id.clone();

            thread::spawn(move || {
                let start_time = Instant::now();
                
                // 给 Parallels Desktop 启动虚拟机、挂载网络磁盘、以及 Windows 拉起游戏预留 15 秒的缓冲时间
                thread::sleep(std::time::Duration::from_secs(15));
                
                if !vm_name.is_empty() && !exe_name.is_empty() {
                    let mut miss_count = 0;
                    let exe_name_lower = exe_name.to_lowercase();
                    
                    // Windows 的 tasklist 命令最多只显示进程名的前 25 个字符，如果太长会被截断
                    let search_name = if exe_name_lower.len() > 25 {
                        &exe_name_lower[..25]
                    } else {
                        &exe_name_lower
                    };

                    loop {
                        // 尝试通过 prlctl (Parallels 命令行工具) 直接查看虚拟机内部的进程表
                        let output = Command::new("/usr/local/bin/prlctl")
                            .arg("exec")
                            .arg(&vm_name)
                            .arg("tasklist")
                            .output()
                            .or_else(|_| {
                                // 降级：如果 /usr/local/bin 里没有，尝试通过全局 PATH 查找
                                Command::new("prlctl").arg("exec").arg(&vm_name).arg("tasklist").output()
                            });

                        match output {
                            Ok(out) => {
                                let stdout = String::from_utf8_lossy(&out.stdout).to_lowercase();
                                if stdout.contains(search_name) {
                                    miss_count = 0; // 找到了游戏进程，重置丢失计数
                                } else {
                                    miss_count += 1; // 没找到该游戏
                                }
                            },
                            Err(_) => {
                                // 执行出错 (可能是虚拟机正处于未唤醒状态/挂起状态)
                                miss_count += 1;
                            }
                        }

                        // 如果连续 3 次（15 秒）在 Windows 后台都没看到这个 exe，证明游戏被玩家关闭了
                        if miss_count >= 3 {
                            break;
                        }
                        
                        thread::sleep(std::time::Duration::from_secs(5));
                    }
                } else {
                    // 如果出异常解析不出名字，退化为旧式的 wait（立刻结束）
                    let _ = child.wait();
                }

                let duration = start_time.elapsed().as_secs();
                println!("游戏 {} 已退出，总时长: {}秒", i_id, duration);
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
            let script_dir = app.path().resolve("scripts", tauri::path::BaseDirectory::AppLocalData).unwrap();
            let script_path = script_dir.join(format!("{}.sh", config.bottle_path));
            if script_path.exists() {
                let log_path = "/tmp/asumigal_script.log";
                let log_file = std::fs::File::create(log_path).unwrap();
                match Command::new("sh")
                    .arg(&script_path)
                    .stdout(log_file.try_clone().unwrap())
                    .stderr(log_file)
                    .status()
                {
                    Ok(status) => {
                        if !status.success() {
                            println!("脚本 {:?} 执行失败，退出码: {:?}", script_path, status.code());
                        } else {
                            println!("脚本 {:?} 执行成功", script_path);
                        }
                    }
                    Err(e) => {
                        println!("无法执行脚本 {:?}: {}", script_path, e);
                    }
                }
            }
        }

        let app_path = expand_tilde(&config.game_exe);
        if !app_path.exists() {
            return Err(format!("找不到指定的原生应用: {:?}", app_path));
        }

        let mut child = Command::new("open")
            .arg("-W") // -W 阻塞等待应用被关闭
            .arg(&app_path)
            .spawn()
            .map_err(|e| format!("无法启动应用: {}", e))?;

        let pid = child.id();
        let exe_for_track = app_path.to_string_lossy().to_string();
        track_running_instance(&instance_id, pid, "direct", &exe_for_track);

        if !config.dry_run_active.unwrap_or(false) {
            let app_handle = app.clone();
            let i_id = instance_id.clone();

            thread::spawn(move || {
                let start_time = Instant::now();
                let _ = child.wait();
                let duration = start_time.elapsed().as_secs();
                println!("游戏 {} 已退出，总时长: {}秒", i_id, duration);
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
        return Err(format!("找不到可执行文件，可能位于外接硬盘但未连接，请检查磁盘连接情况: {:?}", config.game_exe));
    }

    // 定位 CrossOver
    let crossover_app_dir = expand_tilde(&config.crossover_app_path);
    let crossover_bin = crossover_app_dir.join("Contents/SharedSupport/CrossOver/bin/wine");

    if !crossover_bin.exists() {
        return Err(format!("未找到 CrossOver 核心文件，请检查设置路径: {:?}", crossover_bin));
    }

    // 解析容器名
    let bottle_path_buf = expand_tilde(&config.bottle_path);
    let bottle_name = bottle_path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法解析容器名称")?;

    // 构建命令
    let mut cmd = Command::new(&crossover_bin);
    cmd.env("CX_BOTTLE", bottle_name);
    cmd.env("WINEPREFIX", &bottle_path_buf);
    cmd.env("LC_ALL", "zh_CN.UTF-8");
    cmd.env("WINEDEBUG", "-all");

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
    // （与 CrossOver「运行程序」行为一致，确保依赖相对路径的汉化补丁与资源能被正确加载）
    let work_dir = match config.work_dir.as_ref() {
        Some(wd) if !wd.trim().is_empty() => Some(wd.trim().to_string()),
        _ => game_path.parent().map(|p| p.to_string_lossy().into_owned()),
    };
    if let Some(wd) = work_dir {
        cmd.arg("--workdir").arg(wd);
    }

    cmd.arg(&game_path);

    // 命令行参数透传给 Windows 应用
    if let Some(args_str) = &config.command_args {
        for arg in shell_split(args_str) {
            cmd.arg(arg);
        }
    }

    // 启动子进程
    let mut child = cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;
    let pid = child.id();
    let exe_for_track = game_path.to_string_lossy().to_string();
    track_running_instance(&instance_id, pid, "crossover", &exe_for_track);
    
    if !config.dry_run_active.unwrap_or(false) {
        let app_handle = app.clone();
        let i_id = instance_id.clone();
        
        thread::spawn(move || {
            let start_time = Instant::now();
            match child.wait() {
                Ok(status) => {
                    let duration = start_time.elapsed().as_secs();
                    println!("游戏 {} 已退出，状态: {}, 时长: {}秒", i_id, status, duration);
                    remove_running_instance(&i_id);
                    let _ = app_handle.emit("game-finished", GameFinishedPayload {
                        instance_id: i_id,
                        duration_sec: duration
                    });
                }
                Err(e) => println!("等待进程失败: {}", e),
            }
        });
    }

    Ok(pid)
}

#[command]
pub async fn stop_game(instance_id: String, config: WineConfig) -> Result<Vec<u32>, String> {
    let mode = config.run_mode.as_deref().unwrap_or("crossover");
    if mode == "parallels" {
        return Err("Parallels 模式暂不支持停止实例".to_string());
    }

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

    let killed = if mode == "direct" {
        stop_direct_instance(launcher_pid, &exe_path, &processes)?
    } else {
        let bottle_path = expand_tilde(&config.bottle_path);
        stop_crossover_instance(launcher_pid, &exe_path, &bottle_path, &processes)?
    };

    remove_running_instance(&instance_id);
    Ok(killed)
}
