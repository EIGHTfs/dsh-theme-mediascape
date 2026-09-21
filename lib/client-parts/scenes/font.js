// ═══════════ 10. 字体大小调节（字按钮：会话区/深度求索等文字缩放）═══════════
		// 档位：小 0.85 / 标准 1.0 / 大 1.15 / 特大 1.3（作用于会话区与状态文字）。
		// 实现：设置宿主 --dsh-content-font-size（默认 14px，gradient-shadow-text.css 有定义）作基准，
		// 再由 identity.js 的 --ff-font-scale 缩放我们的显式字号（16px 会话区 / 16px 状态胶囊）。
		// 注意：宿主该变量作用于原生组件字号，主题层用 calc() 复合，改一处全应用，localStorage 记忆。
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
				// 宿主基准：默认 14px，缩放后取整到 0.5px（如 14*0.85=11.9→12）
				const base = 14 * scale;
				document.documentElement.style.setProperty("--dsh-content-font-size", base.toFixed(1) + "px");
				document.documentElement.style.setProperty("--ff-font-scale", String(scale));
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
				document.documentElement.style.removeProperty("--dsh-content-font-size");
				document.documentElement.style.removeProperty("--ff-font-scale");
			};
		}