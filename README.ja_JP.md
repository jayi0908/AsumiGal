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

> \- 「あなたのご家族に精神疾患の既往はありますか？」
>
> \- 「叔父がゲームをするために Mac を買ったんだ。」

AsumiGal は macOS 向けに設計された galgame／ビジュアルノベル管理ツールです。CrossOver と Parallels Desktop 経由で動作するゲームインスタンスを主に管理し、ネイティブな macOS アプリにも対応しており、macOS プラットフォームにおける galgame 管理ツールの空白を埋めることを目指しています。

現在はバージョン 0.5.0 まで更新されており、インスタンス設定画面のレイアウトを刷新し、インスタンスの絞り込みや状態フラグなど様々な操作に対応し、以前のバージョンに存在したバグもいくつか修正しました。

## ダウンロードとインストール

### Releases からダウンロード

[Releases](https://github.com/jayi0908/AsumiGal/releases) ページから最新のインストーラーをダウンロードしてください。アプリを Applications にドラッグした後、隔離属性を解除するためターミナルで以下のコマンドを実行します：

```bash
xattr -cr /Applications/AsumiGal.app
```

その後、通常通り起動できるようになります。

### ソースからビルド

```bash
# Xcode コマンドラインツールをインストール（未インストールの場合）
xcode-select --install

# Homebrew をインストール（未インストールの場合）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Rust ツールチェーンをインストール
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh # インストール中は Enter でデフォルトを選択。インストール後はターミナルを再起動するか source $HOME/.cargo/env を実行

# node と pnpm をインストール
# node は Homebrew でも nvm でもインストール可
brew install node pnpm

# リポジトリをクローン
git clone https://github.com/jayi0908/AsumiGal.git
cd AsumiGal
# フロントエンドの依存関係をインストール
pnpm install

# 開発モードで実行
pnpm tauri dev

# 本番ビルド
pnpm tauri build
```

## インスピレーションと謝辞

- [touchgal](https://touchgal.top) と [kungal](https://kungal.com) - 豊富なゲームデータの提供
- [ReinaManager](https://github.com/huoshen80/ReinaManager) と [LunaBox](https://github.com/Saramanda9988/LunaBox) - Windows 向けの軽量な galgame／ビジュアルノベル管理ツール（これらを見て macOS 版を作ろうと思った）
- [Heroic](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) - Tauri2 で開発されたクロスプラットフォームのゲームランチャー。mac 上で CrossOver コンテナ内のゲームを起動する機能をサポート
- [SJMCL](https://github.com/UNIkeEN/SJMCL) - 同じく Tauri2 で開発されたクロスプラットフォームの Minecraft ランチャー。レイアウトを参考にした

## ライセンス

本プロジェクトは [MIT](./LICENSE) ライセンスの下で公開されています。
