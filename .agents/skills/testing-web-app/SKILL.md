---
name: testing-web-app
description: Test the Cliper 123 web app locally. Use when verifying API endpoints, web UI, or video processing flow.
---

# Testing Cliper 123 Web App

## Prerequisites

- Python 3.10+
- FFmpeg installed and in PATH
- yt-dlp (installed via requirements)

## Setup

1. Install dependencies:
   ```bash
   cd /home/ubuntu/repos/clipper123
   pip install -r requirements_web.txt
   ```

2. Set up cookies (if testing YouTube download):
   - Copy the user's `cookies.txt` to the repo root AND to `~/.yt-short-clipper/cookies.txt`
   - The app checks `APP_DIR / "cookies.txt"` — in dev mode, `APP_DIR` is the repo root
   - Note: YouTube cookies may expire or get flagged — if download fails with auth errors, the cookies need to be refreshed

3. Start the web server:
   ```bash
   PORT=7860 python web_app.py
   ```
   Server runs at `http://localhost:7860`

## Key API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/jobs` | GET | List all jobs with status |
| `/api/job/<job_id>` | GET | Get specific job status |
| `/api/publish/queue` | GET/POST/DELETE | Manage publish queue |
| `/api/storage/status` | GET | Storage and disk usage info |
| `/api/config` | GET/POST | App configuration |
| `/api/sessions` | GET | List output sessions |
| `/api/lib/status` | GET | Check FFmpeg, yt-dlp, Deno availability |
| `/api/cookies/status` | GET | Check cookies file status |
| `/api/process/start` | POST | Start highlight finding |
| `/api/clip/start` | POST | Start clipping selected highlights |

## Testing Tips

- API endpoints return JSON — navigate directly in browser to see responses
- For POST/DELETE endpoints, use browser console `fetch()` calls
- The publish queue is in-memory only — resets on server restart
- To test `/api/jobs` with real data, start a processing job from the UI (paste YouTube URL + click "Cari Highlight")
- Jobs that fail (e.g., due to auth) still appear in `/api/jobs` with `status: "error"` — this is correct behavior
- The app uses Socket.IO for real-time progress updates during processing

## Devin Secrets Needed

- No secrets required for basic API endpoint testing
- For full video processing flow: an AI API key (OpenAI/Groq/Gemini) must be configured in Settings
