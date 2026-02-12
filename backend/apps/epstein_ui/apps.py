from django.apps import AppConfig


class EpsteinUiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.epstein_ui"

    def ready(self):
        from . import signals  # noqa: F401
