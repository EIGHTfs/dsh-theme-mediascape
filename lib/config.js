/**
 * 配置与常量（静态资产 MIME / 白名单 / 上传限制 / 在线下载参数）
 */

import { statfsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 开发工作台目录名（配色盘/预览页/自测脚本所在地，2026-09-22 由旧目录名改名而来）。
// 目录若再改名只需改这一处——ensureDebugServer 拉服务、build 读配置都经此常量定位。
export const STUDIO_DIR = 'theme-studio';

export const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

/** 允许被静态服务的顶层目录（相对插件根；assets 已废弃删除，资源全在线/上传；boot=开屏动画）。 */
export const ALLOWED_DIRS = new Set(['boot', 'music', 'wallpaper']);

/** 视频扩展名集合（浏览器原生可播的容器；kind 判定单点权威，2026-09-2x 加：视频不只 mp4，含 webm）。 */
export const VIDEO_EXT = new Set(['.mp4', '.webm']);

/** 上传文件允许的扩展名（与客户端 input accept 一致）。 */
export const ALLOWED_UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm']);

/** 音乐上传允许的扩展名（addSong 真实落盘 music/）。 */
export const ALLOWED_MUSIC_UPLOAD_EXT = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.flac']);

/** 音乐封面上传允许的扩展名（setCover 真实落盘 music/）。 */
export const ALLOWED_COVER_UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** 上传文件选择器 accept 值（由 ALLOWED_UPLOAD_EXT 派生，单一权威；build 时注入客户端）。 */
export const UPLOAD_ACCEPT = [...ALLOWED_UPLOAD_EXT].join(',');

/**
 * 单文件上传上限（字节）——按磁盘剩余空间动态计算，不写死。
 * 策略：单文件最多占用「当前剩余可用空间」的一定比例（默认 80%），
 * 同时设一个硬底线（默认 512MB）保证常规壁纸/短视频总能传；
 * statfs 不可用时回退 1GB。上限随磁盘余量自动伸缩：装得下就传，快满了自动收紧。
 */
const MAX_UPLOAD_RATIO = 0.8;      // 单文件最多占用剩余空间的 80%

const MIN_UPLOAD_LIMIT = 512 * 1024 * 1024; // 硬底线 512MB

const FALLBACK_UPLOAD_LIMIT = 1024 * 1024 * 1024; // statfs 失败回退 1GB

export function uploadLimitBytes(dir) {
  try {
    const s = statfsSync(dir);
    const avail = s.bavail * s.bsize; // bavail=非 root 可用块数，bsize=块大小
    if (!(avail > 0)) return FALLBACK_UPLOAD_LIMIT;
    // 受 2^53 安全整数约束（实际磁盘远达不到），Math.floor 求整
    const bySpace = Math.floor(avail * MAX_UPLOAD_RATIO);
    return Math.max(bySpace, MIN_UPLOAD_LIMIT);
  } catch {
    return FALLBACK_UPLOAD_LIMIT;
  }
}
