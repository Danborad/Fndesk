function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/**
 * Fndesk Lite - 前端核心业务控制器
 * 包含：WeTab 极简图标裁剪工坊、WeTab 桌面卡片组件管理、立即生效与还原桌面防搞坏机制
 */

// API 根路径动态适配
const API_BASE = (function() {
  const p = window.location.pathname;
  if (p.includes("index.cgi")) {
    const idx = p.indexOf("index.cgi");
    return p.substring(0, idx + 9) + "/api";
  }
  if (window.location.port === "9990") {
    return "/api";
  }
  return "/api";
})();

// 通用 HTTP 请求助手
async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const token = localStorage.getItem("fndesk_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { "x-auth-token": token } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (res.status === 401) {
      showLoginModal();
      throw new Error("请先登录");
    }
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.message || `请求错误 HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    console.error(`[API 异常] ${endpoint}:`, err);
    throw err;
  }
}

// Toast 提示
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  let icon = "fa-info-circle";
  if (type === "success") icon = "fa-check-circle";
  if (type === "error") icon = "fa-exclamation-triangle";
  el.innerHTML = `<i class="fa ${icon}"></i> <span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

// ==================== 全局状态 ====================
const state = {
  icons: [],
  widgets: [],
  dockerContainers: [],
  activeFilter: "all",
  searchKeyword: "",
  activeMainTab: "icons",
  editingNative: false,

  // 图标工坊状态 (WeTab 裁剪风格)
  cropper: {
    image: null,
    scale: 1.0,
    panX: 0,
    panY: 0,
    rotation: 0,
    bgColor: "transparent",
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    startPanX: 0,
    startPanY: 0,
    isModified: false,
    isExistingIcon: false
  },

  // 小组件表单状态
  widgetForm: {
    id: null,
    type: "weather",
    size: "medium",
    title: "",
    targetDate: "",
    city: "北京",
    theme: "glass",
    style: "digital",
    content: ""
  }
};

// ==================== 桌面注入与还原防搞坏机制 ====================
async function checkDesktopStatus() {
  try {
    const res = await fetchApi("/desktop-status");
    const badge = document.getElementById("badgeDesktopStatus");
    const text = document.getElementById("textDesktopStatus");
    if (res.injected) {
      badge.classList.add("is-mounted");
      text.textContent = "已挂载桌面";
    } else {
      badge.classList.remove("is-mounted");
      text.textContent = "未挂载桌面";
    }
  } catch (_) {}
}

async function applyDesktop() {
  const btn = document.getElementById("btnApplyDesktop");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>生效中...</span>`;
  try {
    const res = await fetchApi("/apply-desktop", { method: "POST" });
    showToast(res.message || "飞牛桌面已生效！正在同步刷新桌面...", "success");
    checkDesktopStatus();
    setTimeout(() => {
      try {
        if (window.top && window.top !== window) {
          window.top.location.reload();
        } else if (window.parent && window.parent !== window) {
          window.parent.location.reload();
        } else {
          window.location.reload();
        }
      } catch (_) {
        window.location.reload();
      }
    }, 600);
  } catch (err) {
    showToast("立即生效失败: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa fa-bolt"></i> <span>立即生效</span>`;
  }
}

async function restoreDesktop() {
  const btn = document.getElementById("btnConfirmRestore");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>正在还原...</span>`;
  try {
    const res = await fetchApi("/restore-desktop", { method: "POST" });
    showToast(res.message || "桌面已彻底还原为出厂状态！正在刷新桌面...", "success");
    closeModal("restoreConfirmModal");
    checkDesktopStatus();
    setTimeout(() => {
      try {
        if (window.top && window.top !== window) {
          window.top.location.reload();
        } else if (window.parent && window.parent !== window) {
          window.parent.location.reload();
        } else {
          window.location.reload();
        }
      } catch (_) {
        window.location.reload();
      }
    }, 600);
  } catch (err) {
    showToast("还原失败: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa fa-history"></i> <span>确认一键还原</span>`;
  }
}

// ==================== WeTab 极简图标裁剪工坊 (图 3 同款) ====================
const WETAB_PALETTE = [
  // 第一排
  { color: "transparent", title: "透明" },
  { color: "#ffffff", title: "纯白" },
  { color: "#475569", title: "岩灰" },
  { color: "#0f172a", title: "深黑" },
  { color: "#f59e0b", title: "琥珀黄" },
  { color: "#10b981", title: "翠绿" },
  { color: "#06b6d4", title: "青碧" },
  { color: "#38bdf8", title: "天蓝" },
  { color: "#3b82f6", title: "官方蓝" },
  { color: "#8b5cf6", title: "魅紫" },
  // 第二排
  { color: "#ec4899", title: "品粉" },
  { color: "#f43f5e", title: "珊瑚红" },
  { color: "#ef4444", title: "正红" },
  { color: "#e2d9cc", title: "米白" },
  { color: "#d4a373", title: "浅驼" },
  { color: "#8d5b4c", title: "醇棕" },
  { color: "#65a30d", title: "草绿" },
  { color: "#52b788", title: "薄荷" },
  { color: "#a5b4fc", title: "淡紫" },
  { color: "rainbow", title: "自定义取色" }
];

