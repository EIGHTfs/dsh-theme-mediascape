# 发布记录（Changelog）

> 本文件为版本发布历史权威档案，README「版本记录」章节仅保留引用（版本表外置 docs/版本记录.md）。

- **localforage 运行时库**：assets/vendor/localforage-bundle.js（从官方 dist 剥离 UMD 包装，build 注入 client.js 工厂体内实例化挂 `globalThis.localforage`——避免 UMD 覆盖客户端模块契约；支持 Blob/容量大，自动降级 IndexedDB/WebSQL/localStorage）
- **缓存门面 lfa\***：localforage 优先 + 自写 idb 兜底（lfaGetAll/lfaPut/lfaRemove，key 命名空间 `<store>:<id>`，与 idb store 同名对照）
- **音乐/封面读取接入**：covers/music 缓存读取改走 lfaGetAll（localforage 优先）
- 实测：localforage 挂载 + Blob 读写 roundtrip 通过、页面无错误；build 全绿


## 1.1.1（反代 token 捕获：媒体 Range 直连）

**dsh-theme-mediascape 1.1.1**——媒体请求绕开反代 302 重定向（Range 直通，首帧更快）：
- **服务端 token 捕获**（lib/media-token.js）：用 `/token=([A-Za-z0-9_-]{20,})/` 从 DSH 打印的访问地址里抓取 token。插件与宿主同进程、读不到已被消费的 stdout 管道，改为包装 `process.stdout.write`，在 DSH 打印访问地址的瞬间捕获（只读取输出分片、原样透传，不改变日志行为）；插件加载晚于打印时回读 `dsh-proxy.log` 兜底（日志路径按 `DSH_PROXY_LOG` / `DSH_HOME` 推导，不硬编码）
- **新增 API** `GET /theme-mediascape-assets/media-token`：下发当前 token（取不到返回空串）
- **前端媒体直连**：**所有媒体赋值点**统一经 `withMediaToken` 拼 token——开屏图片/视频、壁纸视频、壁纸图片背景（`background-image`）、预载 video/img、音乐封面，使 HTMLMediaElement 的 Range 请求被反代直接放行（不再 302 导致丢 Range、视频退化为全量下载）；token 晚于元素创建时修正已挂载媒体的 src（覆盖主路径，避免只覆盖视频而漏图片）
- **零耦合**：不依赖也不修改宿主；无鉴权代理的环境（本地直连、预览）行为与之前一致

## 1.1.0（命名空间清理 + 路径可移植化）

**dsh-theme-mediascape 1.1.0**——命名空间清理 + 公开插件可移植性优化（**支持 DSH `>=0.1.6-0 <0.3.0-0`**：0.1.6 开发验证 + 0.2.0-rc.2 实测可用；peerDependencies 声明 `@deepseek-ai/dsh`，防 0.3.0 破坏性变更）：
- **ff 前缀全去除**：ffFetch→apiFetch、ffIdbOpen/GetAll/Put/Delete→idb*、CSS 动画 ffFadeIn/ffTwinkle/ffStardust/ffSpin/ffFloat/ffBootPulse/ffGifIn→去 ff、常量 FF_DB_*/FF_FETCH_TIMEOUT_MS→去前缀（client-parts 7 文件 44 处）
- **硬编码路径全部自推导**（公开插件可移植）：test/e2e 与 theme-studio/tests 注入统一自推导块（pwviewer / pwviewer-libs / fonts 仓库邻居向上搜索 + env 覆盖 PW_ROOT / MS_CHROMELIBS / MS_FONTCONF / MS_CHROME / MS_BROWSERS / MS_PWIMPORT）；playwright 改动态 import、chromium launch 补运行库 env；start-preview.mjs 的 PATH 拼接改 dirname(process.execPath) 推导、playwright/chromium 改 SCRIPT_DIR 邻居推导；仓库内路径（preset/截图/测试页）与 DSH_HOME 改相对/env 推导
- **renderVideoLayer 拆分**：圈复杂度 52 → 拆 resolveVideoEl / applyVideoSrc / applyVideoAutoPlay 三个子函数（主函数留流程骨架），审计质量 85.1/A（0 拦截）
- **版本统一 1.1.0**（含 1.0.2 mht 快照还原预览 / 1.0.3 / 1.0.4 配色盘公共函数抽取 累积；package.json / online.js UA / CHANGELOG / README 同步）
- **localForage 媒体缓存接入**：assets/vendor/localforage-bundle.js（官方 1.10.0 剥离 UMD 包装，build 注入 client.js 工厂体内实例化挂 `globalThis.localforage`——避免 UMD 覆盖客户端模块契约；支持 Blob/大容量/自动降级 IndexedDB/WebSQL/localStorage）；缓存门面 lfaGetAll/lfaPut/lfaRemove（localforage 优先 + 自写 idb 兜底，key 命名空间 `<store>:<id>`）；音乐/封面缓存读取改走 lfaGetAll；实测 Blob 读写 roundtrip 通过、页面无错误
## 1.0.4（配色盘公共函数抽取 + 分体式文档外置）

