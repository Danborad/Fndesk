// ==================== Fndesk Lite 前端核心交互逻辑 ====================

(function() {
  'use strict';

  // 全局应用状态
  const state = {
    icons: [],
    dockerContainers: [],
    filter: 'all',
    searchQuery: '',
    token: localStorage.getItem('fndesk_token') || '',
    hasPassword: false,
    currentIcon: null,
    // 图标工坊设计状态
    studio: {
      sourceImg: null,
      shape: 'squircle',      // squircle, round, circle, none
      scale: 0.85,
      padding: 0.12,
      bgMode: 'color',        // color, gradient, transparent
      solidColor: '#1e293b',
      gradColor1: '#3b82f6',
      gradColor2: '#8b5cf6',
      gradAngle: 135,
      hasShadow: true,
      roundRadius: 96,
      currentExportDataUrl: null
    }
  };

  // DOM 元素引用
  const dom = {
    iconGrid: document.getElementById('iconGrid'),
    statTotalIcons: document.getElementById('statTotalIcons'),
    statNativeApps: document.getElementById('statNativeApps'),
    statDockerContainers: document.getElementById('statDockerContainers'),
    searchInput: document.getElementById('searchInput'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    btnAddIcon: document.getElementById('btnAddIcon'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnSettings: document.getElementById('btnSettings'),
    btnLogout: document.getElementById('btnLogout'),
    
    // 图标编辑模态框
    editModal: document.getElementById('editModal'),
    editModalTitle: document.getElementById('editModalTitle'),
    btnCloseEditModal: document.getElementById('btnCloseEditModal'),
    btnCancelEdit: document.getElementById('btnCancelEdit'),
    btnSaveIcon: document.getElementById('btnSaveIcon'),
    dockerSelect: document.getElementById('dockerSelect'),
    formIconPreview: document.getElementById('formIconPreview'),
    btnSniffFavicon: document.getElementById('btnSniffFavicon'),
    btnUploadLocal: document.getElementById('btnUploadLocal'),
    localFileInput: document.getElementById('localFileInput'),
    btnOpenStudio: document.getElementById('btnOpenStudio'),

    // 表单字段
    fieldId: document.getElementById('fieldId'),
    fieldTitle: document.getElementById('fieldTitle'),
    fieldLan: document.getElementById('fieldLan'),
    fieldWan: document.getElementById('fieldWan'),
    fieldLanPic: document.getElementById('fieldLanPic'),
    fieldOpenInPage: document.getElementById('fieldOpenInPage'),
    fieldProtocol: document.getElementById('fieldProtocol'),
    fieldIconDataUrl: document.getElementById('fieldIconDataUrl'),
    fieldAppname: document.getElementById('fieldAppname'),
    fieldFnAppicon: document.getElementById('fieldFnAppicon'),

    // 图标工坊模态框
    studioModal: document.getElementById('studioModal'),
    btnCloseStudio: document.getElementById('btnCloseStudio'),
    btnCancelStudio: document.getElementById('btnCancelStudio'),
    btnApplyStudio: document.getElementById('btnApplyStudio'),
    studioCanvas: document.getElementById('studioCanvas'),
    mockupIconImg: document.getElementById('mockupIconImg'),
    mockupTitle: document.getElementById('mockupTitle'),
    shapeButtons: document.querySelectorAll('#shapeSelector .segmented-btn'),
    bgModeButtons: document.querySelectorAll('#bgModeSelector .segmented-btn'),
    sliderScale: document.getElementById('sliderScale'),
    valScale: document.getElementById('valScale'),
    sliderPadding: document.getElementById('sliderPadding'),
    valPadding: document.getElementById('valPadding'),
    solidBgControls: document.getElementById('solidBgControls'),
    gradientBgControls: document.getElementById('gradientBgControls'),
    solidColorPicker: document.getElementById('solidColorPicker'),
    solidColorHex: document.getElementById('solidColorHex'),
    gradColor1: document.getElementById('gradColor1'),
    gradColor2: document.getElementById('gradColor2'),
    gradAngle: document.getElementById('gradAngle'),
    checkLogoShadow: document.getElementById('checkLogoShadow'),
    btnApplyAppleStyle: document.getElementById('btnApplyAppleStyle'),
    btnApplyCircleStyle: document.getElementById('btnApplyCircleStyle'),

    // 设置与登录模态框
    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnCancelSettings: document.getElementById('btnCancelSettings'),
    btnSavePassword: document.getElementById('btnSavePassword'),
    oldPassword: document.getElementById('oldPassword'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword'),
    oldPasswordGroup: document.getElementById('oldPasswordGroup'),

    loginModal: document.getElementById('loginModal'),
    loginPassword: document.getElementById('loginPassword'),
    btnSubmitLogin: document.getElementById('btnSubmitLogin'),
    toastContainer: document.getElementById('toastContainer')
  };

  // ==================== 1. 网络请求包装 ====================
  async function api(path, options = {}) {
    const headers = options.headers || {};
    if (state.token) {
      headers['x-auth-token'] = state.token;
      headers['Authorization'] = 'Bearer ' + state.token;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    try {
      const res = await fetch(path, { ...options, headers });
      if (res.status === 401) {
        openLoginModal();
        throw new Error('未授权或登录已过期');
      }
      const data = await res.json();
      return data;
    } catch (e) {
      console.warn(`[API] ${path} 请求异常:`, e.message);
      throw e;
    }
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-triangle';
    toast.innerHTML = `<i class="fa ${icon}"></i><span>${message}</span>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // ==================== 2. 初始化与认证 ====================
  async function init() {
    bindEvents();
    initStudioCanvas();
    
    try {
      const status = await api('/api/status');
      state.hasPassword = status.hasPassword;
      if (status.hasPassword && !state.token) {
        openLoginModal();
        return;
      }
      if (status.hasPassword) {
        dom.btnLogout.style.display = 'inline-flex';
      }
    } catch (_) {}

    await refreshAll();
  }

  async function refreshAll() {
    await Promise.all([loadIcons(), loadDockerContainers()]);
  }

  async function loadIcons() {
    try {
      const res = await api('/api/icons');
      if (res.success && Array.isArray(res.icons)) {
        state.icons = res.icons;
        renderIconGrid();
        updateStats();
      }
    } catch (e) {
      showToast('加载图标列表失败: ' + e.message, 'error');
    }
  }

  async function loadDockerContainers() {
    try {
      const res = await api('/api/docker/containers');
      if (res.success && Array.isArray(res.containers)) {
        state.dockerContainers = res.containers;
        populateDockerSelect();
        dom.statDockerContainers.textContent = state.dockerContainers.length;
      }
    } catch (e) {
      dom.statDockerContainers.textContent = '-';
    }
  }

  function updateStats() {
    dom.statTotalIcons.textContent = state.icons.length;
    const nativeCount = state.icons.filter(i => i.nativeInstalled).length;
    dom.statNativeApps.textContent = nativeCount;
  }

  // 渲染图标网格
  function renderIconGrid() {
    dom.iconGrid.innerHTML = '';

    let filtered = state.icons;
    if (state.filter === 'native') {
      filtered = filtered.filter(i => i.nativeInstalled);
    } else if (state.filter === 'shortcut') {
      filtered = filtered.filter(i => !i.nativeInstalled);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(i => 
        (i.fndata_Title && i.fndata_Title.toLowerCase().includes(q)) ||
        (i.fndata_Lan && String(i.fndata_Lan).includes(q)) ||
        (i.fndata_Wan && i.fndata_Wan.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      dom.iconGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
          <i class="fa fa-folder-open-o" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.4;"></i>
          <p>暂无符合条件的应用图标，点击右上角「添加新图标」开始创建</p>
        </div>
      `;
      return;
    }

    filtered.forEach(item => {
      const card = createIconCard(item);
      dom.iconGrid.appendChild(card);
    });
  }

  function createIconCard(item) {
    const card = document.createElement('div');
    card.className = 'icon-card';

    const imgSrc = item.fndata_LanPic || 'static/icon.png';
    const isNative = Boolean(item.nativeInstalled);
    const openModeText = item.OpenInPage === 1 ? '窗口页内' : '新标签页';
    const urlDisplay = item.fndata_Lan ? (item.fndata_Lan.startsWith('http') ? item.fndata_Lan : `:${item.fndata_Lan}`) : (item.fndata_Wan || '/');

    card.innerHTML = `
      <div>
        <div class="icon-card-header">
          <div class="icon-img-box">
            <img src="${imgSrc}" alt="${item.fndata_Title}" onerror="this.src='static/icon.png'">
          </div>
          <div class="icon-info">
            <div class="icon-title" title="${item.fndata_Title}">${item.fndata_Title}</div>
            <div class="icon-url-tag" title="${urlDisplay}">
              <i class="fa fa-link"></i> ${urlDisplay}
            </div>
          </div>
        </div>

        <div class="icon-badges">
          <span class="badge ${isNative ? 'badge-native-installed' : 'badge-native-none'}">
            <i class="fa ${isNative ? 'fa-check' : 'fa-minus'}"></i>
            ${isNative ? '飞牛原生应用' : '仅桌面快捷方式'}
          </span>
          <span class="badge badge-mode">
            <i class="fa ${item.OpenInPage === 1 ? 'fa-window-maximize' : 'fa-external-link'}"></i>
            ${openModeText}
          </span>
        </div>
      </div>

      <div class="icon-card-actions">
        <div>
          ${isNative ? `
            <button class="btn btn-danger btn-sm btn-action-uninstall" title="卸载原生APP">
              <i class="fa fa-trash-o"></i> 卸载原生
            </button>
          ` : `
            <button class="btn btn-success btn-sm btn-action-native" title="生成飞牛原生APP">
              <i class="fa fa-bolt"></i> 生成原生
            </button>
          `}
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm btn-action-edit" title="编辑图标信息">
            <i class="fa fa-pencil"></i> 编辑
          </button>
          <button class="btn btn-secondary btn-sm btn-action-studio" title="使用图标工坊重制图标">
            <i class="fa fa-paint-brush"></i>
          </button>
          <button class="btn btn-secondary btn-sm btn-action-delete" title="删除记录" style="color:#f87171;">
            <i class="fa fa-times"></i>
          </button>
        </div>
      </div>
    `;

    // 绑定卡片操作
    const btnNative = card.querySelector('.btn-action-native');
    if (btnNative) {
      btnNative.onclick = () => handleGenerateNative(item);
    }
    const btnUninstall = card.querySelector('.btn-action-uninstall');
    if (btnUninstall) {
      btnUninstall.onclick = () => handleUninstallNative(item);
    }
    card.querySelector('.btn-action-edit').onclick = () => openEditModal(item);
    card.querySelector('.btn-action-studio').onclick = () => {
      openEditModal(item);
      openStudioModal();
    };
    card.querySelector('.btn-action-delete').onclick = () => handleDeleteIcon(item);

    return card;
  }

  // 填充 Docker 快捷导入下拉列表
  function populateDockerSelect() {
    dom.dockerSelect.innerHTML = '<option value="">-- 选择运行中的 Docker 容器一键填入 --</option>';
    state.dockerContainers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(c);
      opt.textContent = `${c.name} (${c.hostPort ? `端口: ${c.hostPort}` : '无外部映射'}) - ${c.image}`;
      dom.dockerSelect.appendChild(opt);
    });
  }

  // ==================== 3. 模态框操作 ====================
  function openEditModal(item = null) {
    state.currentIcon = item;
    dom.dockerSelect.value = '';

    if (item) {
      dom.editModalTitle.innerHTML = '<i class="fa fa-pencil-square-o"></i> 编辑应用图标';
      dom.fieldId.value = item.id;
      dom.fieldTitle.value = item.fndata_Title || '';
      dom.fieldLan.value = item.fndata_Lan || '';
      dom.fieldWan.value = item.fndata_Wan || '';
      dom.fieldLanPic.value = item.fndata_LanPic || '';
      dom.fieldOpenInPage.value = item.OpenInPage || 0;
      dom.fieldProtocol.value = item.fndata_Protocol || 0;
      dom.fieldAppname.value = item.appname || '';
      dom.fieldFnAppicon.value = item.fnAppicon || 0;
      dom.formIconPreview.src = item.fndata_LanPic || 'static/icon.png';
      dom.fieldIconDataUrl.value = '';
    } else {
      dom.editModalTitle.innerHTML = '<i class="fa fa-plus-circle"></i> 添加应用图标';
      dom.fieldId.value = '';
      dom.fieldTitle.value = '';
      dom.fieldLan.value = '';
      dom.fieldWan.value = '';
      dom.fieldLanPic.value = '';
      dom.fieldOpenInPage.value = '0';
      dom.fieldProtocol.value = '0';
      dom.fieldAppname.value = '';
      dom.fieldFnAppicon.value = '0';
      dom.formIconPreview.src = 'static/icon.png';
      dom.fieldIconDataUrl.value = '';
    }

    dom.editModal.classList.add('active');
  }

  function closeEditModal() {
    dom.editModal.classList.remove('active');
  }

  function openLoginModal() {
    dom.loginPassword.value = '';
    dom.loginModal.classList.add('active');
  }

  function closeLoginModal() {
    dom.loginModal.classList.remove('active');
  }

  // ==================== 4. 专业图标工坊 (Icon Studio Canvas Engine) ====================
  function initStudioCanvas() {
    // 调色板预设绑定
    document.querySelectorAll('#palettePreset .color-swatch').forEach(swatch => {
      swatch.onclick = () => {
        const c = swatch.dataset.color;
        dom.solidColorPicker.value = c;
        dom.solidColorHex.textContent = c;
        state.studio.solidColor = c;
        renderStudio();
      };
    });

    document.querySelectorAll('#gradientBgControls .color-swatch').forEach(swatch => {
      swatch.onclick = () => {
        const [c1, c2] = swatch.dataset.grad.split(',');
        dom.gradColor1.value = c1;
        dom.gradColor2.value = c2;
        state.studio.gradColor1 = c1;
        state.studio.gradColor2 = c2;
        renderStudio();
      };
    });
  }

  function openStudioModal() {
    // 载入当前表单中的标题与现有图标
    dom.mockupTitle.textContent = dom.fieldTitle.value.trim() || '应用名称';
    const currentSrc = dom.fieldIconDataUrl.value || dom.formIconPreview.src || 'static/icon.png';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      state.studio.sourceImg = img;
      renderStudio();
      dom.studioModal.classList.add('active');
    };
    img.onerror = () => {
      state.studio.sourceImg = null;
      renderStudio();
      dom.studioModal.classList.add('active');
    };
    img.src = currentSrc;
  }

  function closeStudioModal() {
    dom.studioModal.classList.remove('active');
  }

  // 核心 Canvas 渲染算法（512x512 超高清绘制）
  function renderStudio() {
    const canvas = dom.studioCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    // 1. 形状遮罩裁剪路径
    createMaskPath(ctx, 0, 0, width, height, state.studio.shape);
    ctx.clip();

    // 2. 绘制底色
    if (state.studio.bgMode === 'color') {
      ctx.fillStyle = state.studio.solidColor;
      ctx.fillRect(0, 0, width, height);
    } else if (state.studio.bgMode === 'gradient') {
      const angleRad = (parseInt(state.studio.gradAngle, 10) * Math.PI) / 180;
      const x1 = width / 2 - Math.cos(angleRad) * (width / 2);
      const y1 = height / 2 - Math.sin(angleRad) * (height / 2);
      const x2 = width / 2 + Math.cos(angleRad) * (width / 2);
      const y2 = height / 2 + Math.sin(angleRad) * (height / 2);

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, state.studio.gradColor1);
      grad.addColorStop(1, state.studio.gradColor2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
    // transparent 模式保持背景透明

    // 3. 绘制内部 Logo 图形
    if (state.studio.sourceImg) {
      const padding = width * state.studio.padding;
      const innerSize = (width - padding * 2) * state.studio.scale;
      const x = (width - innerSize) / 2;
      const y = (height - innerSize) / 2;

      ctx.save();
      // 如果开启立体投影且不是透明背景，给 Logo 添加平滑阴影
      if (state.studio.hasShadow && state.studio.bgMode !== 'transparent') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 8;
      }

      ctx.drawImage(state.studio.sourceImg, x, y, innerSize, innerSize);
      ctx.restore();
    }

    ctx.restore();

    // 导出并刷新桌面实景预览
    const dataUrl = canvas.toDataURL('image/png');
    state.studio.currentExportDataUrl = dataUrl;
    dom.mockupIconImg.src = dataUrl;
  }

  // 形状遮罩：苹果 Squircle 超椭圆平滑算法
  function createMaskPath(ctx, x, y, w, h, shape) {
    ctx.beginPath();
    if (shape === 'none') {
      ctx.rect(x, y, w, h);
    } else if (shape === 'circle') {
      ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
    } else if (shape === 'round') {
      const r = state.studio.roundRadius;
      ctx.roundRect(x, y, w, h, r);
    } else if (shape === 'squircle') {
      // 仿苹果连续曲率超椭圆（基于三次贝塞尔曲线的高拟合苹果 squircle）
      const r = w * 0.225; // 最佳苹果圆角比率
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
  }

  // ==================== 5. 事件绑定 ====================
  function bindEvents() {
    // 搜索与过滤
    dom.searchInput.addEventListener('input', e => {
      state.searchQuery = e.target.value.trim();
      renderIconGrid();
    });

    dom.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        dom.filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.filter = tab.dataset.filter;
        renderIconGrid();
      });
    });

    dom.btnAddIcon.onclick = () => openEditModal();
    dom.btnRefresh.onclick = () => {
      showToast('正在刷新...', 'info');
      refreshAll();
    };

    // 设置与退出
    dom.btnSettings.onclick = () => {
      dom.oldPassword.value = '';
      dom.newPassword.value = '';
      dom.confirmPassword.value = '';
      dom.oldPasswordGroup.style.display = state.hasPassword ? 'block' : 'none';
      dom.settingsModal.classList.add('active');
    };
    dom.btnCloseSettings.onclick = () => dom.settingsModal.classList.remove('active');
    dom.btnCancelSettings.onclick = () => dom.settingsModal.classList.remove('active');

    dom.btnSavePassword.onclick = async () => {
      const np = dom.newPassword.value;
      const cp = dom.confirmPassword.value;
      if (!np) return showToast('新密码不能为空', 'error');
      if (np !== cp) return showToast('两次输入的密码不一致', 'error');

      try {
        const res = await api('/api/change-password', {
          method: 'POST',
          body: { oldPassword: dom.oldPassword.value, newPassword: np }
        });
        if (res.success) {
          showToast('密码更新成功', 'success');
          state.hasPassword = true;
          dom.settingsModal.classList.remove('active');
        } else {
          showToast(res.message || '更新失败', 'error');
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    dom.btnLogout.onclick = () => {
      localStorage.removeItem('fndesk_token');
      state.token = '';
      location.reload();
    };

    // 登录确认
    dom.btnSubmitLogin.onclick = async () => {
      const pw = dom.loginPassword.value;
      try {
        const res = await api('/api/login', {
          method: 'POST',
          body: { password: pw }
        });
        if (res.success && res.token) {
          state.token = res.token;
          localStorage.setItem('fndesk_token', res.token);
          closeLoginModal();
          showToast('登录成功', 'success');
          dom.btnLogout.style.display = 'inline-flex';
          refreshAll();
        } else {
          showToast(res.message || '登录失败', 'error');
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    // 编辑弹窗
    dom.btnCloseEditModal.onclick = closeEditModal;
    dom.btnCancelEdit.onclick = closeEditModal;

    // Docker 导入联动
    dom.dockerSelect.addEventListener('change', () => {
      if (!dom.dockerSelect.value) return;
      try {
        const c = JSON.parse(dom.dockerSelect.value);
        if (!dom.fieldTitle.value) {
          // 清理容器名字前的斜杠与破折号
          dom.fieldTitle.value = c.name.replace(/^\//, '').replace(/[-_]/g, ' ');
        }
        if (c.hostPort) {
          dom.fieldLan.value = c.hostPort;
          // 自动触发一次 Favicon 嗅探
          triggerFaviconSniff(c.hostPort);
        }
      } catch (_) {}
    });

    // 抓取 Favicon 按钮
    dom.btnSniffFavicon.onclick = () => {
      const target = dom.fieldLan.value.trim() || dom.fieldWan.value.trim();
      if (!target) {
        return showToast('请先输入访问端口或地址', 'error');
      }
      triggerFaviconSniff(target);
    };

    // 本地上传图片
    dom.btnUploadLocal.onclick = () => dom.localFileInput.click();
    dom.localFileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = evt => {
        const dataUrl = evt.target.result;
        dom.formIconPreview.src = dataUrl;
        dom.fieldIconDataUrl.value = dataUrl;
        showToast('图片载入成功，可打开图标工坊做进一步设计', 'success');
      };
      reader.readAsDataURL(file);
    });

    // 打开图标工坊
    dom.btnOpenStudio.onclick = openStudioModal;
    dom.btnCloseStudio.onclick = closeStudioModal;
    dom.btnCancelStudio.onclick = closeStudioModal;

    // 工坊控制：形状选择
    dom.shapeButtons.forEach(btn => {
      btn.onclick = () => {
        dom.shapeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.studio.shape = btn.dataset.shape;
        renderStudio();
      };
    });

    // 工坊控制：底色模式
    dom.bgModeButtons.forEach(btn => {
      btn.onclick = () => {
        dom.bgModeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.studio.bgMode = btn.dataset.bg;
        dom.solidBgControls.style.display = state.studio.bgMode === 'color' ? 'block' : 'none';
        dom.gradientBgControls.style.display = state.studio.bgMode === 'gradient' ? 'block' : 'none';
        renderStudio();
      };
    });

    // 工坊控制：滑块与拾色器
    dom.sliderScale.addEventListener('input', e => {
      state.studio.scale = parseInt(e.target.value, 10) / 100;
      dom.valScale.textContent = e.target.value + '%';
      renderStudio();
    });

    dom.sliderPadding.addEventListener('input', e => {
      state.studio.padding = parseInt(e.target.value, 10) / 100;
      dom.valPadding.textContent = e.target.value + '%';
      renderStudio();
    });

    dom.solidColorPicker.addEventListener('input', e => {
      state.studio.solidColor = e.target.value;
      dom.solidColorHex.textContent = e.target.value;
      renderStudio();
    });

    dom.gradColor1.addEventListener('input', e => {
      state.studio.gradColor1 = e.target.value;
      renderStudio();
    });
    dom.gradColor2.addEventListener('input', e => {
      state.studio.gradColor2 = e.target.value;
      renderStudio();
    });
    dom.gradAngle.addEventListener('change', e => {
      state.studio.gradAngle = e.target.value;
      renderStudio();
    });

    dom.checkLogoShadow.addEventListener('change', e => {
      state.studio.hasShadow = e.target.checked;
      renderStudio();
    });

    // 快捷风格
    dom.btnApplyAppleStyle.onclick = () => {
      state.studio.shape = 'squircle';
      state.studio.scale = 0.82;
      state.studio.padding = 0.12;
      state.studio.hasShadow = true;
      dom.sliderScale.value = 82;
      dom.valScale.textContent = '82%';
      dom.sliderPadding.value = 12;
      dom.valPadding.textContent = '12%';
      dom.checkLogoShadow.checked = true;
      dom.shapeButtons.forEach(b => b.classList.toggle('active', b.dataset.shape === 'squircle'));
      renderStudio();
    };

    dom.btnApplyCircleStyle.onclick = () => {
      state.studio.shape = 'circle';
      state.studio.scale = 0.85;
      state.studio.padding = 0.15;
      state.studio.hasShadow = true;
      dom.sliderScale.value = 85;
      dom.valScale.textContent = '85%';
      dom.sliderPadding.value = 15;
      dom.valPadding.textContent = '15%';
      dom.checkLogoShadow.checked = true;
      dom.shapeButtons.forEach(b => b.classList.toggle('active', b.dataset.shape === 'circle'));
      renderStudio();
    };

    // 应用工坊编辑
    dom.btnApplyStudio.onclick = () => {
      if (state.studio.currentExportDataUrl) {
        dom.formIconPreview.src = state.studio.currentExportDataUrl;
        dom.fieldIconDataUrl.value = state.studio.currentExportDataUrl;
        showToast('图标工坊定制设计已应用！', 'success');
      }
      closeStudioModal();
    };

    // 保存图标表单
    dom.btnSaveIcon.onclick = handleSaveIcon;
  }

  // 嗅探 Favicon 处理
  async function triggerFaviconSniff(targetUrl) {
    showToast('正在探测并抓取高清图标...', 'info');
    try {
      const res = await api('/api/fetch-favicon', {
        method: 'POST',
        body: { url: targetUrl }
      });
      if (res.success && res.dataUrl) {
        dom.formIconPreview.src = res.dataUrl;
        dom.fieldIconDataUrl.value = res.dataUrl;
        showToast('成功获取图标！可点击「打开图标工坊」加平滑圆角与底色', 'success');
      }
    } catch (e) {
      showToast('未能获取到图标，可手动上传本地图片', 'error');
    }
  }

  // 保存图标数据
  async function handleSaveIcon() {
    const title = dom.fieldTitle.value.trim();
    if (!title) return showToast('请输入图标标题', 'error');

    const payload = {
      id: dom.fieldId.value || undefined,
      fndata_Title: title,
      fndata_Lan: dom.fieldLan.value.trim(),
      fndata_Wan: dom.fieldWan.value.trim(),
      fndata_LanPic: dom.fieldLanPic.value,
      OpenInPage: parseInt(dom.fieldOpenInPage.value, 10),
      fndata_Protocol: parseInt(dom.fieldProtocol.value, 10),
      iconDataUrl: dom.fieldIconDataUrl.value || undefined,
      appname: dom.fieldAppname.value || undefined,
      fnAppicon: parseInt(dom.fieldFnAppicon.value || 0, 10)
    };

    try {
      const res = await api('/api/icons', {
        method: 'POST',
        body: payload
      });
      if (res.success) {
        showToast('图标配置保存成功', 'success');
        closeEditModal();
        loadIcons();
      }
    } catch (e) {
      showToast('保存失败: ' + e.message, 'error');
    }
  }

  // 生成飞牛原生应用
  async function handleGenerateNative(item) {
    if (!confirm(`确定为「${item.fndata_Title}」生成飞牛原生应用吗？\n生成后将直接在飞牛桌面与应用中心显示。`)) {
      return;
    }

    showToast(`正在生成原生应用「${item.fndata_Title}」...`, 'info');
    try {
      const res = await api('/api/generate-native', {
        method: 'POST',
        body: item
      });
      if (res.success) {
        showToast('飞牛原生应用已成功生成并注册！', 'success');
        loadIcons();
      }
    } catch (e) {
      showToast('生成失败: ' + e.message, 'error');
    }
  }

  // 卸载飞牛原生应用
  async function handleUninstallNative(item) {
    if (!confirm(`确定从飞牛系统中卸载「${item.fndata_Title}」原生应用吗？\n（这不会影响原有的 Docker 服务或配置）`)) {
      return;
    }

    showToast(`正在卸载「${item.fndata_Title}」原生应用...`, 'info');
    try {
      const res = await api('/api/uninstall-native', {
        method: 'POST',
        body: { id: item.id, appname: item.appname }
      });
      if (res.success) {
        showToast('原生应用已干净卸载', 'success');
        loadIcons();
      }
    } catch (e) {
      showToast('卸载失败: ' + e.message, 'error');
    }
  }

  // 删除图标记录
  async function handleDeleteIcon(item) {
    const isNative = Boolean(item.nativeInstalled);
    const tip = isNative 
      ? `确定要删除图标「${item.fndata_Title}」吗？\n该图标已安装原生APP，删除将同时从飞牛应用中心卸载！`
      : `确定要删除图标「${item.fndata_Title}」吗？`;

    if (!confirm(tip)) return;

    try {
      const res = await api(`/api/icons/${item.id}?uninstall=${isNative ? '1' : '0'}`, {
        method: 'DELETE'
      });
      if (res.success) {
        showToast('图标已删除', 'success');
        loadIcons();
      }
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error');
    }
  }

  // 启动应用
  document.addEventListener('DOMContentLoaded', init);

})();