function initPaletteDots() {
  const container = document.getElementById("paletteDots");
  container.innerHTML = "";
  WETAB_PALETTE.forEach(item => {
    const dot = document.createElement("div");
    dot.className = "palette-dot";
    dot.title = item.title;

    if (item.color === "transparent") {
      dot.style.background = "linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)";
      dot.style.backgroundSize = "6px 6px";
      dot.style.backgroundColor = "#fff";
    } else if (item.color === "rainbow") {
      dot.className += " palette-dot-rainbow";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.style.opacity = "0";
      picker.style.position = "absolute";
      picker.style.inset = "0";
      picker.style.cursor = "pointer";
      picker.onchange = e => {
        state.cropper.bgColor = e.target.value;
        renderCropCanvas();
        updateActiveDot(dot);
      };
      dot.appendChild(picker);
    } else {
      dot.style.backgroundColor = item.color;
    }

    if (state.cropper.bgColor === item.color) {
      dot.classList.add("active");
    }

    dot.addEventListener("click", () => {
      if (item.color !== "rainbow") {
        state.cropper.bgColor = item.color;
        renderCropCanvas();
        updateActiveDot(dot);
      }
    });

    container.appendChild(dot);
  });
}

function updateActiveDot(activeEl) {
  document.querySelectorAll(".palette-dot").forEach(d => d.classList.remove("active"));
  if (activeEl) activeEl.classList.add("active");
}

