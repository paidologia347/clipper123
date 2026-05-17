"""
YouTube Authentication Helper
Handles automatic cookie extraction from user's browser for yt-dlp.
Eliminates the need for manual cookies.txt upload.
"""

import os
import sys
import json
import platform
import subprocess
import shutil
from pathlib import Path
from typing import Optional


# Supported browsers in priority order
SUPPORTED_BROWSERS = ["chrome", "chromium", "edge", "firefox", "opera", "brave", "vivaldi"]


def get_available_browsers() -> list:
    """Detect which browsers are available on the system."""
    available = []
    system = platform.system()

    browser_checks = {
        "chrome": {
            "Windows": [
                os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data"),
                os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
            ],
            "Linux": [
                os.path.expanduser("~/.config/google-chrome"),
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/Google/Chrome"),
            ],
        },
        "edge": {
            "Windows": [
                os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data"),
            ],
            "Linux": [
                os.path.expanduser("~/.config/microsoft-edge"),
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/Microsoft Edge"),
            ],
        },
        "firefox": {
            "Windows": [
                os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles"),
            ],
            "Linux": [
                os.path.expanduser("~/.mozilla/firefox"),
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/Firefox/Profiles"),
            ],
        },
        "brave": {
            "Windows": [
                os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data"),
            ],
            "Linux": [
                os.path.expanduser("~/.config/BraveSoftware/Brave-Browser"),
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/BraveSoftware/Brave-Browser"),
            ],
        },
        "chromium": {
            "Windows": [
                os.path.expandvars(r"%LOCALAPPDATA%\Chromium\User Data"),
            ],
            "Linux": [
                os.path.expanduser("~/.config/chromium"),
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/Chromium"),
            ],
        },
        "opera": {
            "Windows": [
                os.path.expandvars(r"%APPDATA%\Opera Software\Opera Stable"),
            ],
            "Linux": [
                os.path.expanduser("~/.config/opera"),
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/com.operasoftware.Opera"),
            ],
        },
        "vivaldi": {
            "Windows": [
                os.path.expandvars(r"%LOCALAPPDATA%\Vivaldi\User Data"),
            ],
            "Linux": [
                os.path.expanduser("~/.config/vivaldi"),
            ],
            "Darwin": [
                os.path.expanduser("~/Library/Application Support/Vivaldi"),
            ],
        },
    }

    for browser, os_paths in browser_checks.items():
        paths = os_paths.get(system, [])
        for p in paths:
            if os.path.exists(p):
                available.append(browser)
                break

    return available


def extract_cookies_from_browser(browser: str, cookies_output_path: str,
                                  domain: str = ".youtube.com") -> dict:
    """
    Extract YouTube cookies from the specified browser using yt-dlp.

    Args:
        browser: Browser name (chrome, firefox, edge, etc.)
        cookies_output_path: Path to save the cookies.txt file
        domain: Cookie domain to filter (default: .youtube.com)

    Returns:
        dict with status, message, and count of cookies extracted
    """
    if browser not in SUPPORTED_BROWSERS:
        return {
            "status": "error",
            "message": f"Browser '{browser}' tidak didukung. "
                       f"Browser yang didukung: {', '.join(SUPPORTED_BROWSERS)}"
        }

    try:
        import yt_dlp

        # Use yt-dlp to extract cookies from browser
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "cookiesfrombrowser": (browser,),
            "cookiefile": cookies_output_path,
        }

        # Try to extract by fetching a YouTube page
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Just extract info (no download) — this triggers cookie export
            ydl.extract_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                           download=False)

        # Verify the cookies file was created
        if os.path.exists(cookies_output_path):
            with open(cookies_output_path, "r", errors="ignore") as f:
                lines = f.readlines()
            cookie_lines = [l for l in lines if l.strip() and not l.startswith("#")]
            count = len(cookie_lines)

            if count > 0:
                return {
                    "status": "ok",
                    "message": f"Berhasil extract {count} cookies dari {browser}",
                    "count": count,
                    "browser": browser,
                }
            else:
                return {
                    "status": "warning",
                    "message": f"Cookies file dibuat tapi kosong. "
                               f"Pastikan kamu sudah login YouTube di {browser}.",
                    "count": 0,
                    "browser": browser,
                }
        else:
            return {
                "status": "error",
                "message": f"Gagal membuat cookies file dari {browser}.",
            }

    except Exception as e:
        error_msg = str(e)

        # Friendly error messages
        if "could not find" in error_msg.lower() or "not found" in error_msg.lower():
            return {
                "status": "error",
                "message": f"Browser {browser} tidak ditemukan atau tidak bisa diakses. "
                           f"Pastikan {browser} terinstall.",
            }
        elif "permission" in error_msg.lower() or "access" in error_msg.lower():
            return {
                "status": "error",
                "message": f"Tidak bisa mengakses cookies {browser}. "
                           f"Pastikan {browser} sudah ditutup dan coba lagi.",
            }
        elif "decrypt" in error_msg.lower():
            return {
                "status": "error",
                "message": f"Tidak bisa decrypt cookies {browser}. "
                           f"Di Linux, pastikan 'secretstorage' atau 'keyring' terinstall.",
            }
        else:
            return {
                "status": "error",
                "message": f"Error extract cookies dari {browser}: {error_msg}",
            }


