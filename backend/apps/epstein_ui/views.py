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
from django.contrib.auth.models import User
from django.views.decorators.csrf import csrf_exempt
from django.db.utils import OperationalError, ProgrammingError
from django.db.models import Count, Q, Value, IntegerField, F, OuterRef, Subquery
from django.db.models.functions import Coalesce

from .models import Annotation, TextItem, ArrowItem, PdfDocument, AnnotationVote, AnnotationComment, CommentVote, PdfVote

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[3] / "data"))


def _list_pdfs_on_disk() -> list[Path]:
    """Return all PDF paths under the shared data directory."""
    if not DATA_DIR.exists():
        return []
    return [p for p in DATA_DIR.rglob("*.pdf") if p.is_file()]


def _sync_pdf_index() -> list[PdfDocument]:
    """Sync the PdfDocument table with PDFs on disk."""
    pdf_paths = _list_pdfs_on_disk()
    if not pdf_paths:
        try:
            PdfDocument.objects.all().delete()
        except (OperationalError, ProgrammingError):
            pass
        return []

    seen_paths = {str(p) for p in pdf_paths}
    try:
        existing = {doc.path: doc for doc in PdfDocument.objects.all()}
    except (OperationalError, ProgrammingError):
        return []

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


def _cache_disabled() -> bool:
    return os.environ.get("DISABLE_PDF_CACHE", "").strip().lower() in {"1", "true", "yes"}


def _render_pdf_pages(pdf_path: Path) -> list[Path]:
    """Render PDF pages into cached PNGs under MEDIA_ROOT."""
    media_dir = Path(settings.MEDIA_ROOT)
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(pdf_path).encode("utf-8")).hexdigest()[:16]
    out_dir = media_dir / f"pdf_{digest}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_base = out_dir / "page"

    if _cache_disabled():
        for cached in media_dir.glob("pdf_*"):
            if cached == out_dir:
                continue
            shutil.rmtree(cached, ignore_errors=True)
        for png in out_dir.glob("page-*.png"):
            png.unlink()
    else:
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


def index(request, pdf_slug=None):
    """Render the single-page UI."""
    return render(request, "epstein_ui/index.html")


def browse(request):
    """Render the browse page shell."""
    return render(request, "epstein_ui/browse.html")


def random_pdf(request):
    """Pick a random PDF and return rendered page metadata."""
    pdfs = _sync_pdf_index()
    if not pdfs:
        pdf_paths = _list_pdfs_on_disk()
        if not pdf_paths:
            return JsonResponse({"error": "No PDFs found"}, status=404)
        pdf_path = random.choice(pdf_paths)
    else:
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

    pdf_path = None
    try:
        _sync_pdf_index()
        match = PdfDocument.objects.filter(filename__icontains=query).first()
        if match:
            pdf_path = Path(match.path)
    except (OperationalError, ProgrammingError):
        pdf_path = None

    if pdf_path is None:
        pdfs = _list_pdfs_on_disk()
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
        "pdf": pdf_path.name,
    })


def search_suggestions(request):
    """Return filename suggestions for the search box."""
    query = (request.GET.get("q") or "").strip()
    suggestions = []
    try:
        _sync_pdf_index()
        qs = PdfDocument.objects.all()
        if query:
            qs = qs.filter(filename__icontains=query)
        suggestions = list(qs.order_by("filename").values_list("filename", flat=True)[:12])
    except (OperationalError, ProgrammingError):
        pdfs = _list_pdfs_on_disk()
        if query:
            pdfs = [p for p in pdfs if query.lower() in p.name.lower()]
        suggestions = [p.name for p in sorted(pdfs, key=lambda p: p.name)[:12]]
    return JsonResponse({"suggestions": suggestions})


def browse_list(request):
    """Return paginated PDF filenames for browsing."""
    page = request.GET.get("page") or "1"
    sort = (request.GET.get("sort") or "name").lower()
    query = (request.GET.get("q") or "").strip()
    try:
        page_num = max(1, int(page))
    except ValueError:
        page_num = 1
    page_size = 50
    try:
        _sync_pdf_index()
    except (OperationalError, ProgrammingError):
        pass
    qs = PdfDocument.objects.all()
    if query:
        qs = qs.filter(filename__icontains=query)
    ann_count = Subquery(
        Annotation.objects.filter(pdf_key=OuterRef("filename"))
        .values("pdf_key")
        .annotate(total=Count("id"))
        .values("total")[:1],
        output_field=IntegerField(),
    )
    qs = qs.annotate(
        ann_total=Coalesce(ann_count, Value(0)),
        upvotes=Count("votes", filter=Q(votes__value=1), distinct=True),
        downvotes=Count("votes", filter=Q(votes__value=-1), distinct=True),
    ).annotate(vote_score=F("upvotes") - F("downvotes"))
    if sort == "promising":
        qs = qs.order_by("-vote_score", "filename")
    elif sort == "least":
        qs = qs.order_by("vote_score", "filename")
    elif sort == "ann_most":
        qs = qs.order_by("-ann_total", "filename")
    elif sort == "ann_least":
        qs = qs.order_by("ann_total", "filename")
    else:
        qs = qs.order_by("filename")

    total = qs.count()
    start = (page_num - 1) * page_size
    end = start + page_size
    docs = list(qs.values("filename", "vote_score", "ann_total")[start:end])
    items = [
        {
            "filename": doc["filename"],
            "slug": doc["filename"].replace(".pdf", ""),
            "upvotes": doc["vote_score"] or 0,
            "annotations": doc["ann_total"] or 0,
        }
        for doc in docs
    ]
    has_more = end < total
    return JsonResponse({"items": items, "page": page_num, "has_more": has_more})


