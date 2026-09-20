/**
 * dsh-theme-mediascape —— 媒体景观主题（浏览器端；风格素材沿用「流萤」立绘/霓虹配色）
 * dsh-skip-func-length（巨型函数拆分列为后续优化项，1.0.2 已拆服务端，浏览器端拆分另行评估）
 *
 * 实现机制与 dsh-theme-cyberpunk2077 相同：
 *   1. window.__ModuleLoader__.load() 注册为 DSH 客户端模块；
 *   2. 导出 { isPlugin, inject: ["theme"], apply }；
 *   3. apply(ctx) 里 ctx.theme.register({ id, colorScheme, tokens }) 注册
 *      设计令牌（--dsw-* 变量）并 setTheme 激活；
 *   4. 注入身份层 <style>：
 *      - 壁纸背景（图片或 mp4 动态壁纸，可切换；清单运行时 /wallpaper/list 拉取）
 *      - 开屏动画：GIF（运行时 fetch GIF/boot.json 配置指定文件）
 *      - 萤火绿霓虹配色、萤火氛围粒子、打字音效、彩蛋
 *
 * 构建：node build.cjs （拼接本目录片段；资源不内嵌，壁纸/音乐清单运行时 API 拉取）
 */
window.__ModuleLoader__.load({
	id: "dsh-theme-mediascape",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

