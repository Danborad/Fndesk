// Fndesk Lite - 飞牛桌面图标工坊与 WeTab 小组件轻量后端
// 纯净 Node.js 原生服务，无外部二进制依赖，常驻内存仅约 15MB

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync, spawn } = require("child_process");
const { URL } = require("url");
const os = require("os");

const PORT = parseInt(process.env.FNDESK_PORT || "9990", 10);
const DOMAIN_SOCKET_PATH = "/var/apps/fndesk/target/fndesk.sock";

// 数据存储路径：保留用户原有的 deskdata 目录
const DATA_DIR = path.resolve("/vol1/@appshare/fndesk/deskdata");
const CONFIG_FILE = path.join(DATA_DIR, "data.json");
const WIDGETS_FILE = path.join(DATA_DIR, "widgets.json");
const PW_FILE = path.join(DATA_DIR, "pw.json");
const IMG_DIR = path.join(DATA_DIR, "img");
const APPCENTER_CLI = "/usr/local/bin/appcenter-cli";
const TEMPLATE_DIR = path.join(__dirname, "fndesk_app");

// 飞牛桌面注入与还原防搞坏配置
const ORIGINAL_INDEX = "/usr/trim/www/index.html.original";
const DATA_BACKUP_INDEX = path.join(DATA_DIR, "index.html.original");
const TARGET_INDEX = "/usr/trim/www/index.html";
const INJECT_JS_DEST = "/usr/trim/www/static/fndesk-desktop.js";

// 确保基础目录与备份存在
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify([], null, 2), "utf8");
  }
}
ensureDirs();

// 桌面安全备份机制：初次运行时先备份出厂 index.html
function ensureOriginalBackup() {
  try {
    if (!fs.existsSync(DATA_BACKUP_INDEX) && fs.existsSync(TARGET_INDEX)) {
      const content = fs.readFileSync(TARGET_INDEX, "utf8");
      if (!content.includes("fndesk-desktop-inject")) {
        fs.writeFileSync(DATA_BACKUP_INDEX, content, "utf8");
      }
    }
    if (!fs.existsSync(ORIGINAL_INDEX) && fs.existsSync(DATA_BACKUP_INDEX)) {
      fs.copyFileSync(DATA_BACKUP_INDEX, ORIGINAL_INDEX);
    }
  } catch (e) {
    console.warn("[Fndesk Lite] 备份 index.html 警告:", e.message);
  }
}
ensureOriginalBackup();

// 检查桌面是否已注入生效
function getDesktopStatus() {
  if (!fs.existsSync(TARGET_INDEX)) {
    return { injected: false, hasBackup: false };
  }
  try {
    const content = fs.readFileSync(TARGET_INDEX, "utf8");
    const injected = content.includes("fndesk-desktop-inject");
    const hasBackup = fs.existsSync(DATA_BACKUP_INDEX) || fs.existsSync(ORIGINAL_INDEX);
    return { injected, hasBackup };
  } catch (_) {
    return { injected: false, hasBackup: false };
  }
}

// 立即生效（注入桌面）
// 立即生效（注入桌面与 WeTab 小组件）
function applyDesktop() {
  ensureOriginalBackup();
  if (!fs.existsSync(TARGET_INDEX)) {
    throw new Error("未找到飞牛桌面文件: " + TARGET_INDEX);
  }

  // 1. 设置 NGXMODE=dev 到 systemd drop-in override，防止 nginx inotify fwatch 触发自动还原！
  const overrideDir = "/etc/systemd/system/trim_nginx.service.d";
  const overrideFile = path.join(overrideDir, "override.conf");
  try {
    if (!fs.existsSync(overrideDir)) fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(overrideFile, "[Service]\nEnvironment=\"NGXMODE=dev\"\n", "utf8");
    execSync("systemctl daemon-reload", { stdio: "ignore" });
  } catch (e) {
    console.warn("[Fndesk Lite] systemd override 写入警告:", e.message);
  }

  // 2. 发送信号 63 (SIGRTMAX - 1) 立即禁用当前运行中的 nginx 监控
  try {
    if (fs.existsSync("/run/nginx.pid")) {
      const nginxPid = fs.readFileSync("/run/nginx.pid", "utf8").trim();
      if (nginxPid) process.kill(parseInt(nginxPid, 10), 63);
    }
  } catch (_) {}

  // 3. 复制 fndesk-desktop.js 到 /usr/trim/www/static/fndesk-desktop.js
  const localInjectJs = path.join(__dirname, "static", "fndesk-desktop.js");
  if (fs.existsSync(localInjectJs)) {
    const destDir = path.dirname(INJECT_JS_DEST);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(localInjectJs, INJECT_JS_DEST);
    try { fs.chmodSync(INJECT_JS_DEST, 0o644); } catch (_) {}
  }

  // 4. 注入 script 标签到 /usr/trim/www/index.html
  let content = fs.readFileSync(TARGET_INDEX, "utf8");
  if (!content.includes("fndesk-desktop-inject")) {
    const injectTag = '<script id="fndesk-desktop-inject" src="/static/fndesk-desktop.js"></script>';
    if (content.includes("</body>")) {
      content = content.replace("</body>", `${injectTag}</body>`);
    } else {
      content += injectTag;
    }
    fs.writeFileSync(TARGET_INDEX, content, "utf8");
    try { fs.chmodSync(TARGET_INDEX, 0o644); } catch (_) {}
  }
  return true;
}

