import hashlib
import json
import os
import random
import subprocess
from pathlib import Path

from PIL import Image
import shutil
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.contrib.auth import login, logout
from django.contrib.auth.forms import UserCreationForm
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q, Count

from .models import Annotation, TextItem, ArrowItem, PdfDocument, AnnotationVote

DATA_DIR = Path(__file__).resolve().parents[3] / "data"


def _list_pdfs_on_disk() -> list[Path]:
    """Return all PDF paths under the shared data directory."""
    if not DATA_DIR.exists():
        return []
    return [p for p in DATA_DIR.rglob("*.pdf") if p.is_file()]


def _sync_pdf_index() -> list[PdfDocument]:
    """Sync the PdfDocument table with PDFs on disk."""
    pdf_paths = _list_pdfs_on_disk()
    if not pdf_paths:
        PdfDocument.objects.all().delete()
        return []

    seen_paths = {str(p) for p in pdf_paths}
    existing = {doc.path: doc for doc in PdfDocument.objects.all()}

    to_create = []
    for path in pdf_paths:
        path_str = str(path)
        if path_str not in existing:
            to_create.append(PdfDocument(path=path_str, filename=path.name))
    if to_create:
        PdfDocument.objects.bulk_create(to_create, ignore_conflicts=True)

    stale = set(existing.keys()) - seen_paths
    if stale:
        PdfDocument.objects.filter(path__in=stale).delete()

    return list(PdfDocument.objects.filter(path__in=seen_paths))

def _get_pdf_pages(pdf_path: Path) -> int:
    """Best-effort page count using pdfinfo (falls back to 1)."""
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
    """Render PDF pages into cached PNGs under MEDIA_ROOT."""
    media_dir = Path(settings.MEDIA_ROOT)
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(pdf_path).encode("utf-8")).hexdigest()[:16]
    out_dir = media_dir / f"pdf_{digest}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_base = out_dir / "page"

    existing = sorted(out_dir.glob("page-*.png"))
    if existing:
        return existing

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
    rendered = sorted(out_dir.glob("page-*.png"))
    if not rendered:
        raise RuntimeError("pdftoppm produced no pages")
    return rendered


def index(request):
    """Render the single-page UI."""
    return render(request, "epstein_ui/index.html")


def random_pdf(request):
    """Pick a random PDF and return rendered page metadata."""
    pdfs = _sync_pdf_index()
    if not pdfs:
        return JsonResponse({"error": "No PDFs found"}, status=404)

    pdf_doc = random.choice(pdfs)
    pdf_path = Path(pdf_doc.path)
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
        "pdf": pdf_path.name,
    })


def search_pdf(request):
    """Return rendered page metadata for the first filename match."""
    query = (request.GET.get("q") or "").strip()
    if not query:
        return JsonResponse({"error": "Missing query"}, status=400)

    _sync_pdf_index()
    match = PdfDocument.objects.filter(filename__icontains=query).first()
    if not match:
        return JsonResponse({"error": "No match"}, status=404)

    pdf_path = Path(match.path)
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
        "pdf": pdf_path.name,
    })


def search_suggestions(request):
    """Return filename suggestions for the search box."""
    query = (request.GET.get("q") or "").strip()
    _sync_pdf_index()
    qs = PdfDocument.objects.all()
    if query:
        qs = qs.filter(filename__icontains=query)
    suggestions = list(qs.order_by("filename").values_list("filename", flat=True)[:12])
    return JsonResponse({"suggestions": suggestions})


def register(request):
    """Simple username/password registration with auto-login."""
    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect("index")
    else:
        form = UserCreationForm()
    return render(request, "epstein_ui/register.html", {"form": form})


def logout_view(request):
    """Logout helper that redirects back to the index."""
    logout(request)
    return redirect("index")