@csrf_exempt
def pdf_votes(request):
    """List or record votes for a PDF file."""
    if request.method == "GET":
        pdf_name = (request.GET.get("pdf") or "").strip()
        if not pdf_name:
            return JsonResponse({"error": "Missing pdf"}, status=400)
        try:
            _sync_pdf_index()
        except (OperationalError, ProgrammingError):
            pass
        pdf_doc = PdfDocument.objects.filter(filename=pdf_name).first()
        if pdf_doc is None:
            return JsonResponse({"error": "Unknown pdf"}, status=404)
        upvotes = PdfVote.objects.filter(pdf=pdf_doc, value=1).count()
        downvotes = PdfVote.objects.filter(pdf=pdf_doc, value=-1).count()
        user_vote = 0
        if request.user.is_authenticated:
            try:
                user_vote = PdfVote.objects.get(pdf=pdf_doc, user=request.user).value
            except PdfVote.DoesNotExist:
                user_vote = 0
        return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})

    if request.method != "POST":
        return JsonResponse({"error": "Unsupported method"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Auth required"}, status=403)
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    pdf_name = (payload.get("pdf") or "").strip()
    value = payload.get("value")
    if not pdf_name or value not in (-1, 1):
        return JsonResponse({"error": "Invalid payload"}, status=400)
    try:
        _sync_pdf_index()
    except (OperationalError, ProgrammingError):
        pass
    pdf_doc = PdfDocument.objects.filter(filename=pdf_name).first()
    if pdf_doc is None:
        return JsonResponse({"error": "Unknown pdf"}, status=404)
    vote, created = PdfVote.objects.get_or_create(
        pdf=pdf_doc,
        user=request.user,
        defaults={"value": value},
    )
    if not created:
        if vote.value == value:
            vote.delete()
        else:
            vote.value = value
            vote.save(update_fields=["value"])
    upvotes = PdfVote.objects.filter(pdf=pdf_doc, value=1).count()
    downvotes = PdfVote.objects.filter(pdf=pdf_doc, value=-1).count()
    user_vote = 0
    try:
        user_vote = PdfVote.objects.get(pdf=pdf_doc, user=request.user).value
    except PdfVote.DoesNotExist:
        user_vote = 0
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})


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


def username_check(request):
    """Return whether a username is available."""
    username = (request.GET.get("u") or "").strip()
    if not username:
        return JsonResponse({"available": False})
    exists = User.objects.filter(username__iexact=username).exists()
    return JsonResponse({"available": not exists})


