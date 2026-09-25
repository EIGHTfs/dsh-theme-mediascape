		// ═══════════ 8.9 可拖动工具条（毛玻璃长条，位置记忆）═══════════
		// 2026-09-23 拆（审计 max-function-length 114 行）：位置持久化 + 拖动事件
		// 提取为独立顶层函数，startDock 只做组装。
		function loadDockPos(dock, lsKey) {
			try {
				const raw = localStorage.getItem(lsKey);
				if (raw) {
					const p = JSON.parse(raw);
					if (typeof p.x === "number" && typeof p.y === "number") {
						dock.style.left = p.x + "px";
						dock.style.top = p.y + "px";
						dock.style.right = "auto";
						dock.style.bottom = "auto";
					}
				}
			} catch (e) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
		}
		function saveDockPos(dock, lsKey) {
			try {
				const r = dock.getBoundingClientRect();
				localStorage.setItem(lsKey, JSON.stringify({ x: r.left, y: r.top }));
			} catch (err) { /* localStorage 异常（配额/隐私模式）可忽略 */ }
		}
		// 拖动事件全量绑定；返回 dispose（配合 popups 的 reposition 回调）。
		// onReposition 由调用方提供（拖动/resize 后重摆弹层）。
		function attachDockDrag(dock, onReposition) {
			const LS_DOCK = "mediascape-dsh-dock-pos";
			loadDockPos(dock, LS_DOCK);
			let startX = 0, startY = 0, origL = 0, origT = 0;
			let pid = null, dragging = false, moved = false, suppressUntil = 0;
			function clamp(x, y) {
				const r = dock.getBoundingClientRect();
				const pad = 8;
				const maxX = Math.max(pad, window.innerWidth - r.width - pad);
				const maxY = Math.max(pad, window.innerHeight - r.height - pad);
				return [Math.min(Math.max(pad, x), maxX), Math.min(Math.max(pad, y), maxY)];
			}
			const onDown = (e) => {
				const r = dock.getBoundingClientRect();
				pid = e.pointerId;
				startX = e.clientX; startY = e.clientY;
				origL = r.left; origT = r.top;
				dragging = true; moved = false;
			};
			const onMove = (e) => {
				if (!dragging || e.pointerId !== pid) return;
				const dx = e.clientX - startX, dy = e.clientY - startY;
				if (!moved && Math.hypot(dx, dy) < 4) return;
				if (!moved) {
					moved = true;
					dock.classList.add("dragging");
					try { dock.setPointerCapture(pid); } catch (err) { /* 浏览器 API 兜底失败可忽略 */ }
				}
				const pos = clamp(origL + dx, origT + dy);
				dock.style.left = pos[0] + "px";
				dock.style.top = pos[1] + "px";
				dock.style.right = "auto";
				dock.style.bottom = "auto";
				onReposition();
			};
			const onUp = (e) => {
				if (e.pointerId !== pid) return;
				dragging = false;
				dock.classList.remove("dragging");
				try { if (dock.hasPointerCapture(pid)) dock.releasePointerCapture(pid); } catch (err) { /* 浏览器 API 兜底失败可忽略 */ }
				if (moved) {
					saveDockPos(dock, LS_DOCK);
					suppressUntil = Date.now() + 300; // 拖动后吞掉本次 click，避免误触按钮
				}
				pid = null;
			};
			const onClickCapture = (e) => {
				if (Date.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); }
			};
			const onResize = () => {
				if (!dock.style.left) return;
				const r = dock.getBoundingClientRect();
				const pos = clamp(r.left, r.top);
				dock.style.left = pos[0] + "px";
				dock.style.top = pos[1] + "px";
				onReposition();
			};
			dock.addEventListener("pointerdown", onDown);
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onUp);
			dock.addEventListener("click", onClickCapture, true);
			window.addEventListener("resize", onResize);
			return () => {
				dock.removeEventListener("pointerdown", onDown);
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				window.removeEventListener("pointercancel", onUp);
				dock.removeEventListener("click", onClickCapture, true);
				window.removeEventListener("resize", onResize);
			};
		}

		function startDock() {
			const dock = document.createElement("div");
			dock.className = "mediascape-dsh-dock";
			document.body.appendChild(dock);

			// 弹层相对 dock 侧边弹出（浮层 absolute 定位，包含块 = dock fixed）：
			// dock 偏左半屏 → 浮层弹右侧；dock 偏右半屏 → 浮层弹左侧。
			// 垂直：相对 dock 顶部对齐；dock 靠近视口底部时上移钳制，保证浮层完整可见。
			const popups = new Set();
			function repositionPopup(el) {
				if (!el || el.offsetParent === null) return; // 未挂载或 display:none
				const dr = dock.getBoundingClientRect();
				const r = el.getBoundingClientRect();
				const vw = window.innerWidth;
				const vh = window.innerHeight;
				const gap = 10;
				el.style.bottom = "auto";
				// 垂直：top 相对 dock（0 = dock 顶）；dock 贴近视口底部时取负值上移，保证浮层完整可见。
				// ⚠️ 2026-09-22 修复：原 maxTopRel = Math.max(0, vh-8-dr.top-r.height) 先把上移量钳成 0，
				//    再 Math.min(0, maxTopRel) 恒得 0 → dock 贴底时浮层不上移、底部超出视口（乐面板 seek
				//    条在屏幕外 → 进度条拖不动，实测 thumbY=934 > vh=900）。修正：直接用可能为负的余量。
				el.style.top = Math.min(0, vh - 8 - dr.top - r.height) + "px";
				// 水平：按 dock 中心左右判断
				const dockCenter = dr.left + dr.width / 2;
				const rightSpace = vw - (dr.right + gap);
				const leftSpace = dr.left - gap;
				const placeRight = () => { el.style.right = "auto"; el.style.left = (dr.width + gap) + "px"; };
				const placeLeft = () => { el.style.right = (dr.width + gap) + "px"; el.style.left = "auto"; };
				if (dockCenter < vw / 2 && rightSpace >= r.width) placeRight();
				else if (dockCenter >= vw / 2 && leftSpace >= r.width) placeLeft();
				else if (rightSpace >= leftSpace) placeRight();
				else placeLeft();
			}
			function repositionPopups() { for (const el of popups) repositionPopup(el); }
			dock.__mediascapeDshCenter = (el) => { popups.add(el); repositionPopup(el); };

			const disposeDrag = attachDockDrag(dock, repositionPopups);

			return {
				el: dock,
				dispose: () => {
					disposeDrag();
					dock.remove();
				}
			};
		}

