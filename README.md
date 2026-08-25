# Top Island

一个运行在 Windows 屏幕顶部的桌面灵动岛。它可以接收系统通知、展示当前播放与同步歌词，并在展开后连接本机的 Cursor 会话或 Codex CLI。

> 当前版本：`0.1.0` · 仅支持 Windows · [MIT License](./LICENSE)

## 功能特性

- **顶部灵动岛**：支持紧凑、半隐藏和全隐藏三种常驻状态。
- **自动悬停展开**：鼠标移到屏幕顶部露出的区域时弹出，离开后自动收回。
- **系统通知**：监听 Windows 通知中心，将微信等应用的 Toast 通知展示在岛上。
- **媒体与歌词**：同步播放器的真实进度，支持拖动跳转，并优先从本地词库、随后从在线曲库获取逐行歌词。
- **系统音量控制**：在音量页面直接调节 Windows 主音量或静音，滑块带有 Elastic Slider 弹性拉伸与回弹效果。
- **多页面面板**：顶部胶囊 Tabs 可切换对话、总览、媒体、音量和设置页面，并带有平滑过渡动效。
- **Cursor 对话**：读取并切换已打开的 Cursor 会话，通过 UI Automation 发送文字或图片，并把回复同步回岛内。
- **Codex 对话**：调用本机 `codex exec`，无需切换到 Codex 窗口即可查看回复。
- **托盘控制**：切换显示模式、展开面板、发送测试通知、播放演示歌词和退出应用。
- **全屏置顶**：透明窗口覆盖主显示器，岛外区域保持鼠标穿透；分辨率变化时会自动重新定位。

## 运行要求

| 能力 | 要求 |
| --- | --- |
| 基础运行 | Windows 10 / 11、Node.js 18+、npm |
| 系统通知 | Windows 通知访问权限；目标应用已启用系统通知 |
| 媒体歌词 | 支持 Windows SMTC 的播放器；网易云音乐 Windows 3.x 也可使用专用适配 |
| Cursor 对话 | 已打开 Cursor 及其聊天 / Agents 窗口 |
| Codex 对话 | 已安装并登录 Codex CLI，且 `codex` 可从 `PATH` 找到 |

## 快速开始

```bash
git clone https://github.com/Zzzzkd/top-island.git
cd top-island
npm install
npm run dev
```

应用启动后不会出现在任务栏，请通过 Windows 托盘图标进行控制或退出。

### 演示模式

如果只想查看交互效果，不监听真实系统通知和媒体会话：

```bash
npx electron-vite dev -- --demo-only
```

然后通过托盘菜单触发“演示：微信通知”或“演示：歌词”。

## 使用说明

### 显示模式

托盘菜单提供以下模式：

- **紧凑显示**：完整显示顶部胶囊。
- **半隐藏**：只在屏幕顶边露出一条，悬停后展开。
- **全隐藏**：默认藏到屏幕顶边，仍可通过托盘恢复。
- **放大 / 收回岛**：切换完整面板。

点击岛本身也可以展开面板；点击面板外的透明区域可以收回。展开后可通过顶部 Tabs 切换“对话 / 总览 / 媒体 / 音量 / 设置”页面。当前窗口定位以 **Windows 主显示器** 为准。

### Cursor / Codex 对话

展开面板后，可以在输入栏左侧切换 Cursor 或 Codex。

#### Cursor

- 自动发现当前打开的 Cursor 窗口和会话列表。
- 可以选择目标会话、发送文本、选择图片或粘贴剪贴板图片。
- 回复会定时同步到岛内，并按会话保存最近的本地展示记录。
- Top Island 只负责操作 Cursor 界面和读取回复；实际模型能力、工具调用与权限由当前 Cursor 会话决定。

#### Codex

- 通过本机 `codex exec --skip-git-repo-check -` 发送文本。
- 回复直接显示在岛内，不需要打开或切换 Codex 窗口。
- 当前 Codex 通道只发送文本；岛内图片附件用于 Cursor 通道。

Top Island 不使用 `OPENAI_API_KEY` 或 `CURSOR_API_KEY`，也不会把云端 API Key 保存在项目中。

## Windows 权限与兼容性

### 通知访问

打开：

```text
设置 → 隐私和安全性 → 通知 → 允许应用访问通知
```

同时确认微信或其他目标应用已启用 Windows 系统通知。托盘菜单中的“发送测试系统通知”和“打开通知权限设置”可以用于排查。

### 媒体会话与歌词

媒体进度与控制按以下优先级工作：

1. 对支持 Windows **System Media Transport Controls（SMTC）** 的播放器，直接读取系统提供的曲名、歌手、播放状态和真实时间轴，拖动进度条时调用 SMTC 跳转；
2. 网易云音乐 Windows 3.x 即使没有上报 SMTC，也会通过专用适配读取真实播放位置，并向播放器自己的播放条发送后台跳转操作；
3. 如果播放器只能通过窗口标题识别歌曲，Top Island 会继续尝试展示歌曲与歌词，但会将进度条标记为不可拖动，避免出现“看起来能拖、实际没有跳转”的情况。

