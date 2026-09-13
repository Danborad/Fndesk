/**
 * Fndesk Lite - 飞牛桌面 WeTab 小组件与快捷方式挂载引擎
 * 纯原生 JS 实现，无侵入式安全注入，支持一键还原
 */
(function() {
  if (window.__FNDESK_DESKTOP_LOADED__) return;
  window.__FNDESK_DESKTOP_LOADED__ = true;

  console.log("[Fndesk Desktop] 挂载引擎已启动...");

  // 基础 API 地址识别
  const API_BASE = (function() {
    if (window.location.port === "9990") return "/api";
    return "/cgi/ThirdParty/fndesk/index.cgi/api";
  })();

  // 注入全局样式
  function injectStyles() {
    if (document.getElementById("fndesk-desktop-styles")) return;
    const style = document.createElement("style");
    style.id = "fndesk-desktop-styles";
    style.textContent = `
      /* WeTab 小组件容器看板 */
      .fndesk-board {
        position: fixed;
        left: 84px;
        top: 24px;
        z-index: 40;
        display: flex;
        flex-direction: column;
        gap: 8px;
        user-select: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .fndesk-board-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px;
        height: 28px;
        border-radius: 9999px;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.85);
        font-size: 11px;
        font-weight: 500;
        cursor: move;
        width: fit-content;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      .fndesk-board-title {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fndesk-board-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 12px;
        cursor: default;
      }
      .fndesk-board-btn {
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
        font-size: 10px;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .fndesk-board-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      .fndesk-board-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, 138px);
        grid-auto-rows: 120px;
        grid-auto-flow: dense;
        gap: 14px;
        width: fit-content;
        max-width: calc(100vw - 120px);
      }
      .fndesk-board.is-collapsed .fndesk-board-grid {
        display: none !important;
      }

      /* WeTab 卡片通用风格 (飞牛统一原生圆角 18px 与毛玻璃) */
      .wetab-card {
        position: relative;
        border-radius: 18px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(28px) saturate(180%);
        -webkit-backdrop-filter: blur(28px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #ffffff;
        box-sizing: border-box;
        overflow: hidden;
        cursor: default;
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, border-color 0.2s ease;
      }
      .wetab-card:hover {
        transform: translateY(-2px);
        border-color: rgba(255, 255, 255, 0.3);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      }

      /* 尺寸规格：小 (1x1), 中 (2x1), 大 (2x2) */
      .wetab-card-small {
        grid-column: span 1;
        grid-row: span 1;
        width: 138px;
        height: 120px;
        padding: 12px;
      }
      .wetab-card-medium {
        grid-column: span 2;
        grid-row: span 1;
        width: 290px;
        height: 120px;
        padding: 12px 14px;
      }
      .wetab-card-large {
        grid-column: span 2;
        grid-row: span 2;
        width: 290px;
        height: 254px;
        padding: 16px;
      }

      /* 主题预设 */
      .theme-glass {
        background: rgba(18, 26, 44, 0.55);
      }
      .theme-dark {
        background: rgba(15, 23, 42, 0.85);
      }
      .theme-forest {
        background: linear-gradient(135deg, rgba(6, 78, 59, 0.85), rgba(20, 83, 45, 0.85));
      }
      .theme-aurora {
        background: linear-gradient(135deg, rgba(88, 28, 135, 0.85), rgba(67, 56, 202, 0.85));
      }
      .theme-sunset {
        background: linear-gradient(135deg, rgba(194, 65, 12, 0.85), rgba(180, 83, 9, 0.85));
      }
      .theme-sky {
        background: linear-gradient(135deg, rgba(2, 132, 199, 0.85), rgba(14, 165, 233, 0.85));
      }

      /* 天气卡片样式 */
      .weather-inner {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .weather-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 500;
        opacity: 0.95;
      }
      .weather-main {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .weather-temp {
        font-size: 38px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -1px;
        font-family: -apple-system, system-ui, sans-serif;
      }
      .weather-desc {
        font-size: 12px;
        opacity: 0.85;
      }
      .weather-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        opacity: 0.75;
      }
      .weather-med-right {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
        font-size: 11px;
        opacity: 0.85;
      }
      .weather-pill {
        background: rgba(255, 255, 255, 0.12);
        padding: 2px 6px;
        border-radius: 6px;
        width: fit-content;
      }

      /* 倒计时卡片样式 */
      .cd-inner {
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .cd-title {
        font-size: 13px;
        font-weight: 600;
        opacity: 0.95;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cd-center {
        display: flex;
        align-items: baseline;
        gap: 4px;
        margin: auto 0;
      }
      .cd-days {
        font-size: 40px;
        font-weight: 800;
        line-height: 1;
        font-family: -apple-system, system-ui, sans-serif;
      }
      .cd-unit {
        font-size: 13px;
        font-weight: 600;
        opacity: 0.8;
      }
      .cd-time-bar {
        display: flex;
        gap: 4px;
        font-size: 11px;
        font-family: monospace;
        background: rgba(0, 0, 0, 0.25);
        padding: 3px 8px;
        border-radius: 6px;
        width: fit-content;
      }
      .cd-footer {
        font-size: 11px;
        opacity: 0.75;
      }

      /* 数字时钟卡片 */
      .clock-inner {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .clock-time {
        font-size: 32px;
        font-weight: 700;
        letter-spacing: -0.5px;
        font-family: -apple-system, system-ui, sans-serif;
        line-height: 1.1;
      }
      .clock-sec {
        font-size: 16px;
        opacity: 0.6;
        margin-left: 2px;
      }
      .clock-date {
        font-size: 11px;
        opacity: 0.75;
        margin-top: 4px;
      }

      /* 便签卡片 */
      .notes-inner {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .notes-title {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 4px;
        opacity: 0.9;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .notes-content {
        font-size: 11px;
        line-height: 1.4;
        opacity: 0.8;
        white-space: pre-wrap;
        overflow: hidden;
        flex: 1;
      }

      /* 窗口化 iframe 弹窗 */
      .fndesk-win {
        position: fixed;
        z-index: 99999;
        background: rgba(18, 26, 44, 0.85);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 14px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .fndesk-win-header {
        height: 40px;
        background: rgba(13, 19, 33, 0.9);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        cursor: move;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        user-select: none;
      }
      .fndesk-win-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
      }
      .fndesk-win-title img {
        width: 20px;
        height: 20px;
        border-radius: 4px;
      }
      .fndesk-win-tools {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fndesk-win-btn {
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: transparent;
        color: #cbd5e1;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.15s ease;
      }
      .fndesk-win-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
      }
      .fndesk-win-btn.btn-close:hover {
        background: #ef4444;
        color: #fff;
      }
      .fndesk-win-body {
        flex: 1;
        position: relative;
        background: #fff;
      }
      .fndesk-win-body iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
      .fndesk-win-resizer {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: se-resize;
      }
    `;
    document.head.appendChild(style);
  }

  // 辅助请求函数
  async function apiGet(endpoint) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`[Fndesk] GET ${endpoint} 失败:`, e.message);
      return null;
    }
  }

  // 天气缓存
  let weatherCache = {};
  async function fetchWeather(city = "北京") {
    if (weatherCache[city] && Date.now() - weatherCache[city].time < 15 * 60 * 1000) {
      return weatherCache[city].data;
    }
    const res = await apiGet(`/weather?city=${encodeURIComponent(city)}`);
    if (res && res.success && res.weather) {
      weatherCache[city] = { time: Date.now(), data: res.weather };
      return res.weather;
    }
    return {
      city: city || "北京",
      temp: "22",
      desc: "晴",
      humidity: "45%",
      wind: "微风",
      tempMin: "18",
      tempMax: "27"
    };
  }

  // 计算倒计时天/时/分/秒
  function calcCountdown(targetDateStr) {
    const target = new Date(targetDateStr).getTime();
    const now = Date.now();
    const diff = target - now;
    if (isNaN(diff)) return { days: 0, hours: 0, mins: 0, secs: 0, isPast: false };
    if (diff <= 0) {
      const pastDays = Math.floor(Math.abs(diff) / (1000 * 60 * 60 * 24));
      return { days: pastDays, hours: 0, mins: 0, secs: 0, isPast: true };
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    return { days, hours, mins, secs, isPast: false };
  }

  const pad = n => String(n).padStart(2, "0");

  // 打开在页内窗口中的 iframe
  let windowZIndex = 9999;
  function openIframeWindow(url, title, icon) {
    const winId = `fndesk-win-${Date.now()}`;
    const win = document.createElement("div");
    win.className = "fndesk-win";
    win.id = winId;
    windowZIndex++;
    win.style.zIndex = windowZIndex;
    win.style.width = "900px";
    win.style.height = "620px";
    win.style.left = `${Math.max(40, (window.innerWidth - 900) / 2)}px`;
    win.style.top = `${Math.max(40, (window.innerHeight - 620) / 2)}px`;

    win.innerHTML = `
      <div class="fndesk-win-header">
        <div class="fndesk-win-title">
          ${icon ? `<img src="${icon}" onerror="this.style.display='none'">` : ""}
          <span>${title || "应用查看"}</span>
        </div>
        <div class="fndesk-win-tools">
          <div class="fndesk-win-btn btn-refresh" title="刷新">↻</div>
          <div class="fndesk-win-btn btn-min" title="最小化">−</div>
          <div class="fndesk-win-btn btn-close" title="关闭">✕</div>
        </div>
      </div>
      <div class="fndesk-win-body">
        <iframe src="${url}"></iframe>
      </div>
      <div class="fndesk-win-resizer"></div>
    `;

    document.body.appendChild(win);

    // 拖动窗口
    const header = win.querySelector(".fndesk-win-header");
    let isDragging = false, startX, startY, origLeft, origTop;
    header.addEventListener("mousedown", e => {
      if (e.target.closest(".fndesk-win-btn")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseInt(win.style.left, 10);
      origTop = parseInt(win.style.top, 10);
      windowZIndex++;
      win.style.zIndex = windowZIndex;
      const onMove = ev => {
        if (!isDragging) return;
        win.style.left = `${origLeft + (ev.clientX - startX)}px`;
        win.style.top = `${origTop + (ev.clientY - startY)}px`;
      };
      const onUp = () => {
        isDragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    win.querySelector(".btn-close").addEventListener("click", () => win.remove());
    win.querySelector(".btn-refresh").addEventListener("click", () => {
      const iframe = win.querySelector("iframe");
      if (iframe) iframe.src = iframe.src;
    });
    win.querySelector(".btn-min").addEventListener("click", () => win.remove());
  }

  // 渲染单个 WeTab 小组件卡片
  async function renderWidgetCard(widget) {
    const card = document.createElement("div");
    const size = widget.size || "medium";
    const theme = widget.theme || "glass";
    card.className = `wetab-card wetab-card-${size} theme-${theme}`;
    card.dataset.widgetId = widget.id;

    if (widget.type === "weather") {
      const w = await fetchWeather(widget.city || "北京");
      if (size === "small") {
        card.innerHTML = `
          <div class="weather-inner">
            <div class="weather-header">
              <span>${w.city}</span>
              <span>⛅</span>
            </div>
            <div class="weather-main">
              <span class="weather-temp">${w.temp}°</span>
              <span class="weather-desc">${w.desc}</span>
            </div>
            <div class="weather-footer">
              <span>${w.tempMin}°~${w.tempMax}°</span>
              <span>湿度 ${w.humidity}</span>
            </div>
          </div>
        `;
      } else if (size === "large") {
        card.innerHTML = `
          <div class="weather-inner" style="gap: 12px;">
            <div class="weather-header" style="font-size: 15px;">
              <span>${w.city} 天气概况</span>
              <span style="font-size: 22px;">⛅</span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div class="weather-temp" style="font-size: 52px;">${w.temp}°</div>
              <div style="text-align: right;">
                <div style="font-size: 16px; font-weight: 600;">${w.desc}</div>
                <div style="font-size: 12px; opacity: 0.75; margin-top: 4px;">今日 ${w.tempMin}° ~ ${w.tempMax}°</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <div class="weather-pill">💧 湿度: ${w.humidity}</div>
              <div class="weather-pill">💨 风况: ${w.wind}</div>
              <div class="weather-pill">🌡️ 体感: ${w.feelsLike || w.temp}°</div>
              <div class="weather-pill">🍃 空气: 优良</div>
            </div>
          </div>
        `;
      } else {
        // medium (2x1)
        card.innerHTML = `
          <div class="weather-inner" style="flex-direction: row; align-items: center; justify-content: space-between;">
            <div>
              <div class="weather-header" style="margin-bottom: 6px;">
                <span>${w.city}</span>
                <span style="margin-left: 6px;">⛅</span>
              </div>
              <div class="weather-main">
                <span class="weather-temp">${w.temp}°</span>
                <span class="weather-desc">${w.desc}</span>
              </div>
            </div>
            <div class="weather-med-right">
              <span class="weather-pill">🌡️ ${w.tempMin}° ~ ${w.tempMax}°</span>
              <span class="weather-pill">💧 湿度 ${w.humidity}</span>
              <span class="weather-pill">💨 ${w.wind}</span>
            </div>
          </div>
        `;
      }
    } else if (widget.type === "countdown") {
      const updateCd = () => {
        const cd = calcCountdown(widget.targetDate || "2026-10-01T00:00");
        if (size === "small") {
          card.innerHTML = `
            <div class="cd-inner">
              <div class="cd-title">${widget.title || "倒计时"}</div>
              <div class="cd-center">
                <div class="cd-days">${cd.days}</div>
                <div class="cd-unit">天</div>
              </div>
              <div class="cd-footer">${cd.isPast ? "已过去" : "目标倒计时"}</div>
            </div>
          `;
        } else if (size === "large") {
          card.innerHTML = `
            <div class="cd-inner" style="gap: 12px;">
              <div class="weather-header" style="font-size: 15px;">
                <span class="cd-title">${widget.title || "纪念日倒计时"}</span>
                <span style="font-size: 18px;">⏳</span>
              </div>
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin: auto 0;">
                <div style="display: flex; align-items: baseline; gap: 6px;">
                  <span class="cd-days" style="font-size: 64px;">${cd.days}</span>
                  <span class="cd-unit" style="font-size: 18px;">天</span>
                </div>
                <div class="cd-time-bar" style="margin-top: 10px; font-size: 14px; padding: 6px 14px;">
                  ${pad(cd.hours)} 时 ${pad(cd.mins)} 分 ${pad(cd.secs)} 秒
                </div>
              </div>
              <div class="cd-footer" style="text-align: center;">
                目标: ${(widget.targetDate || "").split("T")[0]}
              </div>
            </div>
          `;
        } else {
          // medium (2x1)
          card.innerHTML = `
            <div class="cd-inner">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="cd-title">${widget.title || "倒计时"}</div>
                <div style="font-size: 11px; opacity: 0.7;">${cd.isPast ? "已过" : "剩余"}</div>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin: auto 0;">
                <div style="display: flex; align-items: baseline; gap: 4px;">
                  <span class="cd-days">${cd.days}</span>
                  <span class="cd-unit">天</span>
                </div>
                <div class="cd-time-bar">
                  ${pad(cd.hours)}:${pad(cd.mins)}:${pad(cd.secs)}
                </div>
              </div>
              <div class="cd-footer">${(widget.targetDate || "").split("T")[0]}</div>
            </div>
          `;
        }
      };
      updateCd();
      setInterval(updateCd, 1000);
    } else if (widget.type === "clock") {
      const updateClock = () => {
        const now = new Date();
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const secStr = pad(now.getSeconds());
        const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${["日","一","二","三","四","五","六"][now.getDay()]}`;

        card.innerHTML = `
          <div class="clock-inner">
            <div class="clock-time">
              ${timeStr}<span class="clock-sec">${secStr}</span>
            </div>
            <div class="clock-date">${dateStr}</div>
          </div>
        `;
      };
      updateClock();
      setInterval(updateClock, 1000);
    } else if (widget.type === "notes") {
      card.innerHTML = `
        <div class="notes-inner">
          <div class="notes-title">📌 ${widget.title || "便签备忘"}</div>
          <div class="notes-content">${widget.content || "点击管理端编辑便签内容..."}</div>
        </div>
      `;
    }

    return card;
  }

  // 挂载 WeTab 小组件看板
  async function mountWidgetsBoard(widgets) {
    if (!widgets || widgets.length === 0) return;
    let board = document.getElementById("fndesk-wetab-board");
    if (!board) {
      board = document.createElement("div");
      board.id = "fndesk-wetab-board";
      board.className = "fndesk-board";

      // 记忆位置
      const savedPos = localStorage.getItem("fndesk_board_pos");
      if (savedPos) {
        try {
          const { left, top } = JSON.parse(savedPos);
          board.style.left = `${left}px`;
          board.style.top = `${top}px`;
        } catch (_) {}
      }

      board.innerHTML = `
        <div class="fndesk-board-header">
          <div class="fndesk-board-title">
            <span>⛅</span> <span>WeTab 卡片</span>
          </div>
          <div class="fndesk-board-actions">
            <div class="fndesk-board-btn btn-collapse" title="收起/展开">−</div>
            <div class="fndesk-board-btn btn-config" title="打开管理端">⚙</div>
          </div>
        </div>
        <div class="fndesk-board-grid"></div>
      `;
      document.body.appendChild(board);

      // 拖动看板
      const header = board.querySelector(".fndesk-board-header");
      let isDragging = false, startX, startY, origLeft, origTop;
      header.addEventListener("mousedown", e => {
        if (e.target.closest(".fndesk-board-btn")) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = parseInt(board.style.left || "84", 10);
        origTop = parseInt(board.style.top || "24", 10);
        const onMove = ev => {
          if (!isDragging) return;
          const newLeft = Math.max(10, origLeft + (ev.clientX - startX));
          const newTop = Math.max(10, origTop + (ev.clientY - startY));
          board.style.left = `${newLeft}px`;
          board.style.top = `${newTop}px`;
        };
        const onUp = () => {
          isDragging = false;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          localStorage.setItem("fndesk_board_pos", JSON.stringify({
            left: parseInt(board.style.left, 10),
            top: parseInt(board.style.top, 10)
          }));
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      // 收起展开
      const btnCollapse = board.querySelector(".btn-collapse");
      btnCollapse.addEventListener("click", () => {
        board.classList.toggle("is-collapsed");
        btnCollapse.textContent = board.classList.contains("is-collapsed") ? "+" : "−";
      });

      // 打开配置
      board.querySelector(".btn-config").addEventListener("click", () => {
        window.open("/cgi/ThirdParty/fndesk/index.cgi/", "_blank");
      });
    }

    const grid = board.querySelector(".fndesk-board-grid");
    grid.innerHTML = "";
    for (const item of widgets) {
      try {
        const cardEl = await renderWidgetCard(item);
        grid.appendChild(cardEl);
      } catch (e) {
        console.warn("[Fndesk] 渲染卡片异常:", e);
      }
    }
  }

  // 挂载桌面快捷方式图标到飞牛官方图标列
  function mountShortcutIcons(icons) {
    const desktopContainer = document.querySelector(".box-border.flex.size-full.flex-col.flex-wrap") ||
                             document.querySelector("[data-desktop-item-id]")?.parentElement;
    if (!desktopContainer) return false;

    // 清理旧的注入图标
    desktopContainer.querySelectorAll(".fndesk-custom-shortcut").forEach(e => e.remove());

    const lanHost = window.location.hostname;
    icons.forEach(item => {
      if (item.enable === 0) return;

      let finalUrl = item.fndata_Lan || "";
      if (/^\d+$/.test(finalUrl.trim())) {
        const proto = item.fndata_Protocol === 2 ? "https" : "http";
        finalUrl = `${proto}://${lanHost}:${finalUrl.trim()}`;
      } else if (item.fndata_Wan && (!finalUrl || window.location.hostname !== lanHost)) {
        finalUrl = item.fndata_Wan;
      }

      let iconSrc = item.fndata_LanPic || "";
      if (iconSrc.startsWith("/deskdata")) {
        iconSrc = `/cgi/ThirdParty/fndesk/index.cgi${iconSrc}`;
      }

      const iconNode = document.createElement("div");
      iconNode.className = "box-border flex h-[120px] w-[144px] cursor-pointer select-none flex-col items-center gap-[10px] rounded-xl pt-[22px] fndesk-custom-shortcut";
      iconNode.dataset.fndeskId = item.id;

      iconNode.innerHTML = `
        <div class="inline-flex cursor-pointer flex-col items-center gap-[10px]" role="button" tabindex="0">
          <div class="relative flex size-[52px] shrink-0 flex-row items-center justify-center transition-all duration-150">
            <div class="absolute inset-0 overflow-hidden">
              <div class="box-border size-[80px] p-[15%] !h-[52px] !w-[52px] !p-0">
                <img src="${iconSrc}" alt="${item.fndata_Title}" class="semi-image-img w-full h-full" style="border-radius: 22%; object-fit: contain;" onerror="this.src='/cgi/ThirdParty/fndesk/index.cgi/favicon.ico'">
              </div>
            </div>
          </div>
          <div class="flex min-h-base w-fit max-w-[128px] shrink-0 items-start justify-center">
            <div class="line-clamp-2 max-w-[128px] break-words shrink-0 text-center align-top text-[14px] font-bold leading-[18px] text-white" style="text-shadow: rgba(0, 0, 0, 0.4) 0px 1px 6px, rgba(0, 0, 0, 0.6) 0px 0px 4px;">
              ${item.fndata_Title}
            </div>
          </div>
        </div>
      `;

      iconNode.addEventListener("click", () => {
        if (!finalUrl) return;
        if (item.OpenInPage === 1) {
          openIframeWindow(finalUrl, item.fndata_Title, iconSrc);
        } else {
          window.open(finalUrl, "_blank");
        }
      });

      desktopContainer.appendChild(iconNode);
    });

    return true;
  }

  // 主执行循环
  async function init() {
    injectStyles();

    let [iconsRes, widgetsRes] = await Promise.all([
      apiGet("/icons"),
      apiGet("/widgets")
    ]);

    const icons = (iconsRes && iconsRes.icons) ? iconsRes.icons : [];
    const widgets = (widgetsRes && widgetsRes.widgets) ? widgetsRes.widgets : [];

    // 挂载 WeTab 卡片看板
    if (widgets.length > 0) {
      await mountWidgetsBoard(widgets);
    }

    // 轮询挂载快捷方式图标
    if (icons.length > 0) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (mountShortcutIcons(icons) || attempts > 25) {
          clearInterval(timer);
        }
      }, 400);
    }
  }

  // 延迟启动避免阻碍飞牛 React 首屏
  if (document.readyState === "complete") {
    setTimeout(init, 300);
  } else {
    window.addEventListener("load", () => setTimeout(init, 300));
  }
})();
