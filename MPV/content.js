// MPV Player - Content Script
// 功能：页面UI按钮注入 + 设置面板（媒体URL由 Service Worker 的 webRequest 捕获）
'use strict';

const DEBUG = false;
function log(...args) { if (DEBUG) console.log('[MPV]', ...args); }

// ========== 配置 ==========
let config = {
  urlRules: [
    { pattern: 'https://www.bilibili.com/video/', mode: 'page', cookie: true },
    { pattern: 'https://www.youtube.com/watch', mode: 'page', cookie: false }
  ]
};

chrome.storage.local.get(['urlRules'], (result) => {
  if (result.urlRules) config.urlRules = result.urlRules;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.urlRules) return;
  config.urlRules = changes.urlRules.newValue;
  updateButtonStyle();
});

// ========== 媒体 URL 查询（向 background 请求）==========
async function getBestUrl() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ cmd: 'GET_BEST_URL' }, (r) => {
      resolve(r?.url || null);
    });
  });
}

async function hasMediaUrls() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ cmd: 'GET_MEDIA_URLS' }, (r) => {
      const urls = r?.urls || [];
      resolve(urls.length > 0);
    });
  });
}

// ========== URL 匹配规则 ==========
function getMatchedRule() {
  const currentUrl = window.location.href;
  if (!config.urlRules || config.urlRules.length === 0) return null;
  for (const rule of config.urlRules) {
    if (!rule || !rule.pattern) continue;
    const p = rule.pattern;
    if (p.startsWith('/') && p.endsWith('/')) {
      try { if (new RegExp(p.slice(1, -1)).test(currentUrl)) return rule; } catch(e) {}
    } else if (currentUrl.startsWith(p)) {
      return rule;
    }
  }
  return null;
}

function isVideoPage() { return getMatchedRule() !== null; }
function getCurrentMode() { const r = getMatchedRule(); return r ? r.mode : 'page'; }
function getCurrentCookieEnabled() { const r = getMatchedRule(); return r ? !!r.cookie : false; }

// ========== UI 按钮 ==========
let currentPlayBtn = null, currentSettingBtn = null, lastUrl = '', settingWindowOpen = false;

function updateButtonStyle() {
  if (!currentPlayBtn) return;
  const mode = getCurrentMode();
  if (currentPlayBtn._enterHandler) {
    currentPlayBtn.removeEventListener('mouseenter', currentPlayBtn._enterHandler);
    currentPlayBtn.removeEventListener('mouseleave', currentPlayBtn._leaveHandler);
  }
  if (mode === 'fetchv') {
    hasMediaUrls().then(has => {
      if (has) {
        currentPlayBtn.style.background = '#10b981';
        currentPlayBtn.title = '✅ 已捕获到可播放链接，点击推送到MPV';
        currentPlayBtn._enterHandler = () => { currentPlayBtn.style.background = '#34d399'; };
        currentPlayBtn._leaveHandler = () => { currentPlayBtn.style.background = '#10b981'; };
      } else {
        currentPlayBtn.style.background = '#9ca3af';
        currentPlayBtn.title = '⏳ 暂未捕获到链接，请先播放视频';
        currentPlayBtn._enterHandler = () => { currentPlayBtn.style.background = '#b0b7c3'; };
        currentPlayBtn._leaveHandler = () => { currentPlayBtn.style.background = '#9ca3af'; };
      }
      currentPlayBtn.addEventListener('mouseenter', currentPlayBtn._enterHandler);
      currentPlayBtn.addEventListener('mouseleave', currentPlayBtn._leaveHandler);
    });
  } else {
    currentPlayBtn.style.background = '#a855f7';
    currentPlayBtn.title = '📄 页面URL模式：用MPV播放当前页面（使用yt-dlp解析）';
    currentPlayBtn._enterHandler = () => { currentPlayBtn.style.background = '#c084fc'; };
    currentPlayBtn._leaveHandler = () => { currentPlayBtn.style.background = '#a855f7'; };
    currentPlayBtn.addEventListener('mouseenter', currentPlayBtn._enterHandler);
    currentPlayBtn.addEventListener('mouseleave', currentPlayBtn._leaveHandler);
  }
}

