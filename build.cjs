/**
 * 构建脚本：把 assets/ 下所有壁纸（图片 + mp4 动态壁纸）与 GIF/ 下的开屏动图、
 * music/ 音乐、封面以「外置 URL 清单」注入 lib/client.js。
 * 资产本体不内联，由服务端半（lib/index.js）经 /theme-mediascape-assets/<相对路径>
 * 静态提供——避免 base64 内联把 client.js 撑到 82MB（导致 client-modules
 * 聚合 95MB、浏览器 Failed to load plugins）。
 * 用法：node build.cjs
 * 幂等：用注释标记包裹数据段，重复运行会替换掉上一次注入的内容。
 */
// Node 侧构建脚本（非浏览器 client 半部），require 内建模块为正常用法
const fs = require("fs");
const path = require("path");

const root = __dirname;
// 浏览器端模板已按职责拆分为 lib/client-parts/ 下的片段（foundation 基础 / scenes 视觉 /
// sound 音频 / secrets 彩蛋 / toolbar 组件 + apply 入口），本脚本按固定顺序拼接回完整模板
// 再注入素材清单——顺序不变则产物与拆分前逐字节一致。
const partsDir = path.join(root, "lib", "client-parts");
const PART_ORDER = [
  // foundation：基础支撑（最先声明，被所有片段引用）
  "foundation/loader.js", "foundation/constants.js", "foundation/utils.js",
  "foundation/tokens.js", "foundation/assets.js",
  // scenes：视觉表现（身份 CSS / 开屏 / 壁纸 / 萤火）
  "scenes/identity.js", "scenes/boot.js", "scenes/wallpaper.js",
  "scenes/upload.js", "scenes/ambience.js",
  // sound：音频（打字音效 / 封面提取 / 播放器）
  "sound/typesound.js", "sound/music-extract.js", "sound/music-player.js",
  // secrets：彩蛋区（表情包死代码 / SAM 彩蛋）
  "secrets/emotes.js", "secrets/egg.js",
  // toolbar：组件（可拖动工具条）
  "toolbar/dock.js",
  // 入口
  "apply.js",
];
const clientPath = path.join(root, "lib", "client.js");
const assetsDir = path.join(root, "assets");

/** 资产外置 URL（相对同源，经反代转发到 30801 webServer 的静态路由）。 */
function assetUrl(rel) {
  return "/theme-mediascape-assets/" + rel.split(path.sep).map((seg) => encodeURIComponent(seg)).join("/");
}
function sizeMb(file) {
  return (fs.statSync(file).size / 1048576).toFixed(1);
}
function mimeOf(ext) {
  switch (ext.toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".m4a": return "audio/mp4";
    case ".wav": return "audio/wav";
    default: return "application/octet-stream";
  }
}

