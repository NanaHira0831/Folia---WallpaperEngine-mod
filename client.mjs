// ===========================================================================
// Wallpaper Engine 原生壁纸 · Folia 模组 · client 入口
// 版权所有 (C) 2026 NaLuna。保留所有权利。
// 未经作者书面许可，禁止转载、二次分发、收费（含付费下载/打赏解锁/商业用途）、
// 修改后发布或去除署名。完整条款见同目录的「使用条款.txt」。
// ===========================================================================

// Wallpaper Engine 原生壁纸 · client 入口
//
// 注册一个**背景类型**「Wallpaper Engine 原生」，和内置的「通用 / 莫奈 / …」并排出现在
// 背景选择器里。选中它 = 让主进程驱动 WE 开一个壁纸窗口、压在 Folia 下面跟随；
// 切走 = 关掉那个窗口。本身不画任何东西（透明），所以需要 Folia 的「透明化」才能看见。

const STORAGE_KEY = 'selected';
const ENABLED_KEY = 'enabled';

function L(label, locale) {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label[locale] || label.en || label['zh-CN'] || Object.values(label).find(Boolean) || '';
}

function guessLocale() {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return String(lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

const T = {
  background: { 'zh-CN': 'Wallpaper Engine 原生', en: 'Wallpaper Engine native' },
  previewHint: {
    'zh-CN': 'WE 原生壁纸在播放页生效（这里只是预览）',
    en: 'WE native wallpaper runs on the player page (this is a preview)',
  },
  needTransparency: {
    'zh-CN': '开启后：命令面板搜「透明化」并打开——它会重建窗口（正常现象）。不开透明 = 看不到壁纸。',
    en: 'After enabling: open "Transparency" in the command palette — it rebuilds the window (normal). Without it the wallpaper stays hidden.',
  },
  info: { 'zh-CN': '壁纸', en: 'Wallpaper' },
  weMissing: { 'zh-CN': '没找到 Wallpaper Engine 安装', en: 'Wallpaper Engine not found' },
  active: { 'zh-CN': 'WE 当前壁纸：', en: 'WE current: ' },
  library: { 'zh-CN': '壁纸库（点一下选用）', en: 'Library (click to pick)' },
  count: { 'zh-CN': ' 个', en: ' items' },
  enable: { 'zh-CN': '启用', en: 'Enable' },
  disable: { 'zh-CN': '停用', en: 'Disable' },
  running: { 'zh-CN': '运行中', en: 'Running' },
  stopped: { 'zh-CN': '未运行（选中本背景时会自动开启）', en: 'Stopped (auto-starts when this background is active)' },
  working: { 'zh-CN': '处理中…', en: 'Working…' },
  err: { 'zh-CN': '出错：', en: 'Error: ' },
  refresh: { 'zh-CN': '刷新', en: 'Refresh' },
  transparent: { 'zh-CN': '透明化', en: 'Transparency' },
  transparentOn: { 'zh-CN': '透明已开（能看到壁纸）', en: 'Transparent (wallpaper visible)' },
  transparentOff: { 'zh-CN': '未开透明，点一下开启', en: 'Opaque — click to enable' },
  transparentHint: {
    'zh-CN': '开启会重建 Folia 窗口（正常现象），壁纸会自动重新跟上。',
    en: 'Enabling rebuilds the Folia window (normal); the wallpaper re-attaches automatically.',
  },
  unsupportedHidden: { 'zh-CN': '已隐藏 {n} 个不支持的类型', en: '{n} unsupported hidden' },
  quitWeLabel: { 'zh-CN': '停用背景时退出 Wallpaper Engine', en: 'Quit Wallpaper Engine when disabled' },
  audioHint: {
    'zh-CN': '壁纸的声音请在 Wallpaper Engine 里关闭：设置 → 一般 → 音频输出。关掉之后壁纸就没声音，音频响应照常工作。',
    en: 'To silence wallpaper audio, turn it off in Wallpaper Engine: Settings - General - Audio output.',
  },
};

const SETTINGS = [
  {
    key: 'quitWeOnDisable',
    type: 'boolean',
    defaultValue: false,
    label: { 'zh-CN': '停用背景时退出 Wallpaper Engine', en: 'Quit Wallpaper Engine when disabled' },
    description: {
      'zh-CN': '默认关。开启后切走这个背景时会结束 wallpaper64.exe —— 注意这也会停掉你的桌面壁纸。',
      en: 'Off by default. When on, switching away kills wallpaper64.exe — which also stops your desktop wallpaper.',
    },
  },
];

const ACCENT = 'var(--folium-accent, #7c6cff)';

function styleButton(btn, primary) {
  btn.type = 'button';
  btn.style.cssText = [
    'appearance:none',
    'border:1px solid rgba(128,128,128,.35)',
    'border-radius:8px',
    'padding:6px 12px',
    'font:inherit',
    'font-size:13px',
    'line-height:1.4',
    'cursor:pointer',
    primary ? `background:${ACCENT}` : 'background:transparent',
    primary ? 'color:#fff' : 'color:inherit',
  ].join(';');
}

/* -------------------------------------------------------------- 背景绘制 */

/* --------------------------------------------- 透明化桥接（Folia preload） */

function electronBridge() {
  try {
    return (typeof window !== 'undefined' && window.electron) ? window.electron : null;
  } catch (err) {
    return null;
  }
}

async function readTransparentMode() {
  const bridge = electronBridge();
  if (!bridge || typeof bridge.getWindowTransparentMode !== 'function') return null;
  try {
    return await bridge.getWindowTransparentMode();
  } catch (err) {
    return null;
  }
}

// 返回 true 表示切换命令已发出（窗口会重建）。
function setTransparentMode(on) {
  const bridge = electronBridge();
  if (!bridge || typeof bridge.setWindowTransparentMode !== 'function') return false;
  try {
    bridge.setWindowTransparentMode(on, undefined);
    return true;
  } catch (err) {
    return false;
  }
}

// 跨 mount 的"释放自动透明认领"延时器。
// 关键：窗口重建会把整个渲染进程销毁，这个定时器随之消失 → 不会误释放 → 不会打环；
// 而真正切走背景时渲染进程还在 → 5 秒后释放 → 下次选中又能自动开透明。
let transparencyReleaseTimer = null;

// 这个背景本身不画东西：真正的画面是 WE 的独立窗口，由主进程压在 Folia 下面。
function mountBackground(store, container, ctx, isMain) {
  const locale = guessLocale();
  if (!isMain) {
    return function () {};
  }

  if (transparencyReleaseTimer) {
    clearTimeout(transparencyReleaseTimer);
    transparencyReleaseTimer = null;
  }

  const hint = document.createElement('div');
  hint.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:14px',
    'line-height:1.6',
    'padding:0 32px',
    'text-align:center',
    'opacity:.5',
    'color:var(--folium-primary, #fff)',
    'pointer-events:none',
  ].join(';');
  hint.textContent = L(T.previewHint, locale);
  container.append(hint);

  // 静态预览（背景选择器里的缩略预览）不折腾原生窗口。
  if (ctx.staticMode) {
    return function () {
      hint.remove();
    };
  }

  let disposed = false;
  let openedOnce = false;
  let transparencyWatch = null;



  function clearTransparencyWatch() {
    if (transparencyWatch) {
      clearInterval(transparencyWatch);
      transparencyWatch = null;
    }
  }

  // 透明被关掉时 WE 壁纸反正看不见 —— 顺手把 WE 停掉，别白占内存。
  function startTransparencyWatch() {
    if (transparencyWatch) return;
    transparencyWatch = setInterval(function () {
      void (async function () {
        const on = await readTransparentMode();
        if (on === false && !disposed) {
          clearTransparencyWatch();
          folium.log.info('检测到透明已关闭，停止 Wallpaper Engine');
          void store.close({ quitWe: true });
        }
      })();
    }, 3000);
  }

  async function sync() {
    const result = openedOnce ? null : await store.open();
    openedOnce = true;
    if (disposed) return;
    if (result && result.ok) {
      hint.textContent = '';
    } else if (result && !result.ok) {
      hint.textContent = L(T.needTransparency, locale) + '（' + String(result.message || result.reason || '') + '）';
    }
  }

  const offContext = ctx.subscribe(function () {
    void sync();
  });

  // 选中这个背景时自动切透明。但同一个 Folia 会话里【只自动开一次】——
  // 否则你手动关掉透明后，重建窗口重载又会自动打开，来回重建 → 画面一直闪。
  void (async function initTransparency() {
    const on = await readTransparentMode();
    if (disposed) return;

    if (on === false) {
      let claimed = false;
      try {
        const claim = await folium.rpc.call('claimTransparencyAuto');
        claimed = !!(claim && claim.ok);
      } catch (err) {
        claimed = false;
      }
      if (claimed) {
        folium.log.info('WE 原生背景：自动开启透明化（本次会话仅一次）');
        if (setTransparentMode(true)) return; // 窗口会重建，本次 mount 结束
      }
      // 认领失败 = 你手动关过透明：尊重你的选择，不再自动开，只把 WE 停掉。
      folium.log.info('透明被手动关闭过，不再自动开启；停止 Wallpaper Engine');
      startTransparencyWatch();
      void sync();
      return;
    }

    startTransparencyWatch();
    void sync();
  })();

  return function () {
    disposed = true;
    clearTransparencyWatch();
    try {
      if (typeof offContext === 'function') offContext();
    } catch (err) {
      /* 忽略 */
    }
    hint.remove();
    void store.close({ quitWe: (ctx.getSettings() || {}).quitWeOnDisable === true });

    // 真正切走时才排释放；窗口重建会连渲染进程一起销毁，这个定时器不会生效。
    if (transparencyReleaseTimer) clearTimeout(transparencyReleaseTimer);
    transparencyReleaseTimer = setTimeout(function () {
      transparencyReleaseTimer = null;
      store.releaseTransparencyAuto();
    }, 5000);
  };
}

/* ------------------------------------------------------------ 设置面板 */

function mountPanel(folium, store, container, ctx) {
  const locale = ctx.locale || guessLocale();

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;gap:14px;font:inherit;color:var(--folium-primary, inherit);max-height:72vh;overflow:auto;';
  container.append(root);

  const infoRow = document.createElement('div');
  infoRow.style.cssText = 'font-size:12px;line-height:1.7;opacity:.7;word-break:break-all;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';

  const toggleBtn = document.createElement('button');
  styleButton(toggleBtn, true);

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = L(T.refresh, locale);
  styleButton(refreshBtn, false);

  const statusRow = document.createElement('div');
  statusRow.style.cssText = 'font-size:12px;line-height:1.6;opacity:.7;';

  const listTitle = document.createElement('div');
  listTitle.style.cssText = 'font-size:13px;font-weight:600;';

  const listEl = document.createElement('div');
  listEl.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:2px',
    'max-height:240px',
    'overflow:auto',
    'border:1px solid rgba(128,128,128,.25)',
    'border-radius:8px',
    'padding:4px',
  ].join(';');


  // 壁纸声音：本模组不做静音，给一句提示（压音量会让音频响应失效）
  const audioRow = document.createElement('div');
  audioRow.style.cssText = 'font-size:12px;line-height:1.6;opacity:.55;';
  audioRow.textContent = L(T.audioHint, locale);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;line-height:1.6;opacity:.55;';
  hint.textContent = L(T.needTransparency, locale);

  // 透明化开关（直接调 Folia 的 preload 桥接）
  const transpRow = document.createElement('label');
  transpRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;';
  const transpCheck = document.createElement('input');
  transpCheck.type = 'checkbox';
  transpCheck.style.cssText = `width:15px;height:15px;accent-color:${ACCENT};`;
  const transpText = document.createElement('span');
  transpRow.append(transpCheck, transpText);

  // 停用背景时是否连 WE 一起退掉
  const quitRow = document.createElement('label');
  quitRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;';
  const quitCheck = document.createElement('input');
  quitCheck.type = 'checkbox';
  quitCheck.style.cssText = `width:15px;height:15px;accent-color:${ACCENT};`;
  const quitText = document.createElement('span');
  quitText.textContent = L(T.quitWeLabel, locale);
  quitRow.append(quitCheck, quitText);

  actions.append(toggleBtn, refreshBtn, statusRow);
  root.append(infoRow, actions, listTitle, listEl, transpRow, quitRow, hint, audioRow);

  let info = null;
  let running = false;
  let busy = false;

  function selectionKey() {
    const sel = store.state.selection;
    if (!sel) return null;
    if (sel.folder) return 'folder:' + sel.folder.toLowerCase();
    if (sel.file) return 'file:' + sel.file.toLowerCase();
    return null;
  }

  function renderInfo() {
    if (!info || !info.ok) {
      infoRow.textContent = L(T.weMissing, locale) + (info && info.message ? '：' + info.message : '');
      return;
    }
    const parts = [];
    parts.push(L(T.active, locale) + (info.active ? info.active.title + '（' + (info.active.type || '未知') + '）' : '—'));
    parts.push(L(T.count, locale).trim() ? info.count + L(T.count, locale) : String(info.count));
    infoRow.textContent = parts.join(' · ');
  }

  function renderStatus() {
    toggleBtn.textContent = running ? L(T.disable, locale) : L(T.enable, locale);
    toggleBtn.disabled = busy;
    const base = busy ? L(T.working, locale) : running ? L(T.running, locale) : L(T.stopped, locale);
    const err = !running && !busy && store.state.lastError ? '  ·  ' + String(store.state.lastError) : '';
    statusRow.textContent = base + err;
  }


  function renderList() {
    const all = (info && info.items) || [];
    const items = all.filter(function (item) {
      return item.openable !== false;
    });
    const hiddenCount = all.length - items.length;
    listEl.textContent = '';
    if (!items.length) {
      listTitle.style.display = 'none';
      listEl.style.display = 'none';
      return;
    }
    listTitle.style.display = '';
    listEl.style.display = '';
    listTitle.textContent = L(T.library, locale) +
      (hiddenCount > 0 ? ' · ' + L(T.unsupportedHidden, locale).replace('{n}', String(hiddenCount)) : '');

    const selected = selectionKey();
    for (const item of items) {
      const key = 'folder:' + item.folder.toLowerCase();
      const isSel = selected === key;
      const row = document.createElement('button');
      row.type = 'button';
      row.textContent = (isSel ? '● ' : '○ ') + item.title + '  [' + (item.type || '?') + ']';
      row.style.cssText = [
        'appearance:none',
        'border:0',
        'border-radius:6px',
        'padding:5px 8px',
        'font:inherit',
        'font-size:12px',
        'text-align:left',
        'cursor:pointer',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
        isSel ? `background:${ACCENT}` : 'background:transparent',
        isSel ? 'color:#fff' : 'color:inherit',
      ].join(';');
      row.title = item.title;
      row.addEventListener('click', function () {
        void (async function () {
          await store.select({ folder: item.folder, title: item.title, type: item.type });
          renderList();
          if (running) await store.reopen({});
        })();
      });
      listEl.append(row);
    }
  }


  function renderQuit() {
    try {
      quitCheck.checked = (ctx.params.get() || {}).quitWeOnDisable === true;
    } catch (err) {
      quitCheck.checked = false;
    }
  }

  quitCheck.addEventListener('change', function () {
    try {
      ctx.params.set({ quitWeOnDisable: quitCheck.checked });
    } catch (err) {
      folium.log.warn('WE 原生：保存退出设置失败', String(err));
    }
  });

  async function renderTransparent() {
    const bridge = electronBridge();
    if (!bridge || typeof bridge.getWindowTransparentMode !== 'function') {
      transpRow.style.display = 'none';
      return;
    }
    transpRow.style.display = '';
    const on = await readTransparentMode();
    transpCheck.checked = !!on;
    transpText.textContent = on ? L(T.transparentOn, locale) : L(T.transparentOff, locale);
  }

  transpCheck.addEventListener('change', function () {
    const bridge = electronBridge();
    if (!bridge || typeof bridge.setWindowTransparentMode !== 'function') return;
    transpText.textContent = L(T.working, locale);
    try {
      Promise.resolve(bridge.setWindowTransparentMode(transpCheck.checked, undefined)).catch(function () {
        /* 窗口会重建，忽略 */
      });
    } catch (err) {
      /* 忽略 */
    }
  });

  refreshBtn.addEventListener('click', function () {
    void (async function () {
      refreshBtn.disabled = true;
      try {
        info = await folium.rpc.call('refresh');
      } catch (err) {
        info = { ok: false, message: String((err && err.message) || err) };
      }
      refreshBtn.disabled = false;
      refreshAll();
    })();
  });

  function refreshAll() {
    renderInfo();
    renderStatus();
    renderList();
    renderQuit();
  }

  toggleBtn.addEventListener('click', function () {
    void (async function () {
      busy = true;
      renderStatus();
      if (running) await store.close({ quitWe: quitCheck.checked === true });
      else await store.open({});
      busy = false;
      running = store.state.running;
      renderStatus();
    })();
  });

  const offStore = store.subscribe(function () {
    running = store.state.running;
    refreshAll();
  });

  (async function () {
    try {
      info = await folium.rpc.call('describe');
    } catch (err) {
      info = { ok: false, message: String((err && err.message) || err) };
    }
    running = store.state.running;
    refreshAll();
    void renderTransparent();
  })();

  return function () {
    try {
      if (typeof offStore === 'function') offStore();
    } catch (err) {
      /* 忽略 */
    }
    root.remove();
  };
}