def _annotation_to_dict(annotation: Annotation, request=None) -> dict:
    """Serialize Annotation and child items for the frontend."""
    votes = list(annotation.votes.all())
    upvotes = sum(1 for v in votes if v.value == 1)
    downvotes = sum(1 for v in votes if v.value == -1)
    user_vote = 0
    is_owner = False
    if request is not None and request.user.is_authenticated:
        is_owner = request.user.id == annotation.user_id
        for vote in votes:
            if vote.user_id == request.user.id:
                user_vote = vote.value
                break
    return {
        "id": annotation.client_id,
        "server_id": annotation.id,
        "pdf": annotation.pdf_key,
        "user": annotation.user.username,
        "x": annotation.x,
        "y": annotation.y,
        "note": annotation.note or "",
        "is_owner": is_owner,
        "upvotes": upvotes,
        "downvotes": downvotes,
        "user_vote": user_vote,
        "hash": str(annotation.hash) if annotation.hash else "",
        "created_at": annotation.created_at.isoformat() if annotation.created_at else None,
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
        payload = [_annotation_to_dict(a, request=request) for a in annotations]
        return JsonResponse({"annotations": payload})

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

        seen_hashes = set()
        seen_client_ids = set()
        for ann in annotations_payload:
            client_id = str(ann.get("id") or "").strip()
            if not client_id:
                continue
            ann_hash = ann.get("hash")
            if ann_hash:
                seen_hashes.add(ann_hash)
                existing = Annotation.objects.filter(hash=ann_hash).first()
                if existing and existing.user_id != request.user.id:
                    continue
                annotation_obj, _ = Annotation.objects.update_or_create(
                    hash=ann_hash,
                    defaults={
                        "pdf_key": pdf_key,
                        "user": request.user,
                        "client_id": client_id,
                        "x": float(ann.get("x", 0)),
                        "y": float(ann.get("y", 0)),
                        "note": ann.get("note") or "",
                    },
                )
            else:
                seen_client_ids.add(client_id)
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

        delete_qs = Annotation.objects.filter(pdf_key=pdf_key, user=request.user)
        if seen_hashes:
            delete_qs = delete_qs.exclude(hash__in=seen_hashes)
        if seen_client_ids:
            delete_qs = delete_qs.exclude(client_id__in=seen_client_ids, hash__isnull=True)
        delete_qs.delete()
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
    if annotation.user_id == request.user.id:
        return JsonResponse({"error": "Cannot vote own annotation"}, status=403)

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
    user_vote = 0
    try:
        user_vote = AnnotationVote.objects.get(annotation=annotation, user=request.user).value
    except AnnotationVote.DoesNotExist:
        user_vote = 0
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})


def _comment_to_dict(comment, request=None):
    votes = list(comment.votes.all())
    upvotes = sum(1 for v in votes if v.value == 1)
    downvotes = sum(1 for v in votes if v.value == -1)
    user_vote = 0
    if request is not None and request.user.is_authenticated:
        for vote in votes:
            if vote.user_id == request.user.id:
                user_vote = vote.value
                break
    return {
        "id": comment.id,
        "annotation_id": comment.annotation_id,
        "parent_id": comment.parent_id,
        "user": comment.user.username,
        "body": comment.body,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
        "upvotes": upvotes,
        "downvotes": downvotes,
        "user_vote": user_vote,
    }


@csrf_exempt
def annotation_comments(request):
    if request.method == "GET":
        annotation_id = request.GET.get("annotation_id")
        if not annotation_id:
            return JsonResponse({"error": "Missing annotation_id"}, status=400)
        comments = (
            AnnotationComment.objects.filter(annotation_id=annotation_id)
            .select_related("user")
            .prefetch_related("votes")
            .order_by("created_at")
        )
        payload = [_comment_to_dict(c, request=request) for c in comments]
        return JsonResponse({"comments": payload})

    if request.method == "POST":
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Login required"}, status=401)
        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        annotation_id = payload.get("annotation_id")
        body = (payload.get("body") or "").strip()
        parent_id = payload.get("parent_id")
        if not annotation_id or not body:
            return JsonResponse({"error": "Missing fields"}, status=400)
        try:
            annotation = Annotation.objects.get(id=annotation_id)
        except Annotation.DoesNotExist:
            return JsonResponse({"error": "Not found"}, status=404)
        parent = None
        if parent_id:
            try:
                parent = AnnotationComment.objects.get(id=parent_id, annotation=annotation)
            except AnnotationComment.DoesNotExist:
                return JsonResponse({"error": "Invalid parent"}, status=400)
        comment = AnnotationComment.objects.create(annotation=annotation, user=request.user, parent=parent, body=body)
        return JsonResponse({"comment": _comment_to_dict(comment, request=request)})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def delete_comment(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    comment_id = payload.get("comment_id")
    if not comment_id:
        return JsonResponse({"error": "Missing comment_id"}, status=400)
    try:
        comment = AnnotationComment.objects.get(id=comment_id, user=request.user)
    except AnnotationComment.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    comment.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
def comment_votes(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    comment_id = payload.get("comment_id")
    value = payload.get("value")
    if comment_id is None or value not in (-1, 1):
        return JsonResponse({"error": "Invalid payload"}, status=400)
    try:
        comment = AnnotationComment.objects.get(id=comment_id)
    except AnnotationComment.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    if comment.user_id == request.user.id:
        return JsonResponse({"error": "Cannot vote own comment"}, status=403)

    vote, created = CommentVote.objects.get_or_create(
        comment=comment,
        user=request.user,
        defaults={"value": value},
    )
    if not created:
        if vote.value == value:
            vote.delete()
        else:
            vote.value = value
            vote.save(update_fields=["value"])

    upvotes = CommentVote.objects.filter(comment=comment, value=1).count()
    downvotes = CommentVote.objects.filter(comment=comment, value=-1).count()
    user_vote = 0
    try:
        user_vote = CommentVote.objects.get(comment=comment, user=request.user).value
    except CommentVote.DoesNotExist:
        user_vote = 0
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})