// 一键还原飞牛官方纯净桌面（防搞坏机制）
function restoreDesktop() {
  // 1. 优先从官方原始备份还原 /usr/trim/www/index.html
  let originalContent = null;
  if (fs.existsSync(DATA_BACKUP_INDEX)) {
    originalContent = fs.readFileSync(DATA_BACKUP_INDEX, "utf8");
  } else if (fs.existsSync(ORIGINAL_INDEX)) {
    originalContent = fs.readFileSync(ORIGINAL_INDEX, "utf8");
  }

  if (originalContent) {
    fs.writeFileSync(TARGET_INDEX, originalContent, "utf8");
  } else if (fs.existsSync(TARGET_INDEX)) {
    let cur = fs.readFileSync(TARGET_INDEX, "utf8");
    cur = cur.replace(/<script id="fndesk-desktop-inject"[^>]*><\/script>/g, "");
    fs.writeFileSync(TARGET_INDEX, cur, "utf8");
  }

  // 2. 移除注入的静态脚本
  if (fs.existsSync(INJECT_JS_DEST)) {
    try { fs.unlinkSync(INJECT_JS_DEST); } catch (_) {}
  }

  // 3. 移除 systemd 覆盖配置
  const overrideFile = "/etc/systemd/system/trim_nginx.service.d/override.conf";
  if (fs.existsSync(overrideFile)) {
    try {
      fs.unlinkSync(overrideFile);
      execSync("systemctl daemon-reload", { stdio: "ignore" });
    } catch (_) {}
  }

  // 4. 发送信号 64 (SIGRTMAX) 重新开启监控
  try {
    if (fs.existsSync("/run/nginx.pid")) {
      const nginxPid = fs.readFileSync("/run/nginx.pid", "utf8").trim();
      if (nginxPid) process.kill(parseInt(nginxPid, 10), 64);
    }
  } catch (_) {}

  // 5. 平滑重载 nginx
  try {
    execSync("systemctl reload trim_nginx.service || true", { stdio: "ignore" });
  } catch (_) {}

  return true;
}

// 获取局域网 IP
function getLanIp() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const net of ifaces[name]) {
        if (net.family === "IPv4" && !net.internal && (net.address.startsWith("192.168.") || net.address.startsWith("10.") || net.address.startsWith("172."))) {
          return net.address;
        }
      }
    }
  } catch (_) {}
  return "127.0.0.1";
}

// 常用 NAS / Docker 品牌高清矢量图标库
const PRESET_ICONS = {
  docker: {
    name: "Docker",
    color: "#0db7ed",
    svg: `<svg viewBox="0 0 24 24" fill="#0db7ed"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.186.185.186m0 2.715h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.186.185.186m-2.953 0h2.118a.186.186 0 00.186-.186V6.29a.186.186 0 00-.186-.185H8.076a.185.185 0 00-.185.185v1.887c0 .102.082.186.185.186m0 2.715h2.118a.187.187 0 00.186-.186V9.006a.186.186 0 00-.186-.186H8.076a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.954 0h2.119a.186.186 0 00.185-.185V9.006a.185.185 0 00-.185-.186H5.122a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m17.067 1.836c-.45-.292-1.346-.42-2.316-.363-.19-1.285-.92-2.348-1.996-2.92l-.337-.183-.243.303c-.66.822-1.07 1.874-1.155 3.01H1.054a.87.87 0 00-.868.868c0 2.378.93 4.607 2.622 6.275C4.4 22.38 6.54 23.2 8.85 23.2c5.96 0 10.988-3.77 12.876-9.176.697.043 1.63-.09 2.228-.69.21-.21.05-.62-.27-.68z"/></svg>`
  },
  qinglong: {
    name: "青龙面板",
    color: "#10b981",
    svg: `<svg viewBox="0 0 24 24" fill="#10b981"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l-8-4v8l8 5 8-5v-8l-8 4zm0 2.5l5.5-3.5v5L12 18.5 6.5 15v-5l5.5 3.5z"/></svg>`
  },
  newapi: {
    name: "New-API",
    color: "#3b82f6",
    svg: `<svg viewBox="0 0 24 24" fill="#3b82f6"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm1 14.93V15h-2v1.93A8 8 0 014.07 13H6v-2H4.07A8 8 0 0111 4.07V6h2V4.07A8 8 0 0119.93 11H18v2h1.93A8 8 0 0113 16.93zM12 7a5 5 0 105 5 5 5 0 00-5-5z"/></svg>`
  },
  jellyfin: {
    name: "Jellyfin",
    color: "#00a4dc",
    svg: `<svg viewBox="0 0 24 24" fill="#00a4dc"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>`
  },
  plex: {
    name: "Plex",
    color: "#e5a00d",
    svg: `<svg viewBox="0 0 24 24" fill="#e5a00d"><path d="M11.643 0H4.68l7.587 12-7.587 12h6.963l7.587-12z"/></svg>`
  },
  emby: {
    name: "Emby",
    color: "#52B54B",
    svg: `<svg viewBox="0 0 24 24" fill="#52B54B"><path d="M11.02 2.05L2.3 6.94c-.6.34-.97.97-.97 1.66v9.79c0 .69.37 1.32.97 1.66l8.72 4.89c.61.34 1.35.34 1.96 0l8.72-4.89c.6-.34.97-.97.97-1.66V8.6c0-.69-.37-1.32-.97-1.66l-8.72-4.89a1.98 1.98 0 00-1.96 0zm-1.02 5.95l6 4-6 4V8z"/></svg>`
  },
  portainer: {
    name: "Portainer",
    color: "#13bef9",
    svg: `<svg viewBox="0 0 24 24" fill="#13bef9"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm1 14.93V15h-2v1.93A8 8 0 014.07 13H6v-2H4.07A8 8 0 0111 4.07V6h2V4.07A8 8 0 0119.93 11H18v2h1.93A8 8 0 0113 16.93zM12 8a4 4 0 104 4 4 4 0 00-4-4z"/></svg>`
  },
  alist: {
    name: "Alist",
    color: "#1677ff",
    svg: `<svg viewBox="0 0 24 24" fill="#1677ff"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>`
  },
  nginx: {
    name: "Nginx",
    color: "#009639",
    svg: `<svg viewBox="0 0 24 24" fill="#009639"><path d="M12 0L1.605 6v12L12 24l10.395-6V6L12 0zm5.175 16.65L12 8.85v7.8H9.375V7.35l5.25 7.8v-7.8h2.55v9.3z"/></svg>`
  },
  redis: {
    name: "Redis",
    color: "#d82c20",
    svg: `<svg viewBox="0 0 24 24" fill="#d82c20"><path d="M21.94 13.11l-9.15 4.88a1.64 1.64 0 01-1.58 0l-9.15-4.88a1.65 1.65 0 010-2.9l9.15-4.88a1.64 1.64 0 011.58 0l9.15 4.88a1.65 1.65 0 010 2.9zm-9.94 6.32l9.15-4.88a1.65 1.65 0 01.79 1.45v2.24a1.65 1.65 0 01-.79 1.45l-9.15 4.88a1.64 1.64 0 01-1.58 0L1.27 19.7a1.65 1.65 0 01-.79-1.45V16a1.65 1.65 0 01.79-1.45l9.15 4.88a1.64 1.64 0 001.58 0z"/></svg>`
  },
  postgres: {
    name: "PostgreSQL",
    color: "#336791",
    svg: `<svg viewBox="0 0 24 24" fill="#336791"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>`
  },
  nezha: {
    name: "哪吒监控",
    color: "#0284c7",
    svg: `<svg viewBox="0 0 24 24" fill="#0284c7"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`
  },
  openai: {
    name: "OpenAI",
    color: "#10a37f",
    svg: `<svg viewBox="0 0 24 24" fill="#10a37f"><path d="M22.28 9.37a5.98 5.98 0 00-.51-4.9 6.07 6.07 0 00-6.52-2.83 6.06 6.06 0 00-4.42-1.64 6.13 6.13 0 00-5.83 4.25 6.07 6.07 0 00-4.04 2.93 6.06 6.06 0 00.7 7.02 5.98 5.98 0 00.51 4.9 6.07 6.07 0 006.52 2.83 6.06 6.06 0 004.42 1.64 6.13 6.13 0 005.83-4.25 6.07 6.07 0 004.04-2.93 6.06 6.06 0 00-.7-7.02zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/></svg>`
  },
  homeassistant: {
    name: "Home Assistant",
    color: "#03a9f4",
    svg: `<svg viewBox="0 0 24 24" fill="#03a9f4"><path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z"/></svg>`
  },
  vaultwarden: {
    name: "Vaultwarden",
    color: "#175ddc",
    svg: `<svg viewBox="0 0 24 24" fill="#175ddc"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>`
  },
  torrent: {
    name: "Qbit / 下载",
    color: "#2563eb",
    svg: `<svg viewBox="0 0 24 24" fill="#2563eb"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>`
  }
};

