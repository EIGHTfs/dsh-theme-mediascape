		// ═══════════ 2. 素材（2026-09-21 起不再 build 内嵌，全部运行时 API 拉取）═══════════
		// 壁纸清单（运行时 GET /theme-mediascape-assets/wallpaper/list 拉取，含上传+在线）
		const WALLPAPERS = /*__BG_MANIFEST_START__*/[]/*__BG_MANIFEST_END__*/;
		// 开屏素材（2026-09-22 起不再 build 注入，GIF_DATA 恒 null：开屏内容完全按运行时 fetch boot/boot.json 的 file/files 决定）
		const GIF_DATA = /*__GIF_START__*/""/*__GIF_END__*/;
		// 背景音乐清单（运行时 GET /theme-mediascape-assets/music/list 拉取，含封面）
		const MUSIC = /*__MUSIC_START__*/[]/*__MUSIC_END__*/;
		// 内置歌曲默认封面（已废弃：运行时音乐列表带 cover 字段）
		const DEFAULT_COVER = /*__DEFAULT_COVER_START__*/null/*__DEFAULT_COVER_END__*/;
