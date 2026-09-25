/**
 * dsh-theme-mediascape 悬浮框独立预览启动器（不走 DSH 主流程，但接真实后端）.
 *
 * 用法：
 *   node start-preview.mjs            # 起本地静态服务器 + 打开浏览器
 *   node start-preview.mjs --no-open  # 只起服务器，不自动打开浏览器
 *   node start-preview.mjs --port 30999
 *   node start-preview.mjs --shot preview.png  # 用 playwright 截图自检（需 pwviewer）
 *   node start-preview.mjs --dsh http://127.0.0.1:30800 --token <launch-token>
 *
 * 原理：
 *   theme-studio/preview.html 用垫片（__ModuleLoader__ + ctx.theme）直接执行真实
 *   lib/client.js，把主题悬浮框独立渲染出来——不依赖 DSH 主 GUI。
 *   本脚本起一个本地 HTTP 服务，充当「反向代理」：
 *     - preview.html / lib/client.js 走本地（主题根目录）
 *     - /theme-mediascape-assets/* 全部转发到 DSH 真实后端（默认 http://127.0.0.1:30800）
 *       并自动完成 token 认证（GET /?token= → 拿 dsh-auth cookie → 后续请求带 cookie）。
 *   因此预览里的壁纸列表 / 上传 / 删除 / 素材加载，全部是真后端数据：
 *   上传的视频真实写入 DSH 的 $DSH_HOME/theme-mediascape/wallpapers/，刷新/重启都在。
 *
 * token 获取优先级：--token 参数 > 环境变量 DSH_PREVIEW_TOKEN > 自动读 dsh-proxy.log（
 * 解析最近一次 ?token= 值，非侵入只读）。
 */
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, appendFileSync, chmodSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { readDebugConfig, logEnabled } from '../lib/debug.js';
import { writeLog } from '../lib/log.js';
// 2026-09-23 加：upload/DELETE 本地处理（不依赖主实例 30800 插件——30800 禁用时预览页仍可上传/删除）。
// handleUpload/handleDelete 用真实 $DSH_HOME 数据目录，与素材/列表同源。
import { handleUpload, handleDelete, handleMusicUpload, handleCoverUpload, handleMusicDelete } from '../lib/handlers.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));       // theme-studio/
const THEME_ROOT = normalize(join(SCRIPT_DIR, '..'));             // 插件根

// ── 配色对照页组件模拟配置（comps.json，实例数据全外置；缺失/解析失败 → 空列表不崩）──
let COMPS_CFG = [];
try {
  const compsPath = join(SCRIPT_DIR, 'comps.json');
  if (existsSync(compsPath)) {
    const parsed = JSON.parse(readFileSync(compsPath, 'utf8'));
    COMPS_CFG = Array.isArray(parsed && parsed.comps) ? parsed.comps : [];
  }
} catch (e) { /* comps 配置缺失：对照页无组件模拟区 */ }

// ── 通用渲染模板（kind → css 生成函数）──
// 只依赖传入色 hex 与基底元数据（bg/bgLayer/border/skin），不绑定任何角色名——
// comps.json 里选 kind + color 即可，新增角色/颜色都不用改这里。
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const KIND_TEMPLATES = {
  // 强调实底（主按钮）：实色底 + 深字 + 金边
  solid: (h, ctx) => `background:${h};color:#101410;border:1px solid rgba(212,175,55,.45)`,
  // 半透明底（次按钮）：同色文字
  soft: (h, ctx) => `background:${hexToRgba(h, 0.2)};color:${h};border:1px solid rgba(212,175,55,.42)`,
  // 淡底徽章（激活态）
  chip: (h, ctx) => `background:${hexToRgba(h, 0.14)};color:${h}`,
  // 纯文字
  text: (h, ctx) => `color:${h}`,
  // 金色光晕文字
  glow: (h, ctx) => `color:${h};text-shadow:0 0 14px ${hexToRgba(h, 0.55)}`,
  // 主题面板（待办）：bgLayer 基底紫底 + 金边（主色仅占位，跟随基底）
  panel: (h, ctx) => `display:block;padding:10px 12px;border-radius:12px;background:${hexToRgba(ctx.bgLayer, 0.6)};color:${hexToRgba(ctx.skin, 1)};border:1px solid ${hexToRgba(ctx.border, 0.3)};font-size:12px;line-height:1.8`,
  // 主题上面板（排队条）：上圆角 + 上边框
  'panel-top': (h, ctx) => `display:block;padding:8px 12px;border-radius:12px 12px 0 0;background:${hexToRgba(ctx.bgLayer, 0.6)};color:${hexToRgba(ctx.skin, 1)};border-top:1px solid ${hexToRgba(ctx.border, 0.3)};font-size:12px`,
  // dock 悬浮条：bg 实底 + 金边 + 浮起阴影
  dock: (h, ctx) => `display:inline-flex;gap:8px;padding:8px 12px;border-radius:14px;background:${ctx.bg};border:1px solid ${hexToRgba(ctx.border, 0.28)};font-size:12px;color:${hexToRgba(ctx.skin, 0.9)};box-shadow:0 6px 24px rgba(0,0,0,.35)`,
  // 侧边栏填充：bg 半透明 + 金边
  sidebar: (h, ctx) => `display:block;width:100%;padding:10px 12px;border-radius:8px;background:${hexToRgba(ctx.bg, 0.78)};color:${hexToRgba(ctx.skin, 1)};border:1px solid ${hexToRgba(ctx.border, 0.2)};font-size:12px`,
  // AI 回复胶囊：bgLayer 半透明 + 圆角
  capsule: (h, ctx) => `display:block;padding:6px 12px;border-radius:12px;background:${hexToRgba(ctx.bgLayer, 0.5)};color:${hexToRgba(ctx.skin, 1)};font-size:12px;line-height:1.8;width:100%`,
  // 状态胶囊：主色半透明底 + 白字白描边
  status: (h, ctx) => `display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:${hexToRgba(h, 0.6)};color:#F5F7FA;font-size:12px;font-weight:600;-webkit-text-stroke:1px rgba(255,255,255,.85)`,
};

