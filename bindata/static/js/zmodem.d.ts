import { Component } from "preact";
import { ITerminalAddon, Terminal } from "@xterm/xterm";
import { Offer, Sentry, Session } from "zmodem.js";
export declare class ZModemAddon implements ITerminalAddon {
    term: Terminal;
    elem: HTMLDivElement;
    sentry: Sentry;
    toTerminal: (data: Uint8Array) => void;
    toServer: (data: Uint8Array) => void;
    constructor(props: {
        toTerminal: (data: Uint8Array) => void;
        toServer: (data: Uint8Array) => void;
    });
    private createElement;
    consume(data: Uint8Array): void;
    activate(terminal: Terminal): void;
    dispose(): void;
    private init;
    private reset;
    private onDetect;
    private send;
    private onOffer;
}
interface ReceiveFileModalProps {
    xfer: Offer;
    onFinish?: () => void;
}
interface ReceiveFileModalState {
    state: "notstarted" | "started" | "skipped" | "done";
}
export declare class ReceiveFileModal extends Component<ReceiveFileModalProps, ReceiveFileModalState> {
    constructor(props: any);
    accept(): void;
    finish(): void;
    progress(): import("preact").JSX.Element | undefined;
    skip(): void;
    buttons(): import("preact").JSX.Element | undefined;
    render(): import("preact").JSX.Element | undefined;
}
export declare class SendFileModal extends Component<SendFileModalProps, SendFileModalState> {
    filePickerRef: import("preact").RefObject<HTMLInputElement>;
    constructor(props: SendFileModalProps);
    buttons(): import("preact").JSX.Element | undefined;
    send(): void;
    render(): import("preact").JSX.Element | undefined;
}
interface SendFileModalProps {
    onFinish?: () => void;
    session: Session;
}
interface SendFileModalState {
    state: "notstarted" | "started" | "done";
    currentFile: any;
}
export {};
