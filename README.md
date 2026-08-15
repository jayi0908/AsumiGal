<div align="center">
  <div style="width:200px">
    <a href="https://vndb.org/c87839">
      <img src="src-tauri/icons/icon.ico" alt="asumi">
    </a>
  </div>

<h1>AsumiGal</h1>

<p align="center"><a href="./README.md">English</a> | <a href="./README.zh_CN.md">中文</a> | <a href="./README.ja_JP.md">日本語</a></p>

![Status](https://img.shields.io/badge/status-active-brightgreen) ![Stage](https://img.shields.io/badge/stage-beta-blue) ![Build Status](https://github.com/jayi0908/AsumiGal/actions/workflows/build.yml/badge.svg) ![release](https://img.shields.io/github/v/release/jayi0908/AsumiGal?include_prereleases&sort=semver)

</div>

> - "Does your family have a history of mental illness?"
>
> - "My uncle bought a Mac to play games."

AsumiGal is a galgame / visual novel manager designed for macOS. It primarily manages game instances running through CrossOver and Parallels Desktop, and is also compatible with native macOS apps, aiming to fill the gap of galgame managers on the macOS platform.

The project is currently at version 0.5.0, which updates the layout of the instance settings page, adds filtering and status flags for instances along with other operations, and fixes several bugs from previous versions.

## Download & Install

### Download from Releases

Go to the [Releases](https://github.com/jayi0908/AsumiGal/releases) page to download the latest installer. After dragging the app into Applications, run the following command in the terminal to bypass Gatekeeper quarantine:

```bash
xattr -cr /Applications/AsumiGal.app
```

You should then be able to launch it normally.

### Build from source

```bash
# Install Xcode command line tools (if not already installed)
xcode-select --install

# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh # Choose default options during install; after installation restart the terminal or run source $HOME/.cargo/env

# Install node and pnpm
# node can be installed via Homebrew or nvm
brew install node pnpm

# Clone the repository
git clone https://github.com/jayi0908/AsumiGal.git
cd AsumiGal
# Install frontend dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build the production version
pnpm tauri build
```

## Inspiration & Acknowledgements

- [touchgal](https://touchgal.top) and [kungal](https://kungal.com) - providing rich game data
- [ReinaManager](https://github.com/huoshen80/ReinaManager) and [LunaBox](https://github.com/Saramanda9988/LunaBox) - lightweight galgame and visual novel managers on Windows (seeing these inspired the macOS version)
- [Heroic](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) - a cross-platform game launcher built with Tauri2, which supports launching games inside CrossOver containers on macOS
- [SJMCL](https://github.com/UNIkeEN/SJMCL) - a cross-platform Minecraft launcher also built with Tauri2, whose layout was referenced

## License

This project is licensed under the [GNU General Public License v3.0](./LICENSE).
