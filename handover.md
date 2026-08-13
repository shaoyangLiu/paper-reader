# Paper Reader — 开发交接文档 (Handover)

> 最后更新：2026-08-14
> 适用环境：Windows 11 + Python 3.13.12（WorkBuddy 托管运行时）+ 浏览器（localhost 安全上下文）

---

## 1. 项目概览

一个**本地论文阅读器**，配合 WorkBuddy 生成的中文翻译 HTML 使用。核心诉求：读论文时先看法文翻译，再对照原文 PDF，并能在翻译/原文上做标注、截图悬浮对照。

**技术选型（已与用户确认）**：原生 HTML/CSS/JS 前端 + Python 标准库 `http.server` 本地服务器 + 内置 PDF.js。无构建步骤、无 pip 依赖。

**为什么需要服务器（不是直接双击 HTML）**：
- `file://` 协议下无法读取同文件夹的 PDF、无法用 `fetch` 保存标注 JSON。
- 截图悬浮依赖 `getDisplayMedia` / `html2canvas`，这些只在 `localhost` 或 `https` 安全上下文可用。
- 用 `localhost:8731` 一次性解决：读文件 + 存标注 + 截图。

---

## 2. 文件清单

```
D:\Programming\PythonProject\paper-reader\
├── server.py            # 本地服务器（标准库 http.server）
│                         #   - LIT_ROOT 硬编码指向论文文件夹（见下方常量）
│                         #   - /api/papers 列论文  /api/paper 读 HTML/PDF
│                         #   - /api/annotations GET/POST 存取旁置标注
├── reader.html          # 阅读器主页面（工具栏 + 双栏 + 浮层结构）
├── app.js               # 全部前端逻辑（vanilla JS, "use strict"）
├── styles.css           # 暗色主题样式
├── vendor\
│   ├── pdf.min.js           # PDF.js 3.11.174（内置，离线可用）
│   ├── pdf.worker.min.js    # PDF.js worker
│   └── html2canvas.min.js   # html2canvas 1.4.1（区域截图用）
├── start-reader.bat     # 一键启动（起服务器 + 开浏览器）
├── reset-reader.bat     # 一键修复（清端口旧进程 + 重启 + 开浏览器）
└── handover.md          # 本文件
```

**论文与标注存放位置（程序不修改、不搬动）**：
```
C:\Users\z3450390\OneDrive - UNSW\Desktop\OneDrive Sync\Literature\
└── <论文名>\                  # 每篇一个子文件夹
    ├── <原文>.pdf
    ├── 论文翻译_<中文名>.html   # WorkBuddy 生成的翻译页
    └── 论文翻译_<中文名>.anno.json  # 标注旁置文件（阅读器自动生成）
```

**关键常量（server.py 顶部）**：
- `LIT_ROOT` = 上述 Literature 文件夹路径
- `PORT` = 8731

> ⚠️ 论文/标注路径与程序路径**完全分离**。改论文放哪、加新论文，只动 Literature 文件夹；改代码，只动 `D:\Programming\PythonProject\paper-reader\`。

---

## 3. 完整修改历程（按时间顺序）

### 3.1 初版构建（2026-08-13）
- 读取 Literature 文件夹结构：每篇论文 = 子文件夹（PDF 原文 + 翻译 HTML）。
- 下载内置 PDF.js 3.11.174（cdnjs），写入 `vendor/`。
- 编写 `server.py`：论文列表 API、文件服务（HTML→`text/html`，PDF→`application/pdf`）、标注存取（旁置 `.anno.json`）。
- 编写前端 `reader.html` / `app.js` / `styles.css`：
  - 双栏阅读：左 = 翻译 iframe，右 = PDF.js 渲染原文。
  - 视图切换：双栏 / 翻译 / 原文。
  - 标注（v1 **仅中文翻译 HTML**）：选中文字 → 色块高亮 + 笔记；存为 `<翻译名>.anno.json` 旁置；不改动原 HTML；浏览器直开 HTML 看不到标注；笔记抽屉可列/跳/删。
  - 截图悬浮（v1）：用系统 `getDisplayMedia` 全屏/窗口捕获 → 浮窗。
- 编写 `start-reader.bat`（用 `%~dp0` 自适应路径 + 托管 Python 路径）。
- 验证：`node --check`、`py_compile` 通过；`/api/papers`、`/api/paper`、`/api/annotations` 存读全通。

### 3.2 第一次增强：应用内截图 + 字体滑块 + PDF 侧标注
- **应用内截图**：引入 `html2canvas`，新增「截图对象」下拉（原文图/翻译/整页/系统截屏），截阅读区内容并悬浮（替代纯系统截屏，免选屏弹窗）。
- **字体滑块**：顶栏 `Aa` 滑块（100%–250%），用 CSS `zoom` 应用到翻译 iframe 与 PDF 容器；视图切换/换论文后重应用。
- **PDF 侧标注（消除"仅翻译可标注"限制）**：开启 PDF.js 文本层，原文可选中 → 选词弹色块/笔记 → 按页存矩形高亮覆盖层；与翻译标注共用同一 `.anno.json`（`source` 字段区分）；笔记抽屉按 `原文 P{n}` / `翻译` 标签列出。

### 3.3 搬家：C:\ → D:\Programming\PythonProject\paper-reader\
- 用户要求把程序剪切到 `D:\Programming\PythonProject\paper-reader\`。
- 校验 `start-reader.bat`（`%~dp0` 自适应）与 `server.py`（`LIT_ROOT` 指向 Literature、`APP_DIR` 取自带路径）→ 搬家零改代码。
- 停旧服务器、复制、删旧文件夹、从新位置重启验证通过。

### 3.4 修复：网页打不开（ERR_EMPTY_RESPONSE）→ reset-reader.bat
- **根因**：多次启动服务器后，旧进程堆积在 8731 端口却不响应，请求被僵尸进程抢到 → 返回空响应。
- **解决**：新增 `reset-reader.bat`，双击即：
  1. PowerShell `Get-NetTCPConnection -LocalPort 8731 -State Listen` 找出全部占用进程 → `Stop-Process -Force` 清理；
  2. `start "PaperReader-Server" python server.py` 重启；
  3. 开浏览器 `http://localhost:8731/`。
