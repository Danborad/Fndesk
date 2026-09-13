const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { execSync, exec } = require('child_process');

// ==================== 1. 基础配置与路径检测 ====================
const PORT = parseInt(process.env.FNDESK_PORT || process.env.wizard_app_port || '9990', 10);
const APPNAME = process.env.TRIM_APPNAME || 'fndesk';
const APPDEST = process.env.TRIM_APPDEST || path.resolve(__dirname, '..');

// 探测最佳存储路径
function resolveDataDir() {
  const candidates = [
    process.env.TRIM_APPDEST_VOL ? path.join(process.env.TRIM_APPDEST_VOL, '@appshare', APPNAME, 'deskdata') : null,
    '/vol1/@appshare/fndesk/deskdata',
    '/var/apps/fndesk/shares/fndesk/deskdata',
    path.join(__dirname, 'deskdata')
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch (_) {}
  }
  
  // 默认创建并使用第一个有效目录
  const chosen = candidates[0] || path.join(__dirname, 'deskdata');
  try {
    fs.mkdirSync(chosen, { recursive: true });
  } catch (_) {}
  return chosen;
}

const DATA_DIR = resolveDataDir();
const IMG_DIR = path.join(DATA_DIR, 'img');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PW_FILE = path.join(DATA_DIR, 'pw.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
} catch (e) {
  console.error('[Fndesk Lite] 初始化目录异常:', e.message);
}

// 确保 data.json 存在
if (!fs.existsSync(DATA_FILE)) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
  } catch (e) {
    console.error('[Fndesk Lite] 初始化 data.json 异常:', e.message);
  }
}

// Session 鉴权缓存
const validSessions = new Map(); // token -> timestamp
const TOKEN_EXPIRY_MS = 30 * 24 * 3600 * 1000; // 30天有效

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

function hasPasswordSet() {
  if (!fs.existsSync(PW_FILE)) return false;
  try {
    const content = fs.readFileSync(PW_FILE, 'utf8').trim();
    if (!content) return false;
    const parsed = JSON.parse(content);
    if (parsed.passwordHash) return true;
    if (parsed.password && (parsed.password.startsWith('$2a$') || parsed.password.startsWith('$2b$'))) {
      return false;
    }
    return Boolean(parsed.pw || parsed.password);
  } catch (_) {
    return false;
  }
}

function setStoredPassword(plainPassword) {
  const hash = sha256(plainPassword);
  fs.writeFileSync(PW_FILE, JSON.stringify({ passwordHash: hash, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  try { fs.chmodSync(PW_FILE, 0o600); } catch (_) {}
}

function isAuthenticated(req) {
  if (!hasPasswordSet()) return true; // 未设置密码时免密访问

  const authHeader = req.headers['authorization'] || '';
  const xToken = req.headers['x-auth-token'];
  let token = xToken || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/fndesk_token=([a-zA-Z0-9_-]+)/);
    if (match) token = match[1];
  }

  if (!token) return false;
  const loginTime = validSessions.get(token);
  if (!loginTime) return false;
  if (Date.now() - loginTime > TOKEN_EXPIRY_MS) {
    validSessions.delete(token);
    return false;
  }
  return true;
}

// ==================== 2. 数据与原生应用操作 ====================
function readIcons() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const content = fs.readFileSync(DATA_FILE, 'utf8').trim();
    return content ? JSON.parse(content) : [];
  } catch (e) {
    console.error('[Fndesk Lite] 读取 data.json 失败:', e.message);
    return [];
  }
}

function writeIcons(icons) {
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(icons, null, 2), 'utf8');
  fs.renameSync(tmpFile, DATA_FILE);
  try { fs.chmodSync(DATA_FILE, 0o644); } catch (_) {}
}

// 获取系统已安装的 fndesk 原生应用
function getInstalledNativeApps() {
  const apps = {};
  try {
    const output = execSync('appcenter-cli list 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n');
    for (const line of lines) {
      if (!line.includes('│')) continue;
      const cols = line.split('│').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 4 && cols[0] !== 'APP NAME') {
        const appname = cols[0];
        if (appname.startsWith('fndesk_')) {
          apps[appname] = {
            displayName: cols[1],
            version: cols[2],
            status: cols[3]
          };
        }
      }
    }
  } catch (e) {
    console.warn('[Fndesk Lite] 获取已安装原生应用列表失败:', e.message);
  }
  return apps;
}

