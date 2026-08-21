# Top Island

Windows 顶部灵动岛。平时半藏或全藏在屏幕顶边，微信等系统通知会从顶部弹出，正在播放时可显示歌词。点开岛还能把话发给本机已打开的 **Cursor** 窗口，或调用本机 **Codex CLI**，回复同步显示在岛上。

MIT 开源。通知 / 媒体 / 歌词都是小接口，方便换数据源。

仓库：https://github.com/Zzzzkd/top-island

## 需要什么

- Windows 10 / 11
- Node.js 18+
- 岛内 Cursor 对话：本机要先打开 Cursor 聊天窗口
- 岛内 Codex：本机已安装并登录 Codex CLI

## 运行

```bash
npm install
npm run dev
```

只看演示、不听系统通知和正在播放：

```bash
npx electron-vite dev -- --demo-only
```

托盘菜单可以：

- 紧凑显示 / 半隐藏（顶部只露一条）/ 全隐藏
- 放大或收回岛
- 发送测试系统通知、打开通知权限页
- 演示微信通知 / 演示歌词

悬停到露出的那一条会弹出；鼠标离开后收回。点击岛可放大成面板。

## 岛内对话

放大岛后，底部输入条发给当前选中的 Cursor 会话（也可切 Codex）。支持选图、粘贴图片，回车发送。

- **Cursor**：通过 UI Automation 写入当前 Cursor 窗口，回复同步回岛上。不执行代码，也不走 `CURSOR_API_KEY`。
- **Codex**：调用本机 `codex exec`，回复显示在岛上，不用切到 Codex 窗口。

旧文档里的 OpenAI / API Key 已不适用。

## 系统权限

1. **通知**：设置 → 隐私和安全性 → 通知 → 允许应用访问通知。微信等应用也必须打开「系统通知」。托盘里可发测试通知、打开权限页。
2. **歌词**：播放器要把媒体会话报到 Windows SMTC。网易云、QQ 音乐、Spotify、部分浏览器标签页通常可以；部分绿色版播放器不会报。歌词先查本地演示词库，再请求 [LRCLIB](https://lrclib.net)。

## 打包

```bash
npm run pack   # 未打包目录，方便自测
npm run dist   # 生成 NSIS 安装包到 release/
```

安装包名类似 `top-island-0.1.0-setup.exe`。

## 怎么改

| 你想改 | 文件 |
|--------|------|
| 岛的尺寸、半藏露出高度 | `src/shared/types.ts` 里的 `PILL_SIZE` / `HIDDEN_SLIVER` |
| 展开、收回、通知停留时间 | `src/main/islandController.ts` |
| 窗口样式（置顶、透明、全屏上也显示） | `src/main/index.ts` |
| 外观 | `src/renderer/src/styles.css`、`App.tsx` |
| 通知来源 | `src/main/sources/notifications.ts` + `resources/scripts/watch-notifications.ps1` |
| 正在播放 | `src/main/sources/media.ts` + `resources/scripts/watch-smtc.ps1` |
| 歌词源（本地词库 / LRCLIB） | `src/main/sources/lyrics.ts` |
| Cursor 窗口读写 | `src/main/ai/cursorWindow.ts` + `resources/scripts/cursor-window.ps1` |
| Codex CLI | `src/main/ai/localApps.ts` |

接口：`NotificationSource`、`MediaSource`、`LyricSource`。换数据源时实现对应接口，在 `src/main/index.ts` 里换掉实例即可。
