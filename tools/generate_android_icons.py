"""Generate the Android launcher icons and splash screens from the brand seal.

Run from the project root:  python tools/generate_android_icons.py
The generated PNGs live in android/app/src/main/res and are committed, so the
cloud build does not need Pillow or any Windows fonts.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

ACCENT = (196, 71, 47, 255)
PAPER = (247, 242, 232, 255)
PAPER_LIGHT = (251, 246, 235, 255)
INK = (33, 29, 24, 255)
MUTED = (162, 150, 133, 255)

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

FONT_CANDIDATES = [
    "C:/Windows/Fonts/simsun.ttc",
    "C:/Windows/Fonts/STSONG.TTF",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def load_font(size):
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_glyph(draw, size, color, font_ratio=0.56, center=None):
    """Draw 城 centred in a size×size area."""
    font = load_font(int(size * font_ratio))
    center = center or (size / 2, size / 2)
    # ttc fonts sometimes report odd metrics; nudge by the bbox centre.
    left, top, right, bottom = draw.textbbox((0, 0), "城", font=font)
    x = center[0] - (left + right) / 2
    y = center[1] - (top + bottom) / 2
    draw.text((x, y), "城", font=font, fill=color)


def rounded_icon(px, circular=False):
    scale = 4
    size = px * scale
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if circular:
        draw.ellipse((0, 0, size - 1, size - 1), fill=ACCENT)
    else:
        radius = int(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=ACCENT)
    draw_glyph(draw, size, PAPER_LIGHT, font_ratio=0.58)
    return image.resize((px, px), Image.LANCZOS)


def adaptive_foreground(px):
    scale = 4
    size = px * scale
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # 城 sits inside the 66/108 safe zone.
    draw_glyph(draw, size, PAPER_LIGHT, font_ratio=0.46)
    return image.resize((px, px), Image.LANCZOS)


def splash(width, height):
    scale = 2
    w, h = width * scale, height * scale
    image = Image.new("RGB", (w, h), PAPER)
    draw = ImageDraw.Draw(image)

    # Faint grid, like the site background.
    step = max(24, int(min(w, h) * 0.055))
    grid = (238, 231, 219)
    for x in range(0, w, step):
        draw.line((x, 0, x, h), fill=grid, width=1)
    for y in range(0, h, step):
        draw.line((0, y, w, y), fill=grid, width=1)

    unit = min(w, h)
    seal = int(unit * 0.20)
    cx, cy = w / 2, h * 0.43
    radius = int(seal * 0.2)
    draw.rounded_rectangle(
        (cx - seal / 2, cy - seal / 2, cx + seal / 2, cy + seal / 2),
        radius=radius,
        fill=ACCENT,
    )
    draw_glyph(draw, seal, PAPER_LIGHT[:3], font_ratio=0.6, center=(cx, cy))

    title_font = load_font(int(unit * 0.075))
    sub_font = load_font(int(unit * 0.024))
    title = "中国城市漫游"
    subtitle = "CHINA CITY ATLAS"
    left, top, right, bottom = draw.textbbox((0, 0), title, font=title_font)
    draw.text(
        (cx - (left + right) / 2, cy + seal * 0.85),
        title,
        font=title_font,
        fill=INK[:3],
    )
    left, top, right, bottom = draw.textbbox((0, 0), subtitle, font=sub_font)
    draw.text(
        (cx - (left + right) / 2, cy + seal * 0.85 + unit * 0.10),
        subtitle,
        font=sub_font,
        fill=MUTED[:3],
    )

    return image.resize((width, height), Image.LANCZOS)


def main():
    for density, factor in DENSITIES.items():
        folder = RES / ("mipmap-" + density)
        legacy_px = int(48 * factor)
        foreground_px = int(108 * factor)
        rounded_icon(legacy_px).save(folder / "ic_launcher.png")
        rounded_icon(legacy_px, circular=True).save(folder / "ic_launcher_round.png")
        adaptive_foreground(foreground_px).save(folder / "ic_launcher_foreground.png")

    for path in sorted(RES.glob("drawable*/splash.png")):
        with Image.open(path) as existing:
            width, height = existing.size
        splash(width, height).save(path)

    print("Generated launcher icons and splash screens.")


if __name__ == "__main__":
    main()
