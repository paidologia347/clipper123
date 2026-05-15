"""
YT Short Clipper - Web Application
Flask + Socket.IO backend that preserves all desktop app functionality.
"""

import os
import sys
import json
import threading
import time
import uuid
import shutil
import re
import base64
from pathlib import Path
from datetime import datetime

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_socketio import SocketIO, emit

from version import __version__
from config.config_manager import ConfigManager
from config.ai_provider_config import (
    AI_PROVIDERS_CONFIG, SPECIALIZED_MODELS,
    get_provider_name, get_provider_base_url,
    get_provider_default_models, get_all_providers,
    get_provider_display_list, requires_model_load,
    get_provider_description, get_provider_docs_url,
    get_specialized_models
)
from utils.helpers import get_app_dir, get_bundle_dir, get_ffmpeg_path, get_ytdlp_path, extract_video_id
from utils.logger import debug_log

# ── App Directories ──────────────────────────────────────────────────
APP_DIR = get_app_dir()
CONFIG_FILE = APP_DIR / "config.json"
OUTPUT_DIR = APP_DIR / "output"
COOKIES_FILE = APP_DIR / "cookies.txt"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Flask + SocketIO ─────────────────────────────────────────────────
app = Flask(
    __name__,
    static_folder="static",
    template_folder="templates",
)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "yt-short-clipper-web-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── Global State ─────────────────────────────────────────────────────
config_manager = ConfigManager(CONFIG_FILE, OUTPUT_DIR)
processing_lock = threading.Lock()
active_jobs = {}  # job_id -> job info


# ════════════════════════════════════════════════════════════════════
#  ROUTES – Pages
# ════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html", version=__version__)


@app.route("/static/assets/<path:filename>")
def serve_asset(filename):
    assets_dir = Path(__file__).parent / "static" / "assets"
    return send_from_directory(str(assets_dir), filename)


# ════════════════════════════════════════════════════════════════════
#  API – Configuration
# ════════════════════════════════════════════════════════════════════

@app.route("/api/config", methods=["GET"])
def get_config():
    """Get current configuration (masks API keys)"""
    cfg = config_manager.config.copy()
    safe = _mask_config(cfg)
    return jsonify(safe)


@app.route("/api/config", methods=["POST"])
def save_config():
    """Save configuration"""
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    for key, value in data.items():
        config_manager.config[key] = value
    config_manager.save()
    return jsonify({"status": "saved"})


@app.route("/api/config/ai_providers", methods=["GET"])
def get_ai_providers():
    """Get AI provider settings"""
    providers = config_manager.get("ai_providers", {})
    return jsonify(providers)


@app.route("/api/config/ai_providers", methods=["POST"])
def save_ai_providers():
    """Save AI provider settings"""
    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    config_manager.config["ai_providers"] = data

    # Sync backward-compat fields
    hf = data.get("highlight_finder", {})
    config_manager.config["api_key"] = hf.get("api_key", "")
    config_manager.config["base_url"] = hf.get("base_url", "https://api.openai.com/v1")
    config_manager.config["model"] = hf.get("model", "gpt-4.1")

    provider_type = data.pop("_provider_type", None)
    if provider_type:
        config_manager.config["provider_type"] = provider_type

    config_manager.save()
    return jsonify({"status": "saved"})


@app.route("/api/providers", methods=["GET"])
def list_providers():
    """List available AI providers"""
    providers = []
    for key, cfg in AI_PROVIDERS_CONFIG.items():
        providers.append({
            "key": key,
            "name": cfg["name"],
            "base_url": cfg["base_url"],
            "description": cfg["description"],
            "default_models": cfg["default_models"],
            "requires_load": cfg.get("requires_load", False),
            "docs_url": cfg.get("docs_url", ""),
        })
    return jsonify(providers)


