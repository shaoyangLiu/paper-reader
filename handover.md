# Paper Reader — 开发交接文档 (Handover)

> 最后更新：2026-08-14
> 适用环境：Windows 11 + Python 3.13.12（WorkBuddy 托管运行时）+ 浏览器（localhost 安全上下文）

---

## 1. 项目概览

一个**本地论文阅读器**，配合 WorkBuddy 生成的中文翻译 HTML 使用。核心诉求：读论文时先看中文翻译，再对照原文 PDF，并能在翻译/原文上做标注、截图悬浮对照。

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

### 3.9 修复：浮窗不能调整大小
- **根因**：§3.8 把拖拽监听移到 `box.mousedown` 后，会**拦截掉浮窗右下角的原生 resize 手柄**（原生 `resize: both` 的手柄也在 box 内），导致点右下角变成了拖动而非缩放；且透明度滑条（`.fi-op`）位于右下角，与 resize 手柄重叠进一步挡住。
- **解决**：
  - 移除 CSS `resize: both`，改为在 `addFloatImage` 里新增专用 `.fi-resize` 手柄（右下角，带斜纹视觉提示），用 JS 实现缩放（限制最小 120×80）。
  - 拖拽监听排除 `.fi-resize`（手柄 `mousedown` 调 `stopPropagation` 防止触发拖动）。
  - 透明度滑条 `.fi-op` 从 `right` 改到 `left`，避免与右下角 resize 手柄重叠。

### 3.10 修复：浮窗只能缩小不能变大 + 新增翻译配色功能
- **浮窗放大修复**：根因是 §3.8 之前把拖拽监听移到 `box.mousedown` 后，右下角原生 resize 手柄被拦截；且当时透明度滑条位于右下角，挡住手柄 → 拖右下角放大时实际点到滑条(INPUT)被忽略，只有往内拖(未被挡)能缩小。§3.9 已把滑条移到左下角，本次进一步：① 把手柄从 16px 放大到 22px（`z-index:4; pointer-events:auto`）；② resize 监听改用 `setPointerCapture` + `box._resizing` 标志，确保拖出手柄范围也能持续缩放、且缩放时不会误触发拖动。现在右下角手柄可双向拖拽缩放（min 120×80）。
- **翻译界面配色（新功能）**：顶栏新增 🎨背景色 / 🔤文字色 取色器 + ↺复位。
  - `applyTransTheme()` 向翻译 iframe 注入 `<style id="reader-trans-theme">`：`html,body{background}` + `body,body*{color}`，用 `!important` 覆盖翻译 HTML 自带暗色主题。
  - 在 `iframe` 的 `load` 事件中调用，故换论文/重载后自动重应用。
  - 选择存入 `localStorage`（`pr_transBg`/`pr_transFg`），刷新页面保留；复位恢复默认 `#14141c / #e6e6e6`。
  - 仅作用于翻译 iframe，不影响 PDF 原文与浮窗。

### 3.13 §3.13 阅读位置书签 (2026-08-14, commit 17222a6)
- **新功能**：🔖 按钮打开书签抽屉，保存**当前视图模式 + 字体缩放 + 双栏左右滚动位置 + 备注**。
- 数据写入同一 `<翻译名>.anno.json`（新增 `bookmarks` 数组，与 `annotations` 并列）；`/api/annotations` POST 改为同时保存 `{ annotations, bookmarks }`，用临时文件 + `rename` 原子写避免半截。
- 跨会话持久：`openPaper` 载入时读 `bookmarks` 并渲染；点击书签 → `applyBookmark()` 恢复视图/缩放/滚动。
- 列表可删除单条。

### 3.14 §3.14 标注范围修复：更多选区可标注 (2026-08-14, commit a4148e9)
- **根因**：`ANNO_SEL` 只含 `p, .fig-caption, h2, h3, li` 等少数选择器，选中作者/机构等 `div/section/h1/h4` 文本时弹不出标注选项。
- **修复**：`ANNO_SEL` 扩充到 18 个选择器（加 `div/section/article/h1/h4-h6/td/th/blockquote/pre/figure/figcaption`）；`blockOf()` 兜底返回 `iframeDoc.body` 并设置 `data-bidx`，确保任何选中都有标注入口。

