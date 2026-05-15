FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    FLASK_DEBUG=0

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        libglib2.0-0 \
        libgl1 \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno (required by yt-dlp for JS runtime / remote components)
RUN curl -fsSL https://github.com/denoland/deno/releases/download/v2.6.7/deno-x86_64-unknown-linux-gnu.zip \
        -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip

COPY requirements.txt requirements_web.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements_web.txt

COPY . .

EXPOSE 7860

CMD ["python", "web_app.py"]
