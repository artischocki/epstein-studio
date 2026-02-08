import uuid
from django.db import migrations, models


def populate_hashes(apps, schema_editor):
    Annotation = apps.get_model("epstein_ui", "Annotation")
    for annotation in Annotation.objects.all():
        if annotation.hash:
            continue
        annotation.hash = uuid.uuid4()
        annotation.save(update_fields=["hash"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("epstein_ui", "0003_annotationvote"),
    ]

    operations = [
        migrations.AddField(
            model_name="annotation",
            name="hash",
            field=models.UUIDField(null=True, editable=False, unique=False),
        ),
        migrations.RunPython(populate_hashes, noop),
        migrations.AlterField(
            model_name="annotation",
            name="hash",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
