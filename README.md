# Top Island

Windows 顶部灵动岛：平时半藏或全藏，微信等系统通知从顶部弹出，正在播放时显示歌词。

MIT 开源，适配层可替换，方便继续改。

## 运行

```bash
npm install
npm run dev
```

托盘菜单可以切换：

- 紧凑显示
- 半隐藏（顶部只露一条）
- 全隐藏
- 演示微信通知 / 演示歌词

加 `--demo-only` 可关掉系统监听，只走演示数据。

岛内可以发送只读分析（不执行代码）。展开岛后底部输入条选 Cursor / Codex / OpenAI，回车发送。需要环境变量 `CURSOR_API_KEY` 或 `OPENAI_API_KEY`。

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

接口都很小：`NotificationSource`、`MediaSource`、`LyricSource`。换数据源时实现对应接口，在 `src/main/index.ts` 里换掉实例即可。

## 系统权限

1. **通知**：设置 → 隐私和安全性 → 通知 → 允许应用访问通知。微信等应用也必须打开「系统通知」。托盘里可发测试通知、打开权限页。
2. **歌词**：播放器要把媒体会话报到 Windows SMTC。网易云、QQ 音乐、Spotify、部分浏览器标签页通常可以；部分绿色版播放器不会报。

## 打包

```bash
npm run dist
```
