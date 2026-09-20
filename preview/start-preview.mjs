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
 *   preview/preview.html 用垫片（__ModuleLoader__ + ctx.theme）直接执行真实
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
import { createReadStream, existsSync, statSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));       // preview/
const THEME_ROOT = normalize(join(SCRIPT_DIR, '..'));             // 插件根

// ── 一键应用配色：从 6 色生成 identity.js 基底段 + tokens.js 完整令牌（旧值注释备份，再写盘）──
// 调用方：对照页「应用为正式基底」→ POST /api/theme-apply { name, colors }
// colors: { skin, hair, eye, white, purple, gold }（hex，#RRGGBB）
function hexToRgbStr(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '0, 0, 0';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
// 生成 identity.js 的 --ff-theme-* 段（返回替换用字符串：从 html{ 到 }）
function buildIdentityBlock(colors) {
  return [
    '"html { color-scheme: dark !important; background: #0a0c12 !important;",',
    '"  /* ── 基底主题变量（壁纸联动皮肤命名空间 --ff-theme-*；值=一键应用配色，动态取色覆盖）── */",',
    `"  /* 一键应用 ${colors._name || ''}：肤色 ${colors.skin} / 发色 ${colors.hair} / 瞳色 ${colors.eye} / 礼服灰白 ${colors.white} / 礼服紫 ${colors.purple} / 点缀金 ${colors.gold} */",`,
    `"  --ff-theme-bg: ${hexToRgbStr(colors.bg || '#0a0c16')};",`,
    `"  --ff-theme-bg-soft: ${hexToRgbStr(colors.bgSoft || '#101020')};",`,
    `"  --ff-theme-bg-layer: ${hexToRgbStr(colors.bgLayer || '#161222')};",`,
    `"  --ff-theme-accent: ${hexToRgbStr(colors.eye)};",`,
    `"  --ff-theme-accent-soft: ${hexToRgbStr(colors.purple)};",`,
    `"  --ff-theme-text: ${hexToRgbStr(colors.skin)};",`,
    `"  --ff-theme-text-dim: ${hexToRgbStr(colors.hair)};",`,
    `"  --ff-theme-border: ${hexToRgbStr(colors.gold)};",`,
    '"}",',
  ].join('\n');
}
// 生成 tokens.js 完整内容（TOKENS 全部由 6 色推导）
function buildTokensContent(colors) {
  const { skin, hair, eye, white, purple, gold } = colors;
  const E = eye, P = purple, G = gold, S = skin, H = hair, W = white;
  const rgba = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const lines = [
    '// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════',
    `// ${colors._name || '自定义'}：肤色 ${S} / 发色 ${H} / 瞳色 ${E} / 礼服灰白 ${W} / 礼服紫 ${P} / 点缀金 ${G}`,
    '// ⚠️ 本文件由「配色对照页 → 应用为正式基底」自动生成，手动修改会被覆盖；留痕见 preview/generated/',
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
    '  "--dsw-alias-bg-mask-1": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.72)) + ',',
    '  "--dsw-alias-bg-mask-2": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.40)) + ',',
    '  "--dsw-alias-bg-mask-drop": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.72)) + ',',
    '',
    '  // 文字：肤色（主）/ 金色（次）/ 发色（三）',
    '  "--dsw-alias-label-primary": ' + JSON.stringify(S) + ',',
    '  "--dsw-alias-label-secondary": ' + JSON.stringify(G) + ',',
    '  "--dsw-alias-label-tertiary": ' + JSON.stringify(H) + ',',
    '  "--dsw-alias-label-caption": ' + JSON.stringify(H) + ',',
    '  "--dsw-alias-label-dimmed": ' + JSON.stringify(rgba(H, 0.55)) + ',',
    '  "--dsw-alias-label-primary-foreground": ' + JSON.stringify('#F5F7FA') + ',',
    '  "--dsw-alias-label-primary-inverted": ' + JSON.stringify('#F5F7FA') + ',',
    '',
    '  // 品牌：瞳色绿（知更鸟之绿）',
    '  "--dsw-alias-brand-primary": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-brand-text": ' + JSON.stringify(E) + ',',
    '  "--dsw-alias-brand-primary-invert": ' + JSON.stringify(W) + ',',
    '',
    '  // 按钮：湛蓝主填充（更深更实，白字对比强；hover 用晴空蓝）',
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
    '  // 交互：瞳色绿（hover/active）',
    '  "--dsw-alias-interactive-bg-hover": ' + JSON.stringify(rgba(E, 0.10)) + ',',
    '  "--dsw-alias-interactive-bg-active": ' + JSON.stringify(rgba(E, 0.18)) + ',',
    '  "--dsw-alias-interactive-bg-hover-accent": ' + JSON.stringify(rgba(E, 0.15)) + ',',
    '  "--dsw-alias-interactive-bg-hover-danger": ' + JSON.stringify(rgba(255, 93, 122, 0.15)) + ',',
    '',
    '  // 边框：点缀金（低透明度）',
    '  "--dsw-alias-border-l1": ' + JSON.stringify(rgba(G, 0.13)) + ',',
    '  "--dsw-alias-border-l2": ' + JSON.stringify(rgba(G, 0.22)) + ',',
    '  "--dsw-alias-border-l2-darkmode-thin": ' + JSON.stringify(rgba(G, 0.10)) + ',',
    '  "--dsw-alias-border-l3": ' + JSON.stringify(rgba(G, 0.25)) + ',',
    '  "--dsw-alias-border-l4": ' + JSON.stringify(rgba(G, 0.38)) + ',',
    '',
    '  // 状态：success=瞳色绿 / error 保留 / warn=点缀金 / business=瞳色绿',
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
    '  "--dsw-alias-markdown-inline-code": ' + JSON.stringify(rgba(G, 0.12)) + ',',
    '  "--dsw-alias-markdown-code-block": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.70)) + ',',
    '  "--dsw-alias-markdown-code-block-banner": ' + JSON.stringify(rgba(G, 0.06)) + ',',
    '  "--dsw-alias-scrollbar-bg-l1": ' + JSON.stringify(rgba(G, 0.15)) + ',',
    '  "--dsw-alias-scrollbar-bg-l2": ' + JSON.stringify(rgba(G, 0.22)) + ',',
    '  "--dsw-alias-scrollbar-hover-l1": ' + JSON.stringify(rgba(G, 0.30)) + ',',
    '  "--dsw-alias-scrollbar-hover-l2": ' + JSON.stringify(rgba(G, 0.42)) + ',',
    '',
    '  // 组件特化：侧栏激活=瞳色绿（与主按钮一致）/ 高亮=金',
    '  "--dsw-specific-sidebar-fill": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.88)) + ',',
    '  "--dsw-specific-sidebar-nav-item-active": ' + JSON.stringify(rgba(E, 0.16)) + ',',
    '  "--dsw-specific-sidebar-nav-item-active-accent": ' + JSON.stringify(E) + ',',
    '  "--dsw-specific-sidebar-nav-item-hover": ' + JSON.stringify(rgba(E, 0.08)) + ',',
    '  "--dsw-specific-bubble": ' + JSON.stringify(rgba('#141022', 0.88)) + ',',
    '  "--dsw-specific-bubble-highlight": ' + JSON.stringify(rgba(G, 0.08)) + ',',
    '  "--dsw-specific-input-major": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.85)) + ',',
    '  "--dsw-specific-menu": ' + JSON.stringify(rgba(colors.bg || '#0a0c16', 0.94)) + ',',
    '  "--dsw-specific-selector": ' + JSON.stringify(rgba(colors.bgSoft || '#101020', 0.90)) + ',',
    '  "--dsw-specific-tip": ' + JSON.stringify(rgba(G, 0.10)) + ',',
    '};',
  ];
  return lines.join('\n');
}

// ── 基底动态读取：解析基底 css（--swatch-* 变量）→ 基底对象 ──
// 读取 preview/bases/*.css（内置）与 preview/generated/*.css（用户导出），下拉不写死。
// css 格式：:root { --swatch-label/badge/bg/bgSoft/bgLayer/skin/hair/eye/white/purple/gold + --swatch-<role> }
function parseSwatchCss(id, cssText) {
  const vars = {};
  for (const m of cssText.matchAll(/--swatch-([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  // 6 色（同 hex 去重，避免循环换色卡在同色）
  const six = ['skin', 'hair', 'eye', 'white', 'purple', 'gold'];
  const swatches = [];
  const sixName = { skin: '肤色', hair: '发色', eye: '瞳色', white: '礼服灰白', purple: '礼服紫', gold: '点缀金' };
  const seenHex = new Set();
  for (const k of six) {
    if (vars[k]) {
      const hex = vars[k].toUpperCase();
      if (!seenHex.has(hex)) { swatches.push({ name: sixName[k], hex }); seenHex.add(hex); }
    }
  }
  // 组件样式：优先 --swatch-<role>，缺省按 6 色映射
  const compText = { 'btn-primary': '主要按钮', 'btn-secondary': '次要按钮', 'chip-active': '激活态', 'text-primary': '主文字 · 知更鸟的歌声', 'text-dim': '次文字', 'text-tertiary': '三级文字', 'gold-glow': '✦ 点缀金色高亮 ✦' };
  const hexToRgba = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const roleStyle = {
    'btn-primary': (h) => `background:${h};color:#101410;border:1px solid rgba(212,175,55,.45)`,
    'btn-secondary': (h) => `background:${hexToRgba(h, 0.2)};color:${h};border:1px solid rgba(212,175,55,.42)`,
    'chip-active': (h) => `background:${hexToRgba(h, 0.14)};color:${h}`,
    'text-primary': (h) => `color:${h}`,
    'text-dim': (h) => `color:${h}`,
    'text-tertiary': (h) => `color:${h}`,
    'gold-glow': (h) => `color:${h};text-shadow:0 0 14px ${hexToRgba(h, 0.55)}`,
  };
  const roleSixKey = { 'btn-primary': 'eye', 'btn-secondary': 'purple', 'chip-active': 'gold', 'text-primary': 'skin', 'text-dim': 'hair', 'text-tertiary': 'hair', 'gold-glow': 'gold' };
  const comps = [];
  for (const role of Object.keys(roleStyle)) {
    const hex = (vars[role] || vars[roleSixKey[role]] || '#888888').toUpperCase();
    comps.push({ role, text: compText[role], style: roleStyle[role](hex) });
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

/** 转发一个浏览器请求到 DSH 真实后端。 */
function proxyToDsh(req, res, upstreamPath) {
  const t0 = Date.now();
  let bodyBytes = 0;
  console.log('[proxy] REQHEAD', req.method, upstreamPath, JSON.stringify(req.headers));
  req.on('data', (c) => { bodyBytes += c.length; });
  ensureAuthCookie().then((cookie) => {
    if (!cookie) {
      console.log(`[proxy] ${req.method} ${upstreamPath} → 502 no-cookie (${Date.now() - t0}ms)`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('preview: 无法认证 DSH 后端（未提供 --token 且 proxy.log 无 token）');
      return;
    }
    const target = new URL(TARGET);
    const headers = { ...req.headers, host: target.host, cookie, connection: 'close' };
    // 流式转发：删除 content-length 让 Node 用 chunked 处理，避免长度不匹配挂起（实测保留会卡死转发）
    delete headers['content-length'];
    console.log('[proxy] FWDHEAD', JSON.stringify(headers));
    const upstream = httpRequest({
      hostname: target.hostname, port: target.port, path: upstreamPath, method: req.method, headers,
    }, (up) => {
      const outHeaders = { ...up.headers };
      delete outHeaders['set-cookie']; // 不把 DSH cookie 回给预览页
      delete outHeaders['content-length'];
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
      up.on('end', () => {
        console.log(`[proxy] ${req.method} ${upstreamPath} → ${up.statusCode} body=${bodyBytes}B ${Date.now() - t0}ms`);
      });
      up.on('close', () => {
        console.log(`[proxy] ${req.method} ${upstreamPath} → CLOSE(no-response?) body=${bodyBytes}B ${Date.now() - t0}ms`);
      });
    });
    upstream.on('error', (e) => {
      console.log(`[proxy] ${req.method} ${upstreamPath} → ERROR ${e.message} body=${bodyBytes}B ${Date.now() - t0}ms`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('preview: 转发 DSH 失败 ' + e.message);
    });
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

// ── 真实数据目录（与 lib/paths.js 同推导：$DSH_HOME/theme-mediascape/wallpaper|music） ──
function themeBase() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}
function wallpaperDir() {
  return join(themeBase(), 'theme-mediascape', 'wallpaper');
}
function musicDir() {
  return join(themeBase(), 'theme-mediascape', 'music');
}
const WALLPAPER_LABELS_FILE = 'wallpaper.json';
const MUSIC_LABELS_FILE = 'music.json';
const ALLOWED_UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4']);

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
    const items = readdirSync(dir)
      .filter((f) => !f.startsWith('.trash-') && f !== WALLPAPER_LABELS_FILE && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
      .map((f) => {
        const ext = extname(f).toLowerCase();
        const id = f.replace(/\.[^.]+$/, '');
        return {
          id,
          kind: ext === '.mp4' ? 'video' : 'image',
          label: labels[id] || f.replace(/\.[^.]+$/, ''),
          url: '/theme-mediascape-assets/wallpaper/' + encodeURIComponent(f),
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    // 合并在线下载资源（与后端 handleList 同语义：同 id 顶层优先）
    const odir = join(dir, 'online');
    if (existsSync(odir)) {
      const ids = new Set(items.map((x) => x.id));
      const online = readdirSync(odir)
        .filter((f) => !f.startsWith('.trash-') && !f.endsWith('.part') && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
        .filter((f) => {
          const id = f.replace(/\.[^.]+$/, '');
          if (ids.has(id)) return false;
          ids.add(id);
          return true;
        })
        .map((f) => {
          const ext = extname(f).toLowerCase();
          const id = f.replace(/\.[^.]+$/, '');
          return {
            id,
            kind: ext === '.mp4' ? 'video' : 'image',
            label: labels[id] || f.replace(/\.[^.]+$/, ''),
            url: '/theme-mediascape-assets/wallpaper/online/' + encodeURIComponent(f),
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
    const audioFiles = files.filter((f) => audioExts.has(extname(f).toLowerCase()) && !f.startsWith('.trash-'));
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

/** 本地服务插件根目录下的静态素材（boot/、music/）。 */
function serveAssetLocal(res, pathname) {
  const rel = pathname.replace(/^\/theme-mediascape-assets\//, '');   // boot/xxx...
  const top = rel.split('/')[0];
  if (top !== 'boot' && top !== 'music') { send(res, 404, 'not found'); return; }
  // music/ → 真实数据目录（音乐本体+封面）；boot/ → 插件根
  const base = top === 'music' ? musicDir() : THEME_ROOT;
  const file = normalize(join(base, top === 'music' ? rel.slice('music/'.length) : rel));
  if (!file.startsWith(normalize(join(base, '')))) { send(res, 403, 'forbidden'); return; }
  serveFile(res, file);
}

/** 本地服务用户上传壁纸（真实数据目录 wallpaper/<file>）与在线资源（wallpaper/online/<file>）。 */
function serveWallpaperLocal(res, pathname) {
  const rel = pathname.replace(/^\/theme-mediascape-assets\/wallpaper\//, '');
  // 允许 顶层文件 或 online/<file>（在线下载资源子目录）；禁止深层穿越/回收/labels
  const isOnline = rel.startsWith('online/');
  const name = isOnline ? rel.slice('online/'.length) : rel;
  if (!name || name.includes('/') || name.startsWith('.trash-') || name === WALLPAPER_LABELS_FILE) { send(res, 404, 'not found'); return; }
  const base = isOnline ? join(wallpaperDir(), 'online') : wallpaperDir();
  const file = normalize(join(base, name));
  if (!file.startsWith(base)) { send(res, 403, 'forbidden'); return; }
  serveFile(res, file);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  // 根 → 预览页
  if (pathname === '/' || pathname === '/index.html') { serveFile(res, join(SCRIPT_DIR, 'preview.html')); return; }

  // 配色对照页（流萤 vs 知更鸟，静态对照用）
  if (pathname === '/theme-swatch.html') { serveFile(res, join(SCRIPT_DIR, 'theme-swatch.html')); return; }

  // 配色导出落盘：POST { name, css } → preview/generated/<name>.css（对照页「导出 CSS」用）
  if (req.method === 'POST' && pathname === '/api/theme-save') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 512 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const name = String(body.name || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
        const css = String(body.css || '');
        if (!name || !css) { send(res, 400, JSON.stringify({ ok: false, error: '缺 name/css' }), 'application/json'); return; }
        const genDir = join(SCRIPT_DIR, 'generated');
        mkdirSync(genDir, { recursive: true });
        const file = join(genDir, name + '.css');
        writeFileSync(file, css, 'utf8');
        console.log(`[theme-save] ${name}.css ${css.length}B`);
        send(res, 200, JSON.stringify({ ok: true, path: file, bytes: css.length }), 'application/json');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // 一键应用配色为正式基底：POST { name, colors } → 生成 identity.js + tokens.js（旧值备份）+ build
  if (req.method === 'POST' && pathname === '/api/theme-apply') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 512 * 1024) { req.destroy(); } });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const name = String(body.name || '配色').replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '').slice(0, 40);
        const colors = Object.assign({}, body.colors || {});
        colors._name = name;
        const req6 = ['skin', 'hair', 'eye', 'white', 'purple', 'gold'];
        for (const k of req6) if (!/^#?[0-9a-f]{6}$/i.test(String(colors[k] || ''))) {
          send(res, 400, JSON.stringify({ ok: false, error: `缺/非法色值 ${k}` }), 'application/json'); return;
        }
        // 备份旧值到 preview/generated/backup-<ts>/（可恢复，不进 git）
        const ts = Date.now();
        const bkDir = join(SCRIPT_DIR, 'generated', 'backup-' + ts);
        mkdirSync(bkDir, { recursive: true });
        const idFile = join(THEME_ROOT, 'lib/client-parts/scenes/identity.js');
        const tkFile = join(THEME_ROOT, 'lib/client-parts/foundation/tokens.js');
        writeFileSync(join(bkDir, 'identity.js'), readFileSync(idFile, 'utf8'), 'utf8');
        writeFileSync(join(bkDir, 'tokens.js'), readFileSync(tkFile, 'utf8'), 'utf8');
        // 写 identity.js：把 html{ ... } 块替换为新块
        let idSrc = readFileSync(idFile, 'utf8');
        idSrc = idSrc.replace(/"html \{ color-scheme[\s\S]*?"\}",/m, () => buildIdentityBlock(colors) + ',');
        writeFileSync(idFile, idSrc, 'utf8');
        // 写 tokens.js：整体替换 TOKENS 块
        let tkSrc = readFileSync(tkFile, 'utf8');
        tkSrc = tkSrc.replace(/const TOKENS = \{[\s\S]*?\};/, () => buildTokensContent(colors));
        writeFileSync(tkFile, tkSrc, 'utf8');
        // build（node 在目标 bin；失败不致命，记录）
        let buildOut = '';
        try {
          buildOut = execSync(`PATH="/var/packages/DeepSeekHarness-NAS/target/bin:$PATH" node build.cjs`, {
            cwd: THEME_ROOT, encoding: 'utf8', timeout: 60000,
          }).trim();
        } catch (e) { buildOut = 'BUILD_FAIL: ' + (e.stderr || e.message); }
        console.log(`[theme-apply] ${name} → identity.js+tokens.js 已改写，备份 ${bkDir}`);
        send(res, 200, JSON.stringify({
          ok: true, name, backup: bkDir, build: buildOut,
          identity: idSrc.length, tokens: tkSrc.length,
        }), 'application/json');
      } catch (e) {
        send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
      }
    });
    return;
  }

  // /api/theme-bases → 基底清单（GET，动态读取 bases/ + generated/ 的 css，下拉不写死）
  if (req.method === 'GET' && pathname === '/api/theme-bases') {
    try {
      const bases = [];
      const dirs = ['bases', 'generated'];
      for (const d of dirs) {
        const dir = join(SCRIPT_DIR, d);
        let files = [];
        try { files = readdirSync(dir).filter((f) => f.endsWith('.css')); } catch { /* 目录不存在跳过 */ }
        for (const f of files.sort()) {
          const cssText = readFileSync(join(dir, f), 'utf8');
          const id = f.replace(/\.css$/, '');
          bases.push(parseSwatchCss(id, cssText));
        }
      }
      send(res, 200, JSON.stringify({ ok: true, bases }), 'application/json; charset=utf-8');
    } catch (e) {
      send(res, 500, JSON.stringify({ ok: false, error: e.message }), 'application/json');
    }
    return;
  }

  // /generated/* → 导出的配色 CSS（GET 供对照页回读/展示）
  if (req.method === 'GET' && pathname.startsWith('/generated/')) {
    const file = normalize(join(SCRIPT_DIR, pathname.replace(/^\/generated\//, 'generated/')));
    if (file.startsWith(join(SCRIPT_DIR, 'generated'))) { serveFile(res, file); return; }
    send(res, 403, 'forbidden'); return;
  }

  // /lib/* → 插件根 lib/（preview.html 里 ../lib/client.js 在 HTTP 下规范化为 /lib/client.js）
  if (pathname.startsWith('/lib/')) {
    const file = normalize(join(THEME_ROOT, pathname.replace(/^\/lib\//, 'lib/')));
    if (file.startsWith(join(THEME_ROOT, 'lib'))) { serveFile(res, file); return; }
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
      serveAssetLocal(res, pathname);
      return;
    }
    // 用户上传壁纸文件（wallpaper/<file>，非 list）本地直供
    if (req.method === 'GET' && /^\/theme-mediascape-assets\/wallpaper\/[^/]+$/.test(pathname) && !pathname.endsWith('/list')) {
      console.log('[local] wallpaper GET', pathname);
      serveWallpaperLocal(res, pathname);
      return;
    }
    // 其余（upload / DELETE 等写操作）→ 真实后端
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
      dock: !!document.querySelector('.ff-dock'),
      buttons: document.querySelector('.ff-dock') ? document.querySelector('.ff-dock').querySelectorAll('button').length : 0,
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