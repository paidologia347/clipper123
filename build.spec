# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec file for YT Short Clipper Desktop App

import os
import sys
import shutil
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect OpenCV data (haar cascades)
opencv_data = collect_data_files('cv2')

# Icon path
icon_path = 'assets/icon.ico' if os.path.exists('assets/icon.ico') else None

# Auto-detect yt-dlp executable path
_ytdlp_path = shutil.which('yt-dlp')
_binaries = []
if _ytdlp_path:
    _binaries.append((_ytdlp_path, '.'))

# Bundle Deno if available (required by yt-dlp for JS runtime)
_deno_path = shutil.which('deno')
if _deno_path:
    _binaries.append((_deno_path, 'bin'))
elif os.path.exists('deno.exe'):
    _binaries.append(('deno.exe', 'bin'))

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=_binaries,
    datas=[
        *opencv_data,
        ('assets', 'assets'),  # Bundle assets folder
        ('clipper_core.py', '.'),  # Bundle core module
        ('youtube_uploader.py', '.'),  # Bundle YouTube module
    ],
    hiddenimports=[
        'customtkinter',
        'openai',
        'cv2',
        'numpy',
        'PIL',
        'PIL._tkinter_finder',
        'google.oauth2.credentials',
        'google_auth_oauthlib.flow',
        'googleapiclient.discovery',
        'googleapiclient.http',
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
        'whisper',  # We use API now, not local
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
    name='YTShortClipper',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path,
)
