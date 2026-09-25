/**
 * 构建脚本：拼接 lib/client-parts/ 片段回单文件 lib/client.js，注入少量构建期配置。
 *
 * 2026-09-21 目录结构改造：禁止所有资源 build——
 *   - 壁纸（图片/视频）：不内嵌，运行时 GET /theme-mediascape-assets/wallpaper/list 拉取
 *     （真实数据目录 wallpaper/：上传落盘 + 在线下载 online/ 子目录）
 *   - 音乐：不内嵌，运行时 GET /theme-mediascape-assets/music/list 拉取（真实数据目录 music/）
 *   - 开屏 GIF：仅注入 boot.json 配置的 file 文件名（运行时 fetch boot/boot.json 同源配置）
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
// 开发工作台目录名（配色盘/预览页/自测脚本所在地，2026-09-22 由 preview/ 改名而来）。
// 目录若再改名只需改这一处——build 读 capsules/playback、跑自测脚本都经此常量定位。
const STUDIO_DIR = "theme-studio";
// 浏览器端模板已按职责拆分为 lib/client-parts/ 下的片段（foundation 基础 / scenes 视觉 /
// sound 音频 / toolbar 组件 + apply 入口），本脚本按固定顺序拼接回完整模板
// 再注入少量配置——顺序不变则产物与拆分前逐字节一致。
const partsDir = path.join(root, "lib", "client-parts");
const PART_ORDER = [
  // foundation：基础支撑（最先声明，被所有片段引用）
  // theme.js（壁纸自动配色）已废弃：不再构建（功能停用，源码保留备查）
  "foundation/loader.js", "foundation/constants.js", "foundation/utils.js",
  "foundation/tokens.js", "foundation/assets.js",
  // scenes：视觉表现（身份 CSS / 开屏 / 壁纸 / 萤火 / 字号）
  "scenes/identity.js", "scenes/boot.js", "scenes/wallpaper.js",
  "scenes/upload.js", "scenes/ambience.js", "scenes/font.js",
  // sound：音频（打字音效 / 封面提取 / 播放器）
  "sound/typesound.js", "sound/music-extract.js", "sound/music-player.js",
  // toolbar：组件（可拖动工具条）
  "toolbar/dock.js",
  // 入口
  "apply.js",
];
const clientPath = path.join(root, "lib", "client.js");
// 上传 accept 复用服务端 config.js（单一权威）：require(esm)（Node ≥22.12 支持）加载，
// 允许扩展名只改 lib/config.js 一处，客户端选择器与服务端校验自动同步。
const { UPLOAD_ACCEPT } = require(path.join(root, "lib", "config.js"));

// ── 1) 开屏素材注入（2026-09-22 设计变更：不再 build 注入预置首图）──
// 原机制：build 时读仓库根 boot/boot.json/files[0]（或 file）注入 GIF_DATA，立即插入阶段先显示这张预置图，
// 等运行时配置取回后再切换。2026-09-22 起去掉「初始加载先显示一张图」的预留黑框画面时间：
// 开屏内容完全按运行时 boot.json 的 file/files 决定（运行时 fetch，改配置刷新即生效，无需 build）。
// 故 GIF_DATA 恒为 null → 立即插入阶段浮层为纯色占位（去黑屏的意义保留：浮层结构立即出现），
// 配置取回后由 boot.js 按 boot.json 渲染媒体（现有「纯色占位 → 补建媒体元素」逻辑承接）。
const gifUri = null;
console.log("boot gif: (设计移除 build 注入，完全按运行时 boot.json 配置)");

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
// 胶囊配方注入（theme-studio/capsules.json，2026-09-21 外置）：
// 宿主元素胶囊/面板的 selector/背景源/透明度/圆角/padding/额外声明全部在 JSON 里，
// identity.js capsuleCSS() 渲染成 CSS；配色网站「宿主元素配色」区读写同一文件。
// 缺失/非法 → 注入空数组（胶囊规则不渲染，主题降级为无边饰，不崩溃）。
// ⚠️ 2026-09-22 专项诊断日志：胶囊曾「保存成功但 build 后消失」，加日志记录读取源/
//    成功失败/条数/键清单/注入后校验，丢失时可查 build-capsules.log 定位（*.log 不入库）。
// 2026-09-22 改：胶囊诊断日志统一走 lib/debug.js 的 writeLog（受 debug.json log 总开关控制，
// 关闭不落盘——与其余运行态日志同一开关，不再直写 build-capsules.log）。require(esm) Node ≥22.12 支持。
function capsulesLogLine(msg) {
  try {
    require(path.join(root, 'lib', 'debug.js')).writeLog('build-capsules.log', { event: 'build-capsules', msg });
  } catch { /* 日志写失败静默 */ }
}
let capsulesData = { rules: [] };
// ⚠️ 2026-09-23 胶囊配方运行态化（定稿：读写都走运行态，仓库只作回退可读、不写；无缓存副本）：
//   背景：capsules.json 曾被外部开发操作短暂移走（ENOENT）→ build 注入空数组 → 胶囊全消失。
//   现改为读取顺序（两级，无 .capsules-cache.json——运行态副本即持久缓存）：
//     ① 运行态 $DSH_HOME/theme-mediascape/capsules.json（配色盘保存的写入目标，稳定存在）
//     ② 回退仓库 theme-studio/capsules.json（运行态缺失/非法时读；读到正常则复制一份到运行态初始化）
//   两级都不可用 → 注入空数组 + 日志 ✗（需修复源文件）。
//   日志如实记录「读取来源 + 条数」（runtime=运行态 / repo=仓库回退）。
// ── 内置兜底胶囊配方（2026-09-23 加：胶囊配方提前固化进 build 兜底）──
// 运行态 + 仓库 capsules.json 都缺失/非法时使用，杜绝「注入空数组 → 胶囊全消失」。
// 内容与仓库主题胶囊同构（从 theme-studio/capsules.json 固化；后续胶囊配方调整时同步更新此处）。
const BUILTIN_CAPSULES = {
  "comment": "内置兜底胶囊配方（build.cjs 第三级源）——运行态与仓库 capsules.json 都不可用时使用，防止胶囊全消失。与仓库主题胶囊同构：key/selector/desc/bg/radius/padding。",
  "rules": [
    {
      "key": "markdown",
      "selector": "[class*='_markdown_']",
      "desc": "AI 回复正文容器（胶囊底，压包后稳定前缀 _markdown_*）",
      "bg": {
        "type": "layer",
        "alpha": 0.5,
        "value": "124, 120, 190"
      },
      "radius": "12px",
      "padding": "6px 12px",
      "extra": [],
      "extraRules": [],
      "enabled": true
    },
    {
      "key": "thinkBody",
      "selector": "[data-variant='think'] [class*='_thinkBody']",
      "desc": "思考展开正文（胶囊；锚点 data-variant=think 不随 hash 变；选择器必须写 [class*='_thinkBody'] 无尾下划线）",
      "bg": {
        "type": "layer",
        "alpha": 0.5
      },
      "radius": "12px",
      "padding": "6px 12px",
      "extra": [
        "margin-top: 6px !important"
      ],
      "extraRules": [],
      "enabled": true
    },
    {
      "key": "summary",
      "selector": "[class*='_summary']:not([class*='_summaryText']):not([class*='_summarySuffix']):not([class*='_summaryScrollRegion'])",
      "desc": "工具/思考/命令卡折叠摘要统一胶囊（hash_summary 家族；:not 排除子 span/计数/滚动区）",
      "bg": {
        "type": "layer",
        "alpha": 0.5
      },
      "radius": "12px",
      "padding": "6px 12px",
      "extra": [],
      "extraRules": [],
      "enabled": true
    },
    {
      "key": "todoPanel",
      "selector": "[data-testid='todo-panel']",
      "desc": "Todo 列表面板（紫底覆盖 --dsw-specific-tip 金色令牌）",
      "bg": {
        "type": "layer",
        "alpha": 0.6
      },
      "radius": "12px",
      "padding": null,
      "extra": [
        "border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.3) !important"
      ],
      "extraRules": [],
      "enabled": true
    },
    {
      "key": "queueDock",
      "selector": "[data-queue-dock] > div",
      "desc": "排队消息条（与 todo 同款紫底；上圆角+上边框）",
      "bg": {
        "type": "layer",
        "alpha": 0.6
      },
      "radius": "12px 12px 0 0",
      "padding": null,
      "extra": [
        "border-top: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.3) !important"
      ],
      "extraRules": [],
      "enabled": true
    },
    {
      "key": "status",
      "selector": "[role='status']",
      "desc": "「深度求索中…」状态提示（小胶囊：固定紫底 + 白描边 + 字号联动）",
      "bg": {
        "type": "layer",
        "value": "124, 120, 190",
        "alpha": 0.6
      },
      "radius": "999px",
      "padding": "4px 14px",
      "extra": [
        "display: inline-flex",
        "align-items: center",
        "gap: 6px",
        "font-size: var(--mediascape-dsh-font-size, 16px) !important",
        "line-height: var(--mediascape-dsh-font-line-status, 22px)",
        "font-weight: 600",
        "color: #F5F7FA !important",
        "-webkit-text-stroke: 1px rgba(255, 255, 255, 0.85)",
        "text-shadow: none !important"
      ],
      "extraRules": [
        {
          "selector": "[role='status'] [class*='_']",
          "desc": "状态胶囊内层文字继承描边（叠加在全局黑描边之上）",
          "declarations": [
            "text-shadow: inherit !important"
          ]
        }
      ],
      "enabled": true
    },
    {
      "key": "chatColumn",
      "selector": "[data-conversation-scroll] [class$='_column']",
      "desc": "聊天消息流主列容器（ui-chat ChatView column：居中限宽 flex 列，含全部消息）——整列胶囊面板：半透明主题底 + 圆角 + 内边距。锚点 data-conversation-scroll（全局属性不随 hash 变）+ 子元素类名尾缀 _column（hash 前缀变也不影响）",
      "bg": {
        "type": "layer",
        "alpha": 0.32
      },
      "radius": "16px",
      "padding": "10px 14px",
      "extra": [],
      "extraRules": [],
      "enabled": true
    },
    {
      "key": "flowItem",
      "selector": "[data-conversation-scroll] [class$='_flowItem']",
      "desc": "聊天消息座容器（ChatNodeSeat flowItem：column 内每个用户/AI/工具/思考卡的外层座）——消息座级胶囊：整条消息一块半透明底+圆角。锚点 data-conversation-scroll + 类名尾缀 _flowItem（hash 前缀变不影响）",
      "bg": {
        "type": "layer",
        "alpha": 0.28
      },
      "radius": "12px",
      "padding": "8px 12px",
      "extra": [],
      "extraRules": [],
      "enabled": true,
      "parent": "chatColumn"
    },
    {
      "key": "older",
      "selector": "[data-conversation-scroll] [class$='_older'] button",
      "desc": "「加载更早消息」按钮行（ChatView older：column 顶部、hasMore 时显示）——小胶囊：半透明底+圆角+内边距",
      "bg": {
        "type": "layer",
        "alpha": 0.3
      },
      "radius": "14px",
      "padding": "4px 12px",
      "extra": [
        "display: inline-flex",
        "align-items: center"
      ],
      "extraRules": [],
      "enabled": true,
      "parent": "chatColumn"
    },
    {
      "key": "guide",
      "selector": "[data-sidebar-right-guide]",
      "desc": "右侧边栏「指南」页容器（ui-sidebar-right GuideBody guide：居中列、罗盘图+胶囊条目列表）——整面板胶囊：半透明主题底+圆角+内边距。锚点 data-sidebar-right-guide（全局属性不随 hash 变）",
      "bg": {
        "type": "layer",
        "alpha": 0.5
      },
      "radius": "16px",
      "padding": "18px 20px",
      "extra": [],
      "extraRules": [],
      "enabled": true,
      "parent": "tabStrip"
    },
    {
      "key": "guideEntry",
      "selector": "[data-sidebar-right-guide] [class$='_entry']",
      "desc": "指南胶囊条目（GuideBody entry：自带 380px pill 底+圆角24px，此处主题胶囊统一覆盖其底色）——子级胶囊：主题紫底+圆角+内边距。父级 guide",
      "bg": {
        "type": "layer",
        "alpha": 0.28
      },
      "radius": "24px",
      "padding": "14px 20px",
      "extra": [
        "border: 0.5px solid rgba(var(--mediascape-dsh-theme-border), 0.35) !important"
      ],
      "extraRules": [],
      "enabled": true,
      "parent": "guide"
    },
    {
      "key": "tabStrip",
      "selector": "[class*='_tabStrip_']",
      "desc": "浮动面板标签条（ui-dockkit dockkit.module.css .tabStrip：38px 横条、含标签 chips——guide 指南页所在浮动面板的头部，位于 guide 上方）。稳定锚点：编译类 _tabStrip_<hash>_<序号>（Vite 新格式：下划线+类名+下划线+模块hash），匹配类名前缀 _tabStrip_ 不受 hash 影响。仅加底+圆角（padding 保留宿主原值，避免移动 chips 布局）。层级：tabStrip（面板标签条）→ guide（指南页容器）→ guideEntry（指南条目）",
      "bg": {
        "type": "layer",
        "alpha": 0.6
      },
      "radius": "10px",
      "padding": null,
      "extra": [],
      "extraRules": [],
      "enabled": true
    }
  ]
};

