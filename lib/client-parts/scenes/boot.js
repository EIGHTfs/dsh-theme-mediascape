		// ═══════════ 4. 开屏变身动画（GIF / 视频版）═══════════
// 运行时配置：boot/boot.json（{file, title, sub, durationMs}），fetch 失败回退 build 注入的 GIF_DATA。
// file 支持 .gif/.png（<img>）与 .mp4（<video muted loop autoplay>，启动画面无声音）；
// title/sub 为可配置文案（默认空字符串 = 不显示），durationMs 默认 3000（约 3 秒一循环）。
let bootGifUrl = GIF_DATA;
let bootTitle = "";
let bootSub = "";
let bootDurationMs = 3000;
async function loadBootGifConfig() {
  try {
    const resp = await fetch("/theme-mediascape-assets/boot/boot.json");
    if (!resp.ok) return;
    const cfg = await resp.json();
    if (cfg && typeof cfg.file === "string" && cfg.file) bootGifUrl = "/theme-mediascape-assets/boot/" + encodeURIComponent(cfg.file);
    if (cfg && typeof cfg.title === "string") bootTitle = cfg.title;
    if (cfg && typeof cfg.sub === "string") bootSub = cfg.sub;
    if (cfg && Number.isFinite(+cfg.durationMs) && +cfg.durationMs > 0) bootDurationMs = +cfg.durationMs;
  } catch { /* 网络/解析失败保留默认，不影响开屏 */ }
}
function buildBootOverlay() {
	const ov = document.createElement("div");
	ov.className = "ff-boot";
	// 按扩展名选择渲染方式：.mp4 → <video muted loop autoplay playsinline>（无声音）；其余（.gif/.png/.webp）→ <img>
	const isVideo = /\.mp4$/i.test(bootGifUrl);
	const mediaHtml = isVideo
		? '<video class="ff-gif" src="' + bootGifUrl + '" muted loop autoplay playsinline></video>'
		: '<img class="ff-gif" src="' + bootGifUrl + '" alt="流萤变身">';
	// 文案为空字符串则不渲染对应元素（默认全空，只显示媒体本身）
	const titleHtml = bootTitle ? '<div class="ff-title">' + bootTitle + '</div>' : "";
	const subHtml = bootSub ? '<div class="ff-sub">' + bootSub + '</div>' : "";
	ov.innerHTML =
		mediaHtml +
		titleHtml +
		subHtml +
		'<button class="ff-skip" type="button">点击跳过</button>';
	return ov;
}

async function playTransformIntro() {
	if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	await loadBootGifConfig(); // 读 boot/boot.json（改配置刷新即生效，无需重新 build）
	const ov = buildBootOverlay();
	document.body.appendChild(ov);
	let done = false;
	const timers = [];
	const finish = () => {
		if (done) return;
		done = true;
		timers.forEach(clearTimeout);
		ov.classList.add("gone");
		setTimeout(() => ov.remove(), 520);
	};
	ov.querySelector(".ff-skip").addEventListener("click", finish);
	ov.addEventListener("click", (e) => { if (e.target === ov) finish(); });
	// 播放时长取配置 durationMs（缺省 10s）；点击可随时跳过
	timers.push(setTimeout(finish, bootDurationMs));
}

