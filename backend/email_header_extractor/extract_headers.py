import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - runtime guard
    raise SystemExit("Missing dependency: Pillow. Install with `pip install pillow`.") from exc

try:
    import pytesseract
except ImportError as exc:  # pragma: no cover - runtime guard
    raise SystemExit("Missing dependency: pytesseract. Install with `pip install pytesseract`.") from exc

try:
    from tqdm import tqdm
except ImportError as exc:  # pragma: no cover - runtime guard
    raise SystemExit("Missing dependency: tqdm. Install with `pip install tqdm`.") from exc

FROM_RE = re.compile(r"^\s*from\b\s*:", re.IGNORECASE)
TO_RE = re.compile(r"^\s*to\b\s*:", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b")
NAME_RE = re.compile(
    r"\b(?:[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?:\s+|$)){2,4}"
)
NAME_STOPWORDS = {
    "From",
    "To",
    "Cc",
    "Bcc",
    "Subject",
    "Date",
    "Sent",
}


def _check_dependencies() -> None:
    if shutil.which("pdftoppm") is None:
        raise SystemExit("Missing dependency: pdftoppm (poppler). Please install it.")
    if shutil.which("tesseract") is None:
        raise SystemExit("Missing dependency: tesseract. Please install it.")


def _get_pdf_pages(pdf_path: Path) -> int:
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo is None:
        return 1
    result = subprocess.run(
        [pdfinfo, str(pdf_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        return 1
    for line in result.stdout.splitlines():
        if line.lower().startswith("pages:"):
            parts = line.split(":", 1)
            if len(parts) == 2:
                try:
                    return int(parts[1].strip())
                except ValueError:
                    return 1
    return 1

def _render_first_page(pdf_path: Path, tmp_dir: Path, dpi: int = 200) -> Path:
    out_base = tmp_dir / "page"
    cmd = [
        "pdftoppm",
        "-f",
        "1",
        "-l",
        "1",
        "-r",
        str(dpi),
        "-png",
        "-singlefile",
        str(pdf_path),
        str(out_base),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pdftoppm failed for {pdf_path}: {result.stderr.strip()}")
    return out_base.with_suffix(".png")


def _render_page(pdf_path: Path, tmp_dir: Path, page: int, dpi: int = 200) -> Path:
    out_base = tmp_dir / f"page_{page}"
    cmd = [
        "pdftoppm",
        "-f",
        str(page),
        "-l",
        str(page),
        "-r",
        str(dpi),
        "-png",
        "-singlefile",
        str(pdf_path),
        str(out_base),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pdftoppm failed for {pdf_path} page {page}: {result.stderr.strip()}")
    return out_base.with_suffix(".png")

def _find_label_line_crops(image: Image.Image) -> list[tuple[str, tuple[int, int, int, int]]]:
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    width, height = image.size

    lines: dict[tuple[int, int, int], dict[str, object]] = {}
    n = len(data["text"])
    for i in range(n):
        text = data["text"][i]
        if not text or text.strip() == "":
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        left = data["left"][i]
        top = data["top"][i]
        right = left + data["width"][i]
        bottom = top + data["height"][i]
        entry = lines.get(key)
        if entry is None:
            lines[key] = {
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
                "text": text,
            }
        else:
            entry["left"] = min(entry["left"], left)
            entry["top"] = min(entry["top"], top)
            entry["right"] = max(entry["right"], right)
            entry["bottom"] = max(entry["bottom"], bottom)
            entry["text"] = f"{entry['text']} {text}"

    matched_lines = []
    for line in lines.values():
        line_text = str(line["text"]).strip()
        label = None
        if FROM_RE.match(line_text):
            label = "from"
        elif TO_RE.match(line_text):
            label = "to"

        if label is not None:
            matched_lines.append((label, line))

    if not matched_lines:
        return []

    pad = max(6, int(height * 0.008))
    crops: list[tuple[str, tuple[int, int, int, int]]] = []
    for label, line in matched_lines:
        line_top = int(line["top"])
        line_bottom = int(line["bottom"])
        line_h = max(1, line_bottom - line_top)
        pad_y = max(pad, int(line_h * 0.8))

        # Use full width so redaction boxes to the right are included.
        left = 0
        right = width
        top = max(0, line_top - pad_y)
        bottom = min(height, line_bottom + pad_y)
        crops.append((label, (left, top, right, bottom)))

    return crops


def _trim_white_horizontal(image: Image.Image, crop_box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    left, top, right, bottom = crop_box
    region = image.crop(crop_box).convert("L")
    w, h = region.size
    pixels = region.load()

    threshold = 245
    min_x = None
    max_x = None
    mid_y = h // 2
    for x in range(w):
        if pixels[x, mid_y] < threshold:
            min_x = x if min_x is None else min(min_x, x)
            max_x = x if max_x is None else max(max_x, x)

    if min_x is None or max_x is None:
        return crop_box

    pad = 10
    new_left = max(0, left + min_x - pad)
    new_right = min(image.size[0], left + max_x + pad + 1)
    return (new_left, top, new_right, bottom)


def _safe_output_base(pdf_path: Path, data_dir: Path) -> str:
    try:
        rel = pdf_path.relative_to(data_dir)
        rel_str = str(rel)
    except ValueError:
        rel_str = pdf_path.name
    rel_str = rel_str.replace(os.sep, "__").replace(" ", "_")
    return f"{rel_str}_p1"


def extract_headers(
    data_dir: Path,
    results_dir: Path,
    dpi: int = 200,
    record_writer: Callable[[dict[str, object]], None] | None = None,
) -> int:
    _check_dependencies()
    results_dir.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(data_dir.rglob("*.pdf"))
    if not pdfs:
        print(f"No PDFs found under {data_dir}")
        return 0

    count = 0
    for pdf_path in tqdm(pdfs, desc="Headers", unit="pdf"):
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_dir = Path(tmp)
                page_png = _render_first_page(pdf_path, tmp_dir, dpi=dpi)
                image = Image.open(page_png)
                crops = _find_label_line_crops(image)
                if not crops:
                    continue

                base = _safe_output_base(pdf_path, data_dir)
                label_counts: dict[str, int] = {}
                for label, crop_box in crops:
                    label_counts[label] = label_counts.get(label, 0) + 1
                    crop_box = _trim_white_horizontal(image, crop_box)
                    header = image.crop(crop_box)
                    out_name = f"{base}_{label}_{label_counts[label]}.png"
                    out_path = results_dir / out_name
                    header.save(out_path)
                    count += 1

                    if record_writer is not None:
                        payload = pytesseract.image_to_string(header)
                        for email in EMAIL_RE.findall(payload):
                            record_writer(
                                {
                                    "type": "email",
                                    "value": email,
                                    "pdf": str(pdf_path),
                                    "page": 1,
                                }
                            )
                        for match in NAME_RE.findall(payload):
                            name = _normalize_name(match)
                            if name in NAME_STOPWORDS:
                                continue
                            if name.lower() in (s.lower() for s in NAME_STOPWORDS):
                                continue
                            if EMAIL_RE.search(name):
                                continue
                            record_writer(
                                {
                                    "type": "name",
                                    "value": name,
                                    "pdf": str(pdf_path),
                                    "page": 1,
                                }
                            )
        except Exception as exc:
            print(f"Failed: {pdf_path} ({exc})")

    print(f"Wrote {count} header images to {results_dir}")
    return count


def _normalize_name(name: str) -> str:
    return " ".join(part.strip() for part in name.split())


def _write_records_stream(output_json: Path):
    output_json.parent.mkdir(parents=True, exist_ok=True)
    f = output_json.open("w", encoding="utf-8")
    f.write("[\n")
    first = True
    total = 0

    def write_record(record: dict[str, object]) -> None:
        nonlocal first, total
        if not first:
            f.write(",\n")
        f.write(json.dumps(record, ensure_ascii=True))
        f.flush()
        first = False
        total += 1

    return f, write_record, lambda: total


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract email header blocks and entities from PDFs."
    )
    parser.add_argument("--data-dir", default="data", help="Root directory containing PDFs.")
    parser.add_argument("--results-dir", default="results", help="Output directory for header PNGs.")
    parser.add_argument(
        "--output-json",
        default="results/entities.json",
        help="Output JSON path for extracted names/emails.",
    )
    parser.add_argument("--dpi", type=int, default=200, help="Render DPI for OCR.")
    args = parser.parse_args()

    output_json = Path(args.output_json)
    f, record_writer, total_fn = _write_records_stream(output_json)
    try:
        extract_headers(
            Path(args.data_dir),
            Path(args.results_dir),
            dpi=args.dpi,
            record_writer=record_writer,
        )
    finally:
        f.write("\n]\n")
        f.close()
    print(f"Wrote {total_fn()} records to {output_json}")


if __name__ == "__main__":
    main()
