// mpv_bridge - Native Messaging Host for MPV Player
// 两种模式: stdin/stdout NMH 模式, --register 注册模式

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
struct Request {
    action: Option<String>,
    url: Option<String>,
    cookies: Option<String>,
    #[allow(dead_code)]
    args: Option<String>,
}

#[derive(Serialize)]
struct Response {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mpv_found: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mpv_path: Option<String>,
}

fn read_message() -> io::Result<Option<Request>> {
    let mut len_buf = [0u8; 4];
    if io::stdin().read_exact(&mut len_buf).is_err() {
        return Ok(None);
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 || len > 1024 * 1024 {
        return Ok(None);
    }
    let mut buf = vec![0u8; len];
    io::stdin().read_exact(&mut buf)?;
    let msg: Request = serde_json::from_slice(&buf)?;
    Ok(Some(msg))
}

fn send_message(resp: &Response) {
    let json = serde_json::to_string(resp).unwrap();
    let len = json.len() as u32;
    io::stdout().write_all(&len.to_le_bytes()).ok();
    io::stdout().write_all(json.as_bytes()).ok();
    io::stdout().flush().ok();
}

fn find_mpv() -> PathBuf {
    let exe = env::current_exe().unwrap_or_default();
    let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
    // 1. 同目录
    let next = dir.join("mpv.exe");
    if next.exists() { return next; }
    // 2. mpv_path.txt
    let cfg = dir.join("mpv_path.txt");
    if let Ok(s) = fs::read_to_string(&cfg) {
        let p = PathBuf::from(s.trim());
        if p.exists() { return p; }
    }
    // 3. PATH
    PathBuf::from("mpv.exe")
}

fn cookie_path() -> PathBuf {
    let exe = env::current_exe().unwrap_or_default();
    let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    dir.join(format!("mpv_cookies_{}.txt", ts))
}

fn run_native_host() {
    let msg = match read_message() {
        Ok(Some(m)) => m,
        _ => { send_message(&Response { status: "error".into(), message: Some("读取消息失败".into()), url: None, mpv_found: None, mpv_path: None }); return; }
    };

    match msg.action.as_deref() {
        Some("ping") => {
            let mpv = find_mpv();
            let found = if mpv.to_str() == Some("mpv.exe") {
                Command::new("mpv.exe").arg("--version").output().is_ok()
            } else {
                mpv.exists()
            };
            send_message(&Response {
                status: "ok".into(),
                message: Some("pong".into()),
                url: None,
                mpv_found: Some(found),
                mpv_path: Some(mpv.to_string_lossy().into()),
            });
        }
        Some("play") => {
            let url = msg.url.unwrap_or_default();
            if url.is_empty() {
                send_message(&Response { status: "error".into(), message: Some("缺少 URL".into()), url: None, mpv_found: None, mpv_path: None });
                return;
            }

            let mpv = find_mpv();
            let cookie_file;

            if let Some(cookies) = &msg.cookies {
                let cookies = cookies.trim();
                if !cookies.is_empty() {
                    let p = cookie_path();
                    if fs::write(&p, cookies).is_ok() {
                        cookie_file = Some(p);
                    } else {
                        cookie_file = None;
                    }
                } else {
                    cookie_file = None;
                }
            } else {
                cookie_file = None;
            }

            // 通过 PowerShell Start-Process 启动，脱离 Chrome 后台桌面会话
            let mut ps_args = String::new();
            if let Some(ref cf) = cookie_file {
                ps_args.push_str(&format!(r#""--ytdl-raw-options-append=cookies={}","#, cf.display()));
            }
            ps_args.push_str(&format!(r#""{}""#, url));
            let ps_cmd = format!(
                r#"Start-Process -FilePath "{}" -ArgumentList {}"#,
                mpv.display(), ps_args
            );

            let result = Command::new("powershell")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
                .spawn();

            match result {
                Ok(_) => {
                    send_message(&Response {
                        status: "ok".into(),
                        message: Some("MPV 已启动".into()),
                        url: Some(url),
                        mpv_found: None, mpv_path: None,
                    });
                    // 双保险删除：yt-dlp 进程消失，或 3 秒超时
                    if let Some(cf) = cookie_file {
                        let exe_dir = env::current_exe().unwrap_or_default()
                            .parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();
                        let log_path = exe_dir.join("cleanup.log");
                        let mut reason = "unknown";
                        let mut ytdlp_seen = false;
                        for i in 0..60 {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            let running = Command::new("tasklist")
                                .args(["/fi", "imagename eq yt-dlp.exe", "/fo", "csv", "/nh"])
                                .output()
                                .map(|o| String::from_utf8_lossy(&o.stdout).contains("yt-dlp.exe"))
                                .unwrap_or(false);
                            if running { ytdlp_seen = true; }
                            else if ytdlp_seen { reason = "yt-dlp exited"; break; }
                            else if !ytdlp_seen && i > 5 { reason = "no yt-dlp after 3s"; break; }
                        }
                        if reason == "unknown" { reason = if ytdlp_seen { "yt-dlp still running after 30s" } else { "timeout" }; }
                        let _ = fs::remove_file(&cf);
                        let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                        let _ = fs::write(&log_path, format!("{} | {} | {}\n",
                            ts, reason,
                            cf.file_name().unwrap_or_default().to_string_lossy()
                        ));
                    }
                }
                Err(e) => {
                    send_message(&Response {
                        status: "error".into(),
                        message: Some(format!("启动 MPV 失败: {}\n路径: {}", e, mpv.display())),
                        url: None, mpv_found: None, mpv_path: None,
                    });
                }
            }
        }
        _ => {
            send_message(&Response { status: "error".into(), message: Some(format!("未知操作: {:?}", msg.action)), url: None, mpv_found: None, mpv_path: None });
        }
    }
}

fn run_register(raw_url: &str) {
    let raw = raw_url
        .trim()
        .trim_start_matches("mpvreg://")
        .trim_start_matches("mpvreg:");

    // 解析: unreg/BraveSoftware\Brave-Browser 或 BraveSoftware\Brave-Browser?ext=xxx
    let (is_unreg, rest) = if raw.starts_with("unreg/") {
        (true, &raw[6..])
    } else {
        (false, raw)
    };

    let (reg_path, ext_id) = if let Some(idx) = rest.find('?') {
        let path = &rest[..idx];
        let query = &rest[idx + 1..];
        let id = if query.starts_with("ext=") { &query[4..] } else { "*" };
        (path.to_string(), id.to_string())
    } else {
        (rest.to_string(), "*".to_string())
    };

    // URL decode
    let reg_path = url_decode(&reg_path).unwrap_or(reg_path);
    let reg_path = reg_path.trim_end_matches(['\\', '/']).to_string();

    if reg_path.is_empty() {
        println!("无效的注册路径");
        println!("按回车键退出...");
        io::stdin().read_line(&mut String::new()).ok();
        return;
    }

    let reg_key = format!(r"HKCU\Software\{}\NativeMessagingHosts\com.mpv_player", reg_path);

    if is_unreg {
        // 反注册
        let _ = Command::new("reg").args(["delete", &reg_key, "/f"]).output();
        let chrome_key = r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mpv_player";
        let _ = Command::new("reg").args(["delete", chrome_key, "/f"]).output();

        let exe = env::current_exe().unwrap_or_default();
        let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let _ = fs::remove_file(dir.join("com.mpv_player.json"));

        println!("========================================");
        println!("   ✅ 已反注册！");
        println!("========================================");
        println!();
        println!("  {}", reg_key);
        println!("  {}", chrome_key);
    } else {
        // 注册
        let exe = env::current_exe().unwrap_or_default();
        let exe_path = exe.to_string_lossy().replace('\\', "\\\\");
        let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let manifest_path = dir.join("com.mpv_player.json");

        let manifest = format!(
            r#"{{
  "name": "com.mpv_player",
  "description": "MPV Player Native Messaging Host",
  "path": "{}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://{}/"]
}}
"#,
            exe_path, ext_id
        );

        if fs::write(&manifest_path, &manifest).is_err() {
            println!("写入清单失败");
            println!("按回车键退出...");
            io::stdin().read_line(&mut String::new()).ok();
            return;
        }

        // 写注册表（双写：浏览器 + Chrome 兼容）
        let reg_keys = if reg_path.to_lowercase().contains("google\\chrome") {
            vec![reg_key.clone()]
        } else {
            vec![
                reg_key.clone(),
                r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mpv_player".to_string(),
            ]
        };

        for key in &reg_keys {
            let _ = Command::new("reg")
                .args(["add", key, "/ve", "/d", &manifest_path.to_string_lossy(), "/f"])
                .output();
        }

        println!("========================================");
        println!("   ✅ 注册成功！");
        println!("========================================");
        println!();
        for key in &reg_keys {
            println!("  {}", key);
        }
        println!();
        println!("清单: {}", manifest_path.display());
        println!("宿主: {}", exe.display());
    }

    println!();
    println!("按回车键退出...");
    io::stdin().read_line(&mut String::new()).ok();
}

fn url_decode(s: &str) -> Option<String> {
    let mut result = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h = chars.next()?.to_digit(16)? as u8;
            let l = chars.next()?.to_digit(16)? as u8;
            result.push((h << 4 | l) as char);
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    Some(result)
}

fn main() {
    let args: Vec<String> = env::args().collect();

    // 注册模式
    if args.len() >= 3 && args[1] == "--register" {
        run_register(&args[2]);
        return;
    }
    // mpvreg:// 协议直接调用
    for arg in &args[1..] {
        if arg.starts_with("mpvreg://") || arg.starts_with("mpvreg:") {
            run_register(arg);
            return;
        }
    }

    // 默认：Native Messaging Host 模式
    run_native_host();
}
