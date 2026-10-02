use serde::Serialize;
use std::path::PathBuf;

/// 需要在 GUI 中执行的命令（冷启动存放待处理，热启动通过事件派发）
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum CliCommand {
    /// 启动指定实例（按 id 或名称匹配）
    Launch { target: String },
    /// 触发一次全局截屏
    Screenshot,
}

/// 解析需要 GUI 执行的命令
pub fn parse_gui_command(args: &[String]) -> Option<CliCommand> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--launch" | "-l" | "launch" => {
                if let Some(target) = it.next() {
                    let target = target.trim();
                    if !target.is_empty() {
                        return Some(CliCommand::Launch {
                            target: target.to_string(),
                        });
                    }
                }
            }
            "--screenshot" | "-s" | "screenshot" => return Some(CliCommand::Screenshot),
            _ => {}
        }
    }
    None
}

/// 处理不需要 GUI 的命令（--help / --list），返回值表示进程退出码
pub fn try_run_standalone(args: &[String]) -> Option<i32> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return Some(0);
    }
    if args.iter().any(|a| a == "--list") {
        match list_instances() {
            Ok(()) => return Some(0),
            Err(e) => {
                eprintln!("读取实例列表失败: {}", e);
                return Some(1);
            }
        }
    }
    None
}

fn instances_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("无法定位应用数据目录")?;
    Ok(base.join("com.jayi0908.asumigal").join("instances.json"))
}

fn list_instances() -> Result<(), String> {
    let path = instances_path()?;
    if !path.exists() {
        println!("（暂无实例）");
        return Ok(());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let empty = Vec::new();
    let items = data.as_array().unwrap_or(&empty);
    if items.is_empty() {
        println!("（暂无实例）");
        return Ok(());
    }
    println!("{:<28} {:<20} {}", "NAME", "RUN MODE", "EXECUTABLE");
    for it in items {
        let name = it["name"].as_str().unwrap_or("(未命名)");
        let mode = it["runMode"].as_str().unwrap_or("crossover");
        let exe = it["executablePath"].as_str().unwrap_or("");
        println!("{:<28} {:<20} {}", name, mode, exe);
    }
    Ok(())
}

fn print_help() {
    println!(
        "AsumiGal CLI\n\
         \n\
         Using:\n\
         \x20 AsumiGal --launch <实例名或ID>   启动指定实例（转交给已运行实例执行）\n\
         \x20 AsumiGal --screenshot            触发一次全局截屏\n\
         \x20 AsumiGal --list                  列出全部实例（纯命令行输出，不启动界面）\n\
         \x20 AsumiGal --help                  显示本帮助\n\
         \n\
         提示: 直接运行应用二进制（AsumiGal.app/Contents/MacOS/AsumiGal）以获取标准输出。\n"
    );
}
