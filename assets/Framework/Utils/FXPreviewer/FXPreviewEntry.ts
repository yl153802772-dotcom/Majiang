import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;
@ccclass('FXPreviewEntry')
export class FXPreviewEntry extends Component {
    private open?: () => void;
    configure(open: () => void): void { this.open = open; }
    show(): void { this.open?.(); }
    protected onDestroy(): void { this.open = undefined; }
}