// 绘制飞牛官方原生平滑圆角 Squircle
function drawFnSquircle(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function renderCropCanvas() {
  const canvas = document.getElementById("studioCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const size = canvas.width; // 256
  ctx.clearRect(0, 0, size, size);

  // 飞牛官方平滑圆角 (~22%)
  const r = size * 0.22;

  // 裁剪路径
  ctx.save();
  drawFnSquircle(ctx, 0, 0, size, size, r);
  ctx.clip();

  // 底色填充
  if (state.cropper.bgColor && state.cropper.bgColor !== "transparent") {
    ctx.fillStyle = state.cropper.bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  // 绘制主体图像
  if (state.cropper.image) {
    ctx.save();
    ctx.translate(size / 2 + state.cropper.panX, size / 2 + state.cropper.panY);
    ctx.rotate((state.cropper.rotation * Math.PI) / 180);
    ctx.scale(state.cropper.scale, state.cropper.scale);

    const img = state.cropper.image;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    // 如果是成型已有图标，按 1:1 完整铺满裁剪画布；新抓取的 Favicon 或新上传的 Logo 原图，按 0.75 留出优雅边距
    const ratio = state.cropper.isExistingIcon ? 1.0 : 0.75;
    const fitScale = (size * ratio) / Math.max(iw, ih);
    const dw = iw * fitScale;
    const dh = ih * fitScale;

    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  ctx.restore();
}

function loadCropperImage(src, isExisting = false) {
  if (!src) return;
  const img = new Image();
  if (!src.startsWith("data:")) {
    img.crossOrigin = "anonymous";
  }
  img.onload = () => {
    state.cropper.image = img;
    state.cropper.isExistingIcon = isExisting;
    if (!state.cropper.isModified) {
      state.cropper.scale = 1.0;
      state.cropper.panX = 0;
      state.cropper.panY = 0;
      state.cropper.rotation = 0;
    }
    renderCropCanvas();
  };
  img.onerror = () => {
    if (img.crossOrigin) {
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        state.cropper.image = fallbackImg;
        state.cropper.isExistingIcon = isExisting;
        renderCropCanvas();
      };
      fallbackImg.src = src;
    }
  };
  img.src = src;
}

function initCanvasEvents() {
  const wrapper = document.getElementById("canvasContainer");
  const displayRatio = 256 / 114;

  // 拖动平移
  wrapper.addEventListener("mousedown", e => {
    state.cropper.isDragging = true;
    state.cropper.dragStartX = e.clientX;
    state.cropper.dragStartY = e.clientY;
    state.cropper.startPanX = state.cropper.panX;
    state.cropper.startPanY = state.cropper.panY;
  });

  window.addEventListener("mousemove", e => {
    if (!state.cropper.isDragging) return;
    const dx = (e.clientX - state.cropper.dragStartX) * displayRatio;
    const dy = (e.clientY - state.cropper.dragStartY) * displayRatio;
    state.cropper.panX = state.cropper.startPanX + dx;
    state.cropper.panY = state.cropper.startPanY + dy;
    state.cropper.isModified = true;
    renderCropCanvas();
  });

  window.addEventListener("mouseup", () => {
    state.cropper.isDragging = false;
  });

  // 滚轮缩放
  wrapper.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    state.cropper.scale = Math.max(0.3, Math.min(3.0, state.cropper.scale + delta));
    state.cropper.isModified = true;
    renderCropCanvas();
  }, { passive: false });

  // 工具栏按钮控制
  document.getElementById("btnRotateCCW").onclick = () => {
    state.cropper.rotation = (state.cropper.rotation - 90) % 360;
    state.cropper.isModified = true;
    renderCropCanvas();
  };
  document.getElementById("btnRotateCW").onclick = () => {
    state.cropper.rotation = (state.cropper.rotation + 90) % 360;
    state.cropper.isModified = true;
    renderCropCanvas();
  };
  document.getElementById("btnResetCrop").onclick = () => {
    state.cropper.scale = 1.0;
    state.cropper.panX = 0;
    state.cropper.panY = 0;
    state.cropper.rotation = 0;
    state.cropper.isModified = true;
    renderCropCanvas();
  };
  document.getElementById("btnZoomOut").onclick = () => {
    state.cropper.scale = Math.max(0.3, state.cropper.scale - 0.1);
    state.cropper.isModified = true;
    renderCropCanvas();
  };
  document.getElementById("btnZoomIn").onclick = () => {
    state.cropper.scale = Math.min(3.0, state.cropper.scale + 0.1);
    state.cropper.isModified = true;
    renderCropCanvas();
  };
}

// ==================== 图标数据管理 ====================
async function loadIcons() {
  try {
    const data = await fetchApi("/icons");
    state.icons = data.icons || [];
    renderIcons();
    updateStats();
  } catch (err) {
    showToast("获取图标列表失败: " + err.message, "error");
  }
}

function renderIcons() {
  const grid = document.getElementById("iconGrid");
  const keyword = state.searchKeyword.toLowerCase().trim();
  const filter = state.activeFilter;

  const filtered = state.icons.filter(item => {
    if (filter === "native" && !item.nativeInstalled) return false;
    if (filter === "shortcut" && item.nativeInstalled) return false;
    if (!keyword) return true;
    const text = `${item.fndata_Title} ${item.fndata_Lan} ${item.fndata_Wan} ${item.appname}`.toLowerCase();
    return text.includes(keyword);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
        <i class="fa fa-folder-open-o" style="font-size: 2.5rem; margin-bottom: 0.8rem; opacity: 0.4;"></i>
        <div>没有找到匹配的图标，点击右上角「添加图标」开始创建</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    let imgSrc = item.fndata_LanPic || "";
    if (imgSrc.startsWith("/deskdata")) {
      imgSrc = `${API_BASE.replace(/\/api$/, "")}${imgSrc}`;
    }
    const isNative = Boolean(item.nativeInstalled);
    const tag = isNative
      ? `<span class="icon-tag-native"><i class="fa fa-cube"></i> 飞牛原生</span>`
      : `<span class="icon-tag-shortcut"><i class="fa fa-link"></i> 桌面快捷</span>`;

    return `
      <div class="icon-card">
        <img class="icon-thumb" src="${imgSrc}" alt="${item.fndata_Title}" onerror="this.src='favicon.ico'">
        <div class="icon-info">
          <div class="icon-title">
            <span>${item.fndata_Title}</span>
            ${tag}
          </div>
          <div class="icon-meta" title="${item.fndata_Lan || item.fndata_Wan}">
            ${item.fndata_Lan ? `端口/内网: ${item.fndata_Lan}` : (item.fndata_Wan || "未配置地址")}
          </div>
        </div>
        <div class="icon-actions">
          <button class="btn btn-secondary btn-icon btn-sm" onclick="openIconPreview('${item.id}')" title="打开/测试访问">
            <i class="fa fa-external-link"></i>
          </button>
          <button class="btn btn-secondary btn-icon btn-sm" onclick="editIcon(${item.id})" title="编辑图标">
            <i class="fa fa-pencil"></i>
          </button>
          <button class="btn btn-secondary btn-icon btn-sm" style="color: var(--danger);" onclick="deleteIcon(${item.id})" title="删除">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function openIconPreview(id) {
  const item = state.icons.find(i => String(i.id) === String(id));
  if (!item) return;
  let finalUrl = item.fndata_Lan || item.fndata_Wan || "";
  if (/^\d+$/.test(finalUrl.trim())) {
    finalUrl = `http://${window.location.hostname}:${finalUrl.trim()}`;
  }
  if (finalUrl) window.open(finalUrl, "_blank");
}

function openAddIconModal() {
  document.getElementById("iconForm").reset();
  document.getElementById("fieldId").value = "";
  document.getElementById("fieldLanPic").value = "";
  document.getElementById("fieldIconDataUrl").value = "";
  document.getElementById("fieldAppname").value = "";
  document.getElementById("editModalTitle").innerHTML = `<i class="fa fa-crop" style="color: var(--accent);"></i> 添加应用图标`;
  
  // 默认不勾选飞牛原生应用注入
  state.editingNative = false;
  document.getElementById("fieldGenerateNative").checked = false;

  state.cropper.image = null;
  state.cropper.isModified = false;
  state.cropper.isExistingIcon = false;
  state.cropper.scale = 1.0;
  state.cropper.panX = 0;
  state.cropper.panY = 0;
  state.cropper.rotation = 0;
  state.cropper.bgColor = "transparent";

  const sel = document.getElementById("dockerSelect");
  if (sel) sel.value = "";

  renderCropCanvas();
  initPaletteDots();
  openModal("editModal");
}

function editIcon(id) {
  const item = state.icons.find(i => String(i.id) === String(id));
  if (!item) return;

  document.getElementById("iconForm").reset();

  document.getElementById("fieldId").value = item.id;
  document.getElementById("fieldTitle").value = item.fndata_Title || "";
  document.getElementById("fieldLan").value = item.fndata_Lan || "";
  document.getElementById("fieldWan").value = item.fndata_Wan || "";
  document.getElementById("fieldOpenInPage").value = item.OpenInPage !== undefined ? item.OpenInPage : 0;
  document.getElementById("fieldProtocol").value = item.fndata_Protocol !== undefined ? item.fndata_Protocol : 0;
  document.getElementById("fieldLanPic").value = item.fndata_LanPic || "";
  document.getElementById("fieldAppname").value = item.appname || "";
  
  // 原生应用复选框：不默认勾选！仅当原本就是原生应用时才勾选
  state.editingNative = Boolean(item.nativeInstalled || item.fnAppicon === 1);
  document.getElementById("fieldGenerateNative").checked = state.editingNative;
  
  document.getElementById("editModalTitle").innerHTML = `<i class="fa fa-crop" style="color: var(--accent);"></i> 编辑应用图标: ${escapeHtml(item.fndata_Title)}`;

  // 回显裁切与底色设置
  const cs = item.cropSettings || {};
  state.cropper.isModified = false;
  state.cropper.isExistingIcon = true;
  state.cropper.scale = cs.scale || 1.0;
  state.cropper.panX = cs.panX || 0;
  state.cropper.panY = cs.panY || 0;
  state.cropper.rotation = cs.rotation || 0;
  state.cropper.bgColor = cs.bgColor || "transparent";

  // 自动匹配已选择的 Docker 容器
  const sel = document.getElementById("dockerSelect");
  if (sel) {
    sel.value = "";
    const matched = state.dockerContainers.find(c =>
      (c.hostPort && String(c.hostPort) === String(item.fndata_Lan)) ||
      (c.name && c.name.toLowerCase() === (item.fndata_Title || "").toLowerCase())
    );
    if (matched) {
      sel.value = matched.name;
    }
  }

  let imgSrc = item.fndata_LanPic || "";
  if (imgSrc.startsWith("/deskdata")) {
    imgSrc = `${API_BASE.replace(/\/api$/, "")}${imgSrc}`;
  }
  loadCropperImage(imgSrc, true /* isExisting */);
  initPaletteDots();
  openModal("editModal");
}

async function deleteIcon(id) {
  if (!confirm("确定要删除该图标吗？若已生成飞牛原生套件将同步从系统卸载。")) return;
  try {
    await fetchApi(`/icons/${id}`, { method: "DELETE" });
    showToast("图标已删除", "success");
    loadIcons();
  } catch (err) {
    showToast("删除失败: " + err.message, "error");
  }
}

// 嗅探抓取 Favicon
async function handleSniffFavicon() {
  const portOrUrl = document.getElementById("fieldLan").value.trim() || document.getElementById("fieldWan").value.trim();
  const title = document.getElementById("fieldTitle").value.trim();
  if (!portOrUrl) {
    return showToast("请先填写局域网端口或访问地址", "error");
  }

  const btn = document.getElementById("btnSniffFavicon");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>抓取中...</span>`;

  try {
    const res = await fetchApi("/fetch-favicon", {
      method: "POST",
      body: JSON.stringify({ url: portOrUrl, title })
    });
    if (res.dataUrl) {
      state.cropper.isModified = true;
      state.cropper.isExistingIcon = false;
      loadCropperImage(res.dataUrl, false);
      showToast("图标探测成功！", "success");
    }
  } catch (err) {
    showToast(err.message || "未能抓取到图标，可直接上传图片", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa fa-globe"></i> <span>抓取 Favicon</span>`;
  }
}

// 保存图标
async function saveIcon() {
  const title = document.getElementById("fieldTitle").value.trim();
  if (!title) return showToast("请输入应用名称", "error");

  const isEdit = Boolean(document.getElementById("fieldId").value);
  const targetId = isEdit ? parseInt(document.getElementById("fieldId").value, 10) : undefined;

  const payload = {
    id: targetId,
    fndata_Title: title,
    fndata_Lan: document.getElementById("fieldLan").value.trim(),
    fndata_Wan: document.getElementById("fieldWan").value.trim(),
    OpenInPage: parseInt(document.getElementById("fieldOpenInPage").value, 10),
    fndata_Protocol: parseInt(document.getElementById("fieldProtocol").value, 10),
    generateNative: document.getElementById("fieldGenerateNative").checked,
    fndata_LanPic: document.getElementById("fieldLanPic").value || "",
    appname: document.getElementById("fieldAppname").value || undefined,
    cropSettings: {
      scale: state.cropper.scale,
      panX: state.cropper.panX,
      panY: state.cropper.panY,
      rotation: state.cropper.rotation,
      bgColor: state.cropper.bgColor
    }
  };

  // 关键：只有当用户新上传/抓取/微调了图标，或者新建图标时，才导出并发送 iconDataUrl
  // 如果是编辑已有图标且未修改图标，直接保留原有图片文件，绝不重新生成覆盖！
  if (!isEdit || state.cropper.isModified || !payload.fndata_LanPic) {
    const canvas = document.getElementById("studioCanvas");
    payload.iconDataUrl = canvas.toDataURL("image/png");
  }

  // 记录原生应用勾选状态是否发生变化，用于保存后自动重挂桌面避免图标重复
  const prevNative = isEdit ? Boolean(state.editingNative) : false;

  const btn = document.getElementById("btnSaveIcon");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>保存中...</span>`;

  try {
    await fetchApi("/icons", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    // 若原生应用注入状态发生切换（无 -> 有），自动重新挂载桌面注入脚本并刷新桌面，
    // 让旧的桌面快捷方式被移除，避免与新建的原生应用图标重复显示。
    if (payload.generateNative !== prevNative) {
      showToast(payload.generateNative
        ? "已生成飞牛原生应用，正在同步移除重复的桌面快捷方式..."
        : "已取消原生应用，正在恢复桌面快捷方式...", "success");
      try {
        await fetchApi("/apply-desktop", { method: "POST" });
      } catch (_) {}
      closeModal("editModal");
      loadIcons();
      setTimeout(() => {
        try {
          if (window.top && window.top !== window) {
            window.top.location.reload();
          } else {
            window.location.reload();
          }
        } catch (_) {
          window.location.reload();
        }
      }, 700);
      return;
    }

    showToast("应用配置保存成功！", "success");
    closeModal("editModal");
    loadIcons();
  } catch (err) {
    showToast("保存失败: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `完成保存`;
  }
}

// ==================== WeTab 桌面卡片组件管理 ====================
async function loadWidgets() {
  try {
    const data = await fetchApi("/widgets");
    state.widgets = data.widgets || [];
    renderWidgets();
    updateStats();
  } catch (err) {
    console.warn("获取卡片小组件失败:", err.message);
  }
}

function renderWidgets() {
  const grid = document.getElementById("widgetAdminGrid");
  if (!grid) return;
  if (state.widgets.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
        <i class="fa fa-cubes" style="font-size: 2.5rem; margin-bottom: 0.8rem; opacity: 0.4;"></i>
        <div>暂未添加桌面卡片，点击上方「添加小组件卡片」丰富你的飞牛桌面</div>
      </div>
    `;
    return;
  }

  const typeLabels = {
    weather: "⛅ 实时天气",
    countdown: "⏳ 倒计时/纪念日",
    clock: "🕒 数字时钟",
    notes: "📝 便签备忘"
  };
  const sizeLabels = {
    small: "小 (1x1)",
    medium: "中 (2x1)",
    large: "大 (2x2)"
  };

  grid.innerHTML = state.widgets.map(w => {
    return `
      <div class="widget-admin-card">
        <div class="widget-admin-top">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="widget-type-badge">${typeLabels[w.type] || w.type}</span>
            <span class="widget-size-tag">${sizeLabels[w.size] || w.size}</span>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-icon btn-xs" onclick="editWidget(${w.id})" title="编辑">
              <i class="fa fa-pencil"></i>
            </button>
            <button class="btn btn-secondary btn-icon btn-xs" style="color: var(--danger);" onclick="deleteWidget(${w.id})" title="删除">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="widget-preview-wrapper">
          ${renderStaticWidgetHtml(w)}
        </div>
      </div>
    `;
  }).join("");
}

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

