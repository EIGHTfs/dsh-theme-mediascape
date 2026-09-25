		// ═══════════ 图片主色提取 API（原「壁纸自动配色」模块瘦身）═══════════
		// 只保留「从图片提取多组主色集合」能力，对外提供两个 API：
		//   window.__mediascapeDshExtractColors(img, count?) — 任意已加载图片取主色集合
		//   window.__mediascapeDshCurrentWallpaperColors()   — 当前图片壁纸取主色集合（异步）

		/**
		 * 从图片提取多组主色（降采样 + 颜色量化，性能友好）。
		 * @param {HTMLImageElement} img - 已加载的图片元素
		 * @param {number} count - 返回的主色数量（按占比降序，默认 5）
		 * @returns {Array<{r:number,g:number,b:number}>|null} - 主色集合（r/g/b 0-255）；
		 *          图片跨域读不到像素时返回 null
		 */
		function extractColors(img, count = 5) {
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			// 降采样到 100px 内（缩略图足够取色，性能友好）
			const scale = Math.min(100 / img.width, 100 / img.height, 1);
			canvas.width = Math.max(1, Math.floor(img.width * scale));
			canvas.height = Math.max(1, Math.floor(img.height * scale));
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

			let pixels;
			try {
				pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			} catch (e) {
				return null; // 跨域图片，SecurityError
			}

			// 颜色量化：RGB 各取高 4 位作桶键（0xf0 掩码），同类色聚一桶，桶内累计原始值求均值
			const buckets = new Map();
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i + 3] < 128) continue; // 跳过透明像素
				const r = pixels[i] & 0xf0;
				const green = pixels[i + 1] & 0xf0;
				const b = pixels[i + 2] & 0xf0;
				const key = (r << 16) | (green << 8) | b;
				const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
				bucket.r += pixels[i];
				bucket.g += pixels[i + 1];
				bucket.b += pixels[i + 2];
				bucket.count++;
				buckets.set(key, bucket);
			}

			return [...buckets.values()]
				.sort((a, b) => b.count - a.count) // 占比降序
				.slice(0, count)
				.map((b) => ({
					r: Math.round(b.r / b.count),
					g: Math.round(b.g / b.count),
					b: Math.round(b.b / b.count),
				}));
		}

		// 通用取色 API：传入任意已加载图片 → 返回主色集合
		window.__mediascapeDshExtractColors = extractColors;

		/**
		 * 按 URL 加载图片（onload 传统路径——img.decode() 在 headless 环境对非 1x1 图抛
		 * EncodingError，onload 正常；统一用 onload 保证一致性）。
		 * @returns {Promise<HTMLImageElement|null>} 加载成功返回 img，失败返回 null
		 */
		function loadImage(url) {
			return new Promise((resolve) => {
				const img = new Image();
				img.onload = () => resolve(img);
				img.onerror = () => resolve(null);
				img.src = url;
			});
		}

		/**
		 * 当前图片壁纸取色 API（异步）：读 LS_BG 当前图片层 id → 列表找 URL → 加载 → 取色。
		 * 列表经 window.__mediascapeDshWallpaperItems() 获取；找不到当前 id 时回退第一张图片。
		 * @returns {Promise<Array<{r,g,b}>|null>} 主色集合；无图片壁纸/加载失败返回 null
		 */
		async function currentWallpaperColors() {
			const items = typeof window.__mediascapeDshWallpaperItems === "function"
				? window.__mediascapeDshWallpaperItems()
				: [];
			const id = localStorage.getItem("mediascape-dsh-bg-id");
			const wallpaper = (id ? items.find((x) => x.id === id) : null)
				|| items.find((x) => x.kind === "image")
				|| items[0];
			if (!wallpaper) return null;
			// 壁纸列表项 URL 字段是 data（loadCustomWallpapers 组装 {…, data: r.url}；url 字段无）
			const src = wallpaper.data || wallpaper.url;
			if (!src) return null;
			const img = await loadImage(src); // 同源页面（预览 30999 / 主实例）无需 CORS
			if (!img) return null; // 加载失败（列表项失效）→ null
			return extractColors(img, 5);
		}

		window.__mediascapeDshCurrentWallpaperColors = currentWallpaperColors;
