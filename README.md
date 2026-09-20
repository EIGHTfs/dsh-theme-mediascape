# dsh-theme-mediascape · 媒体景观主题

> 🌌 以崩坏：星穹铁道「流萤」素材为灵感的 **DeepSeek Harness Web UI** 媒体景观主题插件。
> 萤火绿霓虹配色 × 立绘/动态壁纸 × 开屏变身动画 × 萤火氛围粒子 × 背景音乐 × 打字音效。

让流萤的萤火为你点亮DSH。✨

## 🖼️ 预览与演示

### 动态 / 静态壁纸

![壁纸](docs/screenshots/01-wallpaper.jpg)

### 开屏变身动画

![开屏动画](docs/screenshots/02-boot.jpg)

### 萤火氛围粒子

![萤火粒子](docs/screenshots/03-firefly.jpg)

### 背景音乐播放器

![背景音乐](docs/screenshots/04-music.jpg)

> 🎬 演示视频（B 站）：
https://www.bilibili.com/video/BV1nF8B6QEEj/?spm_id_from=333.1387.homepage.video_card.click&vd_source=573abae8b62b8edf27edc7cb8933e1b6

---

## ✨ 功能特性

### 壁纸系统（图片 / 动态视频）

- 全屏 `cover` 铺底，界面容器半透明让壁纸透出；左暗右亮渐变遮罩保证聊天区可读
- 「**景**」按钮弹出常驻面板：
  - **类型**：动态（mp4）/ 静态（图片），各自独立记忆当前壁纸
  - **选择**：弹出缩略图网格（正方形预览、固定三行、可滚动），点卡片直接应用该壁纸
  - **移除**：在网格中勾选一张/多张后点「移除」——内置壁纸记为隐藏、运行时导入的壁纸从服务器删除（移入回收站，可恢复）
  - **随机**：勾选若干张后点「随机」——把它们设为随机轮换池并立即进入随机模式（不勾选则等于全部）
  - **随机间隔**：自定义分钟数（默认 5 分钟）
  - **＋ 添加壁纸**：从本机一次多选导入图片/视频（Ctrl/框选），同名同大小自动去重，立即生效（**服务器磁盘持久化**：写入 `$DSH_HOME/theme-firefly/wallpapers/`，刷新/重启/换浏览器都在；列表显示上传时的原始文件名）
  - **上传上限**：按服务器剩余磁盘空间动态计算（默认单文件最多占剩余空间 80%，底线 512MB），装得下就传，快满自动收紧
  - **默认壁纸**：首次安装（无历史记录）时优先展示 `assets/Default_wallpaper.png`
  - 选择面板点右上角「**—**」或再点「选择」收起；点「**确定**」收起设置面板，所有设置实时生效并持久化

### 流萤配色

- 深空海军蓝黑 × 萤火虫青绿（`#00ff87` / `#7dff9e`）× 莹白文字
- 覆盖 100+ 个 `--dsw-*` 设计令牌，随主题即时生效

### 开屏变身动画

- 启动页 GIF（`GIF/boot.json` 配置指定文件）居中淡入，带绿色辉光边框 + 「流萤 // FIREFLY」标题
- 每次刷新播放，时长取配置（默认 10s），点击任意处或「点击跳过」可跳过
- 尊重系统 `prefers-reduced-motion`，自动跳过

### 萤火氛围粒子

- 「**萤**」按钮分档：关 / 星点（12）/ 曳光（28）/ 流萤（80）
- 数量切换带 0.9s 淡入淡出过渡，不陡然变化、不刷新页面
- 每只萤火虫有独立尺寸、亮度、漂浮轨迹与呼吸式闪烁

### 背景音乐

- 「**乐**」按钮点击开/关，弹出音乐面板
- 旋转唱片 + 封面（内置曲目开箱即用默认「知更鸟」封面，也可手动指定）+ 进度条拖动跳转
- 上一首 / 播放暂停 / 下一首 / 循环模式（单曲循环 → 列表循环 → 随机播放）
- **选择**：弹出歌单，勾选后**移除**（内置歌曲隐藏、导入歌曲删除）或**随机**（以勾选歌曲为随机池）
- **＋ 添加歌曲**：从本机导入音乐并持久化；无封面时自动读取内嵌封面（MP3/FLAC）
- **缩小 / ESC**：收起为 dock 左侧的**毛玻璃迷你播放器**（大唱片在上、进度条在下，
  点「隐藏封面」可切成只留进度条的简洁胶囊，「展开」恢复完整面板）
