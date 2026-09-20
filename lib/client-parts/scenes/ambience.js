		// ═══════════ 6. 常驻萤火氛围（分档：关/星点/曳光/流萤，数量渐变）═══════════
		const AMB_LEVELS = [
			{ key: "off", label: "关", count: 0 },
			{ key: "star", label: "星点", count: 12 },
			{ key: "trail", label: "曳光", count: 28 },
			{ key: "firefly", label: "流萤", count: 80 },
		];
		function startAmbience(dock) {
			const wrap = document.createElement("div");
			wrap.className = "ff-amb";
			const maxCount = AMB_LEVELS.reduce((m, l) => Math.max(m, l.count), 0);
			const dots = [];
			for (let i = 0; i < maxCount; i++) {
				const dot = document.createElement("i");
				const core = document.createElement("span");
				dot.appendChild(core);
				const size = 3 + Math.random() * 4;
				const op = 0.35 + Math.random() * 0.45;
				dot.style.left = (Math.random() * 100) + "%";
				dot.style.setProperty("--dur", (12 + Math.random() * 20) + "s");
				dot.style.setProperty("--delay", (-Math.random() * 25) + "s");
				dot.style.setProperty("--drift", Math.round((Math.random() - 0.5) * 120) + "px");
				core.style.width = size + "px";
				core.style.height = size + "px";
				core.style.setProperty("--op", op.toFixed(2));
				wrap.appendChild(dot);
				dots.push(dot);
			}
			document.body.appendChild(wrap);

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ff-amb-toggle ff-dock-btn";
			btn.textContent = "萤";
			btn.title = "萤火氛围数量";
			dock.appendChild(btn);

			const menu = document.createElement("div");
			menu.className = "ff-amb-menu";
			for (const lv of AMB_LEVELS) {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "ff-amb-opt";
				b.dataset.key = lv.key;
				b.textContent = lv.label;
				b.addEventListener("click", () => { setLevel(lv.key); closeMenu(); });
				menu.appendChild(b);
			}
			dock.appendChild(menu);

			function closeMenu() { menu.classList.remove("open"); }

			function setLevel(key, instant) {
				const lv = AMB_LEVELS.find((l) => l.key === key) || AMB_LEVELS[0];
				localStorage.setItem(LS_AMBIENCE, lv.key);
				for (let i = 0; i < dots.length; i++) {
					const on = i < lv.count;
					if (instant) {
						dots[i].style.transition = "none";
						dots[i].classList.toggle("on", on);
						void dots[i].offsetWidth; // 强制回流，使下次切换恢复过渡
						dots[i].style.transition = "";
					} else {
						dots[i].classList.toggle("on", on);
					}
				}
				btn.classList.toggle("on", lv.key !== "off");
				btn.title = "萤火氛围：" + lv.label;
				menu.querySelectorAll(".ff-amb-opt").forEach((b) => b.classList.toggle("active", b.dataset.key === lv.key));
			}

			btn.addEventListener("click", () => menu.classList.toggle("open"));
			const onDocClick = (e) => {
				if (!menu.contains(e.target) && e.target !== btn) closeMenu();
			};
			document.addEventListener("click", onDocClick);

			// 迁移旧值："1"→曳光、"0"→关、缺失→星点；其它旧档位键直接沿用
			const old = localStorage.getItem(LS_AMBIENCE);
			let initial = "star";
			if (old === "0") initial = "off";
			else if (old === "1") initial = "trail";
			else if (AMB_LEVELS.some((l) => l.key === old)) initial = old;
			setLevel(initial, true); // 首帧即时显示，不做渐变

			return () => {
				document.removeEventListener("click", onDocClick);
				wrap.remove();
				btn.remove();
				menu.remove();
			};
		}