/* ---------------------------------------------------------------- 入口 */

export default function activate(folium) {
  const isMainContext = folium.env.context === 'main';

  const listeners = new Set();
  const state = { selection: null, running: false, lastError: null };

  function emit() {
    for (const fn of Array.from(listeners)) {
      try {
        fn();
      } catch (err) {
        folium.log.error('WE 原生：监听器出错', String(err));
      }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return function () {
      listeners.delete(fn);
    };
  }

  async function persistSelection() {
    if (!isMainContext) return;
    try {
      if (state.selection) await folium.storage.set(STORAGE_KEY, state.selection);
      else await folium.storage.delete(STORAGE_KEY);
    } catch (err) {
      folium.log.warn('WE 原生：保存选择失败', String(err));
    }
  }

  async function select(selection) {
    state.selection = selection && (selection.folder || selection.file) ? selection : null;
    await persistSelection();
    emit();
  }

  async function persistEnabled(on) {
    if (!isMainContext) return;
    try {
      if (on) await folium.storage.set(ENABLED_KEY, true);
      else await folium.storage.delete(ENABLED_KEY);
    } catch (err) {
      folium.log.warn('WE 原生：保存启用状态失败', String(err));
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function refreshStatus() {
    if (!isMainContext) return;
    try {
      const status = await folium.rpc.call('status');
      state.running = !!(status && status.active);
    } catch (err) {
      state.running = false;
    }
    emit();
  }

  async function openOnce(options) {
    if (!isMainContext) return { ok: false, reason: 'not-main-context' };
    try {
      const status = await folium.rpc.call('status');
      if (status && status.active) {
        state.running = true;
        emit();
        return { ok: true, already: true };
      }

      let payload = null;
      if (state.selection && state.selection.folder) payload = { folder: state.selection.folder };
      else if (state.selection && state.selection.file) payload = { file: state.selection.file };
      else {
        const info = await folium.rpc.call('describe');
        if (info && info.ok && info.active && info.active.file) payload = { file: info.active.file };
      }
      if (!payload) {
        folium.log.warn('WE 原生：没有可打开的壁纸（壁纸库里没选，也没读到 WE 当前壁纸）');
        return { ok: false, reason: 'no-wallpaper' };
      }

      const result = await folium.rpc.call('open', payload);
      await refreshStatus();
      if (result && !result.ok) {
        folium.log.warn('WE 原生：打开失败', result.message || result.reason);
        state.lastError = result.message || result.reason || '打开失败';
      } else {
        state.lastError = null;
      }
      emit();
      return result || { ok: false, reason: 'no-result' };
    } catch (err) {
      folium.log.error('WE 原生：打开失败', String((err && err.message) || err));
      state.lastError = String((err && err.message) || err);
      emit();
      return { ok: false, reason: 'threw', message: String((err && err.message) || err) };
    }
  }

  // 冷启动时主窗口 / WE 可能还没就绪，暂时性失败就退避重试几次。
  async function open(options) {
    let last = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      last = await openOnce(options);
      if (last && last.ok) {
        await persistEnabled(true);
        return last;
      }
      const transient = last && (last.reason === 'no-main-window' || last.reason === 'we-not-running' || last.reason === 'open-failed');
      if (!transient) break;
      await wait(1500 * (attempt + 1));
    }
    return last || { ok: false, reason: 'no-result' };
  }

  async function close(options) {
    if (!isMainContext) return;
    try {
      await folium.rpc.call('close', { quitWe: !!(options && options.quitWe) });
    } catch (err) {
      folium.log.error('WE 原生：关闭失败', String((err && err.message) || err));
    }
    await persistEnabled(false);
    state.lastError = null;
    await refreshStatus();
  }

  async function reopen(options) {
    await close(options);
    return open(options);
  }

  const store = {
    state: state,
    subscribe: subscribe,
    select: select,
    open: open,
    close: close,
    reopen: reopen,
    releaseTransparencyAuto: function () {
      try {
        folium.rpc.call('releaseTransparencyAuto');
      } catch (err) {
        /* 忽略 */
      }
    },
  };

  const backgroundHandle = folium.registries.backgrounds.register({
    id: 'we-native',
    label: T.background,
    mount: function (container, ctx) {
      return mountBackground(store, container, ctx, isMainContext);
    },
    settings: SETTINGS,
    settingsPanel: function (container, ctx) {
      return mountPanel(folium, store, container, ctx);
    },
  });

  (async function () {
    if (!isMainContext) return;
    let wantEnabled = false;
    try {
      const saved = await folium.storage.get(STORAGE_KEY);
      if (saved && (saved.folder || saved.file)) state.selection = saved;
      wantEnabled = (await folium.storage.get(ENABLED_KEY)) === true;
    } catch (err) {
      /* 忽略 */
    }
    await refreshStatus();

    // 上次是启用状态：等 Folia 起来后自动恢复（open 内部有退避重试）。
    if (wantEnabled && !state.running) {
      await wait(3000);
      await open();
    }
  })();

  return function () {
    listeners.clear();
    if (backgroundHandle && typeof backgroundHandle.unregister === 'function') {
      try {
        backgroundHandle.unregister();
      } catch (err) {
        /* 忽略 */
      }
    }
  };
}
