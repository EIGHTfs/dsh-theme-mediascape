		// ═══════════ 7.8 表情包隐藏彩蛋（按用户消息关键词触发）═══════════
		function startEmotes() {
			const map = {};
			(Array.isArray(EMOTES) ? EMOTES : []).forEach((e) => { map[e.id] = e.url || e.data; });

			const overlay = document.createElement("div");
			overlay.className = "ff-emote";
			const img = document.createElement("img");
			overlay.appendChild(img);
			document.body.appendChild(overlay);

			let hideTimer = null, lastShown = 0, turnLocked = false;
			function showEmote(name) {
				const data = map[name];
				if (!data) return;
				const now = Date.now();
				if (now - lastShown < 2500) return; // 冷却，避免连闪
				lastShown = now;
				turnLocked = true; // 每个回合最多展示一次
				img.src = data;
				overlay.classList.add("show");
				if (hideTimer) clearTimeout(hideTimer);
				hideTimer = setTimeout(() => overlay.classList.remove("show"), 3200);
			}

			// 用户侧触发词（由 Enter 捕获用户输入）
			const USER_RULES = [
				["得意", /厉害|牛逼|太强|666|大神|佩服|绝了/i],
				["开心", /谢谢|感谢|太棒|真好|不错|满意|喜欢|赞|优秀|很好|太好|好耶/],
				["变身", /开干|开工|开始|动手|走起|冲|搞起|出发|干活/],
			];
			// 助手侧触发词（由 DOM 监听助手回复）
			const ASSIST_RULES = [
				["没错", /没错|正是|确实|对极了/],
				["期待", /提供|发我|上传|发一下|给我|给个|请.*(发|给|提供|上传|告诉)/],
				["疑惑", /确认一下|是否|可以吗|要不要|需不需要|要我.*吗|帮你.*吗|你.*确认/],
			];
			function classify(text, rules) {
				for (const [name, re] of rules) if (re.test(text)) return name;
				return null;
			}

			// 1) 用户输入：Enter 发送时分类（开心/得意/变身）
			const onUserKey = (e) => {
				if (e.key !== "Enter") return;
				const t = e.target;
				if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
				turnLocked = false; // 新回合，解锁
				const name = classify(t.value || "", USER_RULES);
				if (name) showEmote(name);
			};
			document.addEventListener("keydown", onUserKey, true);

			// 2) 助手回复：MutationObserver 监听新增文本（疑惑/没错/期待）
			let buf = "", flushTimer = null;
			const observer = new MutationObserver((muts) => {
				let added = "";
				for (const m of muts) {
					for (const n of m.addedNodes) {
						if (n.nodeType !== 1) continue;
						if (n.closest && n.closest(".ff-emote, .ff-bg-panel, .ff-amb-menu, .ff-music-card, .ff-music-mini, .ff-ms-picker, .ff-amb, .ff-boot")) continue;
						if (n.matches && n.matches("textarea, input, .ff-boot")) continue;
						const txt = (n.textContent || "").trim();
						if (txt.length > 1) added += " " + txt;
					}
				}
				if (!added.trim()) return;
				buf += " " + added;
				if (flushTimer) clearTimeout(flushTimer);
				flushTimer = setTimeout(() => {
					const text = buf;
					buf = "";
					if (turnLocked) return; // 本回合已展示过表情
					const name = classify(text, ASSIST_RULES);
					if (name) showEmote(name);
				}, 1500);
			});
			observer.observe(document.body, { childList: true, subtree: true });

			return () => {
				document.removeEventListener("keydown", onUserKey, true);
				observer.disconnect();
				if (flushTimer) clearTimeout(flushTimer);
				if (hideTimer) clearTimeout(hideTimer);
				overlay.remove();
			};
		}