### 3.15 §3.15 截图放大坐标修复（决定性根因）(2026-08-14, commit 0950ea2 → c135720)
- **用户现象**：100% 框选正常，放大（160%/200%）后裁剪区域错位（截到标题 / 不是框选内容）；翻译窗口放大同样错位。
- **决定性根因**：`vendor/html2canvas.min.js` 是 **1.4.1**，整份源码 `zoom` 出现 **0 次**——html2canvas **完全忽略 CSS `zoom`**，永远按「未缩放逻辑布局 × scale」渲染。`.trans-frame` 经核对 `border:none`，无边框偏移。
- **前 5 次失败的共同错误**：用 `scrollLeft`（单位随 zoom 变化）把"屏幕坐标"和"文档坐标"在**不同缩放空间**相加/折算，导致 z>100% 整体偏移。
- **最终修复**（`captureIframeRegion` 重写）：完全不碰 zoom、不依赖 `scrollLeft`。
  - `iframeDoc.body.getBoundingClientRect()` 取 body 在屏幕上的**真实**位置（已含 zoom）；
  - 屏幕选区角点 → 逻辑坐标：`(selX − bodyLeft) / z`（`z` = 字体滑块值）；
  - 裁剪：`逻辑坐标 × 2`（`scale=2`）。数学上与「zoom=1 直接 html2canvas 该元素」的 ground truth 完全等价。
- 附带 `zoom-crop-test.html` 自验台：拉 Zoom 到 200% 点 Run test，看 `pixel match ratio`（>90% 即 PASS）。

### 3.16 §3.16 浮窗透明度改为真透明 (2026-08-14, commit 11c85e0)
- **用户现象**：图片下方滑块看着像"明暗度"调整，拉低只是变暗。
- **根因**：滑块代码早已绑定 `img.style.opacity`（并无 brightness 代码），让人误判的是 `.float-img` 的 `background:#000`——透明度调低时露出**黑色浮窗底板**，所以像变暗而非看穿页面。
- **修复**：`.float-img` 背景 `#000` → `transparent`。现在滑块是**真正透明度**，图片变透明时透出下方页面，可左右对照原文/翻译。滑块下限仍为 20%（避免浮窗彻底消失）。

### 3.17 §3.17 浮窗八向缩放 (2026-08-14, commit 4898b2c)
- **用户需求**：原来只有右下角一个缩放手柄，要四边 + 四角都能缩放。
- **改动**（`addFloatImage`）：
  - 删除单一 `.fi-resize` 手柄，改为 8 个 `.fi-h` 手柄（`n/s/e/w/ne/nw/se/sw`），带 `data-dir`，平时隐藏、hover 浮窗时显示高亮。
  - 新增通用 `startResize(dir, e)`：`n/w/ne/nw/sw` 这些**移动原点**的手柄会重算对边锚点（对面保持不动，不会反向拉伸）；最小尺寸仍 120×80 自动停住。
  - `.float-img` 加 `box-sizing: border-box`，保证 CSS 宽高与缩放计算完全一致（否则边框累积 4px 偏移）。
- **服务器自愈补充**（同日）：发现旧进程卡在 8731 端口返回空响应（wedged PID），`reset-reader.bat` / `start-reader.bat` 已加固——先 `Get-NetTCPConnection -LocalPort 8731` 精确杀占用进程 → 重启 python → `curl` 健康检查（需 HTTP 200）→ 再开浏览器。

---

## 4. 关键设计决策

1. **标注零侵入**：标注永远存为独立 `.anno.json` 旁置文件，原 HTML/PDF 一字不改。普通浏览器直接打开翻译 HTML 看不到任何标注。
2. **localhost 安全上下文**：为同时满足「读同文件夹文件 / 存标注 / 截图」三件事。
3. **iframe pointer-events 技巧**：分隔条拖拽与浮窗拖拽都靠临时禁用 iframe 事件穿透解决"鼠标被 iframe 抢走"的经典问题。
4. **滚动同步是比例对齐**：双栏滚动同步按"阅读进度比例"对齐（30% ↔ 30%），非逐句对齐（翻译与 PDF 结构不同，无法精确对应）。
5. **端口自愈**：reset-reader.bat 用 PowerShell 按端口精确杀进程，避免 netstat+findstr 在部分环境下解析不稳。

---

## 5. 已知限制