function renderStaticWidgetHtml(w) {
  const size = w.size || "medium";
  const theme = w.theme || "glass";

  if (w.type === "weather") {
    const city = w.city || "北京";
    if (size === "small") {
      return `
        <div class="wetab-card wetab-card-small theme-${theme}">
          <div class="weather-inner">
            <div class="weather-header"><span>${city}</span><span>⛅</span></div>
            <div class="weather-main"><span class="weather-temp">22°</span><span class="weather-desc">晴间多云</span></div>
            <div class="weather-footer"><span>18°~27°</span><span>湿度 45%</span></div>
          </div>
        </div>
      `;
    } else if (size === "large") {
      return `
        <div class="wetab-card wetab-card-large theme-${theme}">
          <div class="weather-inner" style="gap: 12px;">
            <div class="weather-header" style="font-size: 15px;"><span>${city} 天气概况</span><span style="font-size: 22px;">⛅</span></div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div class="weather-temp" style="font-size: 48px;">22°</div>
              <div style="text-align: right;">
                <div style="font-size: 15px; font-weight: 600;">晴间多云</div>
                <div style="font-size: 12px; opacity: 0.75; margin-top: 4px;">今日 18° ~ 27°</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <div class="weather-pill">💧 湿度: 45%</div>
              <div class="weather-pill">💨 风况: 微风</div>
              <div class="weather-pill">🌡️ 体感: 23°</div>
              <div class="weather-pill">🍃 空气: 优良</div>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="wetab-card wetab-card-medium theme-${theme}">
          <div class="weather-inner" style="flex-direction: row; align-items: center; justify-content: space-between;">
            <div>
              <div class="weather-header" style="margin-bottom: 6px;"><span>${city}</span><span style="margin-left: 6px;">⛅</span></div>
              <div class="weather-main"><span class="weather-temp">22°</span><span class="weather-desc">晴间多云</span></div>
            </div>
            <div class="weather-med-right">
              <span class="weather-pill">🌡️ 18° ~ 27°</span>
              <span class="weather-pill">💧 湿度 45%</span>
              <span class="weather-pill">💨 微风</span>
            </div>
          </div>
        </div>
      `;
    }
  }

  if (w.type === "countdown") {
    const cd = calcCountdown(w.targetDate || "2026-10-01T00:00");
    const targetStr = (w.targetDate || "2026-10-01").split("T")[0];
    if (size === "small") {
      return `
        <div class="wetab-card wetab-card-small theme-${theme}">
          <div class="cd-inner">
            <div class="cd-title">${w.title || "目标倒计时"}</div>
            <div class="cd-center"><span class="cd-days">${cd.days}</span><span class="cd-unit">天</span></div>
            <div class="cd-footer">${cd.isPast ? "已过去" : "倒计时"}</div>
          </div>
        </div>
      `;
    } else if (size === "large") {
      return `
        <div class="wetab-card wetab-card-large theme-${theme}">
          <div class="cd-inner" style="gap: 12px;">
            <div class="weather-header" style="font-size: 15px;">
              <span class="cd-title">${w.title || "目标倒计时"}</span>
              <span style="font-size: 18px;">⏳</span>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin: auto 0;">
              <div style="display: flex; align-items: baseline; gap: 6px;">
                <span class="cd-days" style="font-size: 56px;">${cd.days}</span>
                <span class="cd-unit" style="font-size: 18px;">天</span>
              </div>
              <div class="cd-time-bar" style="margin-top: 8px; font-size: 13px; padding: 4px 12px;">
                ${pad(cd.hours)} 时 ${pad(cd.mins)} 分 ${pad(cd.secs)} 秒
              </div>
            </div>
            <div class="cd-footer" style="text-align: center;">目标: ${targetStr}</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="wetab-card wetab-card-medium theme-${theme}">
          <div class="cd-inner">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="cd-title">${w.title || "目标倒计时"}</div>
              <div style="font-size: 11px; opacity: 0.7;">${cd.isPast ? "已过" : "剩余"}</div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin: auto 0;">
              <div style="display: flex; align-items: baseline; gap: 4px;">
                <span class="cd-days">${cd.days}</span>
                <span class="cd-unit">天</span>
              </div>
              <div class="cd-time-bar">${pad(cd.hours)}:${pad(cd.mins)}:${pad(cd.secs)}</div>
            </div>
            <div class="cd-footer">${targetStr}</div>
          </div>
        </div>
      `;
    }
  }

  if (w.type === "clock") {
    const now = new Date();
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const secStr = pad(now.getSeconds());
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${["日","一","二","三","四","五","六"][now.getDay()]}`;

    if (size === "small") {
      return `
        <div class="wetab-card wetab-card-small theme-${theme}">
          <div class="clock-inner">
            <div class="clock-time">${timeStr}<span class="clock-sec">${secStr}</span></div>
            <div class="clock-date">${dateStr}</div>
          </div>
        </div>
      `;
    } else if (size === "large") {
      return `
        <div class="wetab-card wetab-card-large theme-${theme}">
          <div class="clock-inner" style="justify-content: space-around;">
            <div style="font-size: 14px; opacity: 0.85;">${now.getFullYear()} 年</div>
            <div class="clock-time" style="font-size: 46px;">${timeStr}<span class="clock-sec" style="font-size: 20px;">${secStr}</span></div>
            <div class="clock-date" style="font-size: 14px; font-weight: 600;">${dateStr}</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="wetab-card wetab-card-medium theme-${theme}">
          <div class="clock-inner">
            <div class="clock-time" style="font-size: 38px;">${timeStr}<span class="clock-sec">${secStr}</span></div>
            <div class="clock-date" style="font-size: 13px;">${dateStr}</div>
          </div>
        </div>
      `;
    }
  }

  // notes
  return `
    <div class="wetab-card wetab-card-${size} theme-${theme}">
      <div class="notes-inner" style="padding: 10px;">
        <div class="notes-title">📌 ${w.title || "便签备忘"}</div>
        <div class="notes-content">${w.content || "写下待办事项或灵感备忘..."}</div>
      </div>
    </div>
  `;
}

function openAddWidgetModal() {
  state.widgetForm = {
    id: null,
    type: "weather",
    size: "medium",
    title: "",
    targetDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 16),
    city: "北京",
    theme: "glass",
    style: "digital",
    content: ""
  };
  updateWidgetFormInputs();
  renderWidgetLivePreview();
  openModal("widgetModal");
}

function editWidget(id) {
  const w = state.widgets.find(item => item.id === id);
  if (!w) return;
  state.widgetForm = { ...w };
  updateWidgetFormInputs();
  renderWidgetLivePreview();
  openModal("widgetModal");
}

function updateWidgetFormInputs() {
  const f = state.widgetForm;
  document.getElementById("widgetFieldId").value = f.id || "";
  document.getElementById("fieldWeatherCity").value = f.city || "北京";
  document.getElementById("fieldCdTitle").value = f.title || "";
  document.getElementById("fieldCdDate").value = f.targetDate || "";
  document.getElementById("fieldClockStyle").value = f.style || "digital";
  document.getElementById("fieldNotesTitle").value = f.title || "";
  document.getElementById("fieldNotesContent").value = f.content || "";
  document.getElementById("fieldWidgetTheme").value = f.theme || "glass";

  // 激活类型选择器
  document.querySelectorAll("#widgetTypeSelector .segmented-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === f.type);
  });
  // 激活尺寸选择器
  document.querySelectorAll("#widgetSizeSelector .segmented-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.size === f.size);
  });

  // 切换表单组显隐
  document.getElementById("groupWeather").style.display = f.type === "weather" ? "block" : "none";
  document.getElementById("groupCountdown").style.display = f.type === "countdown" ? "block" : "none";
  document.getElementById("groupClock").style.display = f.type === "clock" ? "block" : "none";
  document.getElementById("groupNotes").style.display = f.type === "notes" ? "block" : "none";
}

function renderWidgetLivePreview() {
  const container = document.getElementById("widgetLivePreviewWrapper");
  container.innerHTML = renderStaticWidgetHtml(state.widgetForm);
}

async function saveWidget() {
  const f = state.widgetForm;
  f.city = document.getElementById("fieldWeatherCity").value.trim();
  f.title = f.type === "countdown" ? document.getElementById("fieldCdTitle").value.trim() : document.getElementById("fieldNotesTitle").value.trim();
  f.targetDate = document.getElementById("fieldCdDate").value;
  f.style = document.getElementById("fieldClockStyle").value;
  f.content = document.getElementById("fieldNotesContent").value.trim();
  f.theme = document.getElementById("fieldWidgetTheme").value;

  try {
    await fetchApi("/widgets", {
      method: "POST",
      body: JSON.stringify(f)
    });
    showToast("小组件卡片已保存！", "success");
    closeModal("widgetModal");
    loadWidgets();
  } catch (err) {
    showToast("保存失败: " + err.message, "error");
  }
}

async function deleteWidget(id) {
  if (!confirm("确定要删除此桌面小组件卡片吗？")) return;
  try {
    await fetchApi(`/widgets/${id}`, { method: "DELETE" });
    showToast("小组件已删除", "success");
    loadWidgets();
  } catch (err) {
    showToast("删除失败: " + err.message, "error");
  }
}

// ==================== Docker 容器嗅探 ====================
async function loadDockerContainers() {
  try {
    const data = await fetchApi("/docker/containers");
    state.dockerContainers = data.containers || [];
    document.getElementById("statDockerContainers").textContent = state.dockerContainers.length;

    const select = document.getElementById("dockerSelect");
    select.innerHTML = '<option value="">-- 选择运行中的 Docker 容器一键填入 --</option>';
    state.dockerContainers.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.name} (${c.hostPort ? `:${c.hostPort}` : "无端口映射"})`;
      select.appendChild(opt);
    });
  } catch (_) {}
}

