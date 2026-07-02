# MPV 视频播放器 - Chrome 扩展

将网页视频链接推送给 [MPV](https://mpv.io/) 播放器，支持可选传递 Cookie。兼容所有 Chromium 内核浏览器（Chrome / Brave / Edge / Vivaldi / Opera 等）。

## 功能

- **一键播放** — 视频页面左下角悬浮按钮，点击推送给 MPV
- **智能媒体捕获** — 通过 `webRequest` API 检测 `.m3u8/.mp4/.webm` 等视频链接（FetchV 方案）
- **Cookie 支持** — 按网站规则独立控制是否传递登录 Cookie
- **双模式** — 页面 URL 模式（依赖 yt-dlp 解析）/ 媒体 URL 模式（捕获直链播放）
- **全浏览器通用** — 一键注册，适配所有 Chromium 内核浏览器

## 快速安装

### 1. 下载安装

从 [Releases](https://github.com/NuSYiXue/chrome-crx-mpv/releases) 下载 `MPV-Player-v1.0.1.zip`，解压。

打开 `chrome://extensions` → 开启开发者模式 → 加载已解压的扩展程序 → 选择解压出的文件夹。

> 如 .crx 安装后无法启用，改用此方式。

另外下载 `mpv_bridge.exe` + `setup.bat`，复制到 MPV 安装目录。

### 2. 部署宿主

在 MPV 目录运行 `setup.bat`，选 `1` 注册 `mpvreg://` 协议。

### 3. 注册浏览器

1. 打开扩展弹窗
2. 打开 `chrome://version`，复制**可执行文件路径**
3. 粘贴到弹窗，点击**一键注册**
4. 每个浏览器需单独注册一次

## 使用说明

| 按钮 | 颜色 | 含义 |
|------|------|------|
| ▶ 播放 | 紫色 | 页面URL模式（靠 yt-dlp 解析） |
| ▶ 播放 | 绿色 | 媒体URL已就绪，点击播放 |
| ▶ 播放 | 灰色 | 等待捕获，请先播放视频 |
| 🍪 Cookie | 橙色 | 传递 Cookie |
| 🍪 Cookie | 灰色 | 不传 Cookie |
| ⚙ 设置 | — | 管理匹配规则 |

## 源码构建

### 扩展
无需构建。在 `chrome://extensions` 中加载 `MPV/` 文件夹即可。

### Native Host（Rust）
```bash
cd MPV-bridge
cargo build --release
# 输出: target/release/mpv_bridge.exe
```

## 架构

```
网页 → content.js（UI 按钮 + 设置面板）
           ↓
      background.js（webRequest 媒体捕获 + Cookie + Native Messaging）
           ↓
      mpv_bridge.exe（Rust 编写，296KB，无依赖）
           ↓
      mpv.exe --ytdl-raw-options-append=cookies=...
```

## License

MIT
