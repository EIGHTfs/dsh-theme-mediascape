		// ═══════════ 1. 设计令牌层：流萤配色 ═══════════
		// 深空海军蓝黑 × 萤火虫青绿（#00ff87 / #7dff9e）× 莹白文字
		const TOKENS = {
			// 背景：半透明深空蓝黑（让壁纸透出来；bg-base 是根容器，要最透明）
			"--dsw-alias-bg-base": "rgba(6, 10, 20, 0.30)",
			"--dsw-alias-bg-layer-1": "rgba(10, 16, 30, 0.52)",
			"--dsw-alias-bg-layer-2": "rgba(13, 21, 37, 0.72)",
			"--dsw-alias-bg-layer-3": "rgba(17, 27, 45, 0.80)",
			"--dsw-alias-bg-overlay": "rgba(15, 25, 43, 0.92)",
			"--dsw-alias-bg-module-platform": "rgba(8, 14, 26, 0.84)",
			"--dsw-alias-bg-multi-select": "rgba(15, 25, 43, 0.90)",
			"--dsw-alias-bg-skeleton": "rgba(0, 255, 135, 0.07)",
			"--dsw-alias-bg-mask-1": "rgba(3, 7, 15, 0.72)",
			"--dsw-alias-bg-mask-2": "rgba(3, 7, 15, 0.40)",
			"--dsw-alias-bg-mask-drop": "rgba(4, 8, 18, 0.72)",

			// 文字：莹白 / 薄荷灰
			"--dsw-alias-label-primary": "#eafff3",
			"--dsw-alias-label-secondary": "#a9c9b9",
			"--dsw-alias-label-tertiary": "#6f8a7c",
			"--dsw-alias-label-caption": "#8fb8a4",
			"--dsw-alias-label-dimmed": "#546f60",
			"--dsw-alias-label-primary-foreground": "#06240f",
			"--dsw-alias-label-primary-inverted": "#06240f",

			// 品牌：流萤绿
			"--dsw-alias-brand-primary": "#7dff9e",
			"--dsw-alias-brand-text": "#7dff9e",
			"--dsw-alias-brand-primary-invert": "#042b11",

			// 按钮
			"--dsw-alias-button-primary-fill": "#00e676",
			"--dsw-alias-button-primary-hover": "#2bf58a",
			"--dsw-alias-button-primary-dimmed": "rgba(0, 230, 118, 0.14)",
			"--dsw-alias-button-contrast-fill": "#eafff3",
			"--dsw-alias-button-elevated-fill": "#0e1628",
			"--dsw-alias-button-floating-fill": "#0c1424",
			"--dsw-alias-button-floating-hover": "#122036",
			"--dsw-alias-button-ghost-active-fill": "#0f1c30",
			"--dsw-alias-button-ghost-active-hover": "#16283f",
			"--dsw-alias-button-info-fill": "#00c78a",
			"--dsw-alias-button-info-hover": "#00ff9d",
			"--dsw-alias-button-tool-bar-fill": "rgba(0, 255, 135, 0.12)",
			"--dsw-alias-button-tool-bar-hover": "rgba(0, 255, 135, 0.20)",
			"--dsw-alias-button-ghost-active-border": "#00ff87",

			// 交互
			"--dsw-alias-interactive-bg-hover": "rgba(0, 255, 135, 0.09)",
			"--dsw-alias-interactive-bg-active": "rgba(0, 255, 135, 0.16)",
			"--dsw-alias-interactive-bg-hover-accent": "rgba(125, 255, 158, 0.15)",
			"--dsw-alias-interactive-bg-hover-danger": "rgba(255, 93, 122, 0.15)",

			// 边框
			"--dsw-alias-border-l1": "rgba(0, 255, 135, 0.13)",
			"--dsw-alias-border-l2": "rgba(0, 255, 135, 0.22)",
			"--dsw-alias-border-l2-darkmode-thin": "rgba(0, 255, 135, 0.10)",
			"--dsw-alias-border-l3": "rgba(125, 255, 158, 0.25)",
			"--dsw-alias-border-l4": "rgba(0, 255, 135, 0.38)",

			// 状态
			"--dsw-alias-state-success-primary": "#00ff87",
			"--dsw-alias-state-success-secondary": "rgba(0, 255, 135, 0.16)",
			"--dsw-alias-state-success-tertiary": "rgba(0, 255, 135, 0.08)",
			"--dsw-alias-state-error-primary": "#ff5d7a",
			"--dsw-alias-state-error-secondary": "rgba(255, 93, 122, 0.16)",
			"--dsw-alias-state-warn-primary": "#ffd93b",
			"--dsw-alias-state-warn-secondary": "rgba(255, 217, 59, 0.16)",
			"--dsw-alias-state-business-primary": "#00e6a0",
			"--dsw-alias-state-business-tertiary": "rgba(0, 230, 160, 0.10)",

			// toast / tooltip / markdown / 滚动条
			"--dsw-alias-toast-bg": "rgba(8, 14, 26, 0.92)",
			"--dsw-alias-tooltip-bg": "rgba(8, 14, 26, 0.95)",
			"--dsw-alias-markdown-inline-code": "rgba(0, 255, 135, 0.12)",
			"--dsw-alias-markdown-code-block": "rgba(4, 9, 18, 0.70)",
			"--dsw-alias-markdown-code-block-banner": "rgba(0, 255, 135, 0.06)",
			"--dsw-alias-scrollbar-bg-l1": "rgba(0, 255, 135, 0.15)",
			"--dsw-alias-scrollbar-bg-l2": "rgba(0, 255, 135, 0.22)",
			"--dsw-alias-scrollbar-hover-l1": "rgba(0, 255, 135, 0.30)",
			"--dsw-alias-scrollbar-hover-l2": "rgba(0, 255, 135, 0.42)",

			// 组件特化
			"--dsw-specific-sidebar-fill": "rgba(6, 11, 22, 0.88)",
			"--dsw-specific-sidebar-nav-item-active": "rgba(0, 255, 135, 0.12)",
			"--dsw-specific-sidebar-nav-item-active-accent": "#00ff87",
			"--dsw-specific-sidebar-nav-item-hover": "rgba(0, 255, 135, 0.07)",
			"--dsw-specific-bubble": "rgba(12, 20, 36, 0.88)",
			"--dsw-specific-bubble-highlight": "rgba(0, 255, 135, 0.08)",
			"--dsw-specific-input-major": "rgba(8, 14, 26, 0.85)",
			"--dsw-specific-menu": "rgba(8, 14, 26, 0.94)",
			"--dsw-specific-selector": "rgba(10, 16, 30, 0.90)",
			"--dsw-specific-tip": "rgba(0, 255, 135, 0.10)",
		};

