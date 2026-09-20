		// ═══════════ 2. 素材（base64，由 build.cjs 注入）═══════════
		// 壁纸清单：{ id, kind: "image"|"video", mime, data: dataURI, label }
		const WALLPAPERS = /*__BG_MANIFEST_START__*/[]/*__BG_MANIFEST_END__*/;
		// 开屏变身动图
		const GIF_DATA = /*__GIF_START__*/""/*__GIF_END__*/;
		// 背景音乐清单（build.cjs 注入）：{ id, mime, data: dataURI, label }
		const MUSIC = /*__MUSIC_START__*/[]/*__MUSIC_END__*/;
		// 内置歌曲开箱即用默认封面（虚拟歌手「知更鸟」图片，build.cjs 从 music/figure/ 注入）
		const DEFAULT_COVER = /*__DEFAULT_COVER_START__*/null/*__DEFAULT_COVER_END__*/;
		// 表情包（已停用 2026-09-20：build 不再注入、startEmotes 不调用，常量保留为死代码）
		const EMOTES = /*__EMOTES_START__*/[]/*__EMOTES_END__*/;

