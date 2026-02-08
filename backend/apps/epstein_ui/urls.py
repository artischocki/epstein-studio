from django.urls import path
from django.urls import re_path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("random-pdf/", views.random_pdf, name="random_pdf"),
    path("search-pdf/", views.search_pdf, name="search_pdf"),
    path("search-suggestions/", views.search_suggestions, name="search_suggestions"),
    path("register/", views.register, name="register"),
    path("logout/", views.logout_view, name="logout"),
    path("annotations/", views.annotations_api, name="annotations_api"),
    path("annotation-votes/", views.annotation_votes, name="annotation_votes"),
    path("annotation-comments/", views.annotation_comments, name="annotation_comments"),
    path("comment-votes/", views.comment_votes, name="comment_votes"),
    path("comment-delete/", views.delete_comment, name="comment_delete"),
    re_path(r"^(?P<pdf_slug>[A-Za-z0-9_-]+)$", views.index, name="index_pdf"),
]
