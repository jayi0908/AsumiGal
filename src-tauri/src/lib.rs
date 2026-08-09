use tauri::{command, Manager};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
use font_kit::source::SystemSource;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;

mod runner;
mod storage;

// --- 统一的搜索结果结构 ---
#[derive(Debug, Serialize, Deserialize)]
struct SearchResult {
    id: String,
    title: String,
    cover: String,
    source: String,
    url: String,
    date: Option<String>,
}

// --- TouchGal 辅助结构 ---
#[allow(non_snake_case)]
#[derive(Serialize)]
struct TouchGalSearchOption {
    searchInIntroduction: bool,
    searchInAlias: bool,
    searchInTag: bool,
}

#[allow(non_snake_case)]
#[derive(Serialize)]
struct TouchGalRequestBody {
    queryString: String,
    limit: i32,
    searchOption: TouchGalSearchOption,
    page: i32,
    selectedType: String,
    selectedLanguage: String,
    selectedPlatform: String,
    sortField: String,
    sortOrder: String,
    selectedYears: Vec<String>,
    selectedMonths: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct GameDirInfo {
    dir_name: String,
    executables: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct MigrateGameFilesPayload {
    instance_id: String,
    game_file_status: String,
    disk_game_root: String,
    local_game_root: String,
    game_relative_dir: String,
    executable_path: String,
}

#[derive(Serialize)]
struct MigrateGameFilesResult {
    new_executable_path: String,
    new_status: String,
}

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

#[command]
fn get_home_dir() -> String {
    // 使用 dirs crate 获取主目录，如果获取失败返回空字符串
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[command]
fn get_system_fonts() -> Vec<String> {
    let source = SystemSource::new();
    match source.all_families() {
        Ok(families) => {
            let mut fonts = families;
            fonts.sort(); // 排序
            fonts.dedup(); // 去重
            fonts
        },
        Err(_) => vec!["System Default".to_string()]
    }
}

#[command]
async fn fetch_ymgal_news(page: u32) -> Result<serde_json::Value, String> {
    println!("Backend fetching Ymgal news page: {}", page); // 后端日志，方便调试
    
    let client = reqwest::Client::new();
    let url = format!("https://www.ymgal.games/co/topic/list?type=NEWS&page={}", page);

    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request Error: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Server returned status: {}", res.status()));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| format!("Parse Error: {}", e))?;
    Ok(data)
}

#[command]
async fn search_game(keyword: String, source: String) -> Result<Vec<SearchResult>, String> {
    println!("\n=== 开始搜索 [{}] 关键词: {} ===", source, keyword);
    let client = reqwest::Client::new();
    let mut results = Vec::new();

    match source.as_str() {
        "touchgal" => {
            let url = "https://www.touchgal.ink/api/search";
            // 构造 queryString 内部 JSON
            let query_string_json = json!([
                { "type": "keyword", "name": keyword }
            ]).to_string();

            let body = TouchGalRequestBody {
                queryString: query_string_json,
                limit: 12,
                searchOption: TouchGalSearchOption {
                    searchInIntroduction: false,
                    searchInAlias: true,
                    searchInTag: false,
                },
                page: 1,
                selectedType: "all".to_string(),
                selectedLanguage: "all".to_string(),
                selectedPlatform: "all".to_string(),
                sortField: "resource_update_time".to_string(),
                sortOrder: "desc".to_string(),
                selectedYears: vec!["all".to_string()],
                selectedMonths: vec!["all".to_string()],
            };

            // 发送请求
            let res = client.post(url)
                // 必须完全模拟浏览器的 Headers
                .header("Host", "www.touchgal.ink")
                .header("Accept", "*/*")
                .header("Accept-Language", "zh-CN,zh;q=0.9")
                .header("Content-Type", "application/json") // 这里还是建议用 application/json
                .header("Origin", "https://www.touchgal.ink")
                .header("Referer", "https://www.touchgal.ink/search")
                .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request Failed: {}", e))?;

            // 1. 获取原始文本 (关键调试步骤)
            let raw_text = res.text().await.map_err(|e| format!("Read Text Failed: {}", e))?;
            println!("[TouchGal] 原始响应: {}", raw_text); // <--- 请在终端查看这行输出

            // 2. 解析 JSON
            let json_val: serde_json::Value = serde_json::from_str(&raw_text)
                .map_err(|e| format!("JSON Parse Failed: {}", e))?;

            if let Some(games) = json_val["galgames"].as_array() {
                for g in games {
                    // 健壮性解析：如果是数字转字符串，如果是字符串直接用，如果是null给默认值
                    let unique_id = g["unique_id"].as_str().unwrap_or("").to_string();
                    let name = g["name"].as_str().unwrap_or("未知标题").to_string();
                    let banner = g["banner"].as_str().unwrap_or("").to_string();
                    
                    results.push(SearchResult {
                        id: unique_id.clone(),
                        title: name,
                        cover: banner,
                        source: "TouchGal".to_string(),
                        url: format!("https://www.touchgal.ink/{}", unique_id),
                        date: None
                    });
                }
            } else {
                println!("[TouchGal] 警告: 未找到 'galgames' 数组，可能是搜索无结果或结构变更");
            }
        },
        "kungal" => {
            // KunGal 需要 URL 编码
            let encoded_keyword = urlencoding::encode(&keyword);
            let url = format!("https://www.kungal.com/api/search?keywords={}&type=galgame&page=1&limit=12", encoded_keyword);
            
            println!("[KunGal] Request URL: {}", url);

            let res = client.get(&url)
                .header("Host", "www.kungal.com")
                .header("Referer", "https://www.kungal.com/search")
                .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .send()
                .await
                .map_err(|e| format!("Request Failed: {}", e))?;

            // 1. 获取原始文本
            let raw_text = res.text().await.map_err(|e| format!("Read Text Failed: {}", e))?;
            println!("[KunGal] 原始响应: {}", raw_text); // 调试用输出

            // 2. 解析 JSON（新结构: { "code": 0, "data": { "items": [...] } }，兼容旧顶层数组）
            let json_val: serde_json::Value = serde_json::from_str(&raw_text)
                .map_err(|e| format!("JSON Parse Failed: {}", e))?;

            let games = json_val["data"]["items"].as_array()
                .or_else(|| json_val.as_array());
            if let Some(games) = games {
                for g in games {
                    // id 有时是数字有时是字符串，统一处理
                    let id = if let Some(n) = g["id"].as_i64() {
                        n.to_string()
                    } else {
                        g["id"].as_str().unwrap_or("").to_string()
                    };

                    // 名字多语言回退逻辑
                    let name = if let Some(name_obj) = g["name"].as_object() {
                        let cn = name_obj.get("zh-cn").and_then(|v| v.as_str()).unwrap_or("");
                        let tw = name_obj.get("zh-tw").and_then(|v| v.as_str()).unwrap_or("");
                        let jp = name_obj.get("ja-jp").and_then(|v| v.as_str()).unwrap_or("");
                        let en = name_obj.get("en-us").and_then(|v| v.as_str()).unwrap_or("");
                        
                        if !cn.is_empty() { cn.to_string() }
                        else if !tw.is_empty() { tw.to_string() }
                        else if !jp.is_empty() { jp.to_string() }
                        else { en.to_string() }
                    } else {
                        g["name"].as_str().unwrap_or("未知标题").to_string()
                    };

                    // 封面优先 effective_banner_url，回退 banner
                    let banner = g["effective_banner_url"].as_str()
                        .filter(|s| !s.is_empty())
                        .or_else(|| g["banner"].as_str().filter(|s| !s.is_empty()))
                        .unwrap_or("").to_string();
                    // 日期兼容新旧字段
                    let update_time = g["resource_update_time"].as_str()
                        .or_else(|| g["resourceUpdateTime"].as_str())
                        .or_else(|| g["release_date"].as_str())
                        .map(|s| s.split('T').next().unwrap_or("").to_string());

                    results.push(SearchResult {
                        id: id.clone(),
                        title: name,
                        cover: banner,
                        source: "KunGal".to_string(),
                        url: format!("https://www.kungal.com/galgame/{}", id),
                        date: update_time,
                    });
                }
            } else {
                println!("[KunGal] 警告: 根节点不是数组，可能出错");
            }
        },
        _ => return Err("未知的搜索源".to_string()),
    }

    println!("=== 搜索结束，找到 {} 条结果 ===\n", results.len());
    Ok(results)
}

#[command]
fn get_directory_keywords(path: String) -> Result<Vec<String>, String> {
    let path_buf = std::path::PathBuf::from(&path);
    let mut keywords = Vec::new();

    // 提取上层目录名
    if let Some(parent) = path_buf.parent() {
        if let Some(dir_name) = parent.file_name() {
            keywords.push(dir_name.to_string_lossy().into_owned());
        }

        // 遍历目录下所有 .exe 文件
        if let Ok(entries) = std::fs::read_dir(parent) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let file_path = entry.path();
                        if file_path.extension().and_then(|e| e.to_str()) == Some("exe") {
                            if let Some(stem) = file_path.file_stem() {
                                keywords.push(stem.to_string_lossy().into_owned());
                            }
                        }
                    }
                }
            }
        }
    }

    // 排序并去重
    keywords.sort();
    keywords.dedup();
    Ok(keywords)
}

