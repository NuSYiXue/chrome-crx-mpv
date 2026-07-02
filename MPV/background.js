// MPV Player - Service Worker
// 媒体捕获：webRequest + Content-Type判定 + 分tab存储（和 FetchV 一致）
const NATIVE_HOST_NAME = 'com.mpv_player';
const DEBUG = false;
function log(...a) { if (DEBUG) console.log('[MPV BG]', ...a); }

// ========== Cookie ==========
function toNetscapeFormat(cookies) {
  const lines = ['# Netscape HTTP Cookie File','# https://curl.haxx.se/rfc/cookie_spec.html','# This is a generated file! Do not edit.',''];
  for (const c of cookies) {
    lines.push([
      // Netscape 格式：hostOnly=false 需前导点（若已有则不重复加）
      (c.hostOnly ? c.domain : (c.domain?.startsWith('.') ? c.domain : '.' + c.domain)).replace(/[\t\n\r]/g,''),
      c.hostOnly ? 'FALSE' : 'TRUE',
      (c.path||'/').replace(/[\t\n\r]/g,''),
      c.secure?'TRUE':'FALSE',
      c.expirationDate?Math.floor(c.expirationDate).toString():'0',
      (c.name||'').replace(/[\t\n\r]/g,''),
      (c.value||'').replace(/[\t\n\r]/g,'')
    ].join('\t'));
  }
  return lines.join('\n')+'\n';
}

async function getCookiesForUrl(url) {
  try {
    const u = new URL(url);
    let all = await chrome.cookies.getAll({ url });
    try {
      const part = await chrome.cookies.getAll({ url, partitionKey:{ topLevelSite:u.origin } });
      const seen = new Set(all.map(c=>c.name+'|'+c.domain+'|'+c.path));
      for (const c of part) if (!seen.has(c.name+'|'+c.domain+'|'+c.path)) all.push(c);
    } catch(e) {}
    return all;
  } catch(e) { return []; }
}

// ========== Native Messaging ==========
function sendToNativeHost(message) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if(!done){done=true;reject(new Error('响应超时'));} }, 10000);
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      port.onMessage.addListener(r => { clearTimeout(timer); done=true; port.disconnect(); resolve(r); });
      port.onDisconnect.addListener(() => {
        if(done)return; clearTimeout(timer); done=true;
        reject(new Error((chrome.runtime.lastError?.message)||'Native Host 意外断开'));
      });
      port.postMessage(message);
    } catch(e) { if(!done){clearTimeout(timer);done=true;reject(new Error('无法连接: '+e.message));} }
  });
}

// ========== webRequest 媒体捕获（FetchV 方案 + 分 tab 存储）==========
const mediaStore = {}; // tabId → [{url,type,format,size,contentType,ts}]
const savedHeaders = {};

const M3U8_EXT = ['m3u8','m3u','mpd'];
const VIDEO_EXT = ['mp4','webm','mkv','flv','avi','mov','wmv','3gp','ogg','ogv','m4s','f4v','ts','acc','rmvb'];
const AUDIO_EXT = ['mp3','wav','aac','flac','m4a','opus'];
const ALL_EXTS = [...M3U8_EXT, ...VIDEO_EXT, ...AUDIO_EXT];

const CT_FORMAT_MAP = {
  'application/vnd.apple.mpegurl':'m3u8','application/x-mpegurl':'m3u8',
  'video/mp4':'mp4','video/webm':'webm','video/ogg':'ogg',
  'video/x-flv':'flv','video/quicktime':'mov','video/x-msvideo':'avi',
  'video/x-ms-wmv':'wmv','video/x-matroska':'mkv',
  'video/x-f4v':'f4v','video/iso.segment':'m4s',
  'video/3gpp':'3gp','video/3gpp2':'3gp2',
  'audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg',
  'application/vnd.americandynamics.acc':'acc',
  'application/vnd.rn-realmedia-vbr':'rmvb',
};
const STREAM_CT = {'application/octet-stream':true,'binary/octet-stream':true};
const BLOCKED_HOSTS = ['doppiocdn','adtng','afcdn','sacdnssedge'];

