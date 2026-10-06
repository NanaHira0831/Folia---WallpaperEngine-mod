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

1. **壁纸静音**（面板里的「静音壁纸音频」开关，默认开）：**WE 官方 `-control mute` + 系统音频会话静音**。
   两者都**不碰任何壁纸文件**，也**不改 WE 内部音频**，所以壁纸的音频响应（频谱条/音频颜色等可视化）照常工作。

   ```
   wallpaper64.exe -control mute        # WE 官方命令（覆盖显示器上的壁纸）
   we-follow.exe --mute-we 1            # WASAPI 会话静音（覆盖 -playInWindow 弹出窗口）
   ```

   为什么必须叠加第二条：**WE 官方 mute 管不到弹出窗口**。实测：下发 mute 后弹出窗口的音频会话峰值
   0.987 → 0.987 纹丝不动；而 WASAPI 会话静音能让同一个会话掉到 0.003。
   停用背景时会自动 `unmute` 并恢复会话静音。

   ### 走过的弯路（实测结论，避免以后再踩）

   | 尝试过的手段 | 结果 |
   | --- | --- |
   | 改 `scene.pkg`：把 `sound` 对象设为 `startsilent=true, volume=0` | 声音没了，但 WE 干脆不渲染这个声音（会话峰值 0.1507 → 0），**可视化跟着死**；且属于「动壁纸」，已彻底废弃 |
   | 只把 `volume` 压成 0（保留 `startsilent`） | 同样 0.1507 → 0，**可视化照样死** |
   | 覆盖壁纸自己的音量属性（如 `newproperty45`「音乐大小」） | 同样是压音量到 0，可视化同样失去数据 |
   | WE 内置的整张壁纸音量（属性 key = `volume`，WE 界面右侧那个滑块） | **命令行改不了**：官方文档写明 `applyProperties` 只能改「壁纸自己定义的属性」（Share JSON 里那份），内置 `volume` 不在其中；对桌面与弹出窗口实测都无效 |
   | 只发 `-control mute` | 管不到弹出窗口（见上） |

   顺带记两个坑：

   - **`applyProperties` 的退出码不可信**：WE 对不存在的属性名（瞎编的 `zzz_not_a_prop`）一样返回成功，
     所以「命令成功」不等于「属性生效」，只有真实存在的属性才会被应用。
   - **补丁包必须仍叫 `scene.pkg` 且独自放一个目录**：WE 的 pkg 约定是 `<名字>.pkg` 内部装 `<名字>.json`，
     当初把副本命名成 `folia-we-scene.pkg`，WE 就去找内部的 `folia-we-scene.json`，找不到 → 日志报
     `Failed parsing folia-we-scene.json with error: The document is empty.` + 黑屏。
     另外改写后的 JSON 必须**用空格补齐到原始长度**（`Buffer.alloc(entryLen, 0x20)`），索引偏移才不变。

   **代价（必须知道）**：桌面壁纸和弹出窗口由同一个 `wallpaper64.exe` 播放、共用同一个音频会话，
   所以用这个背景时**桌面壁纸的声音也会一起没有**（停用背景时自动恢复）。这是「保住可视化」必须付的代价，
   也是目前唯一能同时做到「没声音 + 可视化照跳 + 不动壁纸文件」的办法。

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
- 静音端到端（本机实测，用音频会话峰值判定可听性 —— 已用 WASAPI 静音验证过该读数会归零，可信）：
  - **WE 官方 `-control mute`**：命令退出码 0，但弹出窗口的音频会话峰值 0.987 → 0.987，**对弹出窗口无效**；
  - **WASAPI 会话静音**（`we-follow.exe --mute-we 1`）：同一会话峰值 0.987 → **0.003**，确实静音；
  - 因此最终方案 = 官方 mute（覆盖显示器壁纸）+ 会话静音（覆盖弹出窗口）。
- 「压音量到 0 会掐死可视化」的实测对照（同一张壁纸、同条件）：
  - 原始包：会话峰值 **0.1507**（音频流在走，可视化有数据）；
  - 只把 `sound.volume` 压成 0（保留 `startsilent`）：会话峰值 **0**；
  - 加上 `startsilent=true`：同样 **0**；
  - 覆盖壁纸自己的音量属性（`newproperty45`）也是压到 0 的同一条路。
- WE 内置整张壁纸音量（属性 key = `volume`）实测**改不了**：对桌面壁纸用 `-location Monitor0` / `-monitor 0` /
  不带定位三种写法发 `{"volume":0}`，会话峰值都稳定在 0.986～0.987；对弹出窗口发 `-location <窗口标题>` 同样无效。
  官方文档也写明 `applyProperties` 只能改「壁纸自己定义的属性」。
- 早期场景包补丁（已废弃）的结构与渲染验证：三体场景（158 MB）补丁后大小完全不变、`sound` 对象 1/1 已静音、
  回读校验通过；把原始 pkg 与补丁 pkg 分别开窗截图，非黑像素占比 82.7% vs 81.1%（都能正常渲染，不黑屏），
  WE 日志新增 0 条报错 —— 也就是说它**技术上可用，但会掐死音频监听**，所以不用它。
- 跟随器端到端：宿主窗口 `120,120→680,480` 时 WE 窗口精确贴合，移动到 `400,240→1100,740` 后同样贴合（相等=True）。
- 跟随器是**预编译的 `we-follow.exe`**（源码 `we-follow.cs`，用 `csc` 编译）：秒起，不依赖 PowerShell / Add-Type / csc。
  这样做是因为"运行时起 PowerShell + Add-Type 现编译"在 Electron 主进程里会静默失败，导致跟随器根本没起来。
- 自动启动：杀掉 WE 后点「启用」，检测到未运行 → 自动拉起 → 进程约 500ms 出现 → 控制通道第 1 次探测就绪。

## 安装 / 使用

1. **设置 → 实验室 → 模组系统** 打开总开关。
2. 把 `we-wallpaper` 整个文件夹放进 `%APPDATA%\Folia\mods\`。
3. 模组面板里启用 **「Wallpaper Engine 原生壁纸」** 并确认（只声明 `filesystem.data`）。
4. **Folia 命令面板搜「透明化」，开启** —— 否则看不到壁纸。
5. 展开模组 → 「Wallpaper Engine 原生壁纸」→ 点「启用」（默认用你 WE 当前壁纸；也可以在列表里点选别的）。
   或者命令面板搜「切换 Wallpaper Engine 原生壁纸」。

**不用再手动开 Wallpaper Engine**：点「启用」时会先检查 `wallpaper64.exe` 在不在；不在就自动拉起来，
并等它的 `-control` 通道就绪后才去开壁纸窗口。冷启动时主窗口可能还没就绪，所以顺序是
**先拉起 WE → 再轮询等主窗口（最多 15 秒）**，而不是先等窗口。

**壁纸声音**：面板里有「静音壁纸音频」开关（**默认开**），机制见上文第 1 条，
面板状态栏会直接告诉你当前这张是用哪一层静音的。

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
