/**
 * 构建脚本：拼接 lib/client-parts/ 片段回单文件 lib/client.js，注入少量构建期配置。
 *
 * 2026-09-21 目录结构改造：禁止所有资源 build——
 *   - 壁纸（图片/视频）：不内嵌，运行时 GET /theme-mediascape-assets/wallpaper/list 拉取
 *     （真实数据目录 wallpaper/：上传落盘 + 在线下载 online/ 子目录）
 *   - 音乐：不内嵌，运行时 GET /theme-mediascape-assets/music/list 拉取（真实数据目录 music/）
 *   - 开屏 GIF：仅注入 boot.json 配置的 file 文件名（运行时 fetch GIF/boot.json 同源配置）
 *   - 默认封面：不内嵌（运行时音乐列表带 cover 字段）
 *   - 上传 accept：仍注入 UPLOAD_ACCEPT（由服务端 config.js 派生，单一权威）
 * 资产本体不内联，由服务端（lib/index.js）经 /theme-mediascape-assets/<相对路径> 静态提供。
 * 用法：node build.cjs [--clean]
 * 幂等：用注释标记包裹数据段，重复运行会替换掉上一次注入的内容。
 */
// Node 侧构建脚本（非浏览器 client 半部），require 内建模块为正常用法
const fs = require("fs");
const path = require("path");

const root = __dirname;
// 浏览器端模板已按职责拆分为 lib/client-parts/ 下的片段（foundation 基础 / scenes 视觉 /
// sound 音频 / secrets 彩蛋 / toolbar 组件 + apply 入口），本脚本按固定顺序拼接回完整模板
// 再注入少量配置——顺序不变则产物与拆分前逐字节一致。
const partsDir = path.join(root, "lib", "client-parts");
const PART_ORDER = [
  // foundation：基础支撑（最先声明，被所有片段引用）
  "foundation/loader.js", "foundation/constants.js", "foundation/utils.js",
  "foundation/tokens.js", "foundation/theme.js", "foundation/assets.js",
  // scenes：视觉表现（身份 CSS / 开屏 / 壁纸 / 萤火）
  "scenes/identity.js", "scenes/boot.js", "scenes/wallpaper.js",
  "scenes/upload.js", "scenes/ambience.js",
  // sound：音频（打字音效 / 封面提取 / 播放器）
  "sound/typesound.js", "sound/music-extract.js", "sound/music-player.js",
  // secrets：彩蛋区（SAM 彩蛋；表情包已删除）
  "secrets/egg.js",
  // toolbar：组件（可拖动工具条）
  "toolbar/dock.js",
  // 入口
  "apply.js",
];
const clientPath = path.join(root, "lib", "client.js");
// 上传 accept 复用服务端 config.js（单一权威）：require(esm)（Node ≥22.12 支持）加载，
// 允许扩展名只改 lib/config.js 一处，客户端选择器与服务端校验自动同步。
const { UPLOAD_ACCEPT } = require(path.join(root, "lib", "config.js"));

// ── 1) 开屏动图配置（仅注入 boot.json 的 file 字段，资源本体仍由静态路由提供）──
// 优先读 GIF/boot.json 的 file 字段（显式配置启动页 gif，运行时 fetch 同源配置）；
// 无 boot.json / 字段非法 → 回退取目录第一个 .gif（历史行为）。
const gifDir = path.join(root, "GIF");
let gifs = [];
try { gifs = fs.readdirSync(gifDir).filter((f) => /\.gif$/i.test(f)); } catch { gifs = []; }
let bootGif = null;
try {
  const bootPath = path.join(gifDir, "boot.json");
  if (fs.existsSync(bootPath)) {
    const bootCfg = JSON.parse(fs.readFileSync(bootPath, "utf8"));
    if (typeof bootCfg.file === "string" && gifs.includes(bootCfg.file)) bootGif = bootCfg.file;
  }
} catch {}
if (!bootGif) bootGif = gifs[0] || null;
const gifUri = bootGif ? "/theme-mediascape-assets/GIF/" + encodeURIComponent(bootGif) : null;
console.log(`boot gif: ${bootGif ?? "(无，跳过开屏)"}`);

// ── 2) 注入 ──
let src = PART_ORDER.map((name) => fs.readFileSync(path.join(partsDir, name), "utf8")).join("");

// 壁纸/音乐/封面/表情包均不再内嵌（运行时 API 拉取）→ 清单占位符注入空数组
src = src.replace(
  /\/\*__BG_MANIFEST_START__\*\/[\s\S]*?\/\*__BG_MANIFEST_END__\*\//,
  `/*__BG_MANIFEST_START__*/[]/*__BG_MANIFEST_END__*/`
);
src = src.replace(
  /\/\*__GIF_START__\*\/[\s\S]*?\/\*__GIF_END__\*\//,
  `/*__GIF_START__*/${JSON.stringify(gifUri)}/*__GIF_END__*/`
);
src = src.replace(
  /\/\*__MUSIC_START__\*\/[\s\S]*?\/\*__MUSIC_END__\*\//,
  `/*__MUSIC_START__*/[]/*__MUSIC_END__*/`
);
src = src.replace(
  /\/\*__DEFAULT_COVER_START__\*\/[\s\S]*?\/\*__DEFAULT_COVER_END__\*\//,
  `/*__DEFAULT_COVER_START__*/null/*__DEFAULT_COVER_END__*/`
);
src = src.replace(
  /\/\*__UPLOAD_ACCEPT_START__\*\/[\s\S]*?\/\*__UPLOAD_ACCEPT_END__\*\//,
  `/*__UPLOAD_ACCEPT_START__*/${JSON.stringify(UPLOAD_ACCEPT)}/*__UPLOAD_ACCEPT_END__*/`
);
fs.writeFileSync(clientPath, src);
console.log(`OK: built lib/client.js = ${(src.length / 1048576).toFixed(1)} MB`);