- 注：`start-reader.bat` 与 `reset-reader.bat` 区别仅在于 reset 多了"清端口"一步；网页打不开优先用 reset。

### 3.5 修复：分隔条只能往右拉，不能往左拉
- **根因**：分隔条左侧是 `<iframe>`（翻译 HTML）。往左拖时鼠标进入 iframe，iframe 截获鼠标事件，父窗口 `mousemove` 停止触发 → 左拖失效。
- **解决**（`app.js` `bindSplitter`）：`mousedown` 时给 iframe 加 `pointer-events: none`，`mouseup` 恢复。拖拽中 iframe 短暂不可交互（<1s），松手即恢复，不影响阅读/标注。

### 3.6 修复：点「翻译」按钮不是全屏
- **根因**：分隔条拖拽时给 `paneTrans` 写了内联 `flex: 0 0 Npx`，切到翻译单栏视图时该内联样式未被清除，翻译页卡在固定宽度。
- **解决**（`app.js` `applyView`）：切到单栏（翻译/原文）时清除两栏内联 `flex`，让 CSS 接管 → 翻译页与原文页一样全屏。双栏时保留用户拖好的宽度。

### 3.7 重写：截图改为「框选区域」
- **用户需求**：点截图后**让用户框选区域**，而不是把整块（全屏）截图再悬浮。
- **改动**：
  - 删除「截图对象」下拉（原文图/翻译/整页/系统截屏）及 `screenShot()`（getDisplayMedia）逻辑。
  - 点「📸 截图」→ 阅读区蒙半透明遮罩（`#shot-overlay`）+ 十字光标 → 拖拽生成选择框（`#shot-sel`）→ 松手用 `html2canvas(viewer)` 渲染阅读区并裁剪到所选区域 → 浮窗。
  - 区域过小（<8px）或按 **Esc** 取消。
  - 新增 CSS：`.shot-overlay` / `.shot-sel` / `.shot-tip`。

### 3.8 增强：浮窗保存按钮 + 任意位置拖拽
- **保存按钮**：浮窗顶部栏新增 `💾`，点击 `link.download = screenshot_时间戳.png` 下载到浏览器默认下载目录。
- **任意位置拖拽**：拖拽监听从 `bar.mousedown` 移到 `box.mousedown`（排除 BUTTON/INPUT）；图片 `img` 设 `pointer-events: none` 让 mousedown 穿透到外层容器 → 点图片任意位置都能拖。

---

## 4. 关键设计决策

1. **标注零侵入**：标注永远存为独立 `.anno.json` 旁置文件，原 HTML/PDF 一字不改。普通浏览器直接打开翻译 HTML 看不到任何标注。
2. **localhost 安全上下文**：为同时满足「读同文件夹文件 / 存标注 / 截图」三件事。
3. **iframe pointer-events 技巧**：分隔条拖拽与浮窗拖拽都靠临时禁用 iframe 事件穿透解决"鼠标被 iframe 抢走"的经典问题。
4. **滚动同步是比例对齐**：双栏滚动同步按"阅读进度比例"对齐（30% ↔ 30%），非逐句对齐（翻译与 PDF 结构不同，无法精确对应）。
5. **端口自愈**：reset-reader.bat 用 PowerShell 按端口精确杀进程，避免 netstat+findstr 在部分环境下解析不稳。

---

## 5. 已知限制

- ⚠️ **翻译 iframe 区域框选为空**：`html2canvas` 不渲染 iframe 内部内容。框选 PDF 原文（canvas）正常；框选翻译栏会得到空白。如需"框选翻译文字"，需单独对 `iframe.contentDocument.body` 做截图补充。
- ⚠️ **PDF 标注依赖文本层**：扫描版/图片型 PDF 无文本层，无法选词高亮（只能截图标注重）。
- ⚠️ **滚动同步非逐句**：见 §4.4。
- ⚠️ **字体放大时截 PDF**：`zoom` 放大后截 PDF 可能因缩放略有偏差（不影响阅读）。

---

## 6. 运行与修复

| 场景 | 操作 |
|---|---|
| 首次/日常启动 | 双击 `start-reader.bat`（自动起服务器 + 开浏览器） |
| **网页打不开** | 双击 `reset-reader.bat`（清端口旧进程 + 重启） |
| 停止服务 | 关闭弹出的 "PaperReader-Server" 黑窗口 |
| 改前端（html/js/css） | 改完浏览器**硬刷新 Ctrl+Shift+R** 即生效 |
| 改 server.py | 需重启 bat |
| 加新论文 | 直接放进 Literature 对应子文件夹，刷新页面即出现 |

服务器地址：**http://localhost:8731/**

---

## 7. 待办 / 可扩展（用户可能要的下一步）

- [ ] 支持「框选翻译区域」截图（html2canvas 对 iframe 内文档单独渲染）。
- [ ] 「一键截整页 PDF / 整页翻译」快捷键/按钮（框选的便捷替代）。
- [ ] 标注导出（如导出全部高亮+笔记为 Markdown/HTML 报告）。
- [ ] 多论文标注汇总检索。
- [ ] 桌面快捷方式 / 开机自启（用户曾提及，未做）。
