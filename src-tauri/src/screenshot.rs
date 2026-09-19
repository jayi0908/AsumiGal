use core_foundation::base::TCFType;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::{CFNumber, CFNumberRef};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::CFURL;
use core_graphics::access::ScreenCaptureAccess;
use core_graphics::geometry::CGRect;
use core_graphics::image::CGImage;
use core_graphics::sys::CGImageRef;
use core_graphics::window::{
    copy_window_info, create_image, kCGNullWindowID, kCGWindowImageDefault,
    kCGWindowListOptionIncludingWindow, kCGWindowListOptionOnScreenOnly,
};
use foreign_types_shared::ForeignType;
use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, command};

use crate::runner::{expand_tilde, get_running_instances, TrackedInstance};

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const SCREENSHOTS_DIR_NAME: &str = "screen_shots";

// 系统级窗口 owner（含中文系统下的本地化名称）
const SYSTEM_OWNERS: &[&str] = &[
    "Dock",
    "程序坞",
    "Wallpaper",
    "桌面",
    "WindowManager",
    "Window Server",
    "TextInputMenuAgent",
    "ControlCenter",
    "控制中心",
    "Notification Center",
    "通知中心",
];

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageDestinationCreateWithURL(
        url: core_foundation::url::CFURLRef,
        type_: CFStringRef,
        count: std::os::raw::c_ulong,
        options: CFDictionaryRef,
    ) -> *mut c_void;
    fn CGImageDestinationAddImage(
        dest: *mut c_void,
        image: CGImageRef,
        options: CFDictionaryRef,
    );
    fn CGImageDestinationFinalize(dest: *mut c_void) -> std::os::raw::c_int;
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotInfo {
    pub file_name: String,
    pub file_path: String,
    pub time: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalCaptureResult {
    pub instance_id: Option<String>,
    pub screenshot: ScreenshotInfo,
}

#[derive(Clone)]
struct WindowInfo {
    id: u32,
    owner: String,
    /// 窗口宿主进程 pid（私有键 kCGWindowOwnerPID，长期稳定）
    pid: u32,
    bounds: CGRect,
    area: f64,
    layer: i64,
}

/// 截图保存目录：
/// - 用户自定义根目录非空 → 直接使用该目录（不存在则创建）
/// - 否则 → 实例所在文件夹/screen_shots
fn instance_screenshot_dir(executable_path: &str, custom_root_dir: &str) -> Result<PathBuf, String> {
    let custom = custom_root_dir.trim();
    if !custom.is_empty() {
        let dir = expand_tilde(custom);
        if dir == Path::new("/") {
            return Err("截图根目录不能为系统根目录 /".into());
        }
        fs::create_dir_all(&dir)
            .map_err(|e| format!("创建截图目录失败: {}（目录: {}）", e, dir.display()))?;
        return Ok(dir);
    }

    let exe = executable_path.trim();
    if exe.is_empty() {
        return Err("请先设置实例的可执行文件路径，或在截图中启用自定义存放路径".into());
    }
    let exe_path = expand_tilde(exe);
    let parent = exe_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty() && p.as_os_str() != "/")
        .ok_or_else(|| "无法解析实例所在文件夹".to_string())?;
    let dir = parent.join(SCREENSHOTS_DIR_NAME);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("创建截图目录失败: {}（目录: {}）", e, dir.display()))?;
    Ok(dir)
}

