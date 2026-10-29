import { _decorator, Component } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('SecretTrigger')
export class SecretTrigger extends Component {
    @property public diagnosticsEnabled = false;
    private action?: () => void;
    configure(action: () => void): void { this.action = action; }
    trigger(): void { if (this.diagnosticsEnabled) this.action?.(); }
    protected onDestroy(): void { this.action = undefined; }
}