const RUNTIME_CAPSULES = (() => {
  // 与 lib/paths.js runtimeCapsulesPath() 同语义：$DSH_HOME/theme-mediascape/capsules.json
  const dshHome = process.env.DSH_HOME || (require('os').homedir ? require('os').homedir() : '');
  return path.join(dshHome, 'theme-mediascape', 'capsules.json');
})();
{
  const repoPath = path.join(root, STUDIO_DIR, "capsules.json");
  let source = 'repo', loadErr = null;
  const readRules = (p) => {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return parsed && Array.isArray(parsed.rules) && parsed.rules.length > 0 ? parsed : null;
  };
  // ① 运行态优先
  try {
    if (fs.existsSync(RUNTIME_CAPSULES)) {
      const rt = readRules(RUNTIME_CAPSULES);
      if (rt) { capsulesData = rt; source = 'runtime'; }
      else { source = 'repo'; loadErr = '运行态 capsules.json 为空/非法'; capsulesLogLine(`⚠️ ${loadErr} → 回退仓库`); }
    } else {
      source = 'repo'; loadErr = '运行态 capsules.json 不存在';
    }
  } catch (e) {
    source = 'repo'; loadErr = '运行态读取失败: ' + e.message;
    capsulesLogLine(`⚠️ ${loadErr} → 回退仓库`);
  }
  // ② 仓库回退（读仓库；读到正常则复制一份到运行态初始化）
  if (source === 'repo') {
    try {
      const repo = readRules(repoPath);
      if (repo) {
        capsulesData = repo;
        capsulesLogLine(`OK 仓库回退读取 → ${capsulesData.rules.length} 条 (keys: ${capsulesData.rules.map(r => r.key).join(',')})${loadErr ? ' | 原因: ' + loadErr : ''}`);
        // 复制仓库副本到运行态（初始化/修复运行态缺失）
        try {
          fs.mkdirSync(path.dirname(RUNTIME_CAPSULES), { recursive: true });
          const tmpPath = RUNTIME_CAPSULES + '.tmp';
          fs.writeFileSync(tmpPath, JSON.stringify(repo, null, 2) + '\n', 'utf8');
          fs.renameSync(tmpPath, RUNTIME_CAPSULES);
          capsulesLogLine(`已从仓库复制运行态初始化: ${RUNTIME_CAPSULES}`);
        } catch (e) { capsulesLogLine(`⚠️ 复制运行态失败（不影响本次注入）: ${e.message}`); }
      } else {
        capsulesData = BUILTIN_CAPSULES; source = 'builtin';
        capsulesLogLine(`✗ 仓库 capsules.json 为空/非法（运行态+仓库都不可用）→ 用内置兜底配方 ${capsulesData.rules.length} 条`);
      }
    } catch (e) {
      capsulesData = BUILTIN_CAPSULES; source = 'builtin';
      capsulesLogLine(`✗ 仓库读取失败: ${e.message} → 用内置兜底配方 ${capsulesData.rules.length} 条`);
    }
  } else if (source === 'runtime') {
    capsulesLogLine(`OK 运行态读取 → ${capsulesData.rules.length} 条 (keys: ${capsulesData.rules.map(r => r.key).join(',')})`);
  } else if (source === 'builtin') {
    capsulesLogLine(`OK 内置兜底读取 → ${capsulesData.rules.length} 条 (keys: ${capsulesData.rules.map(r => r.key).join(',')})`);
  }
}
src = src.replace(
  /\/\*__CAPSULES_START__\*\/[\s\S]*?\/\*__CAPSULES_END__\*\//,
  `/*__CAPSULES_START__*/${JSON.stringify(capsulesData.rules)}/*__CAPSULES_END__*/`
);
// 2026-09-22 胶囊 layer 型背景「构建期展开字面 rgb」（息屏恢复防丢，方案 1）：
// identity.js capsuleCSS() 的 layer 分支用 CAPSULE_BG_LAYER_RGB 直接拼 rgba(字面, α)，
// 不再引用运行期 CSS 变量 --mediascape-dsh-theme-bg-layer（渲染层重建时变量未就绪 → 声明 invalid → 胶囊透明消失）。
// 值源：theme-studio/json/theme-colors.json 的 bgLayer.hex → rgb 字符串（与身份层 --mediascape-dsh-theme-bg-layer 同源，
// start-preview.mjs 第 100 行生成同一值）；json 缺失/非法 → 回退当前身份层默认 "54, 42, 86"（不崩溃）。
let capsuleBgLayerRgb = "54, 42, 86";
try {
  const colorsPath = path.join(root, STUDIO_DIR, "json", "theme-colors.json");
  const colorsJson = JSON.parse(fs.readFileSync(colorsPath, "utf8"));
  const hex = (colorsJson.bgLayer && colorsJson.bgLayer.hex) || "";
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (match) {
    const hexVal = parseInt(match[1], 16);
    capsuleBgLayerRgb = `${(hexVal >> 16) & 255}, ${(hexVal >> 8) & 255}, ${hexVal & 255}`;
  }
} catch (e) {
  console.warn(`[build] theme-colors.json bgLayer 读取失败，胶囊 bg 回退默认 rgb: ${e.message}`);
}
src = src.replace(
  /\/\*__CAPSULE_BG_LAYER_START__\*\/[\s\S]*?\/\*__CAPSULE_BG_LAYER_END__\*\//,
  `/*__CAPSULE_BG_LAYER_START__*/${JSON.stringify(capsuleBgLayerRgb)}/*__CAPSULE_BG_LAYER_END__*/`
);
capsulesLogLine(`bgLayer 字面 rgb: ${capsuleBgLayerRgb}（来源 theme-colors.json bgLayer.hex）`);

