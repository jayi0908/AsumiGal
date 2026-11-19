use tauri::{AppHandle, command, Manager};
use tauri::path::BaseDirectory;
use std::fs;
use std::path::PathBuf;

// 定义文件名
const DATA_FILENAME: &str = "instances.json";

// 获取数据文件路径
fn get_data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().resolve(DATA_FILENAME, BaseDirectory::AppLocalData)
        .map_err(|e| e.to_string())?;
    Ok(path)
}

// 获取脚本存储目录
fn get_scripts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().resolve("scripts", BaseDirectory::AppLocalData)
        .map_err(|e| e.to_string())?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| format!("创建脚本目录失败: {}", e))?;
    }
    Ok(path)
}

#[command]
pub fn save_instances(app: AppHandle, data: String) -> Result<(), String> {
    let path = get_data_path(&app)?;
    
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // 原子写入：先写入临时文件，再 rename 覆盖，避免中途崩溃或并发写入导致 JSON 损坏
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &data).map_err(|e| format!("无法写入临时文件: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("无法保存实例文件: {}", e))?;
    println!("数据已保存到: {:?}", path);
    Ok(())
}

#[command]
pub fn load_instances(app: AppHandle) -> Result<String, String> {
    let path = get_data_path(&app)?;
    
    if !path.exists() {
        // 如果文件不存在，返回空数组 JSON
        return Ok("[]".to_string());
    }

    let data = fs::read_to_string(&path).map_err(|e| format!("无法读取文件: {}", e))?;
    Ok(data)
}

fn validate_script_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed == "."
    {
        return Err("无效的脚本名称（不能包含路径分隔符或 ..）".into());
    }
    Ok(trimmed.to_string())
}

#[command]
pub fn get_scripts(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = get_scripts_dir(&app)?;
    let mut scripts = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if let Some(stem) = name.strip_suffix(".sh") {
                    scripts.push(stem.to_string());
                }
            }
        }
    }
    scripts.sort();
    Ok(scripts)
}

#[command]
pub fn read_script(app: AppHandle, name: String) -> Result<String, String> {
    let valid_name = validate_script_name(&name)?;
    let path = get_scripts_dir(&app)?.join(format!("{}.sh", valid_name));
    fs::read_to_string(path).map_err(|e| format!("无法读取脚本: {}", e))
}

#[command]
pub fn save_script(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let valid_name = validate_script_name(&name)?;
    let path = get_scripts_dir(&app)?.join(format!("{}.sh", valid_name));
    fs::write(path, content).map_err(|e| format!("无法保存脚本: {}", e))
}