// 辅助递归函数，寻找目录下所有的 .exe 文件，限制深度防止死循环
fn find_exes(dir: &Path, exes: &mut Vec<String>, depth: usize) {
    if depth > 5 { return; } // 最大递归深度限制为 5 层
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_file() {
                    let p = entry.path();
                    if p.extension().and_then(|ext| ext.to_str()) == Some("exe") {
                        exes.push(p.to_string_lossy().into_owned());
                    }
                } else if ft.is_dir() {
                    find_exes(&entry.path(), exes, depth + 1);
                }
            }
        }
    }
}

// 扫描指定的根目录，提取包含 .exe 的一级子目录
#[command]
fn scan_game_directories(path: String) -> Result<Vec<GameDirInfo>, String> {
    let mut results = Vec::new();
    let root_path = PathBuf::from(&path);

    if !root_path.is_dir() {
        return Err("Selected path is not a directory".into());
    }

    let entries = std::fs::read_dir(root_path).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() {
                let dir_name = entry.file_name().to_string_lossy().into_owned();
                let mut executables = Vec::new();
                
                find_exes(&entry.path(), &mut executables, 0);

                if !executables.is_empty() {
                    results.push(GameDirInfo {
                        dir_name,
                        executables,
                    });
                }
            }
        }
    }

    Ok(results)
}

