import hashlib
import os
import random
import subprocess
from pathlib import Path

from PIL import Image
import shutil
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render

DATA_DIR = Path(__file__).resolve().parents[3] / "data"


def _list_pdfs() -> list[Path]:
    if not DATA_DIR.exists():
        return []
    return [p for p in DATA_DIR.rglob("*.pdf") if p.is_file()]

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


def _render_pdf_pages(pdf_path: Path) -> list[Path]:
    media_dir = Path(settings.MEDIA_ROOT)
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(pdf_path).encode("utf-8")).hexdigest()[:16]
    out_dir = media_dir / f"pdf_{digest}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_base = out_dir / "page"

    pages = _get_pdf_pages(pdf_path)
    expected = [out_dir / f"page-{i}.png" for i in range(1, pages + 1)]
    if all(p.exists() for p in expected):
        return expected

    cmd = [
        "pdftoppm",
        "-r",
        "150",
        "-png",
        str(pdf_path),
        str(out_base),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "pdftoppm failed")
    return expected


def index(request):
    return render(request, "epstein_ui/index.html")


def random_pdf(request):
    pdfs = _list_pdfs()
    if not pdfs:
        return JsonResponse({"error": "No PDFs found"}, status=404)

    pdf_path = random.choice(pdfs)
    try:
        png_paths = _render_pdf_pages(pdf_path)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)

    pages = []
    for path in png_paths:
        with Image.open(path) as img:
            width, height = img.size
        rel = os.path.relpath(path, settings.MEDIA_ROOT)
        pages.append({
            "url": f"{settings.MEDIA_URL}{rel}",
            "width": width,
            "height": height,
        })

    return JsonResponse({
        "pages": pages,
        "pdf": str(pdf_path),
    })


def search_pdf(request):
    query = (request.GET.get("q") or "").strip()
    if not query:
        return JsonResponse({"error": "Missing query"}, status=400)

    pdfs = _list_pdfs()
    matches = [p for p in pdfs if query.lower() in p.name.lower()]
    if not matches:
        return JsonResponse({"error": "No match"}, status=404)

    pdf_path = matches[0]
    try:
        png_paths = _render_pdf_pages(pdf_path)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)

    pages = []
    for path in png_paths:
        with Image.open(path) as img:
            width, height = img.size
        rel = os.path.relpath(path, settings.MEDIA_ROOT)
        pages.append({
            "url": f"{settings.MEDIA_URL}{rel}",
            "width": width,
            "height": height,
        })

    return JsonResponse({
        "pages": pages,
        "pdf": str(pdf_path),
    })