// ── 2026-09-2x 自动注册元素注入（theme-studio/json/theme-register.json）──
// 配色盘「新增元素」API（POST /api/theme-register-element）写入；zone=color 规则注入 identity.js，
// registerColorCSS() 渲染底色应用（默认色 rgba 构建期内嵌，apply 后 --dsw-specific-* 变量覆盖）。
// 缺失/非法 → 注入空数组（无注册元素应用，不崩溃）。
let registerData = { rules: [] };
try {
  const registerPath = path.join(root, STUDIO_DIR, "json", "theme-register.json");
  const parsed = JSON.parse(fs.readFileSync(registerPath, "utf8"));
  registerData = { rules: Array.isArray(parsed && parsed.rules) ? parsed.rules : [] };
  // 每条 color 规则预计算默认 rgba（hex+alpha → "rgba(r,g,b,a)"；hex 缺失/非法 → 不设，identity 回退 transparent）
  for (const r of registerData.rules) {
    if (r.zone !== 'color') continue;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(r.hex || ''));
    if (m) {
      const n = parseInt(m[1], 16);
      const a = typeof r.alpha === 'number' && r.alpha >= 0 && r.alpha <= 1 ? r.alpha : 1;
      r.rgba = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
  }
} catch (e) {
  registerData = { rules: [] };
  console.warn(`[build] theme-register.json 读取失败，注册元素注入空数组: ${e.message}`);
}
src = src.replace(
  /\/\*__REGISTER_START__\*\/[\s\S]*?\/\*__REGISTER_END__\*\//,
  `/*__REGISTER_START__*/${JSON.stringify(registerData.rules)}/*__REGISTER_END__*/`
);
{
  const colorRules = registerData.rules.filter((r) => r.zone === 'color');
  if (colorRules.length) {
    const keys = colorRules.map((r) => r.key).join(',');
    const ok = src.includes('"key":"' + colorRules[0].key + '"');
    capsulesLogLine(`注册元素(color ${colorRules.length} 条): ${keys} 注入${ok ? 'OK' : '✗ 未找到'}`);
  }
}

