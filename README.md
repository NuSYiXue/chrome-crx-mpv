# MPV Player - Chrome Extension

Send web video URLs directly to [MPV](https://mpv.io/) player with optional cookies. Supports all Chromium-based browsers (Chrome, Brave, Edge, Vivaldi, Opera, etc).

## Features

- **One-click play** — floating button on video pages, sends URL to MPV
- **Smart media capture** — detects `.m3u8/.mp4/.webm` links via `webRequest` API (FetchV-style)
- **Cookie support** — pass login cookies for restricted content (per-site toggle)
- **Dual mode** — page URL mode (yt-dlp) or media URL mode (direct stream)
- **Universal browser support** — one-click registration for any Chromium browser

## Quick Install

### 1. Download

From [Releases](https://github.com/NuSYiXue/chrome-crx-mpv/releases):
- `MPV-Player-v1.0.crx` — drag into `chrome://extensions`
- `mpv_bridge.exe` + `setup.bat` — copy to your MPV installation folder

### 2. Setup Native Host

Run `setup.bat` in MPV's folder, select `1` to register the `mpvreg://` protocol.

### 3. Register Browser

1. Open the extension popup
2. Open `chrome://version`, copy **Executable path**
3. Paste into the popup, click **Register**
4. Repeat for each browser

## Usage

| Button | Color | Meaning |
|--------|-------|---------|
| ▶ Play | Purple | Page URL mode (yt-dlp) |
| ▶ Play | Green | Media URL ready |
| ▶ Play | Gray | Waiting for media |
| 🍪 Cookie | Orange/Gray | Per-rule cookie toggle |
| ⚙ Settings | — | Manage rules |

## Build from Source

### Extension
No build required. Load `MPV/` as unpacked extension in `chrome://extensions`.

### Native Host (Rust)
```bash
cd MPV-bridge
cargo build --release
# Output: target/release/mpv_bridge.exe
```

## Architecture

```
Web Page → content.js (UI)
              ↓
         background.js (webRequest capture + Cookie + Native Messaging)
              ↓
         mpv_bridge.exe (Rust NMH)
              ↓
         mpv.exe --ytdl-raw-options-append=cookies=...
```

## License

MIT
