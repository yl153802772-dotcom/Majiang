import { _decorator, Component, Button } from 'cc';
const { ccclass, property } = _decorator;
/** Bind gameplay actions through execute(); does not override engine-private touch methods. */
@ccclass('SafeButton')
export class SafeButton extends Component {
    @property public cooldownTime = 0.3;
    private lastClick = -Infinity;
    execute(action: () => void): boolean {
        const button = this.getComponent(Button);
        if (!this.enabledInHierarchy || (button && !button.interactable)) return false;
        const now = Date.now();
        if (now - this.lastClick < this.cooldownTime * 1000) return false;
        this.lastClick = now; action(); return true;
    }
    protected onEnable(): void { this.lastClick = -Infinity; }
}
