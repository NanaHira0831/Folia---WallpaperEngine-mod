// ===========================================================================
// Wallpaper Engine 原生壁纸 · Folia 模组 · main 入口
// 版权所有 (C) 2026 NaLuna。保留所有权利。
// 未经作者书面许可，禁止转载、二次分发、收费（含付费下载/打赏解锁/商业用途）、
// 修改后发布或去除署名。完整条款见同目录的「使用条款.txt」。
// ===========================================================================

'use strict';

// Wallpaper Engine 原生壁纸 · main 入口（Electron 主进程，完整 Node 权限）
//
// 做法：
//   1. 扫 Steam 库找到 Wallpaper Engine 与创意工坊壁纸库，读出当前壁纸；
//   2. 本模组【不做静音】：壁纸有声时请到 Wallpaper Engine 设置 → 一般 → 音频输出 里关闭；
//      原因与全部实测记录（为什么任何"压音量"的做法都会掐断音频响应）见 README.md；
//   3. 给 WE 下 `-control openWallpaper -file <pkg> -playInWindow <标题> -borderless`，
//      WE 会把壁纸渲染进一个普通无边框窗口（WPEOverlappedWallpaper）；
//   4. 起一个预编译的 C# 跟随器（we-follow.exe），用 SetWindowPos 把那个窗口压在
//      Folia 主窗口正下方，跟随移动/缩放。
//
// 显示层面依赖 Folia 自己的「透明化」：玩家窗口透明后，下面的 WE 窗口透出来。

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const WE_APP_ID = '431960';
const WE_TITLE = 'FoliaWeWallpaper';

let cachedElectron;
function getElectron() {
  if (cachedElectron !== undefined) return cachedElectron;
  try {
    cachedElectron = require('electron');
  } catch (err) {
    cachedElectron = null;
  }
  return cachedElectron;
}

/* ------------------------------------------------------------------ 小工具 */

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    return null;
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (err) {
    return false;
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch (err) {
    return false;
  }
}

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toNativePath(value) {
  return String(value || '').replace(/\//g, path.sep);
}

function run(exe, args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs || 20000 }, function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}


/* ------------------------------------------------------- Steam / WE 发现 */

const STEAM_SUBDIRS = [
  'Steam',
  'SteamLibrary',
  'Games\\Steam',
  'Program Files (x86)\\Steam',
  'Program Files\\Steam',
];

function existingDriveRoots() {
  const roots = [];
  for (let code = 67; code <= 90; code += 1) {
    const root = String.fromCharCode(code) + ':\\';
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch (err) {
      /* 忽略 */
    }
  }
  return roots;
}

function readVdfLibraryPaths(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return [];
  }
  const found = [];
  let match;
  const byPath = /"path"\s+"([^"]+)"/gi;
  while ((match = byPath.exec(text)) !== null) found.push(match[1]);
  const byIndex = /^\s*"\d+"\s+"([^"]+)"/gim;
  while ((match = byIndex.exec(text)) !== null) found.push(match[1]);
  return found.map(function (value) {
    return value.replace(/\\\\/g, '\\');
  });
}

