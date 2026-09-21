// ═══════════ 10. 字体大小调节（字按钮：会话区/深度求索等文字缩放）═══════════
		// 档位：小 0.85 / 标准 1.0 / 大 1.15 / 特大 1.3（作用于会话区正文与状态胶囊文字）。
		// 实现：直接按档位算好具体 px 值写入 CSS 变量（避免 calc 乘法兼容问题）：
		//   --ff-font-size        = 会话区基准 16px × 系数（identity.js [class*='_float_'] 读取）
		//   --ff-font-line        = 会话区行高 26px × 系数
		//   --ff-font-line-status = 状态胶囊行高 22px × 系数（[role='status'] 读取）
		// 同时设置宿主 --dsh-content-font-size（默认 14px）带动原生组件，localStorage 记忆。
		function startFont(dock) {
			const LEVELS = [
				{ key: "small", label: "小", scale: 0.85 },
				{ key: "normal", label: "标准", scale: 1 },
				{ key: "large", label: "大", scale: 1.15 },
				{ key: "xlarge", label: "特大", scale: 1.3 },
			];
			const LS_FONT = "ff_font_scale";

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ff-font-toggle ff-dock-btn";
			btn.textContent = "字";
			btn.title = "字号设置";
			dock.appendChild(btn);

			const menu = document.createElement("div");
			menu.className = "ff-font-menu";
			for (const lv of LEVELS) {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "ff-font-opt";
				b.dataset.key = lv.key;
				b.textContent = lv.label;
				b.addEventListener("click", () => { setLevel(lv.key); closeMenu(); });
				menu.appendChild(b);
			}
			dock.appendChild(menu);

			function applyScale(scale) {
				// 会话区/状态胶囊字号行高：16/26/22px 基准 × 系数，四舍五入到 0.5px
				const size = Math.round(16 * scale * 2) / 2;
				const line = Math.round(26 * scale * 2) / 2;
				const lineStatus = Math.round(22 * scale * 2) / 2;
				document.documentElement.style.setProperty("--ff-font-size", size + "px");
				document.documentElement.style.setProperty("--ff-font-line", line + "px");
				document.documentElement.style.setProperty("--ff-font-line-status", lineStatus + "px");
				// 宿主基准：默认 14px，缩放后取整到 0.5px（如 14*0.85=11.9→12）
				const base = Math.round(14 * scale * 2) / 2;
				document.documentElement.style.setProperty("--dsh-content-font-size", base + "px");
			}

			function setLevel(key, instant) {
				const lv = LEVELS.find((l) => l.key === key) || LEVELS[1];
				localStorage.setItem(LS_FONT, lv.key);
				applyScale(lv.scale);
				menu.querySelectorAll(".ff-font-opt").forEach((b) => b.classList.toggle("active", b.dataset.key === lv.key));
				if (!instant) {
					btn.title = "字号：" + lv.label;
					btn.classList.toggle("on", lv.key !== "normal");
				}
			}
			function closeMenu() { menu.classList.remove("open"); }

			btn.addEventListener("click", () => menu.classList.toggle("open"));
			const onDocClick = (e) => {
				if (!menu.contains(e.target) && e.target !== btn) closeMenu();
			};
			document.addEventListener("click", onDocClick);

			// 恢复上次档位；无记录 → 标准
			const saved = localStorage.getItem(LS_FONT);
			setLevel(LEVELS.some((l) => l.key === saved) ? saved : "normal", true);

			return () => {
				document.removeEventListener("click", onDocClick);
				btn.remove();
				menu.remove();
				document.documentElement.style.removeProperty("--ff-font-size");
				document.documentElement.style.removeProperty("--ff-font-line");
				document.documentElement.style.removeProperty("--ff-font-line-status");
				document.documentElement.style.removeProperty("--dsh-content-font-size");
			};
		}