// ── 0) 干净模式：--clean 时只打包 build.include.txt 里列出的壁纸 ──
const CLEAN = process.argv.includes("--clean");
let includeSet = null;
if (CLEAN) {
  const incPath = path.join(root, "build.include.txt");
  if (!fs.existsSync(incPath)) {
    console.error("ERROR: --clean 需要 build.include.txt 清单文件");
    process.exit(1);
  }
  includeSet = new Set(
    fs.readFileSync(incPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
  console.log(`clean mode: 仅打包 build.include.txt 里的 ${includeSet.size} 个壁纸`);
}

// ── 1) 壁纸清单：视频优先（默认第一个），其余按文件名排序 ──
const mediaExts = [".mp4", ".jpg", ".jpeg", ".png", ".webp"];
let files = fs.readdirSync(assetsDir).filter((f) => mediaExts.includes(path.extname(f).toLowerCase()));
if (CLEAN) {
  files = files.filter((f) => includeSet.has("assets/" + f));
}
const vids = files.filter((f) => /\.mp4$/i.test(f)).sort();
const imgs = files.filter((f) => !/\.mp4$/i.test(f)).sort();
const ordered = [...vids, ...imgs];
const manifest = ordered.map((f) => {
  const ext = path.extname(f);
  const mime = mimeOf(ext);
  return { id: f, kind: /\.mp4$/i.test(f) ? "video" : "image", mime, url: assetUrl(path.join("assets", f)), label: f };
});
console.log("wallpapers:");
manifest.forEach((m) => console.log(`  ${m.kind.padEnd(5)} ${m.label}  (file ${sizeMb(path.join(assetsDir, m.label))} MB → ${m.url})`));

// ── 2) 开屏动图 ──
// 优先读 GIF/boot.json 的 file 字段（显式配置启动页 gif，运行时 fetch 同源配置）；
// 无 boot.json / 字段非法 → 回退取目录第一个 .gif（历史行为）。
const gifDir = path.join(root, "GIF");
const gifs = fs.readdirSync(gifDir).filter((f) => /\.gif$/i.test(f));
let bootGif = null;
try {
  const bootPath = path.join(gifDir, "boot.json");
  if (fs.existsSync(bootPath)) {
    const bootCfg = JSON.parse(fs.readFileSync(bootPath, "utf8"));
    if (typeof bootCfg.file === "string" && gifs.includes(bootCfg.file)) bootGif = bootCfg.file;
  }
} catch {}
if (!bootGif) bootGif = gifs[0] || null;
if (!bootGif) {
  console.error("ERROR: no .gif found in GIF/ directory");
  process.exit(1);
}
const gifUri = assetUrl(path.join("GIF", bootGif));
console.log(`boot gif: ${bootGif}  (file ${sizeMb(path.join(gifDir, bootGif))} MB → ${gifUri})`);

// ── 3) 背景音乐清单：优先「使一颗心免于哀伤」，其余按文件名排序 ──
const musicDir = path.join(root, "music");
let musicFiles = [];
if (fs.existsSync(musicDir)) {
  musicFiles = fs.readdirSync(musicDir).filter((f) => /\.(mp3|ogg|m4a|wav)$/i.test(f));
}
musicFiles.sort((a, b) => a.localeCompare(b, "zh"));
const preferredIdx = musicFiles.findIndex((f) => f.includes("使一颗心免于哀伤"));
if (preferredIdx > 0) {
  const [p] = musicFiles.splice(preferredIdx, 1);
  musicFiles.unshift(p);
}
// 排除清单（build.music-exclude.txt，一行一个文件名）——用于「先不把新添加音乐整合进 client.js」，便于测试手动添加
const musicExcludePath = path.join(root, "build.music-exclude.txt");
if (fs.existsSync(musicExcludePath)) {
  const excludeSet = new Set(
    fs.readFileSync(musicExcludePath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
  const before = musicFiles.length;
  musicFiles = musicFiles.filter((f) => !excludeSet.has(f));
  if (musicFiles.length < before) console.log(`music: 按 build.music-exclude.txt 跳过 ${before - musicFiles.length} 首`);
}
const musicManifest = musicFiles.map((f) => {
  const ext = path.extname(f);
  return { id: f, mime: mimeOf(ext), url: assetUrl(path.join("music", f)), label: f.replace(/\.[^.]+$/, "") };
});
console.log("music:");
musicManifest.forEach((m) => console.log(`  ${m.label}  (file ${sizeMb(path.join(musicDir, m.id))} MB → ${m.url})`));

// ── 3.4) 内置歌曲默认封面：music/figure/ 下第一张图片（开箱即用的虚拟歌手「知更鸟」图）──
const figureDir = path.join(musicDir, "figure");
let defaultCoverUri = null;
if (fs.existsSync(figureDir)) {
  const figs = fs.readdirSync(figureDir).filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f)).sort();
  if (figs.length > 0) {
    const fc = figs[0];
    defaultCoverUri = assetUrl(path.join("music", "figure", fc));
    console.log(`default cover: ${fc}  (file ${sizeMb(path.join(figureDir, fc))} MB → ${defaultCoverUri})`);
  } else {
    console.log("default cover: music/figure/ 为空，回退 ♪ 占位");
  }
} else {
  console.log("default cover: 无 music/figure/，回退 ♪ 占位");
}

// ── 3.5) 表情包（已停用 2026-09-20：运行时不再注入/引用，代码保留为死代码；GIF/表情包/ 文件保留）──
// 若日后恢复：取消下方注释，并在 lib/client-parts/secrets/emotes.js 恢复 startEmotes() 调用与 EMOTES 依赖。
// const emoteDir = path.join(gifDir, "表情包");
// const emoteManifest = [];
// if (fs.existsSync(emoteDir)) {
//   emoteManifest.push(...fs.readdirSync(emoteDir).filter((f) => /\.gif$/i.test(f)).sort((a, b) => a.localeCompare(b, "zh")).map((f) => ({
//     id: f.replace(/\.[^.]+$/, ""),
//     mime: "image/gif",
//     url: assetUrl(path.join("GIF", "表情包", f)),
//     label: f.replace(/\.[^.]+$/, ""),
//   })));
// }
// console.log("emotes:");
// emoteManifest.forEach((e) => console.log(`  ${e.id}  (file ${sizeMb(path.join(emoteDir, e.label + ".gif"))} MB → ${e.url})`));

// ── 4) 注入 ──
let src = PART_ORDER.map((name) => fs.readFileSync(path.join(partsDir, name), "utf8")).join("");
const manifestJson = JSON.stringify(manifest);
src = src.replace(
  /\/\*__FIREFLY_BG_MANIFEST_START__\*\/[\s\S]*?\/\*__FIREFLY_BG_MANIFEST_END__\*\//,
  `/*__FIREFLY_BG_MANIFEST_START__*/${manifestJson}/*__FIREFLY_BG_MANIFEST_END__*/`
);
src = src.replace(
  /\/\*__FIREFLY_GIF_START__\*\/[\s\S]*?\/\*__FIREFLY_GIF_END__\*\//,
  `/*__FIREFLY_GIF_START__*/${JSON.stringify(gifUri)}/*__FIREFLY_GIF_END__*/`
);
if (musicManifest.length > 0) {
  src = src.replace(
    /\/\*__FIREFLY_MUSIC_START__\*\/[\s\S]*?\/\*__FIREFLY_MUSIC_END__\*\//,
    `/*__FIREFLY_MUSIC_START__*/${JSON.stringify(musicManifest)}/*__FIREFLY_MUSIC_END__*/`
  );
}
// 表情包注入段已停用（2026-09-20）：emoteManifest 不再收集，EMOTES 保持空数组死代码。
// if (emoteManifest.length > 0) {
//   src = src.replace(
//     /\/\*__FIREFLY_EMOTES_START__\*\/[\s\S]*?\/\*__FIREFLY_EMOTES_END__\*\//,
//     `/*__FIREFLY_EMOTES_START__*/${JSON.stringify(emoteManifest)}/*__FIREFLY_EMOTES_END__*/`
//   );
// }
src = src.replace(
  /\/\*__FIREFLY_DEFAULT_COVER_START__\*\/[\s\S]*?\/\*__FIREFLY_DEFAULT_COVER_END__\*\//,
  `/*__FIREFLY_DEFAULT_COVER_START__*/${JSON.stringify(defaultCoverUri)}/*__FIREFLY_DEFAULT_COVER_END__*/`
);
fs.writeFileSync(clientPath, src);
console.log(`OK: built lib/client.js = ${(src.length / 1048576).toFixed(1)} MB`);
