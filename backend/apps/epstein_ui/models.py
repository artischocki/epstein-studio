"""Database models for per-PDF annotation data."""
import uuid
from django.conf import settings
from django.db import models


class Annotation(models.Model):
    """Top-level annotation anchor tied to a PDF and user."""
    hash = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
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
    annotation_count = models.IntegerField(default=0)
    comment_count = models.IntegerField(default=0)
    vote_score = models.IntegerField(default=0)

    def __str__(self) -> str:
        return self.filename


class AnnotationVote(models.Model):
    """Single user vote (+1 or -1) for an annotation."""
    annotation = models.ForeignKey(Annotation, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField()

    class Meta:
        unique_together = ("annotation", "user")


class AnnotationComment(models.Model):
    """Discussion comment for an annotation."""
    annotation = models.ForeignKey(Annotation, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="replies")
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class CommentVote(models.Model):
    """Single user vote (+1 or -1) for a comment."""
    comment = models.ForeignKey(AnnotationComment, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField()

    class Meta:
        unique_together = ("comment", "user")


class PdfVote(models.Model):
    """Single user vote (+1 or -1) for a PDF file."""
    pdf = models.ForeignKey(PdfDocument, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField()

    class Meta:
        unique_together = ("pdf", "user")


class PdfComment(models.Model):
    """Discussion comment for a PDF."""
    hash = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    pdf = models.ForeignKey(PdfDocument, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class PdfCommentReply(models.Model):
    """Reply in a PDF comment discussion."""
    comment = models.ForeignKey(PdfComment, on_delete=models.CASCADE, related_name="replies")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="children")
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)


class PdfCommentReplyVote(models.Model):
    """Single user vote (+1 or -1) for a PDF comment reply."""
    reply = models.ForeignKey(PdfCommentReply, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField()

    class Meta:
        unique_together = ("reply", "user")


class PdfCommentVote(models.Model):
    """Single user vote (+1 or -1) for a PDF comment."""
    comment = models.ForeignKey(PdfComment, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    value = models.SmallIntegerField()

    class Meta:
        unique_together = ("comment", "user")


class Notification(models.Model):
    """User notification for replies on annotations or PDF comments."""
    TYPE_ANNOTATION_REPLY = "annotation_reply"
    TYPE_PDF_COMMENT_REPLY = "pdf_comment_reply"
    TYPE_CHOICES = [
        (TYPE_ANNOTATION_REPLY, "Annotation Reply"),
        (TYPE_PDF_COMMENT_REPLY, "PDF Comment Reply"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    notif_type = models.CharField(max_length=64, choices=TYPE_CHOICES)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional references to the origin of the notification
    annotation = models.ForeignKey(Annotation, null=True, blank=True, on_delete=models.CASCADE)
    annotation_comment = models.ForeignKey(AnnotationComment, null=True, blank=True, on_delete=models.CASCADE)
    pdf_comment = models.ForeignKey(PdfComment, null=True, blank=True, on_delete=models.CASCADE)
    pdf_comment_reply = models.ForeignKey(PdfCommentReply, null=True, blank=True, on_delete=models.CASCADE)
