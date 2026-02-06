from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("random-pdf/", views.random_pdf, name="random_pdf"),
    path("search-pdf/", views.search_pdf, name="search_pdf"),
]
