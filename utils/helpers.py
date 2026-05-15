"""
Helper utility functions for YT Short Clipper
"""

import sys
import re
import shutil
from pathlib import Path


def get_app_dir():
    """Get application data directory
    
    On macOS (.app bundle): ~/Library/Application Support/YTShortClipper/
    On Windows/Linux or dev mode: directory containing the executable/script
    
    This ensures user data (config, downloads, output) persists across app updates on macOS.
    """
    if getattr(sys, 'frozen', False):
        if sys.platform == "darwin":
            # macOS: use Application Support (survives .app replacement)
            app_support = Path.home() / "Library" / "Application Support" / "YTShortClipper"
            app_support.mkdir(parents=True, exist_ok=True)
            return app_support
        return Path(sys.executable).parent
    return Path(__file__).parent.parent


def get_bundle_dir():
    """Get bundled resources directory"""
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else get_app_dir()
    return get_app_dir()


def get_ffmpeg_path():
    """Get FFmpeg executable path
    
    Checks in order:
    1. Bundled ffmpeg in app_dir/ffmpeg/ folder (downloaded via Library page)
    2. ffmpeg in system PATH
    3. Default "ffmpeg" command
    """
    app_dir = get_app_dir()
    
    # Check bundled ffmpeg (works for both frozen and development)
    if sys.platform.startswith('win'):
        bundled = app_dir / "ffmpeg" / "ffmpeg.exe"
    else:
        bundled = app_dir / "ffmpeg" / "ffmpeg"
    
    if bundled.exists():
        return str(bundled)
    
    # Try to find ffmpeg in PATH
    ffmpeg_in_path = shutil.which("ffmpeg")
    if ffmpeg_in_path:
        return ffmpeg_in_path
    
    # Fallback to command name
    return "ffmpeg"


def get_ytdlp_path():
    """Get yt-dlp executable path or check if module is available
    
    Checks in order:
    1. yt-dlp Python module (preferred - bundled with PyInstaller)
    2. Bundled yt-dlp.exe (Windows)
    3. yt-dlp in system PATH
    4. Default "yt-dlp" command
    
    Returns:
        str: Path to yt-dlp executable, or "yt_dlp_module" if using Python module
    """
    # First check if yt-dlp is available as Python module
    try:
        import yt_dlp
        return "yt_dlp_module"  # Special marker to use module instead of subprocess
    except ImportError:
        pass
    
    if getattr(sys, 'frozen', False):
        bundled = get_app_dir() / "yt-dlp.exe"
        if bundled.exists():
            return str(bundled)
    
    # Try to find yt-dlp in PATH
    yt_dlp_path = shutil.which("yt-dlp")
    if yt_dlp_path:
        return yt_dlp_path
    
    # Fallback to command name (will work if it's in system PATH)
    return "yt-dlp"


def is_ytdlp_module_available():
    """Check if yt-dlp Python module is available"""
    try:
        import yt_dlp
        return True
    except ImportError:
        return False


def get_deno_path():
    """Get Deno executable path (required for yt-dlp --remote-components)
    
    Checks in order:
    1. Bundled deno in app_dir/bin/ folder (downloaded via Library page)
    2. deno in system PATH
    3. None if not found
    """
    app_dir = get_app_dir()
    
    # Check bundled deno (works for both frozen and development)
    if sys.platform.startswith('win'):
        bundled = app_dir / "bin" / "deno.exe"
    else:
        bundled = app_dir / "bin" / "deno"
    
    if bundled.exists():
        return str(bundled)
    
    # Try to find deno in PATH
    deno_path = shutil.which("deno")
    if deno_path:
        return deno_path
    
    # Not found
    return None


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from URL
    
    Validates that the URL is from a known YouTube domain and extracts
    the 11-character video ID. Returns None for non-YouTube URLs.
    """
    if not url:
        return None
    
    url = url.strip()
    
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
    except Exception:
        return None
    
    # Validate YouTube domain
    host = (parsed.hostname or "").lower()
    yt_hosts = {"youtube.com", "www.youtube.com", "m.youtube.com", 
                "music.youtube.com", "youtu.be"}
    
    if host not in yt_hosts:
        return None
    
    video_id = None
    
    # youtu.be/<id>
    if host == "youtu.be":
        path_part = parsed.path.lstrip("/").split("/")[0] if parsed.path else ""
        if re.match(r'^[0-9A-Za-z_-]{11}$', path_part):
            video_id = path_part
    else:
        # /watch?v=<id>
        if parsed.path in ("/watch", "/watch/"):
            params = parse_qs(parsed.query)
            v = params.get("v", [None])[0]
            if v and re.match(r'^[0-9A-Za-z_-]{11}$', v):
                video_id = v
        else:
            # /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
                if re.match(r'^[0-9A-Za-z_-]{11}$', parts[1]):
                    video_id = parts[1]
    
    return video_id
