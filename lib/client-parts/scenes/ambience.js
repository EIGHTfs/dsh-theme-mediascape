// ═══════════ 6. 常驻萤火氛围（分档：关/星光/曳光/流萤，数量渐变）═══════════
		// 2026-09-21 改：并入「景」面板——氛围档位以一行按钮嵌在壁纸设置面板内，dock 不再有独立「萤」按钮。
		// 2026-09-22 改：面板内该行改为**单循环按钮**——一个按钮点击循环 关→星光→曳光→流萤，
		// 按钮文字显示当前档位（关档暗、其余档亮），档位名用「星光」（替代旧「星点」）。
		// 氛围粒子容器仍挂在 body（画面级效果），档位 UI 由 startAmbience 插进 dock.__mediascapeDshBgPanel。
		const AMB_LEVELS = [
			{ key: "off", label: "关", count: 0 },
			{ key: "star", label: "星光", count: 12 },
			{ key: "trail", label: "曳光", count: 28 },
			{ key: "firefly", label: "流萤", count: 80 },
		];
		function startAmbience(dock) {
			const wrap = document.createElement("div");
			wrap.className = "mediascape-dsh-amb";
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

			// 档位 UI 行：插到「景」面板（壁纸设置）——面板标题行之后。
			// 若面板尚不存在（挂载顺序问题），退化为 dock 直接追加行容器（防丢失，正常情况不触发）。
			// 交互：**单循环按钮**——点击循环到下一档（关→星光→曳光→流萤→关），
			// 按钮文字显示当前档位；关档按钮暗（无氛围=关闭态），其余档亮。
			const line = document.createElement("div");
			line.className = "mediascape-dsh-bg-line mediascape-dsh-amb-line";
			const lab = document.createElement("span");
			lab.className = "mediascape-dsh-bg-label";
			lab.textContent = "氛围";
			line.appendChild(lab);
			const cycleBtn = document.createElement("button");
			cycleBtn.type = "button";
			cycleBtn.className = "mediascape-dsh-bg-seg mediascape-dsh-amb-cycle";
			cycleBtn.textContent = "关";
			cycleBtn.title = "氛围：关";
			cycleBtn.addEventListener("click", () => {
				const idx = AMB_LEVELS.findIndex((l) => l.key === current);
				setLevel(AMB_LEVELS[(idx + 1) % AMB_LEVELS.length].key); // 循环下一档
			});
			line.appendChild(cycleBtn);
			const panel = dock.__mediascapeDshBgPanel || dock;
			if (panel === dock) line.style.display = "none"; // 面板缺失时隐藏该行（不误占 dock）
			panel.insertBefore(line, panel.firstChild);

			let current = "star"; // 当前档位
			function setLevel(key, instant) {
				const lv = AMB_LEVELS.find((l) => l.key === key) || AMB_LEVELS[0];
				current = lv.key;
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
				// 单循环按钮：文字 = 当前档位，亮暗 = 非关档亮（关档暗）
				cycleBtn.textContent = lv.label;
				cycleBtn.title = "氛围：" + lv.label;
				cycleBtn.classList.toggle("active", lv.key !== "off");
			}

			// 迁移旧值："1"→曳光、"0"→关、缺失→星光；其它旧档位键直接沿用
			const old = localStorage.getItem(LS_AMBIENCE);
			let initial = "star";
			if (old === "0") initial = "off";
			else if (old === "1") initial = "trail";
			else if (AMB_LEVELS.some((l) => l.key === old)) initial = old;
			setLevel(initial, true); // 首帧即时显示，不做渐变

			return () => {
				line.remove();
				wrap.remove();
			};
		}