// 注入后校验：产物里应能找到注入的胶囊键（定位「写盘成功但产物空」类问题）
{
  const injectedCount = (src.match(/__CAPSULES_START__\/\*/) ? 1 : 0) + (src.match(new RegExp('"key":"' + (capsulesData.rules[0] ? capsulesData.rules[0].key : '___none___') + '"')) ? 1 : 0);
  capsulesLogLine(`校验: 产物含注入块=${src.includes('__CAPSULES_START__')}, 含首键=${capsulesData.rules.length ? src.includes('"key":"' + capsulesData.rules[0].key + '"') : 'N/A(空)'}`);
}
// 启动播放策略注入（theme-studio/playback.json，2026-09-21 阶段3）：
// { videoAutoPlay, musicAutoPlay } 控制视频壁纸/背景音乐启动时是否自动播放。
// 缺失/非法 → 默认 { videoAutoPlay: true, musicAutoPlay: false }（定稿默认，不崩溃）。
let playback = { videoAutoPlay: true, musicAutoPlay: false };
try {
  const playbackPath = path.join(root, STUDIO_DIR, "playback.json");
  const pb = JSON.parse(fs.readFileSync(playbackPath, "utf8")) || {};
  if (typeof pb.videoAutoPlay === "boolean") playback.videoAutoPlay = pb.videoAutoPlay;
  if (typeof pb.musicAutoPlay === "boolean") playback.musicAutoPlay = pb.musicAutoPlay;
} catch (e) {
  console.warn(`[build] playback.json 读取失败，使用默认启动播放策略: ${e.message}`);
}
src = src.replace(
  /\/\*__PLAYBACK_START__\*\/[\s\S]*?\/\*__PLAYBACK_END__\*\//,
  `/*__PLAYBACK_START__*/${JSON.stringify(playback)}/*__PLAYBACK_END__*/`
);
// 2026-09-23 产物生成头：标明自动生成、勿手改（手改会被下次 build 覆盖），来源=lib/client-parts/
src = '// ⚠️ 本文件由 build.cjs 自动生成（拼接 lib/client-parts/ 片段 + 注入构建期配置），请勿手改——\n' +
      '// 手改会在下次 node build.cjs 时被覆盖。改代码请改 lib/client-parts/ 下源文件后重新 build。\n' +
      '// 生成时间: ' + new Date().toISOString() + '\n' + src;
