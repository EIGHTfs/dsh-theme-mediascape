		// ═══════════ 1. 设计令牌层：知更鸟配色（2026-09-21 基底改）═══════════
		// 知更鸟 6 色：肤色 #FDF0FA / 发色 #C8B8D8 / 瞳色 #6B8E5A / 礼服灰白 #F0F0F5 / 礼服紫 #8A6D9B / 点缀金 #D4AF37
		// ── 流萤配色暂存备份（仅用于对照页展示，目前不启用；原值见下方注释块）──
		// 旧：深空海军蓝黑 × 萤火虫青绿（#00ff87 / #7dff9e）× 莹白文字
		// 旧背景: rgba(6,10,20,.30) rgba(10,16,30,.52) rgba(13,21,37,.72) rgba(17,27,45,.80) rgba(15,25,43,.92) rgba(8,14,26,.84) rgba(15,25,43,.90)
		// 旧 skeleton rgba(0,255,135,.07) 旧 mask rgba(3,7,15,.72/.40) rgba(4,8,18,.72)
		// 旧文字: #eafff3 #a9c9b9 #6f8a7c #8fb8a4 #546f60 旧前景 #06240f
		// 旧品牌: #7dff9e 旧按钮 #00e676/#2bf58a rgba(0,230,118,.14) 旧 elevated #0e1628 旧 floating #0c1424/#122036 旧 ghost #0f1c30/#16283f 旧 info #00c78a/#00ff9d
		// 旧交互: rgba(0,255,135,.09/.16) rgba(125,255,158,.15) 旧 danger rgba(255,93,122,.15)
		// 旧边框: rgba(0,255,135,.13/.22/.10/.38) rgba(125,255,158,.25)
		// 旧状态: success #00ff87(.16/.08) error #ff5d7a warn #ffd93b business #00e6a0(.10)
		// 旧 toast/tooltip rgba(8,14,26,.92/.95) 旧 markdown rgba(0,255,135,.12/.06) rgba(4,9,18,.70)
		// 旧 scrollbar rgba(0,255,135,.15/.22/.30/.42)
		// 旧 sidebar rgba(6,11,22,.88) rgba(0,255,135,.12/.07) #00ff87 旧 bubble rgba(12,20,36,.88) rgba(0,255,135,.08)
		// 旧 input rgba(8,14,26,.85) 旧 menu rgba(8,14,26,.94) 旧 selector rgba(10,16,30,.90) 旧 tip rgba(0,255,135,.10)
		// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════
