		// dsh-skip-func-length（startDock 巨型函数 114 行，函数级拆分列为后续优化项，本次仅文件级拆分）
		// ═══════════ 8.9 可拖动工具条（毛玻璃长条，位置记忆）═══════════
		function startDock() {
			const dock = document.createElement("div");
			dock.className = "ff-dock";
			document.body.appendChild(dock);

			const LS_DOCK = "ff_dock_pos";
			// 恢复上次位置
			try {
				const raw = localStorage.getItem(LS_DOCK);
				if (raw) {
					const p = JSON.parse(raw);
					if (typeof p.x === "number" && typeof p.y === "number") {
						dock.style.left = p.x + "px";
						dock.style.top = p.y + "px";
						dock.style.right = "auto";
						dock.style.bottom = "auto";
					}
				}
			} catch (e) {}

			let startX = 0, startY = 0, origL = 0, origT = 0;
			let pid = null, dragging = false, moved = false, suppressUntil = 0;

			// 弹层相对 dock 水平居中（宽度大于 dock 时左右对称）；超出视口则贴边钳制
			const popups = new Set();
			function repositionPopup(el) {
				if (!el || el.offsetParent === null) return; // 未挂载或 display:none
				const dr = dock.getBoundingClientRect();
				el.style.right = "auto";
				el.style.left = "0px";
				const r = el.getBoundingClientRect();
				const vw = window.innerWidth;
				const centered = (dr.width - r.width) / 2;
				const minL = 8 - dr.left;
				const maxL = vw - 8 - dr.left - r.width;
				let left;
				if (minL > maxL) left = minL;
				else left = Math.min(Math.max(centered, minL), maxL);
				el.style.left = left + "px";
			}
			function repositionPopups() { for (const el of popups) repositionPopup(el); }
			dock.__ffCenter = (el) => { popups.add(el); repositionPopup(el); };

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
					try { dock.setPointerCapture(pid); } catch (err) {}
				}
				const pos = clamp(origL + dx, origT + dy);
				dock.style.left = pos[0] + "px";
				dock.style.top = pos[1] + "px";
				dock.style.right = "auto";
				dock.style.bottom = "auto";
				repositionPopups();
			};
			const onUp = (e) => {
				if (e.pointerId !== pid) return;
				dragging = false;
				dock.classList.remove("dragging");
				try { if (dock.hasPointerCapture(pid)) dock.releasePointerCapture(pid); } catch (err) {}
				if (moved) {
					const r = dock.getBoundingClientRect();
					try { localStorage.setItem(LS_DOCK, JSON.stringify({ x: r.left, y: r.top })); } catch (err) {}
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
				repositionPopups();
			};

			dock.addEventListener("pointerdown", onDown);
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onUp);
			dock.addEventListener("click", onClickCapture, true);
			window.addEventListener("resize", onResize);

			return {
				el: dock,
				dispose: () => {
					dock.removeEventListener("pointerdown", onDown);
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					dock.removeEventListener("click", onClickCapture, true);
					window.removeEventListener("resize", onResize);
					dock.remove();
				}
			};
		}

