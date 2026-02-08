from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("random-pdf/", views.random_pdf, name="random_pdf"),
    path("search-pdf/", views.search_pdf, name="search_pdf"),
    path("search-suggestions/", views.search_suggestions, name="search_suggestions"),
    path("register/", views.register, name="register"),
    path("logout/", views.logout_view, name="logout"),
    path("annotations/", views.annotations_api, name="annotations_api"),
]