function findSteamRoots() {
  const roots = new Set();
  for (const drive of existingDriveRoots()) {
    for (const sub of STEAM_SUBDIRS) {
      const candidate = path.join(drive, sub);
      if (isDir(path.join(candidate, 'steamapps'))) roots.add(path.resolve(candidate));
    }
  }
  for (const root of Array.from(roots)) {
    const extra = readVdfLibraryPaths(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    for (const entry of extra) {
      if (entry && isDir(path.join(entry, 'steamapps'))) roots.add(path.resolve(entry));
    }
  }
  return Array.from(roots);
}

function findWallpaperEngine(steamRoots) {
  for (const root of steamRoots) {
    const weDir = path.join(root, 'steamapps', 'common', 'wallpaper_engine');
    if (isDir(weDir)) return { weDir: weDir, steamRoot: root };
  }
  return null;
}

function weConfigBuckets(config) {
  const own = [];
  const others = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return own;
  if (config.general && typeof config.general === 'object') {
    own.push({ key: '(root)', general: config.general });
  }
  const userName = clip(process.env.USERNAME || '', 64).toLowerCase();
  for (const [key, value] of Object.entries(config)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (!value.general || typeof value.general !== 'object') continue;
    if (userName && key.toLowerCase() === userName) own.push({ key: key, general: value.general });
    else others.push({ key: key, general: value.general });
  }
  return own.concat(others);
}

function collectActiveCandidates(weDir) {
  const files = [path.join(weDir, 'config.json')];
  if (process.env.APPDATA) {
    files.push(path.join(process.env.APPDATA, 'Wallpaper Engine', 'config.json'));
  }
  const candidates = [];
  const seen = new Set();
  for (const file of files) {
    const config = safeReadJson(file);
    if (!config) continue;
    for (const bucket of weConfigBuckets(config)) {
      const selected = bucket.general.wallpaperconfig && bucket.general.wallpaperconfig.selectedwallpapers;
      if (!selected || typeof selected !== 'object') continue;
      for (const monitor of Object.values(selected)) {
        const raw = monitor && monitor.file;
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const native = toNativePath(raw.trim());
        const key = native.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ file: native, bucket: bucket.key, exists: isFile(native) });
      }
    }
  }
  const userKey = clip(process.env.USERNAME || '', 64).toLowerCase();
  candidates.sort(function (a, b) {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    const aOwn = a.bucket.toLowerCase() === userKey ? 0 : 1;
    const bOwn = b.bucket.toLowerCase() === userKey ? 0 : 1;
    return aOwn - bOwn;
  });
  return candidates;
}