**dsh-theme-mediascape 1.0.4**——配色盘代码优化与文档结构整理（行为零变化）：
- **公共函数抽取**：theme-swatch.js 重复样板归一——①`alphaOf`（不透明度三态取值 4 处归一：ROLEALPHA 优先→真源 alpha→1）②`apiPost`（/api/* fetch POST 样板 7 处归一：headers+body+resp.json）③`rightCellHtml`（右格行双分支 5 件套 HTML 合并，差异参数化 showColor/isUndef）
- **分体式文档外置**：版本记录/函数列表/目录结构三块从 README 拆到 docs/ 独立 md（带 dshgp 标记块，git-push 生成器 doc-version/doc-func/doc-tree 自动维护），README 改为引用链接
- **目录树登记**：tree-doc.json 补齐 38 个索引键（三外置文档/新版测试/vendor 等）
- **测试**：theme-swatch 三项回归通过（jscolor/preset-switch/screenshots）；doc-tree/doc-func/doc-version check 无漂移

## 1.0.3（配色盘层级 + 自动获取层级 + jscolor + 分片自动生成）

**dsh-theme-mediascape 1.0.3**——配色盘大规模升级：
- **颜色区父子层级显示**：colors 键可带 `parent`（父键名或组名），前端按拓扑先父后子渲染（虚拟组标题 + 子级缩进左边框，与胶囊区一致）
- **自动获取层级**：配色盘「🪄 自动获取层级」按钮——隐藏 iframe 加载宿主预览页 DOM，按稳定锚点（data-*/稳定类名尾缀）探测每个配色键元素，沿祖先链判定所属大区（左侧边栏/右侧边栏/会话区）写回 parent；新增 `/api/theme-hierarchy` 写回接口
- **jscolor 调色盘**：右格选色改用 GitHub EastDesire/jscolor 库（项目 vendor 本地化，删原生调色盘），点第 4 列色块呼出弹层色盘
- **分片模板兜底自动生成**：缺手写分片的键按 kind 自动生成示意骨架（8 类模板，--sw 实时色），19 键全有分片
- **元素注册 API 增强**：`/api/theme-register-element` 支持 `parent` 参数；胶囊注册联动
- **修复**：build.cjs 预览重启段漏 `DSH_THEME_NO_RESTART` 检查（配色应用/元素注册在预览进程内调 build 会杀掉服务自身）

## 1.0.2（mht 快照还原预览 + 假数据）

**dsh-theme-mediascape 1.0.2**——theme-studio 预览升级：直接解析 DSH 界面 .mht 快照还原为静态预览页（集成进 preview.html，非独立页面）：
- **mht 快照还原**：按 MIME multipart 解析 .mht（主 frame HTML + 全量 CSS），还原聊天框（消息流+composer）、左侧边栏、壁纸背景层、dock 悬浮框；资源 URL 相对化走 preview 服务器真实壁纸（视频/在线图）；剔除 eruda 调试工具与 mht 特有 cid 引用
- **假数据**：①操作日志内容 → 聊天框模拟用户消息（每次操作追加一条用户气泡）②任务列表：已有 todo 卡片第一个任务「预览页加载」，页面加载完成自动变 1/1 完成 ③工作区树假数据：一个文件夹（测试工作区）+ 一个会话（测试会话），删除真实 15 会话
- **侧边栏收起**：按 DSH 真实行为模拟（对照收起态快照）——收起时替换为 rail 形态 DOM（会话列表整个移除，非 CSS 隐藏）、56px 窄栏、品牌 logo railMark、aria 原文
- **默认隐藏**：操作日志面板与顶部预览态提示条默认隐藏，右下角「日志」开关调出
- 修正：collapsed 快照 DOM 补闭合（防聊天框被吞）、工作区树 slot 误填文字清空、URL 相对化保留根路径

## 1.0.1（审计优化）

