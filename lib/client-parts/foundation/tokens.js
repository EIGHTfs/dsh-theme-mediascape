		// ═══════════ 1. 设计令牌层：一键应用配色 ═══════════
// 知更鸟·晴歌：主文字 #E8F4FA / 次文字 #A9C9B9 / 主按钮 #7CC8E8 / 次按钮 #3B89C4 / 金色高亮 #FFD93B / 状态胶囊 #F5F7FA
// ⚠️ 本文件由「配色网站 → 应用」自动生成，手动修改会被覆盖；配色真源见 theme-studio/json/theme-colors.json
const TOKENS = {
  // 背景：中间画面全透明（壁纸区域直接透出，不再铺任何底色）；侧边栏/对话框/按钮等组件仍用主题色
  "--dsw-alias-bg-base": "transparent",
  "--dsw-alias-bg-layer-1": "rgba(42, 33, 72, 0.52)",
  "--dsw-alias-bg-layer-2": "rgba(54, 42, 86, 0.72)",
  "--dsw-alias-bg-layer-3": "rgba(54, 42, 86, 0.8)",
  "--dsw-alias-bg-overlay": "rgba(54, 42, 86, 0.92)",
  "--dsw-alias-bg-module-platform": "rgba(62, 47, 102, 0.84)",
  "--dsw-alias-bg-multi-select": "rgba(54, 42, 86, 0.9)",
  "--dsw-alias-bg-skeleton": "rgba(124, 200, 232, 0.12)",
  // 模态遮罩透明化：打开设置/弹层时壁纸仍透出，仅保留轻微变暗保证前景可读（深色 0.25）
  "--dsw-alias-bg-mask-1": "rgba(62, 47, 102, 0.25)",
  "--dsw-alias-bg-mask-2": "rgba(62, 47, 102, 0.14)",
  "--dsw-alias-bg-mask-drop": "rgba(62, 47, 102, 0.25)",

  // 文字：主文字（text-primary）/ 金高亮（gold-glow）/ 次文字（text-dim）
  "--dsw-alias-label-primary": "#E8F4FA",
  "--dsw-alias-label-secondary": "#FFD93B",
  "--dsw-alias-label-tertiary": "#A89BC2",
  "--dsw-alias-label-caption": "#A89BC2",
  "--dsw-alias-label-dimmed": "rgba(169, 201, 185, 0.55)",
  "--dsw-alias-label-primary-foreground": "#F5F7FA",
  "--dsw-alias-label-primary-inverted": "#F5F7FA",

  // 品牌：主按钮（btn-primary 主强调）
  "--dsw-alias-brand-primary": "#7CC8E8",
  "--dsw-alias-brand-text": "#7CC8E8",
  "--dsw-alias-brand-primary-invert": "#F5F7FA",

  // 按钮：次按钮主填充（更深更实，白字对比强；hover 用主按钮）
  "--dsw-alias-button-primary-fill": "#3B89C4",
  "--dsw-alias-button-primary-hover": "#7CC8E8",
  "--dsw-alias-button-primary-dimmed": "rgba(124, 200, 232, 0.18)",
  "--dsw-alias-button-contrast-fill": "#E8F4FA",
  "--dsw-alias-button-elevated-fill": "#1c1626",
  "--dsw-alias-button-floating-fill": "#181222",
  "--dsw-alias-button-floating-hover": "#241c30",
  "--dsw-alias-button-ghost-active-fill": "#201a2c",
  "--dsw-alias-button-ghost-active-hover": "#2c2440",
  "--dsw-alias-button-info-fill": "#7CC8E8",
  "--dsw-alias-button-info-hover": "#3B89C4",
  "--dsw-alias-button-tool-bar-fill": "rgba(124, 200, 232, 0.16)",
  "--dsw-alias-button-tool-bar-hover": "rgba(59, 137, 196, 0.26)",
  "--dsw-alias-button-ghost-active-border": "#FFD93B",

  // 交互：主按钮色（hover/active）
  "--dsw-alias-interactive-bg-hover": "rgba(124, 200, 232, 0.1)",
  "--dsw-alias-interactive-bg-active": "rgba(226, 192, 90, 0.18)",
  "--dsw-alias-interactive-bg-hover-accent": "rgba(124, 200, 232, 0.15)",
  "--dsw-alias-interactive-bg-hover-danger": 255,

  // 边框：金色高亮（低透明度）
  "--dsw-alias-border-l1": "rgba(255, 217, 59, 0.13)",
  "--dsw-alias-border-l2": "rgba(255, 217, 59, 0.22)",
  "--dsw-alias-border-l2-darkmode-thin": "rgba(255, 217, 59, 0.1)",
  "--dsw-alias-border-l3": "rgba(255, 217, 59, 0.25)",
  "--dsw-alias-border-l4": "rgba(255, 217, 59, 0.38)",

  // 状态：success=主按钮 / error 保留 / warn=金色高亮 / business=主按钮
  "--dsw-alias-state-success-primary": "#7CC8E8",
  "--dsw-alias-state-success-secondary": "rgba(124, 200, 232, 0.16)",
  "--dsw-alias-state-success-tertiary": "rgba(124, 200, 232, 0.08)",
  "--dsw-alias-state-error-primary": "#ff5d7a",
  "--dsw-alias-state-error-secondary": "rgba(255, 93, 122, 0.16)",
  "--dsw-alias-state-warn-primary": "#FFD93B",
  "--dsw-alias-state-warn-secondary": "rgba(255, 217, 59, 0.16)",
  "--dsw-alias-state-business-primary": "#7CC8E8",
  "--dsw-alias-state-business-tertiary": "rgba(124, 200, 232, 0.1)",

  // toast / tooltip / markdown / 滚动条（深空夜空底 + 金/紫强调）
  "--dsw-alias-toast-bg": "rgba(62, 47, 102, 0.92)",
  "--dsw-alias-tooltip-bg": "rgba(62, 47, 102, 0.95)",
  "--dsw-alias-markdown-inline-code": "rgba(226, 192, 90, 0.12)",
  "--dsw-alias-markdown-code-block": "rgba(62, 47, 102, 0.7)",
  "--dsw-alias-markdown-code-block-banner": "rgba(255, 217, 59, 0.06)",
  "--dsw-alias-scrollbar-bg-l1": "rgba(255, 217, 59, 0.15)",
  "--dsw-alias-scrollbar-bg-l2": "rgba(255, 217, 59, 0.22)",
  "--dsw-alias-scrollbar-hover-l1": "rgba(255, 217, 59, 0.3)",
  "--dsw-alias-scrollbar-hover-l2": "rgba(255, 217, 59, 0.42)",

  // 组件特化：侧栏激活=主按钮色（与主按钮一致）/ 高亮=金
  "--dsw-specific-sidebar-fill": "rgba(54, 42, 86, 0.65)",
  "--dsw-specific-sidebar-brand": "rgba(54, 42, 86, 0.6)",
  "--dsw-specific-sidebar-brand-text": "#E8F4FA",
  "--dsw-specific-sidebar-nav-item-active": "rgba(124, 200, 232, 0.16)",
  "--dsw-specific-sidebar-nav-item-active-accent": "#7CC8E8",
  "--dsw-specific-sidebar-nav-item-hover": "rgba(124, 200, 232, 0.08)",
  "--dsw-specific-bubble": "rgba(20, 16, 34, 0.88)",
  "--dsw-specific-bubble-highlight": "rgba(255, 217, 59, 0.08)",
  // 2026-09-23 会话头部（txgHvq_header = 宿主 .header 容器）：sessionHeader 键（#362A56 深紫同 dock/sidebar）
  "--dsw-specific-session-header": "rgba(54, 42, 86, 0.75)",
  "--dsw-specific-files-body": "rgba(54, 42, 86, 1)",
  "--dsw-specific-text-document": "rgba(54, 42, 86, 0.75)",
  // 2026-09-22 未消费键补映射：dock-bar (dock 竖条背景，identity.js .mediascape-dsh-dock 引用)
  "--dsw-specific-dock-bar": "rgba(54, 42, 86, 1)",
  "--dsw-specific-input-major": "rgba(62, 47, 102, 0.85)",
  "--dsw-specific-menu": "rgba(62, 47, 102, 0.94)",
  "--dsw-specific-selector": "rgba(42, 33, 72, 0.9)",
  "--dsw-specific-tip": "rgba(255, 217, 59, 0.1)",
  "--dsw-specific-textdocument": "rgba(54, 42, 86, 0.75)",
  "--dsw-specific-docpreview": "rgba(54, 42, 86, 0.7)",
};