def auto_extract_best_browser(cookies_output_path: str) -> dict:
    """
    Automatically detect and extract cookies from the best available browser.

    Returns:
        dict with status, message, browser used, and cookie count
    """
    available = get_available_browsers()

    if not available:
        return {
            "status": "error",
            "message": "Tidak ada browser yang terdeteksi. "
                       "Install Chrome, Edge, atau Firefox terlebih dahulu.",
            "available_browsers": [],
        }

    # Try each available browser in order
    errors = []
    for browser in available:
        result = extract_cookies_from_browser(browser, cookies_output_path)
        if result["status"] == "ok":
            return result
        errors.append(f"{browser}: {result['message']}")

    return {
        "status": "error",
        "message": "Gagal extract cookies dari semua browser yang tersedia. "
                   "Pastikan kamu sudah login YouTube di salah satu browser.\n"
                   + "\n".join(errors),
        "available_browsers": available,
    }


def verify_youtube_cookies(cookies_path: str) -> dict:
    """
    Verify if the cookies.txt file contains valid YouTube authentication cookies.

    Returns:
        dict with status and details about the cookies
    """
    if not os.path.exists(cookies_path):
        return {"valid": False, "message": "File cookies.txt tidak ditemukan"}

    try:
        with open(cookies_path, "r", errors="ignore") as f:
            content = f.read()

        lines = content.strip().split("\n")
        cookie_lines = [l for l in lines if l.strip() and not l.startswith("#")]

        # Check for essential YouTube cookies
        essential_cookies = ["SID", "HSID", "SSID", "APISID", "SAPISID"]
        found_cookies = set()

        for line in cookie_lines:
            parts = line.split("\t")
            if len(parts) >= 7:
                cookie_name = parts[5]
                if cookie_name in essential_cookies:
                    found_cookies.add(cookie_name)

        has_essential = len(found_cookies) >= 3  # At least 3 of 5 essential cookies

        return {
            "valid": has_essential,
            "total_cookies": len(cookie_lines),
            "essential_found": list(found_cookies),
            "essential_missing": [c for c in essential_cookies if c not in found_cookies],
            "message": (
                f"Cookies valid ({len(cookie_lines)} entri, "
                f"{len(found_cookies)}/{len(essential_cookies)} cookies penting)"
                if has_essential
                else f"Cookies tidak lengkap — kurang cookies penting: "
                     f"{', '.join(c for c in essential_cookies if c not in found_cookies)}"
            ),
        }
    except Exception as e:
        return {"valid": False, "message": f"Error membaca cookies: {str(e)}"}
