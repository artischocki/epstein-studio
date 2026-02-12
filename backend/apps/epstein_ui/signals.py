from django.db.models import Sum
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Annotation, PdfDocument, PdfVote


def _refresh_annotation_count(pdf_key: str) -> None:
    if not pdf_key:
        return
    count = Annotation.objects.filter(pdf_key=pdf_key).count()
    PdfDocument.objects.filter(filename=pdf_key).update(annotation_count=count)


def _refresh_vote_score(pdf_id: int) -> None:
    if not pdf_id:
        return
    score = PdfVote.objects.filter(pdf_id=pdf_id).aggregate(total=Sum("value")).get("total") or 0
    PdfDocument.objects.filter(id=pdf_id).update(vote_score=score)


@receiver(post_save, sender=Annotation)
def _annotation_saved(sender, instance, **kwargs):
    _refresh_annotation_count(instance.pdf_key)


@receiver(post_delete, sender=Annotation)
def _annotation_deleted(sender, instance, **kwargs):
    _refresh_annotation_count(instance.pdf_key)


@receiver(post_save, sender=PdfVote)
def _pdf_vote_saved(sender, instance, **kwargs):
    _refresh_vote_score(instance.pdf_id)


@receiver(post_delete, sender=PdfVote)
def _pdf_vote_deleted(sender, instance, **kwargs):
    _refresh_vote_score(instance.pdf_id)