fn list_on_screen_windows() -> Result<Vec<WindowInfo>, String> {
    let array = copy_window_info(kCGWindowListOptionOnScreenOnly, kCGNullWindowID)
        .ok_or_else(|| "枚举窗口列表失败".to_string())?;

    let mut windows = Vec::new();
    for value in array.get_all_values() {
        let dict: CFDictionary =
            unsafe { CFDictionary::wrap_under_get_rule(value as CFDictionaryRef) };
        let (keys, values) = dict.get_keys_and_values();

        let mut id: u32 = 0;
        let mut owner = String::new();
        let mut on_screen = true;
        let mut layer: i64 = 0;
        let mut window_pid: u32 = 0;
        let mut bounds: CGRect = Default::default();

        for (k, v) in keys.iter().zip(values.iter()) {
            let key_name = unsafe { CFString::wrap_under_get_rule(*k as CFStringRef) }.to_string();
            match key_name.as_str() {
                "kCGWindowNumber" => {
                    let num = unsafe { CFNumber::wrap_under_get_rule(*v as CFNumberRef) };
                    id = num.to_i64().unwrap_or(0) as u32;
                }
                "kCGWindowOwnerName" => {
                    owner = unsafe { CFString::wrap_under_get_rule(*v as CFStringRef) }.to_string();
                }
                "kCGWindowIsOnscreen" => {
                    let num = unsafe { CFNumber::wrap_under_get_rule(*v as CFNumberRef) };
                    on_screen = num.to_i64() == Some(1);
                }
                "kCGWindowLayer" => {
                    let num = unsafe { CFNumber::wrap_under_get_rule(*v as CFNumberRef) };
                    layer = num.to_i64().unwrap_or(0);
                }
                "kCGWindowOwnerPID" => {
                    let num = unsafe { CFNumber::wrap_under_get_rule(*v as CFNumberRef) };
                    window_pid = num.to_i64().unwrap_or(0) as u32;
                }
                "kCGWindowBounds" => {
                    let bdict: CFDictionary =
                        unsafe { CFDictionary::wrap_under_get_rule(*v as CFDictionaryRef) };
                    if let Some(rect) = CGRect::from_dict_representation(&bdict) {
                        bounds = rect;
                    }
                }
                _ => {}
            }
        }

        let area = bounds.size.width * bounds.size.height;
        if id != 0 && on_screen && area > 100.0 {
            windows.push(WindowInfo {
                id,
                owner,
                pid: window_pid,
                bounds,
                area,
                layer,
            });
        }
    }
    Ok(windows)
}

fn direct_mode_owner_hints(executable_path: &str) -> Vec<String> {
    let mut hints = Vec::new();
    let path = Path::new(executable_path);
    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        hints.push(stem.to_string());
    }
    if executable_path.trim_end_matches('/').ends_with(".app") {
        let macos_dir = path.join("Contents/MacOS");
        if let Ok(entries) = fs::read_dir(&macos_dir) {
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                        hints.push(stem.to_string());
                    }
                }
            }
        }
    }
    hints.dedup();
    hints
}

fn pick_largest(windows: &[&WindowInfo]) -> Option<WindowInfo> {
    windows
        .iter()
        .copied()
        .max_by(|a, b| a.area.partial_cmp(&b.area).unwrap_or(std::cmp::Ordering::Equal))
        .cloned()
}

/// 按运行模式严格匹配游戏窗口（优先按游戏进程树匹配窗口宿主进程，其次 owner 匹配，不做兜底）
fn select_window_strict(run_mode: &str, executable_path: &str) -> Option<WindowInfo> {
    let windows = list_on_screen_windows().ok()?;
    let foreign: Vec<&WindowInfo> = windows
        .iter()
        .filter(|w| !w.owner.eq_ignore_ascii_case("AsumiGal"))
        .collect();

    // 1) 最可靠：窗口宿主进程属于本实例游戏进程树（自身/子孙/祖先，覆盖 Cider 宿主绘窗场景）
    if !matches!(run_mode, "parallels") && !executable_path.trim().is_empty() {
        let pids = crate::runner::find_game_process_pids(run_mode, executable_path);
        if !pids.is_empty() {
            let pid_match: Vec<&WindowInfo> = foreign
                .iter()
                .copied()
                .filter(|w| pids.contains(&w.pid))
                .collect();
            if let Some(w) = pick_largest(&pid_match) {
                return Some(w);
            }
        }
    }

    // 2) owner 名称匹配
    let matches: Vec<&WindowInfo> = match run_mode {
        "parallels" => foreign
            .iter()
            .copied()
            .filter(|w| w.owner.to_lowercase().contains("parallels"))
            .collect(),
        "direct" => {
            let hints = direct_mode_owner_hints(executable_path);
            if hints.is_empty() {
                Vec::new()
            } else {
                foreign
                    .iter()
                    .copied()
                    .filter(|w| hints.iter().any(|h| w.owner.eq_ignore_ascii_case(h)))
                    .collect()
            }
        }
        _ => foreign
            .iter()
            .copied()
            .filter(|w| {
                let o = w.owner.to_lowercase();
                o.contains("crossover") || o.contains("cider")
            })
            .collect(),
    };

    pick_largest(&matches)
}