@app.route("/api/providers/models", methods=["POST"])
def fetch_models():
    """Fetch models from a provider endpoint"""
    data = request.json
    base_url = (data or {}).get("base_url", "")
    api_key = (data or {}).get("api_key", "")
    if not base_url:
        return jsonify({"models": []})

    import requests as req
    url = base_url.rstrip("/")
    if url.endswith("/v1"):
        url += "/models"
    elif "/models" not in url:
        url += "/v1/models"

    try:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        resp = req.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            return jsonify({"models": [], "error": f"HTTP {resp.status_code}"})
        items = resp.json().get("data", [])
        models = sorted([it["id"] for it in items if "id" in it])
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"models": [], "error": str(e)})


@app.route("/api/validate_key", methods=["POST"])
def validate_api_key():
    """Validate an API key against a provider endpoint"""
    data = request.json
    base_url = (data or {}).get("base_url", "")
    api_key = (data or {}).get("api_key", "")

    if not base_url or not api_key:
        return jsonify({"status": "error", "message": "Missing base_url or api_key"})

    import requests as req
    url = base_url.rstrip("/")
    if url.endswith("/v1"):
        url += "/models"
    elif "/models" not in url:
        url += "/v1/models"

    try:
        resp = req.get(url, headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
        if resp.status_code == 200:
            return jsonify({"status": "ok"})
        return jsonify({"status": "error", "message": f"HTTP {resp.status_code}"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})


# ════════════════════════════════════════════════════════════════════
#  API – Settings (watermark, performance, output, etc.)
# ════════════════════════════════════════════════════════════════════

@app.route("/api/settings/watermark", methods=["GET"])
def get_watermark():
    return jsonify(config_manager.get("watermark", {"enabled": False}))


@app.route("/api/settings/watermark", methods=["POST"])
def save_watermark():
    config_manager.config["watermark"] = request.json
    config_manager.save()
    return jsonify({"status": "saved"})


@app.route("/api/settings/credit_watermark", methods=["GET"])
def get_credit_watermark():
    return jsonify(config_manager.get("credit_watermark", {"enabled": False}))


@app.route("/api/settings/credit_watermark", methods=["POST"])
def save_credit_watermark():
    config_manager.config["credit_watermark"] = request.json
    config_manager.save()
    return jsonify({"status": "saved"})


@app.route("/api/settings/performance", methods=["GET"])
def get_performance():
    return jsonify({
        "face_tracking_mode": config_manager.get("face_tracking_mode", "opencv"),
        "mediapipe_settings": config_manager.get("mediapipe_settings", {}),
        "gpu_acceleration": config_manager.get("gpu_acceleration", {"enabled": False}),
    })


@app.route("/api/settings/performance", methods=["POST"])
def save_performance():
    data = request.json
    if "face_tracking_mode" in data:
        config_manager.config["face_tracking_mode"] = data["face_tracking_mode"]
    if "mediapipe_settings" in data:
        config_manager.config["mediapipe_settings"] = data["mediapipe_settings"]
    if "gpu_acceleration" in data:
        config_manager.config["gpu_acceleration"] = data["gpu_acceleration"]
    config_manager.save()
    return jsonify({"status": "saved"})


@app.route("/api/settings/output", methods=["GET"])
def get_output_settings():
    return jsonify({
        "output_dir": config_manager.get("output_dir", str(OUTPUT_DIR)),
        "system_prompt": config_manager.get("system_prompt", ""),
        "temperature": config_manager.get("temperature", 1.0),
    })


@app.route("/api/settings/output", methods=["POST"])
def save_output_settings():
    data = request.json
    for k in ("output_dir", "system_prompt", "temperature"):
        if k in data:
            config_manager.config[k] = data[k]
    config_manager.save()
    return jsonify({"status": "saved"})


# ════════════════════════════════════════════════════════════════════
#  API – Cookies
# ════════════════════════════════════════════════════════════════════

@app.route("/api/cookies/status", methods=["GET"])
def cookies_status():
    if COOKIES_FILE.exists():
        lines = COOKIES_FILE.read_text(errors="ignore").strip().split("\n")
        cookie_lines = [l for l in lines if l.strip() and not l.startswith("#")]
        return jsonify({"has_cookies": True, "count": len(cookie_lines)})
    return jsonify({"has_cookies": False, "count": 0})


@app.route("/api/cookies/upload", methods=["POST"])
def upload_cookies():
    if "file" not in request.files:
        # Try text body
        text = request.form.get("text", "") or (request.data.decode("utf-8", errors="ignore") if request.data else "")
        if text.strip():
            COOKIES_FILE.write_text(text)
            return jsonify({"status": "ok"})
        return jsonify({"error": "No file or text provided"}), 400

    f = request.files["file"]
    f.save(str(COOKIES_FILE))
    return jsonify({"status": "ok"})


# ════════════════════════════════════════════════════════════════════
#  API – Video Info / Thumbnail
# ════════════════════════════════════════════════════════════════════

@app.route("/api/video/info", methods=["POST"])
def get_video_info():
    """Get video info (thumbnail, title, available subtitles)"""
    data = request.json
    url = (data or {}).get("url", "")
    if not url:
        return jsonify({"error": "No URL"}), 400

    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"error": "Invalid YouTube URL"}), 400

    # Fetch info using yt-dlp
    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            "skip_download": True,
        }
        # Add cookies if available, otherwise use cookieless player clients
        if COOKIES_FILE.exists():
            ydl_opts["cookiefile"] = str(COOKIES_FILE)
        else:
            # Cookieless mode: use player_client switching
            ydl_opts["extractor_args"] = {"youtube": {"player_client": ["mweb", "tv_embedded"]}}
        
        # Optional proxy support
        proxy_url = os.environ.get("YTDLP_PROXY", "")
        if proxy_url:
            ydl_opts["proxy"] = proxy_url

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        # Get available subtitles
        subtitles = {}
        for lang, subs in (info.get("subtitles") or {}).items():
            subtitles[lang] = f"{lang}"
        for lang, subs in (info.get("automatic_captions") or {}).items():
            if lang not in subtitles:
                subtitles[lang] = f"{lang} (auto)"

        return jsonify({
            "video_id": video_id,
            "title": info.get("title", ""),
            "channel": info.get("channel", info.get("uploader", "")),
            "duration": info.get("duration", 0),
            "thumbnail": info.get("thumbnail", f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"),
            "subtitles": subtitles,
        })
    except Exception as e:
        # Fallback with basic info
        return jsonify({
            "video_id": video_id,
            "title": "",
            "channel": "",
            "duration": 0,
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
            "subtitles": {"id": "id", "en": "en"},
            "warning": str(e),
        })


# ════════════════════════════════════════════════════════════════════
#  API – Processing (Find Highlights)
# ════════════════════════════════════════════════════════════════════

@app.route("/api/process/start", methods=["POST"])
def start_processing():
    """Start the highlight finding process"""
    data = request.json or {}
    url = data.get("url", "")
    num_clips = int(data.get("num_clips", 5))
    subtitle_lang = data.get("subtitle_lang", "id")

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    job_id = str(uuid.uuid4())[:8]

    if not processing_lock.acquire(blocking=False):
        return jsonify({"error": "Another job is running", "busy": True}), 409

    def run_job():
        try:
            _run_find_highlights(job_id, url, num_clips, subtitle_lang)
        finally:
            processing_lock.release()

    t = threading.Thread(target=run_job, daemon=True)
    t.start()

    active_jobs[job_id] = {
        "type": "find_highlights",
        "url": url,
        "status": "running",
        "thread": t,
    }
    return jsonify({"job_id": job_id, "status": "started"})


@app.route("/api/source/upload", methods=["POST"])
def upload_source_video():
    """Upload a local source video and start highlight detection via AI transcription."""
    if "file" not in request.files:
        return jsonify({"error": "No video file provided"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No filename provided"}), 400

    num_clips = int(request.form.get("num_clips", 5))
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(f.filename).name)
    upload_dir = OUTPUT_DIR / "_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_path = upload_dir / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{safe_name}"
    f.save(str(upload_path))

    job_id = str(uuid.uuid4())[:8]

    if not processing_lock.acquire(blocking=False):
        return jsonify({"error": "Another job is running", "busy": True}), 409

    title = request.form.get("title") or Path(f.filename).stem

    def run_job():
        try:
            _run_find_highlights_from_upload(job_id, str(upload_path), num_clips, title)
        finally:
            processing_lock.release()

    t = threading.Thread(target=run_job, daemon=True)
    t.start()

    active_jobs[job_id] = {
        "type": "find_highlights_upload",
        "video_path": str(upload_path),
        "status": "running",
        "thread": t,
    }
    return jsonify({"job_id": job_id, "status": "started", "video_path": str(upload_path)})


def _run_find_highlights(job_id, url, num_clips, subtitle_lang):
    """Background: download video + find highlights"""
    from openai import OpenAI
    from clipper_core import AutoClipperCore, SubtitleNotFoundError

    cfg = config_manager.config
    ai_providers = cfg.get("ai_providers", {})

    def log_cb(msg):
        socketio.emit("log", {"job_id": job_id, "message": str(msg)})

    def progress_cb(step_text, progress=None):
        socketio.emit("progress", {
            "job_id": job_id,
            "step": str(step_text),
            "progress": float(progress) if progress is not None else 0,
        })

    try:
        progress_cb("Initializing...", 0.0)

        hf_config = ai_providers.get("highlight_finder", {})
        client = OpenAI(
            api_key=hf_config.get("api_key", ""),
            base_url=hf_config.get("base_url", "https://api.openai.com/v1"),
        ) if hf_config.get("api_key") else None

        output_dir = cfg.get("output_dir", str(OUTPUT_DIR))

        core = AutoClipperCore(
            client=client,
            ffmpeg_path=get_ffmpeg_path(),
            ytdlp_path=get_ytdlp_path(),
            output_dir=output_dir,
            model=hf_config.get("model", "gpt-4.1"),
            tts_model=cfg.get("tts_model", "tts-1"),
            temperature=cfg.get("temperature", 1.0),
            system_prompt=cfg.get("system_prompt"),
            watermark_settings=cfg.get("watermark", {"enabled": False}),
            credit_watermark_settings=cfg.get("credit_watermark", {"enabled": False}),
            face_tracking_mode=cfg.get("face_tracking_mode", "opencv"),
            mediapipe_settings=cfg.get("mediapipe_settings"),
            ai_providers=ai_providers,
            subtitle_language=subtitle_lang,
            log_callback=log_cb,
            progress_callback=progress_cb,
        )

        # GPU
        gpu_cfg = cfg.get("gpu_acceleration", {})
        if gpu_cfg.get("enabled"):
            core.enable_gpu_acceleration(True)

        # Step 1: Download
        progress_cb("Downloading video & subtitles...", 0.1)
        video_path, srt_path, video_info = core.download_video(url)
        channel_name = video_info.get("channel", "") if video_info else ""
        core.channel_name = channel_name

        use_whisper = False
        if not srt_path:
            # Try whisper transcription
            progress_cb("No subtitles found. Trying AI transcription...", 0.25)
            try:
                srt_path = core.transcribe_with_whisper(video_path)
                use_whisper = True
            except Exception:
                pass

        if not srt_path:
            raise Exception(f"No subtitle available for language: {subtitle_lang.upper()}")

        # Step 2: Find highlights
        progress_cb("Finding highlights with AI...", 0.4)
        transcript = core.parse_srt(srt_path)
        highlights = core.find_highlights(transcript, video_info, num_clips)

        if not highlights:
            raise Exception("No valid highlights found!")

        # Store session data
        session_dir = str(core.temp_dir)
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Save session
        session_data = {
            "session_id": session_id,
            "video_path": str(video_path),
            "video_info": video_info or {},
            "highlights": highlights,
            "session_dir": session_dir,
            "channel_name": channel_name,
            "use_whisper": use_whisper,
        }

        session_file = Path(output_dir) / f"_session_{session_id}.json"
        session_file.parent.mkdir(parents=True, exist_ok=True)
        with open(session_file, "w") as f:
            json.dump(session_data, f, indent=2, default=str)

        active_jobs[job_id]["status"] = "highlights_ready"
        active_jobs[job_id]["session_data"] = session_data

        progress_cb("Highlights found!", 1.0)
        socketio.emit("highlights_ready", {
            "job_id": job_id,
            "session_id": session_id,
            "highlights": highlights,
            "video_info": video_info or {},
            "channel_name": channel_name,
        })

    except Exception as e:
        active_jobs[job_id]["status"] = "error"
        active_jobs[job_id]["error"] = str(e)
        socketio.emit("job_error", {"job_id": job_id, "error": str(e)})
        log_cb(f"Error: {e}")


def _run_find_highlights_from_upload(job_id, video_path, num_clips, title):
    """Background: transcribe an uploaded video + find highlights."""
    from openai import OpenAI
    from clipper_core import AutoClipperCore

    cfg = config_manager.config
    ai_providers = cfg.get("ai_providers", {})

    def log_cb(msg):
        socketio.emit("log", {"job_id": job_id, "message": str(msg)})

    def progress_cb(step_text, progress=None):
        socketio.emit("progress", {
            "job_id": job_id,
            "step": str(step_text),
            "progress": float(progress) if progress is not None else 0,
        })

    try:
        progress_cb("Preparing uploaded video...", 0.05)

        hf_config = ai_providers.get("highlight_finder", {})
        client = OpenAI(
            api_key=hf_config.get("api_key", ""),
            base_url=hf_config.get("base_url", "https://api.openai.com/v1"),
        ) if hf_config.get("api_key") else None

        output_dir = cfg.get("output_dir", str(OUTPUT_DIR))
        core = AutoClipperCore(
            client=client,
            ffmpeg_path=get_ffmpeg_path(),
            ytdlp_path=get_ytdlp_path(),
            output_dir=output_dir,
            model=hf_config.get("model", "gpt-4.1"),
            tts_model=cfg.get("tts_model", "tts-1"),
            temperature=cfg.get("temperature", 1.0),
            system_prompt=cfg.get("system_prompt"),
            watermark_settings=cfg.get("watermark", {"enabled": False}),
            credit_watermark_settings=cfg.get("credit_watermark", {"enabled": False}),
            face_tracking_mode=cfg.get("face_tracking_mode", "opencv"),
            mediapipe_settings=cfg.get("mediapipe_settings"),
            ai_providers=ai_providers,
            subtitle_language="id",
            log_callback=log_cb,
            progress_callback=progress_cb,
        )

        gpu_cfg = cfg.get("gpu_acceleration", {})
        if gpu_cfg.get("enabled"):
            core.enable_gpu_acceleration(True)

        video_info = {
            "title": title,
            "description": "Uploaded source video",
            "channel": "Uploaded video",
        }
        core.channel_name = video_info["channel"]

        progress_cb("Transcribing uploaded video...", 0.2)
        result = core.find_highlights_with_transcription(video_path, video_info, num_clips)
        if not result or not result.get("highlights"):
            raise Exception("No valid highlights found from uploaded video")

        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        session_data = {
            "session_id": session_id,
            "video_path": str(video_path),
            "video_info": video_info,
            "highlights": result["highlights"],
            "session_dir": result.get("session_dir", ""),
            "channel_name": video_info["channel"],
            "use_whisper": True,
            "source_type": "upload",
        }

        session_file = Path(output_dir) / f"_session_{session_id}.json"
        session_file.parent.mkdir(parents=True, exist_ok=True)
        with open(session_file, "w") as f:
            json.dump(session_data, f, indent=2, default=str)

        active_jobs[job_id]["status"] = "highlights_ready"
        active_jobs[job_id]["session_data"] = session_data

        progress_cb("Highlights found!", 1.0)
        socketio.emit("highlights_ready", {
            "job_id": job_id,
            "session_id": session_id,
            "highlights": result["highlights"],
            "video_info": video_info,
            "channel_name": video_info["channel"],
        })

    except Exception as e:
        active_jobs[job_id]["status"] = "error"
        active_jobs[job_id]["error"] = str(e)
        socketio.emit("job_error", {"job_id": job_id, "error": str(e)})
        log_cb(f"Error: {e}")


# ════════════════════════════════════════════════════════════════════
#  API – Clipping (Process selected highlights)
# ════════════════════════════════════════════════════════════════════

@app.route("/api/clip/start", methods=["POST"])
def start_clipping():
    """Start clipping selected highlights"""
    data = request.json or {}
    job_id_ref = data.get("job_id", "")
    session_id = data.get("session_id", "")
    selected_indices = data.get("selected", [])
    add_captions = data.get("add_captions", False)
    add_hook = data.get("add_hook", False)
    add_publish_pack = data.get("add_publish_pack", True)

    # Find session data
    session_data = None
    if job_id_ref and job_id_ref in active_jobs:
        session_data = active_jobs[job_id_ref].get("session_data")

    if not session_data and session_id:
        # Try loading from file
        output_dir = config_manager.get("output_dir", str(OUTPUT_DIR))
        session_file = Path(output_dir) / f"_session_{session_id}.json"
        if session_file.exists():
            with open(session_file) as f:
                session_data = json.load(f)

    if not session_data:
        return jsonify({"error": "Session not found"}), 404

    clip_job_id = str(uuid.uuid4())[:8]

    if not processing_lock.acquire(blocking=False):
        return jsonify({"error": "Another job is running", "busy": True}), 409

    def run_clip():
        try:
            _run_clipping(clip_job_id, session_data, selected_indices, add_captions, add_hook, add_publish_pack)
        finally:
            processing_lock.release()

    t = threading.Thread(target=run_clip, daemon=True)
    t.start()

    active_jobs[clip_job_id] = {"type": "clipping", "status": "running", "thread": t}
    return jsonify({"job_id": clip_job_id, "status": "started"})


def _run_clipping(job_id, session_data, selected_indices, add_captions, add_hook, add_publish_pack):
    """Background: clip selected highlights"""
    from openai import OpenAI
    from clipper_core import AutoClipperCore

    cfg = config_manager.config
    ai_providers = cfg.get("ai_providers", {})

    def log_cb(msg):
        socketio.emit("log", {"job_id": job_id, "message": str(msg)})

    def progress_cb(step_text, progress=None):
        socketio.emit("clip_progress", {
            "job_id": job_id,
            "step": str(step_text),
            "progress": float(progress) if progress is not None else 0,
        })

    try:
        highlights = session_data.get("highlights", [])
        video_path = session_data.get("video_path", "")
        channel_name = session_data.get("channel_name", "")

        # Filter selected highlights
        if selected_indices:
            selected = [highlights[i] for i in selected_indices if i < len(highlights)]
        else:
            selected = highlights

        if not selected:
            raise Exception("No highlights selected")

        hf_config = ai_providers.get("highlight_finder", {})
        client = OpenAI(
            api_key=hf_config.get("api_key", ""),
            base_url=hf_config.get("base_url", "https://api.openai.com/v1"),
        ) if hf_config.get("api_key") else None

        output_dir = cfg.get("output_dir", str(OUTPUT_DIR))

        core = AutoClipperCore(
            client=client,
            ffmpeg_path=get_ffmpeg_path(),
            ytdlp_path=get_ytdlp_path(),
            output_dir=output_dir,
            model=hf_config.get("model", "gpt-4.1"),
            tts_model=cfg.get("tts_model", "tts-1"),
            temperature=cfg.get("temperature", 1.0),
            system_prompt=cfg.get("system_prompt"),
            watermark_settings=cfg.get("watermark", {"enabled": False}),
            credit_watermark_settings=cfg.get("credit_watermark", {"enabled": False}),
            face_tracking_mode=cfg.get("face_tracking_mode", "opencv"),
            mediapipe_settings=cfg.get("mediapipe_settings"),
            ai_providers=ai_providers,
            log_callback=log_cb,
            progress_callback=progress_cb,
        )
        core.channel_name = channel_name

        # GPU
        gpu_cfg = cfg.get("gpu_acceleration", {})
        if gpu_cfg.get("enabled"):
            core.enable_gpu_acceleration(True)

        total = len(selected)
        created_clips = []

        for i, highlight in enumerate(selected, 1):
            progress_cb(f"Clipping {i}/{total}: {highlight.get('title', '')}", i / total)
            socketio.emit("clip_item_progress", {
                "job_id": job_id,
                "current": i,
                "total": total,
                "title": highlight.get("title", ""),
            })

            try:
                clip_info = core.process_clip(
                    video_path, highlight, i, total,
                    add_captions=add_captions, add_hook=add_hook,
                    add_publish_pack=add_publish_pack,
                )
                if clip_info:
                    created_clips.append(clip_info)
            except Exception as e:
                log_cb(f"  Error clipping #{i}: {e}")

        # Cleanup temp
        try:
            core.cleanup()
        except Exception:
            pass

        active_jobs[job_id]["status"] = "complete"
        active_jobs[job_id]["clips"] = created_clips

        progress_cb("All clips created!", 1.0)
        socketio.emit("clipping_complete", {
            "job_id": job_id,
            "clips_count": len(created_clips),
            "output_dir": output_dir,
        })

    except Exception as e:
        active_jobs[job_id]["status"] = "error"
        socketio.emit("job_error", {"job_id": job_id, "error": str(e)})
        log_cb(f"Error: {e}")


# ════════════════════════════════════════════════════════════════════
#  API – Job Management
# ════════════════════════════════════════════════════════════════════

@app.route("/api/job/<job_id>", methods=["GET"])
def get_job_status(job_id):
    job = active_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id": job_id,
        "type": job.get("type"),
        "status": job.get("status"),
        "error": job.get("error"),
    })


