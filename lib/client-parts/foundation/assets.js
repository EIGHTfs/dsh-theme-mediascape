		// ═══════════ 2. 素材（base64，由 build.cjs 注入）═══════════
		// 壁纸清单：{ id, kind: "image"|"video", mime, data: dataURI, label }
		const WALLPAPERS = /*__FIREFLY_BG_MANIFEST_START__*/[]/*__FIREFLY_BG_MANIFEST_END__*/;
		// 开屏变身动图
		const GIF_DATA = /*__FIREFLY_GIF_START__*/""/*__FIREFLY_GIF_END__*/;
		// 背景音乐清单（build.cjs 注入）：{ id, mime, data: dataURI, label }
		const MUSIC = /*__FIREFLY_MUSIC_START__*/[]/*__FIREFLY_MUSIC_END__*/;
		// 内置歌曲开箱即用默认封面（虚拟歌手「知更鸟」图片，build.cjs 从 music/figure/ 注入）
		const DEFAULT_COVER = /*__FIREFLY_DEFAULT_COVER_START__*/null/*__FIREFLY_DEFAULT_COVER_END__*/;
		// 表情包（已停用 2026-09-20：build 不再注入、startEmotes 不调用，常量保留为死代码）
		const EMOTES = /*__FIREFLY_EMOTES_START__*/[]/*__FIREFLY_EMOTES_END__*/;

