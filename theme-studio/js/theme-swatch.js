"use strict";
// ═══════════ V2 状态：单 css 真源 + 预设包 ═══════════
// 左侧 = 当前主题（/api/theme-current 读真源 css）→ 元素 class 控件列表（comps 13 角色，每行 hex 可改+点击循环）
// 右侧 = 预设包（/api/theme-presets 列 preset/）→ 应用把预设色套到左侧；改名/导出只作用预设包
// 左侧「应用」= 真正写入真源 css（POST /api/theme-apply { css }）→ build
let THEME = null;        // 真源基底对象（含 label/badge/bg 系/swatches/comps/css 原文）
let PRESETS = [];        // 预设包数组 [{ id, label, badge, swatches }]
let ROLECOLOR = {};      // 左侧元素改色记录 { role: hex }（未改的从 comp.style 提取）
let ROLEALPHA = {};      // 左侧元素不透明度记录 { role: 0.1~1 }（第 6 列滑块，第 5 列真实元素样子即时生效；默认 1）
let RIGHTCOLOR = {};     // 右侧调色盘改色记录 { role: hex }（点「应用」才套到左侧，不落盘）
const state = { pick: "" };  // 右侧选中的预设 id

const $ = (id) => document.getElementById(id);

// ═══════════ 工具 ═══════════
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function textColorFor(hex) {
  const c = hexToRgb(hex); if (!c) return "#ffffff";
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return lum > 150 ? "#1a1420" : "#fdf0fa";
}
function hexOf(styleString) {
  const m = /#([0-9a-fA-F]{6})/i.exec(styleString || "");
  return m ? m[1].toUpperCase() : "";
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1800);
}
// 颜色池 = 真源 swatches + 全部预设 swatches（hex 去重，供点击循环/底色下拉用）
function colorPool() {
  const seen = new Set(); const pool = [];
  for (const s of ((THEME && THEME.swatches) || [])) {
    const h = String(s.hex).toUpperCase();
    if (!seen.has(h)) { seen.add(h); pool.push(s); }
  }
  for (const p of (PRESETS || [])) for (const s of (p.swatches || [])) {
    const h = String(s.hex).toUpperCase();
    if (!seen.has(h)) { seen.add(h); pool.push(s); }
  }
  return pool;
}

// ═══════════ 加载数据 ═══════════
async function loadTheme() {
  try {
    const resp = await fetch('/api/theme-current');
    const j = await resp.json();
    THEME = j.base || null;
    ROLECOLOR = {}; ROLEALPHA = {}; RIGHTCOLOR = {};
  } catch (e) { THEME = null; }
  return THEME;
}
async function loadPresets() {
  try {
    const resp = await fetch('/api/theme-presets');
    const j = await resp.json();
    PRESETS = j.presets || [];
  } catch (e) { PRESETS = []; }
  if (!state.pick || !PRESETS.some((p) => p.id === state.pick)) state.pick = PRESETS[0] ? PRESETS[0].id : "";
  renderPresets();
  return PRESETS;
}