function matchPresetIcon(meta = {}) {
  const text = `${meta.title || ""} ${meta.name || ""} ${meta.image || ""} ${meta.url || ""}`.toLowerCase();
  for (const [key, item] of Object.entries(PRESET_ICONS)) {
    if (text.includes(key) || text.includes(item.name.toLowerCase())) {
      const b64 = Buffer.from(item.svg).toString("base64");
      return {
        brand: item.name,
        color: item.color,
        dataUrl: `data:image/svg+xml;base64,${b64}`
      };
    }
  }
  if (text.includes("3000") || text.includes("canvas") || text.includes("chatgpt") || text.includes("ai")) {
    const item = PRESET_ICONS.openai;
    return { brand: "AI / Canvas", color: item.color, dataUrl: `data:image/svg+xml;base64,${Buffer.from(item.svg).toString("base64")}` };
  }
  return null;
}

// 检查是否设置过密码
function hasPassword() {
  if (!fs.existsSync(PW_FILE)) return false;
  try {
    const raw = fs.readFileSync(PW_FILE, "utf8");
    const json = JSON.parse(raw);
    return Boolean(json && json.hash);
  } catch (_) {
    return false;
  }
}

// 密码验证
function verifyPassword(pwd) {
  if (!hasPassword()) return true;
  try {
    const raw = fs.readFileSync(PW_FILE, "utf8");
    const json = JSON.parse(raw);
    const hash = crypto.createHash("sha256").update(String(pwd)).digest("hex");
    return json.hash === hash;
  } catch (_) {
    return false;
  }
}

// 设置新密码
function setPassword(newPwd) {
  const hash = crypto.createHash("sha256").update(String(newPwd)).digest("hex");
  fs.writeFileSync(PW_FILE, JSON.stringify({ hash, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

// 读取图标配置
function readIcons() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return [];
    const content = fs.readFileSync(CONFIG_FILE, "utf8").trim();
    if (!content) return [];
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[Fndesk Lite] 读取 data.json 失败:", e.message);
    return [];
  }
}

// 写入图标配置
function writeIcons(icons) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(icons, null, 2), "utf8");
}

