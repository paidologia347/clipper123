# -*- mode: python ; coding: utf-8 -*-
import os
import shutil
from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

opencv_data = collect_data_files('cv2')

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
    ['webview_app.py'],
    pathex=[],
    binaries=_binaries,
    datas=[
        *opencv_data,
        ('assets', 'assets'),
        ('web', 'web'),
        ('clipper_core.py', '.'),
        ('youtube_uploader.py', '.'),
        ('config', 'config'),
        ('utils', 'utils'),
        ('pages', 'pages'),
        ('dialogs', 'dialogs'),
        ('components', 'components'),
    ],
    hiddenimports=[
        'webview',
        'openai',
        'cv2',
        'numpy',
        'PIL',
        'requests',
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
    name='YTShortClipperWeb',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path,
)
