#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# client.template.js 按职责切分为 lib/parts/ 片段（浏览器单文件 bundle 拆源）。
# 铁律：parts 按序拼接后必须与原文件逐字节一致（build.cjs 用拼接结果生成 client.js，
#       拼回顺序不变 → 产物与拆分前基线一致，行为零风险）。
# 用法：python3 split-template.py          # 正式拆分
#       python3 split-template.py --dry    # 只预演（打印片段清单与行数，不写盘）
import sys, os, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # scripts/ 的上级 = 仓库根
SRC = os.path.join(ROOT, "lib", "client.template.js")
PARTS_DIR = os.path.join(ROOT, "lib", "parts")

# (文件名, 起始行, 结束行) —— 行号与原文件一一对应（1-based 闭区间）
# 边界选在「段注释行的前一个空行」与「下一段的注释行前」，即每段起点=该段注释行，终点=下一段注释行的前一行
PLAN = [
    ("00-head.js",          1,   22),   # 注释头 + ModuleLoader.load + factory 开头 + module/exports
    ("01-constants.js",    23,   32),   # THEME_ID 与 localStorage 键常量
    ("02-tools.js",        33,  106),   # sha1Hex + IndexedDB 工具
    ("03-tokens.js",      107,  200),   # 设计令牌层 TOKENS
    ("04-assets.js",      201,  212),   # 素材占位符（WALLPAPERS/GIF_DATA/MUSIC/DEFAULT_COVER/EMOTES）
    ("05-identity-css.js",213,  468),   # 身份层 CSS（identityCSS）
    ("06-boot.js",        469,  512),   # 开屏变身动画（bootGifUrl/loadBootGifConfig/buildBootOverlay/playTransformIntro）
    ("07-wallpaper.js",   513,  860),   # 壁纸系统 上半：类型选择/切换/随机/面板/选择器（startWallpaper 主体）
    ("08-wallpaper-upload.js", 861, 997), # 壁纸系统 下半：上传（addWallpaper）
    ("09-ambience.js",    998, 1090),   # 常驻萤火氛围
    ("10-typesound.js",  1091, 1258),   # 打字音效（Web Audio）
    ("11-music-parts.js",1259, 1483),   # 音乐播放器 上半：封面提取/工具
    ("12-music-player.js",1484,1836),   # 音乐播放器 下半：播放器主体
    ("13-emotes.js",     1837, 1924),   # 表情包（死代码保留 2026-09-20 停用）
    ("14-egg.js",        1925, 1942),   # 彩蛋：SAM 重播开屏
    ("15-dock.js",       1943, 2062),   # 可拖动工具条
    ("16-apply.js",      2063, 2147),   # apply + exports 收尾
]

def read_lines():
    with io.open(SRC, "r", encoding="utf-8", newline="") as f:
        return f.read().split("\n")

def dry_run(lines):
    total = 0
    print(f"原文件 {len(lines)} 行（split('\\n') 计数）→ {len(PLAN)} 片段")
    prev_end = 0
    for name, s, e in PLAN:
        n = e - s + 1
        total += n
        flag = "⚠️" if n > 400 else ""
        print(f"  {name:<24} L{s}-{e}  {n:>4} 行 {flag}")
        if s != prev_end + 1:
            print(f"    ❌ 行区间不连续：期望起点 {prev_end+1}，实际 {s}")
        prev_end = e
    last = PLAN[-1][2]
    if last != len(lines):
        print(f"    ⚠️ 未覆盖尾行：最后片段到 {last}，文件是 {len(lines)} 行")
    print(f"覆盖 {total}/{len(lines)} 行（多余空格/末尾换行不计）")

def split(lines):
    os.makedirs(PARTS_DIR, exist_ok=True)
    for name, s, e in PLAN:
        content = "\n".join(lines[s-1:e]) + "\n"  # 每片段以换行结尾，拼接后与原文件相同（原文件每行以 \n 分隔，末尾亦以 \n 结尾）
        with io.open(os.path.join(PARTS_DIR, name), "w", encoding="utf-8", newline="") as f:
            f.write(content)
        print(f"  写了 {name}")

def verify():
    # 铁律验证：parts 拼接 == 原文件（逐字节）
    joined = ""
    for name, _, _ in PLAN:
        with io.open(os.path.join(PARTS_DIR, name), "r", encoding="utf-8", newline="") as f:
            joined += f.read()
    with io.open(SRC, "r", encoding="utf-8", newline="") as f:
        orig = f.read()
    ok = joined == orig
    print("拼接验证：" + ("✅ parts 拼接 == 原文件（逐字节一致）" if ok else "❌ 不一致！"))
    return ok

if __name__ == "__main__":
    lines = read_lines()
    dry_run(lines)
    if "--dry" in sys.argv:
        sys.exit(0)
    split(lines)
    if not verify():
        sys.exit(1)
    print("拆分完成")