function hasKnownExt(url) {
  try { const p = new URL(url).pathname.toLowerCase(); return ALL_EXTS.some(e=>p.endsWith('.'+e)||p.includes('.'+e+'?')); } catch(e) { return false; }
}

function extType(url) {
  try { const p = new URL(url).pathname.toLowerCase();
    for(const e of M3U8_EXT) if(p.endsWith('.'+e)) return 'm3u8';
    for(const e of VIDEO_EXT) if(p.endsWith('.'+e)) return 'video';
    for(const e of AUDIO_EXT) if(p.endsWith('.'+e)) return 'audio';
  } catch(e) {}
  return null;
}

function isBlockedHost(h) {
  const parts = h.split('.'); parts.pop();
  return parts.length>0 && BLOCKED_HOSTS.includes(parts[parts.length-1]);
}

function storeMedia(tabId, url, type, format, size, ct) {
  if (tabId < 0) return;
  if (!mediaStore[tabId]) mediaStore[tabId] = [];
  const store = mediaStore[tabId];
  const base = url.split('?')[0];
  if (store.some(u => u.url.split('?')[0] === base)) return;
  if (store.length > 50) store.shift();
  store.push({ url, type, format: format||type, size, contentType: ct||'', ts: Date.now() });
  log(`捕获 [tab=${tabId}] [${type}/${format}] ct=${ct||'-'} ${size}B`);
}

// 导航时清空该 tab 的存储（和 FetchV tabs.onUpdated 一致）
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) delete mediaStore[tabId];
});
chrome.tabs.onRemoved.addListener(tabId => { delete mediaStore[tabId]; });

let _lastActiveTab = null;

chrome.webRequest.onBeforeSendHeaders.addListener(
  d => {
    if (!d.initiator||!d.initiator.startsWith('http')) return;
    savedHeaders[d.requestId] = d.requestHeaders||[];
  },
  { urls:['<all_urls>'], types:['media','xmlhttprequest','object','other'] },
  ['requestHeaders','extraHeaders']
);

function isTextContent(ct) {
  return /^(text\/|application\/(json|xml|javascript))/i.test(ct);
}

async function checkTextContent(tabId, url, headers, method, requestId) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, {
      cmd: 'CHECK_TEXT_CONTENT',
      url, headers, method, requestId
    }, r => { resolve(r?.isHls === true); });
  });
}

async function checkVideoSrc(tabId, url) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, {
      cmd: 'CHECK_VIDEO_SRC', url
    }, r => { resolve(r?.isVideo === true); });
  });
}

chrome.webRequest.onResponseStarted.addListener(
  async details => {
    const { url, tabId: rtid, responseHeaders, type: reqType, statusCode, initiator, requestId, method, documentId } = details;
    if (!url.startsWith('http')||!initiator||!initiator.startsWith('http')) return;
    if (statusCode<200||statusCode>299) return;

    const reqH = savedHeaders[requestId]||[]; delete savedHeaders[requestId];
    if (reqH.some(h=>h.name.toLowerCase()==='x-original-request-id')) return;

    try { if (isBlockedHost(new URL(url).hostname)) return; } catch(e) {}

    let tabId = rtid;
    if (tabId < 0) {
      if (_lastActiveTab) tabId = _lastActiveTab;
      else {
        try {
          const ih = new URL(initiator).hostname;
          chrome.tabs.query({active:true,lastFocusedWindow:true}, ([t]) => {
            if (t?.url && new URL(t.url).hostname===ih) { _lastActiveTab=t.id; setTimeout(()=>{_lastActiveTab=null;},60000); }
          });
        } catch(e) {}
        return;
      }
    }

    let ct='', cl=0;
    if (responseHeaders) for (const h of responseHeaders) {
      const n = h.name.toLowerCase();
      if (n==='content-type') ct = (h.value||'').split(';')[0].trim();
      if (n==='content-length') cl = parseInt(h.value)||0;
      if (n==='content-range') { const m=(h.value||'').match(/\/(\d+)/); if(m) cl=parseInt(m[1])||0; }
    }

    if (!ct) {
      if ((reqType==='media'||reqType==='xmlhttprequest') && hasKnownExt(url)) ct = '';
      else return;
    }

    let format = extType(url);
    let type = format;

    // CHECK_TEXT_CONTENT: XHR 请求返回 text/json 但可能是 m3u8（和 FetchV 一致）
    if (!type && reqType==='xmlhttprequest' && ct && isTextContent(ct) && method==='GET') {
      const isHls = await checkTextContent(tabId, url, reqH, method, requestId);
      if (isHls) {
        storeMedia(tabId, url, 'm3u8', 'm3u8', cl, 'application/vnd.apple.mpegurl');
      }
      return;
    }

    if (!type && ct) {
      const clow = ct.toLowerCase();
      const fm = CT_FORMAT_MAP[clow];
      if (fm) {
        if (M3U8_EXT.includes(fm)) type='m3u8'; else if (VIDEO_EXT.includes(fm)) type='video'; else if (AUDIO_EXT.includes(fm)) type='audio';
        format = fm;
      } else if (STREAM_CT[clow]) {
        if (!hasKnownExt(url)) return;
        type = 'video';
      }
    }

    // CHECK_VIDEO_SRC: 无法判定类型但有 Content-Range，检查页面 DOM（和 FetchV 一致）
    if (!type && reqType==='xmlhttprequest' && cl>0) {
      const isVideo = await checkVideoSrc(tabId, url);
      if (isVideo) {
        storeMedia(tabId, url, 'video', 'mp4', cl, ct);
      }
      return;
    }

    if (!type) {
      if (reqType==='media') type='video'; else return;
    }
    if (type!=='m3u8' && !cl) return;

    storeMedia(tabId, url, type, format, cl, ct);
  },
  { urls:['<all_urls>'], types:['media','xmlhttprequest','object','other'] },
  ['responseHeaders','extraHeaders']
);