// ═══════════ 左侧/右侧：元素 class 控件列表（左右 5 列逐行对齐，2026-09-22 重构）═══════════
// 左侧 5 列 = 元素名 / 类键 / 色号 / 色块 / 真实元素样子（samples/<key>.html 单片 iframe，只读展示）
// 右侧 5 列 = 元素名 / 类键 / 颜色选择器（原生取色器自由选色）/ 色块 / 应用按钮（调 /api/theme-apply items 集合）
// 右侧不是全部都有：与左侧逐行对齐，右无则空白列（.r-empty 占位保对齐）。
// 元素当前色：手改/套色记录(ROLECOLOR-by-role) 优先 → 否则服务端真源解析的元素键 hex（c.hex，键=元素 class）。
function compCurrentHex(c) {
  if (ROLECOLOR[c.role]) return ROLECOLOR[c.role];
  return /^#?[0-9a-fA-F]{6}$/.test(String(c.hex || "")) ? ("#" + c.hex.replace(/^#/, "")).toUpperCase() : "#888888";
}
// samples 分片缓存 { key: html }（theme-studio/samples/<key>.html 可复用单片，2026-09-22 起左列第 5 列嵌入）
const SAMPLE_CACHE = {};
async function loadSample(key) {
  if (SAMPLE_CACHE[key] !== undefined) return SAMPLE_CACHE[key];
  try {
    const r = await fetch('/samples/' + key + '.html');
    SAMPLE_CACHE[key] = r.ok ? await r.text() : "";
  } catch (e) { SAMPLE_CACHE[key] = ""; }
  return SAMPLE_CACHE[key];
}
// ── 2026-09-2x 元素行动态生成（定稿）：行来源 = theme-colors.json colors 键全量（动态真源）──
// comps.json（后端 base.comps）只对已知键提供中文名/模板覆盖；未知新键自动派生（text=键名、
// kind 按键名关键词推断）——以后加配色键只改 theme-colors.json 一处，前端自动出现元素行。
// THEME 运行时才加载 → 每次调用现构建映射（17 条量级无性能问题）。
const KIND_IF = [
  ['sidebar', 'sidebar'], ['panel', 'panel'], ['capsule', 'capsule'], ['dock', 'dock'],
  ['chip', 'chip'], ['queue', 'panel-top'], ['status', 'status'], ['text', 'text'], ['btn', 'solid'],
];
const kindFor = (k) => { const hit = KIND_IF.find(([w]) => k.includes(w)); return hit ? hit[1] : 'panel'; };
const roleRow = (role) => {
  const m = ((THEME && THEME.comps) || []).reduce((mm, c) => (mm[c.role] = c, mm), {});
  const found = m[role];
  if (found) return found;
  // 2026-09-26 修：colors 键无对应 comps 条目（API 自动注册的元素如 docPreview）时，
  // 兜底对象必须带 hex（从 THEME.colors 取）——否则 c.hex 缺失 → 左格/保存一律 #888888 兜底
  const col = ((THEME && THEME.colors) || {})[role] || {};
  return { role, text: role, kind: kindFor(role), colorKey: role, hex: col.hex || "" };
};
const roleRows = () => Object.keys((THEME && THEME.colors) || {}).map((k) => roleRow(k));
// 单元素应用：POST /api/theme-apply { items:[{key,hex}] }（服务端以真源 css 为底逐键替换）
// alpha 可选：0~1 时把 hex 转 rgba(r,g,b,a) 写入（左侧第 6 列不透明度滑块，2026-09-22）
// ═══ 背景层级区块（bg → bgSoft → bgLayer；2026-09-22 json 化新增）═══
// 每层显示 {hex, alpha}；hex 可改（改 bg 系 → dock/面板/胶囊 layer 跟随层联动）；alpha 显示 json 现值；
// 左侧「应用」才写盘（serializeThemeJson 已含 bg 系 hex+alpha）。
function renderBgLayers() {
  const el = $("bgLayerPanel");
  if (!el) return;
  if (!THEME) { el.innerHTML = ""; return; }
  const layers = [
    { key: "bg", name: "背景底色", lv: 1, fol: "默认基底（最底层）" },
    { key: "bgSoft", name: "次层底色", lv: 2, fol: "bg 上一档（次层）" },
    { key: "bgLayer", name: "层底色", lv: 3, fol: "dock/面板/胶囊 layer 跟随（layer 型）" },
  ];
  const rows = layers.map((L) => {
    const cur = THEME[L.key] || {};
    const hex = ROLECOLOR[L.key] || cur.hex || "#0a0c16";
    const alpha = ROLEALPHA[L.key] !== undefined ? ROLEALPHA[L.key] : (cur.alpha !== undefined ? cur.alpha : 1);
    const tc = textColorFor(hex);
    return `<div class="bg-row lv${L.lv}" data-key="${L.key}">
      <span class="lbl">${L.name}</span>
      <span class="ckey">${L.key}</span>
      <input class="hex-in" value="${hex}" title="背景 ${L.key}（# 可省略）；左侧「应用」才写盘">
      <span class="chip2" style="background:${hex};border-color:${tc}"></span>
      <span class="alpha-tag">α ${alpha}</span>
      <span class="fol">${L.fol}</span>
    </div>`;
  }).join("");
  el.innerHTML = `<details class="bg-panel" open><summary>背景层级（bg → bgSoft → bgLayer）<span class="hint">改 bg 系 → 所有 layer 跟随层联动（dock/面板/胶囊）；左侧「应用」才写盘</span></summary>${rows}</details>`;
  // hex 手改 → ROLECOLOR 记录（不落盘）
  for (const row of el.querySelectorAll(".bg-row")) {
    const key = row.dataset.key;
    const inp = row.querySelector(".hex-in");
    inp.addEventListener("change", () => {
      const hex = inp.value.trim().replace(/^#/, "");
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) { toast("✗ 非法 hex: " + inp.value); inp.value = ROLECOLOR[key] || ""; return; }
      ROLECOLOR[key] = "#" + hex.toUpperCase();
      renderBgLayers();
      toast(`🎨 背景 ${key} → #${hex.toUpperCase()}（左侧「应用」才写盘）`);
    });
  }
}