def _annotation_to_dict(annotation: Annotation) -> dict:
    """Serialize Annotation and child items for the frontend."""
    votes = list(annotation.votes.all())
    upvotes = sum(1 for v in votes if v.value == 1)
    downvotes = sum(1 for v in votes if v.value == -1)
    return {
        "id": annotation.client_id,
        "server_id": annotation.id,
        "pdf": annotation.pdf_key,
        "user": annotation.user.username,
        "x": annotation.x,
        "y": annotation.y,
        "note": annotation.note or "",
        "upvotes": upvotes,
        "downvotes": downvotes,
        "textItems": [
            {
                "x": item.x,
                "y": item.y,
                "text": item.text,
                "fontFamily": item.font_family,
                "fontSize": item.font_size,
                "fontWeight": item.font_weight,
                "fontStyle": item.font_style,
                "fontKerning": item.font_kerning,
                "fontFeatureSettings": item.font_feature_settings,
                "color": item.color,
                "opacity": item.opacity,
            }
            for item in annotation.text_items.all()
        ],
        "arrows": [
            {"x1": arrow.x1, "y1": arrow.y1, "x2": arrow.x2, "y2": arrow.y2}
            for arrow in annotation.arrow_items.all()
        ],
    }


@csrf_exempt
def annotations_api(request):
    """List or persist annotations for a PDF (auth required for writes)."""
    if request.method == "GET":
        pdf_key = (request.GET.get("pdf") or "").strip()
        if not pdf_key:
            return JsonResponse({"error": "Missing pdf"}, status=400)
        annotations = (
            Annotation.objects.filter(pdf_key=pdf_key)
            .select_related("user")
            .prefetch_related("text_items", "arrow_items", "votes")
        )
        return JsonResponse({"annotations": [_annotation_to_dict(a) for a in annotations]})

    if request.method == "POST":
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Login required"}, status=401)
        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        pdf_key = (payload.get("pdf") or "").strip()
        annotations_payload = payload.get("annotations") or []
        if not pdf_key:
            return JsonResponse({"error": "Missing pdf"}, status=400)

        seen_ids = set()
        for ann in annotations_payload:
            client_id = str(ann.get("id") or "").strip()
            if not client_id:
                continue
            seen_ids.add(client_id)
            annotation_obj, _ = Annotation.objects.update_or_create(
                pdf_key=pdf_key,
                user=request.user,
                client_id=client_id,
                defaults={
                    "x": float(ann.get("x", 0)),
                    "y": float(ann.get("y", 0)),
                    "note": ann.get("note") or "",
                },
            )
            TextItem.objects.filter(annotation=annotation_obj).delete()
            ArrowItem.objects.filter(annotation=annotation_obj).delete()

            for item in ann.get("textItems", []):
                TextItem.objects.create(
                    annotation=annotation_obj,
                    x=float(item.get("x", 0)),
                    y=float(item.get("y", 0)),
                    text=item.get("text", "") or "",
                    font_family=item.get("fontFamily", "") or "",
                    font_size=item.get("fontSize", "") or "",
                    font_weight=item.get("fontWeight", "") or "",
                    font_style=item.get("fontStyle", "") or "",
                    font_kerning=item.get("fontKerning", "") or "",
                    font_feature_settings=item.get("fontFeatureSettings", "") or "",
                    color=item.get("color", "") or "",
                    opacity=float(item.get("opacity", 1) or 1),
                )
            for arrow in ann.get("arrows", []):
                ArrowItem.objects.create(
                    annotation=annotation_obj,
                    x1=float(arrow.get("x1", 0)),
                    y1=float(arrow.get("y1", 0)),
                    x2=float(arrow.get("x2", 0)),
                    y2=float(arrow.get("y2", 0)),
                )

        Annotation.objects.filter(pdf_key=pdf_key, user=request.user).exclude(client_id__in=seen_ids).delete()
        return JsonResponse({"ok": True})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def annotation_votes(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    annotation_id = payload.get("annotation_id")
    value = payload.get("value")
    if annotation_id is None or value not in (-1, 1):
        return JsonResponse({"error": "Invalid payload"}, status=400)
    try:
        annotation = Annotation.objects.get(id=annotation_id)
    except Annotation.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)

    vote, created = AnnotationVote.objects.get_or_create(
        annotation=annotation,
        user=request.user,
        defaults={"value": value},
    )
    if not created:
        if vote.value == value:
            vote.delete()
        else:
            vote.value = value
            vote.save(update_fields=["value"])

    upvotes = AnnotationVote.objects.filter(annotation=annotation, value=1).count()
    downvotes = AnnotationVote.objects.filter(annotation=annotation, value=-1).count()
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes})
