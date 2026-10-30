#!/usr/bin/env python3
"""随煮 App 图标 · 母版流水线
============================================================
单一事实来源：scripts/icons/master.png（透明、全分辨率、已清理）

  master.png  ──>  assets/adaptive-icon.png   1024  透明，内容缩到安全区 66%
              └─>  assets/icon.png            1024  橙底 #FF6B35，内容铺满 94%

用法：
    python build-icons.py              # 只重渲染（master 已存在）
    python build-icons.py --bootstrap  # 从 assets/adaptive-icon.png 重建 master

为什么要有 master：直接拿 assets 里的文件循环处理会一代代劣化。
master 只存“清理过的原始像素”，所有派生都在渲染时算，可无限重跑。

修过的三个问题：
  1. 品红残留（抠图时的背景色没清干净）
  2. 轮廓一圈偏暗的脏边（二值硬切的副作用）
  3. 无抗锯齿（原 alpha 只有 0/255 两个值）
"""
import sys
import pathlib
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).parent
PROJECT = HERE.parents[1]
ASSETS = PROJECT / "assets"
MASTER = HERE / "master.png"

ORANGE = (0xFF, 0x6B, 0x35)   # 与 app.json 的 adaptiveIcon.backgroundColor 一致
CANVAS = 1024
SAFE = 0.66                   # Android 自适应图标：内容必须落在中央 66%
FULL = 0.94                   # 旧式图标铺满度
NEIGHBORS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


# ---------------------------------------------------------------- 清理
def kill_purple(arr):
    """品红残留（蓝通道压过绿通道）→ 用邻近正常像素的颜色覆盖。"""
    rgb = arr[..., :3].astype(float)
    a = arr[..., 3]
    bad = (a > 8) & (rgb[..., 2] > rgb[..., 1] + 20) & (rgb[..., 2] > 70)
    total = int(bad.sum())
    for _ in range(6):
        if not bad.any():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape)
        good = ~bad
        for dy, dx in NEIGHBORS:
            k = np.roll(good, (dy, dx), axis=(0, 1))
            acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * k[..., None]
            cnt += k
        fill = bad & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
        bad &= ~fill
    out = arr.copy()
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out, total


def erode_alpha(arr, n=1):
    """alpha 向内收 n 像素，刮掉被污染的那圈边缘。"""
    a = arr[..., 3]
    for _ in range(n):
        ap = np.pad(a, 1, mode="constant", constant_values=0)
        m = ap.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.minimum(m, np.roll(ap, (dy, dx), axis=(0, 1)))
        a = m[1:-1, 1:-1]
    out = arr.copy()
    out[..., 3] = a
    return out


def ring_violet(arr):
    """诊断：轮廓环上还剩几个品红像素。"""
    opaque = arr[..., 3] > 8
    trans = ~opaque
    ring = np.zeros_like(opaque)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ring |= opaque & np.roll(trans, (dy, dx), axis=(0, 1))
    if not ring.any():
        return 0, 0
    p = arr[..., :3].astype(int)[ring]
    bad = (p[:, 2] > p[:, 1] + 20) & (p[:, 2] > 70)
    return int(ring.sum()), int(bad.sum())


# ---------------------------------------------------------------- 渲染
def bleed(arr, iters=24):
    """边缘颜色渗进透明区，缩放时才不会有杂色光晕。运行时不写盘。"""
    rgb = arr[..., :3].astype(float)
    known = arr[..., 3] > 8
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape)
        for dy, dx in NEIGHBORS:
            k = np.roll(known, (dy, dx), axis=(0, 1))
            acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * k[..., None]
            cnt += k
        newly = (~known) & (cnt > 0)
        rgb[newly] = acc[newly] / cnt[newly][:, None]
        known = known | newly
    out = arr.copy()
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


def trim(arr, pad=6):
    ys, xs = np.where(arr[..., 3] > 8)
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + 1 + pad)
    return arr[y0:y1, x0:x1]


def render(art, target_px, bg=None):
    """内容等比放到 CANVAS 见方中央，target_px 为内容最大边长。"""
    im = Image.fromarray(art, "RGBA")
    w, h = im.size
    s = target_px / max(w, h)
    new = (max(1, round(w * s)), max(1, round(h * s)))
    scaled = im.resize(new, Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), bg if bg else (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((CANVAS - new[0]) // 2, (CANVAS - new[1]) // 2))
    px = np.array(canvas)
    px[px[..., 3] < 4] = 0          # 抹掉幽灵边
    return Image.fromarray(px, "RGBA")


# ---------------------------------------------------------------- 主流程
def bootstrap():
    src = ASSETS / "adaptive-icon.png"
    if not src.exists():
        sys.exit(f"找不到源图：{src}")
    arr = np.array(Image.open(src).convert("RGBA"))
    print(f"引导：读取 {src.name} {arr.shape[1]}×{arr.shape[0]}")
    r0 = ring_violet(arr)
    print(f"  清理前 轮廓环 {r0[0]} 像素，其中品红 {r0[1]} 个")
    arr, n = kill_purple(arr)
    print(f"  清除品红 {n} 个")
    arr = erode_alpha(arr, 1)
    arr, n = kill_purple(arr)
    print(f"  刮边后补清品红 {n} 个")
    r1 = ring_violet(arr)
    print(f"  清理后 轮廓环 {r1[0]} 像素，其中品红 {r1[1]} 个")
    Image.fromarray(arr, "RGBA").save(MASTER)
    print(f"  已写出母版 {MASTER.relative_to(PROJECT)}  "
          f"{MASTER.stat().st_size / 1024:.0f} KB")
    return arr


def main():
    if "--bootstrap" in sys.argv or not MASTER.exists():
        arr = bootstrap()
    else:
        arr = np.array(Image.open(MASTER).convert("RGBA"))
        print(f"母版 {MASTER.name} {arr.shape[1]}×{arr.shape[0]}")

    art = trim(bleed(arr))
    print(f"内容框 {art.shape[1]}×{art.shape[0]}")

    fg = render(art, round(CANVAS * SAFE))                          # 透明，安全区
    full = render(art, round(CANVAS * FULL), bg=ORANGE + (255,))    # 橙底，铺满

    fg.save(ASSETS / "adaptive-icon.png")
    full.save(ASSETS / "icon.png")

    for name, im in (("adaptive-icon.png", fg), ("icon.png", full)):
        p = ASSETS / name
        alpha = np.array(im)[..., 3]
        print(f"  写出 {name:20s} {im.size[0]}×{im.size[1]}  "
              f"{p.stat().st_size / 1024:6.1f} KB  "
              f"透明区 {(alpha == 0).mean() * 100:4.0f}%")


if __name__ == "__main__":
    main()