- 当前曲目与循环模式持久化

### 打字音效

- 聊天输入框打字时播放「咔哒 + 低频咚」的萤火质感按键音
- Web Audio 实时合成，零音频文件；空格/回车音色更低；「**声**」按钮开关

### 彩蛋

- **开屏动画**：输入框发送 **`SAM`** → 重播开屏变身动画（精确匹配，普通消息不误触）

---

## 🎛️ 界面操作

四个按钮（自右向左）收在一个**可拖动的毛玻璃长条面板**里：

| 按钮 | 功能 |
|---|---|
| **声** | 打字音效 开/关 |
| **萤** | 氛围粒子分档（关/星点/曳光/流萤） |
| **景** | 壁纸设置（类型 + 选择/随机 + 随机间隔 + 添加壁纸 + 确定） |
| **乐** | 背景音乐 开/关 + 播放面板 + 迷你播放器 |

> 🖱️ 按住面板任意位置拖动即可移动，位置自动记忆（重启 `dsh web` 后仍生效）。
> 音乐面板、歌单选择、壁纸设置、壁纸选择器弹层会相对该面板**水平居中对齐**，
> 并自动保持在屏幕内；迷你播放器则**紧邻面板左侧**显示。

> 按 **ESC**：关闭壁纸 / 氛围 / 歌单等浮层；音乐面板展开时**收起为迷你播放器**
>（不会关闭迷你播放器）。

---

## 🎨 灵感来源