// 获取 Docker 容器列表及其端口
function getDockerContainers() {
  try {
    const output = execSync('docker ps --format \'{"name":"{{.Names}}","image":"{{.Image}}","ports":"{{.Ports}}","status":"{{.Status}}"}\' 2>/dev/null', {
      encoding: 'utf8',
      timeout: 5000
    });
    
    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
    const containers = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        // 解析主机映射端口：如 0.0.0.0:3500->3500/tcp 或 [::]:3500->3500/tcp
        let hostPort = '';
        const portMatches = item.ports.match(/(?:0\.0\.0\.0|:::|\[::\]):(\d+)->/g);
        if (portMatches && portMatches.length > 0) {
          const match = portMatches[0].match(/:(\d+)->/);
          if (match) hostPort = match[1];
        } else {
          // 纯内部暴露端口
          const rawMatch = item.ports.match(/(\d+)\/tcp/);
          if (rawMatch) hostPort = rawMatch[1];
        }

        containers.push({
          name: item.name,
          image: item.image,
          hostPort: hostPort,
          portsText: item.ports,
          status: item.status
        });
      } catch (_) {}
    }
    return containers;
  } catch (e) {
    console.warn('[Fndesk Lite] 获取 Docker 容器失败:', e.message);
    return [];
  }
}

