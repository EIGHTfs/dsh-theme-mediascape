		// ═══════════ 【已废弃】壁纸主色提取 → 主题自动配色 ═══════════
		// 2026-09-21 废弃：不再随壁纸自动换配色。build.cjs PART_ORDER 已移除本模块（不再拼入 client.js），
		// wallpaper.js 原调用已注释移除。源码保留备查，不参与构建。
		// 原设计：identity.js 的 html 选择器定义 --mediascape-dsh-theme-* 默认值（= 流萤原色）。
		// 这里只「覆盖」这些变量：图片壁纸切换时取主色 → 生成 --mediascape-dsh-theme-* 三元组覆盖，
		// 组件样式（identity.js）已统一 var() 引用，自动跟随换肤；视频不触发（沿用图片最后一套）。
		// 命名空间：--mediascape-dsh-theme-* 管「壁纸联动皮肤」，--dsw-alias-* 管「固定品牌色」，两者并存。

		// 缓存：item.id → theme，同一张图只算一次
		const ffThemeCache = new Map();

		/**
		 * 从图片提取主色（降采样 + 量化，性能友好）
		 * @param {HTMLImageElement} img
		 * @param {number} count - 提取几种主色
		 * @returns {Array<{r,g,b}>|null}
		 */
		function ffExtractColors(img, count = 5) {
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			const scale = Math.min(100 / img.width, 100 / img.height, 1);
			canvas.width = Math.max(1, Math.floor(img.width * scale));
			canvas.height = Math.max(1, Math.floor(img.height * scale));
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

			let data;
			try {
				data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			} catch (e) {
				return null; // 跨域图片，SecurityError
			}

			const buckets = new Map();
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] < 128) continue; // 跳过透明像素
				const r = data[i] & 0xf0;
				const green = data[i + 1] & 0xf0;
				const b = data[i + 2] & 0xf0;
				const key = (r << 16) | (green << 8) | b;
				const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
				bucket.r += data[i];
				bucket.g += data[i + 1];
				bucket.b += data[i + 2];
				bucket.count++;
				buckets.set(key, bucket);
			}

			return [...buckets.values()]
				.sort((a, b) => b.count - a.count)
				.slice(0, count)
				.map((b) => ({
					r: Math.round(b.r / b.count),
					g: Math.round(b.g / b.count),
					b: Math.round(b.b / b.count),
				}));
		}

		function ffRgbToHsl(r, g, b) {
			r /= 255; g /= 255; b /= 255;
			const max = Math.max(r, g, b), min = Math.min(r, g, b);
			let hue, sat, light = (max + min) / 2;
			if (max === min) { hue = sat = 0; }
			else {
				const delta = max - min;
				sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
				switch (max) {
					case r: hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6; break;
					case g: hue = ((b - r) / delta + 2) / 6; break;
					case b: hue = ((r - g) / delta + 4) / 6; break;
				}
			}
			return { h: hue * 360, s: sat * 100, l: light * 100 };
		}

		function ffHslToRgb(h, s, l) {
			h /= 360; s /= 100; l /= 100;
			const hue2rgb = (p, q, t) => {
				if (t < 0) t += 1;
				if (t > 1) t -= 1;
				if (t < 1 / 6) return p + (q - p) * 6 * t;
				if (t < 1 / 2) return q;
				if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
				return p;
			};
			let r, g, b;
			if (s === 0) { r = g = b = l; }
			else {
				const qp = l < 0.5 ? l * (1 + s) : l + s - l * s;
				const p = 2 * l - qp;
				r = hue2rgb(p, qp, h + 1 / 3);
				g = hue2rgb(p, qp, h);
				b = hue2rgb(p, qp, h - 1 / 3);
			}
			return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
		}

		/**
		 * 从主色生成一套 --mediascape-dsh-theme-* 变量值（与 identity.js 基底变量名一一对应）。
		 * 输出 RGB 三元组字符串（"r, g, b"）——组件样式用 rgba(var(--mediascape-dsh-theme-x), a) 组合出各透明度层次，
		 * 换肤只改三元组，透明度层次自动跟随。
		 */
		function ffBuildTheme(colors) {
			if (!colors || !colors.length) return null;
			const base = ffRgbToHsl(colors[0].r, colors[0].g, colors[0].b);
			const accent = colors[1] ? ffRgbToHsl(colors[1].r, colors[1].g, colors[1].b) : base;
			const triple = (c) => `${c.r}, ${c.g}, ${c.b}`;

			return {
				// 背景族：低亮度，色相跟随主色（与基底 rgba 透明度层次组合）
				"--mediascape-dsh-theme-bg": triple(ffHslToRgb(base.h, base.s * 0.4, 12)),
				"--mediascape-dsh-theme-bg-soft": triple(ffHslToRgb(base.h, base.s * 0.3, 18)),
				"--mediascape-dsh-theme-bg-layer": triple(ffHslToRgb(base.h, base.s * 0.25, 24)),
				// 强调族：高饱和（accent-dim 由组件透明度组合出淡底）
				"--mediascape-dsh-theme-accent": triple(ffHslToRgb(accent.h, Math.min(accent.s * 1.2, 80), 60)),
				"--mediascape-dsh-theme-accent-soft": triple(ffHslToRgb(accent.h, Math.min(accent.s * 0.8, 50), 40)),
				// 文字族：高亮度保证对比度
				"--mediascape-dsh-theme-text": triple(ffHslToRgb(base.h, 10, 92)),
				"--mediascape-dsh-theme-text-dim": triple(ffHslToRgb(base.h, 8, 65)),
				// 边框族
				"--mediascape-dsh-theme-border": triple(ffHslToRgb(base.h, base.s * 0.3, 32)),
			};
		}

		/**
		 * 注入 CSS 变量到根元素（覆盖 identity.js 基底值；内联样式优先级最高）
		 */
		function ffApplyTheme(theme) {
			if (!theme) return;
			const root = document.documentElement;
			for (const [key, triple] of Object.entries(theme)) {
				root.style.setProperty(key, triple);
			}
		}

		// 并发守卫：快速连切图片时只应用「最新一次」取色结果（丢弃过期异步）
		let ffThemeSeq = 0;

		/**
		 * 从壁纸项更新主题。视频不触发（kind !== "image" 直接返回，沿用图片最后一套主题）。
		 */
		async function ffUpdateThemeFromWallpaper(item) {
			if (!item || item.kind !== "image") return; // 视频：不切换 CSS

			if (ffThemeCache.has(item.id)) {
				ffApplyTheme(ffThemeCache.get(item.id));
				return;
			}

			const seq = ++ffThemeSeq; // 本次请求序号：过期结果丢弃
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.src = item.url || item.data;

			try {
				await img.decode();
				const colors = ffExtractColors(img, 5);
				const theme = ffBuildTheme(colors);
				if (theme) {
					ffThemeCache.set(item.id, theme);
					if (seq === ffThemeSeq) ffApplyTheme(theme); // 只应用最新
				}
			} catch (e) {
				// 加载失败/跨域：静默跳过，不影响壁纸显示（保持基底/上一套主题）
			}
		}
