"""
YT Short Clipper - Desktop App (Native Window)
Runs the Flask web app inside a pywebview native window.
No browser required — looks and feels like a native desktop application.
"""

import os
import sys
import socket
import threading
import time

# Fix for PyInstaller windowed mode (console=False)
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')


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


def wait_for_server(port, timeout=15):
    """Block until the Flask server is accepting connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                s.connect(("127.0.0.1", port))
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.3)
    return False


def main():
    port = get_free_port()
    os.environ["PORT"] = str(port)

    from web_app import app, socketio
    from version import __version__

    # Start Flask server in background thread
    server_thread = threading.Thread(
        target=lambda: socketio.run(
            app,
            host="127.0.0.1",
            port=port,
            debug=False,
            allow_unsafe_werkzeug=True,
            use_reloader=False,
        ),
        daemon=True,
    )
    server_thread.start()

    # Wait for server to be ready
    wait_for_server(port)

    # Open native window with pywebview
    import webview
    webview.create_window(
        f"YT Short Clipper v{__version__}",
        f"http://127.0.0.1:{port}",
        width=1200,
        height=800,
        min_size=(900, 600),
    )
    webview.start()


if __name__ == "__main__":
    main()