#[command]
fn get_pd_vms(path: String) -> Vec<String> {
    let mut vms = Vec::new();
    let expanded = expand_tilde(&path);
    if let Ok(entries) = std::fs::read_dir(expanded) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    // Parallels 的虚拟机应用通常存储在以 "Applications.localized" 或 "Applications" 结尾的文件夹中
                    if name.ends_with("Applications.localized") || name.ends_with("Applications") {
                        vms.push(name);
                    }
                }
            }
        }
    }
    vms
}

fn normalize_path(mut p: PathBuf) -> PathBuf {
    while p.to_string_lossy().ends_with('/') && p != PathBuf::from("/") {
        p.pop();
    }
    p
}

fn move_dir_cross_device(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
    }

    match fs::rename(src, dst) {
        Ok(_) => Ok(()),
        Err(_) => {
            // 跨设备时走 cp -R 再删源目录
            let status = std::process::Command::new("cp")
                .arg("-a")
                .arg(src)
                .arg(dst)
                .status()
                .map_err(|e| format!("复制游戏目录失败: {}", e))?;

            if !status.success() {
                return Err("复制游戏目录失败".to_string());
            }

            fs::remove_dir_all(src).map_err(|e| format!("删除源目录失败: {}", e))?;
            Ok(())
        }
    }
}

#[command]
async fn migrate_game_files(payload: MigrateGameFilesPayload) -> Result<MigrateGameFilesResult, String> {
    let _instance_id = payload.instance_id;
    let status = payload.game_file_status.as_str();
    if status != "disk" && status != "local" {
        return Err("无效的游戏文件状态".to_string());
    }

    let disk_root = normalize_path(expand_tilde(&payload.disk_game_root));
    let local_root = normalize_path(expand_tilde(&payload.local_game_root));

    if !disk_root.exists() || !disk_root.is_dir() {
        return Err(format!("硬盘游戏根目录无法访问: {}", disk_root.to_string_lossy()));
    }
    if !local_root.exists() || !local_root.is_dir() {
        return Err(format!("本机游戏根目录无法访问: {}", local_root.to_string_lossy()));
    }

    let rel_dir = payload
        .game_relative_dir
        .trim()
        .trim_start_matches('/')
        .trim_start_matches('\\')
        .replace('\\', "/");
    if rel_dir.is_empty() {
        return Err("游戏文件相对目录为空".to_string());
    }

    let current_root = if status == "disk" { &disk_root } else { &local_root };
    let target_root = if status == "disk" { &local_root } else { &disk_root };

    let src_game_dir = normalize_path(current_root.join(&rel_dir));
    let dst_game_dir = normalize_path(target_root.join(&rel_dir));

    if !src_game_dir.exists() || !src_game_dir.is_dir() {
        return Err(format!("源游戏目录不存在: {}", src_game_dir.to_string_lossy()));
    }
    if dst_game_dir.exists() {
        return Err(format!("目标目录已存在: {}", dst_game_dir.to_string_lossy()));
    }

    let exec_path = normalize_path(expand_tilde(&payload.executable_path));
    let exec_parent = exec_path
        .parent()
        .ok_or("无法解析可执行文件所在目录")?
        .to_path_buf();

    if !exec_parent.starts_with(&src_game_dir) {
        return Err("当前可执行文件路径不在对应游戏目录下".to_string());
    }

    let exec_rel_from_game_dir = exec_path
        .strip_prefix(&src_game_dir)
        .map_err(|_| "无法计算可执行文件相对路径".to_string())?
        .to_path_buf();

    move_dir_cross_device(&src_game_dir, &dst_game_dir)?;

    let new_exec_path = normalize_path(dst_game_dir.join(exec_rel_from_game_dir));
    let new_status = if status == "disk" { "local" } else { "disk" };

    Ok(MigrateGameFilesResult {
        new_executable_path: new_exec_path.to_string_lossy().to_string(),
        new_status: new_status.to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            runner::launch_game,
            runner::stop_game,
            runner::get_crossover_bottles,
            storage::save_instances,
            storage::load_instances,
            storage::get_scripts,
            storage::read_script,
            storage::save_script,
            get_home_dir,
            get_system_fonts,
            fetch_ymgal_news,
            search_game,
            get_directory_keywords,
            scan_game_directories,
            get_pd_vms,
            migrate_game_files
        ])
        .setup(|app| {
            // 获取主窗口
            let window = app.get_webview_window("main").unwrap();

            // 仅在 macOS 上应用磨砂效果
            #[cfg(target_os = "macos")]
            apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");

            // 初始化数据库 (预留位置)
            // database::init_db();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
