"""Database models for per-PDF collaboration data."""
import uuid
from django.conf import settings
from django.db import models


class PdfDocument(models.Model):
    """Indexed PDF available for discussion."""
    filename = models.CharField(max_length=255, db_index=True)
    path = models.TextField(unique=True)
    annotation_count = models.IntegerField(default=0)
    comment_count = models.IntegerField(default=0)
    vote_score = models.IntegerField(default=0)

    def __str__(self) -> str:
        return self.filename


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
    """User notification for replies on PDF comments."""
    TYPE_PDF_COMMENT_REPLY = "pdf_comment_reply"
    TYPE_CHOICES = [
        (TYPE_PDF_COMMENT_REPLY, "PDF Comment Reply"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    notif_type = models.CharField(max_length=64, choices=TYPE_CHOICES)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional references to the origin of the notification
    pdf_comment = models.ForeignKey(PdfComment, null=True, blank=True, on_delete=models.CASCADE)
    pdf_comment_reply = models.ForeignKey(PdfCommentReply, null=True, blank=True, on_delete=models.CASCADE)