// 读取 WeTab 小组件配置
function readWidgets() {
  try {
    if (!fs.existsSync(WIDGETS_FILE)) {
      const initial = [
        {
          id: 1,
          type: "weather",
          size: "medium",
          city: "北京",
          theme: "glass",
          sort: 10
        },
        {
          id: 2,
          type: "countdown",
          size: "small",
          title: "国庆节",
          targetDate: "2026-10-01T00:00",
          theme: "forest",
          sort: 20
        },
        {
          id: 3,
          type: "clock",
          size: "small",
          style: "digital",
          theme: "dark",
          sort: 30
        }
      ];
      fs.writeFileSync(WIDGETS_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const raw = fs.readFileSync(WIDGETS_FILE, "utf8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("[Fndesk Lite] 读取 widgets.json 失败:", e.message);
    return [];
  }
}

// 写入 WeTab 小组件配置
function writeWidgets(widgets) {
  fs.writeFileSync(WIDGETS_FILE, JSON.stringify(widgets, null, 2), "utf8");
}

// 天气缓存与翻译
const weatherCache = {};
const WEATHER_TRANSLATIONS = {
  "sunny": "晴",
  "clear": "晴",
  "partly cloudy": "多云",
  "cloudy": "阴",
  "overcast": "阴天",
  "mist": "薄雾",
  "fog": "大雾",
  "haze": "霾",
  "smoky haze": "轻度霾",
  "light rain": "小雨",
  "patchy rain nearby": "局部有雨",
  "moderate rain": "中雨",
  "heavy rain": "大雨",
  "torrential rain shower": "暴雨",
  "thunderstorm": "雷阵雨",
  "light snow": "小雪",
  "moderate snow": "中雪",
  "heavy snow": "大雪",
  "sleet": "雨夹雪",
  "windy": "大风"
};

function translateWeather(desc = "") {
  const lower = desc.trim().toLowerCase();
  for (const [k, v] of Object.entries(WEATHER_TRANSLATIONS)) {
    if (lower.includes(k)) return v;
  }
  return desc || "晴";
}

async function getWeather(city = "北京") {
  const key = (city || "北京").trim();
  if (weatherCache[key] && Date.now() - weatherCache[key].timestamp < 20 * 60 * 1000) {
    return weatherCache[key].data;
  }

  try {
    const url = `https://wttr.in/${encodeURIComponent(key)}?format=j1`;
    const res = await httpGet(url, false);
    const json = JSON.parse(res.buffer.toString("utf8"));
    const curr = json.current_condition[0];
    const weather = json.weather || [];
    const today = weather[0] || {};
    const rawDesc = curr.weatherDesc && curr.weatherDesc[0] ? curr.weatherDesc[0].value : "";
    const result = {
      city: key,
      temp: curr.temp_C,
      feelsLike: curr.FeelsLikeC,
      desc: translateWeather(rawDesc),
      humidity: curr.humidity + "%",
      wind: (curr.winddir16Point || "") + " " + (curr.windspeedKmph ? curr.windspeedKmph + "km/h" : "微风"),
      tempMin: today.mintempC || curr.temp_C,
      tempMax: today.maxtempC || curr.temp_C,
      forecast: weather.slice(0, 5).map(w => ({
        date: w.date,
        tempMin: w.mintempC,
        tempMax: w.maxtempC,
        desc: translateWeather(w.hourly && w.hourly[4] && w.hourly[4].weatherDesc ? w.hourly[4].weatherDesc[0].value : "晴")
      }))
    };
    weatherCache[key] = { timestamp: Date.now(), data: result };
    return result;
  } catch (e) {
    console.warn("[Fndesk Lite] 获取天气失败，返回离线兜底:", e.message);
    return {
      city: key,
      temp: "22",
      feelsLike: "20",
      desc: "晴",
      humidity: "45%",
      wind: "微风 2级",
      tempMin: "18",
      tempMax: "26",
      forecast: [
        { date: "明天", tempMin: "17", tempMax: "26", desc: "晴" },
        { date: "后天", tempMin: "18", tempMax: "27", desc: "多云" }
      ]
    };
  }
}

// 查询已安装的飞牛原生应用列表
function getInstalledNativeApps() {
  const apps = new Set();
  try {
    const output = execSync(`${APPCENTER_CLI} list 2>/dev/null`, { encoding: "utf8", timeout: 4000 });
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/│\s*([a-zA-Z0-9_.-]+)\s*│/);
      if (match && match[1]) {
        apps.add(match[1].trim());
      }
    }
  } catch (e) {
    console.warn("[Fndesk Lite] 获取原生应用列表失败:", e.message);
  }
  return apps;
}

// 获取 Docker 容器列表及其端口
function getDockerContainers() {
  try {
    const output = execSync("docker ps --format '{\"name\":\"{{.Names}}\",\"image\":\"{{.Image}}\",\"ports\":\"{{.Ports}}\",\"status\":\"{{.Status}}\"}' 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000
    });
    
    const lines = output.split("\n").map(l => l.trim()).filter(Boolean);
    const containers = [];
    const lanIp = getLanIp();
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        let hostPort = "";
        const portMatches = item.ports.match(/(?:0\.0\.0\.0|:::|\[::\]):(\d+)->/g);
        if (portMatches && portMatches.length > 0) {
          const match = portMatches[0].match(/:(\d+)->/);
          if (match) hostPort = match[1];
        } else {
          const rawMatch = item.ports.match(/(\d+)\/tcp/);
          if (rawMatch) hostPort = rawMatch[1];
        }

        const preset = matchPresetIcon({ name: item.name, image: item.image, port: hostPort });

        containers.push({
          name: item.name,
          image: item.image,
          hostPort: hostPort,
          portsText: item.ports,
          status: item.status,
          lanUrl: hostPort ? `http://${lanIp}:${hostPort}` : "",
          matchedBrand: preset ? preset.brand : "",
          presetDataUrl: preset ? preset.dataUrl : ""
        });
      } catch (_) {}
    }
    return containers;
  } catch (e) {
    console.warn("[Fndesk Lite] 获取 Docker 容器失败:", e.message);
    return [];
  }
}

