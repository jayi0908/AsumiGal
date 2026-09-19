<div align="center">
  <div style="width:200px">
    <a href="https://vndb.org/c87839">
      <img src="src-tauri/icons/icon.ico" alt="asumi">
    </a>
  </div>

<h1>AsumiGal</h1>

<p align="center"><a href="./README.md">English</a> | 中文 | <a href="./README.ja_JP.md">日本語</a></p>

![Status](https://img.shields.io/badge/status-active-brightgreen) ![Stage](https://img.shields.io/badge/stage-beta-blue) ![Build Status](https://github.com/jayi0908/AsumiGal/actions/workflows/build.yml/badge.svg) ![release](https://img.shields.io/github/v/release/jayi0908/AsumiGal?include_prereleases&sort=semver)

</div>

> - “你的家族有精神病史吗？”
>
> - “我有个叔叔买 mac 打游戏。”

AsumiGal 是一款专为 macOS 设计的 galgame/视觉小说管理器，主要管理通过 CrossOver 与 Parallels Desktop 运行的游戏实例，并兼容原生 macOS APP，旨在补全 galgame 管理器在 macOS 平台的空白。

目前更新至 0.5.0 版本，更新了实例设置界面的布局，支持了对实例的筛选与状态标识等更多操作，并修复了之前的版本中存在的一些 bug。

## 下载与安装

### 从 Releases 下载

前往 [Releases](https://github.com/jayi0908/AsumiGal/releases) 页面下载最新版本的安装包。将程序拖拽入 Applications 之后需要在终端中运行如下命令绕过隔离：

```bash
xattr -cr /Applications/AsumiGal.app
```

之后就能正常启动了。

### 从源码编译

```bash
# 安装 xcode 命令行工具（如果尚未安装）
xcode-select --install

# 安装 Homebrew（如果尚未安装）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Rust 依赖
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh # 安装过程中 Enter 选择默认选项，安装后重启终端或运行 source $HOME/.cargo/env

# 安装 node 和 pnpm
# node 可以使用 Homebrew 安装，也可以使用 nvm 安装
brew install node pnpm

# 克隆仓库
git clone https://github.com/jayi0908/AsumiGal.git
cd AsumiGal
# 安装前端依赖
pnpm install

# 开发模式运行
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

### 屏幕录制权限（截图功能）

截图功能需要系统的「屏幕录制」权限。如果系统设置里 AsumiGal 已显示为开启，但截图时仍反复弹出授权请求，通常是**升级应用后旧的授权条目失效**导致的（应用未使用开发者证书签名时，macOS 按构建哈希识别应用，重新构建后旧授权不再匹配）。执行以下命令清除可能存在的旧条目并重新授权：

```bash
# 1. 清除 AsumiGal 可能遗留的屏幕录制授权记录
tccutil reset ScreenCapture com.jayi0908.asumigal

# 2. 打开「系统设置 → 隐私与安全性 → 录屏与系统录音」
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

随后在列表里打开 AsumiGal 的开关，并在系统提示时选择「退出并重新打开」应用即可。

> 注意：每次更新应用后可能需要重复一次此步骤。

## 灵感来源 & 致谢

- [touchgal](https://touchgal.top) 和 [kungal](https://kungal.com) - 提供了丰富的游戏数据
- [ReinaManager](https://github.com/huoshen80/ReinaManager) 与 [LunaBox](https://github.com/Saramanda9988/LunaBox) - Windows 平台的轻量化的 galgame 和视觉小说管理工具（看到这个才想搞的 macOS 版本）
- [Heroic](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) - 跨平台的游戏启动器，使用 Tauri2 开发，并且支持 mac 端启动 CrossOver 容器内游戏
- [SJMCL](https://github.com/UNIkeEN/SJMCL) - 跨平台的 Minecraft 启动器，同样使用 Tauri2 开发，借鉴了其布局

## License

本项目采用 [GNU General Public License v3.0](./LICENSE) 许可证。
