import { ConnectionFactory } from "./websocket";
import { Terminal, WebTTY, protocols } from "./webtty";
import { GoTTYXterm } from "./xterm";
import { FileManager } from "./FileManager";
import { h, render } from "preact";

// Type-safe access to server-injected global variables
interface GoTTYWindow extends Window {
    gotty_auth_token?: string;
    gotty_term?: string;
    gotty_ws_query_args?: string;
}

const gottyWindow = window as GoTTYWindow;

const elem = document.getElementById("terminal")

if (elem !== null) {
    var term: Terminal;
    term = new GoTTYXterm(elem);

    const httpsEnabled = window.location.protocol == "https:";
    const queryArgs = (gottyWindow.gotty_ws_query_args || "") === "" ? "" : "?" + (gottyWindow.gotty_ws_query_args || "");
    const url = (httpsEnabled ? 'wss://' : 'ws://') + window.location.host + window.location.pathname + 'ws' + queryArgs;
    const args = window.location.search;
    const factory = new ConnectionFactory(url, protocols);
    const wt = new WebTTY(term, factory, args, gottyWindow.gotty_auth_token || "");
    const closer = wt.open();

    // Cleanup on page visibility change or navigation
    // Using 'pagehide' instead of deprecated 'unload' event
    window.addEventListener("pagehide", () => {
        closer();
        term.close();
    });
};

// File Manager Integration
const fileManagerBtn = document.getElementById("file-manager-btn") as HTMLElement | null;
if (fileManagerBtn) {
    let fileManagerContainer: HTMLDivElement | null = null;

    // Draggable functionality
    let isDragging = false;
    let dragStarted = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    const onPointerDown = (e: PointerEvent) => {
        if ((e.target as HTMLElement).closest('.file-manager-btn')) {
            isDragging = true;
            dragStarted = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = fileManagerBtn.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            fileManagerBtn.setPointerCapture(e.pointerId);
        }
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // Consider it a drag if moved more than 5px
        if (!dragStarted && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
            dragStarted = true;
            fileManagerBtn.classList.add('dragging');
        }

        if (dragStarted) {
            const newX = initialX + deltaX;
            const newY = initialY + deltaY;

            // Keep button within viewport bounds
            const maxX = window.innerWidth - fileManagerBtn.offsetWidth;
            const maxY = window.innerHeight - fileManagerBtn.offsetHeight;

            const clampedX = Math.max(0, Math.min(newX, maxX));
            const clampedY = Math.max(0, Math.min(newY, maxY));

            fileManagerBtn.style.left = clampedX + 'px';
            fileManagerBtn.style.top = clampedY + 'px';
            fileManagerBtn.style.right = 'auto';
            fileManagerBtn.style.bottom = 'auto';
        }
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!isDragging) return;

        fileManagerBtn.classList.remove('dragging');

        // Snap to edge if close enough
        if (dragStarted) {
            const rect = fileManagerBtn.getBoundingClientRect();
            const threshold = 60; // pixels from edge to trigger snap

            fileManagerBtn.classList.remove('snapped-left', 'snapped-right', 'snapped-top', 'snapped-bottom');

            // Find closest edge
            const distToLeft = rect.left;
            const distToRight = window.innerWidth - rect.right;
            const distToTop = rect.top;
            const distToBottom = window.innerHeight - rect.bottom;

            const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

            if (minDist < threshold) {
                if (minDist === distToLeft) {
                    // Snap to left
                    fileManagerBtn.style.left = '0px';
                    fileManagerBtn.style.top = rect.top + 'px';
                    fileManagerBtn.classList.add('snapped-left');
                } else if (minDist === distToRight) {
                    // Snap to right
                    fileManagerBtn.style.left = (window.innerWidth - 32) + 'px';
                    fileManagerBtn.style.top = rect.top + 'px';
                    fileManagerBtn.classList.add('snapped-right');
                } else if (minDist === distToTop) {
                    // Snap to top
                    fileManagerBtn.style.left = rect.left + 'px';
                    fileManagerBtn.style.top = '0px';
                    fileManagerBtn.classList.add('snapped-top');
                } else {
                    // Snap to bottom
                    fileManagerBtn.style.left = rect.left + 'px';
                    fileManagerBtn.style.top = (window.innerHeight - 32) + 'px';
                    fileManagerBtn.classList.add('snapped-bottom');
                }
            }
        } else {
            // It was a click, not a drag
            if (fileManagerContainer) {
                // Already open, close it
                if (fileManagerContainer.parentNode) {
                    render(null, fileManagerContainer);
                    document.body.removeChild(fileManagerContainer);
                }
                fileManagerContainer = null;
            } else {
                // Open file manager
                fileManagerContainer = document.createElement("div");
                fileManagerContainer.id = "file-manager-container";
                document.body.appendChild(fileManagerContainer);

                const closeFileManager = () => {
                    if (fileManagerContainer && fileManagerContainer.parentNode) {
                        render(null, fileManagerContainer);
                        document.body.removeChild(fileManagerContainer);
                    }
                    fileManagerContainer = null;
                };

                render(
                    h(FileManager, { onClose: closeFileManager }),
                    fileManagerContainer
                );
            }
        }

        isDragging = false;
        dragStarted = false;
    };

    fileManagerBtn.addEventListener('pointerdown', onPointerDown);
    fileManagerBtn.addEventListener('pointermove', onPointerMove);
    fileManagerBtn.addEventListener('pointerup', onPointerUp);
    fileManagerBtn.addEventListener('pointercancel', onPointerUp);
}