**dsh-theme-mediascape 1.0.1**——审计整改（质量评分 78.9 → 80.9/B，0 拦截）：
- **大文件拆分**：handlers.js 763 行 → handlers.js(259)/handlers-upload.js(319)/handlers-log.js(191)（re-export 保 API）；utils.js 558 行 → utils.js(196)/utils-upload.js(363)（PART_ORDER 拼接共享作用域）；build.cjs 533 行 → 326 行 + 胶囊配方数据独立文件（build-parts/capsules-fallback.cjs）
- **函数拆分 15+**：apply（injectIdentityStyle/cleanupStaleDom/registerTheme/reorderDockButtons/lockDarkMode/setupEscClose）、startUploadHud（createUploadToggle/bindRowButtons/makeUploadBegin/Skip/Dispose）、uploadFiles（groupUploadByKind/dedupeByFileSize）、uploadOneFileXhr（settleUpload）、ambience（createAmbientDots/createAmbienceLine）、handleDelete（deleteWallpaperFile）、handleList（scanWallpaperDir/mergeOnlineWallpapers）、readDebugConfig（parseDebugConfig）、startFont（createFontToggle/createFontCycle）、removeSelected（collectSelectedWallpapers）、attachTypeKeydown（isEditableTarget）
- **图片主色提取 API**：window.__mediascapeDshExtractColors(img, count) 通用取色 + window.__mediascapeDshCurrentWallpaperColors() 当前图片壁纸取色（onload 加载，壁纸 URL 走 data 字段）
- **命名/超时/豁免**：模糊变量语义化 26 处（data/val/res/TMP→语义名）、外部请求补超时 6 处（AbortSignal.timeout）、反代 token 拼接豁免说明、test/ 目录 .samples 豁免标记
- 行为零变化：全量回归（上传/移除/列表/封面/配色盘/壁纸日志）+ 构建自测 + 预览渲染通过

## 1.0.0（首发）

**dsh-theme-mediascape 1.0.0 首发**——桌面媒体氛围主题（dock 工具条 + 壁纸/音乐/配色盘/开屏）。

### 核心界面与交互

- **dock 竖排工具条**（字/景/声/乐/传五个按钮）：景面板壁纸切换、乐面板音乐播放器、声面板打字音效开关、字面板四档字号调节（写宿主 `--dsh-content-font-size`）、传面板统一上传入口
- **开屏动画**：多画面轮换 + 时间轴渲染，开屏 `file:"auto"` 与视频壁纸共用同一份流，移交连续不中断
- **打字音效**：打字音乐开关，与壁纸音量调节独立
- **全局视觉**：文字描边、会话窗毛玻璃、模态去模糊、状态胶囊定稿

### 壁纸系统

- 图片/视频壁纸（**mp4/webm**，浏览器原生可播；`VIDEO_EXT` 单点权威判定）
- **在线资源**：仓库不内置素材，`lib/sources.json` 统一在线资源（hash 主键 + dirs 目录复制），启动自动下载（断点续传 + SHA-1 完整性校验）
- **视频 HTTP 缓存**：ETag（mtime-size 指纹）+ If-Range 条件请求，重播省 80% 流量
- **上传体系**：上传**中途不落盘**（内存缓冲，可用内存 20% 动态上限，超限转 `.tmp` 保底）→ **暂停落盘 `.part`、继续从 `.part` 续传**（`?offset=` 校验大小一致，不匹配返 409 杜绝残缺落盘；取消 `DELETE /upload/part` 清理快照）→ 上传完成落定自动清理同名孤儿 `.part`；**上传前「文件名+大小」去重预检**（重复文件二级面板「已跳过」）；上传完释放连接（串行不占满浏览器并发 6）
- **移除=真实删除**：删除服务器文件（音乐封面按 `music.json` 一并删并清登记）；上传/移除**开始前/结束后各刷新一次列表**；列表只返回「真实可用」项（stat 失败即剔除失效文件），前端去重/移除只认可用项
- 壁纸切换日志（运行态 `wallpaper.log`）、景模式三按钮合一、选择壁纸去随机按钮

### 音乐系统

- 背景音乐播放器（歌单/选择/播放控制）
- 上传/移除统一公共函数（按文件后缀识别壁纸/音乐，仅封面上传特殊）；移除按 `music.json` 删除封面并清登记

### 配色盘

- 只读一个真源 json（`theme-studio/json/theme-colors.json`，key 即元素 class），取色器左侧 = 元素色控件、右侧 = 预设包
- **元素行动态生成**：新增配色键只需改 colors 一处，前端自动出现元素行（按键名关键词推断渲染模板），编辑/应用/写盘全链路
- 配色键覆盖宿主元素：品牌区 sidebar-brand、文件树 body（panelBody）、sessionHeader 等；胶囊层级注入排序（父先子后自然覆盖）
- 配色 API：theme-current / apply / presets / export / rename / capsules（capsules-save / restart）

### 健壮性与性能

- 重复 apply/热重载**声音叠加修复**（幂等清理先停旧媒体再删元素）
- **serveStream 下载防退化**：1MB 大块传输 + 读流错误关连接 + 客户端中断释放源流
- 上传 XHR 无整体超时（大文件慢速上传不被掐断）；`.trash` 回收机制废弃清理；废弃 SHA-1 上传链路与 hidden 机制清理

### 测试与文档

- 服务端 API 回归测试（上传/续传/删除/列表/封面/真实可用 13 断言）
- **playwright 模拟点击**：上传/去重「已跳过」/壁纸音乐移除全流程（含 MP4 录屏与关键步骤截图，`test/e2e/videos/`）
- dock 与二级面板截图（`docs/screenshots/`）+ PR 配图清单 `screenshots.json`（awesome-dsh-plugin 规范）
- README 含 HTTP API 一览章节