fs.writeFileSync(clientPath, src);
console.log(`OK: built lib/client.js = ${(src.length / 1048576).toFixed(1)} MB`);

// ── 3) debug 模式（手动开启，不入库、不随插件下发）──
// 配置文件：$DSH_HOME/theme-mediascape/debug.json（数据目录，运行时存在；仓库/插件包不含此文件）
//   开启方式（用户或 AI 手动创建，二选一）：
//     echo '{"log": true, "theme-swatch": true, "preview": true}' > "$DSH_HOME/theme-mediascape/debug.json"
//     python3 -c "import json,os;d=os.path.join(os.environ.get('DSH_HOME',os.path.expanduser('~/.dsh')),'theme-mediascape');os.makedirs(d,exist_ok=True);json.dump({'log':True,'theme-swatch':True,'preview':True},open(os.path.join(d,'debug.json'),'w'))"
//   结构（2026-09-22 升级：单一 enabled → 三独立开关，只认新键，旧 enabled 废弃）：
//     log          = 总日志开关：开启时壁纸切换 / 配色操作 / 预览服务都写运行态 logs/
//     theme-swatch = 配色服务开关：主题 apply 时自动拉起配色服务（theme-swatch.html + 配色 API）
//     preview      = 预览页服务开关：主题 apply 时自动拉起预览页（preview.html）
//   关闭：删除该文件，或把对应键置 false。
// 作用：①任一开关开启 → build 完成自动执行健壮性自测（theme-studio/tests/*.mjs 全量）；
//      ②配色/预览网页服务由主题 apply 启动（lib/index.js ensureDebugServer：重启 DSH 时
//        自动拉起 theme-studio/start.sh start，幂等已在运行跳过）——不再由 build restart。
const { spawnSync } = require("child_process");
const os = require("os");
const debugCfgPath = path.join(
  process.env.DSH_HOME || path.join(os.homedir(), ".dsh"),
  "theme-mediascape", "debug.json"
);
function readBool(obj, key) { return !!(obj && typeof obj === "object" && obj[key] === true); }
let debugSwitches = { log: false, themeSwatch: false, preview: false };
try {
  const dbg = JSON.parse(fs.readFileSync(debugCfgPath, "utf8"));
  debugSwitches = { log: readBool(dbg, "log"), themeSwatch: readBool(dbg, "theme-swatch"), preview: readBool(dbg, "preview") };
} catch { /* 文件不存在/非法 = 未开启（默认关） */ }
const debugEnabled = debugSwitches.log || debugSwitches.themeSwatch || debugSwitches.preview; // 任一开 → 跑自测
if (debugEnabled) {
  // 2026-09-21 改：配色网页服务启动已移交主题 apply（lib/index.js ensureDebugServer）——
  // 重启 DSH 时自动拉起，不再由 build 负责 restart。build 只跑健壮性自测。
  // （此前 DSH_THEME_NO_RESTART=1 防「配色应用为正式基底时 build 重启杀掉服务自身」的
  //   场景已随 restart 移除而消失：build 不再碰服务进程，该分支删除。）
  console.log(`[debug] debug.json 开关 → log=${debugSwitches.log ? '开' : '关'} theme-swatch=${debugSwitches.themeSwatch ? '开' : '关'} preview=${debugSwitches.preview ? '开' : '关'}（任一开 → 运行健壮性自测；配色服务由主题 apply 自动启动）`);
  const tests = [
    path.join(STUDIO_DIR, "tests", "ms-split-behavior-check.mjs"),
    path.join(STUDIO_DIR, "tests", "ms-file-move-robustness.mjs"),
    path.join(STUDIO_DIR, "tests", "ms-online-download-check.mjs"),
  ];
  let allPass = true;
  for (const t of tests) {
    // 2026-09-22：theme-studio/ 目录 git 忽略后 clone 仓库可能没有自测脚本 → 存在才跑（缺失跳过并提示），
    // 保证「无 preview 目录」时 build 仍 10 PASS（健壮性自测是开发资产，不是构建必需）。
    if (!fs.existsSync(path.join(root, t))) {
      console.log(`[debug] ⏭ ${t} 不存在（theme-studio/ 未检出），跳过自测`);
      continue;
    }
    console.log(`\n[debug] 运行自测: ${t}`);
    const r = spawnSync(process.execPath, [t], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) { allPass = false; console.log(`[debug] ❌ ${t} 失败 (exit=${r.status})`); }
  }
  if (allPass) console.log(`[debug] ✅ 全部自测通过`);
} else {
  console.log(`[debug] 未开启（无 ${debugCfgPath} 或全键非 true）。开启方法见 build.cjs 头部注释。`);
}

// 2026-09-23 加：debug.json `preview` 开关 → 每次 build 完成自动重启预览服务
// （theme-studio/start.sh restart：新产物立即可在预览页 30999 生效，无需手动重启）。
// ⚠️ 2026-09-25 修：restart 段必须尊重 DSH_THEME_NO_RESTART=1——配色应用/元素注册 API 是在预览
// 服务进程内调 build（execSync），若这里无条件 restart 会杀掉服务自身（「应用后网页崩/服务死」）。
if (debugSwitches.preview && process.env.DSH_THEME_NO_RESTART !== '1') {
  try {
    const startScript = path.join(root, "theme-studio", "start.sh");
    if (fs.existsSync(startScript)) {
      console.log(`[preview] debug.json preview=开 → 重启预览服务`);
      const r = spawnSync("bash", [startScript, "restart"], { cwd: root, stdio: "inherit" });
      console.log(r.status === 0 ? `[preview] ✅ 预览服务已重启` : `[preview] ❌ 重启失败 exit=${r.status}`);
    } else {
      console.log(`[preview] start.sh 不存在（theme-studio/ 未检出），跳过预览重启`);
    }
  } catch (e) {
    console.warn(`[preview] 预览重启异常: ${e?.message ?? e}`);
  }
}