function describeWallpaperFile(entry) {
  const file = entry.file;
  const dir = path.dirname(file);
  const project = safeReadJson(path.join(dir, 'project.json'));
  const folderName = path.basename(dir);
  const workshopId = project && (project.workshopid || project.workshopId) ? (project.workshopid || project.workshopId) : folderName;
  return {
    file: file,
    dir: dir,
    bucket: entry.bucket,
    exists: entry.exists,
    id: clip(workshopId, 64),
    title: clip(project && project.title ? project.title : folderName, 160),
    type: clip(project && project.type ? project.type : '', 32).toLowerCase(),
  };
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.m4v', '.mov'];

// 判断这个壁纸能不能用 `-playInWindow` 打开：scene（有 scene.pkg）或 video（目录里有视频文件）。
// 素材包 / 脚本 / 网页 / 应用类壁纸没有可渲染的媒体，打开就是黑屏，标记为 unsupported。
function classifyFolder(folder) {
  let names = [];
  try {
    names = fs.readdirSync(folder).map(function (name) {
      return name.toLowerCase();
    });
  } catch (err) {
    return { kind: 'unsupported', openable: false };
  }
  if (names.indexOf('scene.pkg') >= 0) return { kind: 'scene', openable: true };
  if (names.some(function (name) {
    for (const ext of VIDEO_EXTENSIONS) if (name.endsWith(ext)) return true;
    return false;
  })) return { kind: 'video', openable: true };
  return { kind: 'unsupported', openable: false };
}

function collectProjects(rootDir, origin, into) {
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (err) {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(rootDir, entry.name);
    const project = safeReadJson(path.join(folder, 'project.json'));
    if (!project) continue;
    const classified = classifyFolder(folder);
    into.push({
      id: clip(project.workshopid || project.workshopId || entry.name, 64),
      origin: origin,
      title: clip(project.title || entry.name, 160),
      type: clip(project.type || '', 32).toLowerCase(),
      kind: classified.kind,
      openable: classified.openable,
      folder: folder,
    });
  }
}

function listWallpapers(steamRoots, weDir) {
  const items = [];
  const seen = new Set();
  const push = function (item) {
    const key = (item.origin === 'workshop' ? 'w:' : 'l:') + item.id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const root of steamRoots) {
    const bucket = [];
    collectProjects(path.join(root, 'steamapps', 'workshop', 'content', WE_APP_ID), 'workshop', bucket);
    bucket.forEach(push);
  }
  const local = [];
  collectProjects(path.join(weDir, 'projects', 'myprojects'), 'local', local);
  local.forEach(push);
  items.sort(function (a, b) {
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });
  return items;
}

function discover() {
  const steamRoots = findSteamRoots();
  const found = findWallpaperEngine(steamRoots);
  if (!found) {
    return {
      ok: false,
      reason: 'wallpaper-engine-not-found',
      message: '没找到 Wallpaper Engine 安装（已扫过 ' + steamRoots.length + ' 个 Steam 库）',
      steamRoots: steamRoots,
    };
  }
  let error = null;
  let items = [];
  let active = null;
  try {
    items = listWallpapers(steamRoots, found.weDir);
    const candidates = collectActiveCandidates(found.weDir);
    const chosen = candidates[0] || null;
    if (chosen) {
      active = describeWallpaperFile(chosen);
      if (!active.title || /^\d+$/.test(active.title)) {
        const hit = items.find(function (item) {
          return item.id === path.basename(active.dir);
        });
        if (hit) {
          active.title = hit.title;
          active.type = hit.type || active.type;
        }
      }
      if (!active.exists) active.stalePath = true;
    }
  } catch (err) {
    error = String((err && err.message) || err);
  }
  return {
    ok: true,
    weDir: found.weDir,
    weExe: path.join(found.weDir, 'wallpaper64.exe'),
    steamRoot: found.steamRoot,
    steamRoots: steamRoots,
    active: active,
    count: items.length,
    items: items,
    error: error,
  };
}

/* ------------------------------------------------------ 关于壁纸声音 */

// 本模组不碰壁纸音频，只给一句提示：请在 Wallpaper Engine 设置 → 一般 → 音频输出 里关闭。
// 原因是实测下来所有"把音量压成 0"的做法（改 scene.pkg、覆盖壁纸音量属性、WE 内置 volume）
// 都会让 WE 干脆不渲染这个声音，音频流一断，壁纸的音频响应（频谱条/音频颜色等）就死了；
// 而 WE 官方 `-control mute` 又管不到 -playInWindow 弹出窗口（实测峰值 0.987 → 0.987 纹丝不动）。
// 完整数据见 README.md「关于壁纸声音」。

// 为什么这里没有「改 scene.pkg」或「覆盖音量属性」那套东西了 —— 都是实测踩出来的：
//   1. 改 scene.pkg 里的 sound 对象（volume=0 / startsilent）→ WE 干脆不渲染这个声音，
//      音频流一断，壁纸的音频响应（频谱条/音频颜色等）就没数据可跳，可视化会死；
//      而且用户明确要求「不要动壁纸」，这条路彻底废弃。
//   2. 覆盖壁纸自己的音量属性（如 newproperty45「音乐大小」）→ 同样是把音量压成 0，
//      一样会让可视化失去数据。
//   3. WE 内置的整张壁纸音量（属性 key = volume，WE 界面右侧那个滑块）**不在命令行能改的
//      范围里**：官方文档写明 applyProperties 只能改"壁纸自己定义的属性"（Share JSON 里那份），
//      实测对内置 volume 发 applyProperties 完全无效（音频流峰值纹丝不动）。
//   4. WE 官方 CLI 有 -control mute / unmute（"Mutes all wallpapers"），但实测它只作用于
//      显示器上的壁纸，**管不到 -playInWindow 弹出窗口**（音频流峰值同样纹丝不动）。
//
// 所以最终方案是下面两条叠加，两者都在 WE 之外或 WE 的输出端动手，
// **完全不碰 WE 内部音频管线**，因此音频监听（可视化）照常工作：
//   A. WE 官方 -control mute / unmute（官方支持，覆盖显示器壁纸）
//   B. 系统音频会话静音（WASAPI，经 we-follow.exe --mute-we 实现，覆盖弹出窗口）
//      代价：桌面壁纸和弹出窗口由同一个进程播放、共用同一个音频会话，
//      所以桌面壁纸也会一起静音（停用背景时自动恢复）。


/* ------------------------------------------------------ 主窗口信息 + 跟随器 */


function mainWindowInfo() {
  const electron = getElectron();
  if (!electron || !electron.BrowserWindow) return null;
  const windows = electron.BrowserWindow.getAllWindows()
    .filter(function (win) {
      return win && typeof win.isDestroyed === 'function' && !win.isDestroyed() && win.isVisible();
    });
  let best = null;
  let bestArea = -1;
  for (const win of windows) {
    const bounds = win.getBounds();
    const area = bounds.width * bounds.height;
    if (area > bestArea) {
      bestArea = area;
      best = win;
    }
  }
  if (!best) return null;

  let hwnd = 0n;
  try {
    const buffer = best.getNativeWindowHandle();
    if (buffer && buffer.length >= 8) hwnd = buffer.readBigUInt64LE(0);
    else if (buffer && buffer.length >= 4) hwnd = BigInt(buffer.readUInt32LE(0));
  } catch (err) {
    return null;
  }
  if (hwnd === 0n) return null;

  const bounds = best.getBounds();
  let scale = 1;
  try {
    if (electron.screen && electron.screen.getDisplayMatching) {
      const display = electron.screen.getDisplayMatching(bounds);
      if (display && display.scaleFactor) scale = display.scaleFactor;
    }
  } catch (err) {
    /* 忽略 */
  }

  return {
    hwnd: hwnd.toString(),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    scale: scale,
    physicalWidth: Math.round(bounds.width * scale),
    physicalHeight: Math.round(bounds.height * scale),
  };
}

function spawnFollower(title, hwnd) {
  const hwndStr = String(hwnd == null ? '' : hwnd);
  // 首选预编译的 we-follow.exe（秒起、无 Add-Type/csc 依赖，稳）。
  const exe = path.join(__dirname, 'we-follow.exe');
  if (isFile(exe)) {
    return spawn(exe, [title, hwndStr], { windowsHide: true, stdio: 'ignore' });
  }
  // 回退：老式 PowerShell + Add-Type 跟随器（exe 缺失时）。
  const script = path.join(__dirname, 'follower.ps1');
  return spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
  ], {
    windowsHide: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, {
      FOLIA_WE_MODE: 'follow',
      FOLIA_WE_TITLE: title,
      FOLIA_HOST_HWND: hwndStr,
    }),
  });
}

