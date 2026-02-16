import hashlib
import json
import os
import random
import subprocess
import urllib.request
import urllib.error
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
from django.db.models import Count, Q
from django.db.utils import OperationalError, ProgrammingError

from .models import (
    PdfDocument,
    PdfVote,
    PdfComment,
    PdfCommentReply,
    PdfCommentReplyVote,
    PdfCommentVote,
    Notification,
)

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


def _sync_pdf_index_on_request() -> None:
    """Optional indexing on request; disabled by default for performance."""
    if os.environ.get("PDF_INDEX_SYNC_ON_REQUEST", "").strip().lower() in {"1", "true", "yes"}:
        _sync_pdf_index()

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

def _extract_pdf_images(pdf_path: Path, out_dir: Path) -> list[Path]:
    """Try to extract embedded images from the PDF. Returns list of PNG paths."""
    out_base = out_dir / "img"
    cmd = [
        "pdfimages",
        "-png",
        str(pdf_path),
        str(out_base),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        return []
    return sorted(out_dir.glob("img-*.png"))


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

    extracted = _extract_pdf_images(pdf_path, out_dir)
    if extracted:
        return extracted

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


def start_page(request):
    """Render the landing page with project stats."""
    try:
        total_pdfs = PdfDocument.objects.count()
        annotated_pdfs = PdfDocument.objects.filter(annotation_count__gt=0).count()
        total_annotations = 0
        total_users = User.objects.count()
        total_comments = PdfComment.objects.count()

        coverage_pct = round((annotated_pdfs / total_pdfs * 100) if total_pdfs > 0 else 0)

        most_discussed = list(
            PdfDocument.objects.annotate(
                discussion_count=Count("comments")
            )
            .filter(discussion_count__gt=0)
            .order_by("-discussion_count")[:5]
            .values("filename", "discussion_count")
        )

        most_promising = list(
            PdfDocument.objects.filter(vote_score__gt=0)
            .order_by("-vote_score")[:5]
            .values("filename", "vote_score")
        )
    except (OperationalError, ProgrammingError):
        total_pdfs = 0
        annotated_pdfs = 0
        total_annotations = 0
        total_users = 0
        total_comments = 0
        coverage_pct = 0
        most_discussed = []
        most_promising = []

    return render(request, "epstein_ui/start.html", {
        "total_pdfs": total_pdfs,
        "annotated_pdfs": annotated_pdfs,
        "total_annotations": total_annotations,
        "total_users": total_users,
        "total_comments": total_comments,
        "coverage_pct": coverage_pct,
        "most_discussed": most_discussed,
        "most_promising": most_promising,
    })


def index(request, pdf_slug=None, target_hash=None):
    """Render the single-page UI."""
    return render(request, "epstein_ui/index.html", {"target_hash": target_hash})


def browse(request):
    """Render the browse page shell."""
    return render(request, "epstein_ui/browse.html")


def about(request):
    """Render the about page."""
    return render(request, "epstein_ui/about.html")


GITHUB_REPO = "artischocki/epstein-studio"


@csrf_exempt
def feature_request(request):
    """Create a GitHub issue from a feature request submission."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    title = (payload.get("title") or "").strip()
    description = (payload.get("description") or "").strip()

    if not title:
        return JsonResponse({"error": "Title is required"}, status=400)

    github_token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not github_token:
        return JsonResponse({"error": "Feature requests are not configured"}, status=503)

    username = ""
    if request.user.is_authenticated:
        username = request.user.username

    body = description
    if username:
        body = f"{description}\n\n---\nSubmitted by **{username}** via Epstein Studio".strip()

    issue_data = json.dumps({
        "title": f"[Feature Request] {title}",
        "body": body,
        "labels": ["feature-request"],
    }).encode("utf-8")

    req = urllib.request.Request(
        f"https://api.github.com/repos/{GITHUB_REPO}/issues",
        data=issue_data,
        headers={
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return JsonResponse({
                "ok": True,
                "issue_url": result.get("html_url", ""),
            })
    except urllib.error.HTTPError as exc:
        return JsonResponse({"error": "Failed to create issue"}, status=502)


def random_pdf(request):
    """Pick a random PDF and return rendered page metadata."""
    try:
        _sync_pdf_index_on_request()
    except (OperationalError, ProgrammingError):
        pass
    pdfs = list(PdfDocument.objects.all())
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
        _sync_pdf_index_on_request()
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
        _sync_pdf_index_on_request()
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
    qs = PdfDocument.objects.all()
    if query:
        qs = qs.filter(filename__icontains=query)
    if sort == "promising":
        qs = qs.order_by("-vote_score", "filename")
    elif sort == "least":
        qs = qs.order_by("vote_score", "filename")
    elif sort == "ann_most":
        qs = qs.order_by("-annotation_count", "filename")
    elif sort == "ann_least":
        qs = qs.order_by("annotation_count", "filename")
    else:
        qs = qs.order_by("filename")

    total = qs.count()
    start = (page_num - 1) * page_size
    end = start + page_size
    docs = list(qs.values("filename", "vote_score", "annotation_count")[start:end])
    items = [
        {
            "filename": doc["filename"],
            "slug": doc["filename"].replace(".pdf", ""),
            "upvotes": doc["vote_score"] or 0,
            "annotations": doc["annotation_count"] or 0,
        }
        for doc in docs
    ]
    has_more = end < total
    return JsonResponse(
        {"items": items, "page": page_num, "has_more": has_more, "total": total}
    )


@csrf_exempt
def pdf_votes(request):
    """List or record votes for a PDF file."""
    if request.method == "GET":
        pdf_name = (request.GET.get("pdf") or "").strip()
        if not pdf_name:
            return JsonResponse({"error": "Missing pdf"}, status=400)
        try:
            _sync_pdf_index_on_request()
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
        _sync_pdf_index_on_request()
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
    PdfDocument.objects.filter(id=pdf_doc.id).update(vote_score=upvotes - downvotes)
    user_vote = 0
    try:
        user_vote = PdfVote.objects.get(pdf=pdf_doc, user=request.user).value
    except PdfVote.DoesNotExist:
        user_vote = 0
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})


def register(request):
    """Simple username/password registration with auto-login."""
    def _generate_id():
        alphabet = "abcdefghijklmnopqrstuvwxyz"
        return "".join(random.choice(alphabet) for _ in range(5))

    if request.method == "POST":
        data = request.POST.copy()
        if not data.get("username"):
            data["username"] = data.get("suggested_id", "").strip()
        form = UserCreationForm(data)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect("start")
    else:
        form = UserCreationForm()
    suggested_id = None
    for _ in range(10):
        candidate = _generate_id()
        if not User.objects.filter(username__iexact=candidate).exists():
            suggested_id = candidate
            break
    if suggested_id is None:
        suggested_id = _generate_id()
    current_username = ""
    try:
        current_username = form.data.get("username", "")
    except Exception:
        current_username = ""
    return render(
        request,
        "epstein_ui/register.html",
        {"form": form, "suggested_id": suggested_id, "current_username": current_username},
    )


def logout_view(request):
    """Logout helper that redirects back to the index."""
    logout(request)
    return redirect("start")


def username_check(request):
    """Return whether a username is available."""
    username = (request.GET.get("u") or "").strip()
    if not username:
        return JsonResponse({"available": False})
    exists = User.objects.filter(username__iexact=username).exists()
    return JsonResponse({"available": not exists})


@csrf_exempt
def annotations_api(request):
    if request.method == "GET":
        pdf_key = (request.GET.get("pdf") or "").strip()
        if not pdf_key:
            return JsonResponse({"error": "Missing pdf"}, status=400)
        pdf_doc = PdfDocument.objects.filter(filename=pdf_key).first()
        pdf_comments = []
        if pdf_doc is not None:
            pdf_comments = [
                _pdf_comment_to_dict(c, request=request)
                for c in PdfComment.objects.filter(pdf=pdf_doc)
                .select_related("user")
                .prefetch_related("votes")
                .order_by("created_at")
            ]
        return JsonResponse({"annotations": [], "pdf_comments": pdf_comments, "source": "decentralized"})
    if request.method == "POST":
        return JsonResponse(
            {"error": "Server annotation storage has been removed; use decentralized sync"},
            status=410,
        )
    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def annotation_votes(request):
    return JsonResponse(
        {"error": "Annotation voting is no longer handled by Django storage"},
        status=410,
    )


def _pdf_comment_to_dict(comment, request=None):
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
        "hash": str(comment.hash) if comment.hash else "",
        "pdf": comment.pdf.filename,
        "user": comment.user.username,
        "body": comment.body,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
        "upvotes": upvotes,
        "downvotes": downvotes,
        "user_vote": user_vote,
    }


def _pdf_reply_to_dict(reply, request=None):
    votes = list(reply.votes.all())
    upvotes = sum(1 for v in votes if v.value == 1)
    downvotes = sum(1 for v in votes if v.value == -1)
    user_vote = 0
    if request is not None and request.user.is_authenticated:
        for vote in votes:
            if vote.user_id == request.user.id:
                user_vote = vote.value
                break
    return {
        "id": reply.id,
        "comment_id": reply.comment_id,
        "parent_id": reply.parent_id,
        "user": reply.user.username,
        "body": reply.body,
        "created_at": reply.created_at.isoformat() if reply.created_at else None,
        "upvotes": upvotes,
        "downvotes": downvotes,
        "user_vote": user_vote,
    }


@csrf_exempt
def pdf_comments(request):
    if request.method == "POST":
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Login required"}, status=401)
        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        pdf_key = (payload.get("pdf") or "").strip()
        body = (payload.get("body") or "").strip()
        if not pdf_key or not body:
            return JsonResponse({"error": "Missing fields"}, status=400)
        pdf_doc, _ = PdfDocument.objects.get_or_create(filename=pdf_key, defaults={"path": pdf_key})
        comment = PdfComment.objects.create(pdf=pdf_doc, user=request.user, body=body)
        return JsonResponse({"comment": _pdf_comment_to_dict(comment, request=request)})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def pdf_comment_votes(request):
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
        comment = PdfComment.objects.get(id=comment_id)
    except PdfComment.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    if comment.user_id == request.user.id:
        return JsonResponse({"error": "Cannot vote own comment"}, status=403)

    vote, created = PdfCommentVote.objects.get_or_create(
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

    upvotes = PdfCommentVote.objects.filter(comment=comment, value=1).count()
    downvotes = PdfCommentVote.objects.filter(comment=comment, value=-1).count()
    user_vote = 0
    try:
        user_vote = PdfCommentVote.objects.get(comment=comment, user=request.user).value
    except PdfCommentVote.DoesNotExist:
        user_vote = 0
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})


@csrf_exempt
def pdf_comment_replies(request):
    if request.method == "GET":
        comment_id = request.GET.get("comment_id")
        if not comment_id:
            return JsonResponse({"error": "Missing comment_id"}, status=400)
        replies = (
            PdfCommentReply.objects.filter(comment_id=comment_id)
            .select_related("user")
            .prefetch_related("votes")
            .order_by("created_at")
        )
        payload = [_pdf_reply_to_dict(r, request=request) for r in replies]
        return JsonResponse({"replies": payload})

    if request.method == "POST":
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Login required"}, status=401)
        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        comment_id = payload.get("comment_id")
        body = (payload.get("body") or "").strip()
        parent_id = payload.get("parent_id")
        if not comment_id or not body:
            return JsonResponse({"error": "Missing fields"}, status=400)
        try:
            comment = PdfComment.objects.get(id=comment_id)
        except PdfComment.DoesNotExist:
            return JsonResponse({"error": "Not found"}, status=404)
        parent = None
        if parent_id:
            try:
                parent = PdfCommentReply.objects.get(id=parent_id, comment=comment)
            except PdfCommentReply.DoesNotExist:
                return JsonResponse({"error": "Invalid parent"}, status=400)
        reply = PdfCommentReply.objects.create(comment=comment, user=request.user, parent=parent, body=body)
        target_user_id = comment.user_id
        if target_user_id and target_user_id != request.user.id:
            Notification.objects.create(
                user_id=target_user_id,
                notif_type=Notification.TYPE_PDF_COMMENT_REPLY,
                pdf_comment=comment,
                pdf_comment_reply=reply,
            )
        return JsonResponse({"reply": _pdf_reply_to_dict(reply, request=request)})

    return JsonResponse({"error": "Method not allowed"}, status=405)


@csrf_exempt
def pdf_reply_delete(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    reply_id = payload.get("reply_id")
    if not reply_id:
        return JsonResponse({"error": "Missing reply_id"}, status=400)
    try:
        reply = PdfCommentReply.objects.get(id=reply_id, user=request.user)
    except PdfCommentReply.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    reply.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
def pdf_reply_votes(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    reply_id = payload.get("reply_id")
    value = payload.get("value")
    if reply_id is None or value not in (-1, 1):
        return JsonResponse({"error": "Invalid payload"}, status=400)
    try:
        reply = PdfCommentReply.objects.get(id=reply_id)
    except PdfCommentReply.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    if reply.user_id == request.user.id:
        return JsonResponse({"error": "Cannot vote own reply"}, status=403)

    vote, created = PdfCommentReplyVote.objects.get_or_create(
        reply=reply,
        user=request.user,
        defaults={"value": value},
    )
    if not created:
        if vote.value == value:
            vote.delete()
        else:
            vote.value = value
            vote.save(update_fields=["value"])

    upvotes = PdfCommentReplyVote.objects.filter(reply=reply, value=1).count()
    downvotes = PdfCommentReplyVote.objects.filter(reply=reply, value=-1).count()
    user_vote = 0
    try:
        user_vote = PdfCommentReplyVote.objects.get(reply=reply, user=request.user).value
    except PdfCommentReplyVote.DoesNotExist:
        user_vote = 0
    return JsonResponse({"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote})


def notifications_summary(request):
    if not request.user.is_authenticated:
        return JsonResponse({"count": 0})
    count = Notification.objects.filter(user=request.user, is_read=False).count()
    return JsonResponse({"count": count})


def notifications_view(request):
    if not request.user.is_authenticated:
        return redirect("login")
    notifications = (
        Notification.objects.filter(user=request.user)
        .select_related("pdf_comment", "pdf_comment_reply")
        .order_by("-created_at")
    )
    items = []
    for notif in notifications:
        body = ""
        reply_body = ""
        actor = "Someone"
        if notif.notif_type == Notification.TYPE_PDF_COMMENT_REPLY:
            if notif.pdf_comment_reply and notif.pdf_comment_reply.user_id:
                actor = notif.pdf_comment_reply.user.username
            if notif.pdf_comment:
                body = notif.pdf_comment.body
            if notif.pdf_comment_reply:
                reply_body = notif.pdf_comment_reply.body
        target_url = "#"
        if notif.notif_type == Notification.TYPE_PDF_COMMENT_REPLY and notif.pdf_comment:
            target_url = f"/{notif.pdf_comment.pdf.filename.replace('.pdf', '')}/{notif.pdf_comment.hash}"
            if notif.pdf_comment_reply:
                target_url = f"{target_url}?reply={notif.pdf_comment_reply.id}"
        items.append(
            {
                "id": notif.id,
                "type": notif.notif_type,
                "created_at": notif.created_at,
                "is_read": notif.is_read,
                "body": body,
                "reply_body": reply_body,
                "actor": actor,
                "target_url": target_url,
            }
        )
    return render(request, "epstein_ui/notifications.html", {"notifications": items})


@csrf_exempt
def notifications_mark_read(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    notif_id = payload.get("id")
    if not notif_id:
        return JsonResponse({"error": "Missing id"}, status=400)
    Notification.objects.filter(id=notif_id, user=request.user).update(is_read=True)
    return JsonResponse({"ok": True})


@csrf_exempt
def annotation_comments(request):
    return JsonResponse(
        {"error": "Annotation comments are no longer handled by Django storage"},
        status=410,
    )


@csrf_exempt
def delete_comment(request):
    return JsonResponse(
        {"error": "Annotation comment deletion is no longer handled by Django storage"},
        status=410,
    )


@csrf_exempt
def comment_votes(request):
    return JsonResponse(
        {"error": "Annotation comment voting is no longer handled by Django storage"},
        status=410,
    )