/// 宽松匹配：先 owner 匹配，找不到则兜底取最大的普通应用窗口
fn select_target_window(run_mode: &str, executable_path: &str) -> Result<WindowInfo, String> {
    if let Some(w) = select_window_strict(run_mode, executable_path) {
        return Ok(w);
    }

    let windows = list_on_screen_windows()?;
    let fallback: Vec<&WindowInfo> = windows
        .iter()
        .filter(|w| {
            !w.owner.eq_ignore_ascii_case("AsumiGal")
                && w.layer == 0
                && !SYSTEM_OWNERS.contains(&w.owner.as_str())
        })
        .collect();

    pick_largest(&fallback).ok_or_else(|| {
        "未找到可截取的游戏窗口。请确认游戏窗口当前可见；如果游戏处于全屏且位于其他桌面/空间，请先切换到该窗口再截图".to_string()
    })
}

/// 选择当前屏幕焦点应用窗口：CGWindowList 按 z 序（前→后）返回，
/// 取第一个普通应用窗口（排除 AsumiGal 自身与系统窗口）
fn select_focused_window() -> Result<WindowInfo, String> {
    let windows = list_on_screen_windows()?;
    // 优先普通应用窗口（z 序最靠前）
    for w in &windows {
        if w.owner.eq_ignore_ascii_case("AsumiGal") || SYSTEM_OWNERS.contains(&w.owner.as_str()) {
            continue;
        }
        if w.layer != 0 {
            continue;
        }
        return Ok(w.clone());
    }
    // 兜底：部分远程/游戏窗口层级非 0，放宽层级限制
    for w in &windows {
        if w.owner.eq_ignore_ascii_case("AsumiGal") || SYSTEM_OWNERS.contains(&w.owner.as_str()) {
            continue;
        }
        if w.layer > 10 {
            continue;
        }
        return Ok(w.clone());
    }
    Err("未找到可截取的前景应用窗口，请确认目标应用窗口当前可见".to_string())
}

// 每次会话最多弹一次系统授权框（macOS 授权后当前进程 preflight 仍为 false，必须重启才生效），
// 否则每次截屏都 request() 会形成「弹框→授权→重启→再弹框」的死循环
static CAPTURE_PROMPTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 未授权时返回提示文案（会话内最多弹一次系统框）；返回 None 表示 preflight 通过，
/// 或授权情况无法确定——此时应直接尝试截屏，用实际结果判断（preflight 并不可靠）
fn screen_capture_permission_hint() -> Option<String> {
    if ScreenCaptureAccess.preflight() {
        return None;
    }
    if CAPTURE_PROMPTED
        .compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
        .is_err()
    {
        return Some("尚未授予屏幕录制权限：请在「系统设置 → 隐私与安全性 → 屏幕录制」中允许 AsumiGal，然后重启应用".into());
    }
    if ScreenCaptureAccess.request() {
        return None;
    }
    Some("需要屏幕录制权限：请在「系统设置 → 隐私与安全性 → 屏幕录制」中允许 AsumiGal，然后重启应用".into())
}

fn with_permission_hint(msg: String) -> String {
    match screen_capture_permission_hint() {
        Some(h) => format!("{}（{}）", msg, h),
        None => msg,
    }
}

