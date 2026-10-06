# Wallpaper Engine 原生壁纸 · Folia 模组

把 Wallpaper Engine 的壁纸**原样**当成 Folia 播放页的背景 —— 不是抓屏、不是转码，而是**驱动真实 WE 引擎**渲染。

## 版权与使用条款

**版权所有 (C) 2026 NaLuna。保留所有权利。**

本模组仅供个人学习与自用。

未经作者书面许可，**禁止**：

1. 转载、搬运、二次分发（含整合包、网盘、论坛、视频附带等）；
2. 任何形式的收费：付费下载、打赏解锁、商业用途；
3. 修改、改名、去除署名后发布。

**允许**：在自己机器上自由使用；在保留完整署名与本条款的前提下，分享指向原始发布页的链接。

本模组按"现状"提供，不附带任何担保。

参考实现：`XxHuberrr/Mineradio`（GPL-3.0-only）。Wallpaper Engine 为 Skutta Software 的专有软件；
本模组仅调用其公开命令行，不包含、不修改、不再分发其任何文件。

## 原理

```
wallpaper64.exe -control openWallpaper
  -file <scene.pkg> -playInWindow "FoliaWeWallpaper"
  -width W -height H -x X -y Y -borderless
        │  WE 把壁纸渲染进一个普通无边框窗口（WPEOverlappedWallpaper）
        ▼
follower.ps1（PowerShell + C#）
        │  EnumWindows 找到那个窗口
        │  SetWindowPos(we, foliaHwnd, rect)  把它压在 Folia 主窗口正下方
        │  每 33ms 校验一次，跟着移动/缩放；宿主最小化则隐藏
        ▼
Folia 开「透明化」→ 播放器窗口透明，下面的 WE 壁纸透出来
```

三条关键点：

1. **关于壁纸声音：本模组不做静音**，只给一句提示 —— 请在 Wallpaper Engine 里关闭：
   **设置 → 一般 → 音频输出**。关掉之后壁纸就没有声音，而**音频响应（频谱条/音频颜色等可视化）照常工作**，
   这正是我们要的效果。

   为什么不让模组自己静音：试遍了所有能给命令行用的办法，**每一个都会把音频响应弄死**：

   ### 走过的弯路（实测结论，避免以后再踩）

   | 尝试过的手段 | 结果 |
   | --- | --- |
   | 改 `scene.pkg`：把 `sound` 对象设为 `startsilent=true, volume=0` | 声音没了，但 WE 干脆不渲染这个声音（会话峰值 0.1507 → 0），**可视化跟着死**；且属于「动壁纸」，已废弃 |
   | 只把 `volume` 压成 0（保留 `startsilent`） | 同样 0.1507 → 0，**可视化照样死** |
   | 覆盖壁纸自己的音量属性（如 `newproperty45`「音乐大小」） | 同样是压音量到 0，可视化同样失去数据 |
   | WE 内置的整张壁纸音量（属性 key = `volume`，WE 界面右侧那个滑块） | **命令行改不了**：官方文档写明 `applyProperties` 只能改「壁纸自己定义的属性」（Share JSON 里那份），内置 `volume` 不在其中；对桌面与弹出窗口实测都无效 |
   | WE 官方 `-control mute` | **管不到弹出窗口**：下发后弹出窗口的音频会话峰值 0.987 → 0.987 纹丝不动（它只作用于显示器上的壁纸）|
   | 系统音频会话静音（WASAPI） | 能让会话峰值掉到 0.003，但**桌面壁纸和弹出窗口同一个进程同一个会话**，会把桌面壁纸一起静音 |

   结论：命令行能碰的每一个音量开关，要么掐断音频流（可视化死），要么牵连桌面壁纸。
   **WE 自己的「音频输出」开关是唯一干净的做法**，所以模组只做提示，不代劳。

   顺带记两个坑：

   - **`applyProperties` 的退出码不可信**：WE 对不存在的属性名（瞎编的 `zzz_not_a_prop`）一样返回成功，
     所以「命令成功」不等于「属性生效」，只有真实存在的属性才会被应用。
   - **曾经的补丁包必须仍叫 `scene.pkg` 且独自放一个目录**：WE 的 pkg 约定是 `<名字>.pkg` 内部装 `<名字>.json`，
     当初把副本命名成 `folia-we-scene.pkg`，WE 就去找内部的 `folia-we-scene.json`，找不到 → 日志报
     `Failed parsing folia-we-scene.json with error: The document is empty.` + 黑屏。
     另外改写后的 JSON 必须**用空格补齐到原始长度**（`Buffer.alloc(entryLen, 0x20)`），索引偏移才不变。