@app.route("/api/job/<job_id>/cancel", methods=["POST"])
def cancel_job(job_id):
    job = active_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    job["status"] = "cancelled"
    return jsonify({"status": "cancelled"})


# ════════════════════════════════════════════════════════════════════
#  API – Sessions & Results (Browse)
# ════════════════════════════════════════════════════════════════════

@app.route("/api/sessions", methods=["GET"])
def list_sessions():
    """List all output sessions"""
    output_dir = Path(config_manager.get("output_dir", str(OUTPUT_DIR)))
    sessions = []

    if not output_dir.exists():
        return jsonify(sessions)

    for d in sorted(output_dir.iterdir(), reverse=True):
        if d.is_dir() and not d.name.startswith("_"):
            # Each session directory
            session_info = {"name": d.name, "path": str(d), "clips": []}
            clips_dir = d / "clips" if (d / "clips").exists() else d

            for clip_dir in sorted(clips_dir.iterdir()):
                if clip_dir.is_dir():
                    data_file = clip_dir / "data.json"
                    master_file = clip_dir / "master.mp4"
                    if master_file.exists():
                        clip_data = {}
                        if data_file.exists():
                            try:
                                with open(data_file) as f:
                                    clip_data = json.load(f)
                            except Exception:
                                pass
                        session_info["clips"].append({
                            "name": clip_dir.name,
                            "title": clip_data.get("title", clip_dir.name),
                            "hook_text": clip_data.get("hook_text", ""),
                            "duration": clip_data.get("duration_seconds", 0),
                            "virality_score": clip_data.get("virality_score", 0),
                            "video_path": str(master_file),
                            "publish_pack": clip_data.get("publish_pack", {}),
                        })

            if session_info["clips"]:
                sessions.append(session_info)

    return jsonify(sessions[:50])