歌词获取与显示：

1. 播放开始后，顶部小岛默认会持续显示当前歌词，暂停或停止后恢复原来的收起状态；可在“设置 → 悬浮歌词胶囊”中关闭常驻显示；
2. 顶部歌词岛和展开的“媒体”页面会显示歌曲封面，并同步展示歌词、播放进度和播放控制；
3. 优先读取 `src/main/sources/lyrics.ts` 中的本地词库；
4. 随后查询网易云音乐曲库，匹配成功时同时补充专辑名称与封面，再通过 [LRCLIB](https://lrclib.net) 精确查询和模糊搜索；
5. 查询前会清洗版本后缀、多歌手等信息，结果会在内存中缓存，获取失败时显示“歌手 · 歌名”。

在线歌词需要网络连接。若只有歌名而没有逐行歌词，请先确认播放器上报了正确的歌名、歌手和播放进度；也可以从托盘菜单选择“演示：歌词”验证界面和逐行切换效果。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Electron 开发模式 |
| `npm run build` | 构建主进程、预加载脚本和渲染页面 |
| `npm run preview` | 预览已构建应用 |
| `npm run start` | 与 `preview` 相同 |
| `npm run pack` | 构建未安装的 Windows 应用目录，便于本机测试 |
| `npm run dist` | 生成 NSIS 安装包到 `release/` |

生成的安装包名称类似：

```text
top-island-0.1.0-setup.exe
```

## 项目结构

```text
.
├─ resources/
│  ├─ scripts/
│  │  ├─ cursor-window.ps1       # Cursor 窗口自动化
│  │  ├─ watch-notifications.ps1 # Windows 通知监听
│  │  ├─ watch-smtc.ps1          # SMTC / 网易云真实时间轴监听
│  │  └─ control-media.ps1        # 播放控制与进度跳转
│  └─ tray-icon.png
├─ src/
│  ├─ main/
│  │  ├─ ai/                     # Cursor 与 Codex 连接
│  │  ├─ sources/                # 通知、媒体、歌词数据源
│  │  ├─ index.ts                # Electron 主进程、窗口、托盘与 IPC
│  │  └─ islandController.ts     # 灵动岛状态与交互控制
│  ├─ preload/                   # 安全暴露给渲染进程的 IPC API
│  ├─ renderer/                  # React 界面、面板页面与样式
│  └─ shared/types.ts            # 共享类型、尺寸和命中区域计算
├─ electron-builder.yml
├─ electron.vite.config.ts
└─ package.json
```

## 技术栈

- Electron 37
- React 19
- TypeScript 5
- electron-vite / Vite 6
- Motion for React
- PowerShell + Windows Runtime API
- electron-builder / NSIS

## 二次开发

| 修改目标 | 主要文件 |
| --- | --- |
| 岛的尺寸、顶部偏移、半隐藏高度 | `src/shared/types.ts` 中的 `PILL_SIZE`、`PANEL_SIZE`、`TOP_OFFSET`、`HIDDEN_SLIVER` |
| 展开、收回、通知停留和歌词切换逻辑 | `src/main/islandController.ts` |
| 窗口置顶、透明、主屏覆盖、托盘与 IPC | `src/main/index.ts` |
| 页面布局与交互 | `src/renderer/src/App.tsx` |
| 视觉样式 | `src/renderer/src/styles.css` |
| Windows 通知来源 | `src/main/sources/notifications.ts`、`resources/scripts/watch-notifications.ps1` |
| Windows 媒体来源 | `src/main/sources/media.ts`、`resources/scripts/watch-smtc.ps1` |
| 播放、切歌与进度跳转 | `src/main/mediaControl.ts`、`resources/scripts/control-media.ps1` |
| 本地词库或在线歌词源 | `src/main/sources/lyrics.ts` |
| Cursor 窗口读写 | `src/main/ai/cursorWindow.ts`、`resources/scripts/cursor-window.ps1` |
| Codex CLI 调用 | `src/main/ai/localApps.ts` |

通知、媒体和歌词分别通过 `NotificationSource`、`MediaSource`、`LyricSource` 接口解耦。实现新的数据源后，在 `src/main/index.ts` 中替换实例即可。

## 已知限制

- 当前只适配 Windows，且灵动岛显示在主显示器顶部。
- 系统通知与媒体监听依赖 Windows Runtime API 和 PowerShell。
- 网易云音乐 3.x 的专用时间轴与后台跳转依赖当前客户端模块和底部播放栏布局；网易云大版本更新后可能需要同步适配。
- Cursor 集成依赖其当前窗口结构；Cursor UI 大幅更新后，自动化脚本可能需要同步调整。
- Codex 通道当前不支持图片附件和流式增量显示。
- 项目暂未配置自动化测试、Lint 或 CI。

## License

[MIT](./LICENSE)