/// 判断捕获结果是否为空白画面（整幅接近全黑），这通常意味着没有屏幕录制权限
fn image_looks_blank(image: &CGImage) -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGImageGetDataProvider(image: CGImageRef) -> *mut c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CGDataProviderCopyData(provider: *mut c_void) -> core_foundation::data::CFDataRef;
    }

    unsafe {
        let provider = CGImageGetDataProvider(image.as_ptr());
        if provider.is_null() {
            return true;
        }
        let data = CGDataProviderCopyData(provider);
        if data.is_null() {
            return true;
        }
        let data = core_foundation::data::CFData::wrap_under_create_rule(data);
        let bytes = data.bytes();
        let bpp = ((image.bits_per_pixel() / 8) as usize).max(1);
        if bytes.len() < bpp {
            return true;
        }
        let step = bpp * 97; // 质数步长抽样，避开行对齐规律
        let mut i = 0usize;
        while i + 3 < bytes.len() {
            if bytes[i] > 3 || bytes[i + 1] > 3 || bytes[i + 2] > 3 {
                return false;
            }
            i += step;
        }
        true
    }
}

fn save_png_image(image: &CGImage, out_path: &Path) -> Result<(), String> {
    if image.width() == 0 || image.height() == 0 {
        return Err("捕获到的图像为空".into());
    }
    let url = CFURL::from_path(out_path, false)
        .ok_or_else(|| "无法为截图文件创建 URL".to_string())?;
    let png_type = CFString::new("public.png");
    let dest = unsafe {
        CGImageDestinationCreateWithURL(
            url.as_concrete_TypeRef(),
            png_type.as_concrete_TypeRef(),
            1,
            std::ptr::null_mut(),
        )
    };
    if dest.is_null() {
        return Err("创建 PNG 编码器失败".into());
    }
    let ok = unsafe {
        CGImageDestinationAddImage(dest, image.as_ptr(), std::ptr::null_mut());
        CGImageDestinationFinalize(dest)
    };
    if ok == 0 {
        return Err("写入 PNG 文件失败".into());
    }
    Ok(())
}

fn timestamp_string() -> String {
    Command::new("date")
        .arg("+%Y%m%d_%H%M%S")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            secs.to_string()
        })
}

fn next_file_path(dir: &Path) -> PathBuf {
    let ts = timestamp_string();
    let base = format!("Screenshot_{}", ts);
    let mut candidate = dir.join(format!("{}.png", base));
    let mut counter = 1u32;
    while candidate.exists() {
        counter += 1;
        candidate = dir.join(format!("{}_{}.png", base, counter));
    }
    candidate
}

fn capture_to_file(
    target: &WindowInfo,
    dir: &Path,
) -> Result<ScreenshotInfo, String> {
    let out_path = next_file_path(dir);
    let image = create_image(
        target.bounds,
        kCGWindowListOptionIncludingWindow,
        target.id,
        kCGWindowImageDefault,
    )
    .ok_or_else(|| {
        with_permission_hint("窗口捕获失败，窗口可能已隐藏或位于其他桌面/空间".to_string())
    })?;
    if image_looks_blank(&image) {
        return Err(with_permission_hint(format!(
            "截取到空白画面（{}），窗口可能已最小化、被遮挡，或未授予屏幕录制权限",
            target.owner
        )));
    }
    save_png_image(&image, &out_path)?;
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(ScreenshotInfo {
        file_name: out_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        file_path: out_path.to_string_lossy().into_owned(),
        time,
    })
}

/// 按实例配置选择截屏目标窗口（游戏程序 / 当前焦点应用）
fn select_target_for_instance(instance: &TrackedInstance) -> Result<WindowInfo, String> {
    let result = if instance.screenshot_target.trim() == "focused" {
        select_focused_window()
    } else {
        select_target_window(&instance.run_mode, &instance.game_exe)
    };
    result.map_err(with_permission_hint)
}