// 自动探测并下载网站 Favicon
async function fetchFaviconFromUrl(targetUrl) {
  let finalUrl = targetUrl.trim();
  if (/^\d+$/.test(finalUrl)) {
    finalUrl = `http://127.0.0.1:${finalUrl}`;
  } else if (!/^https?:\/\//i.test(finalUrl)) {
    finalUrl = `http://${finalUrl}`;
  }

  const parsed = new URL(finalUrl);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;

  function httpGet(getUrl, isBinary = false, redirects = 0) {
    if (redirects > 4) return Promise.reject(new Error('重定向过多'));
    return new Promise((resolve, reject) => {
      const u = new URL(getUrl);
      const client = u.protocol === 'https:' ? https : http;
      const req = client.get(getUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': isBinary ? 'image/*,*/*' : 'text/html,application/xhtml+xml,*/*'
        },
        timeout: 4000
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
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            contentType: res.headers['content-type'] || '',
            buffer: buffer
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    });
  }

  // 1. 尝试获取主页 HTML 解析 <link rel="icon">
  let candidateIconUrls = [];
  try {
    const page = await httpGet(finalUrl, false);
    const html = page.buffer.toString('utf8');
    
    // 提取 apple-touch-icon（通常清晰度最高）
    const appleMatch = html.match(/<link[^>]*rel=["'](?:apple-touch-icon(?:-precomposed)?|shortcut icon|icon)["'][^>]*href=["']([^"']+)["']/i);
    if (appleMatch && appleMatch[1]) {
      candidateIconUrls.push(new URL(appleMatch[1], finalUrl).href);
    }

    // 匹配其他 icon 标签
    const regex = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (m[1]) candidateIconUrls.push(new URL(m[1], finalUrl).href);
    }
  } catch (_) {}

  // 兜底追加 /favicon.ico
  candidateIconUrls.push(`${baseUrl}/favicon.ico`);
  candidateIconUrls.push(`${baseUrl}/favicon.png`);

  // 依次尝试下载候选图标
  for (const iconUrl of candidateIconUrls) {
    try {
      const res = await httpGet(iconUrl, true);
      if (res.buffer && res.buffer.length > 50) {
        let mime = res.contentType.split(';')[0].trim();
        if (!mime || mime.includes('text') || mime === 'application/octet-stream') {
          if (iconUrl.endsWith('.png')) mime = 'image/png';
          else if (iconUrl.endsWith('.svg')) mime = 'image/svg+xml';
          else if (iconUrl.endsWith('.ico')) mime = 'image/x-icon';
          else mime = 'image/png';
        }
        return `data:${mime};base64,${res.buffer.toString('base64')}`;
      }
    } catch (_) {}
  }

  throw new Error('未能从目标网址抓取到有效图标');
}

// 递归复制目录
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
      try {
        const stat = fs.statSync(srcPath);
        fs.chmodSync(destPath, stat.mode);
      } catch (_) {}
    }
  }
}

// 生成飞牛原生应用 (Native App)
async function generateNativeApp(item, iconDataUrl) {
  const id = item.id || Date.now();
  const appname = `fndesk_${id}`;
  const title = item.fndata_Title || `应用_${id}`;
  const targetPort = /^\d+$/.test(item.fndata_Lan) ? item.fndata_Lan : '';
  const openInPage = parseInt(item.OpenInPage || 0, 10) === 1;
  const appType = openInPage ? 'iframe' : 'url';
  const protocol = item.fndata_Protocol === 2 ? 'https' : 'http';

  // 计算 URL 格式
  let targetUrl = '/';
  if (targetPort) {
    targetUrl = '/';
  } else if (item.fndata_Lan) {
    targetUrl = item.fndata_Lan;
  }

  const stagingDir = path.join('/tmp', `fndesk_build_${appname}_${Date.now()}`);
  const templateDir = path.join(__dirname, 'fndesk_app');

  try {
    // 1. 复制模板
    copyDirSync(templateDir, stagingDir);

    // 2. 写入 manifest
    const manifestContent = `appname               = ${appname}
version               = 1.0.0
display_name          = Fndesk_${title}
desc                  = ✨ 由 Fndesk Lite 飞牛图标工坊生成的原生 APP 桌面快捷方式。<br>可直接在飞牛应用中心或桌面右键安全卸载。
platform              = all
source                = thirdparty
maintainer            = Danborad
maintainer_url        = https://github.com/Danborad/Fndesk
distributor           = Danborad
distributor_url       = https://github.com/Danborad/Fndesk
desktop_uidir         = ui
desktop_applaunchname = ${appname}.Application
`;
    fs.writeFileSync(path.join(stagingDir, 'manifest'), manifestContent, 'utf8');

    // 3. 写入 config
    const uiDir = path.join(stagingDir, 'app', 'ui');
    const imagesDir = path.join(uiDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const uiConfig = {
      ".url": {
        [`${appname}.Application`]: {
          title: title,
          icon: "images/icon_{0}.png",
          type: appType,
          protocol: protocol,
          ...(targetPort ? { port: targetPort } : {}),
          url: targetUrl,
          allUsers: false,
          control: {
            accessPerm: "editable",
            portPerm: "editable",
            pathPerm: "editable"
          }
        }
      }
    };
    fs.writeFileSync(path.join(uiDir, 'config'), JSON.stringify(uiConfig, null, 2), 'utf8');

    // 4. 处理并保存图标
    let iconBuffer = null;
    if (iconDataUrl && iconDataUrl.startsWith('data:image')) {
      const base64Data = iconDataUrl.replace(/^data:image\/\w+;base64,/, '');
      iconBuffer = Buffer.from(base64Data, 'base64');
    } else if (item.fndata_LanPic) {
      const localPicPath = path.join(DATA_DIR, item.fndata_LanPic.replace(/^\/deskdata\//, ''));
      if (fs.existsSync(localPicPath)) {
        iconBuffer = fs.readFileSync(localPicPath);
      }
    }

    if (!iconBuffer) {
      // 使用默认图标
      const defaultIcon = path.join(__dirname, 'static', 'icon.png');
      if (fs.existsSync(defaultIcon)) {
        iconBuffer = fs.readFileSync(defaultIcon);
      } else {
        iconBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      }
    }

    // 保存图标到各个规范路径
    fs.writeFileSync(path.join(stagingDir, 'ICON.PNG'), iconBuffer);
    fs.writeFileSync(path.join(stagingDir, 'ICON_256.PNG'), iconBuffer);
    fs.writeFileSync(path.join(imagesDir, 'icon_64.png'), iconBuffer);
    fs.writeFileSync(path.join(imagesDir, 'icon_256.png'), iconBuffer);

    // 确保 cmd 脚本可执行
    const cmdDir = path.join(stagingDir, 'cmd');
    if (fs.existsSync(cmdDir)) {
      for (const f of fs.readdirSync(cmdDir)) {
        try { fs.chmodSync(path.join(cmdDir, f), 0o755); } catch (_) {}
      }
    }

    // 5. 执行 appcenter-cli install-local
    await new Promise((resolve, reject) => {
      exec('appcenter-cli install-local', { cwd: stagingDir, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('[Fndesk Lite] install-local 失败:', stderr || err.message);
          return reject(new Error(stderr || err.message));
        }
        resolve(stdout);
      });
    });

    // 6. 更新 data.json 中的状态
    const icons = readIcons();
    const idx = icons.findIndex(i => String(i.id) === String(id));
    if (idx !== -1) {
      icons[idx].fnAppicon = 1;
      icons[idx].appname = appname;
      writeIcons(icons);
    }

    return { success: true, appname };
  } finally {
    // 清理构建临时目录
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

// 卸载飞牛原生应用
async function uninstallNativeApp(appname) {
  if (!appname) throw new Error('缺少 appname 参数');
  return new Promise((resolve, reject) => {
    exec(`appcenter-cli uninstall "${appname}"`, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[Fndesk Lite] uninstall 失败:', stderr || err.message);
        return reject(new Error(stderr || err.message));
      }

      // 更新 data.json
      const icons = readIcons();
      for (const item of icons) {
        if (item.appname === appname) {
          item.fnAppicon = 0;
        }
      }
      writeIcons(icons);

      resolve({ success: true, stdout });
    });
  });
}

// ==================== 3. 请求路由分发 ====================
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-auth-token'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (body.length > 15 * 1024 * 1024) { // 15MB 限制（支持高分辨率图）
        req.destroy();
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('非法 JSON 数据'));
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  
  // 映射 /deskdata/* 访问本地数据存储
  if (safePath.startsWith('/deskdata/')) {
    const rel = safePath.replace(/^\/deskdata\//, '');
    const abs = path.join(DATA_DIR, rel);
    if (!abs.startsWith(DATA_DIR) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('文件不存在');
    }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400'
    });
    return fs.createReadStream(abs).pipe(res);
  }

  // 服务前端静态页面
  const absPath = path.join(__dirname, safePath);
  if (!absPath.startsWith(__dirname) || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
    // SPA 回退
    const fallback = path.join(__dirname, 'index.html');
    if (fs.existsSync(fallback)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(fallback).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }

  const ext = path.extname(absPath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(absPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  // 处理跨域预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-auth-token'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // 兼容 index.cgi 路径前缀
  if (pathname.includes('index.cgi/')) {
    pathname = pathname.substring(pathname.indexOf('index.cgi/') + 9);
  }

  try {
    // ---------- 状态与公开接口 ----------
    if (pathname === '/api/status' && req.method === 'GET') {
      const hasPw = hasPasswordSet();
      return sendJson(res, 200, {
        success: true,
        ready: true,
        version: '1.0.0-lite',
        hasPassword: hasPw,
        appName: APPNAME,
        nodeVersion: process.version
      });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const stored = getStoredPasswordHash();
      
      if (!stored) {
        // 未设置密码，创建默认会话
        const token = crypto.randomBytes(24).toString('hex');
        validSessions.set(token, Date.now());
        return sendJson(res, 200, { success: true, token, needSetup: true });
      }

      if (sha256(body.password || '') === stored) {
        const token = crypto.randomBytes(24).toString('hex');
        validSessions.set(token, Date.now());
        return sendJson(res, 200, { success: true, token });
      }

      return sendJson(res, 401, { success: false, message: '密码错误' });
    }

    // 桌面轻量快捷方式注入脚本（Mode B）
    if (pathname === '/desktop-inject.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return res.end(getDesktopInjectScript());
    }

    // ---------- 需鉴权 API ----------
    if (pathname.startsWith('/api/')) {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { success: false, message: '未授权或登录已过期' });
      }

      // 1. 设置/修改密码
      if (pathname === '/api/change-password' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.newPassword) {
          return sendJson(res, 400, { success: false, message: '新密码不能为空' });
        }
        const stored = getStoredPasswordHash();
        if (stored && body.oldPassword && sha256(body.oldPassword) !== stored) {
          return sendJson(res, 400, { success: false, message: '原密码不正确' });
        }
        setStoredPassword(body.newPassword);
        return sendJson(res, 200, { success: true, message: '密码更新成功' });
      }

      // 2. 获取图标列表
      if (pathname === '/api/icons' && req.method === 'GET') {
        const icons = readIcons();
        const nativeApps = getInstalledNativeApps();
        
        const enhancedIcons = icons.map(item => {
          const appname = item.appname || `fndesk_${item.id}`;
          const isInstalled = Boolean(nativeApps[appname]);
          return {
            ...item,
            appname,
            nativeInstalled: isInstalled
          };
        });

        return sendJson(res, 200, { success: true, icons: enhancedIcons });
      }

      // 3. 保存/更新图标
      if (pathname === '/api/icons' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.fndata_Title) {
          return sendJson(res, 400, { success: false, message: '图标名称不能为空' });
        }

        const icons = readIcons();
        let targetId = body.id ? parseInt(body.id, 10) : null;
        let isNew = false;

        if (!targetId) {
          isNew = true;
          targetId = icons.length > 0 ? Math.max(...icons.map(i => parseInt(i.id || 0, 10))) + 1 : 1;
        }

        // 保存 base64 图标数据到 img 目录
        let lanPic = body.fndata_LanPic || '';
        if (body.iconDataUrl && body.iconDataUrl.startsWith('data:image')) {
          const ext = body.iconDataUrl.includes('image/svg') ? 'svg' : 'png';
          const fileName = `${targetId}.${ext}`;
          const savePath = path.join(IMG_DIR, fileName);
          const base64Data = body.iconDataUrl.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(savePath, Buffer.from(base64Data, 'base64'));
          lanPic = `/deskdata/img/${fileName}`;
        }

        const itemData = {
          id: targetId,
          fndata_Title: body.fndata_Title.trim(),
          fndata_Lan: String(body.fndata_Lan || '').trim(),
          fndata_Wan: String(body.fndata_Wan || '').trim(),
          fndata_LanPic: lanPic,
          fndata_WanPic: String(body.fndata_WanPic || '').trim(),
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
        return sendJson(res, 200, { success: true, id: targetId, item: itemData });
      }

      // 4. 删除图标
      if (pathname.startsWith('/api/icons/') && req.method === 'DELETE') {
        const id = parseInt(pathname.split('/').pop(), 10);
        const uninstallNative = parsedUrl.query.uninstall === 'true' || parsedUrl.query.uninstall === '1';

        const icons = readIcons();
        const target = icons.find(i => parseInt(i.id, 10) === id);
        
        if (target && uninstallNative && target.appname) {
          try {
            await uninstallNativeApp(target.appname);
          } catch (e) {
            console.warn('[Fndesk Lite] 级联卸载原生应用告警:', e.message);
          }
        }

        const filtered = icons.filter(i => parseInt(i.id, 10) !== id);
        writeIcons(filtered);
        return sendJson(res, 200, { success: true, message: '图标已删除' });
      }

      // 5. 获取运行中的 Docker 容器
      if (pathname === '/api/docker/containers' && req.method === 'GET') {
        const containers = getDockerContainers();
        return sendJson(res, 200, { success: true, containers });
      }

      // 6. 抓取网站 Favicon
      if (pathname === '/api/fetch-favicon' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.url) return sendJson(res, 400, { success: false, message: '缺少 url 参数' });
        try {
          const dataUrl = await fetchFaviconFromUrl(body.url);
          return sendJson(res, 200, { success: true, dataUrl });
        } catch (e) {
          return sendJson(res, 400, { success: false, message: e.message });
        }
      }

      // 7. 上传自定义图标图片
      if (pathname === '/api/upload-icon' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.dataUrl) return sendJson(res, 400, { success: false, message: '缺少 dataUrl' });

        const id = body.id || Date.now();
        const ext = body.dataUrl.includes('image/svg') ? 'svg' : 'png';
        const fileName = `${id}.${ext}`;
        const savePath = path.join(IMG_DIR, fileName);
        const base64Data = body.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(savePath, Buffer.from(base64Data, 'base64'));

        return sendJson(res, 200, { success: true, path: `/deskdata/img/${fileName}` });
      }

      // 8. 生成原生应用 (Native App)
      if (pathname === '/api/generate-native' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        try {
          const result = await generateNativeApp(body, body.iconDataUrl);
          return sendJson(res, 200, { success: true, message: '飞牛原生应用生成成功！已加入应用中心与桌面', appname: result.appname });
        } catch (e) {
          return sendJson(res, 500, { success: false, message: `生成原生应用失败: ${e.message}` });
        }
      }

      // 9. 卸载原生应用
      if (pathname === '/api/uninstall-native' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        try {
          await uninstallNativeApp(body.appname);
          return sendJson(res, 200, { success: true, message: '原生应用已干净卸载' });
        } catch (e) {
          return sendJson(res, 500, { success: false, message: `卸载失败: ${e.message}` });
        }
      }

      return sendJson(res, 404, { success: false, message: '未知接口' });
    }

    // ---------- 静态文件服务 ----------
    serveStatic(req, res, pathname);

  } catch (err) {
    console.error('[Fndesk Lite] 请求处理未捕获异常:', err);
    sendJson(res, 500, { success: false, message: '服务器内部异常', error: err.message });
  }
});

// 轻量桌面注入脚本（供模式 B 使用）
function getDesktopInjectScript() {
  return `(function() {
  console.log('[Fndesk Lite] 桌面快捷方式注入器加载...');
  async function loadShortcuts() {
    try {
      const res = await fetch('/cgi/ThirdParty/fndesk/index.cgi/api/icons', { credentials: 'omit' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success || !Array.isArray(json.icons)) return;
      
      const enabled = json.icons.filter(i => i.enable !== 0 && !i.nativeInstalled);
      if (enabled.length === 0) return;

      // 寻找桌面网格节点
      const container = document.querySelector('.grid, [data-testid="desktop"], #desktop-container');
      if (!container) return setTimeout(loadShortcuts, 1500);

      enabled.forEach(item => {
        const existing = document.getElementById('fndesk-sc-' + item.id);
        if (existing) return;

        const el = document.createElement('div');
        el.id = 'fndesk-sc-' + item.id;
        el.className = 'fndesk-shortcut-item';
        el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;width:74px;margin:8px;padding:6px;border-radius:10px;transition:background 0.2s;user-select:none;';
        el.innerHTML = '<div style="width:48px;height:48px;border-radius:12px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,0.15);margin-bottom:6px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);backdrop-filter:blur(8px);"><img src="' + (item.fndata_LanPic || '/deskdata/img/1.png') + '" style="width:100%;height:100%;object-fit:cover;"></div><div style="font-size:12px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.8);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">' + item.fndata_Title + '</div>';
        
        el.onclick = function() {
          let target = item.fndata_Lan || '/';
          if (/^\\d+$/.test(target)) {
            target = window.location.protocol + '//' + window.location.hostname + ':' + target;
          }
          window.open(target, '_blank');
        };

        container.appendChild(el);
      });
    } catch (e) {
      console.warn('[Fndesk Lite] 注入快捷方式异常:', e);
    }
  }

  if (document.readyState === 'complete') loadShortcuts();
  else window.addEventListener('load', loadShortcuts);
})();`;
}

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Fndesk Lite] 服务成功启动，监听端口: ${PORT}`);
  console.log(`[Fndesk Lite] 数据目录: ${DATA_DIR}`);
});

// 同时监听 Unix Domain Socket（如果支持）
const SOCK_PATH = '/var/apps/fndesk/target/fndesk.sock';
try {
  if (fs.existsSync(path.dirname(SOCK_PATH))) {
    if (fs.existsSync(SOCK_PATH)) fs.unlinkSync(SOCK_PATH);
    const sockServer = http.createServer(server.listeners('request')[0]);
    sockServer.listen(SOCK_PATH, () => {
      try { fs.chmodSync(SOCK_PATH, 0o777); } catch (_) {}
      console.log(`[Fndesk Lite] Socket 监听就绪: ${SOCK_PATH}`);
    });
  }
} catch (e) {
  console.warn('[Fndesk Lite] 监听 Domain Socket 告警:', e.message);
}
