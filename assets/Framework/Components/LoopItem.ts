import { _decorator, Component, Label } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('LoopItem')
export class LoopItem extends Component {
    @property(Label) label: Label | null = null;
    updateItem(data: unknown, _index: number): void { if (this.label) this.label.string = String(data ?? ''); }
}
