		// dsh-skip-func-length（startSoundPanel 巨型函数 113 行，函数级拆分列为后续优化项，本次仅文件级拆分）
		// ═══════════ 7. 打字音效（Web Audio 合成，无音频文件）═══════════
		let typeAudioCtx = null;
		let typeNoiseBuf = null;
		function ensureTypeAudio() {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (AC === undefined) return null;
			if (typeAudioCtx === null) typeAudioCtx = new AC();
			if (typeAudioCtx.state === "suspended") typeAudioCtx.resume().catch(() => {});
			return typeAudioCtx;
		}
		function typeNoiseBuffer(ctx) {
			if (typeNoiseBuf !== null) return typeNoiseBuf;
			const len = Math.floor(ctx.sampleRate * 0.05);
			const buf = ctx.createBuffer(1, len, ctx.sampleRate);
			const data = buf.getChannelData(0);
			for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
			typeNoiseBuf = buf;
			return buf;
		}
		function playTypeClick(key) {
			const ctx = ensureTypeAudio();
			if (ctx === null || ctx.state !== "running") return;
			const t = ctx.currentTime;
			const src = ctx.createBufferSource();
			src.buffer = typeNoiseBuffer(ctx);
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			const base = key === " " ? 1400 : key === "Enter" ? 1050 : 2100;
			bp.frequency.value = base + Math.random() * 700;
			bp.Q.value = 1.4;
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.06 + Math.random() * 0.04, t + 0.002);
			g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
			src.connect(bp); bp.connect(g); g.connect(ctx.destination);
			src.start(t); src.stop(t + 0.06);
			const osc = ctx.createOscillator();
			osc.type = "sine";
			const f0 = key === "Enter" ? 150 : key === " " ? 110 : 120 + Math.random() * 30;
			osc.frequency.setValueAtTime(f0, t);
			osc.frequency.exponentialRampToValueAtTime(50, t + 0.05);
			const g2 = ctx.createGain();
			g2.gain.setValueAtTime(0.0001, t);
			g2.gain.exponentialRampToValueAtTime(0.045, t + 0.003);
			g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
			osc.connect(g2); g2.connect(ctx.destination);
			osc.start(t); osc.stop(t + 0.07);
		}
		function startSoundPanel(dock) {
			const LS_VOL = "ff_vol";
			const LS_MUTED = "ff_muted";
			function loadVol() { return Math.min(100, Math.max(0, parseInt(localStorage.getItem(LS_VOL) || "80", 10) || 80)); }
			function loadMuted() { return localStorage.getItem(LS_MUTED) !== "0"; }
			function saveVol(v) { try { localStorage.setItem(LS_VOL, String(v)); } catch (e) {} }
			function saveMuted(m) { try { localStorage.setItem(LS_MUTED, m ? "1" : "0"); } catch (e) {} }
			// 供主壁纸 render() 读取：当前音量(0-100) 与 是否静音
			window.__ffSoundVol = loadVol;
			window.__ffSoundMuted = loadMuted;

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ff-snd-toggle ff-dock-btn";
			btn.textContent = "声";
			btn.title = "声音设置";
			dock.appendChild(btn);

			const menu = document.createElement("div");
			menu.className = "ff-snd-menu";
			// ── 打字音效开关 ──
			const line1 = document.createElement("div");
			line1.className = "ff-snd-line";
			const lab1 = document.createElement("span");
			lab1.className = "ff-snd-label";
			lab1.textContent = "打字音效";
			const tbox = document.createElement("span");
			tbox.className = "ff-snd-toggle-box" + (localStorage.getItem(LS_TYPESOUND) !== "0" ? " on" : "");
			tbox.title = "打字音效开关";
			const setTypeBox = (on) => tbox.classList.toggle("on", on);
			tbox.addEventListener("click", () => {
				const on = localStorage.getItem(LS_TYPESOUND) === "0";
				localStorage.setItem(LS_TYPESOUND, on ? "1" : "0");
				setTypeBox(on);
				if (on) playTypeClick(""); // 点击开启时给一次试听反馈
			});
			line1.appendChild(lab1); line1.appendChild(tbox);
			menu.appendChild(line1);

			// ── 壁纸视频音量条 + 喇叭静音 ──
			const line2 = document.createElement("div");
			line2.className = "ff-snd-line";
			const lab2 = document.createElement("span");
			lab2.className = "ff-snd-label";
			lab2.textContent = "壁纸音量";
			const ico = document.createElement("button");
			ico.type = "button";
			ico.className = "ff-snd-vol-ico";
			const vol = document.createElement("input");
			vol.type = "range";
			vol.className = "ff-snd-vol";
			vol.min = "0"; vol.max = "100"; vol.step = "1";
			vol.value = String(loadVol());
			const syncIco = () => {
				const muted = loadMuted();
				const silent = muted || loadVol() === 0;
				ico.textContent = "音";
				ico.classList.toggle("on", !silent);
			};
			syncIco();
			// 喇叭：单击切换静音/取消静音（不改音量条的值）
			ico.addEventListener("click", () => {
				const muted = loadMuted();
				saveMuted(!muted);
				syncIco();
				applyVideoSound();
			});
			// 音量条：拖动改音量，同时取消静音
			vol.addEventListener("input", () => {
				const v = parseInt(vol.value, 10) || 0;
				saveVol(v);
				if (v > 0 && loadMuted()) saveMuted(false);
				syncIco();
				applyVideoSound();
			});
			line2.appendChild(lab2); line2.appendChild(ico); line2.appendChild(vol);
			menu.appendChild(line2);

			dock.appendChild(menu);

			function applyVideoSound() {
				const muted = loadMuted();
				const v = loadVol() / 100;
				document.querySelectorAll(".ff-bg video").forEach((el) => {
					el.volume = v;
					el.muted = muted;
				});
			}

			btn.addEventListener("click", () => {
				menu.classList.toggle("open");
				btn.classList.toggle("on", menu.classList.contains("open"));
			});
			const onDocClick = (e) => {
				if (!menu.contains(e.target) && e.target !== btn) {
					menu.classList.remove("open");
					btn.classList.remove("on");
				}
			};
			document.addEventListener("click", onDocClick);

			const onKeydown = (e) => {
				if (localStorage.getItem(LS_TYPESOUND) === "0") return;
				const el = e.target;
				if (el === null || el.tagName !== "TEXTAREA") return;
				if (e.metaKey || e.ctrlKey || e.altKey) return;
				playTypeClick(e.key === "Enter" ? "Enter" : e.key === " " ? " " : "");
			};
			document.addEventListener("keydown", onKeydown, true);

			return () => {
				document.removeEventListener("keydown", onKeydown, true);
				document.removeEventListener("click", onDocClick);
				btn.remove();
				menu.remove();
				delete window.__ffSoundVol;
				delete window.__ffSoundMuted;
			};
		}

