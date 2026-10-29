import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;
/** Optional project-injected effect preview. No production shortcut is registered. */
@ccclass('FXDebugPanel')
export class FXDebugPanel extends Component {
    private preview?: () => void;
    configure(preview: () => void): void { this.preview = preview; }
    play(): void { this.preview?.(); }
    protected onDestroy(): void { this.preview = undefined; }
}
