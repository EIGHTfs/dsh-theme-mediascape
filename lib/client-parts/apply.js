		// ═══════════ 9. apply ═══════════
		function apply(ctx) {
			ctx.effect(() => {
				// 1) 注入身份层样式
				if (!document.querySelector("style[data-mediascape-theme]")) {
					const style = document.createElement("style");
					style.dataset.mediascapeTheme = THEME_ID;
					style.textContent = identityCSS();
					document.head.appendChild(style);
				}

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

				// 4) 右下角可拖动工具条（承载四个按钮，弹层跟随其位置）
				const dockState = startDock();
				const dock = dockState.el;

				// 4.5) 背景音乐（先挂载，按钮排最左）
				const stopMusic = startMusic(dock);

				// 4.6) 壁纸（图片/动态视频，可切换）
				const stopWallpaper = startWallpaper(dock);

				// 5) 开屏变身动画（每次加载播放）
				playTransformIntro();

				// 6) 萤火氛围
				const stopAmbience = startAmbience(dock);

				// 7) 声音设置（打字音效 + 壁纸音量，排最右）
				const stopType = startSoundPanel(dock);

				// 8) 彩蛋（SAM 重播开屏）
				const stopEgg = startEasterEgg();

				// 8.5) 表情包彩蛋（已停用 2026-09-20：startEmotes 保留为死代码不再调用，GIF/表情包/ 文件保留）
				// const stopEmotes = startEmotes();

				// 8.6) ESC 一键关闭所有右下角浮层
				const onEsc = (e) => {
					if (e.key !== "Escape") return;
					document.querySelectorAll(".ff-bg-panel.open, .ff-amb-menu.open, .ff-bg-picker.open, .ff-ms-picker.open").forEach((el) => el.classList.remove("open"));
					if (dock.__ffMusicEscape) dock.__ffMusicEscape();
				};
				document.addEventListener("keydown", onEsc);

				return () => {
					document.removeEventListener("keydown", onEsc);
					darkObserver.disconnect();
					stopWallpaper();
					stopAmbience();
					stopType();
					stopMusic();
					stopEgg();
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