// 知更鸟提亮：肤色 #FDF0FA / 发色 #E2D8EC / 瞳色 #7EA36C / 礼服灰白 #F0F0F5 / 礼服紫 #A78BC0 / 点缀金 #E8C04A
// ⚠️ 本文件由「配色对照页 → 应用为正式基底」自动生成，手动修改会被覆盖；留痕见 preview/generated/
// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════
// test：肤色 #EAFFF3 / 发色 #A9C9B9 / 瞳色 #00E676 / 礼服灰白 #F0F0F5 / 礼服紫 #7DFF9E / 点缀金 #FFD93B
// ⚠️ 本文件由「配色对照页 → 应用为正式基底」自动生成，手动修改会被覆盖；留痕见 preview/generated/
// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════
// 知更鸟提亮：肤色 #FDF0FA / 发色 #E2D8EC / 瞳色 #7EA36C / 礼服灰白 #F0F0F5 / 礼服紫 #A78BC0 / 点缀金 #E8C04A
// ⚠️ 本文件由「配色对照页 → 应用为正式基底」自动生成，手动修改会被覆盖；留痕见 preview/generated/
// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════
// 知更鸟当前基底：肤色 FDF0FA / 发色 C8B8D8 / 瞳色 8A6D9B / 礼服灰白 D4AF37 / 礼服紫 C8B8D8 / 点缀金 D4AF37
// ⚠️ 本文件由「配色对照页 → 应用为正式基底」自动生成，手动修改会被覆盖；留痕见 preview/generated/
const TOKENS = {
  // 背景：半透明深空夜空（让壁纸透出来；bg-base 是根容器，要最透明）
  "--dsw-alias-bg-base": "rgba(16, 14, 28, 0.3)",
  "--dsw-alias-bg-layer-1": "rgba(16, 16, 32, 0.52)",
  "--dsw-alias-bg-layer-2": "rgba(22, 18, 34, 0.72)",
  "--dsw-alias-bg-layer-3": "rgba(22, 18, 34, 0.8)",
  "--dsw-alias-bg-overlay": "rgba(22, 18, 34, 0.92)",
  "--dsw-alias-bg-module-platform": "rgba(16, 14, 28, 0.84)",
  "--dsw-alias-bg-multi-select": "rgba(22, 18, 34, 0.9)",
  "--dsw-alias-bg-skeleton": "rgba(138, 109, 155, 0.12)",
  "--dsw-alias-bg-mask-1": "rgba(16, 14, 28, 0.72)",
  "--dsw-alias-bg-mask-2": "rgba(16, 14, 28, 0.4)",
  "--dsw-alias-bg-mask-drop": "rgba(16, 14, 28, 0.72)",

  // 文字：肤色（主）/ 金色（次）/ 发色（三）
  "--dsw-alias-label-primary": "FDF0FA",
  "--dsw-alias-label-secondary": "D4AF37",
  "--dsw-alias-label-tertiary": "C8B8D8",
  "--dsw-alias-label-caption": "C8B8D8",
  "--dsw-alias-label-dimmed": "rgba(200, 184, 216, 0.55)",
  "--dsw-alias-label-primary-foreground": "#2a1b2e",
  "--dsw-alias-label-primary-inverted": "#2a1b2e",

  // 品牌：瞳色绿（知更鸟之绿）
  "--dsw-alias-brand-primary": "8A6D9B",
  "--dsw-alias-brand-text": "8A6D9B",
  "--dsw-alias-brand-primary-invert": "D4AF37",

  // 按钮：瞳色绿主填充（礼服紫为 hover/装饰）
  "--dsw-alias-button-primary-fill": "8A6D9B",
  "--dsw-alias-button-primary-hover": "C8B8D8",
  "--dsw-alias-button-primary-dimmed": "rgba(138, 109, 155, 0.18)",
  "--dsw-alias-button-contrast-fill": "FDF0FA",
  "--dsw-alias-button-elevated-fill": "#1c1626",
  "--dsw-alias-button-floating-fill": "#181222",
  "--dsw-alias-button-floating-hover": "#241c30",
  "--dsw-alias-button-ghost-active-fill": "#201a2c",
  "--dsw-alias-button-ghost-active-hover": "#2c2440",
  "--dsw-alias-button-info-fill": "8A6D9B",
  "--dsw-alias-button-info-hover": "C8B8D8",
  "--dsw-alias-button-tool-bar-fill": "rgba(138, 109, 155, 0.16)",
  "--dsw-alias-button-tool-bar-hover": "rgba(200, 184, 216, 0.26)",
  "--dsw-alias-button-ghost-active-border": "D4AF37",

  // 交互：瞳色绿（hover/active）
  "--dsw-alias-interactive-bg-hover": "rgba(138, 109, 155, 0.1)",
  "--dsw-alias-interactive-bg-active": "rgba(138, 109, 155, 0.18)",
  "--dsw-alias-interactive-bg-hover-accent": "rgba(138, 109, 155, 0.15)",
  "--dsw-alias-interactive-bg-hover-danger": 255,

  // 边框：点缀金（低透明度）
  "--dsw-alias-border-l1": "rgba(212, 175, 55, 0.13)",
  "--dsw-alias-border-l2": "rgba(212, 175, 55, 0.22)",
  "--dsw-alias-border-l2-darkmode-thin": "rgba(212, 175, 55, 0.1)",
  "--dsw-alias-border-l3": "rgba(212, 175, 55, 0.25)",
  "--dsw-alias-border-l4": "rgba(212, 175, 55, 0.38)",

  // 状态：success=瞳色绿 / error 保留 / warn=点缀金 / business=瞳色绿
  "--dsw-alias-state-success-primary": "8A6D9B",
  "--dsw-alias-state-success-secondary": "rgba(138, 109, 155, 0.16)",
  "--dsw-alias-state-success-tertiary": "rgba(138, 109, 155, 0.08)",
  "--dsw-alias-state-error-primary": "#ff5d7a",
  "--dsw-alias-state-error-secondary": "rgba(255, 93, 122, 0.16)",
  "--dsw-alias-state-warn-primary": "D4AF37",
  "--dsw-alias-state-warn-secondary": "rgba(212, 175, 55, 0.16)",
  "--dsw-alias-state-business-primary": "8A6D9B",
  "--dsw-alias-state-business-tertiary": "rgba(138, 109, 155, 0.1)",

  // toast / tooltip / markdown / 滚动条（深空夜空底 + 金/紫强调）
  "--dsw-alias-toast-bg": "rgba(16, 14, 28, 0.92)",
  "--dsw-alias-tooltip-bg": "rgba(16, 14, 28, 0.95)",
  "--dsw-alias-markdown-inline-code": "rgba(212, 175, 55, 0.12)",
  "--dsw-alias-markdown-code-block": "rgba(16, 14, 28, 0.7)",
  "--dsw-alias-markdown-code-block-banner": "rgba(212, 175, 55, 0.06)",
  "--dsw-alias-scrollbar-bg-l1": "rgba(212, 175, 55, 0.15)",
  "--dsw-alias-scrollbar-bg-l2": "rgba(212, 175, 55, 0.22)",
  "--dsw-alias-scrollbar-hover-l1": "rgba(212, 175, 55, 0.3)",
  "--dsw-alias-scrollbar-hover-l2": "rgba(212, 175, 55, 0.42)",

  // 组件特化：侧栏激活=瞳色绿（与主按钮一致）/ 高亮=金
  "--dsw-specific-sidebar-fill": "rgba(16, 14, 28, 0.88)",
  "--dsw-specific-sidebar-nav-item-active": "rgba(138, 109, 155, 0.16)",
  "--dsw-specific-sidebar-nav-item-active-accent": "8A6D9B",
  "--dsw-specific-sidebar-nav-item-hover": "rgba(138, 109, 155, 0.08)",
  "--dsw-specific-bubble": "rgba(20, 16, 34, 0.88)",
  "--dsw-specific-bubble-highlight": "rgba(212, 175, 55, 0.08)",
  "--dsw-specific-input-major": "rgba(16, 14, 28, 0.85)",
  "--dsw-specific-menu": "rgba(16, 14, 28, 0.94)",
  "--dsw-specific-selector": "rgba(16, 16, 32, 0.9)",
  "--dsw-specific-tip": "rgba(212, 175, 55, 0.1)",
};
