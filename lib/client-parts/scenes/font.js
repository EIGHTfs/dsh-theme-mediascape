// ═══════════ 10. 字体大小调节（字按钮：会话区/深度求索等文字缩放）═══════════
		// 档位：小 0.85 / 标准 1.0 / 大 1.15 / 特大 1.3（作用于会话区正文与状态胶囊文字）。
		// 实现：直接按档位算好具体 px 值写入 CSS 变量（避免 calc 乘法兼容问题）：
		//   --mediascape-dsh-font-size        = 会话区基准 16px × 系数（identity.js [class*='_float_'] 读取）
		//   --mediascape-dsh-font-line        = 会话区行高 26px × 系数
		//   --mediascape-dsh-font-line-status = 状态胶囊行高 22px × 系数（[role='status'] 读取）
		// 同时设置宿主 --dsh-content-font-size（默认 14px）带动原生组件，localStorage 记忆。
		// 2026-09-22 改：去掉弹出菜单——点击直接循环下一档（小→标准→大→特大→小），
		// 按钮文字保持「字」不显示档位大小（大小用户自行感知），高亮暗=标准档 / 亮=非标准档。
		function startFont(dock) {
			const LEVELS = [
				{ key: "small", label: "小", scale: 0.85 },
				{ key: "normal", label: "标准", scale: 1 },
				{ key: "large", label: "大", scale: 1.15 },
				{ key: "xlarge", label: "特大", scale: 1.3 },
			];
			const LS_FONT = "mediascape-dsh-font-scale";
			let currentKey = "normal"; // 当前档位（循环指针，setLevel 同步更新）

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mediascape-dsh-font-toggle mediascape-dsh-dock-btn";
			btn.textContent = "字";
			btn.title = "字号：标准";
			dock.appendChild(btn);

			function applyScale(scale) {
				// 会话区/状态胶囊字号行高：16/26/22px 基准 × 系数，四舍五入到 0.5px
				const size = Math.round(16 * scale * 2) / 2;
				const line = Math.round(26 * scale * 2) / 2;
				const lineStatus = Math.round(22 * scale * 2) / 2;
				// 注意：全部设到 body（宿主 ThemePresenter 也是设 body 内联 --dsh-content-font-size；
				// 就近继承下 body 内联值优先于 html，设 html 会被宿主覆盖导致无效）
				document.body.style.setProperty("--mediascape-dsh-font-size", size + "px");
				document.body.style.setProperty("--mediascape-dsh-font-line", line + "px");
				document.body.style.setProperty("--mediascape-dsh-font-line-status", lineStatus + "px");
				// 宿主正文字号基准：默认 14px，缩放后取整到 0.5px（如 14*0.85=11.9→12）。
				// AI 回复正文与多数原生文本读 var(--dsh-content-font-size, 14px)，会话区随之缩放
				const base = Math.round(14 * scale * 2) / 2;
				document.body.style.setProperty("--dsh-content-font-size", base + "px");
			}

			function setLevel(key) {
				currentKey = key; // 同步循环指针（此前漏了，导致只能切一次）
				const lv = LEVELS.find((l) => l.key === key) || LEVELS[1];
				localStorage.setItem(LS_FONT, lv.key);
				applyScale(lv.scale);
				// 按钮高亮：标准档暗（默认态），其余档亮
				btn.classList.toggle("on", lv.key !== "normal");
				btn.title = "字号：" + lv.label;
			}

			// 点击循环到下一档（小→标准→大→特大→小）
			btn.addEventListener("click", () => {
				const idx = LEVELS.findIndex((l) => l.key === currentKey);
				setLevel(LEVELS[(idx + 1) % LEVELS.length].key);
			});

			function restore(key) {
				currentKey = key;
				setLevel(key);
			}

			// 恢复上次档位；无记录 → 标准
			const saved = localStorage.getItem(LS_FONT);
			restore(LEVELS.some((l) => l.key === saved) ? saved : "normal");

			return () => {
				btn.remove();
				document.body.style.removeProperty("--mediascape-dsh-font-size");
				document.body.style.removeProperty("--mediascape-dsh-font-line");
				document.body.style.removeProperty("--mediascape-dsh-font-line-status");
				document.body.style.removeProperty("--dsh-content-font-size");
			};
		}
