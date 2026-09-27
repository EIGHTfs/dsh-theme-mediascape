# dsh-theme-mediascape

媒体景观主题 —— DeepSeek Harness（DSH）Web UI 主题插件：立绘/视频壁纸 × 基底配色 × 开屏动画 × 氛围粒子 × 背景音乐 × 打字音效。


> **界面预览**：`theme-studio/` 独立预览环境（真实前后端，见「theme-studio/ 预览环境」）

- [功能总览](#功能总览)
- [一、壁纸系统](#一壁纸系统)
- [二、基底配色](#二基底配色)
- [三、开屏动画](#三开屏动画)
- [四、氛围粒子与字号调节](#四氛围粒子与字号调节)
- [五、背景音乐](#五背景音乐)
- [六、打字音效](#六打字音效)
- [七、界面操作（dock 工具条）](#七界面操作dock-工具条)
- [八、在线资源与自定义素材](#八在线资源与自定义素材)
- [目录结构](#目录结构)
- [安装与要求](#安装与要求)
- [theme-studio/ 预览环境](#theme-studio-预览环境)
- [配色盘独立分发调研](#配色盘独立分发调研设计前置考量保持内置的理由)
- [演进总结（提交消息归纳）](#演进总结提交消息归纳)
- [版本记录](#版本记录)
- [注意事项](#注意事项)

## 功能总览

| 功能块 | 做什么 | 入口 |
|---|---|---|


| **mht 快照还原预览** | preview.html 直接解析 DSH 界面 .mht 快照还原为静态预览（聊天框+侧边栏+壁纸背景+dock），叠加假数据（操作日志→模拟用户消息、任务列表「预览页加载」自动完成、工作区一个文件夹一个会话）、侧边栏收起按 DSH 真实行为（会话列表 DOM 移除）、操作日志/顶部提示默认隐藏+「日志」开关 | `theme-studio/preview.html` |
| **宿主元素配色** | 胶囊配方外置 JSON（选择器/背景源/透明度/圆角/padding）+ **层级注入**（按 parent 拓扑排序：父先子后、子级自然覆盖父级）+ 品牌区 `sidebar-brand` 独立键（lPcGpa_brand 背景+文字一体），取色器胶囊 tab 可编辑保存并自动 build | `theme-studio/capsules.json` |
| **启动播放策略** | 视频壁纸/背景音乐启动时是否自动播放独立配置 | `theme-studio/playback.json` |
| **开屏动画** | 启动页 gif/图片/视频多画面轮换 + 渐显式无黑屏窗口（浮层立即盖界面，等待期氛围粒子+呼吸光圈、媒体首帧就绪后渐变淡入）+ 可配置标题副标题 + 视频 Range 流式 + HTTP 缓存（ETag+If-Range 重播省 80% 流量）；`file:"auto"` 时开屏即当前视频壁纸（与壁纸层同一份流，播完移交、不重复加载） | `boot/boot.json` 配置 |

| **字号调节** | 会话区与状态文字四档缩放（小/标准/大/特大），点击「字」循环切换、按钮不显示大小（大小自行感知） | dock「字」按钮 |
| **壁纸系统** | 图片/视频壁纸铺底、上传持久化、本地在线共存。背景氛围粒子 | dock「景」按钮 |
| **上传体系** | **中途不落盘**（上传数据先攒内存缓冲，上限=可用内存 20% 动态，超限转 `.tmp` 保底）、**暂停落盘 `.part` + 继续从 `.part` 续传**（`?offset=` 追加续写，取消 `DELETE /upload/part` 清理快照）、**上传前「文件名+大小」去重预检**（重复的文件在二级面板提示「已跳过」，不发送请求）、dock「传」统一上传入口（按**文件后缀**天然识别壁纸/音乐，一次多选统一分发）、上传进度二级面板（多行对齐/进度条/大小/速度 EMA/暂停/继续/取消）、**上传开始前与结束后各刷新一次列表（内置在公共函数）**、上传完释放连接（串行上传不占满浏览器同源 6 连接） | dock「传」按钮 |
| **打字音效** | 输入框打字按键音 + 壁纸音量调节 | dock「声」按钮 |
| **背景音乐** | 播放器（旋转唱片/封面/进度条可拖动）、歌单选择/随机、本机添加 | dock「乐」按钮 |

## 一、壁纸系统

- 全屏 `cover` 铺底；**中间画面全透明**（壁纸区域不铺底色：`--dsw-alias-bg-base: transparent`、html 深色兜底 `#0a0c12`、无蒙雾遮罩层；主题色只作用于侧边栏/对话框/按钮等组件）
- **双层结构（图片常驻 + 视频可选覆盖）**：图片壁纸一直存在（无类型切换按钮）；「视频：开/关」开关决定是否加载视频，开则视频覆盖在图片之上显示（图片仍在，仅被完全挡住），关则只显示图片。图片层与视频层各自独立记忆当前壁纸
- **选择**：弹出缩略图网格（正方形预览、固定三行、可滚动），点卡片直接应用——按视频开关只显示一层：关=图片列表，开=视频列表
- **模式切换**（面板「模式」一行）：按钮标题跟随状态——**亮=「视频」/ 暗=「图片」**（标题实时切换，不再固定显示「视频壁纸」）；dock「景」按钮悬停标题也只显示当前层（视频模式→视频名 / 图片模式→图片名），不再并列两个标题
- **移除**：勾选后移除 = **真实删除服务器文件**（壁纸/音乐统一同一份删除逻辑：开始前/结束后各刷新一次列表，音乐封面随歌曲一并删除）
- **随机**：随机模式走面板模式单按钮（循环/顺序/随机单按钮切换；选择器已去掉随机按钮）——进入随机后按当前层轮换，随机间隔自定义分钟（默认 5 分钟）；**随机/顺序作用于最上层**（视频开→视频层内切换，视频播完自动切下一张；关→图片层分钟定时切换）；**随机池跨层兼容**——池在图片模式勾选而当前是视频层（或反之）时自动回退当前层全部，视频播完仍会切换、不会停住
- **切换日志**：每次壁纸切换（视频 ended 切下一张 / 图片定时随机 / 手动切壁纸 / 模式切换）自动上报一行到运行态 `$DSH_HOME/theme-mediascape/logs/wallpaper.log`（`GET /theme-mediascape-assets/wallpaper/log?lines=50` 可回读最近 N 行，自检/排查切换是否发生用）
- **视频无缝切换预加载（2026-09-29）**：顺序/随机模式多视频轮换时，当前视频播放剩余 3s（`timeupdate` 阈值）即预创建并预缓冲下一视频（隐藏元素、`preload=auto`、未挂 DOM）；`ended` 切换时若预载目标命中且已就绪（`readyState≥2`）直接复用该元素（已缓冲数据，播放即出画面）——切换无加载间隙黑屏；未命中/未就绪照常新建不阻塞；关闭视频层/切换不匹配时自动清理预载（不占用连接）。
- **添加壁纸**：dock「传」按钮统一入口（按**文件后缀**天然识别壁纸/音乐，一次多选统一分发）——上传立即生效并**服务器磁盘持久化**（`$DSH_HOME/theme-mediascape/wallpaper/`，刷新/重启/换浏览器都在）——上传视频（**mp4/webm**，浏览器原生可播）自动开视频层并加载它；上传图片更新图片层（视频开关状态不变）
  - **落盘 = 原始文件名**（不做 SHA 重命名；同名同大小视为重复复用，同名不同大小自动加 (1)(2)… 后缀）；前端直接显示文件名（去扩展名）
  - **中途不落盘**：上传数据先攒内存缓冲（上限=可用内存 20% 动态，`os.freemem()`），超限自动转写 `.upload-<traceId>.tmp` 保底（超大文件不 OOM）；上传过程中素材目录**不出现** `.part` 中间态，`end` 后正式文件落定（`finalizeUpload` 按「文件名+大小」去重)；**上传完成落定后自动清理同名孤儿 `.part` 快照**（上次中断/暂停未续传的残留，不留盘）
  - **暂停落盘 `.part` + 继续从 `.part` 续传**：点「⏸」abort 当前请求 → 服务端把已收内存缓冲落盘为 `<正式名>.part` 暂停快照（内存即刻释放）；点「▶」带 `?offset=<已传字节>` 续传 —— 服务端校验 `.part` 存在且大小一致（不匹配返回 409，前端从头重传，杜绝残缺落盘），对 `.part` 追加续写，收完 rename 落定，不重传已传部分；「✕」取消 → `DELETE /upload/part?name=<文件>` 清理快照
  - **上传前「文件名+大小」去重预检**：重复的文件在二级面板提示「已跳过」（不请求）；**去重基准/移除目标只认「真实可用」项**（列表 stat 失败的文件已从服务端列表剔除，前端 `isItemUsable` 只认 file/name + size 数字）
  - **上传进度**：上传时 dock 二级面板自动弹出（`dock.__mediascapeDshCenter` 定位靠 dock，点外自动收起）——每任务一行（文件名 + 进度条 + 叠加「已传/总 · 速度」），多任务动态多行且各列对齐，无任务自动隐藏；速度读数 EMA 平滑（progress 事件间隔不均不跳变）
  - **开始前/结束后各刷新一次列表**（内置在公共上传/移除函数内）：上传前刷新保证去重基准最新，结束后刷新保证新文件即时入列表；移除同理（删除前刷新、删除后刷新）
  - **上传完释放连接**：串行上传（一次一个请求，不占满浏览器同源 6 连接），每个 XHR 完成即释放引用
  - **上传不关闭二级面板**：`input.click()` 打开系统选择器的 click 冒泡不再触发「点外关闭」（捕获阶段 stopPropagation）
  - **跨设备即时可见**：打开壁纸面板自动刷新列表，其他设备上传的壁纸无需手动刷新网页
- **上传上限**：按服务器剩余磁盘空间动态计算（默认单文件最多占剩余空间 80%，底线 512MB），快满自动收紧
- **默认壁纸**：首次安装（无历史记录）时展示真实数据目录第一张壁纸（本地/在线均可）
- 面板点右上角「—」或再点「选择」收起；「确定」收起设置面板，设置实时生效并持久化

## 二、基底配色

- 覆盖 100+ 个 `--dsw-*` 设计令牌，随主题即时生效；正式基底 = 左侧「应用」写入真源 json 的当前值（以 `lib/client-parts/foundation/tokens.js` 与取色器为准，文档不写死）
- **单 json 真源 + 预设包（V2 架构，json 化）**：应用配色只读一个 json——真源 `theme-studio/json/theme-colors.json`（label/badge + bg 系层级 bg/bgSoft/bgLayer + colors 全部元素色，**每个颜色带不透明度 alpha** `{hex, alpha}`，是唯一写盘目标）；预设包是 `theme-studio/json/preset/*.json`（只承载颜色集合 + 显示名，不含 bg 系），用于把真源快速改成预设配色；没有预设也能纯手改（左侧输入颜色值）。`apply` 自始至终只跟真源 json 相关
- **取色器** `theme-studio/theme-swatch.html`（双 tab：配色 / 胶囊）：配色 tab 顶部 = 背景层级区块（bg→bgSoft→bgLayer 缩进展示，改 bg 系 → dock/面板/胶囊 layer 跟随层联动），左侧 = 当前主题元素 class 控件列表（json 数据驱动，每行 6 列：元素名/类键/色号手输/色块/**真实元素样子分片**/不透明度滑块，滑块先预览第 5 列、点「应用」才写盘），「重置」还原真源，「应用」真正写入真源 json 并自动 build（`POST /api/theme-apply { items:[{key,hex,alpha}] }`，原子写真源 → identity.js/tokens.js → build）；右侧 = 预设包（下拉选择 + 逐行显示该预设颜色，「套到左侧全部」全量套 / 每行「应用」= 单项套该预设该键色到左侧，键缺失→无色透明行且不可应用；「存为新预设」`POST /api/theme-export`；「改名」写回预设 json 的 label，改/导出只作用预设包）。键 = 元素 class：15 键各自唯一（btn-primary/text-primary/gold-glow/status-capsule/sidebar-left/sidebar-brand…），无独立语义键，应用/写回按同名键直取；**不透明度滑块读取真源 json 的 alpha 现值**（非默认 1），拖滑先预览第 5 列真实元素样子、点「应用」才写盘
- **品牌区单独控制**：`sidebar-brand` 键驱动左侧边栏品牌区（`lPcGpa_brand`，CSS Modules 尾缀 `_brand`/`_brandName` 稳定不随 hash 变）——背景 + 品牌名文字一体（`--dsw-specific-sidebar-brand` / `--dsw-specific-sidebar-brand-text` 令牌）；**层级注入**：`sidebar-left`（整体，`--dsw-specific-sidebar-fill`）先注入 → 品牌区后注入，同特异性自然覆盖整体底
- **胶囊层级注入**：`capsuleCSS()` 渲染时按 `parent` 关系拓扑排序（深度优先、父先子后）——外层胶囊先注入、内层后注入，同特异性选择器后写覆盖先写（子级自然覆盖父级）；同层保持原数组顺序（稳定）。实测注入顺序：`chatColumn`→`flowItem`/`older`、`tabStrip`→`guide`→`guideEntry`
- **胶囊背景「构建期展开字面 rgb」**：layer 型胶囊背景不再引用运行期 CSS 变量 `var(--mediascape-dsh-theme-bg-layer)`，改为 build 注入 `CAPSULE_BG_LAYER_RGB` 常量（值 = `theme-colors.json` 的 bgLayer.hex 转 rgb，与身份层 `--mediascape-dsh-theme-bg-layer` 同源），`capsuleCSS()` 直接拼 `rgba(字面, α)`。原因：平板息屏过段时间后会话区胶囊全消失、刷新恢复——运行期变量在渲染层重建时未就绪 → `rgba(var(...), α)` 声明整体 invalid → 背景透明。展开字面后渲染层重建也能画出胶囊，不依赖变量存活（改 bgLayer 后需 build 生效，配色盘 apply 自动 build 同步）
- **宿主元素配色（胶囊 tab）**：胶囊配方外置 `theme-studio/capsules.json`（markdown / thinkBody / summary / todoPanel / queueDock / status / chatColumn 七类宿主元素的选择器、背景源、透明度、圆角、padding、额外声明），`build.cjs` 构建时注入 `CAPSULES_DATA`、`identity.js capsuleCSS()` 渲染（与旧写死值逐字一致）；取色器「🧩 宿主元素配色」区每类一行解释卡片（数据源 `theme-studio/json/theme-capsules.json`，含宿主组件与避坑说明 + 该胶囊不透明度 alpha）+ 控件（底色源下拉 layer/颜色集合/solid、RGB 输入、透明度滑杆、圆角/padding 文本、额外声明；颜色集合 = 真源 + 全预设色聚合去重），「保存并 build 生效」→ `POST /api/capsules/save`（只写固定文件防路径穿越、原子写、自动 build）；胶囊参数改后刷新页面生效
- **`chatColumn` 胶囊**：给聊天消息流主列容器加整列胶囊面板——选择器 `[data-conversation-scroll] [class$='_column']`（锚点 `data-conversation-scroll` 为全局属性不随 hash 变、类名尾缀 `_column` 稳定；`hash_column` 中的 hash 前缀随构建变化不影响匹配），半透明主题底（layer 源 alpha 0.32）+ 圆角 16px + 内边距 10px 14px，消息流整体呈一块胶囊面板
- **启动播放策略**：`theme-studio/playback.json`（构建时注入 `PLAYBACK_CONFIG`）——`videoAutoPlay`（默认 true）控制视频壁纸挂载后是否自动播放（false 时仅显示首帧，点「视频」按钮才播）；`musicAutoPlay`（默认 false）控制背景音乐启动时是否自动播第一首（默认不自动播，点「乐」/选曲才播；上传/选曲等用户操作后仍即时播放）

> **设计理念：配色盘可独立于主题单独存在**
>
> 「键 = 元素 class」重构后，取色器本质是**「元素 → 色值」的键集合**（15 个 `--swatch-<元素class>` +
> 元数据键），加上 `theme-studio/comps.json`（元素清单）、`theme-studio/capsules.json`（胶囊配方）、
> `theme-studio/json/preset/`（预设包）——这套东西与主题本体**仅剩两个接触点**：
>
> | 接触点 | 现状 | 独立时 |
> |---|---|---|
> | 令牌生成 | `buildTokensContent/buildIdentityBlock` 在 `start-preview.mjs` 里、直接写回主题的 identity.js/tokens.js | 职责迁回主题侧：配色盘只输出「元素键 css」，主题侧适配器消费后自生成令牌 |
> | 构建接线 | apply 后调主题的 build.cjs | 配色盘不再管 build，只负责原子写真源 json |
>
> 其余能力（theme-current / theme-presets / theme-export / theme-rename / 胶囊 / 预设 / UI）本就自洽，
> 只是物理上住在主题仓库的 `theme-studio/`。若将来要把配色盘独立成单独项目，**契约只有一份**：
> `--swatch-<元素class>` 键名清单 + 元数据键规则（以 `theme-studio/comps.json` 为准），两边按此对接即可，
> 无需改动取色器任何配色逻辑。当前不拆，保留在主题仓库内（单仓库便于一体化 build/自测/预览）。

## 三、开屏动画

- 启动页动画（运行态 `$DSH_HOME/theme-mediascape/boot/boot.json` 配置指定文件，读运行态目录——仓库根 `boot/` 是分发模板，改配置/换素材直接放运行态目录即生效，无需重新 build）居中淡入，带绿色辉光边框
- **无黑框直接出现（渐显式设计）**：开屏浮层在页面启动时**同步立即插入**盖住 DSH 界面（防界面先出、无黑屏窗口）——
  浮层背景为完全不透明深色 `#03070f`（透不出下方界面）；等待期呈现氛围粒子（中央呼吸光圈 + 24 粒星光缓缓上升，
  均为纯装饰、不阻挡交互）；并行取回 boot.json 配置与壁纸清单后建媒体元素，等首帧就绪（video `readyState≥2` / img loaded）
  后浮层加 `.media-ready`（星尘/光圈 0.5s 淡出——「星光聚成画面」）且媒体经 `transition 0.6s` 渐变淡入（opacity 0→1、scale 0.95→1）；
  无素材 / 配置失败 / 媒体超时 → 浮层保持深色背景展示 `durationMs` 后自动淡出（界面呈现，无黑框先行）。
- **媒体首帧就绪判定（修复 2026-09-26）**：视频就绪判定（`waitBootMediaReady`）三处加固——①就绪超时后最后复查真实 `readyState`（反代/主实例慢路径下视频首帧约 2s、可能晚于原 2s 超时，视频实际已就绪（readyState 4、4K 播放）不再误判为超时黑屏）；②补 `loadeddata` 监听（防 `canplay` 事件漏捕竞态）；③就绪超时放宽至 5s（`BOOT_MEDIA_READY_MS`）。修复前症状：实机路径视频流正常读取播放但画面黑（`ready` 类未加、opacity 0）后淡出，预览直连路径不受影响。
  点画面跳过 / 自动结束前：媒体的结束态尺寸 = 壁纸背景同规格（absolute 全屏 + `object-fit: cover`，与 `.mediascape-dsh-bg video` 一致），
  配合全屏渐变闪光（accent 光 → 深色）再整体淡出——开屏与壁纸交界视觉无缝。
  不再 build 注入预置首图（GIF_DATA 恒 null），开屏内容完全按运行时 boot.json 的 `file`/`files` 决定（改配置刷新即生效，无需 build）
- **支持 gif/图片/视频与多画面**：`.gif/.png/.webp` 用 `<img>`，`.mp4` 用 `<video muted loop autoplay>`（无声音）；`files` 数组按每段 `durationMs` 顺序轮换（video 复用元素 `load()+play()` 保持流式），播完整个集合自动淡出，`loop:true` 则循环整个集合直到点画面跳过（2026-09-23 删「点击跳过」按钮，点画面即跳）；默认 `file:"auto"` 联动当前启用的视频壁纸做开屏（同一份流式数据移交，不重复加载）
- **视频流式加载（Range/206）**：开屏视频经静态服务 Range 分片流式播放（`lib/index.js` + `theme-studio/start-preview.mjs` 的 `serveStream`，仅 media 且带 Range 才 206 分片、非法 Range 416、其余 200 全量），不再整段下载
 - **视频 HTTP 缓存（ETag + If-Range，已实现）**：媒体响应带 HTTP 缓存头，播放过的视频分片由浏览器缓存、重播零网络请求——
   - 206 分片响应返回 `Cache-Control: public, max-age=86400` + `ETag: "<mtime>-<size>"`（文件校验指纹）；重播同一 URL 时浏览器发 `If-Range: <etag>` 条件请求
   - 服务端校验：ETag 匹配 → 继续 206 分片（浏览器直接用缓存分片，不重新传输）；ETag 不匹配（文件被替换/上传新版本）→ 回 200 全量，缓存自动失效、绝不给旧内容
   - 生效点：切回看过的壁纸、开屏重播、多画面轮换回到已播片段——均不再重新下载（`file:"auto"` 开屏=壁纸同一份流本就一次请求，缓存进一步覆盖「跨会话重播」）
   - 实现位置：`lib/index.js` 与 `theme-studio/start-preview.mjs` 的 `serveStream` 同步（两处保持一致，与 Range 分片同一函数）；非媒体（js/css/json）保持 `no-cache` 即时生效不受影响
   - 自动验证：`node test/e2e/video-cache-compare.mjs`（零依赖，临时 2MB 视频 + 无缓存/有缓存双服务对比）——实测 5 轮播放：无缓存 10MB、有缓存 2MB（省 80%）；重播 4 次零请求零传输；文件被替换后 If-Range 不匹配回 200 全量拿新内容（ETag 自动失效，绝不给旧缓存）
- **`file: "auto"` 联动视频壁纸（开屏=当前壁纸，同一份流）**：`boot.json` 的 `file` 填 `auto` 时，开屏自动取当前启用的视频壁纸做开屏动画——
  开屏素材与壁纸素材合一，全程只发一次 Range 请求（开屏与壁纸层共用同一 `video` 元素、同一个流式数据）；
  开屏播完淡出时把该 `video` 元素移交给壁纸层继续播放（按 id 匹配接管、保留 src 不重载），无缝过渡、无第二次加载。
  机制：boot 解析阶段挂 `loading` 占位 → 壁纸层在 auto 解析完成前不自建视频 → 解析出目标 id 后同 id 则维持等待、不同 id 则恢复正常自建 → 开屏 finish 时挂出 `window.__mediascapeDshBootVideo` 移交对象 → 壁纸层 `renderLayers()` 按 id 接管同一元素。
- **壁纸视频关闭时关闭守卫（2026-09-29）**：视频开关（`LS_BG_VIDEO`）非 `"1"`（视频壁纸未开/已关）时，`file:"auto"` 不再兜底首个视频——auto 解析返回空、开屏守卫关闭、无视频按 `durationMs` 正常淡出（不卡等待），避免「开屏播视频但壁纸层不消费移交」的错配。
- 配置（运行态 `boot/boot.json`）：

```json
{
  "files": ["demo-6s.mp4"],
  "file": "auto",
  "title": "",
  "sub": "",
  "durationMs": 3000,
  "loop": false
}
```

- **标题/副标题可配置**：`boot.json` 的 `title`/`sub`（空字符串=不显示，默认只显示媒体本身）；`files` 优先于旧 `file` 字段，`file:"auto"` 再优先于 `files` 与 `file`（联动视频壁纸时不参与集合轮换，单画面=当前壁纸）
- 每次刷新播放，单画面/每段时长取配置 `durationMs`（默认 3000；2026-09-23 起代码读取钳制最小 3000——配置可写更低但不生效，防闪屏）；点击任意处或点画面可跳过（auto 视频首帧未就绪前不可跳，避免壁纸丢失）
- 尊重系统 `prefers-reduced-motion`，自动跳过

### 已实现

- **开屏 `file: "auto"` 联动视频壁纸**：`boot.json` 的 `file` 填 `auto` 时，开屏自动取当前启用的视频壁纸做开屏动画（走既有 Range 流式通道），开屏播完把同一 `video` 元素移交给壁纸层继续消费（同一份流式数据、同一元素，不重复加载）——开屏素材与壁纸素材合一，全程仅一次 Range 请求；详情见本章「`file: "auto"` 联动视频壁纸」条目。

## 四、氛围粒子与字号调节

- **氛围粒子**（嵌在「景」面板内一行）：**单循环按钮**——点击循环 关→一档→二档→三档，按钮显示当前档位、关档暗其余档亮；数量切换带 0.9s 淡入淡出过渡；每粒星光独立尺寸、亮度、漂浮轨迹与呼吸式闪烁
- **字号调节**（dock「字」按钮）：**点击循环切换**四档——小 0.85 / 标准 / 大 1.15 / 特大 1.3（按钮文字保持「字」，不显示大小，高亮暗=标准档、亮=非标准档；大小由会话区文字自行感知）；直接写宿主 `--dsh-content-font-size` 变量，正文随档位缩放，localStorage 记忆、重启保持

## 五、背景音乐

- 「**乐**」按钮：亮 = 播放中，暗 = 暂停；点击按状态机联动播放与二级面板：

  | 当前状态 | 点「乐」按钮 | 点面板外 |
  |---|---|---|
  | 暗（暂停）+ 面板关 | 变亮播放 + **打开面板** | — |
  | 亮（播放）+ 面板关 | 保持亮播放不变 + **打开面板** | — |
  | 亮（播放）+ 面板开 | **变暗暂停**，面板保持开不关 | 关面板，**继续播放** |
  | 暗（暂停）+ 面板开 | 恢复播放（亮），面板保持开 | 关面板，保持暂停 |

- 旋转唱片 + 封面（同名封面图或 `music/music.json` 指定；无封面自动读 MP3/FLAC 内嵌封面）+ 进度条拖动跳转
- 上一首 / 播放暂停 / 下一首 / 循环模式（单曲循环 → 列表循环 → 随机播放）
- **选择**：弹出歌单，勾选后移除（内置隐藏、导入删除）或随机（以勾选歌曲为随机池）
- **＋ 添加歌曲**：dock「传」统一入口（按文件后缀识别音乐，一次多选）——**服务器磁盘持久化**（`$DSH_HOME/theme-mediascape/music/` + `music.json` 清单，刷新/重启/换浏览器都在），无封面自动读内嵌封面；**封面**可为当前歌曲指定，落盘同名封面图并写入 `music.json`（封面保留原设计：自动按音乐名重命名）
- 当前曲目与循环模式持久化

## 六、打字音效

- 聊天输入框打字时播放「咔哒 + 低频咚」的星光质感按键音
- Web Audio 实时合成，**零音频文件**；空格/回车音色更低；「**声**」按钮开关；另有壁纸音量调节

## 七、界面操作（dock 工具条）

四个按钮收在**可拖动的半透明竖条面板**（右下角，圆角；无毛玻璃，纯深色底）：

| 按钮 | 功能 |
|---|---|
| **景** | 壁纸设置（模式单按钮三合一：循环/顺序/随机点击切换 + 视频开关 + 随机间隔 + **氛围粒子四档** + 确定；选择器仅「移除」按钮） |
| **乐** | 背景音乐 开/关 + 播放面板 |
| **声** | 打字音效 开/关 + 壁纸音量 |
| **字** | 字号四档（小/标准/大/特大） |
| **传**（下） | **统一上传入口**：点击直接打开文件选择器（一次多选），**按文件后缀**天然识别壁纸/音乐（png/jpg/jpeg/webp/mp4 → 壁纸，mp3/ogg/m4a/wav/flac → 音乐）；选完先按「文件名+大小」与现有列表**去重预检**，重复的在二级面板提示「**已跳过**」；上传**开始前/结束后各刷新一次列表**；上传进行时按钮**高亮**，进度显示在 dock 二级面板（自动弹出，无需手动开；**⏸ 暂停落盘 .part / ▶ 继续从 .part 续传 / ✕ 取消清 .part**） |

> 按钮顺序（上→下）：**景 乐 声 字 传**（2026-09-23 定稿，apply.js 启动段统一重排）。

> 🖱️ 按住面板任意位置拖动即可移动，位置自动记忆（重启 `dsh web` 后仍生效）。
> 面板/选择器弹层相对 dock **垂直对齐**并自动保持在屏幕内。
> 按 **ESC**：关闭壁纸/歌单等浮层；音乐面板展开时收起。

### 如何新增 dock 按钮 / 二级面板

dock 是 `toolbar/dock.js` 创建的固定容器（`startDock()`），各按钮是**独立 `start*` 函数**在 `lib/client.js` 启动段按序挂载（`const stopX = startX(dock);`），返回 `dispose` 供卸载。新增一个按钮 + 二级面板照此模式：

```js
// lib/client-parts/<模块>/<文件>.js
function startMyBtn(dock) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mediascape-dsh-mybtn mediascape-dsh-dock-btn";
  btn.textContent = "钮";                       // 单字按钮文字
  btn.title = "我的功能";
  dock.appendChild(btn);                        // dock 参数传入，直接 append

  const panel = document.createElement("div");
  panel.className = "mediascape-dsh-my-panel";  // CSS 对齐 bg-panel（absolute + .open 显示）
  dock.appendChild(panel);

  // 点击 toggle 面板 + 用 dock 的定位函数让面板贴 dock 侧边弹出（左右自动判断、视口内钳制）
  btn.addEventListener("click", (e) => {
    e.stopPropagation();                        // 防冒泡触发外层「点外关闭」
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) dock.__mediascapeDshCenter(panel);
  });

  // 点外自动收起（对齐 onBgDocClick 模式；排除自身按钮）
  const onDocClick = (e) => {
    if (panel.contains(e.target) || e.target === btn) return;
    panel.classList.remove("open");
  };
  document.addEventListener("click", onDocClick);

  return () => {                                // dispose：清理监听 + 移除元素
    document.removeEventListener("click", onDocClick);
    btn.remove();
    panel.remove();
  };
}
```

要点：
- **挂载**：在 `lib/client.js` 启动段调用 `const stopMyBtn = startMyBtn(dock);`，并把 `stopMyBtn()` 加进整体清理函数（return 的 dispose 列表）
- **CSS**：按钮用 `mediascape-dsh-dock-btn`（dock 内统一圆形按钮样式），面板样式对齐 `mediascape-dsh-bg-panel`（`position:absolute; z-index; display:none; flex-direction:column; .open{display:flex}`）
- **定位**：面板位置**不要自己写 fixed/left/top**——调用 `dock.__mediascapeDshCenter(panel)` 由 dock 统一处理（dock 偏左弹右侧、偏右弹左侧、贴底上移钳制），窗口 resize 时 dock 会 `repositionPopups()` 自动重摆
- **构建**：`lib/client-parts/` 下新建文件后，把文件加入 `build.cjs` 的 `PART_ORDER`（按依赖顺序）；跑 `node build.cjs` 拼回 `lib/client.js`
- **按钮高亮**：`.on` 类由各按钮自己维护（如上传按钮上传中 `btn.classList.toggle("on", 有活动行)`），CSS 在 `scenes/identity.js` 统一定义

## 八、在线资源与自定义素材

- **壁纸添加**两种方式：
  1. **运行时添加**（推荐）：点 dock「传」按钮，一次多选图片/视频/音乐，立即生效并持久化
  2. **在线资源**（随主题分发，别人安装自动下载）：`lib/sources.json` 的 `sources` 登记

- **在线资源**（壁纸图片/视频 + 音乐统一机制，启动后台静默下载缺失项）：

```json
{
  "sources": {
    "<sha1-40位hex>": {
      "name": "示例视频.mp4",
      "url": "https://example.com/video.mp4",
      "kind": "wallpaper"
    },
    "<sha1-40位hex>": {
      "name": "示例歌曲.mp3",
      "url": "https://example.com/song.mp3",
      "kind": "music"
    }
  }
}
```

  - **hash**：下载内容 SHA-1（40 位 hex），仅作完整性校验（下载后校验一致才落定），不做磁盘文件名
  - **kind 分流**：`wallpaper` → `wallpaper/online/`；`music` → `music/`
  - **落盘 = 原始文件名**（`name` 字段即落盘名，与上传/内置素材一致）；已存在同名文件即跳过（幂等）
  - **断点续传**：中断保留 `<name>.part`，下次启动从断点继续（Range 请求），校验通过才重命名落定
  - **本地/在线共存**：同一列表展示，同内容以本地上传优先
  - 以后加资源只改配置、不改代码

- **目录复制**（插件启动把仓库自带素材目录复制一份到真实数据目录，仓库根保留不删源）：

```json
{ "dirs": { "music": "music", "wallpaper": "wallpaper", "boot": "boot" } }
```

  整目录递归复制、已存在文件跳过、只复制一次（目标已存在非空即跳过）；以后加目录只改 json 的 `dirs`

- **开屏素材**：`boot/boot.json` 配置 `files`（多画面数组，优先）/ `file`（单素材，兼容）/ `title` / `sub` / `durationMs`（每段时长）/ `loop`（循环整个集合），改配置刷新即生效（运行时 fetch，无需 build）

## 九、HTTP API 一览

> 运行时素材/上传 API 由插件挂载在 DSH 主实例 `/theme-mediascape-assets`（`lib/index.js`）；预览服务（`theme-studio/start-preview.mjs`，默认端口见 start.sh）对同一前缀本地实现同源 API（不依赖主实例），配色盘 API 为预览服务专属。

### 9.1 素材与上传（运行时 + 预览同源）

| 方法与路径 | 说明 |
|---|---|
| `GET /theme-mediascape-assets/config` | 上传配置（accept 扩展名 / 上限，前端 file input 用） |
| `GET /theme-mediascape-assets/wallpaper/list` | 壁纸列表（id/kind/label/file/size/url；stat 失败的失效文件剔除） |
| `GET /theme-mediascape-assets/music/list` | 音乐列表（id/name/file/size/cover/url；music.json 自动同步登记/删除/封面） |
| `GET /theme-mediascape-assets/{boot,music,wallpaper}/<file>` | 素材流式下载（图片/视频/音频）：Range 206 分片 + ETag（If-Range 条件请求命中缓存省流量）；1MB 大块流 + 错误关连接 + 客户端中断释放源流 |
| `POST /theme-mediascape-assets/upload?name=<文件名>[&offset=<已传字节>]` | 壁纸上传（按扩展名自动识别图片/视频 mp4/webm）：中途不落盘内存缓冲（可用内存 20% 上限）、`offset>0` 续传 `<正式名>.part`（偏移不匹配返 409）、落定清理孤儿 `.part`、同名同大小复用、同名不同大小加 (1)(2) 后缀 |
| `POST /theme-mediascape-assets/music/upload?name=<文件名>` | 音乐上传（mp3/ogg/m4a/wav/flac；自动登记 music.json） |
| `POST /theme-mediascape-assets/music/cover` | 音乐封面上传（自动按音乐名重命名） |
| `DELETE /theme-mediascape-assets/wallpaper/<file>` | 真实删除壁纸文件（列表刷新后消失） |
| `DELETE /theme-mediascape-assets/music/<file>` | 真实删除音乐（按 music.json 一并删除封面 + 清登记；预览服务本地实现） |
| `DELETE /theme-mediascape-assets/upload/part?name=<文件>` | 取消上传：清理暂停快照 `<正式名>.part` |
| `GET/POST /theme-mediascape-assets/wallpaper/log` | 壁纸切换日志（POST 落盘 / GET 读回，受 debug 日志开关控制） |

### 9.2 配色盘（theme-swatch.html，预览服务专属）

| 方法与路径 | 说明 |
|---|---|
| `GET /api/theme-current` | 当前配色真源（label/badge/bg 系 / colors key:{hex,alpha} / comps 元素行——元素行=colors 键全量动态生成，comps.json 仅覆盖中文名/模板） |
| `POST /api/theme-apply` | 应用配色：`{ items:[{key,hex,alpha?}] }`（含 bg 系）写真源 json → build（tokens/identity 生成器三处同步） |
| `GET /api/theme-presets` | 预设包清单（[{id,label,badge,swatches}]） |
| `POST /api/theme-export` | 当前配色存为新预设：`{ name, css|json }` |
| `POST /api/theme-rename` | 重命名预设：`{ id, name }` |
| `GET /api/capsules` | 胶囊配方读取（运行态 → 仓库 → 内置三级兜底） |
| `POST /api/capsules/save` | 保存胶囊：`{ rules:[{key,selector,...}] }`（每条必须含 key/selector 字符串） |
| `POST /api/restart` | 重启预览服务（start.sh restart） |

### 9.3 页面与静态资源（预览服务）

| 路径 | 说明 |
|---|---|
| `GET /` `/index.html` | 预览页（真实 client.js 垫片宿主渲染） |
| `GET /theme-swatch.html` | 配色盘页面（配色区 + 胶囊区） |
| `GET /preset/*` `/lib/*` `/js/*` `/samples/*` | 预设包 / 库脚本 / 页面脚本 / 元素分片（samples/<role>.html）静态资源 |

### 待办（TODO）

- **配色盘功能基本完善，页面颜色区需要重新设计层级排布**（2026-09-23 记录）：颜色区当前为平铺元素行列表；后续按宿主元素层级重新排布（右侧边栏→品牌区/文件树/指南页，会话区→正文/胶囊/状态提示，等），层级关系与胶囊区 parent 树对齐。

## 目录结构

<!-- dshgp-tree:start -->
```text
dsh-theme-mediascape/
├── lib/ — 服务端实现
│   ├── bootstrap.js — 启动引导：按 sources.json dirs 整目录复制到真实数据目录
│   ├── config.js — 配置：MIME 表 / 白名单 / 上传上限（statfs 动态）
│   ├── debug.js — debug 配置读取（多开关 + 新键自动透传 + isDebug 判断）+ 运行态日志统一写入 writeLog（受 log 总开关控制）
│   ├── handlers-log.js — （待注释）
│   ├── handlers-upload.js — （待注释）
│   ├── handlers.js — HTTP 处理器：删除 / 壁纸列表 / 音乐列表 / 上传
│   ├── index.js — 入口：注册 /theme-mediascape-assets 前缀路由 + apply
│   ├── labels.js — labels 映射读写（wallpaper.json / music.json）
│   ├── log.js — re-export 兼容层（writeLog/logTs 转发自 debug.js；日志统一入口在 debug.js）
│   ├── online.js — 在线资源下载（.part 断点续传 + SHA-1 校验 + kind 分流）
│   ├── paths.js — 路径推导：壁纸/音乐目录 / labels 文件 / 在线下载子目录
│   ├── sources.json — 统一资源配置：sources 在线清单 + dirs 目录复制映射
│   ├── client-parts/ — 浏览器端主题源码（片段，build 按序拼接）
│   │   ├── apply.js — 客户端入口（ctx.effect 全量装配）
│   │   └── …（17 个更深文件）
├── test/ — 测试（e2e 自检脚本）
│   ├── .samples — （待注释）
│   ├── run-all.mjs — 一键全量测试运行器（--only 单选 / --list 清单，自动探测 Playwright 环境）
│   ├── e2e/ — e2e 自检（上传/断点续传/改名/缓存对比/降级/开屏）
│   │   ├── api-error-paths-check.mjs — 服务端错误路径回归（400 扩展名/非法/409 续传/413 超限/删不存在/坏日志）
│   │   ├── assert-file-usable-check.mjs — 素材「真实可用」判断（列表 stat 失效剔除/删除/移动/封面临删/music.json 清洗）
│   │   ├── auto-console.mjs — 自动化控制台捕获自检
│   │   ├── auto-diag.mjs — 自动化诊断输出
│   │   ├── auto-final.mjs — 自动化最终验证
│   │   ├── auto-req.mjs — 自动化请求链路检查
│   │   ├── auto-run.mjs — 自动化运行入口
│   │   ├── auto-run2.mjs — 自动化运行入口（第二组）
│   │   ├── auto-trace.mjs — 自动化 trace 捕获
│   │   ├── auto-trace2.mjs — 自动化 trace 捕获（第二组）
│   │   ├── boot-auto-video-handoff-check.mjs — boot auto 视频移交壁纸层回归（接管同一元素 + 声音恢复断言）
│   │   ├── boot-durations-check.mjs — 开屏多段时长配置自检
│   │   ├── boot-e2e-check.mjs — 开屏 e2e 渲染自检
│   │   ├── boot-noblack-check.mjs — 开屏去黑屏检查（浮层立即插入时序）
│   │   ├── boot-rotate-sim.mjs — 开屏多画面轮换模拟
│   │   ├── boot-timeline.mjs — 开屏时间轴渲染检查
│   │   ├── capsules-cache-fallback-check.mjs — 胶囊配方缓存兜底双向测试（源文件缺失用缓存副本）
│   │   ├── config-delete-list-check.mjs — 配置/列表/删除回收回归（uploadAccept/列表/.trash 命名）
│   │   ├── music-upload-cover-check.mjs — 音乐上传/复用/后缀/封面/列表回归
│   │   ├── theme-swatch-jscolor-check.mjs — （待注释）
│   │   ├── theme-swatch-preset-switch-check.mjs — （待注释）
│   │   ├── theme-swatch-screenshots.mjs — （待注释）
│   │   ├── ui-blocks-recorder.mjs — （待注释）
│   │   ├── ui-dock-panels-screenshot.mjs — （待注释）
│   │   ├── ui-dock-upload-remove-check.mjs — playwright 模拟点击全流程（上传/去重「已跳过」/壁纸音乐移除）
│   │   ├── ui-media-no-overlap-check.mjs — （待注释）
│   │   ├── upload-api-check.mjs — 上传 API 真实链路回归（走 30999 预览服务：壁纸/音乐/封面上传+列表+删除）
│   │   ├── upload-resume-check.mjs — 断点续传集成测试（传一半中断→续传→落定）
│   │   ├── upload-speed-check.mjs — 上传速度回归（流式写盘吞吐）
│   │   ├── upload-stream-write-check.mjs — 上传流式写盘测试（.part 中间态/复用/后缀/清理）
│   │   ├── video-cache-compare.mjs — 视频 HTTP 缓存对比（ETag+If-Range 省流量）
│   │   ├── video-handoff-continuity-check.mjs — 视频壁纸移交连续性回归（boot 开屏→壁纸层 currentTime 连续不中断）
│   │   ├── wallpaper-log-check.mjs — 壁纸切换日志链路回归（POST 落盘/GET 读回/开关拦截/非法 400）
│   │   └── …（8 个更深文件）
├── docs/ — （待注释）
│   ├── 官方宿主元素修改记录.md — （待注释）
│   ├── screenshots/ — 
│   │   ├── preview-启动动画.png — （待注释）
│   │   ├── preview.png — （待注释）
│   │   ├── 配色盘-胶囊区.png — （待注释）
│   │   ├── 配色盘-颜色区.png — （待注释）
├── boot/ — 开屏动画分发模板（启动复制到运行态读取）
│   ├── boot.json — 开屏配置（file/files/title/sub/durationMs/loop）
├── build-parts/ — （待注释）
│   ├── capsules-fallback.cjs — （待注释）
├── music/ — 音乐示例（启动复制到真实数据目录，仓库根保留）：知更鸟歌曲+封面
│   ├── 知更鸟_HOYO-MiX_Chevy-唯有追赶风的方向(Only_By_Chasing_the_Wind).mp3 — 音乐示例（知更鸟 PV 音频）
│   ├── 知更鸟_HOYO-MiX_Chevy-唯有追赶风的方向(Only_By_Chasing_the_Wind).png — 音乐示例封面
├── theme-studio/ — 预览环境（真实前后端）：start.sh + start-preview.mjs + preview.html + tests/
│   ├── .test — 预览环境豁免标记（审计跳过目录）
│   ├── README.md — （待注释）
│   ├── capsules.json — 宿主元素胶囊配方（build 注入 + 取色器胶囊 tab 读写）
│   ├── comps.json — 元素 class 控件配置（取色器左列角色：key/text/kind/color）
│   ├── playback.json — 启动播放策略（videoAutoPlay / musicAutoPlay，build 注入）
│   ├── preview.html — 独立预览页（不走 DSH，真实数据模拟）
│   ├── start-preview.mjs — 预览服务（静态 + 反代 + Range 流式 + 转发日志）
│   ├── start.sh — 预览服务启停脚本（start/stop/restart/status）
│   ├── theme-swatch.html — 配色取色器（双 tab：配色单真源+预设 / 胶囊宿主元素）
│   ├── js/ — 取色器 JS 资源
│   │   ├── theme-swatch.js — 取色器交互脚本（配色+预设+胶囊读写）
│   │   └── …（1 个更深文件）
│   ├── json/ — 配色 V2 真源目录
│   │   ├── theme-capsules.json — 胶囊配方 JSON（build.cjs 读取注入）
│   │   ├── theme-colors.json — 配色真源（label/badge + bg 系 + 全部元素色，每色带 alpha）
│   │   ├── theme-register.json — （待注释）
│   │   └── …（3 个更深文件）
│   ├── samples/ — 宿主元素样式样例（取色器 samples 分片）
│   │   ├── btn-primary.html — 样例：主按钮（btn-primary）
│   │   ├── btn-secondary.html — 样例：次按钮（btn-secondary）
│   │   ├── chip-active.html — 样例：活动胶囊（chip-active）
│   │   ├── dock-bar.html — 样例：dock 工具条（dock-bar）
│   │   ├── gold-glow.html — 样例：金色辉光（gold-glow）
│   │   ├── markdown-capsule.html — 样例：markdown 胶囊
│   │   ├── queue-dock.html — 样例：队列 dock（queue-dock）
│   │   ├── sidebar-fill.html — 样例：侧边栏填充（sidebar-fill）
│   │   ├── sidebar-left.html — 样例：左侧边栏（sidebar-left）
│   │   ├── status-capsule.html — 样例：状态胶囊（status-capsule）
│   │   ├── text-dim.html — 样例：弱化文字（text-dim）
│   │   ├── text-primary.html — 样例：主文字（text-primary）
│   │   ├── text-tertiary.html — 样例：三级文字（text-tertiary）
│   │   ├── todo-panel.html — 样例：待办面板（todo-panel）
│   ├── tests/ — 预览环境自测脚本
│   │   ├── boot-test.html — 开屏渲染测试页
│   │   ├── ms-boot-render-check.mjs — 开屏渲染自检
│   │   ├── ms-debug-dump.mjs — debug 配置导出自检
│   │   ├── ms-file-move-robustness.mjs — 文件移动健壮性自测
│   │   ├── ms-online-download-check.mjs — 在线下载检查
│   │   ├── ms-split-behavior-check.mjs — 片段拼接行为一致性检查（mock ctx → registerAssets → 假 req/res 实测列表/静态/上传路由 + 404 白名单 + 删除）
│   │   ├── ms-split-equivalence.mjs — 片段拆分等价性检查
├── .gitattributes — git 属性（换行符/语言标记）
├── .gitignore — 忽略规则（产物/依赖/任务清单）
├── CHANGELOG.md — （待注释）
├── LICENSE — 开源许可
├── README.md — 项目说明（功能/结构/使用/自测）
├── build.cjs — 构建：client-parts 片段按 PART_ORDER 拼回单文件 + 注入构建期配置
├── cordis.patch.yml — 宿主组合 patch（客户端模块装载声明）
├── package.json — dsh.client 声明（web 插件，注入 ui-theme 槽位）
├── screenshots.json — （待注释）
├── tree-doc.json — README 目录树索引（git-push 插件 tree-doc 维护：键=文件路径，值=一句话介绍）
```
<!-- dshgp-tree:end -->

> **真实数据目录**（插件启动时由 `dirs` 配置驱动复制，仓库根保留；运行态文件统一放运行态目录——素材、配置、日志、pid 等）：
> `$DSH_HOME/theme-mediascape/`：`wallpaper/`（上传落盘原始文件名 + `online/` 在线子目录）、`music/`（音乐文件原始文件名 + 封面 + `music.json` 清单）、`boot/`（开屏动画：`boot.json` 配置 + 素材文件，改配置/换素材直接放这里即生效）、`logs/`（运行日志：壁纸切换日志 `wallpaper.log`）

## 安装与要求

**要求**：DeepSeek Harness（`dsh`）+ Node.js；纯客户端主题，无额外依赖。

### 方式一：打包安装（本主题暂未发布 npm）

```powershell
dsh plugin --profile web add ./dsh-theme-mediascape{tag}.tgz
# 装完重启 dsh web 生效
```


### 卸载

```powershell
dsh plugin --profile web remove dsh-theme-mediascape
# 重启 dsh web 生效
```

> ⚠️ 与其它主题互斥：多个主题都会调用 `ctx.theme.setTheme` 并注入 `!important` 令牌样式，同时只能启用一个主题（多主题时 patch 行注释掉即可，可随时恢复）。

## 健壮性自测

> 针对「手动移动/删除素材文件」场景的自动化回归测试：验证服务端在文件与清单不一致时
> 不崩溃、列表正确、清单自动同步、孤儿记录被清洗。测试使用**独立数据目录**（`/tmp/ms-*-test-home`），
> 不污染真实 `$DSH_HOME/theme-mediascape/`。

```powershell
node theme-studio/tests/ms-split-behavior-check.mjs   # 路由/上传/删除/白名单基础链路
node theme-studio/tests/ms-file-move-robustness.mjs   # 移动壁纸/音乐/封面文件健壮性（12 项断言）
```

- **移动壁纸文件**（json 未同步）→ 列表不崩、不含被移项
- **json 孤儿记录 + 磁盘缺失** → 再次上传同内容**重新落盘**，不误判「重复复用不存在文件」
- **移动音乐文件** → 列表不崩、`music.json` 自动同步移除
- **静态 GET 已移动文件** → 404 不崩
- **封面判定与「填空」一致**：json 记录的 cover 文件不存在 → 自动找同名图片 → 再无则无封面；
  `music.json` 自动清洗孤儿 cover
- **移回文件** → 列表恢复

### debug 模式（多开关：配色服务 / 预览页 / 日志，各自独立）

配置文件**不随插件下发、不入库**，只能手动创建（数据目录，`$DSH_HOME` 缺省为 `~/.dsh`）：

```jsonc
{
  "log": true,          // 总日志开关：开启时壁纸切换 / 配色操作 / 预览访问 / 上传行为 / 服务启动 / API 耗时都写运行态日志
  "theme-swatch": true, // 配色服务开关：主题 apply 时自动拉起取色器（theme-swatch.html + 配色 API）；关 → 页面 404
  "preview": true       // 预览页开关：主题 apply 时自动拉起预览页（preview.html）；关 → 页面 404
}
```

- **任意新键自动透传**：debug.json 里加任意未知键（如 `"performance": true`）无需改代码，`readDebugConfig()` 自动带出、`isDebug('performance')` 可直接判断——以后加 debug 开关只改配置文件
- **日志统一入口**：所有运行态日志（含 build 期胶囊诊断 `build-capsules.log`）都经 `lib/debug.js` 的 `writeLog(name, entry)` 单点写入，受 `log` 总开关控制——关闭时任何日志零落盘，无绕过开关的散落直写（`lib/log.js` 为 re-export 兼容层）

- **任一开关开** → 每次 `node build.cjs` 自动执行 `theme-studio/tests/` 下的自测脚本（任一失败即标红）
- **log 开启** → 运行态 `$DSH_HOME/theme-mediascape/logs/` 按类生成日志文件，每条带日期时间（`YYYY-MM-DD HH:mm:ss.SSS`），单文件超 1MB 自动轮转（`.1`/`.2`/`.3` 滚动，最多保留 3 份历史）：
  - `wallpaper.log`：壁纸切换事件（前端上报）
  - `theme-swatch.log`：配色操作（theme-save / theme-apply / 页面访问）
  - `preview.log`：预览页访问
  - `upload.log`：上传行为（上传/音乐上传/封面上传）
  - `startup.log`：服务启动（主实例 / 预览服务器）
  - `api.log`：API 请求耗时（method/path/status/ms，唯一入口统一记录，不打散到各函数）
- **只认新键**：旧 `{"enabled": true}` 不再生效；三键都缺/非 true = 默认关闭，构建只输出提示，不产生额外动作
- 关闭：删除该文件，或把对应键置 false

## theme-studio/ 预览环境

> **`theme-studio/` 是开发预览用，跑的是真实前后端，不是简化模拟**：加载真实的 `lib/client.js`（构建产物）、接真实的 `lib/*.js` 服务端逻辑（上传/删除/壁纸列表/音乐列表/在线下载/目录复制全部走真实代码）、读写真实的 `$DSH_HOME/theme-mediascape/` 数据目录——预览所见即插件实际行为，改完代码 build 后刷新预览页即可验证，无需重启主 DSH。

```powershell
./theme-studio/start.sh start     # 启动预览服务器（默认端口 30999）
./theme-studio/start.sh stop      # 停止
./theme-studio/start.sh restart   # 重启（默认命令）
./theme-studio/start.sh status    # 查看状态
```

- 预览页：`http://<本机IP>:30999/`（`preview.html` 加载真实 client.js）
- 预览模式变量：`?mode=full` → 完全真实数据模拟（关空清单兜底、隐藏提示条、开屏/壁纸/音乐/胶囊全部走真实后端刷新即见；缺省 = 独立预览态，fetch 失败兜底空清单仍可演示交互）
- 取色器：`/theme-swatch.html`（配色/胶囊双 tab：左元素控件手输 + 点击单项应用预设色、右侧预设包全量/混搭应用、左侧应用真正写入、导出新预设）
- 写操作（upload/delete）转发真实后端；素材与列表本地直供，不依赖主实例重启
- PID 文件在项目根 `dsh-theme-mediascape.pid`

## 配色盘独立分发调研（设计前置考量：保持内置的理由）

> 背景：配色盘（`theme-studio/` + 取色器）随主题一起提供，曾调研「配色盘也可单独安装」的分发方式。本节记录**设计前置考量**——即设计时为何不把配色盘拆成独立分发，供将来若需独立分发时对照。

**设计取向：配色盘与主题内置一体**；若将来需要独立分发给其他作者，按本小节方案落地。

### 为何不设计成独立分发（双向耦合事实）

- 配色盘写盘 = 写真源 json → **生成主题的 identity.js/tokens.js → 调主题 build.cjs**（`start-preview.mjs` 的 buildTokensContent/buildIdentityBlock 即为此写）
- 主题 build.cjs 又读配色盘的 json / capsules.json（build 注入 CAPSULES_DATA）
- samples 单片分片、胶囊配方、comps 键 Schema 均为两端配套——拆双仓会撞上「配色盘没主题构建能力只是改 json 的编辑器、主题没配色盘是无法配色的主题」的双向依赖

### 将来若要独立分发（monorepo 方案，调研过的路径）

```
dsh-theme-mediascape（一个 GitHub 仓库，monorepo）
├── pnpm-workspace.yaml          # packages/*
└── packages/
    ├── 主题包/                    # dsh 字段；依赖 配色盘包
    └── 配色盘包/                  # dsh 字段；独立可安装（theme-studio/ + start-preview.mjs 迁入）
```

- **安装**：只装主题 `dsh plugin --profile web add github:EIGHTfs/dsh-theme-mediascape#path:/packages/主题包目录`；只装配色盘 `...#path:/packages/配色盘目录`；装主题时经依赖自动带配色盘
- **依赖方案（按优先级）**：A. `file:../配色盘目录`（需实测 clone 后 pnpm 能否解析兄弟目录）→ B. `workspace:*` → C. GitHub Release tarball URL（`https://github.com/EIGHTfs/<repo>/releases/download/<版本>/<配色盘包名>-<版本>.tgz`，不依赖仓库内部路径解析，最稳）
- **扩展（服务提供者模式，参考 dsh-better-sidebar 的 ctx.betterSidebar）**：配色盘注册服务 `ctx.<服务名>`，其他插件 `inject: ['<服务名>']` 接入，典型方法 `registerColorTarget(selector, options)` / `getPalette()` / `applyPalette(palette)` / `onPaletteChange(callback)`
- **不发布 npm**：仅 GitHub 安装

### 单仓 vs 双仓权衡（调研记录）

- 单仓 monorepo：schema/生成/样例同仓同步、原子提交、开发体验好；两包共用 git 历史需约定版本策略
- 双仓：独立版本/tag/Release、仓库聚焦；但本项目配色盘依赖主题 build 能力 → 跨仓同步地狱（改键要两仓提交两仓发版）
- 结论：若拆，走**单仓 monorepo**（双向耦合无法物理分离）

## 演进总结（提交消息归纳）

> 按「架构设计 / 功能 / 问题」三类归纳全部历史提交消息（含早期 backup 分支），便于理解项目为什么长成这样。非版本列表。

### 架构设计

- **服务端模块化**（`lib/`）：按职责拆为 10 个模块——
  - `index.js`：DSH 插件应用入口（注册服务与路由）
  - `config.js`：上传扩展名单一权威源（`ALLOWED_UPLOAD_EXT` + 派生 accept，build 时注入客户端）+ 静态服务目录白名单
  - `paths.js`：数据目录统一（`$DSH_HOME/theme-mediascape/` 下的 wallpaper/、music/ 等路径）
  - `handlers.js`：HTTP 处理器（配置/删除/壁纸列表/音乐列表/封面判定/重复判断）
  - `labels.js`：壁纸显示名存取（`wallpaper/wallpaper.json`，读盘缓存 + 原子写）
  - `online.js`：在线资源下载（断点续传 + SHA-1 校验）
  - `bootstrap.js`：插件启动时目录迁移（仓库根素材整目录复制到数据目录，已存在跳过）
  - `debug.js`：debug 配置读取（多开关 + 新键自动透传 + `isDebug` 判断）+ 运行态日志统一写入 `writeLog`（受 `log` 总开关控制）
  - `log.js`：re-export 兼容层（`writeLog`/`logTs` 转发自 debug.js）
  - `client.js`：构建产物（仅配置与逻辑，约 188KB，资源全走运行时 API）
- **前端模块化**（`lib/client-parts/`）：按职责拆为 4 个子目录 + 顶层——
  - `foundation/`：基础层（utils 工具 / constants 常量 / assets 素材注册 / loader 加载器 / theme 主题变量 / tokens 设计令牌）
  - `scenes/`：场景层（boot 开屏 / wallpaper 壁纸 / ambience 氛围 / font 字号 / upload 上传 / identity 界面样式覆盖）
  - `sound/`：声音层（typesound 打字音效 / music-player 音乐播放 / music-extract 音乐提取）
  - `toolbar/`：dock 工具条（dock.js）
  - `apply.js`：顶层聚合入口
- **全资源在线化**：壁纸/音乐统一 `lib/sources.json`（hash 主键 + dirs 目录复制映射）；插件启动按 dirs 把仓库根素材**整目录复制**到数据目录（已存在跳过，仓库根永远保留分发素材，数据目录获得运行副本，跨设备天然兼容）；`/music/list` 每次调用自动把目录实际内容写回 `music.json`（新增自动登记、删除自动移除、同名封面自动补 cover、保留用户已存 name/cover，有差异才落盘）
- **上传落盘规则**：原始文件名落盘到数据目录（跨设备即时可见），全流程 traceId 日志；accept 单一权威化（复用配置 `ALLOWED_UPLOAD_EXT`）
- **配色机制（V2 键=元素 class）**：只读一个真源 json（`theme-studio/json/theme-colors.json`，label/badge + bg 系层级 + 全部元素色，每色带 alpha `{hex, alpha}`、唯一写盘目标），其它 json 只是预设包（`theme-studio/json/preset/`，只承载颜色集合 + 显示名，不含 bg 系）；**key 即元素 class（15 个元素各一个唯一键，无独立语义键，键名与 comps.json 一一对应）**；取色器左侧 = 真源元素 class 控件（comps.json 15 角色），右侧 = 预设包（应用预设全量套左侧 / 点左侧元素单项应用预设对应键色，混搭——键缺失只跳过该元素，绝不波及其他元素）；左侧「应用」收完整真源 json（`POST /api/theme-apply`）→ 原子写真源 json → 令牌零映射直接按元素键名取值（text←text-primary、accent←btn-primary、border←gold-glow、invert←status-capsule 等）→ identity.js 主题变量段 + tokens.js 令牌 → build → 主实例生效；改名/导出只作用预设包（写回预设 json、`POST /api/theme-export` 存新预设）
- **预览环境**：`theme-studio/` 跑真实前后端（加载真实 client.js + 真实服务端逻辑 + 真实数据目录），改完 build 后刷新预览页即可验证，无需重启主 DSH

### 功能

- **壁纸系统**：动态/静态两种壁纸、在线壁纸下载（后台静默 + 断点续传 part）、壁纸主题自动配色（图片主色驱动 UI 换肤）、壁纸面板自适应宽度
- **基底配色（V2 单真源 + 预设，键=元素 class）**：15 个元素各一个唯一键（btn-primary/text-primary/gold-glow/status-capsule…，键名=元素 class，无独立语义键）、真源 json 唯一（`theme-studio/json/theme-colors.json`）、预设包多套可选（`theme-studio/json/preset/`）+ 导出增补与改名、配色双 tab 页（左侧元素 class 控件手输/点击单项应用、右侧预设全量套用混搭——键缺失只跳过该元素不波及其他、左侧应用真正写入、导出新预设）；令牌零映射：宿主令牌直接按元素键名取值（text←text-primary、accent←btn-primary、border←gold-glow、invert←status-capsule），应用时写 identity.js 主题变量段 + tokens.js 令牌
- **开屏动画**：gif/图片/**视频**开屏（视频为流复制截取的 h264-in-mp4，浏览器原生支持）、boot.json 可配置标题/副标题/时长
- **debug 多开关**：debug.json 三独立开关（log 总日志 / theme-swatch 配色服务 / preview 预览页，任一开跑自测）；log 开启时运行态 logs/ 按类生成日志（壁纸切换/配色操作/预览访问/上传/启动/API 耗时，带时间戳 + 1MB 轮转）
- **氛围与字号**：氛围粒子 + toggle 交互、四档字号调节（会话区 + 状态文字，写宿主字号变量）
- **音乐与音效**：背景音乐播放器 + 打字音效开关；「乐」按钮状态机（亮=播放中/暗=暂停，与二级面板状态联动）
- **上传体系**：中途不落盘（内存缓冲 + 可用内存 20% 动态上限 + `.tmp` 保底）、暂停落盘 `.part` + 继续从 `.part` 续传（`?offset=` 追加）、上传前「文件名+大小」去重预检（重复走二级面板「已跳过」行）、进度二级面板（多行对齐/大小/速度/暂停/继续/取消）、**上传/移除开始前与结束后各刷新一次列表（内置公共函数）**、上传完释放连接（串行）、dock「传」统一入口（按文件后缀识别壁纸/音乐，壁纸/音乐上传移除共用同一公共函数）
- **界面操作**：dock 竖排工具条（字/景/声/乐，萤并入景面板）、二级面板改侧边弹出（左右判断）、模态遮罩透明化（设置打开壁纸仍透出）、中间画面全透明（壁纸区域不铺底色，主题色只作用于组件）、景模式三按钮合一（循环/顺序/随机单按钮循环切换）、选择壁纸去随机按钮
- **可读性**：全局文字轻描边 + 深色半透明衬底（任意壁纸下文字可读；无毛玻璃）、「深度求索中…」状态胶囊定稿

### 问题手册

- **配色对照页点击换色失效**：renderCol 构建 comps 时只存 {style,text} 丢了 role 字段，渲染出 `data-role="undefined"`，点击委托拿不到有效 role → 渲染循环改用显式 role 列表
- **选择器崩溃**：大面积 backdrop-filter 在 SAF 快照瞬间 OOM → 禁毛玻璃 + 文件选择 input 挂 DOM 触发（安卓静默拦截修复；毛玻璃已移除后该修复为空操作，守卫保留防回归）
- **配色应用后服务被杀**：theme-apply 内 execSync 调 build 触发 debug 模式重启，自杀宿主进程 → `DSH_THEME_NO_RESTART=1` 跳过重启
- **思考展开无胶囊**：CSS Modules 编译类名是 `hash_thinkBody`（类名后无下划线），选择器 `[class*='_thinkBody_']` 匹配不到 → 改 `[class*='_thinkBody']`
- **封面/重复判定**：json 记录与磁盘不一致 → 封面校验文件存在 + 同名回退 + 孤儿清洗；重复上传先查磁盘 existsSync
- **状态文字模糊/描边反复**：白描边改四方向硬描边 → 去描边 → 胶囊化定稿（不透明深底+纯白字）
- **dock 悬浮条叠层**：重复 apply/热重载不再叠层（幂等）
- **壁纸视频不自动播放（停在开头）**：声音面板「壁纸音量」条/喇叭写 `LS_MUTED`，拖过音量条即取消静音（`LS_MUTED="0"`）→ 壁纸视频 `video.muted=false`（有声）→ 浏览器自动播放策略拒绝无交互的 `play()`（`NotAllowedError`）→ 视频卡在开头。与配置/服务端无关（`videoAutoPlay` 一直 true、Range/206 正常），重启也无用。修复：`play()` 被拒时静音重试（`video.muted=true` 再 `play()`）——自动播放保底成立（无声），要声音点声音面板（用户交互后浏览器允许有声播放，`applyVideoSound` 把正在播的 video 改为有声）
- **权限漂移（已删映射文件）**：曾用 .names.json 记录映射，saveBaseChoice rename 覆盖导致权限漂移（755/777）→ 已删除映射机制与文件（映射不参与生效，选基底只影响对照页显示与应用来源），改名直接写 css
- **上传文件时二级面板被关闭（修）**：`input.click()` 打开系统文件选择器时 click 事件冒泡到 document，被「点面板外 → 关闭」逻辑（onBgDocClick / onDocClick）误判 → 面板/选择器随上传被关。修复：三处上传用 file input 捕获阶段 `stopPropagation()`（选择器的 click 不再冒泡）
- **乐面板进度条不可拖动（修）**：`repositionPopup` 垂直钳制写反——`Math.max(0, vh-8-dr.top-r.height)` 先把上移量钳成 0，再 `Math.min(0, …)` 恒得 0，dock 贴视口底部时浮层（音乐卡片）底部超出视口 → seek 条在屏幕外不可见不可拖。修复：直接用负上移量 `Math.min(0, vh - 8 - dr.top - r.height)`

## 版本记录

完整发布历史（含 1.0.2 mht 快照还原预览、1.0.1 审计优化与 1.0.0 首发说明）见 [CHANGELOG.md](CHANGELOG.md)。


## 注意事项

- **主题互斥**：同一时间只启用一个主题（见安装与要求）
- **素材不内嵌**：`lib/client.js` 仅含配置与逻辑（约 188KB），壁纸/音乐/开屏全部由服务端静态路由与运行时 API 提供
- **可读性设计**：中间画面全透明 + 全局文字描边 + 深色半透明衬底——任意壁纸下文字可读（无毛玻璃）
- **隐私**：本主题纯客户端，无任何遥测/外部请求（在线资源仅按 `sources.json` 显式登记下载）

<!-- dshgp-functions:start -->
## 函数列表

### lib/bootstrap.js（93 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadDirMigrations` | 27-40 | 14 | `function loadDirMigrations() {` |
| `copyOnce` | 49-66 | 18 | `function copyOnce(srcName, dstName) {` |
| `copyInto` | 69-73 | 5 | `function copyInto(s, d) {` |
| `copyDirInto` | 76-84 | 9 | `function copyDirInto(src, dst) {` |
| `bootstrapDataDirs` | 87-92 | 6 | `export function bootstrapDataDirs() {` |

### lib/client-parts/apply.js（155 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `injectIdentityStyle` | 7-14 | 8 | `function injectIdentityStyle() {` |
| `cleanupStaleDom` | 21-35 | 15 | `function cleanupStaleDom() {` |
| `stopMedia` | 22-27 | 6 | `const stopMedia = (root) => {` |
| `registerTheme` | 38-49 | 12 | `function registerTheme(ctx) {` |
| `reorderDockButtons` | 53-58 | 6 | `function reorderDockButtons(dock) {` |
| `btnByText` | 55-55 | 1 | `const btnByText = (t) => allBtns.find((b) => b.textContent === t);` |
| `lockDarkMode` | 61-70 | 10 | `function lockDarkMode() {` |
| `enforce` | 62-65 | 4 | `const enforce = () => {` |
| `setupEscClose` | 73-82 | 10 | `function setupEscClose(dock) {` |
| `onEsc` | 74-79 | 6 | `const onEsc = (e) => {` |
| `apply` | 84-147 | 64 | `function apply(ctx) {` |

### lib/client-parts/foundation/constants.js（49 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `migrateLegacyKeys` | 35-44 | 10 | `function migrateLegacyKeys() {` |

### lib/client-parts/foundation/theme.js（95 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extractColors` | 13-53 | 41 | `function extractColors(img, count = 5) {` |
| `loadImage` | 63-70 | 8 | `function loadImage(url) {` |
| `currentWallpaperColors` | 77-92 | 16 | `async function currentWallpaperColors() {` |
| `wallpaper` | 82-82 | 1 | `const wallpaper = (id ? items.find((x) => x.id === id) : null)` |

### lib/client-parts/foundation/utils-upload.js（396 行 · 21 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildUploadRowEl` | 2-31 | 30 | `function buildUploadRowEl() {` |
| `makeUploadBegin` | 56-78 | 23 | `function makeUploadBegin(ops, root, refresh) {` |
| `makeUploadSkip` | 81-95 | 15 | `function makeUploadSkip(ops, root, rows, refresh) {` |
| `makeUploadDispose` | 98-105 | 8 | `function makeUploadDispose(btn, panel, onDocClick) {` |
| `createUploadToggle` | 107-120 | 14 | `function createUploadToggle(dockEl) {` |
| `bindRowButtons` | 123-131 | 9 | `function bindRowButtons(r, controls) {` |
| `startUploadHud` | 133-179 | 47 | `function startUploadHud(dock) {` |
| `onDocClick` | 144-149 | 6 | `const onDocClick = (e) => {` |
| `refresh` | 155-165 | 11 | `function refresh() {` |
| `runUploadXhr` | 192-208 | 17 | `function runUploadXhr(url, body, onProgress) {` |
| `settleUpload` | 218-226 | 9 | `function settleUpload(uploadResult, userPaused, userCancelled, hud) {` |
| `uploadOneFileXhr` | 228-277 | 50 | `function uploadOneFileXhr(file, kind) {` |
| `run` | 255-265 | 11 | `const run = () => {` |
| `classifyUploadFile` | 287-292 | 6 | `function classifyUploadFile(f) {` |
| `isItemUsable` | 296-298 | 3 | `function isItemUsable(item) {` |
| `refreshList` | 301-306 | 6 | `async function refreshList(kind) {` |
| `groupUploadByKind` | 311-319 | 9 | `function groupUploadByKind(files, hud) {` |
| `dedupeByFileSize` | 323-335 | 13 | `function dedupeByFileSize(files, kind, hud) {` |
| `uploadFiles` | 337-360 | 24 | `async function uploadFiles(files) {` |
| `removeItems` | 364-380 | 17 | `async function removeItems(items) {` |
| `deleteServerFile` | 382-392 | 11 | `function deleteServerFile(item) {` |

### lib/client-parts/foundation/utils.js（166 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withMediaToken` | 7-14 | 8 | `function withMediaToken(url) {` |
| `ffFetch` | 26-40 | 15 | `async function ffFetch(url, opts = {}, timeoutMs = FF_FETCH_TIMEOUT_MS) {` |
| `fmtBytes` | 43-44 | 2 | `function fmtBytes(n) { return n >= BYTES_PER_MB ? (n / BYTES_PER_MB).toFixed(1) + " MB" : (n / BYTES_PER_KB).toFixed(0) + " KB"; }` |
| `fmtSpeed` | 44-45 | 2 | `function fmtSpeed(bps) { return bps >= BYTES_PER_MB ? (bps / BYTES_PER_MB).toFixed(1) + " MB/s" : (bps / BYTES_PER_KB).toFixed(0) + " KB/s"; }` |
| `createRowOps` | 46-94 | 49 | `function createRowOps(rows, refresh) {` |
| `ffIdbOpen` | 102-115 | 14 | `function ffIdbOpen() {` |
| `ffIdbGetAll` | 116-122 | 7 | `function ffIdbGetAll(store) {` |
| `ffIdbPut` | 123-130 | 8 | `function ffIdbPut(store, record) {` |
| `ffIdbDelete` | 131-138 | 8 | `function ffIdbDelete(store, key) {` |
| `PickerGuard` | 153-165 | 13 | `function PickerGuard() {` |
| `restore` | 157-161 | 5 | `const restore = () => {` |

### lib/client-parts/scenes/ambience.js（104 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `createAmbientDots` | 14-33 | 20 | `function createAmbientDots(wrap, maxCount) {` |
| `createAmbienceLine` | 36-53 | 18 | `function createAmbienceLine(dock, panel, onCycle) {` |
| `startAmbience` | 55-104 | 50 | `function startAmbience(dock) {` |
| `setLevel` | 71-90 | 20 | `function setLevel(key, instant) {` |

### lib/client-parts/scenes/boot.js（415 行 · 21 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveAutoBootVideo` | 24-43 | 20 | `async function resolveAutoBootVideo(listData) {` |
| `pick` | 40-40 | 1 | `const pick = (saved && vids.find((w) => w.id === saved)) \|\| vids[0];` |
| `loadBootGifConfig` | 44-101 | 58 | `async function loadBootGifConfig() {` |
| `buildBootOverlay` | 108-140 | 33 | `function buildBootOverlay() {` |
| `finishBootIntro` | 146-179 | 34 | `function finishBootIntro(ov, st) {` |
| `bootRotateTo` | 183-207 | 25 | `function bootRotateTo(ov, urls, index, st) {` |
| `bootStartRotate` | 210-231 | 22 | `function bootStartRotate(ov, urls, st) {` |
| `segMs` | 215-218 | 4 | `const segMs = (i) => {` |
| `step` | 219-229 | 11 | `const step = () => {` |
| `playTransformIntro` | 233-284 | 52 | `function playTransformIntro() {` |
| `waitBootMediaReady` | 287-323 | 37 | `function waitBootMediaReady(el, timeoutMs) {` |
| `isReadyNow` | 292-295 | 4 | `function isReadyNow() {` |
| `cleanup` | 296-309 | 14 | `function cleanup(clear, ok) {` |
| `onOk` | 310-311 | 2 | `function onOk() { cleanup(true, true); }` |
| `onErr` | 311-312 | 2 | `function onErr() { cleanup(true, false); }` |
| `showBootOverlay` | 330-414 | 85 | `function showBootOverlay(mediaEl, urls) {` |
| `finish` | 342-359 | 18 | `const finish = () => {` |
| `rotateTo` | 364-388 | 25 | `function rotateTo(index, urls2) {` |
| `segMs` | 391-394 | 4 | `function segMs(index) {` |
| `startRotate` | 395-412 | 18 | `function startRotate(urls2) {` |
| `step` | 399-409 | 11 | `const step = () => {` |

### lib/client-parts/scenes/font.js（87 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `createFontToggle` | 13-21 | 9 | `function createFontToggle(dock) {` |
| `createFontCycle` | 24-66 | 43 | `function createFontCycle(btn, applyScale) {` |
| `setLevel` | 34-42 | 9 | `function setLevel(key) {` |
| `restore` | 50-53 | 4 | `function restore(key) {` |
| `startFont` | 68-86 | 19 | `function startFont(dock) {` |
| `applyScale` | 71-84 | 14 | `function applyScale(scale) {` |

### lib/client-parts/scenes/identity.js（472 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerColorCSS` | 17-24 | 8 | `function registerColorCSS() {` |
| `capsuleCSS` | 35-69 | 35 | `function capsuleCSS() {` |
| `visit` | 41-47 | 7 | `function visit(r) {` |
| `identityCSS` | 467-470 | 4 | `function identityCSS() {` |

### lib/client-parts/scenes/upload.js（146 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `syncBgEnabledUI` | 41-50 | 10 | `function syncBgEnabledUI() {` |
| `setBgEnabled` | 51-58 | 8 | `function setBgEnabled(on) {` |
| `onBgDocClick` | 70-76 | 7 | `const onBgDocClick = (e) => {` |
| `defaultWallpaper` | 101-105 | 5 | `function defaultWallpaper() {` |
| `initWallpaper` | 107-130 | 24 | `async function initWallpaper() {` |

### lib/client-parts/scenes/wallpaper.js（593 行 · 33 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `startWallpaper` | 2-593 | 592 | `function startWallpaper(dock) {` |
| `loadIdSet` | 9-12 | 4 | `function loadIdSet(key) {` |
| `saveIdSet` | 13-15 | 3 | `function saveIdSet(key, set) {` |
| `syncModeBtn` | 91-96 | 6 | `function syncModeBtn() {` |
| `updateIntervalLine` | 103-105 | 3 | `function updateIntervalLine() {` |
| `updateVideoToggle` | 107-114 | 8 | `function updateVideoToggle() {` |
| `logSwitch` | 132-148 | 17 | `function logSwitch(extra) {` |
| `disposeVideoEl` | 156-159 | 4 | `function disposeVideoEl(el) {` |
| `renderImageLayer` | 161-174 | 14 | `function renderImageLayer() {` |
| `renderVideoLayer` | 176-264 | 89 | `function renderVideoLayer() {` |
| `unmute` | 251-255 | 5 | `const unmute = () => {` |
| `renderLayers` | 265-291 | 27 | `function renderLayers() {` |
| `showByIndex` | 310-316 | 7 | `function showByIndex(kind, idx) {` |
| `toggleVideo` | 320-330 | 11 | `function toggleVideo(on) {` |
| `activeArr` | 332-333 | 2 | `function activeArr() { return videoOn ? vids : imgs; }` |
| `showItem` | 334-342 | 9 | `function showItem(item) {` |
| `doSwitch` | 344-348 | 5 | `function doSwitch() {` |
| `onVideoEnded` | 353-359 | 7 | `function onVideoEnded() {` |
| `onVideoError` | 363-371 | 9 | `function onVideoError() {` |
| `randomCandidates` | 373-380 | 8 | `function randomCandidates() {` |
| `doRandom` | 382-390 | 9 | `function doRandom() {` |
| `clearRandom` | 392-393 | 2 | `function clearRandom() { if (randomTimer) { clearTimeout(randomTimer); randomTimer = null; } }` |
| `scheduleRandom` | 394-403 | 10 | `function scheduleRandom() {` |
| `setMode` | 405-422 | 18 | `function setMode(m) {` |
| `setIntervalMinutes` | 424-429 | 6 | `function setIntervalMinutes(v) {` |
| `closePanel` | 431-432 | 2 | `function closePanel() { panel.classList.remove("open"); }` |
| `closePicker` | 434-435 | 2 | `function closePicker() { picker.classList.remove("open"); }` |
| `updatePickerActions` | 436-441 | 6 | `function updatePickerActions() {` |
| `buildPicker` | 443-489 | 47 | `function buildPicker() {` |
| `openPicker` | 492-498 | 7 | `function openPicker() {` |
| `collectSelectedWallpapers` | 502-509 | 8 | `function collectSelectedWallpapers(ids) {` |
| `removeSelected` | 513-526 | 14 | `async function removeSelected() {` |
| `loadCustomWallpapers` | 551-574 | 24 | `async function loadCustomWallpapers(refresh) {` |

### lib/client-parts/sound/music-extract.js（247 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `startMusic` | 5-247 | 243 | `async function startMusic(dock) {` |
| `loadIdSet` | 7-10 | 4 | `function loadIdSet(key) {` |
| `saveIdSet` | 11-13 | 3 | `function saveIdSet(key, set) {` |
| `fillList` | 23-44 | 22 | `async function fillList() {` |
| `parseSyncsafeSize` | 69-70 | 2 | `function parseSyncsafeSize(v, i) { return ((v[i] & 127) << 21) \| ((v[i + 1] & 127) << 14) \| ((v[i + 2] & 127) << 7) \| (v[i + 3] & 127); }` |
| `readFourCC` | 70-71 | 2 | `function readFourCC(v, i) { return String.fromCharCode(v[i], v[i + 1], v[i + 2], v[i + 3]); }` |
| `str` | 71-83 | 13 | `function str(v, s, e) { let r = ""; for (let i = s; i < e && i < v.length; i++) r += String.fromCharCode(v[i]); return r; }` |
| `flacPicture` | 72-83 | 12 | `function flacPicture(b) {` |
| `u32` | 73-73 | 1 | `const u32 = (i) => ((b[i] << 24) >>> 0) \| ((b[i + 1] << 16)) \| ((b[i + 2] << 8)) \| b[i + 3];` |
| `extractCover` | 84-136 | 53 | `function extractCover(buf) {` |
| `dataUriToBuffer` | 137-153 | 17 | `function dataUriToBuffer(uri) {` |
| `resolveCover` | 154-182 | 29 | `async function resolveCover(item) {` |

### lib/client-parts/sound/music-player.js（348 行 · 21 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fmt` | 1-6 | 6 | `function fmt(t) {` |
| `setCoverImage` | 7-13 | 7 | `function setCoverImage(url) { coverEl.style.backgroundImage = 'url("' + url + '")'; lblEl.style.display = "none"; }` |
| `setCoverFallback` | 8-13 | 6 | `function setCoverFallback(item) {` |
| `updateDisc` | 14-26 | 13 | `function updateDisc(item) {` |
| `refresh` | 27-36 | 10 | `function refresh() {` |
| `loadAndPlay` | 38-50 | 13 | `function loadAndPlay(i) {` |
| `expandCard` | 52-55 | 4 | `function expandCard() {` |
| `collapseMini` | 56-59 | 4 | `function collapseMini() {` |
| `openPicker` | 60-66 | 7 | `function openPicker() {` |
| `closePicker` | 67-68 | 2 | `function closePicker() { picker.classList.remove("open"); }` |
| `toggle` | 69-86 | 18 | `function toggle() {` |
| `shuffleCandidates` | 88-91 | 4 | `function shuffleCandidates() {` |
| `next` | 92-106 | 15 | `function next() {` |
| `prev` | 107-108 | 2 | `function prev() { if (list.length === 0) return; loadAndPlay(current > 0 ? current - 1 : list.length - 1); }` |
| `cycleMode` | 109-114 | 6 | `function cycleMode() {` |
| `setMode` | 115-121 | 7 | `function setMode(modeValue) {` |
| `updatePickerActions` | 123-127 | 5 | `function updatePickerActions() {` |
| `buildPicker` | 128-161 | 34 | `function buildPicker() {` |
| `removeSelectedSongs` | 162-195 | 34 | `async function removeSelectedSongs() {` |
| `setCover` | 201-249 | 49 | `function setCover() {` |
| `onDocClick` | 310-315 | 6 | `const onDocClick = (e) => {` |

### lib/client-parts/sound/typesound.js（265 行 · 21 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureTypeAudio` | 25-31 | 7 | `function ensureTypeAudio() {` |
| `typeNoiseBuffer` | 32-40 | 9 | `function typeNoiseBuffer(ctx) {` |
| `playTypeClick` | 41-73 | 33 | `function playTypeClick(key, style) {` |
| `pick` | 46-46 | 1 | `const pick = (v) => (soft ? v.soft : v.crisp);` |
| `buildVolumeLine` | 76-110 | 35 | `function buildVolumeLine(menu, line, label, ctx) {` |
| `syncIco` | 85-90 | 6 | `const syncIco = () => {` |
| `applyVideoSoundToBg` | 113-120 | 8 | `function applyVideoSoundToBg(loadVol, loadMuted) {` |
| `isEditableTarget` | 125-133 | 9 | `function isEditableTarget(el) {` |
| `attachTypeKeydown` | 135-146 | 12 | `function attachTypeKeydown(isTypeSoundOff, loadStyle) {` |
| `onKeydown` | 136-143 | 8 | `const onKeydown = (e) => {` |
| `buildTypeToggle` | 150-169 | 20 | `function buildTypeToggle(menu, onChange) {` |
| `setBox` | 159-159 | 1 | `const setBox = (on) => tbox.classList.toggle("on", on);` |
| `loadTypeStyle` | 171-193 | 23 | `function loadTypeStyle() { const s = localStorage.getItem("mediascape-dsh-type-style"); return s === "crisp" \|\| s === "soft" ? s : "soft"; }` |
| `buildStylePicker` | 172-193 | 22 | `function buildStylePicker(menu) {` |
| `startSoundPanel` | 195-263 | 69 | `function startSoundPanel(dock) {` |
| `loadVol` | 198-199 | 2 | `function loadVol() { return Math.min(100, Math.max(0, parseInt(localStorage.getItem(LS_VOL) \|\| String(VOL_RANGE.default), 10) \|\| VOL_RANGE.default)); }` |
| `loadMuted` | 199-200 | 2 | `function loadMuted() { return localStorage.getItem(LS_MUTED) !== "0"; }` |
| `saveVol` | 200-201 | 2 | `function saveVol(v) { try { localStorage.setItem(LS_VOL, String(v)); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ } }` |
| `saveMuted` | 201-202 | 2 | `function saveMuted(m) { try { localStorage.setItem(LS_MUTED, m ? "1" : "0"); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ } }` |
| `updateBtnState` | 215-220 | 6 | `const updateBtnState = () => {` |
| `onDocClick` | 245-249 | 5 | `const onDocClick = (e) => {` |

### lib/client-parts/toolbar/dock.js（146 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadDockPos` | 4-17 | 14 | `function loadDockPos(dock, lsKey) {` |
| `saveDockPos` | 18-23 | 6 | `function saveDockPos(dock, lsKey) {` |
| `attachDockDrag` | 26-97 | 72 | `function attachDockDrag(dock, onReposition) {` |
| `clamp` | 31-37 | 7 | `function clamp(x, y) {` |
| `onDown` | 38-44 | 7 | `const onDown = (e) => {` |
| `onMove` | 45-60 | 16 | `const onMove = (e) => {` |
| `onUp` | 61-71 | 11 | `const onUp = (e) => {` |
| `onClickCapture` | 72-74 | 3 | `const onClickCapture = (e) => {` |
| `onResize` | 75-82 | 8 | `const onResize = () => {` |
| `startDock` | 99-144 | 46 | `function startDock() {` |
| `repositionPopup` | 108-131 | 24 | `function repositionPopup(el) {` |
| `repositionPopups` | 132-133 | 2 | `function repositionPopups() { for (const el of popups) repositionPopup(el); }` |

### lib/client.js（3808 行 · 187 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `migrateLegacyKeys` | 59-68 | 10 | `function migrateLegacyKeys() {` |
| `withMediaToken` | 79-86 | 8 | `function withMediaToken(url) {` |
| `ffFetch` | 98-112 | 15 | `async function ffFetch(url, opts = {}, timeoutMs = FF_FETCH_TIMEOUT_MS) {` |
| `fmtBytes` | 115-116 | 2 | `function fmtBytes(n) { return n >= BYTES_PER_MB ? (n / BYTES_PER_MB).toFixed(1) + " MB" : (n / BYTES_PER_KB).toFixed(0) + " KB"; }` |
| `fmtSpeed` | 116-117 | 2 | `function fmtSpeed(bps) { return bps >= BYTES_PER_MB ? (bps / BYTES_PER_MB).toFixed(1) + " MB/s" : (bps / BYTES_PER_KB).toFixed(0) + " KB/s"; }` |
| `createRowOps` | 118-166 | 49 | `function createRowOps(rows, refresh) {` |
| `ffIdbOpen` | 174-187 | 14 | `function ffIdbOpen() {` |
| `ffIdbGetAll` | 188-194 | 7 | `function ffIdbGetAll(store) {` |
| `ffIdbPut` | 195-202 | 8 | `function ffIdbPut(store, record) {` |
| `ffIdbDelete` | 203-210 | 8 | `function ffIdbDelete(store, key) {` |
| `PickerGuard` | 225-237 | 13 | `function PickerGuard() {` |
| `restore` | 229-233 | 5 | `const restore = () => {` |
| `extractColors` | 364-404 | 41 | `function extractColors(img, count = 5) {` |
| `loadImage` | 414-421 | 8 | `function loadImage(url) {` |
| `currentWallpaperColors` | 428-443 | 16 | `async function currentWallpaperColors() {` |
| `wallpaper` | 433-433 | 1 | `const wallpaper = (id ? items.find((x) => x.id === id) : null)` |
| `buildUploadRowEl` | 447-476 | 30 | `function buildUploadRowEl() {` |
| `makeUploadBegin` | 501-523 | 23 | `function makeUploadBegin(ops, root, refresh) {` |
| `makeUploadSkip` | 526-540 | 15 | `function makeUploadSkip(ops, root, rows, refresh) {` |
| `makeUploadDispose` | 543-550 | 8 | `function makeUploadDispose(btn, panel, onDocClick) {` |
| `createUploadToggle` | 552-565 | 14 | `function createUploadToggle(dockEl) {` |
| `bindRowButtons` | 568-576 | 9 | `function bindRowButtons(r, controls) {` |
| `startUploadHud` | 578-624 | 47 | `function startUploadHud(dock) {` |
| `onDocClick` | 589-594 | 6 | `const onDocClick = (e) => {` |
| `refresh` | 600-610 | 11 | `function refresh() {` |
| `runUploadXhr` | 637-653 | 17 | `function runUploadXhr(url, body, onProgress) {` |
| `settleUpload` | 663-671 | 9 | `function settleUpload(uploadResult, userPaused, userCancelled, hud) {` |
| `uploadOneFileXhr` | 673-722 | 50 | `function uploadOneFileXhr(file, kind) {` |
| `run` | 700-710 | 11 | `const run = () => {` |
| `classifyUploadFile` | 732-737 | 6 | `function classifyUploadFile(f) {` |
| `isItemUsable` | 741-743 | 3 | `function isItemUsable(item) {` |
| `refreshList` | 746-751 | 6 | `async function refreshList(kind) {` |
| `groupUploadByKind` | 756-764 | 9 | `function groupUploadByKind(files, hud) {` |
| `dedupeByFileSize` | 768-780 | 13 | `function dedupeByFileSize(files, kind, hud) {` |
| `uploadFiles` | 782-805 | 24 | `async function uploadFiles(files) {` |
| `removeItems` | 809-825 | 17 | `async function removeItems(items) {` |
| `deleteServerFile` | 827-837 | 11 | `function deleteServerFile(item) {` |
| `registerColorCSS` | 857-864 | 8 | `function registerColorCSS() {` |
| `capsuleCSS` | 875-909 | 35 | `function capsuleCSS() {` |
| `visit` | 881-887 | 7 | `function visit(r) {` |
| `identityCSS` | 1307-1310 | 4 | `function identityCSS() {` |
| `resolveAutoBootVideo` | 1335-1354 | 20 | `async function resolveAutoBootVideo(listData) {` |
| `pick` | 1351-1351 | 1 | `const pick = (saved && vids.find((w) => w.id === saved)) \|\| vids[0];` |
| `loadBootGifConfig` | 1355-1412 | 58 | `async function loadBootGifConfig() {` |
| `buildBootOverlay` | 1419-1451 | 33 | `function buildBootOverlay() {` |
| `finishBootIntro` | 1457-1490 | 34 | `function finishBootIntro(ov, st) {` |
| `bootRotateTo` | 1494-1518 | 25 | `function bootRotateTo(ov, urls, index, st) {` |
| `bootStartRotate` | 1521-1542 | 22 | `function bootStartRotate(ov, urls, st) {` |
| `segMs` | 1526-1529 | 4 | `const segMs = (i) => {` |
| `step` | 1530-1540 | 11 | `const step = () => {` |
| `playTransformIntro` | 1544-1595 | 52 | `function playTransformIntro() {` |
| `waitBootMediaReady` | 1598-1634 | 37 | `function waitBootMediaReady(el, timeoutMs) {` |
| `isReadyNow` | 1603-1606 | 4 | `function isReadyNow() {` |
| `cleanup` | 1607-1620 | 14 | `function cleanup(clear, ok) {` |
| `onOk` | 1621-1622 | 2 | `function onOk() { cleanup(true, true); }` |
| `onErr` | 1622-1623 | 2 | `function onErr() { cleanup(true, false); }` |
| `showBootOverlay` | 1641-1725 | 85 | `function showBootOverlay(mediaEl, urls) {` |
| `finish` | 1653-1670 | 18 | `const finish = () => {` |
| `rotateTo` | 1675-1699 | 25 | `function rotateTo(index, urls2) {` |
| `segMs` | 1702-1705 | 4 | `function segMs(index) {` |
| `startRotate` | 1706-1723 | 18 | `function startRotate(urls2) {` |
| `step` | 1710-1720 | 11 | `const step = () => {` |
| `startWallpaper` | 1727-2461 | 735 | `function startWallpaper(dock) {` |
| `loadIdSet` | 1734-1737 | 4 | `function loadIdSet(key) {` |
| `saveIdSet` | 1738-1740 | 3 | `function saveIdSet(key, set) {` |
| `syncModeBtn` | 1816-1821 | 6 | `function syncModeBtn() {` |
| `updateIntervalLine` | 1828-1830 | 3 | `function updateIntervalLine() {` |
| `updateVideoToggle` | 1832-1839 | 8 | `function updateVideoToggle() {` |
| `logSwitch` | 1857-1873 | 17 | `function logSwitch(extra) {` |
| `disposeVideoEl` | 1881-1884 | 4 | `function disposeVideoEl(el) {` |
| `renderImageLayer` | 1886-1899 | 14 | `function renderImageLayer() {` |
| `renderVideoLayer` | 1901-1989 | 89 | `function renderVideoLayer() {` |
| `unmute` | 1976-1980 | 5 | `const unmute = () => {` |
| `renderLayers` | 1990-2016 | 27 | `function renderLayers() {` |
| `showByIndex` | 2035-2041 | 7 | `function showByIndex(kind, idx) {` |
| `toggleVideo` | 2045-2055 | 11 | `function toggleVideo(on) {` |
| `activeArr` | 2057-2058 | 2 | `function activeArr() { return videoOn ? vids : imgs; }` |
| `showItem` | 2059-2067 | 9 | `function showItem(item) {` |
| `doSwitch` | 2069-2073 | 5 | `function doSwitch() {` |
| `onVideoEnded` | 2078-2084 | 7 | `function onVideoEnded() {` |
| `onVideoError` | 2088-2096 | 9 | `function onVideoError() {` |
| `randomCandidates` | 2098-2105 | 8 | `function randomCandidates() {` |
| `doRandom` | 2107-2115 | 9 | `function doRandom() {` |
| `clearRandom` | 2117-2118 | 2 | `function clearRandom() { if (randomTimer) { clearTimeout(randomTimer); randomTimer = null; } }` |
| `scheduleRandom` | 2119-2128 | 10 | `function scheduleRandom() {` |
| `setMode` | 2130-2147 | 18 | `function setMode(m) {` |
| `setIntervalMinutes` | 2149-2154 | 6 | `function setIntervalMinutes(v) {` |
| `closePanel` | 2156-2157 | 2 | `function closePanel() { panel.classList.remove("open"); }` |
| `closePicker` | 2159-2160 | 2 | `function closePicker() { picker.classList.remove("open"); }` |
| `updatePickerActions` | 2161-2166 | 6 | `function updatePickerActions() {` |
| `buildPicker` | 2168-2214 | 47 | `function buildPicker() {` |
| `openPicker` | 2217-2223 | 7 | `function openPicker() {` |
| `collectSelectedWallpapers` | 2227-2234 | 8 | `function collectSelectedWallpapers(ids) {` |
| `removeSelected` | 2238-2251 | 14 | `async function removeSelected() {` |
| `loadCustomWallpapers` | 2276-2299 | 24 | `async function loadCustomWallpapers(refresh) {` |
| `syncBgEnabledUI` | 2358-2367 | 10 | `function syncBgEnabledUI() {` |
| `setBgEnabled` | 2368-2375 | 8 | `function setBgEnabled(on) {` |
| `onBgDocClick` | 2387-2393 | 7 | `const onBgDocClick = (e) => {` |
| `defaultWallpaper` | 2418-2422 | 5 | `function defaultWallpaper() {` |
| `initWallpaper` | 2424-2447 | 24 | `async function initWallpaper() {` |
| `createAmbientDots` | 2476-2495 | 20 | `function createAmbientDots(wrap, maxCount) {` |
| `createAmbienceLine` | 2498-2515 | 18 | `function createAmbienceLine(dock, panel, onCycle) {` |
| `startAmbience` | 2517-2566 | 50 | `function startAmbience(dock) {` |
| `setLevel` | 2533-2552 | 20 | `function setLevel(key, instant) {` |
| `createFontToggle` | 2578-2586 | 9 | `function createFontToggle(dock) {` |
| `createFontCycle` | 2589-2631 | 43 | `function createFontCycle(btn, applyScale) {` |
| `setLevel` | 2599-2607 | 9 | `function setLevel(key) {` |
| `restore` | 2615-2618 | 4 | `function restore(key) {` |
| `startFont` | 2633-2651 | 19 | `function startFont(dock) {` |
| `applyScale` | 2636-2649 | 14 | `function applyScale(scale) {` |
| `ensureTypeAudio` | 2676-2682 | 7 | `function ensureTypeAudio() {` |
| `typeNoiseBuffer` | 2683-2691 | 9 | `function typeNoiseBuffer(ctx) {` |
| `playTypeClick` | 2692-2724 | 33 | `function playTypeClick(key, style) {` |
| `pick` | 2697-2697 | 1 | `const pick = (v) => (soft ? v.soft : v.crisp);` |
| `buildVolumeLine` | 2727-2761 | 35 | `function buildVolumeLine(menu, line, label, ctx) {` |
| `syncIco` | 2736-2741 | 6 | `const syncIco = () => {` |
| `applyVideoSoundToBg` | 2764-2771 | 8 | `function applyVideoSoundToBg(loadVol, loadMuted) {` |
| `isEditableTarget` | 2776-2784 | 9 | `function isEditableTarget(el) {` |
| `attachTypeKeydown` | 2786-2797 | 12 | `function attachTypeKeydown(isTypeSoundOff, loadStyle) {` |
| `onKeydown` | 2787-2794 | 8 | `const onKeydown = (e) => {` |
| `buildTypeToggle` | 2801-2820 | 20 | `function buildTypeToggle(menu, onChange) {` |
| `setBox` | 2810-2810 | 1 | `const setBox = (on) => tbox.classList.toggle("on", on);` |
| `loadTypeStyle` | 2822-2844 | 23 | `function loadTypeStyle() { const s = localStorage.getItem("mediascape-dsh-type-style"); return s === "crisp" \|\| s === "soft" ? s : "soft"; }` |
| `buildStylePicker` | 2823-2844 | 22 | `function buildStylePicker(menu) {` |
| `startSoundPanel` | 2846-2914 | 69 | `function startSoundPanel(dock) {` |
| `loadVol` | 2849-2850 | 2 | `function loadVol() { return Math.min(100, Math.max(0, parseInt(localStorage.getItem(LS_VOL) \|\| String(VOL_RANGE.default), 10) \|\| VOL_RANGE.default)); }` |
| `loadMuted` | 2850-2851 | 2 | `function loadMuted() { return localStorage.getItem(LS_MUTED) !== "0"; }` |
| `saveVol` | 2851-2852 | 2 | `function saveVol(v) { try { localStorage.setItem(LS_VOL, String(v)); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ } }` |
| `saveMuted` | 2852-2853 | 2 | `function saveMuted(m) { try { localStorage.setItem(LS_MUTED, m ? "1" : "0"); } catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ } }` |
| `updateBtnState` | 2866-2871 | 6 | `const updateBtnState = () => {` |
| `onDocClick` | 2896-2900 | 5 | `const onDocClick = (e) => {` |
| `startMusic` | 2920-3507 | 588 | `async function startMusic(dock) {` |
| `loadIdSet` | 2922-2925 | 4 | `function loadIdSet(key) {` |
| `saveIdSet` | 2926-2928 | 3 | `function saveIdSet(key, set) {` |
| `fillList` | 2938-2959 | 22 | `async function fillList() {` |
| `parseSyncsafeSize` | 2984-2985 | 2 | `function parseSyncsafeSize(v, i) { return ((v[i] & 127) << 21) \| ((v[i + 1] & 127) << 14) \| ((v[i + 2] & 127) << 7) \| (v[i + 3] & 127); }` |
| `readFourCC` | 2985-2986 | 2 | `function readFourCC(v, i) { return String.fromCharCode(v[i], v[i + 1], v[i + 2], v[i + 3]); }` |
| `str` | 2986-2998 | 13 | `function str(v, s, e) { let r = ""; for (let i = s; i < e && i < v.length; i++) r += String.fromCharCode(v[i]); return r; }` |
| `flacPicture` | 2987-2998 | 12 | `function flacPicture(b) {` |
| `u32` | 2988-2988 | 1 | `const u32 = (i) => ((b[i] << 24) >>> 0) \| ((b[i + 1] << 16)) \| ((b[i + 2] << 8)) \| b[i + 3];` |
| `extractCover` | 2999-3051 | 53 | `function extractCover(buf) {` |
| `dataUriToBuffer` | 3052-3068 | 17 | `function dataUriToBuffer(uri) {` |
| `resolveCover` | 3069-3097 | 29 | `async function resolveCover(item) {` |
| `fmt` | 3162-3167 | 6 | `function fmt(t) {` |
| `setCoverImage` | 3168-3174 | 7 | `function setCoverImage(url) { coverEl.style.backgroundImage = 'url("' + url + '")'; lblEl.style.display = "none"; }` |
| `setCoverFallback` | 3169-3174 | 6 | `function setCoverFallback(item) {` |
| `updateDisc` | 3175-3187 | 13 | `function updateDisc(item) {` |
| `refresh` | 3188-3197 | 10 | `function refresh() {` |
| `loadAndPlay` | 3199-3211 | 13 | `function loadAndPlay(i) {` |
| `expandCard` | 3213-3216 | 4 | `function expandCard() {` |
| `collapseMini` | 3217-3220 | 4 | `function collapseMini() {` |
| `openPicker` | 3221-3227 | 7 | `function openPicker() {` |
| `closePicker` | 3228-3229 | 2 | `function closePicker() { picker.classList.remove("open"); }` |
| `toggle` | 3230-3247 | 18 | `function toggle() {` |
| `shuffleCandidates` | 3249-3252 | 4 | `function shuffleCandidates() {` |
| `next` | 3253-3267 | 15 | `function next() {` |
| `prev` | 3268-3269 | 2 | `function prev() { if (list.length === 0) return; loadAndPlay(current > 0 ? current - 1 : list.length - 1); }` |
| `cycleMode` | 3270-3275 | 6 | `function cycleMode() {` |
| `setMode` | 3276-3282 | 7 | `function setMode(modeValue) {` |
| `updatePickerActions` | 3284-3288 | 5 | `function updatePickerActions() {` |
| `buildPicker` | 3289-3322 | 34 | `function buildPicker() {` |
| `removeSelectedSongs` | 3323-3356 | 34 | `async function removeSelectedSongs() {` |
| `setCover` | 3362-3410 | 49 | `function setCover() {` |
| `onDocClick` | 3471-3476 | 6 | `const onDocClick = (e) => {` |
| `loadDockPos` | 3512-3525 | 14 | `function loadDockPos(dock, lsKey) {` |
| `saveDockPos` | 3526-3531 | 6 | `function saveDockPos(dock, lsKey) {` |
| `attachDockDrag` | 3534-3605 | 72 | `function attachDockDrag(dock, onReposition) {` |
| `clamp` | 3539-3545 | 7 | `function clamp(x, y) {` |
| `onDown` | 3546-3552 | 7 | `const onDown = (e) => {` |
| `onMove` | 3553-3568 | 16 | `const onMove = (e) => {` |
| `onUp` | 3569-3579 | 11 | `const onUp = (e) => {` |
| `onClickCapture` | 3580-3582 | 3 | `const onClickCapture = (e) => {` |
| `onResize` | 3583-3590 | 8 | `const onResize = () => {` |
| `startDock` | 3607-3652 | 46 | `function startDock() {` |
| `repositionPopup` | 3616-3639 | 24 | `function repositionPopup(el) {` |
| `repositionPopups` | 3640-3641 | 2 | `function repositionPopups() { for (const el of popups) repositionPopup(el); }` |
| `injectIdentityStyle` | 3660-3667 | 8 | `function injectIdentityStyle() {` |
| `cleanupStaleDom` | 3674-3688 | 15 | `function cleanupStaleDom() {` |
| `stopMedia` | 3675-3680 | 6 | `const stopMedia = (root) => {` |
| `registerTheme` | 3691-3702 | 12 | `function registerTheme(ctx) {` |
| `reorderDockButtons` | 3706-3711 | 6 | `function reorderDockButtons(dock) {` |
| `btnByText` | 3708-3708 | 1 | `const btnByText = (t) => allBtns.find((b) => b.textContent === t);` |
| `lockDarkMode` | 3714-3723 | 10 | `function lockDarkMode() {` |
| `enforce` | 3715-3718 | 4 | `const enforce = () => {` |
| `setupEscClose` | 3726-3735 | 10 | `function setupEscClose(dock) {` |
| `onEsc` | 3727-3732 | 6 | `const onEsc = (e) => {` |
| `apply` | 3737-3800 | 64 | `function apply(ctx) {` |

### lib/config.js（71 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `uploadLimitBytes` | 59-70 | 12 | `export function uploadLimitBytes(dir) {` |

### lib/debug.js（141 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `debugConfigPath` | 30-32 | 3 | `export function debugConfigPath() {` |
| `parseDebugConfig` | 45-59 | 15 | `function parseDebugConfig(cfg) {` |
| `readDebugConfig` | 61-72 | 12 | `export function readDebugConfig(force = false) {` |
| `logEnabled` | 81-86 | 6 | `export function logEnabled(category) {` |
| `isDebug` | 92-94 | 3 | `export function isDebug(key) {` |
| `logTs` | 101-105 | 5 | `export function logTs(d = new Date()) {` |
| `rotate` | 107-115 | 9 | `function rotate(file) {` |
| `writeLog` | 123-139 | 17 | `export function writeLog(name, entry) {` |

### lib/handlers-log.js（197 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `wallpaperLogPath` | 16-17 | 2 | `function wallpaperLogPath() { return join(logsDir(), WALLPAPER_LOG_FILE); }` |
| `appendWallpaperLog` | 19-21 | 3 | `export function appendWallpaperLog(entry) {` |
| `readFileTail` | 37-57 | 21 | `function readFileTail(file, maxLines) {` |
| `readWallpaperLog` | 60-70 | 11 | `export function readWallpaperLog(lines = DEFAULT_LOG_LINES) {` |
| `nextAvailableName` | 73-77 | 5 | `export function nextAvailableName(dir, base, ext) {` |
| `uploadErrorResponse` | 80-90 | 11 | `export function uploadErrorResponse(res, payload, traceId, e, tag) {` |
| `finalizeUpload` | 102-127 | 26 | `export async function finalizeUpload(dir, payload, safeName, size, opts = {}) {` |
| `handleUploadPartDelete` | 134-157 | 24 | `export function handleUploadPartDelete(req, res) {` |
| `handleWallpaperLog` | 160-189 | 30 | `export function handleWallpaperLog(req, res) {` |
| `handleWallpaperLogRead` | 192-197 | 6 | `export function handleWallpaperLogRead(req, res, url) {` |

### lib/handlers-upload.js（320 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `memBufferLimit` | 23-25 | 3 | `function memBufferLimit() {` |
| `receiveBody` | 27-115 | 89 | `function receiveBody(req, { tmpPath, partPath, limit, offset = 0 }) {` |
| `flushBufferToPart` | 42-46 | 5 | `const flushBufferToPart = () => {` |
| `onInterrupt` | 100-111 | 12 | `const onInterrupt = (label, err) => {` |
| `cleanupOrphanParts` | 118-129 | 12 | `function cleanupOrphanParts(dir, maxAgeMs = 24 * 3600 * 1000) {` |
| `handleFileUpload` | 139-247 | 109 | `function handleFileUpload(req, res, { kind }) {` |
| `handleUpload` | 250-252 | 3 | `export function handleUpload(req, res) {` |
| `handleMusicUpload` | 255-257 | 3 | `export function handleMusicUpload(req, res) {` |
| `handleCoverUpload` | 264-320 | 57 | `export function handleCoverUpload(req, res) {` |

### lib/handlers.js（278 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleConfig` | 35-41 | 7 | `export function handleConfig(res) {` |
| `deleteWallpaperFile` | 46-62 | 17 | `function deleteWallpaperFile(file, dir) {` |
| `handleDelete` | 64-81 | 18 | `export function handleDelete(req, res, rel) {` |
| `scanWallpaperDir` | 86-108 | 23 | `function scanWallpaperDir(dir, labels) {` |
| `mergeOnlineWallpapers` | 111-134 | 24 | `function mergeOnlineWallpapers(items, labels) {` |
| `handleList` | 136-152 | 17 | `export function handleList(res) {` |
| `handleMusicList` | 158-222 | 65 | `export function handleMusicList(res) {` |
| `handleMusicDelete` | 236-274 | 39 | `export function handleMusicDelete(req, res, rel) {` |

### lib/index.js（292 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `logApiRequest` | 33-48 | 16 | `function logApiRequest(req, res, rel) {` |
| `parseRange` | 56-69 | 14 | `function parseRange(range, total) {` |
| `pipeFile` | 77-82 | 6 | `function pipeFile(res, file, range) {` |
| `serveStream` | 83-128 | 46 | `function serveStream(res, req, file, mime) {` |
| `routeAssetsHandler` | 132-212 | 81 | `function routeAssetsHandler(req, res, url, rel, top) {` |
| `registerAssets` | 214-247 | 34 | `export function registerAssets(ctx) {` |
| `ensureDebugServer` | 261-280 | 20 | `function ensureDebugServer() {` |
| `apply` | 283-291 | 9 | `export function apply(ctx) {` |

### lib/labels.js（48 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readMap` | 16-22 | 7 | `function readMap(p) {` |
| `writeMap` | 24-31 | 8 | `function writeMap(p, map) {` |
| `loadWallpaperLabels` | 34-35 | 2 | `export function loadWallpaperLabels() { return readMap(wallpaperLabelsPath()); }` |
| `saveWallpaperLabels` | 37-38 | 2 | `export function saveWallpaperLabels(map) { writeMap(wallpaperLabelsPath(), map); }` |
| `loadMusicLabels` | 40-41 | 2 | `export function loadMusicLabels() { return readMap(musicLabelsPath()); }` |
| `saveMusicLabels` | 43-44 | 2 | `export function saveMusicLabels(map) { writeMap(musicLabelsPath(), map); }` |
| `loadLabels` | 46-47 | 2 | `export function loadLabels() { return loadWallpaperLabels(); }` |
| `saveLabels` | 47-48 | 2 | `export function saveLabels(map) { return saveWallpaperLabels(map); }` |

### lib/online.js（223 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadOnlineSources` | 31-46 | 16 | `function loadOnlineSources() {` |
| `downloadOne` | 55-83 | 29 | `function downloadOne(src) {` |
| `prehash` | 88-101 | 14 | `function prehash(ctx) {` |
| `retry` | 104-107 | 4 | `function retry(msg, triesLeft, ctx) {` |
| `handleUnresumable` | 110-114 | 5 | `function handleUnresumable(res, tries, ctx) {` |
| `handleOverLimit` | 117-122 | 6 | `function handleOverLimit(size, req, ws, ctx) {` |
| `finalizeDownload` | 125-143 | 19 | `function finalizeDownload(hashAcc, ws, ctx) {` |
| `handleResponse` | 146-180 | 35 | `function handleResponse(res, offset, hashAcc, tries, ctx) {` |
| `failTo` | 160-164 | 5 | `const failTo = (msg, t) => {` |
| `attempt` | 183-191 | 9 | `function attempt(offset, hashAcc, tries, ctx) {` |
| `downloadAllOnline` | 194-212 | 19 | `async function downloadAllOnline() {` |
| `worker` | 200-208 | 9 | `const worker = async () => {` |
| `ensureOnlineDownload` | 217-222 | 6 | `export function ensureOnlineDownload() {` |

### lib/paths.js（54 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `baseDir` | 8-10 | 3 | `function baseDir() {` |
| `themeDir` | 13-14 | 2 | `export function themeDir() { return join(baseDir(), 'theme-mediascape'); }` |
| `bootDir` | 16-17 | 2 | `export function bootDir() { return join(themeDir(), 'boot'); }` |
| `logsDir` | 19-20 | 2 | `export function logsDir() { return join(themeDir(), 'logs'); }` |
| `wallpaperDir` | 22-23 | 2 | `export function wallpaperDir() { return join(themeDir(), 'wallpaper'); }` |
| `musicDir` | 25-26 | 2 | `export function musicDir() { return join(themeDir(), 'music'); }` |
| `onlineDir` | 30-31 | 2 | `export function onlineDir() { return join(wallpaperDir(), ONLINE_DIR_NAME); }` |
| `wallpaperLabelsPath` | 38-39 | 2 | `export function wallpaperLabelsPath() { return join(wallpaperDir(), WALLPAPER_LABELS_FILE); }` |
| `musicLabelsPath` | 46-47 | 2 | `export function musicLabelsPath() { return join(musicDir(), MUSIC_LABELS_FILE); }` |
| `runtimeCapsulesPath` | 53-54 | 2 | `export function runtimeCapsulesPath() { return join(themeDir(), 'capsules.json'); }` |

### test/e2e/assert-file-usable-check.mjs（120 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isItemUsable` | 48-48 | 1 | `const isItemUsable = (item) => !!(item && (item.file \|\| item.name) && typeof item.size === 'number' && item.size >= 0);` |

### test/e2e/auto-final.mjs（33 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `snap` | 10-22 | 13 | `const snap = async (label) => {` |

### test/e2e/auto-run.mjs（34 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `snap` | 10-23 | 14 | `const snap = async (label) => {` |

### test/e2e/auto-run2.mjs（35 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `snap` | 10-24 | 15 | `const snap = async (label) => {` |

### test/e2e/boot-durations-check.mjs（27 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `snap` | 8-15 | 8 | `const snap = async (label) => {` |

### test/e2e/boot-e2e-check.mjs（34 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `snap` | 8-21 | 14 | `const snap = async (label) => {` |

### test/e2e/boot-noblack-check.mjs（25 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `snap` | 8-15 | 8 | `const snap = async (label) => {` |

### test/e2e/boot-rotate-sim.mjs（38 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `simulate` | 2-23 | 22 | `function simulate(urls, durationMs, loop, stepCount) {` |
| `step` | 7-16 | 10 | `const step = () => {` |

### test/e2e/capsules-cache-fallback-check.mjs（117 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 29-32 | 4 | `const check = (name, ok, detail) => {` |
| `extractCapsules` | 34-38 | 5 | `const extractCapsules = (js) => {` |

### test/e2e/music-upload-cover-check.mjs（119 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `musicJson` | 51-54 | 4 | `const musicJson = () => {` |

### test/e2e/ui-dock-panels-screenshot.mjs（84 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `wait` | 36-36 | 1 | `const wait = (ms) => new Promise((r) => setTimeout(r, ms));` |
| `snap` | 46-50 | 5 | `const snap = async (name) => {` |

### test/e2e/ui-dock-upload-remove-check.mjs（165 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apiList` | 39-42 | 4 | `const apiList = async (p) => {` |
| `wait` | 43-43 | 1 | `const wait = (ms) => new Promise((r) => setTimeout(r, ms));` |
| `shot` | 45-50 | 6 | `const shot = async (page, name) => {` |

### test/e2e/upload-api-check.mjs（134 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensurePreview` | 30-59 | 30 | `const ensurePreview = () => {` |
| `api` | 61-75 | 15 | `const api = async (method, path, body, ct) => {` |
| `musicDir` | 78-81 | 4 | `const musicDir = () => {` |

### test/e2e/upload-resume-check.mjs（126 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 20-23 | 4 | `const check = (name, ok, detail) => {` |
| `makeReq` | 30-35 | 6 | `function makeReq(reqUrl) {` |
| `makeRes` | 36-43 | 8 | `function makeRes() {` |
| `waitDone` | 44-47 | 4 | `async function waitDone(fakeResp, timeout = 2000) {` |
| `pump` | 48-54 | 7 | `async function pump(req, buf, chunkSize = 128 * 1024) {` |

### test/e2e/upload-speed-check.mjs（89 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 27-30 | 4 | `const check = (name, ok, detail) => {` |
| `makeReq` | 35-36 | 2 | `function makeReq(url) { const r = new Readable({ read() {} }); r.url = url; r.headers = {}; return r; }` |
| `makeRes` | 36-40 | 5 | `function makeRes() { return { status: 0, body: '', done: false, writeHead(s) { this.status = s; }, end(d) { this.body = String(d \|\| ''); this.done = true; } }; }` |
| `waitDone` | 37-40 | 4 | `async function waitDone(fakeResp, timeout = 60000) {` |
| `pump` | 41-47 | 7 | `async function pump(req, buf, chunk = 256 * 1024) {` |
| `forceLog` | 50-56 | 7 | `function forceLog(line) {` |

### test/e2e/upload-stream-write-check.mjs（157 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 20-23 | 4 | `const check = (name, ok, detail) => {` |
| `makeReqRes` | 29-40 | 12 | `function makeReqRes() {` |
| `waitDone` | 42-47 | 6 | `async function waitDone(fakeResp, timeout = 2000) {` |
| `pump` | 49-56 | 8 | `async function pump(req, buf, chunkSize = 64 * 1024, onChunk) {` |

### test/e2e/video-cache-compare.mjs（156 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 21-24 | 4 | `const check = (name, ok, detail) => {` |
| `serveOld` | 27-44 | 18 | `function serveOld(res, req, file) {` |
| `serveNew` | 47-78 | 32 | `function serveNew(res, req, file) {` |
| `httpGet` | 81-92 | 12 | `function httpGet(port, path, headers) {` |

### test/run-all.mjs（126 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `testLogPath` | 23-26 | 4 | `function testLogPath() {` |
| `testLogTs` | 27-31 | 5 | `function testLogTs(d = new Date()) {` |
| `testLogWrite` | 32-38 | 7 | `function testLogWrite(entry) {` |

<!-- dshgp-functions:end -->

<!-- dshgp-version:start -->
## 版本列表

| 版本 | 内容 |
|------|------|
| 1.0.2 | 1.0.2 mht 快照还原预览——①theme-studio/preview.html 集成 DSH 界面 .mht 直接解析还原（聊天框+侧边栏+壁纸背景+dock 静态还原，URL 相对化走真实壁纸，剔除 eruda/cid 引用）②假数据：操作日志内容→聊天框模拟用户消息、任务列表「预览页加载」页面加载完自动变 1/1 完成、工作区树一个文件夹（测试工作区）+一个会话（测试会话）③侧边栏收起按 DSH 真实行为模拟（收起替换为 rail 形态 DOM 会话列表整个移除、56px 窄栏、品牌 logo railMark、aria 原文）④操作日志与顶部预览态提示默认隐藏+右下角「日志」开关调出⑤修正：collapsed 快照 DOM 补闭合防聊天框被吞、工作区树 slot 误填文字清空、URL 相对化保留根路径；版本同步 1.0.2（package.json/online.js UA/CHANGELOG/README）；mht 源文件与中间产物清理入 .trash 可恢复 |
| 1.0.1 | 1.0.1 审计优化——①大文件拆分：handlers.js→handlers/upload/log 三模块（763→259+319+191）、utils.js→utils/utils-upload（558→196+363）、build.cjs→胶囊数据独立文件（533→326）②函数拆分 15+：apply×6/startUploadHud×5/uploadFiles×2/uploadOneFileXhr/ambience×2/handleDelete/handleList/readDebugConfig/startFont×2/removeSelected/attachTypeKeydown ③图片主色提取 API：__mediascapeDshExtractColors + __mediascapeDshCurrentWallpaperColors ④模糊变量语义化 26 处 + 外部请求补超时 6 处 + 反代 token 豁免 + test/ .samples ⑤质量评分 78.9→80.9/B（0 拦截）；行为零变化，全量回归+构建+渲染通过；版本记录 CHANGELOG.md |
| 1.0.0 | 1.0.0 首发——桌面媒体氛围主题：dock 工具条（字/景/声/乐/传）、图片视频壁纸（mp4/webm、在线资源断点续传、上传中途不落盘+暂停落盘.part+offset 续传+去重预检+真实删除）、音乐播放器、配色盘（单真源动态元素行+jscolor+预设切换）、开屏动画、HTTP API、playwright 积木化录像测试；版本记录 CHANGELOG.md |

<!-- dshgp-version:end -->
