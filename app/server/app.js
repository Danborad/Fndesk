// Fndesk Lite - 前端核心交互与图标工坊引擎
(function () {
  "use strict";

  // 1. 动态确定网关与 API 根基路径 (核心：修复在飞牛桌面 iframe 嵌套时的路径与 404 错误)
  const API_BASE = (function () {
    const p = window.location.pathname;
    if (p.includes("index.cgi")) {
      const idx = p.indexOf("index.cgi");
      return p.substring(0, idx + "index.cgi".length);
    }
    if (p.startsWith("/app/fndesk")) {
      return "/app/fndesk";
    }
    return "";
  })();

  function resolveUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("//")) {
      return url;
    }
    const clean = url.startsWith("/") ? url : "/" + url;
    return API_BASE + clean;
  }

  // 全局状态管理
  const state = {
    token: localStorage.getItem("fndesk_token") || "",
    icons: [],
    dockerContainers: [],
    presets: [],
    lanIp: "127.0.0.1",
    filter: "all",
    searchQuery: "",
    isSniffing: false
  };

  // 图标工坊画布编辑状态
  const studioState = {
    img: null,
    shape: "squircle", // squircle | circle | round | none
    scale: 0.85,
    padding: 0.12,
    bgType: "transparent", // transparent | solid | gradient
    bgColor: "#1e293b",
    bgGradient: ["#3b82f6", "#8b5cf6", 135],
    shadow: true,
    lastExportDataUrl: ""
  };

  // DOM 元素缓存
  const dom = {
    btnRefresh: document.getElementById("btnRefresh"),
    refreshIcon: document.getElementById("refreshIcon"),
    btnSettings: document.getElementById("btnSettings"),
    btnAddIcon: document.getElementById("btnAddIcon"),
    btnLogout: document.getElementById("btnLogout"),
    statTotalIcons: document.getElementById("statTotalIcons"),
    statNativeApps: document.getElementById("statNativeApps"),
    statDockerContainers: document.getElementById("statDockerContainers"),
    cardDockerStat: document.getElementById("cardDockerStat"),
    searchInput: document.getElementById("searchInput"),
    filterSegment: document.getElementById("filterSegment"),
    iconGrid: document.getElementById("iconGrid"),

    // 编辑弹窗
    editModal: document.getElementById("editModal"),
    editModalTitle: document.getElementById("editModalTitle"),
    btnCloseEditModal: document.getElementById("btnCloseEditModal"),
    btnCancelEdit: document.getElementById("btnCancelEdit"),
    btnSaveIcon: document.getElementById("btnSaveIcon"),
    dockerSelect: document.getElementById("dockerSelect"),
    fieldId: document.getElementById("fieldId"),
    fieldTitle: document.getElementById("fieldTitle"),
    fieldOpenInPage: document.getElementById("fieldOpenInPage"),
    fieldProtocol: document.getElementById("fieldProtocol"),
    fieldLan: document.getElementById("fieldLan"),
    lanHint: document.getElementById("lanHint"),
    fieldWan: document.getElementById("fieldWan"),
    fieldGenerateNative: document.getElementById("fieldGenerateNative"),
    fieldLanPic: document.getElementById("fieldLanPic"),
    fieldIconDataUrl: document.getElementById("fieldIconDataUrl"),
    fieldAppname: document.getElementById("fieldAppname"),

    // 工坊与预览一体化
    studioCanvas: document.getElementById("studioCanvas"),
    mockupTitle: document.getElementById("mockupTitle"),
    btnSniffFavicon: document.getElementById("btnSniffFavicon"),
    btnUploadLocal: document.getElementById("btnUploadLocal"),
    localFileInput: document.getElementById("localFileInput"),
    presetChipsContainer: document.getElementById("presetChipsContainer"),
    shapeSelector: document.getElementById("shapeSelector"),
    sliderPadding: document.getElementById("sliderPadding"),
    valPadding: document.getElementById("valPadding"),
    sliderScale: document.getElementById("sliderScale"),
    valScale: document.getElementById("valScale"),
    selectedBgLabel: document.getElementById("selectedBgLabel"),
    paletteGrid: document.getElementById("paletteGrid"),
    checkLogoShadow: document.getElementById("checkLogoShadow"),

    // 设置与登录弹窗
    settingsModal: document.getElementById("settingsModal"),
    btnCloseSettings: document.getElementById("btnCloseSettings"),
    btnCancelSettings: document.getElementById("btnCancelSettings"),
    btnSavePassword: document.getElementById("btnSavePassword"),
    oldPassword: document.getElementById("oldPassword"),
    newPassword: document.getElementById("newPassword"),
    confirmPassword: document.getElementById("confirmPassword"),
    settingsLanIp: document.getElementById("settingsLanIp"),
    loginModal: document.getElementById("loginModal"),
    loginPassword: document.getElementById("loginPassword"),
    btnSubmitLogin: document.getElementById("btnSubmitLogin"),
    toastContainer: document.getElementById("toastContainer")
  };

  // API 通用调用函数
  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.token) {
      headers["x-auth-token"] = state.token;
      headers["Authorization"] = "Bearer " + state.token;
    }
    if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }

    const targetUrl = resolveUrl(path);
    try {
      const res = await fetch(targetUrl, { ...options, headers });
      if (res.status === 401) {
        openLoginModal();
        throw new Error("未授权或登录已过期");
      }
      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (_) {
        throw new Error(`服务器响应非 JSON (HTTP ${res.status}): ${rawText.slice(0, 80)}...`);
      }
      return data;
    } catch (e) {
      console.warn(`[API] ${path} 请求异常:`, e.message);
      throw e;
    }
  }

  // 轻量 Toast 提示
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    let icon = "fa-info-circle";
    if (type === "success") icon = "fa-check-circle";
    if (type === "error") icon = "fa-exclamation-triangle";
    toast.innerHTML = `<i class="fa ${icon}"></i><span>${message}</span>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px) scale(0.95)";
      toast.style.transition = "all 0.25s ease";
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // 初始化应用
  async function initApp() {
    bindEvents();
    initPalette();
    await checkStatus();
    await refreshData();
  }

  // 检查状态
  async function checkStatus() {
    try {
      const res = await api("/api/status");
      if (res.success) {
        if (res.lanIp) {
          state.lanIp = res.lanIp;
          dom.settingsLanIp.textContent = res.lanIp;
        }
        if (res.hasPassword && !state.token) {
          openLoginModal();
        }
      }
    } catch (e) {
      console.error("[Fndesk Lite] 检查服务状态失败:", e.message);
    }
  }

  // 刷新所有数据
  async function refreshData() {
    if (dom.refreshIcon) dom.refreshIcon.classList.add("spin");
    try {
      await Promise.all([loadIcons(), loadDockerContainers(), loadPresets()]);
    } finally {
      setTimeout(() => {
        if (dom.refreshIcon) dom.refreshIcon.classList.remove("spin");
      }, 350);
    }
  }

  // 获取图标列表
  async function loadIcons() {
    try {
      const res = await api("/api/icons");
      if (res.success && Array.isArray(res.icons)) {
        state.icons = res.icons;
        renderIconGrid();
        updateStats();
      }
    } catch (e) {
      showToast("加载图标列表失败: " + e.message, "error");
    }
  }

  // 获取 Docker 容器列表
  async function loadDockerContainers() {
    try {
      const res = await api("/api/docker/containers");
      if (res.success && Array.isArray(res.containers)) {
        state.dockerContainers = res.containers;
        dom.statDockerContainers.textContent = state.dockerContainers.length;
        populateDockerSelect();
      }
    } catch (e) {
      dom.statDockerContainers.textContent = "-";
    }
  }

  // 获取内置品牌预设库
  async function loadPresets() {
    try {
      const res = await api("/api/presets");
      if (res.success && Array.isArray(res.presets)) {
        state.presets = res.presets;
        renderPresetChips();
      }
    } catch (_) {}
  }

  function updateStats() {
    dom.statTotalIcons.textContent = state.icons.length;
    const nativeCount = state.icons.filter(i => i.nativeInstalled).length;
    dom.statNativeApps.textContent = nativeCount;
  }

  // 填充 Docker 快捷选择下拉框
  function populateDockerSelect() {
    dom.dockerSelect.innerHTML = '<option value="">-- 选择运行中的 Docker 容器一键填入 --</option>';
    for (const c of state.dockerContainers) {
      const opt = document.createElement("option");
      opt.value = c.name;
      const portInfo = c.hostPort ? ` [端口 ${c.hostPort}]` : "";
      opt.textContent = `🐳 ${c.name}${portInfo} (${c.image})`;
      dom.dockerSelect.appendChild(opt);
    }
  }

  // 渲染常用品牌预设 Chips
  function renderPresetChips() {
    dom.presetChipsContainer.innerHTML = "";
    for (const p of state.presets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "preset-chip";
      chip.innerHTML = `<img src="${p.dataUrl}"><span>${p.name}</span>`;
      chip.onclick = () => {
        applyPresetToStudio(p);
      };
      dom.presetChipsContainer.appendChild(chip);
    }
  }

  function applyPresetToStudio(preset) {
    loadImgToStudio(preset.dataUrl, () => {
      studioState.bgType = "solid";
      studioState.bgColor = preset.color || "#1e293b";
      dom.selectedBgLabel.textContent = preset.name;
      renderStudioCanvas();
      showToast(`已选用 ${preset.name} 高清矢量图标`, "success");
    });
  }

  // 渲染主界面图标网格
  function renderIconGrid() {
    dom.iconGrid.innerHTML = "";

    let list = state.icons;
    if (state.filter === "native") {
      list = list.filter(i => i.nativeInstalled);
    } else if (state.filter === "shortcut") {
      list = list.filter(i => !i.nativeInstalled);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(i => 
        (i.fndata_Title && i.fndata_Title.toLowerCase().includes(q)) ||
        (i.fndata_Lan && String(i.fndata_Lan).toLowerCase().includes(q)) ||
        (i.fndata_Wan && i.fndata_Wan.toLowerCase().includes(q))
      );
    }

    if (list.length === 0) {
      dom.iconGrid.innerHTML = `
        <div class="empty-state">
          <i class="fa fa-folder-open-o"></i>
          <h4>暂无图标</h4>
          <p>可点击右上角「添加应用图标」，或直接从运行中的 Docker 容器一键生成。</p>
          <button class="btn btn-primary" onclick="window.fndeskOpenAddModal()">
            <i class="fa fa-plus"></i> 添加新图标
          </button>
        </div>
      `;
      return;
    }

    list.sort((a, b) => (b.fndata_Sort || 0) - (a.fndata_Sort || 0));

    for (const item of list) {
      dom.iconGrid.appendChild(createIconCard(item));
    }
  }

  // 创建单张图标卡片
  function createIconCard(item) {
    const card = document.createElement("div");
    card.className = "icon-card";

    let iconSrc = resolveUrl(item.fndata_LanPic || item.fndata_WanPic || "static/icon.png");
    const isNative = Boolean(item.nativeInstalled);
    const badgeHtml = isNative 
      ? '<span class="badge-tag badge-native"><i class="fa fa-check"></i> 飞牛原生</span>'
      : '<span class="badge-tag badge-shortcut"><i class="fa fa-link"></i> 快捷方式</span>';

    let targetUrlText = item.fndata_Lan || item.fndata_Wan || "";
    if (/^\d+$/.test(targetUrlText.trim())) {
      targetUrlText = `:${targetUrlText.trim()}`;
    }

    card.innerHTML = `
      <img src="${iconSrc}" class="card-icon-img" alt="${item.fndata_Title}" onerror="this.src='static/icon.png'">
      <div class="card-info">
        <div class="card-title">
          <span>${escapeHtml(item.fndata_Title)}</span>
          ${badgeHtml}
        </div>
        <div class="card-url" title="${escapeHtml(item.fndata_Lan || item.fndata_Wan || "")}">
          ${escapeHtml(targetUrlText || "未设置访问地址")}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-secondary btn-sm" title="打开应用" data-action="launch">
          <i class="fa fa-external-link"></i>
        </button>
        <button class="btn btn-secondary btn-sm" title="编辑图标" data-action="edit">
          <i class="fa fa-pencil"></i>
        </button>
        <button class="btn btn-secondary btn-sm btn-danger" title="删除" data-action="delete">
          <i class="fa fa-trash"></i>
        </button>
      </div>
    `;

    card.querySelector('[data-action="launch"]').onclick = () => launchApp(item);
    card.querySelector('[data-action="edit"]').onclick = () => openEditModal(item);
    card.querySelector('[data-action="delete"]').onclick = () => deleteApp(item);

    return card;
  }

  // 启动应用
  function launchApp(item) {
    let url = item.fndata_Lan || item.fndata_Wan || "";
    if (!url) return showToast("未配置访问地址", "error");

    if (/^\d+$/.test(url.trim())) {
      const protocol = item.fndata_Protocol === 2 ? "https:" : "http:";
      const host = state.lanIp || window.location.hostname || "127.0.0.1";
      url = `${protocol}//${host}:${url.trim()}`;
    } else if (!/^https?:\/\//i.test(url)) {
      const protocol = item.fndata_Protocol === 2 ? "https://" : "http://";
      url = protocol + url;
    }

    if (item.OpenInPage === 1) {
      window.open(url, "_blank");
    } else {
      window.open(url, "_blank");
    }
  }

  // 删除应用
  async function deleteApp(item) {
    if (!confirm(`确定删除应用「${item.fndata_Title}」吗？`)) return;
    try {
      const res = await api(`/api/icons/${item.id}`, { method: "DELETE" });
      if (res.success) {
        showToast("已成功删除", "success");
        await loadIcons();
      }
    } catch (e) {
      showToast("删除失败: " + e.message, "error");
    }
  }

  // 打开添加/编辑模态框
  function openEditModal(item = null) {
    dom.editModal.classList.add("active");
    dom.dockerSelect.value = "";

    if (item) {
      dom.editModalTitle.innerHTML = `<i class="fa fa-pencil" style="color: var(--accent);"></i> 编辑应用图标`;
      dom.fieldId.value = item.id || "";
      dom.fieldTitle.value = item.fndata_Title || "";
      dom.fieldOpenInPage.value = String(item.OpenInPage || 0);
      dom.fieldProtocol.value = String(item.fndata_Protocol || 0);
      dom.fieldLan.value = item.fndata_Lan || "";
      dom.fieldWan.value = item.fndata_Wan || "";
      dom.fieldLanPic.value = item.fndata_LanPic || "";
      dom.fieldAppname.value = item.appname || "";
      dom.fieldGenerateNative.checked = Boolean(item.nativeInstalled);
      updateLanHint(item.fndata_Lan || "");

      const existingPic = resolveUrl(item.fndata_LanPic || item.fndata_WanPic || "static/icon.png");
      loadImgToStudio(existingPic);
    } else {
      dom.editModalTitle.innerHTML = `<i class="fa fa-plus-circle" style="color: var(--accent);"></i> 添加应用图标`;
      dom.fieldId.value = "";
      dom.fieldTitle.value = "";
      dom.fieldOpenInPage.value = "0";
      dom.fieldProtocol.value = "0";
      dom.fieldLan.value = "";
      dom.fieldWan.value = "";
      dom.fieldLanPic.value = "";
      dom.fieldAppname.value = "";
      dom.fieldGenerateNative.checked = true;
      updateLanHint("");

      loadImgToStudio("static/icon.png");
    }
    updateMockupTitle();
  }

  window.fndeskOpenAddModal = () => openEditModal(null);

  function closeEditModal() {
    dom.editModal.classList.remove("active");
  }

  function updateLanHint(val) {
    const trimmed = String(val || "").trim();
    if (/^\d+$/.test(trimmed)) {
      dom.lanHint.textContent = `局域网完整地址: http://${state.lanIp}:${trimmed}`;
    } else {
      dom.lanHint.textContent = "填入端口号可自动适配飞牛 FN Connect 远程访问穿透。";
    }
  }

  function updateMockupTitle() {
    dom.mockupTitle.textContent = dom.fieldTitle.value.trim() || "应用标题";
  }

  // -------------------------------------------------------------
  // 图标工坊核心 Canvas 渲染引擎
  // -------------------------------------------------------------
  function initPalette() {
    dom.paletteGrid.innerHTML = "";

    // 预设背景列表
    const palettes = [
      { type: "transparent", label: "透明", val: "transparent" },
      { type: "solid", label: "Docker蓝", val: "#0db7ed" },
      { type: "solid", label: "Jellyfin青", val: "#00a4dc" },
      { type: "solid", label: "Plex金", val: "#e5a00d" },
      { type: "solid", label: "Portainer青", val: "#13bef9" },
      { type: "solid", label: "fnOS深蓝", val: "#2563eb" },
      { type: "solid", label: "青龙绿", val: "#10b981" },
      { type: "solid", label: "极简暗黑", val: "#0d1322" },
      { type: "solid", label: "玄武石墨", val: "#1e293b" },
      { type: "solid", label: "纯白", val: "#ffffff" },
      { type: "gradient", label: "蓝紫幻境", val: ["#3b82f6", "#8b5cf6", 135] },
      { type: "gradient", label: "深海极光", val: ["#06b6d4", "#3b82f6", 135] },
      { type: "gradient", label: "落日晚霞", val: ["#f43f5e", "#fb923c", 135] },
      { type: "gradient", label: "极光青翠", val: ["#10b981", "#06b6d4", 135] },
      { type: "gradient", label: "暗夜星云", val: ["#1e293b", "#090d16", 135] },
      { type: "gradient", label: "赛博霓虹", val: ["#d946ef", "#6366f1", 135] }
    ];

    for (const p of palettes) {
      const swatch = document.createElement("div");
      swatch.className = "color-swatch";
      swatch.title = p.label;
      if (p.type === "transparent") {
        swatch.style.background = "repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50% / 10px 10px";
      } else if (p.type === "solid") {
        swatch.style.backgroundColor = p.val;
      } else {
        swatch.style.background = `linear-gradient(${p.val[2]}deg, ${p.val[0]}, ${p.val[1]})`;
      }

      swatch.onclick = () => {
        document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
        swatch.classList.add("active");
        studioState.bgType = p.type;
        if (p.type === "solid") studioState.bgColor = p.val;
        if (p.type === "gradient") studioState.bgGradient = p.val;
        dom.selectedBgLabel.textContent = p.label;
        renderStudioCanvas();
      };
      dom.paletteGrid.appendChild(swatch);
    }
  }

  function loadImgToStudio(src, callback) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      studioState.img = img;
      renderStudioCanvas();
      if (callback) callback();
    };
    img.onerror = () => {
      // 降级使用内置默认
      if (!src.includes("static/icon.png")) {
        loadImgToStudio("static/icon.png", callback);
      }
    };
    img.src = src;
  }

  // 苹果 Squircle (高阶连续曲率超椭圆绘制算法)
  function drawAppleSquircle(ctx, x, y, size) {
    ctx.beginPath();
    const r = size * 0.225; // 仿 iOS 官方比例
    const w = size;
    const h = size;

    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.bezierCurveTo(x + w - r * 0.45, y, x + w, y + r * 0.45, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.bezierCurveTo(x + w, y + h - r * 0.45, x + w - r * 0.45, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.bezierCurveTo(x + r * 0.45, y + h, x, y + h - r * 0.45, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.bezierCurveTo(x, y + r * 0.45, x + r * 0.45, y, x + r, y);
    ctx.closePath();
  }

  // 渲染图标工坊画布 (256x256 高清输出)
  function renderStudioCanvas() {
    const canvas = dom.studioCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = 256;
    canvas.width = size;
    canvas.height = size;

    ctx.clearRect(0, 0, size, size);

    // 1. 设置裁剪路径
    ctx.save();
    if (studioState.shape === "squircle") {
      drawAppleSquircle(ctx, 0, 0, size);
      ctx.clip();
    } else if (studioState.shape === "circle") {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    } else if (studioState.shape === "round") {
      const r = size * 0.18;
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, r);
      ctx.closePath();
      ctx.clip();
    }

    // 2. 绘制背景底色
    if (studioState.bgType === "solid") {
      ctx.fillStyle = studioState.bgColor;
      ctx.fillRect(0, 0, size, size);
    } else if (studioState.bgType === "gradient") {
      const [c1, c2, deg] = studioState.bgGradient;
      const rad = (deg * Math.PI) / 180;
      const x1 = (size / 2) - (Math.cos(rad) * size) / 2;
      const y1 = (size / 2) - (Math.sin(rad) * size) / 2;
      const x2 = (size / 2) + (Math.cos(rad) * size) / 2;
      const y2 = (size / 2) + (Math.sin(rad) * size) / 2;
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    // 3. 绘制 Logo 主体 (留白与缩放控制)
    if (studioState.img) {
      const paddingPx = size * studioState.padding;
      const availSize = size - paddingPx * 2;
      const imgW = studioState.img.naturalWidth || studioState.img.width || 1;
      const imgH = studioState.img.naturalHeight || studioState.img.height || 1;
      const aspect = imgW / imgH;

      let drawW, drawH;
      if (aspect >= 1) {
        drawW = availSize * studioState.scale;
        drawH = drawW / aspect;
      } else {
        drawH = availSize * studioState.scale;
        drawW = drawH * aspect;
      }

      const drawX = (size - drawW) / 2;
      const drawY = (size - drawH) / 2;

      // 可选 Logo 柔和立体阴影
      if (studioState.shadow && studioState.bgType !== "transparent") {
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
      }

      ctx.drawImage(studioState.img, drawX, drawY, drawW, drawH);
    }

    ctx.restore();

    // 导出 base64
    studioState.lastExportDataUrl = canvas.toDataURL("image/png");
    dom.fieldIconDataUrl.value = studioState.lastExportDataUrl;
  }

  // -------------------------------------------------------------
  // 嗅探与上传逻辑 (重点解决填端口无法获取图标)
  // -------------------------------------------------------------
  async function triggerSniff() {
    let url = dom.fieldLan.value.trim() || dom.fieldWan.value.trim();
    if (!url && dom.dockerSelect.value) {
      const chosen = state.dockerContainers.find(c => c.name === dom.dockerSelect.value);
      if (chosen && chosen.hostPort) url = chosen.hostPort;
    }
    if (!url) {
      showToast("请先在左侧填入访问端口或内网地址", "error");
      dom.fieldLan.focus();
      return;
    }

    const sniffBtn = dom.btnSniffFavicon;
    sniffBtn.disabled = true;
    sniffBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> <span>探测中...</span>';

    try {
      const res = await api("/api/fetch-favicon", {
        method: "POST",
        body: {
          url: url,
          title: dom.fieldTitle.value.trim(),
          name: dom.dockerSelect.value
        }
      });
      if (res.success && res.dataUrl) {
        loadImgToStudio(res.dataUrl, () => {
          showToast("成功获取高清图标！已载入工坊实时渲染", "success");
        });
      }
    } catch (e) {
      showToast(e.message || "未能探测到图标，可从常用品牌库选用或上传", "error");
    } finally {
      sniffBtn.disabled = false;
      sniffBtn.innerHTML = '<i class="fa fa-globe"></i> <span>抓取 Favicon</span>';
    }
  }

  // 保存图标数据并生成
  async function handleSave() {
    const title = dom.fieldTitle.value.trim();
    if (!title) return showToast("请输入应用标题", "error");

    const btn = dom.btnSaveIcon;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 正在生成...';

    try {
      const payload = {
        id: dom.fieldId.value || undefined,
        fndata_Title: title,
        fndata_Lan: dom.fieldLan.value.trim(),
        fndata_Wan: dom.fieldWan.value.trim(),
        fndata_LanPic: dom.fieldLanPic.value,
        OpenInPage: parseInt(dom.fieldOpenInPage.value, 10),
        fndata_Protocol: parseInt(dom.fieldProtocol.value, 10),
        iconDataUrl: studioState.lastExportDataUrl,
        generateNative: dom.fieldGenerateNative.checked,
        appname: dom.fieldAppname.value || undefined
      };

      const res = await api("/api/icons", {
        method: "POST",
        body: payload
      });

      if (res.success) {
        showToast("应用图标保存成功！", "success");
        closeEditModal();
        await loadIcons();
      }
    } catch (e) {
      showToast("保存失败: " + e.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa fa-check"></i> 保存并应用';
    }
  }

  // 绑定交互事件
  function bindEvents() {
    // 顶部操作
    dom.btnRefresh.onclick = () => refreshData();
    dom.btnAddIcon.onclick = () => openEditModal(null);
    dom.btnSettings.onclick = () => dom.settingsModal.classList.add("active");
    dom.btnCloseSettings.onclick = () => dom.settingsModal.classList.remove("active");
    dom.btnCancelSettings.onclick = () => dom.settingsModal.classList.remove("active");
    dom.btnCloseEditModal.onclick = closeEditModal;
    dom.btnCancelEdit.onclick = closeEditModal;
    dom.btnSaveIcon.onclick = handleSave;

    // Docker 指标卡片点击快速选择
    dom.cardDockerStat.onclick = () => {
      openEditModal(null);
      setTimeout(() => dom.dockerSelect.focus(), 150);
    };

    // Docker 容器快捷导入联动
    dom.dockerSelect.onchange = () => {
      const name = dom.dockerSelect.value;
      if (!name) return;
      const c = state.dockerContainers.find(item => item.name === name);
      if (c) {
        if (!dom.fieldTitle.value.trim()) {
          // 格式化美化名称：如 open-ai-canvas-web-1 => OpenAI Canvas
          dom.fieldTitle.value = c.matchedBrand || c.name.replace(/-[0-9]+$/, "").replace(/[-_]/g, " ");
        }
        if (c.hostPort) {
          dom.fieldLan.value = c.hostPort;
          updateLanHint(c.hostPort);
        }
        updateMockupTitle();

        // 若已匹配品牌预设，自动填入
        if (c.presetDataUrl) {
          loadImgToStudio(c.presetDataUrl, () => {
            studioState.bgType = "solid";
            renderStudioCanvas();
          });
        } else if (c.hostPort) {
          // 自动触发探测
          triggerSniff();
        }
      }
    };

    // 端口输入实时提示
    dom.fieldLan.oninput = () => {
      updateLanHint(dom.fieldLan.value);
    };

    dom.fieldTitle.oninput = updateMockupTitle;

    // 抓取 Favicon
    dom.btnSniffFavicon.onclick = triggerSniff;

    // 上传图片
    dom.btnUploadLocal.onclick = () => dom.localFileInput.click();
    dom.localFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        loadImgToStudio(evt.target.result);
      };
      reader.readAsDataURL(file);
    };

    // 形状遮罩分段切换
    dom.shapeSelector.querySelectorAll(".segmented-btn").forEach(btn => {
      btn.onclick = () => {
        dom.shapeSelector.querySelectorAll(".segmented-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        studioState.shape = btn.getAttribute("data-shape");
        renderStudioCanvas();
      };
    });

    // 留白内边距与缩放
    dom.sliderPadding.oninput = () => {
      const val = parseInt(dom.sliderPadding.value, 10);
      dom.valPadding.textContent = `${val}%`;
      studioState.padding = val / 100;
      renderStudioCanvas();
    };

    dom.sliderScale.oninput = () => {
      const val = parseInt(dom.sliderScale.value, 10);
      dom.valScale.textContent = `${val}%`;
      studioState.scale = val / 100;
      renderStudioCanvas();
    };

    dom.checkLogoShadow.onchange = () => {
      studioState.shadow = dom.checkLogoShadow.checked;
      renderStudioCanvas();
    };

    // 筛选标签切换
    dom.filterSegment.querySelectorAll(".segmented-btn").forEach(btn => {
      btn.onclick = () => {
        dom.filterSegment.querySelectorAll(".segmented-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.filter = btn.getAttribute("data-filter");
        renderIconGrid();
      };
    });

    // 搜索实时过滤
    dom.searchInput.oninput = () => {
      state.searchQuery = dom.searchInput.value.trim();
      renderIconGrid();
    };

    // 快捷键 / 聚焦搜索
    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        dom.searchInput.focus();
      }
      if (e.key === "Escape") {
        closeEditModal();
        dom.settingsModal.classList.remove("active");
      }
    });

    // 保存密码
    dom.btnSavePassword.onclick = async () => {
      const np = dom.newPassword.value;
      const cp = dom.confirmPassword.value;
      if (np !== cp) return showToast("两次输入的新密码不一致", "error");
      try {
        const res = await api("/api/change-password", {
          method: "POST",
          body: { oldPassword: dom.oldPassword.value, newPassword: np }
        });
        if (res.success) {
          showToast("管理密码已成功更新", "success");
          dom.settingsModal.classList.remove("active");
        }
      } catch (e) {
        showToast("修改密码失败: " + e.message, "error");
      }
    };

    // 登录
    dom.btnSubmitLogin.onclick = async () => {
      const pwd = dom.loginPassword.value;
      try {
        const res = await api("/api/login", {
          method: "POST",
          body: { password: pwd }
        });
        if (res.success) {
          state.token = res.token;
          localStorage.setItem("fndesk_token", res.token);
          dom.loginModal.classList.remove("active");
          showToast("登录成功", "success");
          await refreshData();
        }
      } catch (e) {
        showToast("登录失败: " + e.message, "error");
      }
    };
  }

  function openLoginModal() {
    dom.loginModal.classList.add("active");
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
