FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock* /app/
RUN uv sync

COPY . /app

WORKDIR /app/backend

EXPOSE 8000
CMD ["uv", "run", "gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]