async function applyItem(key, hex, alpha) {
  let value = hex;
  if (typeof alpha === "number" && alpha < 1) {
    const c = hexToRgb(hex);
    value = c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})` : hex;
  }
  try {
    const resp = await fetch('/api/theme-apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ key, hex: value }] }),
    });
    const j = await resp.json();
    if (!j.ok) { toast(`✗ ${j.error || "应用失败"}`); return false; }
    toast(`✅ ${key} → ${value} 已写入真源（build ${(j.build || "").includes("OK") ? "通过" : "见日志"}）`);
    return true;
  } catch (err) { toast(`✗ ${err.message}`); return false; }
}
async function renderLeft() {
  const list = $("pairList");
  if (!THEME) { list.innerHTML = ""; $("bgLayerPanel").innerHTML = ""; $("curLabel").textContent = "加载失败"; $("note").innerHTML = "⚠️ /api/theme-current 无返回，请检查预览服务器"; return; }
  $("curLabel").textContent = THEME.label;
  $("curBadge").textContent = THEME.badge || "当前主题";
  renderBgLayers();  // 背景层级区块（bg→bgSoft→bgLayer）
  // 预取全部 samples（并行），保证 iframe 有内容（role 即元素类键，对应 samples/<role>.html）
  await Promise.all(roleRows().map((c) => loadSample(c.role)));
  // 每行 comp-pair = 左格（当前主题元素控件）+ 右格（同元素预设包色），左右按第二列类键（role）完全对齐
  // 左侧 6 列：元素名/类键/色号/色块/真实元素样子/不透明度滑块；右侧 5 列：元素名/类键/调色盘/色块/应用按钮
  const rows = roleRows().map((c) => {
    const hex = compCurrentHex(c);
    const tc = textColorFor(hex);
    const alpha = ROLEALPHA[c.role] !== undefined
      ? ROLEALPHA[c.role]
      : (((THEME.colors || {})[c.role] || {}).alpha !== undefined ? (THEME.colors[c.role].alpha) : 1);
    const sampleHtml = SAMPLE_CACHE[c.role] || "";
    // ── 左格：当前主题（真源 css）元素控件 ──
    const leftCell = `<div class="comp-row" data-role="${c.role}">
      <span class="lbl" title="${c.role}">${c.text}</span>
      <span class="ckey">${c.colorKey || "—"}</span>
      <input class="hex-in" value="${hex}" title="手输 hex（# 可省略）；左侧「应用」才写盘">
      <span class="chip2" style="background:${hex};border-color:${tc}"></span>
      <span class="sample" style="opacity:${alpha}">${sampleHtml ? `<iframe class="samp-iframe" title="${c.role} 真实元素样子" data-role="${c.role}"></iframe>` : `<span class="no-samp">（无分片 ${c.role}）</span>`}</span>
      <span class="alpha-box" title="不透明度：第 5 列真实元素样子即时预览">
        <input type="range" class="alpha-sl" min="0.1" max="1" step="0.05" value="${alpha}">
        <b class="alpha-val">${alpha}</b>
      </span>
    </div>`;
    // ── 右格：当前选中预设包的实际颜色（preset swatches 按 key 匹配 colorKey）；无键 → 无色透明行 ──
    const p = PRESETS.find((x) => x.id === state.pick);
    const sw = p && (p.swatches || []).find((s) => s.key === c.colorKey);
    let rightCell;
    if (!sw) {
      // 预设包没有该元素键 → 为空（无默认色，透明）；支持调色（2026-09-26 定稿：
      // 右列未定义元素可调色，调色后显色；RIGHTCOLOR 记录；保存预设自动并入；「← 应用」套到左侧）
      const hasRight = !!RIGHTCOLOR[c.role];
      const rhex = hasRight ? RIGHTCOLOR[c.role].toUpperCase() : "";
      const rtc = textColorFor(rhex || "#000000");
      rightCell = `<div class="comp-row" data-role="${c.role}" title="预设包未定义该键——为空，可调色后显示；保存预设自动并入">
        <span class="lbl" title="${c.role}">${c.text}</span>
        <span class="ckey">${c.colorKey || "—"}</span>
        <input class="pick-col" data-jscolor='{"format":"hex","position":"right","previewPosition":"bottom","required":false}' value="${rhex}" title="jscolor 调色盘：自由选色；「← 应用」套到左侧；保存预设自动并入">
        <span class="chip2" style="background:${hasRight ? rhex : "transparent"};border-color:${hasRight ? rtc : "rgba(255,255,255,.08)"}"></span>
        <button class="btn-app" data-role="${c.role}">← 应用</button>
      </div>`;
    } else {
      // 右侧值：调色盘改过（RIGHTCOLOR）优先 → 否则预设包实际色
      const rhex = (RIGHTCOLOR[c.role] || sw.hex).toUpperCase();
      const rtc = textColorFor(rhex);
      rightCell = `<div class="comp-row" data-role="${c.role}">
        <span class="lbl" title="${c.role}">${c.text}</span>
        <span class="ckey">${c.colorKey || "—"}</span>
        <input class="pick-col" data-jscolor='{"format":"hex","position":"right","previewPosition":"bottom"}' value="${rhex}" title="jscolor 调色盘：自由选色；「← 应用」套到左侧该元素（不落盘）">
        <span class="chip2" style="background:${rhex};border-color:${rtc}"></span>
        <button class="btn-app" data-role="${c.role}">← 应用</button>
      </div>`;
    }
    return `<div class="comp-pair" data-role="${c.role}">${leftCell}${rightCell}</div>`;
  }).join("");
  list.innerHTML = rows;
  // jscolor 调色盘（2026-09-26 换用 GitHub EastDesire/jscolor 库）：显式 new 逐元素安装——
  // 不用 jscolor.init()：init 有 initialized 门（DOMContentLoaded 首扫后不再重扫动态行），
  // 动态渲染的行只有显式 new 才装得上（已装 el.jscolor 存在则跳过，重渲染安全）。
  if (window.jscolor) {
    list.querySelectorAll(".pick-col").forEach((el) => {
      if (el.disabled || el.jscolor) return;
      try { new window.jscolor(el, { format: "hex", position: "right", previewPosition: "bottom", required: false }); }
      catch (e) { /* 单元素安装失败不崩页面（控制台可见） */ }
    });
  }
  // 事件绑定（按 pair 逐行）：
  for (const pair of list.querySelectorAll(".comp-pair")) {
    const role = pair.dataset.role;
    const c = roleRow(role); // 动态行也覆盖（未知新键同样可编辑 hex/alpha）
    const leftRow = pair.querySelector(".comp-row");
    const rightRow = pair.querySelectorAll(".comp-row")[1];
    // 左格色号手输（改 ROLECOLOR，同步刷新；左侧「应用」才写盘）
    const inp = leftRow.querySelector(".hex-in");
    inp.addEventListener("change", () => {
      const hex = inp.value.trim().replace(/^#/, "");
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) { toast("✗ 非法 hex: " + inp.value); inp.value = compCurrentHex(c); return; }
      ROLECOLOR[c.role] = "#" + hex.toUpperCase();
      renderLeft();
      toast(`🎨 ${c.text} → #${hex.toUpperCase()}（左侧「应用」才写盘）`);
    });
    // 左格第 5 列真实元素样子：动态赋 srcdoc（HTML 属性内嵌引号会截断 → 用 JS 属性赋值，引号/转义安全）
    const sampFrame = leftRow.querySelector(".samp-iframe");
    if (sampFrame) {
      sampFrame.srcdoc = `<style>:root{--sw:${compCurrentHex(c)}}</style>${SAMPLE_CACHE[c.role] || ""}`;
    }
    // 左格第 6 列不透明度滑块 → 第 5 列真实元素样子即时生效
    const sl = leftRow.querySelector(".alpha-sl");
    if (sl) {
      sl.addEventListener("input", () => {
        const a = parseFloat(sl.value);
        ROLEALPHA[c.role] = a;
        const samp = leftRow.querySelector(".sample");
        if (samp) samp.style.opacity = String(a);
        leftRow.querySelector(".alpha-val").textContent = a;
      });
    }
    // 右格调色盘：改色 → 只更新 RIGHTCOLOR 与右格色块（不落盘）
    // 2026-09-26 定稿：点 input 呼不出 → 改为「第 4 列色块点击呼出 jscolor 调色盘」
    const pick = rightRow.querySelector(".pick-col");
    if (pick && !pick.disabled) {
      pick.addEventListener("input", () => {
        RIGHTCOLOR[c.role] = pick.value.toUpperCase();
        const chip = rightRow.querySelector(".chip2");
        if (chip) { chip.style.background = pick.value; chip.style.borderColor = textColorFor(pick.value); }
        toast(`🎨 ${c.text} 右列 → ${pick.value.toUpperCase()}（点「应用」套到左侧）`);
      });
      // 第 4 列色块点击 → 呼出 jscolor（实例挂 input.jscolor；未装则模拟点击 input 兜底）
      const chipEl = rightRow.querySelector(".chip2");
      if (chipEl) {
        chipEl.style.cursor = "pointer";
        chipEl.title = "点击呼出调色盘";
        chipEl.addEventListener("click", () => {
          const inst = pick.jscolor;
          if (inst && typeof inst.show === "function") inst.show();
          else pick.click();
        });
      }
    }
    // 右格「应用」按钮：把右侧当前色（调色盘改过值优先 → 否则预设色）套到左侧该元素（不落盘）
    const btn = rightRow.querySelector(".btn-app");
    if (btn && !btn.disabled) {
      btn.addEventListener("click", () => {
        const p = PRESETS.find((x) => x.id === state.pick);
        const sw = p && (p.swatches || []).find((s) => s.key === c.colorKey);
        const applyHex = (RIGHTCOLOR[c.role] || (sw && sw.hex) || compCurrentHex(c)).toUpperCase();
        ROLECOLOR[c.role] = applyHex;
        toast(`➡ ${c.text} → ${applyHex}（左侧「应用」才写盘）`);
        renderLeft();
      });
    }
  }
}

