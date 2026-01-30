import { Component, ComponentChildren } from "preact";
import 'bootstrap/scss/bootstrap.scss';
interface ModalProps {
    children: ComponentChildren;
    buttons?: ComponentChildren;
    title: string;
    dismissHandler?: (hideModal?: () => void) => void;
}
export declare class MyModal extends Component<ModalProps, {}> {
    ref: import("preact").RefObject<HTMLDivElement>;
    constructor();
    componentDidMount(): void;
    componentWillUnmount(): void;
    hide(): void;
    render(): import("preact").JSX.Element;
}
interface ButtonProps {
    priority: "primary" | "secondary" | "danger";
    clickHandler?: () => void;
    children: ComponentChildren;
    disabled?: boolean;
}
export declare function Button(props: ButtonProps): import("preact").JSX.Element;
export {};