// 验证图片 buffer 是否合法且非 HTML 回退页面
function isValidImageBuffer(buf, contentType = "") {
  if (!buf || buf.length < 10) return false;
  const prefix = buf.slice(0, 200).toString("utf8").trim().toLowerCase();
  if (prefix.startsWith("<!doctype") || prefix.startsWith("<html") || prefix.includes("<head") || prefix.includes("<body") || prefix.includes("window.__") || prefix.includes("<script")) {
    return false;
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00) return "image/x-icon";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (prefix.startsWith("<svg") || (prefix.startsWith("<?xml") && prefix.includes("<svg")) || prefix.includes("<svg xmlns=")) return "image/svg+xml";
  if (contentType.startsWith("image/") && !prefix.includes("<")) return contentType.split(";")[0].trim();
  return false;
}

// HTTP GET 工具
function httpGet(getUrl, isBinary = false, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error("重定向过多"));
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(getUrl);
      const client = u.protocol === "https:" ? https : http;
      const req = client.get(getUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": isBinary ? "image/*,*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8"
        },
        timeout: 4000,
        rejectUnauthorized: false
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, getUrl).href;
          res.resume();
          return resolve(httpGet(nextUrl, isBinary, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          resolve({
            contentType: res.headers["content-type"] || "",
            buffer: Buffer.concat(chunks)
          });
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("请求超时")); });
    } catch (e) {
      reject(e);
    }
  });
}

// 自动探测并下载网站 Favicon / Logo
async function fetchFaviconFromUrl(targetUrl, meta = {}) {
  const lanIp = getLanIp();
  const hosts = [];
  let cleanInput = String(targetUrl || "").trim().replace(/^:+/, "");
  
  // 1. 如果输入纯数字（如 3000 或 :3000）
  if (/^\d+$/.test(cleanInput)) {
    const port = cleanInput;
    hosts.push(`http://127.0.0.1:${port}`);
    hosts.push(`http://${lanIp}:${port}`);
    hosts.push(`https://127.0.0.1:${port}`);
    hosts.push(`https://${lanIp}:${port}`);
  } else {
    // 2. 检查是否是 docker 容器名
    const containers = getDockerContainers();
    const matchedCont = containers.find(c => c.name.toLowerCase() === cleanInput.toLowerCase());
    if (matchedCont && matchedCont.hostPort) {
      hosts.push(`http://127.0.0.1:${matchedCont.hostPort}`);
      hosts.push(`http://${lanIp}:${matchedCont.hostPort}`);
    }

    let finalUrl = cleanInput;
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = `http://${finalUrl}`;
    hosts.push(finalUrl);

    try {
      const u = new URL(finalUrl);
      if (u.hostname === "127.0.0.1" && lanIp) {
        hosts.push(`${u.protocol}//${lanIp}${u.port ? ":" + u.port : ""}${u.pathname}`);
      }
    } catch (_) {}
  }

  for (const host of hosts) {
    try {
      const parsed = new URL(host);
      const baseUrl = `${parsed.protocol}//${parsed.host}`;
      const candidates = [];

      try {
        const page = await httpGet(host, false);
        const html = page.buffer.toString("utf8");
        
        const iconMatches = html.match(/<link[^>]+(?:icon|apple-touch-icon|shortcut)[^>]*>/gi) || [];
        for (const tag of iconMatches) {
          const hrefMatch = tag.match(/href=["']?([^"\s>]+)["']?/i);
          if (hrefMatch && hrefMatch[1]) {
            candidates.push(new URL(hrefMatch[1], host).href);
          }
        }

        const imgMatches = html.match(/<img[^>]+src=["']?([^"\s>]+)["']?[^>]*>/gi) || [];
        for (const imgTag of imgMatches) {
          if (/logo|icon|brand/i.test(imgTag)) {
            const srcMatch = imgTag.match(/src=["']?([^"\s>]+)["']?/i);
            if (srcMatch && srcMatch[1]) {
              candidates.push(new URL(srcMatch[1], host).href);
            }
          }
        }
      } catch (_) {}

      candidates.push(`${baseUrl}/logo.svg`);
      candidates.push(`${baseUrl}/logo.png`);
      candidates.push(`${baseUrl}/favicon.svg`);
      candidates.push(`${baseUrl}/favicon.png`);
      candidates.push(`${baseUrl}/favicon.ico`);
      candidates.push(`${baseUrl}/apple-touch-icon.png`);
      candidates.push(`${baseUrl}/apple-touch-icon-precomposed.png`);
      candidates.push(`${baseUrl}/assets/logo.svg`);
      candidates.push(`${baseUrl}/assets/logo.png`);
      candidates.push(`${baseUrl}/assets/favicon.ico`);
      candidates.push(`${baseUrl}/static/favicon.ico`);
      candidates.push(`${baseUrl}/static/logo.svg`);
      candidates.push(`${baseUrl}/static/logo.png`);
      candidates.push(`${baseUrl}/static/img/logo.png`);

      for (const cUrl of candidates) {
        try {
          const res = await httpGet(cUrl, true);
          const mime = isValidImageBuffer(res.buffer, res.contentType);
          if (mime) {
            return `data:${mime};base64,${res.buffer.toString("base64")}`;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  const preset = matchPresetIcon({ ...meta, url: targetUrl });
  if (preset) {
    return preset.dataUrl;
  }

  throw new Error("未能探测到有效图标，可点击上传本地图片或稍后重试");
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 飞牛原生应用生成引擎
async function generateNativeApp(iconData, iconPngBase64) {
  const id = iconData.id || Date.now();
  const appname = `fndesk_${id}`;
  const appBuildDir = path.join(DATA_DIR, "native_builds", appname);

  if (fs.existsSync(appBuildDir)) {
    fs.rmSync(appBuildDir, { recursive: true, force: true });
  }
  copyDirSync(TEMPLATE_DIR, appBuildDir);

  const manifestPath = path.join(appBuildDir, "manifest");
  const configPath = path.join(appBuildDir, "app", "ui", "config");

  let lan = iconData.fndata_Lan || "";
  let wan = iconData.fndata_Wan || "";
  let title = iconData.fndata_Title || `应用_${id}`;
  let protocol = iconData.fndata_Protocol || 0;
  let openInPage = iconData.OpenInPage || 0;

  const manifestContent = `appname          = ${appname}
display_name     = \`Fndesk_${title}\`
desc             = \`由 Fndesk Lite 图标工坊生成的飞牛原生应用快捷入口\`
source           = thirdparty
maintainer       = Danborad
maintainer_url   = https://github.com/Danborad/Fndesk
distributor      = Danborad
distributor_url  = https://github.com/Danborad/Fndesk
desktop_uidir    = ui
platform         = all
desktop_applaunchname = ${appname}.Application
version          = 1.0.0
changelog        = \`• 由 Fndesk Lite 自动生成\`
`;
  fs.writeFileSync(manifestPath, manifestContent, "utf8");

  const uiConfig = {
    ".url": {
      [`${appname}.Application`]: {
        title: title,
        icon: "images/icon_{0}.png",
        type: openInPage === 1 ? "iframe" : "url",
        url: "/cgi/ThirdParty/" + appname + "/index.cgi/",
        allUsers: false,
        control: { accessPerm: "editable" }
      }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(uiConfig, null, 2), "utf8");

  const cgiPath = path.join(appBuildDir, "app", "ui", "index.cgi");
  const cgiContent = `#!/bin/bash
# Auto generated CGI redirect by Fndesk Lite
TARGET_LAN="${lan}"
TARGET_WAN="${wan}"
PROTOCOL="${protocol}"
OPEN_IN_PAGE="${openInPage}"

HOST_IP=\$(echo "\${HTTP_HOST}" | cut -d: -f1)
CLIENT_IP="\${REMOTE_ADDR:-}"

FINAL_URL="\${TARGET_LAN}"
if [[ "\${FINAL_URL}" =~ ^[0-9]+$ ]]; then
  SCHEME="http"
  if [[ "\${PROTOCOL}" == "2" ]]; then SCHEME="https"; fi
  FINAL_URL="\${SCHEME}://\${HOST_IP}:\${TARGET_LAN}"
fi

echo -e "Status: 302 Found\r\nLocation: \${FINAL_URL}\r\n\r\n"
exit 0
`;
  fs.writeFileSync(cgiPath, cgiContent, { encoding: "utf8", mode: 0o755 });

  if (iconPngBase64 && iconPngBase64.startsWith("data:image")) {
    const base64Data = iconPngBase64.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(path.join(appBuildDir, "ICON.PNG"), imgBuffer);
    fs.writeFileSync(path.join(appBuildDir, "ICON_256.PNG"), imgBuffer);
    const uiImgDir = path.join(appBuildDir, "app", "ui", "images");
    fs.mkdirSync(uiImgDir, { recursive: true });
    fs.writeFileSync(path.join(uiImgDir, "icon_256.png"), imgBuffer);
    fs.writeFileSync(path.join(uiImgDir, "icon_64.png"), imgBuffer);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(APPCENTER_CLI, ["install-local"], {
      cwd: appBuildDir,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", code => {
      if (code === 0) {
        resolve({ success: true, appname });
      } else {
        reject(new Error(`appcenter-cli 失败 (code ${code}): ${stderr || stdout}`));
      }
    });
  });
}

// 卸载原生应用
async function uninstallNativeApp(appname) {
  return new Promise((resolve, reject) => {
    const proc = spawn(APPCENTER_CLI, ["uninstall", appname], { env: process.env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", code => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject(new Error(`卸载原生应用失败 (code ${code}): ${stderr || stdout}`));
      }
    });
  });
}

// HTTP 响应助手
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-auth-token"
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(text);
}

// 解析 JSON Body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

// 静态文件 MIME
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp"
};

// 静态文件服务器
function serveStatic(req, res, pathname) {
  let relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  
  // 支持桌面注入脚本别名
  if (relativePath === "desktop-inject.js" || relativePath === "static/fndesk-desktop.js") {
    const desktopJsPath = path.join(__dirname, "static", "fndesk-desktop.js");
    if (fs.existsSync(desktopJsPath)) {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      return fs.createReadStream(desktopJsPath).pipe(res);
    }
  }

  if (relativePath.startsWith("deskdata/img/")) {
    const imgName = relativePath.replace("deskdata/img/", "");
    const fullPath = path.join(IMG_DIR, imgName);
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      return fs.createReadStream(fullPath).pipe(res);
    }
  }

  const staticBase = __dirname;
  const targetPath = path.join(staticBase, relativePath);

  if (!targetPath.startsWith(staticBase)) {
    return sendText(res, 403, "Forbidden");
  }

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    const ext = path.extname(targetPath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    return fs.createReadStream(targetPath).pipe(res);
  }

  const indexFallback = path.join(staticBase, "index.html");
  if (fs.existsSync(indexFallback)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(indexFallback).pipe(res);
  }

  return sendText(res, 404, "404 Not Found");
}

// 主请求调度
async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-auth-token"
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = parsedUrl.pathname;

  // 1. 系统就绪状态
  if (pathname === "/api/status" && req.method === "GET") {
    const hasPw = hasPassword();
    return sendJson(res, 200, {
      success: true,
      ready: true,
      version: "2.0.0",
      hasPassword: hasPw,
      appName: "fndesk",
      nodeVersion: process.version,
      lanIp: getLanIp()
    });
  }

  // 2. 飞牛桌面注入与还原防搞坏机制
  if (pathname === "/api/desktop-status" && req.method === "GET") {
    return sendJson(res, 200, {
      success: true,
      ...getDesktopStatus()
    });
  }

  if (pathname === "/api/apply-desktop" && req.method === "POST") {
    try {
      applyDesktop();
      return sendJson(res, 200, {
        success: true,
        message: "飞牛桌面小组件与快捷方式已立即生效！请刷新飞牛桌面查看效果。"
      });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: "立即生效失败: " + e.message });
    }
  }

  if (pathname === "/api/restore-desktop" && req.method === "POST") {
    try {
      restoreDesktop();
      return sendJson(res, 200, {
        success: true,
        message: "飞牛桌面已彻底安全还原至官方纯净状态！"
      });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: "还原桌面失败: " + e.message });
    }
  }

  // 3. WeTab 卡片小组件 CRUD
  if (pathname === "/api/widgets" && req.method === "GET") {
    const widgets = readWidgets();
    return sendJson(res, 200, { success: true, widgets });
  }

  if (pathname === "/api/widgets" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const widgets = readWidgets();
    let targetId = body.id ? parseInt(body.id, 10) : null;
    if (!targetId) {
      targetId = widgets.length > 0 ? Math.max(...widgets.map(w => parseInt(w.id || 0, 10))) + 1 : 1;
    }

    const itemData = {
      id: targetId,
      type: body.type || "weather",
      size: body.size || "medium",
      title: (body.title || "").trim(),
      targetDate: body.targetDate || "",
      city: (body.city || "").trim(),
      theme: body.theme || "glass",
      style: body.style || "digital",
      content: body.content || "",
      sort: parseInt(body.sort || targetId * 10, 10)
    };

    const existingIdx = widgets.findIndex(w => parseInt(w.id, 10) === targetId);
    if (existingIdx !== -1) {
      widgets[existingIdx] = { ...widgets[existingIdx], ...itemData };
    } else {
      widgets.push(itemData);
    }
    writeWidgets(widgets);

    return sendJson(res, 200, { success: true, message: "卡片小组件已保存", widget: itemData });
  }

  if (pathname.startsWith("/api/widgets/") && req.method === "DELETE") {
    const id = parseInt(pathname.replace("/api/widgets/", ""), 10);
    const widgets = readWidgets();
    const filtered = widgets.filter(w => parseInt(w.id, 10) !== id);
    writeWidgets(filtered);
    return sendJson(res, 200, { success: true, message: "小组件已删除" });
  }

  // 4. 实时天气接口
  if (pathname === "/api/weather" && req.method === "GET") {
    const city = parsedUrl.searchParams.get("city") || "北京";
    const data = await getWeather(city);
    return sendJson(res, 200, { success: true, weather: data });
  }

  // 5. 登录认证
  if (pathname === "/api/login" && req.method === "POST") {
    const body = await parseJsonBody(req);
    if (!hasPassword()) {
      if (body.password) setPassword(body.password);
      return sendJson(res, 200, { success: true, message: "初始密码设置成功", token: "fndesk_init_token" });
    }
    if (verifyPassword(body.password)) {
      const token = crypto.randomBytes(16).toString("hex");
      return sendJson(res, 200, { success: true, message: "登录成功", token });
    }
    return sendJson(res, 401, { success: false, message: "管理密码错误" });
  }

  // 6. 修改管理密码
  if (pathname === "/api/change-password" && req.method === "POST") {
    const body = await parseJsonBody(req);
    if (hasPassword() && !verifyPassword(body.oldPassword)) {
      return sendJson(res, 400, { success: false, message: "原密码不正确" });
    }
    if (!body.newPassword || body.newPassword.length < 1) {
      return sendJson(res, 400, { success: false, message: "新密码不能为空" });
    }
    setPassword(body.newPassword);
    return sendJson(res, 200, { success: true, message: "管理密码已更新" });
  }

  // 7. 获取图标列表
  if (pathname === "/api/icons" && req.method === "GET") {
    const icons = readIcons();
    const installedApps = getInstalledNativeApps();
    const result = icons.map(item => {
      const appname = item.appname || `fndesk_${item.id}`;
      return {
        ...item,
        appname,
        nativeInstalled: installedApps.has(appname)
      };
    });
    return sendJson(res, 200, { success: true, icons: result });
  }

  // 保存或新增图标
  if (pathname === "/api/icons" && req.method === "POST") {
    const body = await parseJsonBody(req);
    if (!body.fndata_Title) {
      return sendJson(res, 400, { success: false, message: "缺少应用标题" });
    }

    const icons = readIcons();
    let targetId = body.id ? parseInt(body.id, 10) : null;
    if (!targetId) {
      targetId = icons.length > 0 ? Math.max(...icons.map(i => parseInt(i.id || 0, 10))) + 1 : 1;
    }

    let lanPic = body.fndata_LanPic || "";
    if (body.iconDataUrl && body.iconDataUrl.startsWith("data:image")) {
      const ext = body.iconDataUrl.includes("image/svg") ? "svg" : "png";
      const fileName = `${targetId}.${ext}`;
      const savePath = path.join(IMG_DIR, fileName);
      const base64Data = body.iconDataUrl.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(savePath, Buffer.from(base64Data, "base64"));
      lanPic = `/deskdata/img/${fileName}`;
    }

    const itemData = {
      id: targetId,
      fndata_Title: body.fndata_Title.trim(),
      fndata_Lan: String(body.fndata_Lan || "").trim(),
      fndata_Wan: String(body.fndata_Wan || "").trim(),
      fndata_LanPic: lanPic,
      fndata_WanPic: String(body.fndata_WanPic || "").trim(),
      fndata_Protocol: parseInt(body.fndata_Protocol || 0, 10),
      fndata_Sort: parseInt(body.fndata_Sort || (targetId * 10), 10),
      OpenInPage: parseInt(body.OpenInPage || 0, 10),
      enable: body.enable !== undefined ? parseInt(body.enable, 10) : 1,
      fnAppicon: parseInt(body.fnAppicon || 0, 10),
      appname: body.appname || `fndesk_${targetId}`
    };

    const existingIdx = icons.findIndex(i => parseInt(i.id, 10) === targetId);
    if (existingIdx !== -1) {
      icons[existingIdx] = { ...icons[existingIdx], ...itemData };
    } else {
      icons.push(itemData);
    }
    writeIcons(icons);

    if (body.generateNative && body.iconDataUrl) {
      try {
        await generateNativeApp(itemData, body.iconDataUrl);
      } catch (e) {
        console.warn("[Fndesk Lite] 同步生成原生应用失败:", e.message);
      }
    }

    return sendJson(res, 200, { success: true, message: "图标保存成功", item: itemData });
  }

  // 删除图标
  if (pathname.startsWith("/api/icons/") && req.method === "DELETE") {
    const id = parseInt(pathname.replace("/api/icons/", ""), 10);
    const icons = readIcons();
    const target = icons.find(i => parseInt(i.id, 10) === id);
    if (target && target.appname) {
      try {
        await uninstallNativeApp(target.appname);
      } catch (_) {}
    }
    const filtered = icons.filter(i => parseInt(i.id, 10) !== id);
    writeIcons(filtered);
    return sendJson(res, 200, { success: true, message: "图标已删除" });
  }

  // 8. 获取运行中的 Docker 容器
  if (pathname === "/api/docker/containers" && req.method === "GET") {
    const containers = getDockerContainers();
    return sendJson(res, 200, { success: true, containers });
  }

  // 9. 抓取网站 Favicon
  if (pathname === "/api/fetch-favicon" && req.method === "POST") {
    const body = await parseJsonBody(req);
    if (!body.url) return sendJson(res, 400, { success: false, message: "缺少 url 或端口参数" });
    try {
      const dataUrl = await fetchFaviconFromUrl(body.url, body);
      return sendJson(res, 200, { success: true, dataUrl });
    } catch (e) {
      return sendJson(res, 400, { success: false, message: e.message });
    }
  }

  // 10. 获取内置品牌预设图标库
  if (pathname === "/api/presets" && req.method === "GET") {
    const list = Object.entries(PRESET_ICONS).map(([key, item]) => ({
      key,
      name: item.name,
      color: item.color,
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(item.svg).toString("base64")}`
    }));
    return sendJson(res, 200, { success: true, presets: list });
  }

  // 11. 上传自定义图标图片
  if (pathname === "/api/upload-icon" && req.method === "POST") {
    const body = await parseJsonBody(req);
    if (!body.dataUrl) return sendJson(res, 400, { success: false, message: "缺少 dataUrl" });

    const id = body.id || Date.now();
    const ext = body.dataUrl.includes("image/svg") ? "svg" : "png";
    const fileName = `${id}.${ext}`;
    const savePath = path.join(IMG_DIR, fileName);
    const base64Data = body.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(savePath, Buffer.from(base64Data, "base64"));

    return sendJson(res, 200, { success: true, path: `/deskdata/img/${fileName}` });
  }

  // 12. 生成原生应用 (Native App)
  if (pathname === "/api/generate-native" && req.method === "POST") {
    const body = await parseJsonBody(req);
    try {
      const result = await generateNativeApp(body, body.iconDataUrl);
      return sendJson(res, 200, { success: true, message: "飞牛原生应用生成成功！已加入应用中心与桌面", appname: result.appname });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: `生成原生应用失败: ${e.message}` });
    }
  }

  // 13. 卸载原生应用
  if (pathname === "/api/uninstall-native" && req.method === "POST") {
    const body = await parseJsonBody(req);
    try {
      await uninstallNativeApp(body.appname);
      return sendJson(res, 200, { success: true, message: "原生应用已成功卸载" });
    } catch (e) {
      return sendJson(res, 500, { success: false, message: `卸载失败: ${e.message}` });
    }
  }

  // 静态页面及资源服务
  return serveStatic(req, res, pathname);
}

// 启动服务器
const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[Fndesk Lite] 处理请求发生未捕获异常:", err);
    sendJson(res, 500, { success: false, message: "服务器内部异常: " + err.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Fndesk Lite] HTTP 服务已在 0.0.0.0:${PORT} 启动就绪`);
});

// 支持 Unix Domain Socket
try {
  if (fs.existsSync(DOMAIN_SOCKET_PATH)) {
    fs.unlinkSync(DOMAIN_SOCKET_PATH);
  }
  const sockDir = path.dirname(DOMAIN_SOCKET_PATH);
  if (fs.existsSync(sockDir)) {
    const sockServer = http.createServer(server);
    sockServer.listen(DOMAIN_SOCKET_PATH, () => {
      try { fs.chmodSync(DOMAIN_SOCKET_PATH, 0o777); } catch (_) {}
      console.log(`[Fndesk Lite] Socket 监听就绪: ${DOMAIN_SOCKET_PATH}`);
    });
  }
} catch (e) {
  console.warn("[Fndesk Lite] 创建 Socket 失败:", e.message);
}

process.on("SIGTERM", () => {
  console.log("[Fndesk Lite] 收到 SIGTERM，准备平滑退出...");
  server.close(() => process.exit(0));
});

module.exports = server;