// 点击元素换色（单项应用语义）：右侧选中预设时 → 严格应用该预设对应键（colorKey）的颜色（部分应用/混搭），
// 预设未定义该键 → 提示不改色（不悄悄换成循环色）；右侧未选中预设 → 退回颜色池循环（真源+全预设色聚合）。
function cycleRoleColor(c, row) {
  const preset = PRESETS.find((x) => x.id === state.pick);
  if (preset) {
    const sw = (preset.swatches || []).find((s) => s.key === c.colorKey);
    if (sw) {
      setRoleColor(c, sw.hex, row);
      toast(`➡ 预设「${preset.label}」${sw.name} ${sw.hex} → ${c.text}`);
      return;
    }
    // 预设缺该元素的 colorKey（预设只承载部分键）→ 不改色，告知
    toast(`✗ 预设「${preset.label}」未定义元素「${c.text}」的键 ${c.colorKey}（改右侧预设或手输 hex）`);
    return;
  }
  const pool = colorPool();
  if (!pool.length) return;
  const cur = compCurrentHex(c);
  let idx = pool.findIndex((s) => s.hex.toUpperCase() === cur);
  idx = (idx + 1) % pool.length;
  setRoleColor(c, pool[idx].hex, row);
  toast(`${pool[idx].name} ${pool[idx].hex} → ${c.text}`);
}
// 设置某角色颜色：替换 comp.style 中 background/color 色值（背景类+对比文字色；文字类换 color）
function setRoleColor(c, hex, row) {
  const tc = textColorFor(hex);
  let style = c.style || "";
  if (/background:/.test(style)) {
    style = style.replace(/background:[^;]+;?/, `background:${hex};`);
    if (/color:#[0-9a-fA-F]{6}/.test(style)) style = style.replace(/color:#[0-9a-fA-F]{6}/, `color:${tc}`);
  } else {
    style = style.replace(/color:#[0-9a-fA-F]{6}/, `color:${hex}`);
  }
  ROLECOLOR[c.role] = hex;
  c.style = style;
  renderLeft();
}

// ═══════════ 序列化：当前左列 → 完整真源 css 文本（以 THEME.css 原文为底，逐键替换色值） ═══════════
// 序列化：当前左列 → items 集合（{key, hex, alpha}），POST /api/theme-apply 写入 theme-colors.json
// 2026-09-22 json 化：不再序列化 css 文本；bg 系（bg/bgSoft/bgLayer）+ colors 全键，alpha 从 ROLEALPHA 读。
function serializeThemeJson() {
  if (!THEME) return [];
  const items = [];
  const push = (key, hex, alpha) => {
    if (!/^#[0-9A-F]{6}$/.test(String(hex || ''))) return;
    items.push({ key, hex, alpha: (alpha >= 0 && alpha <= 1) ? alpha : 1 });
  };
  // bg 系（若用户改过 bg 系区块 → ROLECOLOR 里有，否则保持 json 现有 alpha）
  for (const bk of ['bg', 'bgSoft', 'bgLayer']) {
    const cur = THEME[bk] || {};
    const hex = ROLECOLOR[bk] || cur.hex || '';
    const alpha = ROLEALPHA[bk] !== undefined ? ROLEALPHA[bk] : (cur.alpha !== undefined ? cur.alpha : 1);
    push(bk, hex, alpha);
  }
  // colors 全键（角色改过 → ROLECOLOR/ROLEALPHA，否则 json 现值）；动态行同源（roleRows = colors 键全量）
  for (const c of roleRows()) {
    const role = c.role;
    const cur = (THEME.colors || {})[role] || {};
    const hex = compCurrentHex(c) || cur.hex || '';
    const alpha = ROLEALPHA[role] !== undefined ? ROLEALPHA[role] : (cur.alpha !== undefined ? cur.alpha : 1);
    push(role, hex, alpha);
  }
  return items;
}
// 左侧「应用」：真正写入真源 css → build
async function applyLeft() {
  const btn = $("btnApplyL");
  const items = serializeThemeJson();
  if (!items.length) { toast("✗ 无真源数据"); return; }
  btn.disabled = true; btn.textContent = "应用中…";
  try {
    const resp = await fetch('/api/theme-apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const j = await resp.json();
    toast(j.ok ? `✅ 已写入 theme-colors.json（${items.length} 键，含不透明度），build: ${(j.build || "").includes("OK") ? "通过" : "见日志"}` : `✗ ${j.error || "应用失败"}`);
    if (!j.ok) console.error("apply 失败:", j);
    else await loadTheme(); // 重新读真源（label 可能变化）
  } catch (err) { toast(`✗ ${err.message}`); }
  btn.disabled = false; btn.textContent = "⬇ 应用（真正写入）";
}
// 左侧「重置」：撤销右侧套色/手改/alpha，重新读真源 css 原值
async function resetLeft() {
  ROLECOLOR = {};
  ROLEALPHA = {};
  await loadTheme();
  renderLeft();
  toast("↺ 已还原为真源 css 颜色");
}

// ═══════════ 右侧：预设包 ═══════════
// 右侧列 = 当前选中预设包的实际颜色展示（按 preset swatches 的 key 匹配元素 colorKey）：
// 每行显示该预设的色值 + 色块 + 应用按钮（套到左侧该元素，不落盘）；预设未定义该键 → 无色透明行。
function renderPresets() {
  const sel = $("pickPreset");
  if (sel) {
    sel.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
    sel.value = state.pick;
  }
  renderLeft();
}
// 右侧「应用预设」：把选中预设的颜色值套到左侧（预设 swatches 按 key 匹配 comps.colorKey）
async function usePreset() {
  const p = PRESETS.find((x) => x.id === state.pick);
  if (!p || !THEME) { toast("✗ 无预设/无真源"); return; }
  const swByKey = {};
  for (const s of (p.swatches || [])) swByKey[s.key] = s.hex.toUpperCase();
  let applied = 0;
  for (const c of roleRows()) {
    if (!c.colorKey || !swByKey[c.colorKey]) continue;
    if (compCurrentHex(c).toUpperCase() === swByKey[c.colorKey]) continue;
    setRoleColor(c, swByKey[c.colorKey]);
    applied++;
  }
  renderLeft();
  toast(applied ? `➡ 已把预设「${p.label}」套到左侧（更新 ${applied} 个元素）` : `预设「${p.label}」与左侧元素无交集（未改动）`);
}
// 右侧「导出」：左列当前配色 → 存为新预设包
async function exportPreset() {
  const btn = $("btnExportP");
  const items = serializeThemeJson();
  if (!items.length) { toast("✗ 无真源数据"); return; }
  const defaultName = (THEME.label || "预设").replace(/[^a-zA-Z0-9\u4e00-\u9fa5·_-]/g, '').slice(0, 30) || "新预设";
  const want = (prompt(`把左侧当前配色存为新预设（bg 系不入预设，背景统一来自真源；含各元素不透明度）：`, defaultName) || "").trim()
    .replace(/[^\w\u4e00-\u9fa5·-]/g, '_').slice(0, 40);
  if (!want) { return; }
  btn.disabled = true;
  try {
    // 序列化成 json 文本（服务端 parseSwatchVarsCombo 识别 { 开头 → json 解析，保留 alpha）
    const colors = {};
    for (const it of items) { if (['bg', 'bgSoft', 'bgLayer'].includes(it.key)) continue; colors[it.key] = { hex: it.hex, alpha: it.alpha }; }
    // 2026-09-26 右列调过色/导入的元素自动并入预设（原未定义元素也随右侧编辑进预设）
    // ⚠️ hex 必须带 # 前缀（服务端 theme-export 只接受带 # 的 hex，无 # 会被丢弃导致键缺失）
    for (const [k, hex] of Object.entries(RIGHTCOLOR)) {
      if (['bg', 'bgSoft', 'bgLayer'].includes(k) || !/^#?[0-9a-f]{6}$/i.test(String(hex))) continue;
      const h = String(hex).toUpperCase();
      colors[k] = { hex: h.startsWith('#') ? h : '#' + h, alpha: 1 };
    }
    const css = JSON.stringify({ label: want, colors });
    const resp = await fetch('/api/theme-export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: want, css }),
    });
    const j = await resp.json();
    if (!j.ok) { toast(`✗ ${j.error || "导出失败"}`); return; }
    await loadPresets();
    state.pick = want;
    renderPresets();
    toast(`✅ 已导出预设「${want}」`);
  } catch (err) { toast(`✗ ${err.message}`); }
  btn.disabled = false;
}
// 右侧「改名」：改选中预设的显示名（写回 preset/ 该 css 的 --swatch-label）
async function renamePreset() {
  const p = PRESETS.find((x) => x.id === state.pick);
  if (!p) { toast("✗ 无预设可选"); return; }
  const name = (prompt(`给预设「${p.label}」起个新名字：`, p.label) || "").trim().slice(0, 40);
  if (!name || name === p.label) { if (name === p.label) toast("名字未变化"); return; }
  try {
    const resp = await fetch('/api/theme-rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, name }),
    });
    const j = await resp.json();
    if (!j.ok) { toast(`✗ ${j.error || "改名失败"}`); return; }
    await loadPresets();
    toast(`✅ 预设已改名：${p.label} → ${name}`);
  } catch (err) { toast(`✗ ${err.message}`); }
}

// ═══════════ Tab 切换 ═══════════
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".tab-page").forEach((pg) => pg.classList.toggle("active", pg.id === "tab-" + tab));
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
// ── 2026-09-2x 新增元素自动注册（定稿）：输入宿主 className → POST /api/theme-register-element ──
// 后端自动解析（去 hash 前缀取语义键 + 推导选择器，可传稳定锚点）→ 颜色区写 colors+register、
// 胶囊区写 capsules.json → build；成功自动刷新两区并切到对应 tab。
function bindRegisterElement() {
  const btn = $("btnReg");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const className = $("regClassName").value.trim();
    if (!className) { toast("✗ 请输入 className"); return; }
    const body = { className, zone: $("regZone").value };
    const hex = $("regHex").value.trim(); if (hex) body.hex = hex;
    const a = parseFloat($("regAlpha").value); if (!isNaN(a)) body.alpha = a;
    const anchor = $("regAnchor").value.trim(); if (anchor) body.anchor = anchor;
    try {
      const r = await fetch("/api/theme-register-element", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { toast("✗ " + (d.error || "注册失败")); return; }
      toast(`✅ 已注册 ${d.key}（${d.zone === "capsule" ? "胶囊区" : "颜色区"}）选择器 ${d.selector}${d.build && d.build.includes("FAIL") ? "，build 失败见预览日志" : "，已 build"}`);
      await Promise.all([loadTheme(), loadPresets()]);
      renderLeft();
      renderCapsules();
      switchTab(d.zone === "capsule" ? "capsule" : "palette");
    } catch (e) { toast("✗ " + (e.message || e)); }
  });
}
bindRegisterElement();

// ═══════════ 第三块：宿主元素配色编辑区（胶囊配方）——独立保留，V2 不动 ═══════════
let CAPSULES = [];
let CAPSULE_CATALOG = [];
function capsuleDescFor(key) {
  const e = (CAPSULE_CATALOG || []).find((x) => x.capsule === key);
  return e ? `<span class="cr-desc">${e.host} —— ${e.desc}</span>` : "";
}
// 底色源下拉三类选项（V2：颜色集合 = 真源 swatches + 全部预设 swatches 聚合去重）
function capsuleBgOptions(bg) {
  const type = (bg && bg.type) || "layer";
  const pool = colorPool();
  let curSwatch = "";
  if (type === "solid" && bg.value) {
    const parts = String(bg.value).split(",").map((x) => parseInt(String(x).trim(), 10));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      const hex = "#" + parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("").toUpperCase();
      const hit = pool.find((s) => String(s.hex).toUpperCase() === hex);
      if (hit) curSwatch = `swatch:${hex}`;
    }
  }
  const swatchOpts = pool.map((s) => {
    const tc = textColorFor(s.hex);
    const sel = curSwatch === `swatch:${s.hex}` ? " selected" : "";
    return `<option value="swatch:${s.hex}"${sel} style="background:${s.hex};color:${tc}">${s.name} ${s.hex}</option>`;
  }).join("");
  return `<select class="cr-bgtype" data-bgtype>
    <option value="layer"${type === "layer" ? " selected" : ""}>跟随基底 bg-layer</option>
    <optgroup label="颜色集合（自选底色）">
      ${swatchOpts || '<option value="layer" disabled>（暂无颜色）</option>'}
    </optgroup>
    <option value="solid"${(type === "solid" && !curSwatch) ? " selected" : ""}>固定 RGB（手输）</option>
  </select>`;
}
function renderCapsules() {
  const list = $("capsuleList");
  // 层级：parent 指向父规则 key（如 flowItem/older → chatColumn），子级缩进展示
  const isChild = (r) => r.parent && CAPSULES.some((p) => p.key === r.parent);
  const childrenOf = (key) => CAPSULES.filter((r) => r.parent === key);
  const parentKeys = CAPSULES.filter((r) => !isChild(r));
  const renderRow = (r, i, depth) => {
    const bg = r.bg || {};
    const alpha = bg.alpha ?? 0.5;
    const radius = r.radius || "";
    const padding = r.padding || "";
    const extra = (r.extra || []).join(";\n");
    const enabled = r.enabled !== false;
    const kids = childrenOf(r.key);
    const kidHtml = kids.length
      ? `<div class="cr-children">${kids.map((k) => {
          const ki = CAPSULES.indexOf(k);
          return renderRow(k, ki, depth + 1);
        }).join("")}</div>`
      : "";
    return `<div class="capsule-row" data-idx="${i}" data-key="${r.key}" style="${depth ? `margin-left:${depth * 22}px;border-left:2px solid rgba(var(--mediascape-dsh-theme-border,212,175,55),.25);padding-left:10px` : ""}">
      <div class="cr-head">
        <label class="cr-enable" title="关闭后该条胶囊不生效（enabled:false → capsuleCSS 不渲染）">
          <input type="checkbox" class="cr-enabled" ${enabled ? "checked" : ""}> 启用
        </label>
        <span class="cr-key">${r.key}</span><span class="cr-sel">${r.selector}</span>
      </div>
      ${capsuleDescFor(r.key)}
      <div class="cr-controls">
        <span class="cr-ctl">底色 ${capsuleBgOptions(bg)}</span>
        <span class="cr-ctl cr-solid-box" style="${bg.type === "solid" ? "" : "display:none"}">
          RGB <input type="text" class="cr-solid" value="${(bg.value || "124, 120, 190")}" title="r, g, b 三元组" style="width:130px">
        </span>
        <span class="cr-ctl">不透明度 <input type="range" class="cr-alpha" min="0" max="1" step="0.05" value="${alpha}"> <b class="cr-alpha-val">${alpha}</b></span>
        <span class="cr-ctl">圆角 <input type="text" class="cr-radius" value="${radius}" placeholder="12px"></span>
        <span class="cr-ctl">padding <input type="text" class="cr-padding" value="${padding}" placeholder="6px 12px（空=无）"></span>
      </div>
      <div class="cr-controls" style="margin-top:8px">
        <span class="cr-ctl" style="align-items:flex-start">额外声明 <textarea class="cr-extra" rows="2" style="width:420px;max-width:100%;background:#16122a;color:#e8e6f0;border:1px solid rgba(212,175,55,.3);border-radius:6px;padding:6px 8px;font-size:12px;font-family:'SF Mono',Consolas,monospace" placeholder="每行一条，如 border: 1px solid rgba(var(--mediascape-dsh-theme-border), 0.3) !important">${extra}</textarea></span>
      </div>
      ${kidHtml}
    </div>`;
  };
  list.innerHTML = parentKeys.map((r, i) => renderRow(r, CAPSULES.indexOf(r), 0)).join("");
  $("capsuleBuildHint").textContent = CAPSULES.length ? `共 ${CAPSULES.length} 条胶囊规则（来自 theme-studio/capsules.json）` : "无胶囊规则（capsules.json 缺失或为空）";
}
$("capsuleList").addEventListener("input", (e) => {
  const row = e.target.closest(".capsule-row");
  if (!row) return;
  const r = CAPSULES[Number(row.dataset.idx)];
  if (!r) return;
  if (e.target.classList.contains("cr-alpha")) {
    r.bg = r.bg || {}; r.bg.alpha = parseFloat(e.target.value);
    row.querySelector(".cr-alpha-val").textContent = e.target.value;
  } else if (e.target.classList.contains("cr-enabled")) {
    r.enabled = e.target.checked;
  } else if (e.target.classList.contains("cr-solid")) {
    r.bg = r.bg || {}; r.bg.value = e.target.value.trim();
  } else if (e.target.classList.contains("cr-radius")) {
    r.radius = e.target.value.trim() || null;
  } else if (e.target.classList.contains("cr-padding")) {
    r.padding = e.target.value.trim() || null;
  } else if (e.target.classList.contains("cr-extra")) {
    r.extra = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
  }
});
$("capsuleList").addEventListener("change", (e) => {
  const row = e.target.closest(".capsule-row");
  if (!row) return;
  const r = CAPSULES[Number(row.dataset.idx)];
  if (!r) return;
  if (e.target.classList.contains("cr-bgtype")) {
    r.bg = r.bg || {};
    const selVal = e.target.value;
    const box = row.querySelector(".cr-solid-box");
    if (selVal.startsWith("swatch:")) {
      const hex = selVal.slice("swatch:".length);
      const c = hexToRgb(hex);
      r.bg.type = "solid";
      r.bg.value = c ? `${c.r}, ${c.g}, ${c.b}` : "124, 120, 190";
      if (box) box.style.display = "none";
    } else {
      r.bg.type = selVal;
      if (r.bg.type === "solid" && !r.bg.value) r.bg.value = "124, 120, 190";
      if (box) box.style.display = r.bg.type === "solid" ? "" : "none";
    }
  }
});
$("btnSaveCapsules").addEventListener("click", async () => {
  const btn = $("btnSaveCapsules");
  btn.disabled = true; btn.textContent = "保存并 build 中…";
  try {
    const resp = await fetch("/api/capsules/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: CAPSULES }),
    });
    const j = await resp.json();
    if (!j.ok) { toast(`✗ ${j.error || "保存失败"}`); return; }
    await loadCapsules();
    toast(`✅ 已保存 ${j.count} 条胶囊配方 → capsules.json；build 已在服务端执行，刷新页面看效果`);
  } catch (err) { toast(`✗ ${err.message}`); }
  finally {
    btn.disabled = false; btn.textContent = "💾 保存并 build 生效";
  }
});
async function loadCapsules() {
  try {
    const resp = await fetch("/api/capsules");
    const j = await resp.json();
    CAPSULES = (j.rules || []).map((r) => JSON.parse(JSON.stringify(r)));
    CAPSULE_CATALOG = j.catalog || [];
  } catch (e) {
    CAPSULES = []; CAPSULE_CATALOG = [];
  }
  renderCapsules();
}