- ✅ **翻译 iframe 区域截图**：已支持（`captureIframeRegion` 对 iframe 文档单独渲染）；框选跨双栏会分别截取再合成。见 §3.12、§3.15。
- ⚠️ **PDF 标注依赖文本层**：扫描版/图片型 PDF 无文本层，无法选词高亮（只能截图标注重）。
- ⚠️ **滚动同步非逐句**：见 §4.4。
- ✅ **字体放大后截图**：已修复。html2canvas 1.4.1 忽略 CSS `zoom`，新版用 `getBoundingClientRect` + `÷缩放倍数` + `×2` 精确裁剪，放大到 250% 也准确。见 §3.15。

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

## 6.5 §3.11 配色修复 + 取色器标签 + 文件夹选择器 (2026-08-14)

### 修复：翻译配色不生效
- **根因**：翻译 HTML 使用 CSS 变量（`--bg: #1a1a2e`, `--card-bg: #16213e`），多个内部元素（`.paper-header` / `.container` / `.fig-caption` 等）各有独立背景色。原 `applyTransTheme()` 只设了 `html, body { background }`，未覆盖这些元素。
- **修复**：改为 `body *, *::before, *::after { background-color: ${bg} !important; color: ${fg} !important }` 全量覆盖；排除 `img/canvas/svg/iframe/video` 保持透明；边框色随文字色变淡。

### 改进：取色器加文字标签
- 原来只有 emoji 图标（🎨 / 🔤），用户无法区分哪个是背景、哪个是文字。
- 现在每个取色器前加 `<span class="tb-color-label">背景</span>` / `文字` 标签；复位按钮加「复位」二字；外层用 `.tb-color-group` 包裹。

### 新功能：文件夹选择器
- **位置**：侧栏「论文库」标题右侧，📂 选文件夹按钮。
- **流程**：点击 → `<input webkitdirectory>` 弹文件夹选择器 → 用户选目录 → 提取文件夹名 → POST `/api/set-folder` → 服务器在当前 LIT_ROOT 的**同级目录**查找该文件夹 → 找到则切换全局 LIT_ROOT → 前端重载论文列表 → 路径显示在侧栏 `#folder-path`。
- **持久化**：路径存 localStorage (`pr_litFolder`)，刷新页面后自动恢复显示。
- **服务端**：`server.py` 新增 `/api/set-folder` POST 端点，修改全局 `LIT_ROOT` 变量。
- **限制**：只能选 LIT_ROOT 同级目录下的子文件夹（浏览器安全限制无法获取完整绝对路径）。

---

## 6.6 §3.12 截图修复：iframe 内容捕获 + 浮窗位置/大小跟随 (2026-08-14)

### 问题
1. **翻译栏（iframe）截图空白**：`html2canvas(viewer)` 无法渲染 `<iframe>` 内部内容，截取左栏翻译时浮窗显示全白。
2. **浮窗位置/大小固定**：`addFloatImage()` 硬编码 `left:60px; top:80px; width:320px; height:220px`，不跟随框选区域。

### 修复
1. **按面板分路截图**：`captureRegion()` 检测框选区域落在哪个面板：
   - 仅在翻译栏 → `captureIframeRegion()`：用 `html2canvas(iframeDoc.body, { window: iframe.contentWindow })` 单独渲染 iframe 文档内容，再裁剪框选部分。
   - 仅在 PDF 栏 → `capturePdfRegion()`：原逻辑不变（PDF canvas 本身可被 html2canvas 渲染）。
   - 跨两栏 → `captureCompositeRegion()`：分别截取两部分再合成到同一 canvas。
2. **浮窗位置/大小跟随**：`addFloatImage(url, x, y, w, h)` 接受框选坐标和尺寸，浮窗初始位置=框选位置、初始大小=框选大小。

---

## 7. 待办 / 可扩展（用户可能要的下一步）

- [x] 支持「框选翻译区域」截图（iframe 单独渲染 + 放大坐标修正，见 §3.12 / §3.15）。
- [x] 浮窗八向缩放（四角+四边，见 §3.17）。
- [x] 浮窗透明度真透明（见 §3.16）。
- [x] 阅读位置书签（见 §3.13）。
- [ ] 「一键截整页 PDF / 整页翻译」快捷键/按钮（框选的便捷替代）。
- [ ] 标注导出（如导出全部高亮+笔记为 Markdown/HTML 报告）。
- [ ] 多论文标注汇总检索。
- [ ] 桌面快捷方式 / 开机自启（用户曾提及，未做）。
