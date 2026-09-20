		// ═══════════ 8. 彩蛋：输入「SAM」重播开屏变身 ═══════════
		function startEasterEgg() {
			let last = 0;
			const onKey = (e) => {
				if (e.key !== "Enter") return;
				const t = e.target;
				if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
				const v = (t.value || "").trim().toLowerCase();
				if (v !== "sam") return; // 仅保留 SAM 触发开屏动画
				const now = Date.now();
				if (now - last < 8000) return;
				last = now;
				playTransformIntro();
			};
			document.addEventListener("keydown", onKey, true);
			return () => document.removeEventListener("keydown", onKey, true);
		}