function createPlayButton() {
  const btn = document.createElement('button');
  btn.innerHTML = '▶';
  btn.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:999999;width:48px;height:48px;color:white;border:none;border-radius:50%;cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:all 0.2s ease;';
  btn.addEventListener('click', playWithMPV);
  return btn;
}

function createSettingButton() {
  const btn = document.createElement('button');
  btn.innerHTML = '⚙';
  btn.title = 'MPV播放设置';
  btn.style.cssText = 'position:fixed;bottom:20px;left:76px;z-index:999999;background:transparent;border:none;cursor:pointer;font-size:28px;padding:6px;display:flex;align-items:center;justify-content:center;transition:all 0.2s ease;color:#4b5563;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.2));';
  btn.addEventListener('mouseenter', () => { btn.style.transform='scale(1.1)'; btn.style.color='#a855f7'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform='scale(1)'; btn.style.color='#4b5563'; });
  btn.addEventListener('click', openSetting);
  return btn;
}

function removeButtons() {
  if (currentPlayBtn && currentPlayBtn.isConnected) currentPlayBtn.remove();
  if (currentSettingBtn && currentSettingBtn.isConnected) currentSettingBtn.remove();
  currentPlayBtn = null; currentSettingBtn = null;
}

function addButtons() {
  if (window.top !== window.self) return false;
  if (!document.body) return false;
  if (!isVideoPage()) { removeButtons(); return false; }
  if (currentPlayBtn && currentSettingBtn) {
    if (!currentPlayBtn.isConnected || !currentSettingBtn.isConnected) {
      currentPlayBtn = currentSettingBtn = null;
    } else { updateButtonStyle(); return true; }
  }
  removeButtons();
  currentPlayBtn = createPlayButton();
  currentSettingBtn = createSettingButton();
  document.body.appendChild(currentPlayBtn);
  document.body.appendChild(currentSettingBtn);
  updateButtonStyle();
  return true;
}