/* --------------------------------------------------------- WE 进程管理 */

const TASKLIST = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\tasklist.exe';
const TASKKILL = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\taskkill.exe';

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function isWeRunning() {
  return new Promise(function (resolve) {
    execFile(TASKLIST, ['/FI', 'IMAGENAME eq wallpaper64.exe', '/NH'], { windowsHide: true }, function (err, stdout) {
      if (err) {
        resolve(false);
        return;
      }
      resolve(/wallpaper64\.exe/i.test(String(stdout || '')));
    });
  });
}

/* ------------------------------------------------------------------ 入口 */

module.exports = function activate(api) {
  let snapshot = null;
  // 主进程内存标志（跨窗口重建保留）：同一次 Folia 运行里，"自动切透明"只允许认领一次。
  // 否则用户手动关掉透明后，重建窗口触发的 mount 又把它打开，会来回重建导致画面一直闪。
  let transparencyAutoClaimed = false;
  const session = {
    active: false,
    title: WE_TITLE,
    file: null,
    launchFile: null,
    follower: null,
    hostHwnd: null,
    hwndMonitor: null,
  };

  function describe() {
    if (!snapshot) {
      try {
        snapshot = discover();
      } catch (err) {
        api.log.error('发现 Wallpaper Engine 失败', String((err && err.message) || err));
        snapshot = { ok: false, reason: 'discover-failed', message: String((err && err.message) || err) };
      }
      if (snapshot && snapshot.ok) {
        const active = snapshot.active;
        api.log.info(
          '找到 Wallpaper Engine：' + snapshot.weDir + '；壁纸 ' + snapshot.count + ' 个' +
            (active
              ? '；当前：' + active.title + '（' + (active.type || '未知类型') + '）' +
                (active.exists ? '' : ' [路径不存在]')
              : '')
        );
      } else {
        api.log.warn('没找到 Wallpaper Engine', snapshot && snapshot.message);
      }
    }
    return snapshot;
  }

  function resolveLaunchFile(item) {
    if (!item) return null;
    // item 可能是库条目（有 folder），也可能是活动壁纸（有 file）
    const folder = item.folder || (item.file ? path.dirname(item.file) : null);
    if (!folder) return null;
    const pkg = path.join(folder, 'scene.pkg');
    if (isFile(pkg)) return { file: pkg, kind: 'scene' };
    const project = path.join(folder, 'project.json');
    if (isFile(project)) return { file: project, kind: 'project' };
    if (item.file && isFile(item.file)) return { file: item.file, kind: 'file' };
    return null;
  }

  async function closeSession(quitWe) {
    const info = describe();
    if (session.hwndMonitor) {
      clearInterval(session.hwndMonitor);
      session.hwndMonitor = null;
    }
    if (session.follower) {
      try {
        session.follower.kill();
      } catch (err) {
        /* 忽略 */
      }
      session.follower = null;
    }

    const title = session.title;
    if (session.active && info && info.ok && title) {
      // 1) WE 原生控制通道
      try {
        await run(info.weExe, ['-control', 'closeWallpaper', '-location', title], 3000);
      } catch (err) {
        api.log.warn('closeWallpaper 控制命令失败，走兜底', String((err && err.message) || err));
      }
      // 2) 兜底：直接给窗口发 WM_CLOSE，不依赖 WE 的控制通道
      try {
        const exe = path.join(__dirname, 'we-follow.exe');
        if (isFile(exe)) await run(exe, ['--close', title], 5000);
      } catch (err) {
        api.log.warn('兜底关窗失败', String((err && err.message) || err));
      }
    }

    session.active = false;
    session.file = null;
    session.launchFile = null;

    // 3) 可选：连 Wallpaper Engine 一起退掉（注意会同时结束桌面壁纸）
    if (quitWe && info && info.ok) {
      try {
        await run(TASKKILL, ['/IM', 'wallpaper64.exe', '/F'], 6000);
        api.log.info('已按要求退出 Wallpaper Engine');
      } catch (err) {
        api.log.warn('退出 Wallpaper Engine 失败', String((err && err.message) || err));
      }
    }
  }

  // 没开 WE 就先自动拉起来，省得每次手动启动；起来后等控制通道就绪。
  async function ensureWeRunning(weExe) {
    if (await isWeRunning()) return true;

    api.log.info('Wallpaper Engine 未运行，自动启动：' + weExe);
    try {
      const child = spawn(weExe, [], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch (err) {
      api.log.error('启动 Wallpaper Engine 失败', String((err && err.message) || err));
      return false;
    }

    let appeared = false;
    for (let i = 0; i < 24; i += 1) {
      await sleep(500);
      if (await isWeRunning()) {
        appeared = true;
        break;
      }
    }
    if (!appeared) {
      api.log.error('等 Wallpaper Engine 进程超时');
      return false;
    }

    // 进程在还不够，-control 要等它的 IPC 通道就绪
    for (let i = 0; i < 12; i += 1) {
      try {
        await run(weExe, ['-control', 'getWallpaper', '-monitor', '0'], 3000);
        api.log.info('Wallpaper Engine 已就绪');
        return true;
      } catch (err) {
        await sleep(700);
      }
    }
    return true;
  }

  async function openSession(payload) {
    const info = describe();
    if (!info || !info.ok) {
      return { ok: false, reason: 'we-not-found', message: info && info.message };
    }

    const resolved = resolveLaunchFile(payload && (payload.folder ? payload : payload.file ? payload : null));
    if (!resolved) {
      return { ok: false, reason: 'no-launch-file', message: '这个壁纸没有可用的 scene.pkg / project.json' };
    }

    await closeSession();

    // 每次开都用一个全新标题，避免和还没销毁的旧窗口撞名、导致跟随器定位错窗口。
    session.title = WE_TITLE + '-' + String(Date.now() % 1000000);

    const launch = resolved.file;

    // 1) 先把 WE 拉起来 —— 这一步不依赖 Folia 窗口，冷启动时窗口可能还没就绪。
    //    以前是先查主窗口、查不到就 return，导致冷启动时永远走不到这里。
    const weReady = await ensureWeRunning(info.weExe);
    if (!weReady) {
      return { ok: false, reason: 'we-not-running', message: 'Wallpaper Engine 未能启动，请手动打开一次' };
    }

    // 2) 再等 Folia 主窗口就绪（冷启动时可能晚几百毫秒到几秒）。
    let win = null;
    for (let i = 0; i < 30; i += 1) {
      win = mainWindowInfo();
      if (win) break;
      await sleep(500);
    }
    if (!win) {
      return { ok: false, reason: 'no-main-window', message: '找不到 Folia 主窗口（等了 15 秒）' };
    }

    const args = [
      '-control', 'openWallpaper',
      '-file', launch,
      '-playInWindow', session.title,
      '-width', String(win.physicalWidth || 1280),
      '-height', String(win.physicalHeight || 720),
      '-x', String(win.x),
      '-y', String(win.y),
      '-borderless',
    ];

    try {
      await run(info.weExe, args, 20000);
    } catch (err) {
      return { ok: false, reason: 'open-failed', message: String((err && err.message) || err) };
    }

    session.active = true;
    session.file = resolved.file;
    session.launchFile = launch;

    try {
      session.follower = spawnFollower(session.title, win.hwnd);
    } catch (err) {
      api.log.warn('跟随器启动失败', String((err && err.message) || err));
    }
    session.hostHwnd = win.hwnd;


    // 「透明化」会重建 Folia 主窗口（hwnd 会变），这里轮询检测并在变化后重新武装跟随器。
    if (session.hwndMonitor) clearInterval(session.hwndMonitor);
    session.hwndMonitor = setInterval(function () {
      if (!session.active) return;
      let info = null;
      try {
        info = mainWindowInfo();
      } catch (err) {
        return;
      }
      if (!info || !info.hwnd) return;
      if (info.hwnd !== session.hostHwnd) {
        api.log.info('Folia 主窗口重建，重新武装跟随器：' + session.hostHwnd + ' -> ' + info.hwnd);
        session.hostHwnd = info.hwnd;
        if (session.follower) {
          try {
            session.follower.kill();
          } catch (err) {
            /* 忽略 */
          }
          session.follower = null;
        }
        try {
          session.follower = spawnFollower(session.title, info.hwnd);
        } catch (err) {
          api.log.warn('跟随器重启失败', String((err && err.message) || err));
        }
      }
    }, 1500);

    return {
      ok: true,
      title: session.title,
      hwnd: win.hwnd,
    };
  }

  api.rpc.handle('describe', async function () {
    return describe();
  });

  api.rpc.handle('refresh', async function () {
    snapshot = null;
    return describe();
  });

  api.rpc.handle('open', async function (payload) {
    return openSession(payload || {});
  });

  api.rpc.handle('close', async function (payload) {
    await closeSession(!!(payload && payload.quitWe));
    return { ok: true };
  });

  api.rpc.handle('claimTransparencyAuto', async function () {
    if (transparencyAutoClaimed) return { ok: false };
    transparencyAutoClaimed = true;
    return { ok: true };
  });

  // 真正切走背景时释放认领（下次选中还能自动开透明）。
  // 窗口重建导致的 unmount 不会走到这里——渲染进程被销毁，客户端那个延时器也一起没了。
  api.rpc.handle('releaseTransparencyAuto', async function () {
    transparencyAutoClaimed = false;
    return { ok: true };
  });

  api.rpc.handle('status', async function () {
    return {
      active: session.active,
      title: session.title,
      file: session.file,
    };
  });

  api.lifecycle.onDeactivate(async function () {
    try {
      await closeSession();
    } catch (err) {
      /* 忽略 */
    }
    snapshot = null;
  });
};

// 测试钩子：本机离线回归用，不影响运行。
module.exports._test = {
  discover: discover,
};