// ═══════════ 事件 ═══════════
$("btnApplyL").addEventListener("click", applyLeft);
$("btnResetL").addEventListener("click", resetLeft);
$("pickPreset").addEventListener("change", async () => {
  // 2026-09-26 定稿：每次切换预设都重新读取真实文件（loadPresets 重新 fetch /api/theme-presets，
  // 外部改动/同名保存覆盖立即反映，不再用内存缓存旧值），并重渲染右列。
  // ⚠️ 必须先清 RIGHTCOLOR：右列取色 RIGHTCOLOR[c.role] 优先于预设色——不清会残留上次
  // 套右边/调色记录，切换后右列仍显示旧值（"切换预设右列没变化"的根因）。
  state.pick = $("pickPreset").value;
  RIGHTCOLOR = {};
  await loadPresets();
  renderLeft();
  renderPresets();
});
$("btnUsePreset").addEventListener("click", usePreset);
$("btnExportP").addEventListener("click", exportPreset);
$("btnRenameP").addEventListener("click", renamePreset);
// ── 2026-09-26 左侧套到右边（→ 方向）：左列全部元素当前色 → RIGHTCOLOR（右侧显示/可调）；
// 右列未定义元素随即可调色，保存预设时自动并入。箭头语义：右→左（btnUsePreset/btn-app）用 ←、
// 左→右（btnToRight）用 →。
function importLeftToRight() {
  let n = 0;
  for (const c of roleRows()) {
    const hex = compCurrentHex(c).toUpperCase();
    if (hex) { RIGHTCOLOR[c.role] = hex; n++; }
  }
  renderLeft();
  toast(`→ 已把左侧 ${n} 个元素色套到右边（保存预设将含全部元素）`);
}
if (document.getElementById("btnToRight")) $("btnToRight").addEventListener("click", importLeftToRight);

// ═══════════ 启动 ═══════════
(async function boot() {
  await Promise.all([loadTheme(), loadPresets()]);
  renderLeft();
  await loadCapsules();
})();