// ========== 消息路由 ==========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { cmd } = msg;
  const tabId = sender.tab?.id;

  if (cmd === 'GET_MEDIA_URLS') {
    sendResponse({ urls: mediaStore[tabId] || [] });
    return false;
  }
  if (cmd === 'GET_BEST_URL') {
    const urls = mediaStore[tabId] || [];
    log(`BEST_URL tab=${tabId}: ${urls.length}候选`);
    if (!urls.length) { sendResponse({ url: null }); return false; }
    const byCt = urls.filter(u=>u.contentType?.toLowerCase().includes('mpegurl'));
    if (byCt.length) { sendResponse({ url: byCt[byCt.length-1].url }); return false; }
    const byExt = urls.filter(u=>u.type==='m3u8'&&/\.(m3u8|m3u|mpd)/i.test(u.url));
    if (byExt.length) { sendResponse({ url: byExt[byExt.length-1].url }); return false; }
    const m3 = urls.filter(u=>u.type==='m3u8');
    if (m3.length) { sendResponse({ url: m3[m3.length-1].url }); return false; }
    const vid = urls.filter(u=>u.type==='video');
    if (vid.length) { vid.sort((a,b)=>b.size-a.size); sendResponse({ url: vid[0].url }); return false; }
    sendResponse({ url: urls[urls.length-1].url });
    return false;
  }
  if (cmd === 'PLAY_WITH_MPV') {
    let { url, withCookies, args } = msg;
    try {
      const u = new URL(url);
      const fixed = []; for (const [k,v] of u.searchParams) fixed.push(k+'='+encodeURIComponent(v));
      u.search = fixed.join('&'); url = u.toString();
    } catch(e) {}
    log(`播放: cookie=${withCookies} ${url?.substring(0,80)}`);
    (async () => {
      try {
        let cookies = '';
        if (withCookies) { const a = await getCookiesForUrl(url); if (a.length) cookies = toNetscapeFormat(a); }
        const r = await sendToNativeHost({ action:'play', url, cookies, args:args||'' });
        sendResponse({ success:true, data:r });
      } catch(e) { sendResponse({ success:false, error:e.message }); }
    })();
    return true;
  }
  if (cmd === 'CHECK_NATIVE_HOST') {
    (async () => {
      try { const r=await sendToNativeHost({ action:'ping' }); sendResponse({ available:true, data:r }); }
      catch(e) { sendResponse({ available:false, error:e.message }); }
    })();
    return true;
  }
  return false;
});

console.log('[MPV Background] 已启动');
