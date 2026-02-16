from django.core.management.base import BaseCommand
from django.db.models import Count, Sum

from apps.epstein_ui.models import PdfComment, PdfDocument, PdfVote
from apps.epstein_ui.views import _sync_pdf_index


class Command(BaseCommand):
    help = "Index PDFs on disk and refresh per-PDF counters."

    def handle(self, *args, **options):
        self.stdout.write("Syncing PDF index...")
        pdfs = _sync_pdf_index()
        self.stdout.write(f"Indexed {len(pdfs)} PDFs.")

        self.stdout.write("Refreshing annotation counts...")
        comment_rows = PdfComment.objects.values("pdf__filename").annotate(total=Count("id"))
        comment_map = {row["pdf__filename"]: row["total"] for row in comment_rows}

        self.stdout.write("Refreshing vote scores...")
        vote_rows = PdfVote.objects.values("pdf_id").annotate(score=Sum("value"))
        vote_map = {row["pdf_id"]: row["score"] or 0 for row in vote_rows}

        for doc in PdfDocument.objects.all():
            PdfDocument.objects.filter(id=doc.id).update(
                annotation_count=comment_map.get(doc.filename, 0),
                vote_score=vote_map.get(doc.id, 0),
            )

        self.stdout.write(self.style.SUCCESS("PDF index and counters refreshed."))