2. **跟随器**是预编译的 `we-follow.exe`（源码 `we-follow.cs`），不需要 native Node 模块；
   `SetThreadDpiAwarenessContext(PMv2)` 保证多显示器/缩放下的坐标正确；`WS_EX_TOOLWINDOW`
   把它从任务栏/Alt-Tab 藏掉。缺这个 exe 时回退到 `follower.ps1`（PowerShell + Add-Type，较慢）。
3. 这套做法与同机的 Mineradio 2.2.0（GPL-3.0-only）同源：`-control openWallpaper -playInWindow`、
   `applyProperties` 静音、窗口嵌入，参考其 `desktop/wallpaper-engine-runtime.js`。
   WE 本体是 Skutta Software 的专有软件，本模组只调用其公开命令行，不包含、不修改、不再分发 WE 文件。

## 本机实测（离线回归）

在作者的机器上验证通过：

- `-playInWindow` 能对 **scene.pkg**（34.2 MB 的 Arknights 凯尔希场景）开出一个
  `WPEOverlappedWallpaper` 窗口，标题可指定；
- 静音相关全部实测记录见上文第 1 条（结论：模组不代劳，改用 WE 自己的「音频输出」开关）：
  - **WE 官方 `-control mute`**：退出码 0，但弹出窗口会话峰值 0.987 → 0.987，对弹出窗口无效；
  - **WASAPI 会话静音**：同一会话 0.987 → 0.003，确实静音，但会连带静音桌面壁纸；
  - **压音量**（改包 / 覆盖属性 / 内置 `volume`）：0.1507 → 0，音频流断，可视化死。
- 早期场景包补丁（已废弃）的结构与渲染验证：三体场景（158 MB）补丁后大小完全不变、`sound` 对象 1/1 已静音、
  回读校验通过；把原始 pkg 与补丁 pkg 分别开窗截图，非黑像素占比 82.7% vs 81.1%（都能正常渲染，不黑屏），
  WE 日志新增 0 条报错 —— 也就是说它**技术上可用，但会掐死音频监听**，所以不用它。
- 跟随器端到端：宿主窗口 `120,120→680,480` 时 WE 窗口精确贴合，移动到 `400,240→1100,740` 后同样贴合（相等=True）。
- 跟随器是**预编译的 `we-follow.exe`**（源码 `we-follow.cs`，用 `csc` 编译）：秒起，不依赖 PowerShell / Add-Type / csc。
  这样做是因为"运行时起 PowerShell + Add-Type 现编译"在 Electron 主进程里会静默失败，导致跟随器根本没起来。
- 自动启动：杀掉 WE 后点「启用」，检测到未运行 → **用 `-silent` 静默拉起**（不带参数会弹主界面）→
  进程约 500ms 出现 → 控制通道第 1 次探测就绪；实测起来后**零可见窗口**。

## 安装 / 使用

