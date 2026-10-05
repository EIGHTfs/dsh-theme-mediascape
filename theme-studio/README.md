# theme-studio · 配色盘预览（网站）

配色盘预览网站（悬浮框预览接真实后端）：左侧 = 当前主题真源元素色，右侧 = 预设包颜色编辑；胶囊配方；元素自动注册 API；配色盘交互（jscolor 调色盘）。预览服务 `start-preview.mjs`（30999 端口，`start.sh start/restart/stop/status`）。

---

## 功能一览

| 区域 | 内容 |
|---|---|
| 左列（当前主题） | bg 三层（bg → bgSoft → bgLayer）、元素行（色号/色块/真实元素预览 iframe/不透明度） |
| 右列（预设包） | 每行 jscolor 调色盘 + 色块 + `← 应用`（套到左侧）；未定义元素为空可调色 |
| 按钮 | `← 套到左侧（全部）`（右→左）、`→ 套到右边（全部）`（左→右）、`⬇ 存为新预设`、`✏️ 改名`、`↺ 重置`、`⬇ 应用（真正写入）` |
| 胶囊区 | capsules.json 配方（运行态优先，缺失回退仓库），parent 父子层级缩进，enabled 开关 |
| 元素注册 | `POST /api/theme-register-element` 自动注册（className → 语义键 + 选择器，配色区/胶囊区） |

## 数据源

- 配色真源：`json/theme-colors.json`（colors 键 `{hex,alpha}` + bg 系）
- 预设包：`json/preset/*.json`（colors 键集合，不承载 bg 系）
- 胶囊配方：运行态 `$DSH_HOME/theme-mediascape/capsules.json`（缺失回退 `capsules.json`）
- 注册清单：`json/theme-register.json`（元素自动注册记录，build 注入 REGISTER_RULES）
- 元素说明：`comps.json`（text/kind 覆盖；未在 comps 的键由 roleRow 兜底从 colors 取 hex）

## 关键机制

- **右列取色优先级**：`RIGHTCOLOR[role]`（本次会话调色记录）→ 预设 swatches（按 colorKey 匹配）→ 空（未定义元素）
- **切换预设 = 真实读取**：change 事件重新 fetch `/api/theme-presets`（读盘）+ **清空 RIGHTCOLOR** + 重渲染右列
- **保存预设自动并入右列**：`exportPreset` 把 RIGHTCOLOR（右列调过色/导入的元素）合并进 colors——原未定义元素随右侧编辑自动进预设
- **jscolor 调色盘**：`js/vendor/jscolor.js`（GitHub EastDesire/jscolor，单文件零依赖）；显式 `new window.jscolor(el, opts)` 逐元素安装；色块（第 4 列）点击呼出

---

## 踩坑反思（2026-09-26 配色盘 bug 链）

以下为排查「右侧不按读取值显示 / 保存预设缺键 / 自动注册元素无颜色」等问题的根因与教训，防止重蹈覆辙。

### 1. swatches 按 hex 去重吞键（最隐蔽）
- 现象：右列某些元素（docPreview/textDocument/panelBody）不显示预设文件真实色。
- 根因：`/api/theme-presets` 构造 swatches 时用 `seen` Set **按 hex 去重**——多个元素键共用同色（如 `#362A56`）时只保留第一个键，后面的键被吞 → 右列按 colorKey 匹配不到 sw。
- 教训：**swatches 是「键 → 色」映射，必须按 key 逐条保留；按 hex 去重只适用于「颜色集合」类下拉池，不适用于元素行匹配**。修复：去掉 `seen` 去重。
- 排查教训：此 bug 与「切换预设重读」「清 RIGHTCOLOR」表面相似，若不先查 `/api/theme-presets` 返回结构与文件对比，会一直在前端缓存/刷新上打转。

### 2. 保存预设 hex 必须带 #
- 现象：右列调色/导入后保存，部分键缺失。
- 根因：`exportPreset` 合并 RIGHTCOLOR 时 `replace(/^#/,'')` 去掉了 `#`——服务端 `/api/theme-export` 只接受带 `#` 的 hex（正则 `^#[0-9A-F]{6}$`），无 `#` 直接丢弃该键。
- 教训：**服务端校验口径（带 #）必须与前端发送口径一致**；合并颜色时保留/补 `#`（`h.startsWith('#') ? h : '#' + h`）。

### 3. roleRow 兜底对象缺 hex
- 现象：API 自动注册的元素（docPreview 等，只写 colors 不写 comps）左格显示 `#888888` 灰色兜底。
- 根因：`roleRow()` 对不在 comps 的键返回无 hex 的默认对象 → `compCurrentHex` 拿不到 `c.hex`。
- 教训：**自动注册链路（colors + register）与前端显示链路（comps 带 hex）不同步**——兜底对象必须从 `THEME.colors[role].hex` 取色，否则注册了也显示不出。

### 4. 切换预设必须清 RIGHTCOLOR
- 现象：切换预设后右列没变化（仍显示上次套右边/调色的值）。
- 根因：右列取色 `RIGHTCOLOR[role]` 优先于预设色——RIGHTCOLOR 是内存缓存，切换预设不清会残留。
- 教训：**任何「读取/切换」类操作，先清会覆盖显示的内存状态，再读真实数据源重渲染**。

### 5. jscolor 集成三坑
- `data-jscolor` 必须**严格 JSON**（key 加引号）——非严格 JSON 在默认 `looseJSON=false` 下解析失败，元素静默不安装。
- 动态渲染的行**不能用 `jscolor.init()`**——init 有 `initialized` 门（DOMContentLoaded 首扫后不再重扫）；必须**显式 `new window.jscolor(el, opts)`** 逐元素安装（已装 `el.jscolor` 跳过）。
- 空值元素（预设未定义）配置 `required:false`，否则空 value 安装失败。

### 6. 服务进程内 build 会自杀（应用/注册后服务崩）
- 现象：配色应用/元素注册后预览服务死（网页全 000）。
- 根因：API 在预览进程内 `execSync build` → build.cjs 末尾「debug preview 开 → start.sh restart」**无条件重启预览，杀掉正在处理请求的进程自己**。
- 教训：build 的 restart 段必须尊重 `DSH_THEME_NO_RESTART=1`（应用/注册类 API 传该 env 跳过重启，产物下次加载生效）。

### 7. 修改 start-preview.mjs 后必须重启预览
- 预览服务是常驻进程，改 `start-preview.mjs` **不会热生效**——改完必须 `bash theme-studio/start.sh restart`，否则路由/逻辑仍跑旧代码（实测 API 404/行为不变，误判为"代码没问题"）。
- 前端 `/js/*`、`/theme-swatch.html` 为静态直读磁盘，改后刷新页面即生效（无需重启）。

---

## 一键测试

`../test/e2e/theme-swatch-jscolor-check.mjs` —— jscolor 挂载/色块呼出/选色事件链。
`../test/e2e/theme-swatch-preset-switch-check.mjs` —— 切换预设真实读取（含 RIGHTCOLOR 非空场景，零污染自动还原）。

运行：`node ../test/e2e/<脚本>`（需 30999 预览在跑；环境变量可覆盖 `MS_PREVIEW`/`MS_CHROME` 等）。
