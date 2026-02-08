"""Database models for per-PDF annotation data."""
from django.conf import settings
from django.db import models


class Annotation(models.Model):
    """Top-level annotation anchor tied to a PDF and user."""
    pdf_key = models.CharField(max_length=255, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    client_id = models.CharField(max_length=64)
    x = models.FloatField()
    y = models.FloatField()
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("pdf_key", "user", "client_id")


class TextItem(models.Model):
    """Placed text overlay belonging to an annotation."""
    annotation = models.ForeignKey(Annotation, on_delete=models.CASCADE, related_name="text_items")
    x = models.FloatField()
    y = models.FloatField()
    text = models.TextField(blank=True)
    font_family = models.CharField(max_length=255, blank=True)
    font_size = models.CharField(max_length=32, blank=True)
    font_weight = models.CharField(max_length=32, blank=True)
    font_style = models.CharField(max_length=32, blank=True)
    font_kerning = models.CharField(max_length=32, blank=True)
    font_feature_settings = models.CharField(max_length=64, blank=True)
    color = models.CharField(max_length=32, blank=True)
    opacity = models.FloatField(default=1)


class ArrowItem(models.Model):
    """Hint arrow belonging to an annotation."""
    annotation = models.ForeignKey(Annotation, on_delete=models.CASCADE, related_name="arrow_items")
    x1 = models.FloatField()
    y1 = models.FloatField()
    x2 = models.FloatField()
    y2 = models.FloatField()


class PdfDocument(models.Model):
    """Indexed PDF available for annotation."""
    filename = models.CharField(max_length=255, db_index=True)
    path = models.TextField(unique=True)

    def __str__(self) -> str:
        return self.filename


class AnnotationVote(models.Model):
    """Single user vote (+1 or -1) for an annotation."""
    annotation = models.ForeignKey(Annotation, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField()

    class Meta:
        unique_together = ("annotation", "user")
