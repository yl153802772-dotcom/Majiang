import { _decorator, Component, Label, Node, UIOpacity } from 'cc';
import { EventCenter } from '../Data/EventCenter';
import { FrameworkEvent } from '../Core/GameConst';
import { RedDotManager } from '../Core/RedDotManager';
const { ccclass, property } = _decorator;
@ccclass('RedDotNode')
export class RedDotNode extends Component {
    @property dotPath = '';
    @property(Label) countLabel: Label | null = null;
    @property(Node) indicator: Node | null = null;
    private cancel?: () => void;
    protected onEnable(): void {
        this.cancel = EventCenter.on(FrameworkEvent.RED_DOT_UPDATE, value => { if (value.path === this.dotPath) this.refresh(value.value); });
        this.refresh(RedDotManager.Instance.getValue(this.dotPath));
    }
    private refresh(count: number): void {
        if (this.indicator && this.indicator !== this.node) this.indicator.active = count > 0;
        else { const opacity = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity); if (opacity) opacity.opacity = count > 0 ? 255 : 0; }
        if (this.countLabel) this.countLabel.string = count > 99 ? '99+' : String(count);
    }
    protected onDisable(): void { this.cancel?.(); this.cancel = undefined; }
    protected onDestroy(): void { this.cancel?.(); }
}
