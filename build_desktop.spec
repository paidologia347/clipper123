# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for YT Short Clipper Desktop (Native Window)
# Packages the Flask web app with pywebview as a native desktop application.
# No browser required — the app runs in its own window.

import os
import shutil
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect package data
opencv_data = collect_data_files('cv2')
flask_data = collect_data_files('flask')
engineio_data = collect_data_files('engineio')
socketio_data = collect_data_files('socketio')

# Collect google-genai data (for Gemini TTS)
try:
    google_genai_data = collect_data_files('google.genai')
except Exception:
    google_genai_data = []

# Collect edge-tts data
try:
    edge_tts_data = collect_data_files('edge_tts')
except Exception:
    edge_tts_data = []

icon_path = 'assets/icon.ico' if os.path.exists('assets/icon.ico') else None

# Auto-detect yt-dlp and Deno executable paths
_binaries = []
_ytdlp_path = shutil.which('yt-dlp')
if _ytdlp_path:
    _binaries.append((_ytdlp_path, '.'))
_deno_path = shutil.which('deno')
if _deno_path:
    _binaries.append((_deno_path, 'bin'))
elif os.path.exists('deno.exe'):
    _binaries.append(('deno.exe', 'bin'))

a = Analysis(
    ['desktop_app.py'],
    pathex=[],
    binaries=_binaries,
    datas=[
        *opencv_data,
        *flask_data,
        *engineio_data,
        *socketio_data,
        *google_genai_data,
        *edge_tts_data,
        ('templates', 'templates'),
        ('static', 'static'),
        ('assets', 'assets'),
        ('clipper_core.py', '.'),
        ('web_app.py', '.'),
        ('version.py', '.'),
        ('youtube_uploader.py', '.'),
        ('tiktok_uploader.py', '.'),
        ('config', 'config'),
        ('utils', 'utils'),
    ],
    hiddenimports=[
        'flask',
        'flask_socketio',
        'engineio.async_drivers.threading',
        'webview',
        'openai',
        'cv2',
        'numpy',
        'PIL',
        'requests',
        'yt_dlp',
        'config.config_manager',
        'config.ai_provider_config',
        'utils.helpers',
        'utils.logger',
        'utils.dependency_manager',
        # Gemini TTS (native SDK)
        'google.genai',
        'google.genai.types',
        # Edge TTS (free, no API key)
        'edge_tts',
        'asyncio',
        # Google generativeai (legacy)
        'google.generativeai',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'scipy',
        'pandas',
        'torch',
        'tensorflow',
        'whisper',
        'customtkinter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='YTShortClipperDesktop',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window — native app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path,
)