function handleDockerSelect(e) {
  const name = e.target.value;
  if (!name) return;
  const item = state.dockerContainers.find(c => c.name === name);
  if (!item) return;

  document.getElementById("fieldTitle").value = item.matchedBrand || item.name;
  if (item.hostPort) {
    document.getElementById("fieldLan").value = item.hostPort;
    handleSniffFavicon();
  } else if (item.lanUrl) {
    document.getElementById("fieldLan").value = item.lanUrl;
  }
  if (item.presetDataUrl) {
    loadCropperImage(item.presetDataUrl);
  }
}

// ==================== 统计与辅助 ====================
function updateStats() {
  document.getElementById("statTotalIcons").textContent = state.icons.length;
  document.getElementById("statNativeApps").textContent = state.icons.filter(i => i.nativeInstalled).length;
  document.getElementById("statTotalWidgets").textContent = state.widgets.length;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("active");
  const modalBody = el.querySelector(".modal-body");
  if (modalBody) modalBody.scrollTop = 0;
  const innerModal = el.querySelector(".modal");
  if (innerModal) innerModal.scrollTop = 0;
}
function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

function showLoginModal() {
  openModal("loginModal");
}

// ==================== 初始化事件监听 ====================
document.addEventListener("DOMContentLoaded", () => {
  // 基础数据加载
  loadIcons();
  loadWidgets();
  loadDockerContainers();
  checkDesktopStatus();

  // 顶部操作栏
  document.getElementById("btnApplyDesktop").onclick = applyDesktop;
  document.getElementById("btnRestoreDesktop").onclick = () => openModal("restoreConfirmModal");
  document.getElementById("btnConfirmRestore").onclick = restoreDesktop;
  document.getElementById("btnCancelRestore").onclick = () => closeModal("restoreConfirmModal");
  document.getElementById("btnCloseRestoreModal").onclick = () => closeModal("restoreConfirmModal");


  document.getElementById("btnSettings").onclick = () => openModal("settingsModal");
  document.getElementById("btnCloseSettings").onclick = () => closeModal("settingsModal");
  document.getElementById("btnCancelSettings").onclick = () => closeModal("settingsModal");

  // 主视图 Tab 切换
  document.querySelectorAll("#mainTabs .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#mainTabs .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("tabViewIcons").style.display = tab === "icons" ? "block" : "none";
      document.getElementById("tabViewWidgets").style.display = tab === "widgets" ? "block" : "none";
    };
  });

  // 添加图标
  document.getElementById("btnAddIcon").onclick = openAddIconModal;
  document.getElementById("btnCloseEditModal").onclick = () => closeModal("editModal");
  document.getElementById("btnCancelEdit").onclick = () => closeModal("editModal");
  document.getElementById("btnSaveIcon").onclick = saveIcon;

  // 添加卡片小组件
  document.getElementById("btnAddWidget").onclick = openAddWidgetModal;
  document.getElementById("btnAddNewWidget").onclick = openAddWidgetModal;
  document.getElementById("btnCloseWidgetModal").onclick = () => closeModal("widgetModal");
  document.getElementById("btnCancelWidget").onclick = () => closeModal("widgetModal");
  document.getElementById("btnSaveWidget").onclick = saveWidget;

  // 小组件类型与尺寸切换
  document.querySelectorAll("#widgetTypeSelector .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      state.widgetForm.type = btn.dataset.type;
      updateWidgetFormInputs();
      renderWidgetLivePreview();
    };
  });
  document.querySelectorAll("#widgetSizeSelector .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      state.widgetForm.size = btn.dataset.size;
      updateWidgetFormInputs();
      renderWidgetLivePreview();
    };
  });
  document.getElementById("fieldWidgetTheme").onchange = e => {
    state.widgetForm.theme = e.target.value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldWeatherCity").oninput = e => {
    state.widgetForm.city = e.target.value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldCdTitle").oninput = e => {
    state.widgetForm.title = e.target.value;
    renderWidgetLivePreview();
  };

  // 图标工坊与 Favicon 抓取
  document.getElementById("btnSniffFavicon").onclick = handleSniffFavicon;
  document.getElementById("dockerSelect").onchange = handleDockerSelect;

  document.getElementById("btnUploadLocal").onclick = () => {
    document.getElementById("localFileInput").click();
  };
  document.getElementById("localFileInput").onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadCropperImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  // 搜索与过滤
  document.getElementById("searchInput").oninput = e => {
    state.searchKeyword = e.target.value;
    renderIcons();
  };
  document.querySelectorAll("#filterSegment .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#filterSegment .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeFilter = btn.dataset.filter;
      renderIcons();
    };
  });

  // 小组件表单实时响应预览
  document.getElementById("fieldCdDate").oninput = () => {
    state.widgetForm.targetDate = document.getElementById("fieldCdDate").value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldClockStyle").onchange = () => {
    state.widgetForm.style = document.getElementById("fieldClockStyle").value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldNotesTitle").oninput = () => {
    state.widgetForm.title = document.getElementById("fieldNotesTitle").value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldNotesContent").oninput = () => {
    state.widgetForm.content = document.getElementById("fieldNotesContent").value;
    renderWidgetLivePreview();
  };

  // 局域网输入框失去焦点时智能自动探测 Favicon
  document.getElementById("fieldLan").addEventListener("blur", () => {
    const val = document.getElementById("fieldLan").value.trim();
    if (val && !state.cropper.image) {
      handleSniffFavicon();
    }
  });

  // 刷新按钮增强
  document.getElementById("btnRefresh").onclick = async () => {
    const icon = document.getElementById("refreshIcon");
    if (icon) icon.classList.add("spin");
    try {
      await Promise.all([
        loadIcons(),
        loadWidgets(),
        loadDockerContainers(),
        checkDesktopStatus()
      ]);
      showToast("数据已刷新", "success");
    } catch (e) {
      showToast("刷新数据: " + (e.message || "已同步"), "info");
    } finally {
      if (icon) icon.classList.remove("spin");
    }
  };

  // 挂载全局方法确保 inline onclick 100% 可调用
  window.editIcon = editIcon;
  window.deleteIcon = deleteIcon;
  window.editWidget = editWidget;
  window.deleteWidget = deleteWidget;

  // 初始化画布拖拽平移与滚轮缩放事件
  initCanvasEvents();

  // 支持 URL 参数直达 Tab 或弹窗（便于联动与自动化测试）
  const params = new URLSearchParams(window.location.search);
  if (params.get("tab") === "widgets") {
    const wBtn = document.querySelector('button[data-tab="widgets"]');
    if (wBtn) wBtn.click();
  }
  if (params.get("modal") === "edit") {
    openAddIconModal();
  } else if (params.get("modal") === "widget") {
    openAddWidgetModal();
  }
});
