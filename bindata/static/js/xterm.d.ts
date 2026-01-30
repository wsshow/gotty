import { IDisposable, Terminal } from "@xterm/xterm";
import { FitAddon } from '@xterm/addon-fit';
import { ZModemAddon } from "./zmodem";
export declare class GoTTYXterm {
    elem: HTMLElement;
    term: Terminal;
    resizeListener: () => void;
    message: HTMLElement;
    messageTimeout: number;
    messageTimer: NodeJS.Timeout;
    onResizeHandler: IDisposable;
    onDataHandler: IDisposable;
    fitAddOn: FitAddon;
    zmodemAddon: ZModemAddon;
    toServer: (data: string | Uint8Array) => void;
    encoder: TextEncoder;
    constructor(elem: HTMLElement);
    info(): {
        columns: number;
        rows: number;
    };
    output(data: Uint8Array): void;
    getMessage(): HTMLElement;
    showMessage(message: string, timeout: number): void;
    showMessageElem(timeout: number): void;
    removeMessage(): void;
    setWindowTitle(title: string): void;
    setPreferences(value: object): void;
    sendInput(data: Uint8Array): void;
    onInput(callback: (input: string) => void): void;
    onResize(callback: (colmuns: number, rows: number) => void): void;
    deactivate(): void;
    reset(): void;
    close(): void;
    disableStdin(): void;
    enableStdin(): void;
    focus(): void;
}
