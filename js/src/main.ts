import { ConnectionFactory } from "./websocket";
import { Terminal, WebTTY, protocols } from "./webtty";
import { GoTTYXterm } from "./xterm";
import { FileManager } from "./FileManager";
import { h, render } from "preact";

// @TODO remove these
declare var gotty_auth_token: string;
declare var gotty_term: string;
declare var gotty_ws_query_args: string;

const elem = document.getElementById("terminal")

if (elem !== null) {
    var term: Terminal;
    term = new GoTTYXterm(elem);

    const httpsEnabled = window.location.protocol == "https:";
    const queryArgs = (gotty_ws_query_args === "") ? "" : "?" + gotty_ws_query_args;
    const url = (httpsEnabled ? 'wss://' : 'ws://') + window.location.host + window.location.pathname + 'ws' + queryArgs;
    const args = window.location.search;
    const factory = new ConnectionFactory(url, protocols);
    const wt = new WebTTY(term, factory, args, gotty_auth_token);
    const closer = wt.open();

    // Cleanup on page visibility change or navigation
    // Using 'pagehide' instead of deprecated 'unload' event
    window.addEventListener("pagehide", () => {
        closer();
        term.close();
    });
};

// File Manager Integration
const fileManagerBtn = document.getElementById("file-manager-btn");
if (fileManagerBtn) {
    let fileManagerContainer: HTMLDivElement | null = null;

    fileManagerBtn.addEventListener("click", () => {
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
    });
}
