import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

import AppKit
import Foundation
import webview
from PyObjCTools import AppHelper

from sshgui import HOST, create_app, socketio

# The page's localStorage is keyed by origin, so favorites and starred hosts
# survive a restart only if the port does.
PREFERRED_PORT = 8023
LOG_PATH = Path.home() / "Library" / "Logs" / "SSH GUI.log"
# Apps opened from Finder do not get the PATH set in the shell profile.
EXTRA_PATH = ("/opt/homebrew/bin", "/usr/local/bin")
SERVER_START_SECONDS = 15


def log_to_file():
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    sys.stdout = sys.stderr = open(LOG_PATH, "w", buffering=1)
    logging.getLogger("werkzeug").setLevel(logging.ERROR)


def extend_path():
    entries = os.environ.get("PATH", "").split(os.pathsep)
    os.environ["PATH"] = os.pathsep.join([*entries, *EXTRA_PATH])


def pick_port():
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((HOST, PREFERRED_PORT))
        except OSError:
            sock.bind((HOST, 0))
        return sock.getsockname()[1]


def start_server(port):
    threading.Thread(
        target=socketio.run,
        args=(create_app(port),),
        kwargs={
            "host": HOST,
            "port": port,
            "allow_unsafe_werkzeug": True,
            "log_output": False,
        },
        daemon=True,
    ).start()

    deadline = time.monotonic() + SERVER_START_SECONDS
    while time.monotonic() < deadline:
        try:
            socket.create_connection((HOST, port), timeout=1).close()
            return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f"The server did not start on port {port}")


def add_standard_menu_items():
    """Add the items pywebview leaves out. WebKit needs Undo and Redo in the menu."""
    main_menu = AppKit.NSApp.mainMenu()
    edit_menu = next(
        item.submenu()
        for item in main_menu.itemArray()
        if item.submenu() and item.submenu().itemWithTitle_("Paste")
    )
    edit_menu.insertItemWithTitle_action_keyEquivalent_atIndex_("Undo", "undo:", "z", 0)
    redo = edit_menu.insertItemWithTitle_action_keyEquivalent_atIndex_("Redo", "redo:", "z", 1)
    redo.setKeyEquivalentModifierMask_(
        AppKit.NSEventModifierFlagCommand | AppKit.NSEventModifierFlagShift
    )
    edit_menu.insertItem_atIndex_(AppKit.NSMenuItem.separatorItem(), 2)

    window_menu = AppKit.NSMenu.alloc().initWithTitle_("Window")
    window_menu.addItemWithTitle_action_keyEquivalent_("Close", "performClose:", "w")
    window_menu.addItemWithTitle_action_keyEquivalent_("Minimize", "performMiniaturize:", "m")
    window_menu.addItemWithTitle_action_keyEquivalent_("Zoom", "performZoom:", "")
    window_menu_item = AppKit.NSMenuItem.alloc().init()
    window_menu_item.setSubmenu_(window_menu)
    main_menu.addItem_(window_menu_item)
    AppKit.NSApp.setWindowsMenu_(window_menu)


def guard_unsaved_edits(window):
    """Ask the page before closing so unsaved edits are not lost."""

    def on_closing():
        answer = []

        def ask_page():
            try:
                answer.append(window.evaluate_js("confirmDiscardEdits()"))
            except Exception:
                answer.append(True)

        threading.Thread(target=ask_page, daemon=True).start()

        # This handler runs on the main thread, which evaluate_js also needs.
        run_loop = Foundation.NSRunLoop.currentRunLoop()
        while not answer:
            run_loop.runMode_beforeDate_(
                Foundation.NSDefaultRunLoopMode,
                Foundation.NSDate.dateWithTimeIntervalSinceNow_(0.05),
            )
        return bool(answer[0])

    window.events.closing += on_closing


def main():
    log_to_file()
    extend_path()
    port = pick_port()
    start_server(port)

    webview.settings["ALLOW_DOWNLOADS"] = True
    window = webview.create_window(
        "SSH GUI",
        f"http://{HOST}:{port}",
        width=1400,
        height=900,
        min_size=(900, 600),
        background_color="#0d1117",
        text_select=True,
    )
    guard_unsaved_edits(window)
    window.events.shown += lambda: AppHelper.callAfter(add_standard_menu_items)
    webview.start(private_mode=False)


if __name__ == "__main__":
    main()
