// MPV 播放器 - Popup 脚本
'use strict';

const DEFAULT_RULES = [
  { pattern: 'https://www.bilibili.com/video/', mode: 'page', cookie: true },
  { pattern: 'https://www.youtube.com/watch', mode: 'page', cookie: false }
];

// DOM 元素
const hostBadge = document.getElementById('hostBadge');
const registeredView = document.getElementById('registeredView');
const unregisteredView = document.getElementById('unregisteredView');
const registerBtn = document.getElementById('registerBtn');
const recheckBtn = document.getElementById('recheckBtn');
const rulesList = document.getElementById('rulesList');
const newRulePattern = document.getElementById('newRulePattern');
const newRuleMode = document.getElementById('newRuleMode');
const addRuleBtn = document.getElementById('addRuleBtn');
const saveBtn = document.getElementById('saveBtn');

// 数据
let urlRules = [...DEFAULT_RULES];

// ==================== 配置 ====================

function loadConfig() {
  chrome.storage.local.get(['urlRules'], (result) => {
    if (result.urlRules && result.urlRules.length > 0) {
      urlRules = result.urlRules.map(r => ({ pattern: r.pattern, mode: r.mode, cookie: !!r.cookie }));
    }
    renderRules();
  });
}

// ==================== Native Host 检测与注册 ====================

function checkNativeHost() {
  hostBadge.textContent = '检测中...';
  hostBadge.className = 'badge badge-pending';
  registeredView.style.display = 'none';
  unregisteredView.style.display = 'none';

  chrome.runtime.sendMessage({ cmd: 'CHECK_NATIVE_HOST' }, (response) => {
    if (chrome.runtime.lastError) {
      showHostStatus(false, '通信失败');
      return;
    }
    if (response && response.available) {
      showHostStatus(true, '已就绪');
    } else {
      showHostStatus(false, '未注册');
    }
  });
}

function showHostStatus(isRegistered, text) {
  if (isRegistered) {
    hostBadge.textContent = '✅ ' + text;
    hostBadge.className = 'badge badge-ok';
    registeredView.style.display = 'block';
    unregisteredView.style.display = 'none';
  } else {
    hostBadge.textContent = '❌ ' + text;
    hostBadge.className = 'badge badge-error';
    registeredView.style.display = 'none';
    unregisteredView.style.display = 'block';
  }
}

// 从可执行文件路径解析 vendor\product
// C:\...\BraveSoftware\Brave-Browser\Application\brave.exe → BraveSoftware\Brave-Browser
function parseExePath(path) {
  const m = path.match(/([^\\]+)\\([^\\]+)\\Application\\[^\\]+\.exe$/i);
  return m ? m[1] + '\\' + m[2] : null;
}

function getRegPathFor(inputId) {
  const path = document.getElementById(inputId).value.trim();
  const parsed = parseExePath(path);
  const hintId = inputId === 'exePathInputReg' ? 'unregHint' : 'browserHint';
  const hint = document.getElementById(hintId);
  if (parsed) {
    if (hint) hint.textContent = '识别到: HKCU\\Software\\' + parsed + '\\NativeMessagingHosts\\';
    return parsed;
  }
  if (hint) hint.textContent = '';
  return null;
}

function doRegister() {
  const extId = chrome.runtime.id;
  openProtocol('mpvreg://' + encodeURIComponent(getRegPathFor('exePathInput')) + '?ext=' + extId);
}

function doUnregister() {
  if (!confirm('确认移除注册？')) return;
  openProtocol('mpvreg://unreg/' + encodeURIComponent(getRegPathFor('exePathInputReg')));
}

function openProtocol(url) {
  const w = window.open(url, '_blank');
  if (!w || w.closed) {
    setTimeout(() => {
      alert('已发送。如弹出对话框请允许。\n没反应请先运行 setup.bat 选 1。');
    }, 500);
  } else {
    setTimeout(() => { try { w.close(); } catch(e) {} }, 1000);
  }
}

registerBtn.addEventListener('click', () => {
  if (!getRegPathFor('exePathInput')) { alert('请先粘贴 chrome://version 中的"可执行文件路径"'); return; }
  doRegister();
});
const unregisterBtn = document.getElementById('unregisterBtn');
if (unregisterBtn) {
  unregisterBtn.addEventListener('click', () => {
    if (!getRegPathFor('exePathInputReg')) { alert('请先粘贴 chrome://version 中的"可执行文件路径"'); return; }
    doUnregister();
  });
}
recheckBtn.addEventListener('click', checkNativeHost);
document.querySelectorAll('#openVersionBtn, #openVersionBtn2').forEach(b =>
  b.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://version' }))
);

// 实时解析（注册和反注册两个输入框）
['exePathInput', 'exePathInputReg'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => getRegPathFor(id));
});

// ==================== 规则管理 ====================

function renderRules() {
  rulesList.innerHTML = '';
  if (urlRules.length === 0) {
    rulesList.innerHTML = '<div class="empty-hint">暂无规则，点击 + 添加</div>';
    return;
  }
  urlRules.forEach((rule, idx) => {
    const item = document.createElement('div');
    item.className = 'rule-item';

    const patternSpan = document.createElement('span');
    patternSpan.className = 'rule-pattern';
    patternSpan.textContent = rule.pattern;
    patternSpan.title = rule.pattern;

    // Cookie 开关
    const cookieBtn = document.createElement('button');
    const hasCookie = !!rule.cookie;
    cookieBtn.className = 'rule-cookie';
    cookieBtn.textContent = hasCookie ? '🍪' : '⬜';
    cookieBtn.title = hasCookie ? 'Cookie：开（点击关闭）' : 'Cookie：关（点击开启）';
    cookieBtn.onclick = () => {
      rule.cookie = !rule.cookie;
      renderRules();
    };

    // 模式切换
    const modeBtn = document.createElement('button');
    const isFetchv = rule.mode === 'fetchv';
    modeBtn.className = 'rule-mode ' + (isFetchv ? 'fetchv' : 'page');
    modeBtn.textContent = isFetchv ? '🎯 媒体URL' : '📄 页面URL';
    modeBtn.title = '点击切换';
    modeBtn.onclick = () => {
      rule.mode = isFetchv ? 'page' : 'fetchv';
      renderRules();
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'rule-del';
    delBtn.textContent = '✕';
    delBtn.onclick = () => { urlRules.splice(idx, 1); renderRules(); };

    item.appendChild(patternSpan);
    item.appendChild(cookieBtn);
    item.appendChild(modeBtn);
    item.appendChild(delBtn);
    rulesList.appendChild(item);
  });
}

addRuleBtn.addEventListener('click', () => {
  const pattern = newRulePattern.value.trim();
  if (!pattern) { alert('请输入规则'); return; }
  if (urlRules.some(r => r.pattern === pattern)) { alert('规则已存在'); return; }
  urlRules.push({ pattern, mode: newRuleMode.value, cookie: false });
  renderRules();
  newRulePattern.value = '';
});

newRulePattern.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addRuleBtn.click();
});

// ==================== 保存 ====================

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({ urlRules }, () => {
    saveBtn.textContent = '✅ 已保存';
    saveBtn.style.background = '#10b981';
    setTimeout(() => {
      saveBtn.textContent = '💾 保存设置';
      saveBtn.style.background = '#2563eb';
    }, 1500);
  });
});

// ==================== 初始化 ====================

loadConfig();
checkNativeHost();