/// 将一次截屏存到指定实例的截图目录（自定义或默认），返回截屏信息
fn do_capture(instance: &TrackedInstance) -> Result<ScreenshotInfo, String> {
    let target = select_target_for_instance(instance)?;
    let dir = instance_screenshot_dir(&instance.game_exe, &instance.screenshot_dir)?;
    capture_to_file(&target, &dir)
}

#[command]
pub fn list_instance_screenshots(
    _app: AppHandle,
    instance_id: String,
    executable_path: String,
    custom_screenshot_dir: String,
) -> Result<Vec<ScreenshotInfo>, String> {
    if instance_id.trim().is_empty() {
        return Ok(Vec::new());
    }
    let dir = match instance_screenshot_dir(&executable_path, &custom_screenshot_dir) {
        Ok(d) => d,
        Err(_) => return Ok(Vec::new()),
    };
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext_ok = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            if !ext_ok {
                continue;
            }
            let time = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            items.push(ScreenshotInfo {
                file_name: entry.file_name().to_string_lossy().into_owned(),
                file_path: path.to_string_lossy().into_owned(),
                time,
            });
        }
    }
    items.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(items)
}

#[command]
pub fn capture_instance_screenshot(
    _app: AppHandle,
    instance_id: String,
    run_mode: String,
    executable_path: String,
    custom_screenshot_dir: String,
    screenshot_target: String,
) -> Result<ScreenshotInfo, String> {
    let _ = instance_id;
    if executable_path.trim().is_empty() && custom_screenshot_dir.trim().is_empty() {
        return Err("请先设置实例的可执行文件路径，或启用自定义截图存放路径".into());
    }
    let mode = if run_mode.trim().is_empty() {
        "crossover"
    } else {
        run_mode.as_str()
    };
    let target = if screenshot_target.trim() == "focused" {
        select_focused_window().map_err(with_permission_hint)?
    } else {
        select_target_window(mode, &executable_path).map_err(with_permission_hint)?
    };
    let dir = instance_screenshot_dir(&executable_path, &custom_screenshot_dir)?;
    capture_to_file(&target, &dir)
}

/// 全局快捷键截屏：根据正在运行的实例自动确定目标窗口与保存位置。
/// 当前选中实例若配置了「当前焦点应用」，则优先按该配置截屏（不要求游戏正在运行）。
#[command]
pub fn capture_game_screenshot(
    _app: AppHandle,
    active_instance_id: String,
    active_run_mode: String,
    active_executable_path: String,
    active_screenshot_dir: String,
    active_screenshot_target: String,
) -> Result<GlobalCaptureResult, String> {
    let _ = active_run_mode;
    if !active_instance_id.trim().is_empty() && active_screenshot_target.trim() == "focused" {
        let target = select_focused_window().map_err(with_permission_hint)?;
        let dir = instance_screenshot_dir(&active_executable_path, &active_screenshot_dir)?;
        let shot = capture_to_file(&target, &dir)?;
        return Ok(GlobalCaptureResult {
            instance_id: Some(active_instance_id),
            screenshot: shot,
        });
    }

    let running = get_running_instances();
    if running.is_empty() {
        return Err("当前没有正在运行的实例。请先启动游戏，或到实例页选中一个启用「当前屏幕焦点的应用」截图的实例后重试".into());
    }

    if running.len() == 1 {
        let instance = &running[0];
        let shot = do_capture(instance)?;
        return Ok(GlobalCaptureResult {
            instance_id: Some(instance.instance_id.clone()),
            screenshot: shot,
        });
    }

    // 多个实例同时运行：若有且仅有一个实例选择了「当前焦点应用」，直接截焦点窗口并归到该实例
    let focused_running: Vec<&TrackedInstance> = running
        .iter()
        .filter(|i| i.screenshot_target.trim() == "focused")
        .collect();
    if focused_running.len() == 1 {
        let instance = focused_running[0];
        let target = select_focused_window().map_err(with_permission_hint)?;
        let dir = instance_screenshot_dir(&instance.game_exe, &instance.screenshot_dir)?;
        let shot = capture_to_file(&target, &dir)?;
        return Ok(GlobalCaptureResult {
            instance_id: Some(instance.instance_id.clone()),
            screenshot: shot,
        });
    }

    // 尝试用各自模式严格匹配窗口，恰好只有一个实例匹配成功则用它
    let mut matched: Vec<(TrackedInstance, WindowInfo)> = Vec::new();
    for instance in &running {
        if instance.screenshot_target.trim() == "focused" {
            continue;
        }
        if let Some(window) = select_window_strict(&instance.run_mode, &instance.game_exe) {
            matched.push((instance.clone(), window));
        }
    }
    match matched.len() {
        0 => Err("未找到正在运行的游戏窗口，请确认游戏窗口当前可见后再试".into()),
        1 => {
            let (instance, target) = matched.remove(0);
            let dir = instance_screenshot_dir(&instance.game_exe, &instance.screenshot_dir)?;
            let shot = capture_to_file(&target, &dir)?;
            Ok(GlobalCaptureResult {
                instance_id: Some(instance.instance_id),
                screenshot: shot,
            })
        }
        _ => Err("有多个游戏实例正在运行，无法确定截屏归属，请到实例详情页手动截屏".into()),
    }
}

