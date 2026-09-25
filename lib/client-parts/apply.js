		// ═══════════ 9. apply ═══════════
		function apply(ctx) {
			ctx.effect(() => {
				// 0) 旧前缀 localStorage 键迁移（ff_* → mediascape-dsh-*，2026-09-21 前缀统一）
				migrateLegacyKeys();

				// 1) 注入身份层样式
				if (!document.querySelector("style[data-mediascape-theme]")) {
					const style = document.createElement("style");
					style.dataset.mediascapeTheme = THEME_ID;
					style.textContent = identityCSS();
					document.head.appendChild(style);
				}

				// 1.4) 幂等清理（防重复 apply/热重载叠层）——必须先停旧媒体再删元素：
				// DOM remove() 不会暂停 video/audio（元素移除后仍继续播放）→ 直接删容器会新旧
				// 声音叠加（2026-09-2x 实测 bug：每次重新 build，原播放视频的音乐不消失叠加）。
				// 含旧开屏浮层 .mediascape-dsh-boot（开屏视频也可能在播）——必须在 playTransformIntro
				// 创建新浮层之前清理；音乐播放器 audio 是独立 Audio() 实例（不在 DOM），经全局引用停。
				{
					const stopMedia = (root) => {
						if (!root) return;
						root.querySelectorAll("video, audio").forEach((m) => {
							try { m.pause(); m.removeAttribute("src"); m.load(); } catch (e) { /* 已销毁 */ }
						});
					};
					document.querySelectorAll(
						".mediascape-dsh-boot, .mediascape-dsh-dock, .mediascape-dsh-bg, .mediascape-dsh-bg-panel, " +
						".mediascape-dsh-bg-picker, .mediascape-dsh-ms-picker, .mediascape-dsh-music-card, " +
						".mediascape-dsh-snd-menu, .mediascape-dsh-font-menu"
					).forEach((el) => { stopMedia(el); el.remove(); });
					const msAudio = window.__mediascapeDshMusicAudio;
					if (msAudio) { try { msAudio.pause(); msAudio.removeAttribute("src"); msAudio.load(); } catch (e) { /* 已销毁 */ } }
				}

				// 1.5) 开屏最先加载（身份样式后立即、不 await——浮层先铺最上，消除 DSH 界面先出的黑屏窗口；
				// 素材/多画面配置由 boot.js 后台取回重建，GIF_DATA 或纯色兜底立即显示，z-index 99999 已有）
				playTransformIntro();

				// 2) 注册主题并激活
				try {
					ctx.theme.register({
						id: THEME_ID,
						colorScheme: "dark",
						tokens: TOKENS
					});
					ctx.theme.setTheme(THEME_ID);
				} catch (e) {
					console.error("dsh-theme-mediascape register failed", e);
				}

				// 3) 锁深色（防止主题服务切回亮色把壁纸冲淡）
				document.documentElement.style.colorScheme = "dark";
				document.body.toggleAttribute("data-ds-dark-theme", true);
				const darkObserver = new MutationObserver(() => {
					document.documentElement.style.colorScheme = "dark";
					document.body.toggleAttribute("data-ds-dark-theme", true);
				});
				darkObserver.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });

				// 4) 右下角可拖动工具条（承载按钮，弹层跟随其位置）
				// 幂等清理已前移到 1.4（先停旧媒体再删元素，防声音叠加）——此处不再重复清理
				const dockState = startDock();
				const dock = dockState.el;

				// 4.5) 字体大小（先挂载，按钮排最上）
				const stopFont = startFont(dock);

				// 4.6) 壁纸（图片/动态视频，可切换；萤火氛围档位内嵌于面板）
				const stopWallpaper = startWallpaper(dock);

				// 4.65) 上传进度（2026-09-23：dock「传」按钮 + 二级面板 + 统一上传入口）
				const stopUploadHud = startUploadHud(dock);

				// 4.7) 萤火氛围粒子（档位行嵌入「景」面板；需在 startWallpaper 之后——panel 已创建）
				const stopAmbience = startAmbience(dock);

				// 5) 声音设置（打字音效 + 壁纸音量）
				const stopType = startSoundPanel(dock);

				// 6) 背景音乐（最后挂载，按钮排最下）
				const stopMusic = startMusic(dock);

				// 6.5) dock 按钮排序（2026-09-23 定稿）：景 乐 声 字 传
				// 各 start* 按内部 append 顺序排列，这里统一按 class 重排 DOM 顺序。
				{
					const order = [".mediascape-dsh-bg-toggle", ".mediascape-dsh-music-btn, [data-act]", ".mediascape-dsh-snd-toggle", ".mediascape-dsh-font-toggle", ".mediascape-dsh-upload-toggle"];
					// 简单方式：已知四个按钮类，按目标顺序逐个 appendChild（移动节点即重排）
					const pick = (cls) => dock.querySelector(cls);
					const targets = [".mediascape-dsh-bg-toggle", ".mediascape-dsh-upload-toggle", ".mediascape-dsh-snd-toggle", ".mediascape-dsh-font-toggle"];
					// 乐按钮：音乐卡片/按钮类名未定，从 dock 找「乐」文字按钮
					const allBtns = [...dock.querySelectorAll(".mediascape-dsh-dock-btn")];
					const btnByText = (t) => allBtns.find((b) => b.textContent === t);
					const seq = [btnByText("景"), btnByText("乐"), btnByText("声"), btnByText("字"), btnByText("传")];
					for (const b of seq) if (b) dock.appendChild(b); // append 已存在节点 = 移到末尾，按序实现目标顺序
				}

				// 7) ESC 一键关闭所有右下角浮层
				const onEsc = (e) => {
					if (e.key !== "Escape") return;
					document.querySelectorAll(".mediascape-dsh-bg-panel.open, .mediascape-dsh-bg-picker.open, .mediascape-dsh-ms-picker.open, .mediascape-dsh-font-menu.open").forEach((el) => el.classList.remove("open"));
					// ESC 关闭浮层时同步熄灭 dock 按钮高亮（字/景/声 的 .on 态跟随面板开关）
					document.querySelectorAll(".mediascape-dsh-font-toggle.on, .mediascape-dsh-bg-toggle.on, .mediascape-dsh-snd-toggle.on").forEach((el) => el.classList.remove("on"));
					if (dock.__mediascapeDshMusicEscape) dock.__mediascapeDshMusicEscape();
				};
				document.addEventListener("keydown", onEsc);

				return () => {
					document.removeEventListener("keydown", onEsc);
					darkObserver.disconnect();
					stopFont();
					stopWallpaper();
					stopUploadHud();
					stopAmbience();
					stopType();
					stopMusic();
					dockState.dispose();
					document.querySelectorAll("style[data-mediascape-theme]").forEach((s) => s.remove());
				};
			}, "dsh-theme-mediascape: apply");
		}

		exports.isPlugin = true;
		exports.inject = ["theme"];
		exports.apply = apply;
		return module.exports;
	}
});
