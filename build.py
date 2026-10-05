import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
ORDER = ["color.js", "catalogue.js", "formats.js", "scanner.js", "tryon.js", "app.js"]


def strip_module_syntax(source):
    lines = []
    skipping = False
    for line in source.splitlines():
        stripped = line.strip()
        if skipping:
            if stripped.endswith("';") or stripped.endswith('";'):
                skipping = False
            continue
        if stripped.startswith("import ") and "(" not in stripped.split("import ")[1][:1]:
            if not stripped.endswith(";"):
                skipping = True
            continue
        if re.match(r"^export\s*\{", stripped):
            continue
        line = re.sub(r"^(\s*)export\s+", r"\1", line)
        lines.append(line)
    return "\n".join(lines)


def main():
    css = (ROOT / "styles.css").read_text()
    html = (ROOT / "index.html").read_text()
    shades = json.loads((ROOT / "data" / "shades.json").read_text())

    bundle = ["globalThis.SHADE_CATALOGUE = " + json.dumps(shades, ensure_ascii=False) + ";"]
    for name in ORDER:
        bundle.append(strip_module_syntax((ROOT / "js" / name).read_text()))
    script = "\n\n".join(bundle)

    html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
    html = html.replace(
        '<script type="module" src="js/app.js"></script>',
        '<script type="module">\n' + script + "\n</script>",
    )

    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    (out / "shadescan.html").write_text(html)
    print("wrote", out / "shadescan.html", len(html), "bytes")


if __name__ == "__main__":
    main()