#[command]
pub fn delete_instance_screenshot(
    _app: AppHandle,
    instance_id: String,
    executable_path: String,
    custom_screenshot_dir: String,
    file_name: String,
) -> Result<(), String> {
    let _ = instance_id;
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name == "."
        || file_name == ".."
    {
        return Err("无效的截图文件名".into());
    }
    let path = instance_screenshot_dir(&executable_path, &custom_screenshot_dir)?
        .join(&file_name);
    fs::remove_file(&path).map_err(|e| format!("删除截图失败: {}", e))
}

/// 打开系统设置的「屏幕录制」面板，方便用户授权
#[command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .status()
        .map_err(|e| format!("打开系统设置失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_foreign_window_smoke() {
        println!("preflight = {}", ScreenCaptureAccess.preflight());
        let windows = list_on_screen_windows().expect("枚举窗口失败");
        let mut best: Option<WindowInfo> = None;
        for w in &windows {
            if w.owner.eq_ignore_ascii_case("AsumiGal") || SYSTEM_OWNERS.contains(&w.owner.as_str()) {
                continue;
            }
            if w.layer != 0 {
                continue;
            }
            if best.as_ref().map(|b| w.area > b.area).unwrap_or(true) {
                best = Some(w.clone());
            }
        }
        match best {
            None => println!("RESULT: 没有可截的普通窗口"),
            Some(w) => {
                println!(
                    "target: owner={} id={} layer={} area={} pid={} bounds={}x{}+{}+{}",
                    w.owner, w.id, w.layer, w.area, w.pid,
                    w.bounds.size.width, w.bounds.size.height, w.bounds.origin.x, w.bounds.origin.y
                );
                match create_image(
                    w.bounds,
                    kCGWindowListOptionIncludingWindow,
                    w.id,
                    kCGWindowImageDefault,
                ) {
                    None => println!("RESULT: create_image -> None"),
                    Some(img) => {
                        let out = std::env::temp_dir().join("asumigal_perm_probe.png");
                        let r = save_png_image(&img, &out);
                        let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
                        println!(
                            "RESULT: image {}x{}, save={:?}, png_bytes={}, blank={}",
                            img.width(), img.height(), r, size, image_looks_blank(&img)
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn list_windows_smoke() {
        let windows = list_on_screen_windows().expect("枚举窗口失败");
        println!("当前屏幕窗口数: {}", windows.len());
        for w in &windows {
            println!("[{}] owner={} layer={} area={}", w.id, w.owner, w.layer, w.area);
        }
    }
}
