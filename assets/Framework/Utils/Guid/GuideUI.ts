import { _decorator, Label } from 'cc';
import { UIBase } from '../../Components/UIBase';
const { ccclass, property } = _decorator;
@ccclass('GuideUI')
export class GuideUI extends UIBase {
    @property(Label) message: Label | null = null;
    override onShow(data?: unknown): void {
        if (this.message) this.message.string = typeof data === 'string' ? data : '';
    }
}