// ========== 播放逻辑 ==========
// Toast 通知
function showToast(text, color) {
  if (!document.body) return;
  const toast = document.createElement('div');
  toast.textContent = text;
  toast.style.cssText = `
    position:fixed;bottom:80px;left:20px;z-index:9999999;
    background:${color};color:white;padding:8px 16px;
    border-radius:20px;font-size:13px;font-family:system-ui,sans-serif;
    box-shadow:0 2px 12px rgba(0,0,0,0.25);
    animation:mpv-toast-in 0.3s ease,mpv-toast-out 0.3s ease 1.7s forwards;
    pointer-events:none;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 2200);
}

// 注入动画样式（DOM 就绪后）
function injectStyles() {
  if (document.getElementById('mpv-anim-style')) return;
  const s = document.createElement('style');
  s.id = 'mpv-anim-style';
  s.textContent = `
    @keyframes mpv-toast-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes mpv-toast-out { from{opacity:1} to{opacity:0} }
    @keyframes mpv-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }
  `;
  document.head.appendChild(s);
}
if (document.head) injectStyles();
else document.addEventListener('DOMContentLoaded', injectStyles);

async function playWithMPV() {
  const mode = getCurrentMode();
  let targetUrl;

  if (mode === 'fetchv') {
    targetUrl = await getBestUrl();
    if (!targetUrl) {
      if (!confirm('当前页面未捕获到媒体URL。\n\n是否使用页面URL尝试播放？（将依赖yt-dlp解析）')) return;
      targetUrl = window.location.href;
    }
  } else {
    targetUrl = window.location.href;
  }

  // 按钮立刻反馈：脉冲动画 + 变暗
  if (currentPlayBtn) {
    currentPlayBtn.style.animation = 'mpv-pulse 0.6s ease 3';
    currentPlayBtn.style.opacity = '0.6';
    currentPlayBtn.style.pointerEvents = 'none';
  }

  chrome.runtime.sendMessage(
    { cmd: 'PLAY_WITH_MPV', url: targetUrl, withCookies: getCurrentCookieEnabled(), args: '' },
    (response) => {
      // 恢复按钮
      if (currentPlayBtn) {
        currentPlayBtn.style.animation = '';
        currentPlayBtn.style.opacity = '1';
        currentPlayBtn.style.pointerEvents = 'auto';
      }

      if (chrome.runtime.lastError) {
        showToast('❌ 发送失败', '#ef4444');
        return;
      }
      if (!response || !response.success) {
        showToast('❌ ' + ((response && response.error) || '播放失败'), '#ef4444');
        return;
      }
      showToast('✅ 已发送到 MPV', '#10b981');
    }
  );
}

// ========== 设置窗口（页面内）==========
function openSetting() {
  if (window.top !== window.self) return;
  if (settingWindowOpen || document.querySelector('#mpv-setting-mask')) return;
  settingWindowOpen = true;

  let tempRules = config.urlRules.map(r => ({ pattern: r.pattern, mode: r.mode || 'page', cookie: !!r.cookie }));

  const mask = document.createElement('div');
  mask.id = 'mpv-setting-mask';
  mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:1000000;display:flex;align-items:center;justify-content:center;';

  const win = document.createElement('div');
  win.style.cssText = 'background:white;padding:24px;border-radius:20px;width:600px;max-width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 35px rgba(0,0,0,0.3);font-family:system-ui,-apple-system,sans-serif;';

  win.innerHTML = '<h2 style="margin-top:0;margin-bottom:16px;font-size:22px;color:#1f2937;">⚙ MPV 播放设置</h2>';

  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'padding:10px 14px;background:#f0fdf4;border-radius:10px;margin-bottom:16px;font-size:13px;border-left:4px solid #10b981;';
  const updateStatus = () => {
    const mode = getCurrentMode();
    hasMediaUrls().then(has => {
      const matchedRule = getMatchedRule();
      statusDiv.innerHTML =
        '<b>📊 当前页面状态</b><br>' +
        '🎯 匹配模式: <b style="color:' + (mode === 'fetchv' ? '#10b981' : '#a855f7') + '">' +
        (mode === 'fetchv' ? '媒体URL模式' : '页面URL模式') + '</b><br>' +
        '📡 可播放链接: <b style="color:' + (has ? '#10b981' : '#ef4444') + '">' +
        (has ? '✅ 已就绪' : '⏳ 未捕获到') + '</b><br>' +
        (matchedRule ? '✅ 匹配规则: <code>' + matchedRule.pattern + '</code>' : '❌ 当前页面未匹配任何规则');
    });
  };
  updateStatus();
  win.appendChild(statusDiv);

  const rulesLabel = document.createElement('label');
  rulesLabel.textContent = '🌐 视频页面匹配规则';
  rulesLabel.style.cssText = 'display:block;margin-bottom:8px;font-weight:500;color:#374151;';
  win.appendChild(rulesLabel);

  const rulesContainer = document.createElement('div');
  rulesContainer.id = 'mpv-rules-container';
  rulesContainer.style.cssText = 'background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:8px 12px;max-height:200px;overflow-y:auto;margin-bottom:12px;';
  win.appendChild(rulesContainer);

  const addDiv = document.createElement('div');
  addDiv.style.cssText = 'display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;';
  const newRuleInput = document.createElement('input');
  newRuleInput.type = 'text'; newRuleInput.placeholder = 'URL前缀 或 /正则/';
  newRuleInput.style.cssText = 'flex:1;min-width:180px;padding:8px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;';
  const modeSelect = document.createElement('select');
  modeSelect.style.cssText = 'padding:8px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;background:white;';
  modeSelect.innerHTML = '<option value="page">📄 页面URL</option><option value="fetchv">🎯 媒体URL</option>';
  const addRuleBtn = document.createElement('button');
  addRuleBtn.textContent = '添加';
  addRuleBtn.style.cssText = 'background:#a855f7;color:white;border:none;border-radius:10px;padding:0 16px;cursor:pointer;font-size:14px;';
  addDiv.appendChild(newRuleInput); addDiv.appendChild(modeSelect); addDiv.appendChild(addRuleBtn);
  win.appendChild(addDiv);

  const rulesHint = document.createElement('p');
  rulesHint.textContent = '📄 页面URL：传递页面地址给MPV（依赖yt-dlp） | 🎯 媒体URL：捕获媒体直链 | 🍪/⬜ 点击切换Cookie';
  rulesHint.style.cssText = 'font-size:12px;color:#6b7280;margin:8px 0 0;';
  win.appendChild(rulesHint);

  const btnDiv = document.createElement('div');
  btnDiv.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin:20px 0;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'padding:8px 18px;border:1px solid #cbd5e1;background:white;border-radius:10px;cursor:pointer;font-size:14px;';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存设置';
  saveBtn.style.cssText = 'padding:8px 18px;background:#2563eb;color:white;border:none;border-radius:10px;cursor:pointer;font-size:14px;';
  btnDiv.appendChild(cancelBtn); btnDiv.appendChild(saveBtn);
  win.appendChild(btnDiv);

  win.insertAdjacentHTML('beforeend',
    '<div style="padding:14px;background:#f8fafc;border-radius:12px;font-size:13px;border-left:4px solid #a855f7;">' +
    '<b style="color:#1e293b;">🔧 安装说明</b><br><br>' +
    '<b>1.</b> 将 <code>mpv_bridge.exe</code> 和 <code>setup.bat</code> 放到 <code>mpv.exe</code> 同目录<br>' +
    '<b>2.</b> 在该目录运行 <code>setup.bat</code>，选 <b>1</b> 注册协议<br>' +
    '<b>3.</b> 打开扩展弹窗，粘贴 <code>chrome://version</code> 的可执行文件路径，一键注册<br>' +
    '<b>4.</b> 每个浏览器需单独注册一次<br>' +
    '<span style="color:#6b7280;">所有浏览器注册完成后可运行 setup.bat 选 2 移除协议。</span></div>');

  mask.appendChild(win);
  document.body.appendChild(mask);

  function renderRules() {
    while (rulesContainer.firstChild) rulesContainer.removeChild(rulesContainer.firstChild);
    if (tempRules.length === 0) {
      rulesContainer.innerHTML = '<div style="color:#6b7280;text-align:center;padding:12px;">暂无匹配规则，请添加</div>';
      return;
    }
    tempRules.forEach((rule, idx) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #e5e7eb;gap:4px;flex-wrap:wrap;';
      const span = document.createElement('span');
      span.textContent = rule.pattern;
      span.style.cssText = 'font-size:12px;color:#1f2937;word-break:break-all;flex:1;min-width:120px;';

      const cookieBtn = document.createElement('button');
      const hasCookie = !!rule.cookie;
      cookieBtn.textContent = hasCookie ? '🍪' : '⬜';
      cookieBtn.title = hasCookie ? 'Cookie：开' : 'Cookie：关';
      cookieBtn.style.cssText = 'background:'+(hasCookie?'#f59e0b':'#e5e7eb')+';color:'+(hasCookie?'#fff':'#6b7280')+';border:none;border-radius:6px;padding:2px 6px;cursor:pointer;font-size:14px;';
      cookieBtn.onclick = () => { rule.cookie = !rule.cookie; renderRules(); };

      const modeBtn = document.createElement('button');
      const isFetchv = rule.mode === 'fetchv';
      modeBtn.textContent = isFetchv ? '🎯 媒体URL' : '📄 页面URL';
      modeBtn.style.cssText = 'background:'+(isFetchv?'#10b981':'#a855f7')+';color:white;border:none;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px;white-space:nowrap;';
      modeBtn.onclick = () => { rule.mode = isFetchv ? 'page' : 'fetchv'; renderRules(); };

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:#fee2e2;color:#ef4444;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;';
      delBtn.onclick = () => { tempRules.splice(idx, 1); renderRules(); };

      item.appendChild(span); item.appendChild(cookieBtn); item.appendChild(modeBtn); item.appendChild(delBtn);
      rulesContainer.appendChild(item);
    });
  }
  renderRules();

  addRuleBtn.onclick = () => {
    let r = newRuleInput.value.trim();
    if (!r) { alert('请输入规则'); return; }
    if (tempRules.some(t => t.pattern === r)) { alert('规则已存在'); return; }
    tempRules.push({ pattern: r, mode: modeSelect.value, cookie: false });
    renderRules(); newRuleInput.value = '';
  };

  const closeMask = () => { mask.remove(); settingWindowOpen = false; };
  cancelBtn.onclick = closeMask;
  saveBtn.onclick = () => {
    if (tempRules.length === 0) { alert('至少需要一条匹配规则！'); return; }
    config.urlRules = tempRules.map(r => ({ pattern: r.pattern, mode: r.mode, cookie: !!r.cookie }));
    chrome.storage.local.set({ urlRules: config.urlRules }, () => {
      addButtons();
      alert('✅ 设置保存成功！\n\n🟣 紫色 = 页面URL | 🟢 绿色 = 媒体URL | ⬜ 灰色 = 等待');
      closeMask();
    });
  };
  mask.onclick = (e) => { if (e.target === mask) closeMask(); };
}

// ========== 全屏处理 ==========
function handleFullscreenChange() {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (currentPlayBtn && currentSettingBtn) {
    const d = fs ? 'none' : 'flex';
    currentPlayBtn.style.display = d; currentSettingBtn.style.display = d;
  }
}
['fullscreenchange','webkitfullscreenchange'].forEach(e => document.addEventListener(e, handleFullscreenChange));

// ========== 页面变化监听 ==========
let updateTimer = null;
function updateUI() {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    const cur = window.location.href;
    if (cur !== lastUrl) {
      try {
        const oldP = new URL(lastUrl || cur).pathname;
        const newP = new URL(cur).pathname;
        // 旧 URL 由 background.js tabs.onUpdated 自动清理
      } catch(e) {}
      lastUrl = cur;
    }
    addButtons();
  }, 200);
}

function observePageChanges() {
  window.addEventListener('popstate', updateUI);
  window.addEventListener('hashchange', updateUI);
  const op = history.pushState, or = history.replaceState;
  history.pushState = function() { op.apply(this, arguments); updateUI(); };
  history.replaceState = function() { or.apply(this, arguments); updateUI(); };
  setInterval(() => { if (window.location.href !== lastUrl) updateUI(); }, 1000);
  new MutationObserver(() => {
    if (document.body && isVideoPage() && (!currentPlayBtn || !currentPlayBtn.isConnected)) addButtons();
  }).observe(document.documentElement, { childList: true, subtree: true });
  updateUI();
}

// ========== 初始化 ==========
(function init() {
  setInterval(() => { if (currentPlayBtn && currentPlayBtn.isConnected) updateButtonStyle(); }, 3000);
  if (window.top === window.self) {
    window.__mpvDebug = async function() {
      console.log('URL:', window.location.href, 'Mode:', getCurrentMode());
      const urls = await new Promise(r => chrome.runtime.sendMessage({ cmd: 'GET_MEDIA_URLS' }, r));
      console.log('Captured:', urls?.urls?.length || 0);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observePageChanges);
    else observePageChanges();
  }
  // 响应 background 的边缘检测请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.cmd === 'CHECK_TEXT_CONTENT') {
      const { url, headers, requestId } = msg;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const hdrs = {};
      for (const h of (headers||[])) {
        hdrs[h.name] = h.value;
        if (h.name.toLowerCase() === 'cookie') hdrs['Cookie'] = h.value;
      }
      hdrs['X-Original-Request-Id'] = requestId;
      fetch(url, { method: 'GET', headers: hdrs, signal: ctrl.signal })
        .then(r => r.text())
        .then(text => { clearTimeout(timer); sendResponse({ isHls: text.trimStart().startsWith('#EXTM3U') }); })
        .catch(() => { clearTimeout(timer); sendResponse({ isHls: false }); });
      return true;
    }
    if (msg.cmd === 'CHECK_VIDEO_SRC') {
      const { url } = msg;
      const videos = document.querySelectorAll('video');
      let found = false;
      for (const v of videos) {
        if (v.src === url || v.currentSrc === url) { found = true; break; }
        for (const s of v.querySelectorAll('source')) {
          if (s.src === url) { found = true; break; }
        }
        if (found) break;
      }
      sendResponse({ isVideo: found });
    }
  });
})();