1. **设置 → 实验室 → 模组系统** 打开总开关。
2. 把 `we-wallpaper` 整个文件夹放进 `%APPDATA%\Folia\mods\`。
3. 模组面板里启用 **「Wallpaper Engine 原生壁纸」** 并确认（只声明 `filesystem.data`）。
4. **Folia 命令面板搜「透明化」，开启** —— 否则看不到壁纸。
5. 展开模组 → 「Wallpaper Engine 原生壁纸」→ 点「启用」（默认用你 WE 当前壁纸；也可以在列表里点选别的）。
   或者命令面板搜「切换 Wallpaper Engine 原生壁纸」。

**不用再手动开 Wallpaper Engine**：点「启用」时会先检查 `wallpaper64.exe` 在不在；不在就**用 `-silent` 静默拉起来**，
并等它的 `-control` 通道就绪后才去开壁纸窗口。冷启动时主窗口可能还没就绪，所以顺序是
**先拉起 WE → 再轮询等主窗口（最多 15 秒）**，而不是先等窗口。

> ⚠️ **必须带 `-silent`**：WE 不带参数启动会**把主界面弹出来**（满屏的壁纸浏览器）。
> 自己电脑上 WE 通常一直开着，所以这个坑只有在**换一台电脑、第一次点「启用」**时才会暴露。
> 实测 `wallpaper64.exe -silent` 起来后没有任何可见窗口，`-control` 通道也照常可用。

**壁纸声音**：**本模组不做静音**。面板底部会提示你到 **Wallpaper Engine → 设置 → 一般 → 音频输出**
里关掉；这样既没声音，壁纸的音频响应（可视化）也照常工作。原因见上文第 1 条。

**自动切透明**：选中这个背景时会自动把 Folia 切到透明（调 preload 的 `setWindowTransparentMode`），
不用再去命令面板手动开。**但同一次 Folia 运行里只自动开一次**——否则你手动关掉透明后，窗口重建
重载又会自动打开，来回重建会让画面一直闪。真正切走背景（不是窗口重建）5 秒后会释放这个"认领"，
下次选中又能自动开。

**关掉透明就停 WE**：挂着这个背景时会每 3 秒检查一次透明状态；一旦你手动关掉透明（此时壁纸反正看不见），
会自动关掉 WE 壁纸窗口并结束 `wallpaper64.exe`，不白占内存。

## 已知边界

- **必须开「透明化」**：壁纸窗口在 Folia 下面，Folia 不透明就看不见。别开「壁纸模式」，那条路透明会被拒。
- **跟随的是 Folia 主窗口**（面积最大的可见窗口）。多显示器下跟随器按物理坐标走，应该正常；没实测双屏。
- **关闭 Folia**：mod 的 `onDeactivate` 会发 `closeWallpaper` 关掉壁纸窗口；但如果 Folia 被强杀，
  壁纸窗口可能残留，在 WE 里或任务管理器里关一下即可（或再开一次 Folia 会自动补一次关闭）。
- **切走背景时关窗有兜底**：先走 WE 的 `-control closeWallpaper`；万一控制通道没响应，
  再用 `we-follow.exe --close <标题>` 给窗口发 `WM_CLOSE`（不依赖 WE），确保窗口不会残留。
- **WE 进程默认不退出**：切走背景只关壁纸窗口，`wallpaper64.exe` 继续跑（它同时是你的桌面壁纸引擎）。
  想连它一起退掉，勾选设置里的「停用背景时退出 Wallpaper Engine」——注意这会同时停掉桌面壁纸。
- **视频型壁纸**：对 `project.json` 型条目直接传 project.json。视频的音频在视频轨里，
  只能靠系统音频会话静音处理（和场景壁纸一样）。
- **桌面壁纸也会一起静音**：桌面壁纸与弹出窗口由同一个 `wallpaper64.exe` 播放、共用同一个音频会话，
  所以用这个背景时桌面壁纸也没声音（停用背景时自动恢复）。想要桌面壁纸一直有声音，
  就把面板里的「静音壁纸音频」关掉。
- **首次启用会弹确认框**，且任何文件改动都会让授权失效、模组回到禁用，需要重新确认。

## 便携 / 换机

整个模组**自包含**，代码里没有任何硬编码的绝对路径（已核对）。换电脑 / 重装 Folia 时：

1. 把 `we-wallpaper` 整个文件夹拷到新机器的 `%APPDATA%\Folia\mods\`；
2. 设置 → 实验室 → 模组系统 打开总开关；
3. 启用并确认即可。

运行时只依赖这些**新机器上本来就有的**东西：

| 依赖 | 说明 |
| --- | --- |
| `we-follow.exe` | 模组自带，预编译 AnyCPU（只需 .NET Framework 4.x，Win10+ 自带） |
| `tasklist.exe` / `taskkill.exe` | Windows 自带 |
| PowerShell | 仅当 `we-follow.exe` 缺失时走 `follower.ps1` 回退，正常不会用到 |
| Wallpaper Engine | 必需，会扫描各盘 Steam 库自动找，路径不用配 |

## 上游署名

思路与实现参考：

- `XxHuberrr/Mineradio` v2.2.0（GPL-3.0-only）—— `desktop/wallpaper-engine-runtime.js`（`-playInWindow` 启动、
  窗口嵌入/跟随；本模组的静音方案见上文，与之不同）
- Wallpaper Engine 官方命令行 `-control openWallpaper/closeWallpaper`（`Skutta Software`）