@app.route("/api/sessions/video", methods=["GET"])
def serve_video():
    """Serve a video file"""
    path = request.args.get("path", "")
    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, mimetype="video/mp4")


@app.route("/api/sessions/thumbnail", methods=["GET"])
def serve_thumbnail():
    """Serve a generated thumbnail image"""
    path = request.args.get("path", "")
    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, mimetype="image/jpeg")


@app.route("/api/sessions/download", methods=["GET"])
def download_video():
    """Download a video file"""
    path = request.args.get("path", "")
    if not path or not Path(path).exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, as_attachment=True)


# ════════════════════════════════════════════════════════════════════
#  API – Library Status
# ════════════════════════════════════════════════════════════════════

@app.route("/api/lib/status", methods=["GET"])
def lib_status():
    """Check required libraries status"""
    ffmpeg_path = get_ffmpeg_path()
    ytdlp_path = get_ytdlp_path()

    ffmpeg_ok = False
    ffmpeg_version = ""
    try:
        import subprocess
        result = subprocess.run([ffmpeg_path, "-version"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            ffmpeg_ok = True
            first_line = result.stdout.split("\n")[0]
            ffmpeg_version = first_line
    except Exception:
        pass

    ytdlp_ok = False
    ytdlp_version = ""
    try:
        import yt_dlp
        ytdlp_ok = True
        ytdlp_version = yt_dlp.version.__version__
    except ImportError:
        try:
            import subprocess
            result = subprocess.run([ytdlp_path, "--version"], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                ytdlp_ok = True
                ytdlp_version = result.stdout.strip()
        except Exception:
            pass

    deno_ok = False
    deno_version = ""
    try:
        from utils.helpers import get_deno_path
        deno_path = get_deno_path()
        if deno_path:
            import subprocess
            result = subprocess.run([deno_path, "--version"], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                deno_ok = True
                deno_version = result.stdout.split("\n")[0]
    except Exception:
        pass

    return jsonify({
        "ffmpeg": {"available": ffmpeg_ok, "version": ffmpeg_version, "path": ffmpeg_path},
        "ytdlp": {"available": ytdlp_ok, "version": ytdlp_version, "path": ytdlp_path},
        "deno": {"available": deno_ok, "version": deno_version},
    })


# ════════════════════════════════════════════════════════════════════
#  API – Version / About
# ════════════════════════════════════════════════════════════════════

@app.route("/api/version", methods=["GET"])
def get_version():
    return jsonify({
        "version": __version__,
        "platform": sys.platform,
    })


@app.route("/api/version/check", methods=["GET"])
def check_update():
    """Check for updates"""
    from version import UPDATE_CHECK_URL
    import requests as req
    try:
        resp = req.get(UPDATE_CHECK_URL, timeout=5)
        data = resp.json()
        return jsonify({
            "current": __version__,
            "latest": data.get("version", __version__),
            "update_available": data.get("version", __version__) != __version__,
            "download_url": data.get("download_url", ""),
        })
    except Exception:
        return jsonify({
            "current": __version__,
            "latest": __version__,
            "update_available": False,
        })


# ════════════════════════════════════════════════════════════════════
#  API – Watermark Upload
# ════════════════════════════════════════════════════════════════════

@app.route("/api/watermark/upload", methods=["POST"])
def upload_watermark():
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    f = request.files["file"]
    watermark_dir = APP_DIR / "watermarks"
    watermark_dir.mkdir(exist_ok=True)
    save_path = watermark_dir / f.filename
    f.save(str(save_path))
    return jsonify({"status": "ok", "path": str(save_path)})


# ════════════════════════════════════════════════════════════════════
#  Helpers
# ════════════════════════════════════════════════════════════════════

def _mask_config(cfg):
    """Mask sensitive values in config for frontend display"""
    safe = cfg.copy()
    # Mask API keys
    if "api_key" in safe and safe["api_key"]:
        key = safe["api_key"]
        safe["api_key"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
    if "ai_providers" in safe:
        providers = {}
        for name, pcfg in safe["ai_providers"].items():
            pcfg_copy = pcfg.copy() if isinstance(pcfg, dict) else pcfg
            if isinstance(pcfg_copy, dict) and "api_key" in pcfg_copy and pcfg_copy["api_key"]:
                key = pcfg_copy["api_key"]
                pcfg_copy["api_key"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
            providers[name] = pcfg_copy
        safe["ai_providers"] = providers
    return safe


# ════════════════════════════════════════════════════════════════════
#  SocketIO Events
# ════════════════════════════════════════════════════════════════════

@socketio.on("connect")
def handle_connect():
    emit("connected", {"version": __version__})


@socketio.on("disconnect")
def handle_disconnect():
    pass


# ════════════════════════════════════════════════════════════════════
#  Main
# ════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"\n  YT Short Clipper Web v{__version__}")
    print(f"  Running on http://localhost:{port}\n")
    socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=True)
