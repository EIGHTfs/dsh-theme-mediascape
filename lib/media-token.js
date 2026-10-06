// 反代鉴权 token 捕获（供 DSH 反代场景下媒体请求携带 token，避免被 302 打断 Range 流）。
//
// 背景与机制：
//   DSH 的 web 入口启动时会打印形如 `dsh web: http://127.0.0.1:<port>/?token=xxx` 的访问地址。
//   插件与 DSH 同一进程，无法重新读取已被消费的 stdout 管道；
//   但插件 apply 执行早于 DSH 打印访问地址，因此在 apply 阶段包装 process.stdout.write，
//   即可在打印瞬间捕获同一个 token（只读取输出分片、原样透传，不改变任何既有日志行为）。
//   兜底：若插件加载晚于打印（极端情形，例如宿主先起 web 再装载插件），
//   回读 DSH 输出日志文件，用同一正则提取最近一次 token（路径按 DSH_PROXY_LOG / DSH_HOME 推导）。
//
// 用途：插件向 Web 端提供 GET /theme-mediascape-assets/media-token，前端把 token 拼到媒体 URL 上，
//   使 HTMLMediaElement 的 Range 请求直接命中（不经过 302 重定向），保留 206 分段流式加载。

import { existsSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';

// token 形如 r-JEflGN38_flupP_EjWaWYiYJXtDAhITK4pZLiPqnI（长度不定，字符集 [A-Za-z0-9_-]）
// 下限 6 位用于排除误匹配的短串，上限不设（真实 token 可能较长）
const TOKEN_RE = /token=([A-Za-z0-9_-]{20,})/g; // 长度下限 20 位：排除误匹配的短串，真实 token 远长于此
// 日志兜底只读文件尾部这一段（避免大日志全量读入内存；token 行在启动输出里，通常在文件前部，
// 但服务重启后日志被覆盖/追加，取尾部仍能覆盖「最近一次启动」的输出）
const LOG_TAIL_BYTES = 256 * 1024;

let capturedToken = '';   // 主路径捕获结果（进程内缓存）
let hookInstalled = false; // 幂等标记：process.stdout.write 只包装一次

/** 从任意文本分片里提取 token；取不到返回空串。 */
function extractToken(text) {
  const m = String(text).match(TOKEN_RE);
  if (!m || !m.length) return '';
  return m[m.length - 1].replace('token=', ''); // 取最后一次（最近一次启动/请求打印的 token）
}

/**
 * 安装 stdout 捕获钩子（幂等）。
 * 包装 process.stdout.write：检查每个输出分片里是否含 token=，命中则缓存；原样透传返回值。
 */
export function installTokenCapture() {
  if (hookInstalled) return;
  hookInstalled = true;
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function patchedWrite(chunk, ...rest) {
    try {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      const t = extractToken(text);
      if (t) capturedToken = t; // 只记最近一次（DSH 重启会打印新 token）
    } catch (e) { /* 捕获失败不影响正常输出，静默继续 */ }
    return origWrite(chunk, ...rest);
  };
}

/**
 * DSH 输出可能落地到的日志文件候选（按环境推导，不硬编码单一路径）。
 * 首选 dsh-proxy.log（DSH_PROXY_LOG 环境变量优先，否则按 DSH_HOME 推导）；其余为不同部署形态下的补充候选。
 */
function logCandidates() {
  const dshHome = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  const parent = dirname(dshHome);
  return [
    process.env.DSH_PROXY_LOG || join(dshHome, 'dsh-proxy.log'), // 反代日志（DSH 反代请求日志，含 token 重定向记录）
    join(parent, 'DeepSeekHarness-NAS.log'),                      // DSH 启动输出日志（套件形态）
    join(dshHome, 'dsh.log'),
  ];
}

/** 读取单个文件尾部字节（文件不存在/不可读返回空串）。 */
function readTail(file, bytes) {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size === 0) return '';
    const len = Math.min(bytes, st.size);
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.size - len);
      return buf.toString('utf8');
    } finally { closeSync(fd); }
  } catch (e) { return ''; }
}

/** 兜底路径：从候选日志尾部提取 token（与主路径同一正则）。 */
function tokenFromLogs() {
  for (const file of logCandidates()) {
    if (!existsSync(file)) continue;
    const t = extractToken(readTail(file, LOG_TAIL_BYTES));
    if (t) return t;
  }
  return '';
}

/**
 * 取当前 DSH 反代鉴权 token。
 * 顺序：① stdout 捕获（主）② 日志兜底。都取不到返回空串（前端按无 token 处理，行为与既有实现一致）。
 */
export function getDshToken() {
  if (capturedToken) return capturedToken;
  return tokenFromLogs();
}

/** 供诊断：返回捕获来源（hook / log / none），不带出 token 明文。 */
export function tokenSource() {
  if (capturedToken) return 'hook';
  return tokenFromLogs() ? 'log' : 'none';
}