- **角色与主题**：本主题致敬米哈游《崩坏：星穹铁道》中的角色 **流萤（Firefly）** 与其机甲 **S.A.M.** ——「完全燃烧」的变身、萤火虫般的荧光、以及那句「我将点燃大海」。
- **音乐**：默认曲目为 HOYO-MiX 出品的《**使一颗心免于哀伤**》（知更鸟演唱），曲库另含《在银河中孤独摇摆》《希望有羽毛和翅膀》《若我不曾见过太阳》《唯有追赶风的方向》。
- **实现参考**：客户端主题的「令牌层 + 身份层」架构与 cordis 插件结构，学习自 [dsh-theme-cyberpunk2077](https://github.com/Tommy00748/dsh-theme-cyberpunk2077)（作者 Tommy00748），特此致谢。
- **生态**：DSH 插件目录 [awesome-dsh-plugin](https://github.com/beancookie/awesome-dsh-plugin)。

---

## 📁 目录结构

```
dsh-theme-mediascape/
├── package.json            # dsh.client 声明（web 插件，注入 ui-theme 槽位）
├── lib/index.js            # 服务端入口：注册 /theme-mediascape-assets 前缀路由 + apply
├── lib/config.js           # 服务端配置：MIME 表 / 白名单 / 上传上限（statfs 动态）
├── lib/paths.js            # 服务端路径推导：壁纸目录 / labels 文件 / 在线下载子目录
├── lib/labels.js           # 服务端 labels 映射读写（hash 主键 → 展示文件名）
├── lib/online.js           # 服务端在线资源下载（.part 断点续传 + SHA-1 校验 + 后台静默）
├── lib/handlers.js         # 服务端 HTTP 处理器：删除 / 列表 / 上传
├── lib/client-parts/       # 浏览器端主题源码（16 片段按职责拆分，build 时按序拼接回单文件）
├── lib/client.js           # 构建产物（build.cjs --clean 生成，只含 URL 清单，随仓库提交干净版）
├── assets/                 # 壁纸：图片(jpg/png/webp) + mp4 动态壁纸
├── GIF/                    # 开屏动图（boot.json 配置指定文件，保留 4bfecb05<…>.gif）
│   └── boot.json           # 开屏启动页配置（file + durationMs）
├── music/                  # 背景音乐（mp3/ogg/m4a/wav），默认第一首「使一颗心免于哀伤」
│   └── figure/             # 内置歌曲默认封面（取第一张图片，如知更鸟图）
├── build.cjs               # 构建：读取 lib/client-parts/ 片段拼回模板，把素材清单（URL）注入 lib/client.js
├── build.music-exclude.txt # 音乐排除清单（clean 构建时不收录其中列出的曲目）
├── LICENSE                 # MIT（仅代码）
├── .gitignore              # 忽略构建产物与第三方壁纸
└── README.md
```

---

## 🚀 快速开始

### 方式一：npm 安装（推荐，一条命令开箱即用）

```powershell
dsh plugin --profile web add dsh-theme-mediascape
```

装完重启 `dsh web` 即生效。npm 包已内置「干净版」`lib/client.js`（只含素材 URL 清单，
素材本体由服务端 `/theme-mediascape-assets/` 静态路由提供），**免 git、免构建、包体积小**。

### 方式二：GitHub 源码安装（开发者/想改素材时用）

```powershell
# 1. clone 本仓库（仓库已提交干净版 client.js，clone 后开箱即用）
git clone https://github.com/EIGHTfs/dsh-theme-mediascape.git

# 2. 以 link 方式安装到 web profile（本插件声明了 dsh.bundle，会自动注册）
dsh plugin --profile web add "link:<本目录绝对路径>"

# 3. 重启 dsh web 生效
```

> 想改内置素材时，改完 `assets/` 等目录后运行 `node build.cjs --clean` 重新构建干净版
> （构建只更新 `lib/client.js` 里的 URL 清单，素材文件本身无需内嵌）。

> 💡 开箱即用含一张**动态壁纸**（演示视频）与多张静态立绘；想加更多壁纸，
> 直接点「景」→「＋ 添加壁纸」导入，或把文件放入 `assets/` 后重新构建（见「自定义素材」）。

> ⚠️ 与其它主题（如赛博朋克主题）互斥：多个主题都会调用 `ctx.theme.setTheme`
> 并注入 `!important` 令牌样式，**后加载的赢**。建议同时只启用一个主题
> （把其它主题的 patch 行注释掉即可，可随时恢复）。

## 卸载

```powershell
dsh plugin --profile web remove dsh-theme-mediascape
# 重启 dsh web 生效
```

## 📚 更多文档

- [FAQ 常见问题](./FAQ.md)

---

## 🛠️ 自定义素材

**壁纸**有两种添加方式：

1. **运行时添加（推荐）**：点「景」→「＋ 添加壁纸」，从本机一次多选图片/视频（Ctrl/框选），立即生效并持久化
2. **打包收录**：把文件放入 `assets/` 后运行 `node build.cjs`（适合预置默认壁纸，素材外置由静态路由提供）

**在线资源**（配置随主题分发，别人拿到主题即可用，无需改代码）：

在 `lib/online-sources.json` 的 `sources` 里按 hash 主键登记即可，主题启动时后台静默下载缺失项到 `wallpapers/online/`，下载完毕自动出现在壁纸列表、可直接选用：

```json
{
  "sources": {
    "<sha1-40位hex>": { "name": "示例视频.mp4", "url": "https://example.com/video.mp4" }
  }
}
```

- **hash**：下载内容的 SHA-1（40 位 hex），同时是去重键与完整性校验（下载后校验一致才落定）
- **断点续传**：中断保留 `<hash>.<ext>.part`，下次启动从断点继续（Range 请求），校验通过才重命名落定
- **本地 / 在线共存**：本地上传与在线下载同列表展示；同 hash 内容以本地上传优先
- 内置 `assets/` 素材保留不动；日后交换在线资源只改配置、不改代码

其余素材（开屏动图、音乐）需通过 `build.cjs` 收录进 `lib/client.js` 的 URL 清单：

```powershell
node build.cjs          # 完整构建：收录 assets/ 里全部素材（含第三方，仅供本地使用）
node build.cjs --clean  # 干净构建：只收录 build.include.txt 清单里的素材（用于提交仓库）
```

- **壁纸**：`assets/` 支持 `.jpg/.jpeg/.png/.webp`（静态）与 `.mp4`（动态）
- **默认壁纸**：`assets/` 里文件名含 `Default` 的图片会在首次安装（无保存记录）时作为初始壁纸；仓库默认随带 `Default_wallpaper.png`，替换后重新 `node build.cjs --clean` 即可
- **开屏动图**：`GIF/boot.json` 配置 `file` 指定启动页 gif（默认保留的 `4bfecb05<…>.gif`）、`durationMs` 指定自动淡出时长；改配置刷新即生效（运行时 fetch），无需重新 build
- **音乐**：`music/` 支持 `.mp3/.ogg/.m4a/.wav`，默认第一首为「使一颗心免于哀伤」；
  `music/figure/` 里第一张图片会作为内置歌曲默认封面；`build.music-exclude.txt` 里列出的
  文件名会在构建时被排除（可留待运行时「＋ 添加歌曲」导入）

> 💡 体积说明：素材**不内嵌**进 JS 包，由服务端 `/theme-mediascape-assets/` 静态路由按需
> 流式提供（`lib/client.js` 仅 90KB 左右，避免聚合 bundle 过大导致浏览器加载失败）。
> 建议素材控制合理体积（mp3 ≤128kbps、图片 ≤500KB、视频 ≤1080p），加快首屏加载。
>
> ⚠️ **提交仓库前记得跑 `node build.cjs --clean`**（生成只含官方素材的干净版），
> 避免把含第三方壁纸的完整版误提交。

---

## 🔧 技术实现

1. **客户端插件机制**：通过 `window.__ModuleLoader__.load()` 注册为 DSH 客户端模块，
   导出 cordis 插件 `{ isPlugin, inject: ["theme"], apply }`
2. **设计令牌覆盖**：`apply(ctx)` 中 `ctx.theme.register({ id, colorScheme, tokens })`
   向 ThemeRuntime 注册 `--dsw-*` 令牌并 `setTheme` 激活
3. **身份层**：注入 `<style>` 实现壁纸背景、粒子动画、开屏动画等；音频全部
   Web Audio 实时合成，无外部资源依赖
4. **壁纸/音乐渲染**：动态壁纸用 `<video muted loop autoplay>`、静态用 CSS 背景层、
   音乐用 `<audio>`；素材以 `/theme-mediascape-assets/` URL 形式外置（服务端半注册
   webServer 前缀路由按需流式提供，不内联 base64）

---

## 📦 版本记录

| 版本 | 说明 |
|---|---|
| 1.0.2 | 服务端模块拆分：`lib/index.js`（526 行）按职责拆为 6 模块（config 配置 / paths 路径 / labels 映射 / online 在线下载 / handlers 处理器 / index 入口），对外导出面与行为不变（等价比对逐字节一致）；labels 缓存状态收敛到所属模块（修复 ESM 跨模块赋值只读限制）；拆分回归验证脚本入库（`preview/tests/ms-split-behavior-check.mjs`、`ms-split-equivalence.mjs`）；浏览器端模板拆分：`lib/client.template.js`（2147 行）按职责拆为 `lib/parts/` 16 片段（build 按序拼接回单文件，产物与拆分前逐字节一致），切分工具 `scripts/split-template.py` 入库 |
| 1.0.1 | 全量审计优化：上传键改 SHA-1 内容寻址（40 位 hex，服务器权威去重，同内容仅更新文件名）；动态壁纸「播放完自动切换」（顺序 / 随机，类似音乐播放，静态图分钟兜底）；二级面板点外自动收起；音乐导入同步 hash 去重；在线资源下载（`lib/online-sources.json` 配置 hash 主键，后台静默下载到 `wallpapers/online/`，断点续传 .part + SHA-1 校验，本地/在线同列表共存）；开屏启动页改为 json 配置（`GIF/boot.json` 指定 gif 与时长，运行时 fetch 免 build）；表情包功能停用（代码保留为死代码）；预览启停脚本改为模板下发 |
| 1.0.0 | 改名迁移：仓库/包名 `dsh-theme-mediascape`（媒体景观主题），插件 ID `theme-mediascape`，全新 init 独立历史；壁纸服务器持久化（动态上限 + 原始文件名保留 + 上传超时/失败提示） |

## 📄 免责声明

本项目为粉丝同人作品，与米哈游、HoYoverse、DeepSeek 无任何关联，也未获得官方授权。
仅用于技术学习与个人使用。如侵权请联系我删除。