// ── 一键应用配色：从 6 色直接写盘 identity.js 基底段 + tokens.js 完整令牌（无备份，git 兜底）──
// 调用方：对照页「应用为正式基底」→ POST /api/theme-apply { name, colors }
// colors: { skin, hair, eye, white, purple, gold }（hex，#RRGGBB）
function hexToRgbStr(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '0, 0, 0';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
// 生成 identity.js 的 --mediascape-dsh-theme-* 段（返回替换用字符串：从 html{ 到 }）
// V2 零映射（2026-09-22）：无 6 语义键，直接按元素 class 键名取值——text←text-primary、
// accent←btn-primary、accent-soft←btn-secondary、text-dim←text-dim、border←gold-glow、invert←status-capsule。
function buildIdentityBlock(colors, vars) {
  const pick = (k, d) => (/^#?[0-9a-f]{6}$/i.test(String(vars[k] || '')) ? vars[k] : d);
  return [
    '"html { color-scheme: dark !important; background: #0a0c12 !important;",',
    '"  /* ── 基底主题变量（壁纸联动皮肤命名空间 --mediascape-dsh-theme-*；值=一键应用配色，动态取色覆盖）── */",',
    `"  /* 一键应用 ${colors._name || ''}：主文字 ${pick('text-primary', '#E8F4FA')} / 次文字 ${pick('text-dim', '#F2A7B8')} / 主按钮 ${pick('btn-primary', '#7CC8E8')} / 次按钮 ${pick('btn-secondary', '#3B89C4')} / 金色高亮 ${pick('gold-glow', '#E2C05A')} / 状态胶囊 ${pick('status-capsule', '#F5F7FA')} */",`,
    `"  --mediascape-dsh-theme-bg: ${hexToRgbStr(colors.bg || '#0a0c16')};",`,
    `"  --mediascape-dsh-theme-bg-soft: ${hexToRgbStr(colors.bgSoft || '#101020')};",`,
    `"  --mediascape-dsh-theme-bg-layer: ${hexToRgbStr(colors.bgLayer || '#161222')};",`,
    `"  --mediascape-dsh-theme-accent: ${hexToRgbStr(pick('btn-primary', '#7CC8E8'))};",`,
    `"  --mediascape-dsh-theme-accent-soft: ${hexToRgbStr(pick('btn-secondary', '#3B89C4'))};",`,
    `"  --mediascape-dsh-theme-text: ${hexToRgbStr(pick('text-primary', '#E8F4FA'))};",`,
    `"  --mediascape-dsh-theme-text-dim: ${hexToRgbStr(pick('text-dim', '#F2A7B8'))};",`,
    `"  --mediascape-dsh-theme-border: ${hexToRgbStr(pick('gold-glow', '#E2C05A'))};",`,
    '"}",',
  ].join('\n');
}
// 生成 tokens.js 完整内容（TOKENS 由元素 class 键直接推导——零映射，无 6 语义键）
function buildTokensContent(colors, vars, theme) {
  // theme（完整配色真源 json，含每色 alpha）可选：有则用其 alpha 参与 rgba 生成（2026-09-22 json 化）
  const alphaOf = (k, d) => {
    const c = theme && theme.colors && theme.colors[k];
    return (c && typeof c.alpha === 'number' && c.alpha >= 0 && c.alpha <= 1) ? c.alpha : d;
  };
  const pick = (k, d) => (/^#?[0-9a-f]{6}$/i.test(String(vars[k] || '')) ? vars[k] : d);
  const E = pick('btn-primary', '#7CC8E8'), P = pick('btn-secondary', '#3B89C4'), G = pick('gold-glow', '#E2C05A');
  const S = pick('text-primary', '#E8F4FA'), H = pick('text-dim', '#F2A7B8'), W = pick('status-capsule', '#F5F7FA');
  // 2026-09-22 未消费键补映射（值=json 现状色，视觉不变；以后改键才影响宿主）：
  // text-tertiary→三级文字 / chip-active→交互激活 / markdown-capsule→markdown 内联代码
  const T3 = pick('text-tertiary', H), CH = pick('chip-active', E), MK = pick('markdown-capsule', G);
  const rgba = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const lines = [
    '// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════',
    `// ${colors._name || '自定义'}：主文字 ${S} / 次文字 ${H} / 主按钮 ${E} / 次按钮 ${P} / 金色高亮 ${G} / 状态胶囊 ${W}`,
    '// ⚠️ 本文件由「配色网站 → 应用」自动生成，手动修改会被覆盖；配色真源见 theme-studio/json/theme-colors.json',
    'const TOKENS = {',
    '  // 背景：中间画面全透明（壁纸区域直接透出，不再铺任何底色）；侧边栏/对话框/按钮等组件仍用主题色',
    '  "--dsw-alias-bg-base": "transparent",',
    '  "--dsw-alias-bg-layer-1": ' + JSON.stringify(rgba(colors.bgSoft || '#101020', 0.52)) + ',',
    '  "--dsw-alias-bg-layer-2": ' + JSON.stringify(rgba(colors.bgLayer || '#161222', 0.72)) + ',',
    '  "--dsw-alias-bg-layer-3": ' + JSON.stringify(rgba(colors.bgLayer || '#161222', 0.80)) + ',',
    '  "--dsw-alias-bg-overlay": ' + JSON.stringify(rgba(colors.bgLayer || '#161222', 0.92)) + ',',
    '  "--dsw-alias-bg-module-platform": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.84)) + ',',
    '  "--dsw-alias-bg-multi-select": ' + JSON.stringify(rgba(colors.bgLayer || '#161222', 0.90)) + ',',
    '  "--dsw-alias-bg-skeleton": ' + JSON.stringify(rgba(E, 0.12)) + ',',
    '  // 模态遮罩透明化：打开设置/弹层时壁纸仍透出，仅保留轻微变暗保证前景可读（深色 0.25）',
    '  "--dsw-alias-bg-mask-1": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.25)) + ',',
    '  "--dsw-alias-bg-mask-2": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.14)) + ',',
    '  "--dsw-alias-bg-mask-drop": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.25)) + ',',
    '',
    '  // 文字：主文字（text-primary）/ 金高亮（gold-glow）/ 次文字（text-dim）',
    '  "--dsw-alias-label-primary": ' + JSON.stringify(S) + ',',
    '  "--dsw-alias-label-secondary": ' + JSON.stringify(G) + ',',
    '  "--dsw-alias-label-tertiary": ' + JSON.stringify(T3) + ',',
    '  "--dsw-alias-label-caption": ' + JSON.stringify(T3) + ',',
    '  "--dsw-alias-label-dimmed": ' + JSON.stringify(rgba(H, 0.55)) + ',',
    '  "--dsw-alias-label-primary-foreground": ' + JSON.stringify(W) + ',',
    '  "--dsw-alias-label-primary-inverted": ' + JSON.stringify(W) + ',',
    '',
    '  // 品牌：主按钮（btn-primary 主强调）',
    '  "--dsw-alias-brand-primary": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-brand-text": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-brand-primary-invert": ' + JSON.stringify(W) + ',',
    '',
    '  // 按钮：次按钮主填充（更深更实，白字对比强；hover 用主按钮）',
    '  "--dsw-alias-button-primary-fill": ' + JSON.stringify(P) + ',',
    '  "--dsw-alias-button-primary-hover": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-button-primary-dimmed": ' + JSON.stringify(rgba(E, 0.18)) + ',',
    '  "--dsw-alias-button-contrast-fill": ' + JSON.stringify(S) + ',',
    '  "--dsw-alias-button-elevated-fill": ' + JSON.stringify('#1c1626') + ',',
    '  "--dsw-alias-button-floating-fill": ' + JSON.stringify('#181222') + ',',
    '  "--dsw-alias-button-floating-hover": ' + JSON.stringify('#241c30') + ',',
    '  "--dsw-alias-button-ghost-active-fill": ' + JSON.stringify('#201a2c') + ',',
    '  "--dsw-alias-button-ghost-active-hover": ' + JSON.stringify('#2c2440') + ',',
    '  "--dsw-alias-button-info-fill": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-button-info-hover": ' + JSON.stringify(P) + ',',
    '  "--dsw-alias-button-tool-bar-fill": ' + JSON.stringify(rgba(E, 0.16)) + ',',
    '  "--dsw-alias-button-tool-bar-hover": ' + JSON.stringify(rgba(P, 0.26)) + ',',
    '  "--dsw-alias-button-ghost-active-border": ' + JSON.stringify(G) + ',',
    '',
    '  // 交互：主按钮色（hover/active）',
    '  "--dsw-alias-interactive-bg-hover": ' + JSON.stringify(rgba(E, 0.10)) + ',',
    '  "--dsw-alias-interactive-bg-active": ' + JSON.stringify(rgba(CH, alphaOf('chip-active', 0.18))) + ',',
    '  "--dsw-alias-interactive-bg-hover-accent": ' + JSON.stringify(rgba(E, 0.15)) + ',',
    '  "--dsw-alias-interactive-bg-hover-danger": ' + JSON.stringify(rgba(255, 93, 122, 0.15)) + ',',
    '',
    '  // 边框：金色高亮（低透明度）',
    '  "--dsw-alias-border-l1": ' + JSON.stringify(rgba(G, 0.13)) + ',',
    '  "--dsw-alias-border-l2": ' + JSON.stringify(rgba(G, 0.22)) + ',',
    '  "--dsw-alias-border-l2-darkmode-thin": ' + JSON.stringify(rgba(G, 0.10)) + ',',
    '  "--dsw-alias-border-l3": ' + JSON.stringify(rgba(G, 0.25)) + ',',
    '  "--dsw-alias-border-l4": ' + JSON.stringify(rgba(G, 0.38)) + ',',
    '',
    '  // 状态：success=主按钮 / error 保留 / warn=金色高亮 / business=主按钮',
    '  "--dsw-alias-state-success-primary": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-state-success-secondary": ' + JSON.stringify(rgba(E, 0.16)) + ',',
    '  "--dsw-alias-state-success-tertiary": ' + JSON.stringify(rgba(E, 0.08)) + ',',
    '  "--dsw-alias-state-error-primary": ' + JSON.stringify('#ff5d7a') + ',',
    '  "--dsw-alias-state-error-secondary": ' + JSON.stringify('rgba(255, 93, 122, 0.16)') + ',',
    '  "--dsw-alias-state-warn-primary": ' + JSON.stringify(G) + ',',
    '  "--dsw-alias-state-warn-secondary": ' + JSON.stringify(rgba(G, 0.16)) + ',',
    '  "--dsw-alias-state-business-primary": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-state-business-tertiary": ' + JSON.stringify(rgba(E, 0.10)) + ',',
    '',
    '  // toast / tooltip / markdown / 滚动条（深空夜空底 + 金/紫强调）',
    '  "--dsw-alias-toast-bg": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.92)) + ',',
    '  "--dsw-alias-tooltip-bg": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.95)) + ',',
    '  "--dsw-alias-markdown-inline-code": ' + JSON.stringify(rgba(MK, alphaOf('markdown-capsule', 0.12))) + ',',
    '  "--dsw-alias-markdown-code-block": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.70)) + ',',
    '  "--dsw-alias-markdown-code-block-banner": ' + JSON.stringify(rgba(G, 0.06)) + ',',
    '  "--dsw-alias-scrollbar-bg-l1": ' + JSON.stringify(rgba(G, 0.15)) + ',',
    '  "--dsw-alias-scrollbar-bg-l2": ' + JSON.stringify(rgba(G, 0.22)) + ',',
    '  "--dsw-alias-scrollbar-hover-l1": ' + JSON.stringify(rgba(G, 0.30)) + ',',
    '  "--dsw-alias-scrollbar-hover-l2": ' + JSON.stringify(rgba(G, 0.42)) + ',',
    '',
    '  // 组件特化：侧栏激活=主按钮色（与主按钮一致）/ 高亮=金',
    // 2026-09-22 起左侧边栏底色由元素键 sidebar-left 驱动（lPcGpa_root 加入 comps 后可配色应用）；
    // pick 在函数顶部定义且作用于 vars——读 vars[sidebar-left]，缺省回退背景色保证兼容。
    '  "--dsw-specific-sidebar-fill": ' + JSON.stringify(rgba(pick('sidebar-left', colors.bg || '#0a0c16'), alphaOf('sidebar-left', 0.88))) + ',',
    // 2026-09-22 品牌区单独控制：sidebar-brand 键（lPcGpa_brand）背景+文字一体；
    //   层级注入：sidebar-left（整体）先注入 → sidebar-brand（内层品牌区）后注入，同特异性自然覆盖。
    //   字色 = 该键派生浅色（对深底可读）；缺省回退整体侧栏色，保证无键时行为不变。
    '  "--dsw-specific-sidebar-brand": ' + JSON.stringify(rgba(pick('sidebar-brand', colors.bg || '#0a0c16'), alphaOf('sidebar-brand', 0.6))) + ',',
    '  "--dsw-specific-sidebar-brand-text": ' + JSON.stringify(pick('sidebar-brand-text', pick('text-primary', '#EAFFF3'))) + ',',
    '  "--dsw-specific-sidebar-nav-item-active": ' + JSON.stringify(rgba(E, 0.16)) + ',',
    '  "--dsw-specific-sidebar-nav-item-active-accent": ' + JSON.stringify(E) + ',',
    '  "--dsw-specific-sidebar-nav-item-hover": ' + JSON.stringify(rgba(E, 0.08)) + ',',
    '  "--dsw-specific-bubble": ' + JSON.stringify(rgba('#141022', 0.88)) + ',',
    '  "--dsw-specific-bubble-highlight": ' + JSON.stringify(rgba(G, 0.08)) + ',',
    '  // 2026-09-23 会话头部（txgHvq_header = 宿主 .header 容器）：sessionHeader 键（#362A56 深紫同 dock/sidebar）',
    '  "--dsw-specific-session-header": ' + JSON.stringify(rgba(pick('sessionHeader', colors.bgLayer || '#161222'), alphaOf('sessionHeader', 0.5))) + ',',
    // 2026-09-2x 右侧边栏「文件」tab 文件树 body（稳定锚点 data-files-body；宿主类 _620KBG_body 随 hash 变）：
    //   底色由 panelBody 键驱动（同 sidebar 系），identity.js 按 [data-files-body] 应用。
    '  "--dsw-specific-files-body": ' + JSON.stringify(rgba(pick('panelBody', colors.bg || '#0a0c16'), alphaOf('panelBody', 1))) + ',',
    // 2026-09-2x 右侧边栏「文档预览」tab 纯文本容器（稳定锚点 data-textpreview-plain；宿主类 K5p42G_textDocument）：
    //   textDocument 键驱动（驼峰键同 sessionHeader），identity.js 按 [data-textpreview-plain] 应用。
    '  "--dsw-specific-text-document": ' + JSON.stringify(rgba(pick('textDocument', colors.bg || '#0a0c16'), alphaOf('textDocument', 1))) + ',',
    '  // 2026-09-22 未消费键补映射：dock-bar (dock 竖条背景，identity.js .mediascape-dsh-dock 引用)',
    '  "--dsw-specific-dock-bar": ' + JSON.stringify(rgba(pick('dock-bar', colors.bgLayer || '#161222'), alphaOf('dock-bar', 1))) + ',',
    '  "--dsw-specific-input-major": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.85)) + ',',
    '  "--dsw-specific-menu": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.94)) + ',',
    '  "--dsw-specific-selector": ' + JSON.stringify(rgba(colors.bgSoft || '#101020', 0.90)) + ',',
    '  "--dsw-specific-tip": ' + JSON.stringify(rgba(G, 0.10)) + ',',
    // ── 2026-09-2x 自动注册元素（theme-register.json zone=color）：数据驱动输出 --dsw-specific-<kebab-key>，
    // 与 identity.js registerColorCSS 的 var 名同规则（kebab 化）；apply 后变量覆盖默认色。
    ...(() => {
      const regLines = [];
      let REG_JSON = { rules: [] };
      try { REG_JSON = JSON.parse(readFileSync(join(SCRIPT_DIR, 'json', 'theme-register.json'), 'utf8')) || { rules: [] }; } catch (e) { /* 缺失 → 空 */ }
      for (const rg of (REG_JSON.rules || [])) {
        if (rg.zone !== 'color' || !rg.key) continue;
        const kebab = String(rg.key).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const aDef = typeof rg.alpha === 'number' && rg.alpha >= 0 && rg.alpha <= 1 ? rg.alpha : 1;
        regLines.push('  "--dsw-specific-' + kebab + '": ' + JSON.stringify(rgba(pick(rg.key, colors.bg || '#0a0c16'), alphaOf(rg.key, aDef))) + ',');
      }
      return regLines;
    })(),
    '};',
  ];
  return lines.join('\n');
}

// ── 真源/预设动态读取：解析 css（--swatch-* 变量）→ 基底对象 ──
// V2 键规范（2026-09-22）：--swatch-<key> 键 = 元素 class 名（与 comps.json 一一对应），无独立语义键。
// 真源 = theme-studio/json/theme-colors.json（apply 只跟它相关）；预设 = theme-studio/json/preset/*.json。
// 元数据键：label/badge/bg/bgSoft/bgLayer（显示名与背景源，颜色集合收集时排除）。
function parseSwatchCss(id, cssText) {
  const vars = {};
  for (const m of cssText.matchAll(/--swatch-([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  // 颜色集合：全部 --swatch-* 减排除名单（元数据键）。键名即元素 class 名，直显（不设语义别名）。
  const SWATCH_EXCLUDE = new Set(['label', 'badge', 'bg', 'bgSoft', 'bgLayer']);
  // 元素键 → 中文名（取自 comps.json；未知新键直显键名，不限制颜色数量）
  const KEY_NAME = {};
  for (const c of COMPS_CFG) KEY_NAME[c.key] = c.text;
  const swatches = [];
  const seenHex = new Set();
  for (const k of Object.keys(vars)) {
    if (SWATCH_EXCLUDE.has(k)) continue;
    const hex = vars[k].toUpperCase();
    if (!seenHex.has(hex)) { swatches.push({ key: k, name: KEY_NAME[k] || k, hex }); seenHex.add(hex); }
  }
  // 组件模拟：数据全来自 comps.json（角色/中文名/kind），模板通用（KIND_TEMPLATES）
  // 颜色来源：每个元素直接取自己的键 --swatch-<key>（键=元素 class）；键不存在 → 集合第一个色兜底。
  // 基底元数据（面板/dock/胶囊的底与边）：bg/bgLayer 取背景键，border 取 gold-glow、skin 取 text-primary。
  const bgHex = vars.bg || '#0d0f1a';
  const bgLayerHex = vars.bgLayer || bgHex;
  const borderHex = vars['gold-glow'] || '#D4AF37';
  const skinHex = vars['text-primary'] || '#FDF0FA';
  const ctx = { bg: bgHex, bgLayer: bgLayerHex, border: borderHex, skin: skinHex };
  const fallbackHex = (swatches[0] && swatches[0].hex) || '#888888';
  const comps = [];
  for (const cfg of COMPS_CFG) {
    const hex = (vars[cfg.key] || fallbackHex).toUpperCase();
    const tpl = KIND_TEMPLATES[cfg.kind] || KIND_TEMPLATES['text'];
    comps.push({ role: cfg.key, text: cfg.text, kind: cfg.kind, colorKey: cfg.key, hex, style: tpl(hex, ctx) });
  }
  return {
    id,
    label: vars.label || id,
    badge: vars.badge || '导出',
    bg: vars.bg || '#0d0f1a',
    bgSoft: vars.bgSoft || '#101020',
    bgLayer: vars.bgLayer || '#161222',
    swatches,
    comps,
  };
}




// ── 可配置项 ──
const DSH_BASE = process.env.DSH_PREVIEW_TARGET || 'http://127.0.0.1:30800'; // DSH 反代
// 反代日志（token 兜底来源）：优先环境变量 DSH_PROXY_LOG，否则按 DSH_HOME 推导（不硬编码路径）
const PROXY_LOG = process.env.DSH_PROXY_LOG || join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'dsh-proxy.log');

// ── V2 配色真源 json + 预设包（2026-09-22 由 css 迁移）──
// 配色真源 = theme-studio/json/theme-colors.json（colors 对象化 + 每色 alpha 不透明度 + bg 系层级），
// apply 只跟它相关。旧 css 路径保留仅供迁移期回退（迁移完成删除）。
const THEME_CSS = join(SCRIPT_DIR, 'json', 'mediascape-dsh-theme.css');   // 旧 css 副本（迁移期）
const THEME_JSON = join(SCRIPT_DIR, 'json', 'theme-colors.json');          // 配色真源 json（唯一写盘目标）
const PRESET_JSON_DIR = join(SCRIPT_DIR, 'json', 'preset');                // 预设包 json 目录
const PRESET_DIR = PRESET_JSON_DIR;                                        // 兼容旧名（.css 预设迁移前也可读）
// 胶囊解释目录（class-catalog.json 更名，2026-09-22）
const THEME_CAPSULES = join(SCRIPT_DIR, 'json', 'theme-capsules.json');
// 从 css 文本解析 --swatch-* 变量（与 parseSwatchCss 同逻辑；apply/export 复用）
function parseSwatchVars(cssText) {
  const vars = {};
  for (const m of String(cssText || '').matchAll(/--swatch-([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  return vars;
}
// ── json 真源读写（2026-09-22 引入：colors 对象化 + alpha）──
function readThemeJson() {
  try { return JSON.parse(readFileSync(THEME_JSON, 'utf8')) || {}; } catch { return {}; }
}
function writeThemeJson(j) {
  const tmp = THEME_JSON + '.tmp';
  writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', 'utf8');
  renameSync(tmp, THEME_JSON);
  return Buffer.byteLength(JSON.stringify(j, null, 2), 'utf8');
}
// json 真源 → 兼容 vars（供 buildTokensContent/buildIdentityBlock 取色）：key → hex
function themeJsonToVars(j) {
  const vars = {};
  if (j.label) vars.label = j.label;
  if (j.badge) vars.badge = j.badge;
  for (const k of ['bg', 'bgSoft', 'bgLayer']) if (j[k] && j[k].hex) vars[k] = j[k].hex;
  for (const k of Object.keys(j.colors || {})) if (j.colors[k] && j.colors[k].hex) vars[k] = j.colors[k].hex;
  return vars;
}
// 解析 json 文本 → swatch 值对象（兼容旧 parseSwatchVars 的调用方；css 文本照旧正则解析）
function parseSwatchVarsCombo(cssOrJson) {
  if (String(cssOrJson).trim().startsWith('{')) {
    try {
      const j = JSON.parse(cssOrJson);
      const vars = {};
      if (j.label) vars.label = j.label;
      if (j.badge) vars.badge = j.badge;
      for (const k of ['bg', 'bgSoft', 'bgLayer']) if (j[k] && j[k].hex) vars[k] = j[k].hex;
      for (const k of Object.keys(j.colors || {})) if (j.colors[k] && j.colors[k].hex) vars[k] = j.colors[k].hex;
      return vars;
    } catch { /* 不是合法 json → 回退 css 解析 */ }
  }
  return parseSwatchVars(cssOrJson);
}
// 原子写真源 css（tmp+rename，防半写）；保留原文件权限位；返回字节数
// 原子写真源 css（tmp+rename，防半写）；保留原文件权限位；返回字节数
function writeThemeCss(cssText) {
  let mode = 0o644;
  try { mode = statSync(THEME_CSS).mode & 0o777; } catch { /* 首次创建用默认 */ }
  const tmp = THEME_CSS + '.tmp';
  writeFileSync(tmp, cssText, 'utf8');
  chmodSync(tmp, mode);
  renameSync(tmp, THEME_CSS);
  return Buffer.byteLength(cssText, 'utf8');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
};

// ── CLI 参数 ──
const args = process.argv.slice(2);
const PORT = parseInt(args.find(a => a.startsWith('--port'))?.split('=')[1] || args[args.indexOf('--port') + 1] || '30999', 10);
const noOpen = args.includes('--no-open');
const shotPath = args.find(a => a.startsWith('--shot'))?.split('=')[1] || (args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null);
const dshArg = args.find(a => a.startsWith('--dsh'))?.split('=')[1] || (args.includes('--dsh') ? args[args.indexOf('--dsh') + 1] : null);
const tokenArg = args.find(a => a.startsWith('--token'))?.split('=')[1] || (args.includes('--token') ? args[args.indexOf('--token') + 1] : null);
const TARGET = dshArg || DSH_BASE;

// ── token 解析：--token > env > dsh-proxy.log ──
function resolveToken() {
  if (tokenArg) return tokenArg;
  if (process.env.DSH_PREVIEW_TOKEN) return process.env.DSH_PREVIEW_TOKEN;
  try {
    if (!existsSync(PROXY_LOG)) return null;
    const txt = readFileSync(PROXY_LOG, 'utf8');
    const m = txt.match(/token=([a-zA-Z0-9_-]{20,})/g);
    if (m && m.length) {
      const last = m[m.length - 1].replace('token=', '');
      return last;
    }
  } catch { /* 读不到就 null */ }
  return null;
}

// ── DSH 会话：认证 cookie 缓存 ──
let authCookie = null;   // 已认证的 cookie 串
let cookieFromToken = null; // 通过 token 建立会话得到的 cookie
const COOKIE_RE = /(dsh-auth|_DSH|dsh_)[^;]*/i;

async function ensureAuthCookie() {
  if (authCookie) return authCookie;
  const token = resolveToken();
  if (!token) return null;
  // GET /?token=xxx → 303 + Set-Cookie
  return new Promise((resolve) => {
    const target = new URL(TARGET);
    // dsh-skip-sensitive（token 来自 --token 参数/环境变量/日志兜底，运行时解析，非硬编码凭据）
    const req = httpRequest({
      hostname: target.hostname, port: target.port, path: '/?token=' + encodeURIComponent(token), method: 'GET',
      headers: { host: target.host, connection: 'close' }, // 强制新连接，避免复用反代坏 keep-alive
    }, (res) => {
      const setCookies = res.headers['set-cookie'] || [];
      const c = setCookies.map(s => s.split(';')[0]).join('; ');
      if (c) { authCookie = c; }
      res.resume();
      resolve(authCookie);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** 转发一个浏览器请求到 DSH 真实后端（2026-09-22 修：cookie 就绪后再 pipe + 保留 content-length，修复局域网上传极慢 + 记录速度日志）。 */
function proxyToDsh(req, res, upstreamPath) {
  const t0 = Date.now();
  let bodyBytes = 0;
  let bodyDoneAt = 0;
  console.log('[proxy] REQHEAD', req.method, upstreamPath, JSON.stringify(req.headers));
  // ⚠️ 2026-09-22 修（根因实测）：旧实现 req.on('data') 计数把 req 切流动模式，等异步 ensureAuthCookie
  //    就绪后才 pipe——cookie 等待期 body 已开始流入（计数监听消耗），pipe 挂上时转发退化为
  //    「先全量收内存、再串行推」→ 局域网 20MB 实测 16.9s（直连 DSH 仅 1.1s）。且删除 content-length
  //    转 chunked 让 DSH 反代对上传体逐块处理更慢。修复：req.pause() 保持 paused 直到转发就绪，
  //    cookie 就绪后单 pipe 流式转发 + **保留 content-length**（流式转发应保留，长度正确才不挂起）。
  req.pause();
  ensureAuthCookie().then((cookie) => {
    if (!cookie) {
      console.log(`[proxy] ${req.method} ${upstreamPath} → 502 no-cookie (${Date.now() - t0}ms)`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('preview: 无法认证 DSH 后端（未提供 --token 且 proxy.log 无 token）');
      return;
    }
    const target = new URL(TARGET);
    const headers = { ...req.headers, host: target.host, cookie, connection: 'close' };
    // 流式转发保留 content-length（长度正确，反代无需 chunked 逐块处理）；
    // 仅当请求无 content-length（分块上传）才删，让 Node 用 chunked 兜底。
    const cl = headers['content-length'];
    if (cl === undefined) delete headers['content-length'];
    console.log('[proxy] FWDHEAD', JSON.stringify(headers));
    const upstream = httpRequest({
      hostname: target.hostname, port: target.port, path: upstreamPath, method: req.method, headers,
    }, (up) => {
      const outHeaders = { ...up.headers };
      delete outHeaders['set-cookie']; // 不把 DSH cookie 回给预览页
      delete outHeaders['content-length'];
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
      const finish = (tag) => {
        const ms = Date.now() - t0;
        const mb = (bodyBytes / 1048576).toFixed(2);
        const speed = ms > 0 ? (bodyBytes / 1048576 / (ms / 1000)).toFixed(2) : 0;
        // 分段时间：cookie 就绪 / body 收完 / 总耗时（定位慢在哪段）
        console.log(`[proxy] ${req.method} ${upstreamPath} → ${tag} ${up.statusCode} body=${bodyBytes}B (${mb}MB ${ms}ms ${speed}MB/s cookie@${Math.round((up._msCookie || 0))}ms bodyDone@${bodyDoneAt}ms)`);
        // 上传类转发落 upload.log（受 debug.json log 总开关控制，关闭不落盘——writeLog 内部已判断）
        if (/upload|cover/.test(upstreamPath)) {
          writeLog('upload.log', { event: 'proxy-upload', path: upstreamPath, method: req.method, status: up.statusCode, bytes: bodyBytes, mb: Number(mb), ms, mbps: Number(speed), ts: new Date().toISOString() });
        }
      };
      up.on('end', () => finish('end'));
      up.on('close', () => { if (!up.complete) finish('CLOSE(no-response?)'); });
    });
    upstream._msCookie = Date.now() - t0;
    upstream.on('error', (e) => {
      const ms = Date.now() - t0;
      console.log(`[proxy] ${req.method} ${upstreamPath} → ERROR ${e.message} body=${bodyBytes}B ${ms}ms`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('preview: 转发 DSH 失败 ' + e.message);
    });
    // 单数据流：pipe 消费，data 仅计数（pipe 内部有独立数据处理器，两者不互斥）
    req.on('data', (c) => { bodyBytes += c.length; });
    req.on('end', () => { bodyDoneAt = Date.now() - t0; });
    req.pipe(upstream);
  });
}

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

function serveFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) { send(res, 404, 'not found'); return; }
  const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

// ── Range/206 分片静态服务（与 lib/index.js serveStream 同步实现，两处保持一致）──
// 仅 media（video/* | audio/*）且带 Range 才分片：206 + Accept-Ranges + Content-Range + 分片流；
// 无 Range / 非媒体 → 200 全量（现状不变）；非法 Range → 416 + Content-Range: bytes */<total>。
// 仅整数解析（RFC7233 bytes=<start>-<end> / bytes=<start>- / bytes=-<suffix>）。
function serveStream(res, req, file) {
  if (!existsSync(file) || !statSync(file).isFile()) { send(res, 404, 'not found'); return; }
  const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const st = statSync(file);
  const total = st.size;
  // 视频 HTTP 缓存（2026-09-22 方案一，与 lib/index.js serveStream 同步实现）：
  // ETag 用 mtime-size 指纹——文件被替换后指纹变化，浏览器 If-Range 条件请求不匹配 → 回 200 全量，
  // 绝不返回旧内容；命中缓存（If-Range 匹配）→ 206 分片（浏览器直接用缓存分片，不重新传输）。
  const etag = '"' + st.mtimeMs + '-' + total + '"';
  const isMedia = /^(video|audio)\//.test(mime);
  const range = (req.headers && req.headers.range) || '';
  const ifRange = (req.headers && req.headers['if-range']) || '';
  // 条件请求：客户端缓存了旧分片且 If-Range 与当前 etag 不匹配（文件已变）→ 放弃 206、回 200 全量
  if (isMedia && ifRange && ifRange !== etag) {
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=86400', 'etag': etag });
    createReadStream(file).pipe(res);
    return;
  }
  if (!isMedia || !range) {
    // 媒体无 Range → 200 全量 + 缓存；非媒体 → 保持 no-cache（配置/页面即时生效）
    const h = isMedia
      ? { 'content-type': mime, 'cache-control': 'public, max-age=86400', 'etag': etag }
      : { 'content-type': mime, 'cache-control': 'no-cache' };
    res.writeHead(200, h);
    createReadStream(file).pipe(res);
    return;
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = null, end = null;
  if (m && m[1] !== '') start = Number(m[1]);
  if (m && m[2] !== '') end = Number(m[2]);
  // 非法 Range（不是 bytes=N-M 形）→ 416 直接拒绝（RFC7233 语法错误不应按全量发）
  if (!m) {
    res.writeHead(416, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'content-range': `bytes */${total}` });
    res.end();
    return;
  }
  // bytes=-<suffix>：末尾 suffix 字节（start=total-suffix, end=total-1）；bytes=<start>-：到文件尾
  if (start === null && end !== null && Number.isInteger(end) && end >= 0) { start = Math.max(total - end, 0); end = total - 1; }
  if (start === null) start = 0;
  if (end === null || end >= total) end = total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= total) {
    res.writeHead(416, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'content-range': `bytes */${total}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'content-type': mime,
    'cache-control': 'public, max-age=86400',
    'etag': etag,
    'accept-ranges': 'bytes',
    'content-range': `bytes ${start}-${end}/${total}`,
    'content-length': end - start + 1,
  });
  createReadStream(file, { start, end }).pipe(res);
}

// ── 真实数据目录（与 lib/paths.js 同推导：$DSH_HOME/theme-mediascape/wallpaper|music|boot|logs） ──
function themeBase() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}
function wallpaperDir() {
  return join(themeBase(), 'theme-mediascape', 'wallpaper');
}
function musicDir() {
  return join(themeBase(), 'theme-mediascape', 'music');
}
function bootDir() {
  return join(themeBase(), 'theme-mediascape', 'boot');
}
function logsDir() {
  return join(themeBase(), 'theme-mediascape', 'logs');
}
const WALLPAPER_LABELS_FILE = 'wallpaper.json';
const MUSIC_LABELS_FILE = 'music.json';
const ALLOWED_UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm']);
// 2026-09-2x：视频判定扩展名集合（与后端 config.js VIDEO_EXT 一致：视频不只 mp4，含 webm）
const VIDEO_EXT = new Set(['.mp4', '.webm']);

/** 读壁纸 labels（wallpaper/wallpaper.json），读不到/解析失败返回空对象。 */
function loadWallpaperLabels() {
  try {
    const p = join(wallpaperDir(), WALLPAPER_LABELS_FILE);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return {}; }
}

/** 读音乐清单（music/music.json），读不到/解析失败返回空对象。 */
function loadMusicLabels() {
  try {
    const p = join(musicDir(), MUSIC_LABELS_FILE);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return {}; }
}

/** 写音乐清单（music/music.json），写失败静默（只读预览时不影响）。 */
function saveMusicLabels(map) {
  try { writeFileSync(join(musicDir(), MUSIC_LABELS_FILE), JSON.stringify(map, null, 2), 'utf8'); } catch {}
}

/** 本地列出用户壁纸（读真实数据目录 + labels）+ 在线下载资源（wallpaper/online/），与后端 handleList 结构一致。 */
function handleListLocal(res) {
  try {
    const dir = wallpaperDir();
    if (!existsSync(dir)) {
      send(res, 200, JSON.stringify({ ok: true, items: [] }), 'application/json; charset=utf-8');
      return;
    }
    const labels = loadWallpaperLabels();
    // etag = mtime-size 指纹（与后端 handleList 同源同格式）：客户端持久缓存以此判断文件是否被替换
    const items = readdirSync(dir)
      .filter((f) => f !== WALLPAPER_LABELS_FILE && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
      .map((f) => {
        const ext = extname(f).toLowerCase();
        const id = f.replace(/\.[^.]+$/, '');
        let etag = null, size = null;
        try {
          const st = statSync(join(dir, f));
          etag = '"' + st.mtimeMs + '-' + st.size + '"';
          size = st.size;
        } catch (e) { /* stat 失败 → etag/size null */ }
        return {
          id,
          kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
          label: labels[id] || f.replace(/\.[^.]+$/, ''),
          file: f, // 2026-09-2x：与后端 handleList 一致（前端上传预检「文件名+大小」去重基准）
          size,
          url: '/theme-mediascape-assets/wallpaper/' + encodeURIComponent(f),
          etag,
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    // 合并在线下载资源（与后端 handleList 同语义：同 id 顶层优先）
    const odir = join(dir, 'online');
    if (existsSync(odir)) {
      const ids = new Set(items.map((x) => x.id));
      const online = readdirSync(odir)
        .filter((f) => !f.endsWith('.part') && !f.endsWith('.tmp') && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
        .filter((f) => {
          const id = f.replace(/\.[^.]+$/, '');
          if (ids.has(id)) return false;
          ids.add(id);
          return true;
        })
        .map((f) => {
          const ext = extname(f).toLowerCase();
          const id = f.replace(/\.[^.]+$/, '');
          let etag = null, size = null;
          try {
            const st = statSync(join(odir, f));
            etag = '"' + st.mtimeMs + '-' + st.size + '"';
            size = st.size;
          } catch (e) { /* stat 失败 → etag/size null */ }
          return {
            id,
            kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
            label: labels[id] || f.replace(/\.[^.]+$/, ''),
            file: f, // 2026-09-2x：与后端 handleList 一致
            size,
            url: '/theme-mediascape-assets/wallpaper/online/' + encodeURIComponent(f),
            etag,
          };
        });
      items.push(...online);
    }
    send(res, 200, JSON.stringify({ ok: true, items }), 'application/json; charset=utf-8');
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: String(e?.message ?? e) }), 'application/json; charset=utf-8');
  }
}

/**
 * 本地列出音乐（读真实数据目录 music/ + music.json 显示名/封面），与后端 handleMusicList 结构一致。
 * 同名封面：音乐名去扩展名与封面名去扩展名一致即匹配；music.json 的 cover 字段优先。
 */
function handleMusicListLocal(res) {
  try {
    const dir = musicDir();
    if (!existsSync(dir)) {
      send(res, 200, JSON.stringify({ ok: true, items: [] }), 'application/json; charset=utf-8');
      return;
    }
    const meta = loadMusicLabels();
    const audioExts = new Set(['.mp3', '.ogg', '.m4a', '.wav']);
    const imgExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
    const files = readdirSync(dir);
    const audioFiles = files.filter((f) => audioExts.has(extname(f).toLowerCase()));
    const items = audioFiles
      .map((f) => {
        const id = f.replace(/\.[^.]+$/, '');
        const m = meta[id];
        const cover = typeof m?.cover === 'string' && m.cover
          ? m.cover
          : (files.find((g) => imgExts.has(extname(g).toLowerCase()) && g.replace(/\.[^.]+$/, '') === id) || '');
        return {
          id,
          name: (typeof m?.name === 'string' && m.name) || f,
          file: f, // 2026-09-2x：与后端 handleMusicList 一致（前端上传预检「文件名+大小」去重基准）
          size: (() => { try { return statSync(join(dir, f)).size; } catch (e) { return null; } })(),
          cover,
          url: '/theme-mediascape-assets/music/' + encodeURIComponent(f),
          custom: true,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    // 自动同步 music.json：与后端 handleMusicList 同语义（新增登记/删除移除/同名封面补 cover/保留已有）。
    const synced = {};
    for (const it of items) {
      const prev = meta[it.id];
      synced[it.id] = {
        name: (typeof prev?.name === 'string' && prev.name) || it.name,
        cover: (typeof prev?.cover === 'string' && prev.cover) || it.cover,
      };
    }
    if (JSON.stringify(synced) !== JSON.stringify(meta)) saveMusicLabels(synced);
    send(res, 200, JSON.stringify({ ok: true, items }), 'application/json; charset=utf-8');
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: String(e?.message ?? e) }), 'application/json; charset=utf-8');
  }
}

/** 本地服务插件根目录下的静态素材（boot/、music/）。媒体带 Range → serveStream 分片（开屏视频流式）。 */
function serveAssetLocal(res, req, pathname) {
  const rel = pathname.replace(/^\/theme-mediascape-assets\//, '');   // boot/xxx...
  const top = rel.split('/')[0];
  if (top !== 'boot' && top !== 'music') { send(res, 404, 'not found'); return; }
  // music/ → 真实数据目录（音乐本体+封面）；boot/ → 运行态数据目录（2026-09-22 改：
  // 开屏素材/boot.json 由 $DSH_HOME/theme-mediascape/boot/ 提供，与主实例同源——改运行态文件即生效）
  const base = top === 'music' ? musicDir() : bootDir();
  const file = normalize(join(base, top === 'music' ? rel.slice('music/'.length) : rel.slice('boot/'.length)));
  if (!file.startsWith(normalize(join(base, '')))) { send(res, 403, 'forbidden'); return; }
  serveStream(res, req, file);
}

/** 本地服务用户上传壁纸（真实数据目录 wallpaper/<file>）与在线资源（wallpaper/online/<file>）。媒体带 Range → 分片。 */
function serveWallpaperLocal(res, req, pathname) {
  const rel = pathname.replace(/^\/theme-mediascape-assets\/wallpaper\//, '');
  // 允许 顶层文件 或 online/<file>（在线下载资源子目录）；禁止深层穿越/labels
  const isOnline = rel.startsWith('online/');
  const name = isOnline ? rel.slice('online/'.length) : rel;
  if (!name || name.includes('/') || name === WALLPAPER_LABELS_FILE) { send(res, 404, 'not found'); return; }
  const base = isOnline ? join(wallpaperDir(), 'online') : wallpaperDir();
  const file = normalize(join(base, name));
  if (!file.startsWith(base)) { send(res, 403, 'forbidden'); return; }
  serveStream(res, req, file);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  // 页面级开关（2026-09-22 改，debug.json 独立控制）：
  //   preview 开关 → preview.html（预览页）；theme-swatch 开关 → theme-swatch.html + 配色 API
  const dbgCfg = readDebugConfig();

  // 统一入口计时 + 分类日志（2026-09-22 用户约束：不在各 handler 函数内打点、无常驻采集器——
  // 只在唯一 createServer 入口按请求类别记一行，log 关闭时零开销）：
  //   preview.html / theme-swatch.html 页面访问 → preview.log / theme-swatch.log
  //   配色写操作 API（theme-save / theme-apply / theme-rename / capsules-save）→ theme-swatch.log
  //   上传转发（wallpaper/upload、music/upload、music/cover）→ upload.log
  //   其余 → api.log（API 请求耗时）
  const relLog = pathname.replace(/^\/theme-mediascape-assets\//, '');
  // 2026-09-23：本地 upload/DELETE 处理用 rel/top（与 index.js 同解析）
  const rel = pathname.replace(/^\/theme-mediascape-assets\//, '');
  const top = rel.split('/')[0];
  const isPagePreview = pathname === '/' || pathname === '/index.html';
  const isPageSwatch = pathname === '/theme-swatch.html';
  const isSwatchApi = pathname.startsWith('/api/') && req.method === 'POST';
  const isUpload = req.method === 'POST' && /^upload$|^music\/upload$|^music\/cover$/.test(relLog) || pathname === '/api/upload';
  if (dbgCfg.log || isPagePreview || isPageSwatch || isSwatchApi || isUpload) {
    const t0 = Date.now();
    const page = isPagePreview ? 'preview.log' : null;
    res.on('finish', () => {
      try {
        if (page) writeLog(page, { event: 'page-view', page: pathname });
        else if (isPageSwatch) writeLog('theme-swatch.log', { event: 'page-view', page: pathname });
        else if (isSwatchApi) writeLog('theme-swatch.log', { event: 'api', method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - t0 });
        else if (isUpload) writeLog('upload.log', { event: 'upload', method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - t0 });
        else if (logEnabled('api')) writeLog('api.log', { event: 'api', method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - t0 });
      } catch { /* 日志写失败静默 */ }
    });
  }

  // 根 → 预览页（preview 开关关 → 404 提示）
  if (pathname === '/' || pathname === '/index.html') {
    if (!dbgCfg.preview) { send(res, 404, 'preview 未开启（debug.json preview:true 开启）'); return; }
    serveFile(res, join(SCRIPT_DIR, 'preview.html')); return;
  }

  // 配色对照页（流萤 vs 知更鸟，静态对照用；theme-swatch 开关关 → 404 提示）
  if (pathname === '/theme-swatch.html') {
    if (!dbgCfg.themeSwatch) { send(res, 404, 'theme-swatch 未开启（debug.json theme-swatch:true 开启）'); return; }
    serveFile(res, join(SCRIPT_DIR, 'theme-swatch.html')); return;
  }

  // 重启预览服务（2026-09-23 加）：预览页「重启」按钮 → POST /api/restart → spawn bash start.sh restart。
  // 先回响应再重启（当前进程被 stop 杀掉前连接已关闭，浏览器收 200 后提示刷新）；restart 由 start.sh
  // 完成（stop 旧 PID → sleep → start 新进程），spawn detached 避免本进程退出时拖累子进程。
  if (req.method === 'POST' && pathname === '/api/restart') {
    try {
      send(res, 200, JSON.stringify({ ok: true, restarting: true }), 'application/json');
      const startSh = join(SCRIPT_DIR, 'start.sh');
      const child = spawn('bash', [startSh, 'restart'], {
        detached: true, stdio: 'ignore', cwd: join(SCRIPT_DIR, '..'),
      });
      child.unref();
      console.log('[restart] 预览服务重启已触发（start.sh restart）');
    } catch (e) {
      console.error('[restart] 触发失败:', e?.message ?? e);
      send(res, 500, JSON.stringify({ ok: false, error: String(e?.message ?? e) }), 'application/json');
    }
    return;
  }

  // 导出为预设包：POST { name, css } → theme-studio/json/preset/<name>.json（配色页右侧「导出」：左列当前配色含 alpha 存为新预设）
  if (req.method === 'POST' && pathname === '/api/theme-export') {
    if (!readDebugConfig().themeSwatch) { send(res, 404, 'theme-swatch 未开启'); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 512 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        // 名字允许中文/字母数字/下划线连字符（与前端 prompt 消毒一致）；其他字符替换为 _，防非法文件名
        const name = String(body.name || '').replace(/[^\w\u4e00-\u9fa5·-]/g, '_').slice(0, 60);
        const css = String(body.css || '');
        if (!name || !css) { send(res, 400, JSON.stringify({ ok: false, error: '缺 name/css' }), 'application/json'); return; }
        // 预设包 json：只存颜色集合（colors key:{hex,alpha}）+ 显示名；剥离 bg 系（真源 json 是唯一背景源）
        // 2026-09-22：输入若是 json 文本（{ 开头）→ 直接读 colors{hex,alpha} 保留不透明度；否则按旧 css 解析（alpha 1）
        const preset = { label: name, badge: '预设', colors: {} };
        const trimmedCss = String(css).trim();
        if (trimmedCss.startsWith('{')) {
          try {
            const jp = JSON.parse(trimmedCss);
            for (const [k, v] of Object.entries(jp.colors || {})) {
              if (['bg', 'bgSoft', 'bgLayer'].includes(k)) continue;
              const hex = String(v.hex || '').toUpperCase();
              if (/^#[0-9A-F]{6}$/.test(hex)) preset.colors[k] = { hex, alpha: (v.alpha >= 0 && v.alpha <= 1) ? Number(v.alpha) : 1 };
            }
          } catch { /* json 解析失败 → 回退 css 解析 */ }
        }
        if (!Object.keys(preset.colors).length) {
          const vars = parseSwatchVarsCombo(css);
          for (const k of Object.keys(vars)) {
            if (['label', 'badge', 'bg', 'bgSoft', 'bgLayer'].includes(k)) continue;
            if (/^#?[0-9a-f]{6}$/i.test(vars[k])) preset.colors[k] = { hex: '#' + vars[k].replace(/^#/, '').toUpperCase(), alpha: 1 };
          }
        }
        mkdirSync(PRESET_JSON_DIR, { recursive: true });
        const file = join(PRESET_JSON_DIR, name + '.json');
        const tmp = file + '.tmp';
        writeFileSync(tmp, JSON.stringify(preset, null, 2) + '\n', 'utf8');
        renameSync(tmp, file);
        console.log(`[theme-export] json/preset/${name}.json ${JSON.stringify(preset).length}B`);
        send(res, 200, JSON.stringify({ ok: true, path: file, bytes: JSON.stringify(preset).length }), 'application/json');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // 应用为正式主题：POST { items:[{key,hex,alpha},…] } 或 { css } → 写真源 → identity.js + tokens.js → build
  // V2 约定（2026-09-22 json 化）：apply 自始至终只跟 theme-colors.json（配色真源 json）相关。
  //   { items } 集合（主路径）：{key, hex, alpha} 数组，写入 theme-colors.json 对应元素的 hex+alpha
  //     （alpha 0~1 = 该颜色不透明度，如 sidebar-left 0.88；缺省 1）。右侧每行「应用」/左侧「应用」走此。
  //   { css } 全量（迁移期兼容）：旧 css 文本 → 解析 → 归一为 json 写盘。迁移完成后移除。
  if (req.method === 'POST' && pathname === '/api/theme-apply') {
    if (!readDebugConfig().themeSwatch) { send(res, 404, 'theme-swatch 未开启'); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 512 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        // ── 收集要写入的键值（items 优先；css 兼容归一）──
        const writes = {};  // key → { hex, alpha }
        let theme = readThemeJson();
        if (Array.isArray(body.items) && body.items.length) {
          // 从当前 json 为底、逐项覆盖（只动目标键，其它键/bg 系原样保留）
          for (const it of body.items) {
            const rawKey = String(it.key || '');
            const key = rawKey.replace(/[^a-zA-Z0-9_-]/g, '');
            if (key !== rawKey || !key) { send(res, 400, JSON.stringify({ ok: false, error: '非法键: ' + rawKey }), 'application/json'); return; }
            // key 必须存在于 theme-colors.json（bg 系或 colors 内）
            const exists = (key === 'bg' || key === 'bgSoft' || key === 'bgLayer') || (theme.colors && Object.prototype.hasOwnProperty.call(theme.colors, key));
            if (!exists) { send(res, 400, JSON.stringify({ ok: false, error: 'theme-colors.json 无此键: ' + key }), 'application/json'); return; }
            const hexRaw = String(it.hex || '');
            if (!/^#?[0-9a-fA-F]{6}$/.test(hexRaw)) { send(res, 400, JSON.stringify({ ok: false, error: `非法色值 ${key}: ${hexRaw}` }), 'application/json'); return; }
            const hex = '#' + hexRaw.replace(/^#/, '').toUpperCase();
            let alpha = 1;
            if (it.alpha !== undefined) {
              alpha = Number(it.alpha);
              if (!(alpha >= 0 && alpha <= 1)) { send(res, 400, JSON.stringify({ ok: false, error: `非法不透明度 ${key}: ${it.alpha}（须 0~1）` }), 'application/json'); return; }
            }
            writes[key] = { hex, alpha };
          }
        } else if (body.css) {
          // css 全量（迁移期）：解析 → 写 json（css 无 alpha → 保持 json 现有 alpha + 新键 alpha 1）
          const vars = parseSwatchVars(body.css);
          if (!theme.colors) theme.colors = {};
          for (const k of Object.keys(vars)) {
            if (['label', 'badge'].includes(k)) continue;
            if (/^#?[0-9a-f]{6}$/i.test(vars[k])) {
              if (k === 'bg' || k === 'bgSoft' || k === 'bgLayer') {
                const prev = theme[k] || {};
                writes[k] = { hex: '#' + vars[k].replace(/^#/, '').toUpperCase(), alpha: prev.alpha || 1 };
              } else {
                const prev = theme.colors[k] || {};
                writes[k] = { hex: '#' + vars[k].replace(/^#/, '').toUpperCase(), alpha: prev.alpha || 1 };
              }
            }
          }
        }
        if (Object.keys(writes).length === 0) { send(res, 400, JSON.stringify({ ok: false, error: '缺 items 或 css' }), 'application/json'); return; }
        // ── 写入 theme-colors.json（唯一落盘入口）──
        if (!theme.colors) theme.colors = {};
        for (const [key, w] of Object.entries(writes)) {
          if (key === 'bg' || key === 'bgSoft' || key === 'bgLayer') theme[key] = w;
          else theme.colors[key] = w;
        }
        const bytes = writeThemeJson(theme);
        const vars = themeJsonToVars(theme);
        // ── 组装 colors（label/badge/bg 系；元素色全部原样传入 vars 供生成函数取用）──
        const name = theme.label || '配色';
        const colors = {
          _name: name,
          bg: (theme.bg && theme.bg.hex) || '#0a0c16',
          bgSoft: (theme.bgSoft && theme.bgSoft.hex) || '#101020',
          bgLayer: (theme.bgLayer && theme.bgLayer.hex) || '#161222',
        };
        // 覆盖写 identity.js / tokens.js（无备份——theme-colors.json 与代码都在 git，历史可恢复）
        const idFile = join(THEME_ROOT, 'lib/client-parts/scenes/identity.js');
        const tkFile = join(THEME_ROOT, 'lib/client-parts/foundation/tokens.js');
        // 写 identity.js：把 html{ ... } 块整体替换为新块（含末尾所有逗号，幂等——buildIdentityBlock 末行自带逗号）
        let idSrc = readFileSync(idFile, 'utf8');
        idSrc = idSrc.replace(/"html \{ color-scheme[\s\S]*?"\}",*/m, () => buildIdentityBlock(colors, vars));
        writeFileSync(idFile, idSrc, 'utf8');
        // 写 tokens.js：把「注释头 + TOKENS 块」整体替换（注释头随内容生成，幂等——不再残留旧注释）
        let tkSrc = readFileSync(tkFile, 'utf8');
        tkSrc = tkSrc.replace(/\/\/ ═+ 1\. 设计令牌层[\s\S]*?\};/, () => buildTokensContent(colors, vars, theme));
        writeFileSync(tkFile, tkSrc, 'utf8');
        // build（node 在目标 bin；失败不致命，记录）
        // ⚠️ DSH_THEME_NO_RESTART=1：debug 模式下 build 会自动重启预览服务，
        // 但这里就是预览服务进程本身在处理请求——restart 会杀掉自己导致「应用后被杀」。
        // 自测照跑，跳过重启（新产物下次启动即生效，无需本次重启）。
        let buildOut = '';
        try {
          buildOut = execSync(`PATH="/var/packages/DeepSeekHarness-NAS/target/bin:$PATH" DSH_THEME_NO_RESTART=1 node build.cjs`, {
            cwd: THEME_ROOT, encoding: 'utf8', timeout: 120000,
          }).trim();
        } catch (e) { buildOut = 'BUILD_FAIL: ' + (e.stderr || e.message); }
        console.log(`[theme-apply] ${name} → 真源 css ${bytes}B + identity.js+tokens.js 已改写`);
        send(res, 200, JSON.stringify({
          ok: true, name, bytes, build: buildOut,
          identity: idSrc.length, tokens: tkSrc.length,
        }), 'application/json');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // /api/theme-current → 当前应用主题（GET）：读配色真源 json（theme-studio/json/theme-colors.json），
  // 返回 { label, badge, swatches(颜色集合), comps(元素 class 控件), bg 系, colors(key:{hex,alpha}), theme(json 原文) }
  // 2026-09-22 json 化：css 仅迁移期回退（存在才用），json 为唯一真源。
  if (req.method === 'GET' && pathname === '/api/theme-current') {
    try {
      let theme = readThemeJson();
      let jsonText = '';
      if (theme && Object.keys(theme).length) {
        jsonText = JSON.stringify(theme, null, 2);
      } else if (existsSync(THEME_CSS)) {
        // 迁移期回退：从旧 css 解析 → 构造 json 结构
        const cssText = readFileSync(THEME_CSS, 'utf8');
        const vars = parseSwatchVars(cssText);
        theme = {
          label: vars.label || '知更鸟·晴歌', badge: vars.badge || '默认',
          bg: { hex: (vars.bg || '#3E2F66').toUpperCase(), alpha: 1 },
          bgSoft: { hex: (vars.bgSoft || '#2A2148').toUpperCase(), alpha: 1 },
          bgLayer: { hex: (vars.bgLayer || '#362A56').toUpperCase(), alpha: 1 },
          colors: {},
        };
        for (const k of Object.keys(vars)) {
          if (['label', 'badge', 'bg', 'bgSoft', 'bgLayer'].includes(k)) continue;
          if (/^#?[0-9a-f]{6}$/i.test(vars[k])) theme.colors[k] = { hex: '#' + vars[k].replace(/^#/, '').toUpperCase(), alpha: 1 };
        }
        jsonText = JSON.stringify(theme, null, 2);
      }
      if (!Object.keys(theme).length) { send(res, 404, JSON.stringify({ ok: false, error: '配色真源缺失: ' + THEME_JSON }), 'application/json'); return; }
      // 兼容前端：按旧结构组装（swatches/comps 由 colors 推导）
      const vars = themeJsonToVars(theme);
      const base = parseSwatchCss('mediascape-dsh-theme', Object.entries(vars).map(([k, v]) => `--swatch-${k}: ${v};`).join('\n'));
      send(res, 200, JSON.stringify({ ok: true, base: Object.assign({}, base, { colors: theme.colors, bg: theme.bg, bgSoft: theme.bgSoft, bgLayer: theme.bgLayer, theme }) }), 'application/json; charset=utf-8');
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
    }
    return;
  }

  // /api/theme-presets → 预设包清单（GET）：列 theme-studio/json/preset/*.json（迁移期兼容 .css），
  // 返回 [{ id, label, badge, swatches }]。预设只承载颜色集合（key:{hex,alpha}）+ 显示名，bg 系不在预设里。
  if (req.method === 'GET' && pathname === '/api/theme-presets') {
    try {
      const presets = [];
      let files = [];
      try { files = readdirSync(PRESET_JSON_DIR).filter((f) => f.endsWith('.json')); } catch { /* 目录不存在 → 空 */ }
      if (!files.length) { try { files = readdirSync(PRESET_DIR).filter((f) => f.endsWith('.css')); } catch { /* 迁移期 css 目录 */ } }
      for (const f of files.sort()) {
        const id = f.replace(/\.(json|css)$/, '');
        if (f.endsWith('.json')) {
          const pj = JSON.parse(readFileSync(join(PRESET_JSON_DIR, f), 'utf8')) || {};
          const swatches = [];
          // 2026-09-26 修：swatches 必须按 key 逐条保留，不能按 hex 去重——多个元素键共用同色
          // （如 docPreview/textDocument/panelBody 都是 #362A56）时，去重会吞掉后面的键 → 右列
          // 按 colorKey 匹配不到 sw → 显示兜底而非预设真实色（"右侧根本没按读取值显示"根因）
          for (const [k, v] of Object.entries(pj.colors || {})) {
            const hex = String(v.hex || '').toUpperCase();
            if (/^#[0-9A-F]{6}$/.test(hex)) swatches.push({ key: k, name: k, hex });
          }
          presets.push({ id, label: pj.label || id, badge: pj.badge || '预设', swatches });
        } else {
          const cssText = readFileSync(join(PRESET_DIR, f), 'utf8');
          const p = parseSwatchCss(id, cssText);
          presets.push({ id, label: p.label, badge: p.badge, swatches: p.swatches });
        }
      }
      send(res, 200, JSON.stringify({ ok: true, presets }), 'application/json; charset=utf-8');
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
    }
    return;
  }

  // /api/theme-rename → 改预设显示名（POST { id, name }）：直接写回 preset/ 该 css 的 --swatch-label
  // （名字随预设文件入库；覆盖可恢复——preset/ 在 git）
  if (req.method === 'POST' && pathname === '/api/theme-rename') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const id = String(body.id || '').replace(/[^\w\u4e00-\u9fa5·-]/g, '');
        const name = String(body.name || '').replace(/[\r\n]/g, '').trim().slice(0, 40);
        if (!id) { send(res, 400, JSON.stringify({ ok: false, error: '缺 id' }), 'application/json'); return; }
        if (!name) { send(res, 400, JSON.stringify({ ok: false, error: '名字不能为空' }), 'application/json'); return; }
        const pj = join(PRESET_JSON_DIR, id + '.json');
        const pc = join(PRESET_DIR, id + '.css');
        if (existsSync(pj)) {
          const j = JSON.parse(readFileSync(pj, 'utf8')) || {};
          j.label = name;
          const tmp = pj + '.tmp';
          writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', 'utf8');
          renameSync(tmp, pj);
          console.log(`[theme-rename] json/preset/${id} → ${name}`);
        } else if (existsSync(pc)) {
          const cssText = readFileSync(pc, 'utf8');
          const next = cssText.replace(/--swatch-label\s*:\s*"[^"]*"/, `--swatch-label: "${name}"`);
          const tmp = pc + '.tmp';
          writeFileSync(tmp, next, 'utf8');
          renameSync(tmp, pc);
          console.log(`[theme-rename] preset/${id} → ${name}`);
        } else {
          send(res, 404, JSON.stringify({ ok: false, error: '预设不存在: ' + id }), 'application/json'); return;
        }
        send(res, 200, JSON.stringify({ ok: true, id, name }), 'application/json');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // /api/capsules → 胶囊配方 + class 目录（GET）：配色网站「宿主元素配色」区数据源。
  // 返回 { rules: theme-studio/capsules.json 的 rules[]，catalog: theme-studio/json/theme-capsules.json 的 entries[] }
  // 两文件缺失/非法 → 对应空数组（页面显示空清单，不崩溃）。
  if (req.method === 'GET' && pathname === '/api/capsules') {
    try {
      let rules = [];
      // 2026-09-23 运行态化：优先读运行态 capsules.json，缺失/非法回退仓库 theme-studio/capsules.json
      try {
        const dshHome = process.env.DSH_HOME || (require('os').homedir ? require('os').homedir() : '');
        const rt = join(dshHome, 'theme-mediascape', 'capsules.json');
        if (existsSync(rt)) {
          rules = (JSON.parse(readFileSync(rt, 'utf8')) || {}).rules || [];
        } else {
          rules = (JSON.parse(readFileSync(join(SCRIPT_DIR, 'capsules.json'), 'utf8')) || {}).rules || [];
        }
      } catch { rules = []; }
      let catalog = [];
      try {
        let catalogPath = join(SCRIPT_DIR, 'json', 'theme-capsules.json');
        if (!existsSync(catalogPath)) catalogPath = join(SCRIPT_DIR, 'class-catalog.json'); // 迁移期兼容旧名
        catalog = (JSON.parse(readFileSync(catalogPath, 'utf8')) || {}).entries || [];
      } catch { catalog = []; }
      send(res, 200, JSON.stringify({ ok: true, rules, catalog }), 'application/json; charset=utf-8');
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
    }
    return;
  }

  // /api/theme-register-element → 自动注册配色区/胶囊区元素（2026-09-2x 定稿自动化）：
  // body: { className, zone:'color'|'capsule', hex?, alpha?, label?, selector?|anchor? }
  // 解析（按「官方宿主元素修改记录.md」键名规范）：className 去 hash 前缀（首个 _ 前为 hash 段）
  //   → 尾缀 = 语义键 key（可传 key 覆盖）；selector 默认 [class*='_<尾缀>']，可传 anchor（data 属性名，
  //   如 data-textpreview-plain）→ [<anchor>]，或 selector 原样覆盖。
  // 配色区：theme-colors.json colors[key]（默认 #362A56 实底）+ theme-register.json 登记 zone=color
  //   → 配色盘元素行自动出现（动态生成 1.0.0）+ 生成器/identity 自动应用（register 注入）→ build 生效。
  // 胶囊区：运行态 capsules.json rules 加 {key, selector, bg.layer, radius, padding, enabled} → build 生效。
  // 幂等：同 key 更新（register/colors/capsules 三处都按 key 覆盖）。
  if (req.method === 'POST' && pathname === '/api/theme-register-element') {
    if (!readDebugConfig().themeSwatch) { send(res, 404, 'theme-swatch 未开启'); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const className = String(body.className || '').trim();
        const zone = body.zone === 'capsule' ? 'capsule' : 'color';
        if (!className || className.length < 3) { send(res, 400, JSON.stringify({ ok: false, error: '缺 className' }), 'application/json'); return; }
        const tail = (className.indexOf('_') >= 0 ? className.slice(className.indexOf('_') + 1) : className).replace(/^_/, '');
        const key = String(body.key || tail || '').trim();
        if (!key) { send(res, 400, JSON.stringify({ ok: false, error: '无法从 className 解析键名，请传 key' }), 'application/json'); return; }
        let selector = String(body.selector || '').trim();
        if (!selector && body.anchor) selector = '[' + String(body.anchor).trim() + ']';
        if (!selector) selector = "[class*='_" + tail + "']";
        const hex = /^#?[0-9a-f]{6}$/i.test(String(body.hex || '')) ? '#' + String(body.hex).replace(/^#/, '').toUpperCase() : '#362A56';
        const alpha = typeof body.alpha === 'number' && body.alpha >= 0 && body.alpha <= 1 ? body.alpha : 1;
        const label = String(body.label || '').trim() || key;
        const writes = [];
        if (zone === 'color') {
          // ① 配色真源 colors 键（前端元素行动态出现的数据源）
          const theme = readThemeJson();
          theme.colors = theme.colors || {};
          theme.colors[key] = { hex, alpha };
          writeThemeJson(theme); writes.push('theme-colors.json colors[' + key + ']');
          // ② theme-register.json 登记（生成器 --dsw-specific-<key> + identity 应用的数据源）
          const regPath = join(SCRIPT_DIR, 'json', 'theme-register.json');
          let reg = { rules: [] };
          try { reg = JSON.parse(readFileSync(regPath, 'utf8')) || { rules: [] }; } catch (e) { /* 首次新建 */ }
          const entry = { key, selector, zone: 'color', label, hex, alpha };
          if (body.anchor) entry.anchor = String(body.anchor);
          const ri = (reg.rules || []).findIndex((r) => r.key === key);
          if (ri >= 0) reg.rules[ri] = entry; else reg.rules.push(entry);
          writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n', 'utf8'); writes.push('theme-register.json');
        } else {
          // 胶囊区：运行态 capsules.json（配色盘胶囊 tab 同源；缺失 → 仓库回退）
          const dshHome = process.env.DSH_HOME || (os.homedir ? os.homedir() : '');
          const rt = join(dshHome, 'theme-mediascape', 'capsules.json');
          const capPath = existsSync(rt) ? rt : join(SCRIPT_DIR, 'capsules.json');
          let cap = { rules: [] };
          try { cap = JSON.parse(readFileSync(capPath, 'utf8')) || { rules: [] }; } catch (e) { cap = { rules: [] }; }
          const entry = { key, selector, desc: label + '（自动注册）', bg: { type: 'layer', alpha }, radius: '12px', padding: '6px 12px', extra: [], extraRules: [], enabled: true };
          const ci = (cap.rules || []).findIndex((r) => r.key === key);
          if (ci >= 0) cap.rules[ci] = entry; else cap.rules.push(entry);
          writeFileSync(capPath, JSON.stringify(cap, null, 2) + '\n', 'utf8'); writes.push('capsules.json');
        }
        // build 生效（预览进程内自测：DSH_THEME_NO_RESTART 跳过重启，产物下次加载生效）
        let buildOut = '';
        try {
          buildOut = execSync(`PATH="/var/packages/DeepSeekHarness-NAS/target/bin:$PATH" DSH_THEME_NO_RESTART=1 node build.cjs`, {
            cwd: THEME_ROOT, encoding: 'utf8', timeout: 120000,
          }).trim().split('\n').filter((l) => /OK:|❌|FAIL/.test(l)).join(' | ');
        } catch (e) { buildOut = 'BUILD_FAIL: ' + (e.stderr || e.message); }
        send(res, 200, JSON.stringify({ ok: true, key, selector, zone, writes, build: buildOut }), 'application/json; charset=utf-8');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // /api/capsules/save → 写回胶囊配方（POST { rules }）：配色网站「宿主元素配色」区保存。
  // 校验：rules 必须是数组、条目必须含 key/selector；只写固定文件 theme-studio/capsules.json
  // （不接收文件名参数，天然防路径穿越）；原子写（tmp+rename），失败不破坏原文件。
  if (req.method === 'POST' && pathname === '/api/capsules/save') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 512 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const rules = body.rules;
        if (!Array.isArray(rules)) { send(res, 400, JSON.stringify({ ok: false, error: 'rules 必须是数组' }), 'application/json'); return; }
        for (const r of rules) {
          if (!r || typeof r.key !== 'string' || typeof r.selector !== 'string') {
            send(res, 400, JSON.stringify({ ok: false, error: '每条规则必须含 key/selector（字符串）' }), 'application/json'); return;
          }
        }
        // 2026-09-23 运行态化：胶囊配方写运行态 $DSH_HOME/theme-mediascape/capsules.json（不写仓库，仓库只回退可读）。
        // 与 build.cjs RUNTIME_CAPSULES / lib/paths.js runtimeCapsulesPath() 同语义。
        const dshHome = process.env.DSH_HOME || (require('os').homedir ? require('os').homedir() : '');
        const file = join(dshHome, 'theme-mediascape', 'capsules.json');
        mkdirSync(join(dshHome, 'theme-mediascape'), { recursive: true });
        let data = { rules: [] };
        try { data = JSON.parse(readFileSync(file, 'utf8') || '{}') || {}; } catch { data = { rules: [] }; }
        data.rules = rules;
        const tmp = file + '.tmp';
        writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
        renameSync(tmp, file);
        // build 生效（与 /api/theme-apply 同模式：跳过 restart，新产物下次启动即生效）
        let buildOut = '';
        try {
          buildOut = execSync(`PATH="/var/packages/DeepSeekHarness-NAS/target/bin:$PATH" DSH_THEME_NO_RESTART=1 node build.cjs`, {
            cwd: THEME_ROOT, encoding: 'utf8', timeout: 120000,
          }).trim();
        } catch (e) { buildOut = 'BUILD_FAIL: ' + (e.stderr || e.message); }
        console.log(`[capsules-save] ${rules.length} 条规则已写回运行态 ${file}`);
        send(res, 200, JSON.stringify({ ok: true, count: rules.length, build: buildOut }), 'application/json');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // /wallpaper/log → 壁纸切换日志（预览环境本地直供，与主实例 handlers.js 同语义：
  // POST 追加一行 / GET 读最近 N 行，落运行态 logs/wallpaper.log）
  if (pathname === '/theme-mediascape-assets/wallpaper/log' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        // 与主实例 handlers.js 同语义：走统一 writeLog（log 总开关 gate + 时间戳 + 1MB 轮转）
        writeLog('wallpaper.log', body);
        send(res, 200, JSON.stringify({ ok: true }), 'application/json');
      } catch (e) { send(res, 400, JSON.stringify({ ok: false, error: e.message }), 'application/json'); }
    });
    return;
  }
  if (pathname === '/theme-mediascape-assets/wallpaper/log' && req.method === 'GET') {
    try {
      const n = Math.max(1, Math.min(parseInt(url.searchParams.get('lines') || '50', 10) || 50, 500));
      const file = join(logsDir(), 'wallpaper.log');
      const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n) : [];
      send(res, 200, JSON.stringify({ ok: true, file: 'wallpaper.log', count: lines.length, lines: lines.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }) }), 'application/json');
    } catch (e) { send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json'); }
    return;
  }

  // /preset/* → 预设包 json（GET 供配色页右侧回读/展示；2026-09-22 由 css 迁移 json）
  if (req.method === 'GET' && pathname.startsWith('/preset/')) {
    const file = normalize(join(SCRIPT_DIR, pathname.replace(/^\/preset\//, 'json/preset/')));
    if (file.startsWith(join(SCRIPT_DIR, 'json', 'preset'))) { serveFile(res, file); return; }
    send(res, 403, 'forbidden'); return;
  }

  // /lib/* → 插件根 lib/（preview.html 里 ../lib/client.js 在 HTTP 下规范化为 /lib/client.js）
  if (pathname.startsWith('/lib/')) {
    const file = normalize(join(THEME_ROOT, pathname.replace(/^\/lib\//, 'lib/')));
    if (file.startsWith(join(THEME_ROOT, 'lib'))) { serveFile(res, file); return; }
    send(res, 403, 'forbidden'); return;
  }

  // /js/* → theme-studio/js/（theme-swatch.html 外部脚本：js/theme-swatch.js）
  if (pathname.startsWith('/js/')) {
    const file = normalize(join(SCRIPT_DIR, pathname.replace(/^\/js\//, 'js/')));
    if (file.startsWith(join(SCRIPT_DIR, 'js'))) { serveFile(res, file); return; }
    send(res, 403, 'forbidden'); return;
  }

  // /samples/* → theme-studio/samples/（2026-09-22：左侧第 5 列「真实元素样子」分片，
  //   可复用单片 html：配色盘按行 fetch 嵌入，外部也可直接引用做展示）
  if (pathname.startsWith('/samples/')) {
    const file = normalize(join(SCRIPT_DIR, pathname.replace(/^\/samples\//, 'samples/')));
    if (file.startsWith(join(SCRIPT_DIR, 'samples')) && file.endsWith('.html')) { serveFile(res, file); return; }
    send(res, 403, 'forbidden'); return;
  }

  // /theme-mediascape-assets/* → 静态素材本地直供（不依赖 DSH 主实例已加载主题）；
  //   仅 list 也本地（读真实数据目录 + labels，重启前即可看用户壁纸）；
  //   upload / DELETE 等写操作才转发真实后端。
  if (pathname.startsWith('/theme-mediascape-assets/')) {
    if (req.method === 'GET' && pathname === '/theme-mediascape-assets/ping') {
      send(res, 200, 'pong', 'text/plain'); return;
    }
    // 壁纸列表：本地实现（与后端 handleList 同结构），主实例不重启也能看到用户上传的壁纸
    if (req.method === 'GET' && pathname === '/theme-mediascape-assets/wallpaper/list') {
      console.log('[local] list', pathname);
      handleListLocal(res);
      return;
    }
    // 音乐列表：本地实现（与后端 handleMusicList 同结构，含自动同步 music.json）
    if (req.method === 'GET' && pathname === '/theme-mediascape-assets/music/list') {
      console.log('[local] music list', pathname);
      handleMusicListLocal(res);
      return;
    }
    // 静态素材（boot/ music/）本地直供（music/ → 真实数据目录）
    if (req.method === 'GET' && /^\/theme-mediascape-assets\/(boot|music)\//.test(pathname)) {
      console.log('[local] asset GET', pathname);
      serveAssetLocal(res, req, pathname);
      return;
    }
    // 用户上传壁纸文件（wallpaper/<file>，非 list）本地直供；
    // 2026-09-23 修：正则加 online/ 子目录——否则 wallpaper/online/<file> 不匹配落 proxy
    // （30800 插件禁用时 404，在线资源图片的缓存 fetch 也失败）
    if (req.method === 'GET' && /^\/theme-mediascape-assets\/wallpaper\/(online\/)?[^/]+$/.test(pathname) && !pathname.endsWith('/list')) {
      console.log('[local] wallpaper GET', pathname);
      serveWallpaperLocal(res, req, pathname);
      return;
    }
    // 2026-09-23：upload / DELETE 本地处理（不转发主实例——30800 插件可能禁用）。
    // 直接调 lib/handlers.js 的 handleUpload/handleDelete，用真实 $DSH_HOME 数据目录。
    if (req.method === 'POST' && rel === 'upload') {
      console.log('[local] upload', pathname);
      handleUpload(req, res);
      return;
    }
    // 2026-09-23 fix：音乐上传/封面上传同样本地处理——此前漏了 music/upload|music/cover 分支，
    // 全走 proxy 转发 30800；30800 插件禁用时 405 → 30999 音乐上传全部失败（实测）。
    if (req.method === 'POST' && rel === 'music/upload') {
      console.log('[local] music upload', pathname);
      handleMusicUpload(req, res);
      return;
    }
    if (req.method === 'POST' && rel === 'music/cover') {
      console.log('[local] music cover', pathname);
      handleCoverUpload(req, res);
      return;
    }
    if (req.method === 'DELETE' && top === 'wallpaper') {
      console.log('[local] DELETE', pathname);
      handleDelete(req, res, rel);
      return;
    }
    // 2026-09-23 补：删除音乐（本地处理，与壁纸删除同模式）。此前音乐无删除 API——
    // 前端删除只走本地 IDB，服务端文件不删；现补真实 API 供删除/删除后重传走链路验证。
    if (req.method === 'DELETE' && top === 'music') {
      console.log('[local] music DELETE', pathname);
      handleMusicDelete(req, res, rel);
      return;
    }
    // 其余（未匹配的写操作）→ 真实后端（兜底）
    const upstreamPath = req.url; // 原样转发（保留 query：?name= 等）
    proxyToDsh(req, res, upstreamPath);
    return;
  }

  // 其余 → 404
  send(res, 404, 'not found');
});

async function openBrowser() {
  if (noOpen || !existsSync(join(SCRIPT_DIR, '..', '..', 'pwviewer', 'node_modules', 'playwright'))) return;
  try {
    const { chromium } = await import('/volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs');
    const CHROME = '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--no-zygote','--single-process','--disable-fontconfig'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);
    const state = await page.evaluate(() => ({
      dock: !!document.querySelector('.mediascape-dsh-dock'),
      buttons: document.querySelector('.mediascape-dsh-dock') ? document.querySelector('.mediascape-dsh-dock').querySelectorAll('button').length : 0,
      style: !!document.querySelector('style[data-mediascape-theme]'),
    }));
    console.log('[shot] 悬浮框渲染:', JSON.stringify(state));
    if (shotPath) await page.screenshot({ path: shotPath });
    await browser.close();
    if (shotPath) console.log('[shot] 截图已存:', shotPath);
  } catch (e) {
    console.log('[shot] playwright 自检跳过（', e.message?.slice(0, 80), '）——真实浏览器打开即可预览');
  }
}

server.listen(PORT, '0.0.0.0', async () => {
  const token = resolveToken();
  // 预览服务启动日志（2026-09-22 加：log 总开关开启时记一条，落 startup.log）
  writeLog('startup.log', { event: 'preview-startup', port: PORT, pid: process.pid ?? null });
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  dsh-theme-mediascape 悬浮框预览（接真实后端）        ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('  预览页:  http://127.0.0.1:' + PORT + '/');
  console.log('  后端:    ' + TARGET + '（upload/DELETE 写操作转发；素材与列表本地直供，不依赖主实例重启）');
  console.log('  token:   ' + (token ? '已自动获取（' + token.slice(0, 8) + '…）' : '⚠ 未找到，上传/列表将不可用（用 --token 指定）'));
  console.log('  数据库:  真实 DSH $DSH_HOME/theme-mediascape/wallpapers/（非独立目录）');
  console.log('  停止: Ctrl+C');
  await openBrowser();
});