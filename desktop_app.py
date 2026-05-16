"""
YT Short Clipper - Desktop Launcher
Runs the Flask web app locally and opens the browser automatically.
"""

import os
import sys
import socket
import threading
import webbrowser
import time


def get_free_port(default=5000):
    """Find a free port, starting from the default."""
    for port in range(default, default + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    return default


def open_browser(port, retries=10, delay=0.5):
    """Wait for the server to start, then open the browser."""
    for _ in range(retries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                s.connect(("127.0.0.1", port))
                break
        except (ConnectionRefusedError, OSError):
            time.sleep(delay)
    webbrowser.open(f"http://localhost:{port}")


def main():
    port = get_free_port()
    os.environ["PORT"] = str(port)

    # Import after setting env so web_app picks up the port
    from web_app import app, socketio
    from version import __version__

    print(f"\n  YT Short Clipper Desktop v{__version__}")
    print(f"  Starting on http://localhost:{port}")
    print(f"  Press Ctrl+C to quit\n")

    # Open browser in a background thread once server is ready
    threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    socketio.run(
        app,
        host="127.0.0.1",
        port=port,
        debug=False,
        allow_unsafe_werkzeug=True,
        use_reloader=False,
    )


if __name__ == "__main__":
    main()
