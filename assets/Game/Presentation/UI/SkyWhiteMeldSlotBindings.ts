import { _decorator, Component, Label } from 'cc';
const { ccclass, property } = _decorator;

/** 中文注释：副槽为可复用组件Prefab，四张牌及空槽编号均可在Inspector编辑。 */
@ccclass('SkyWhiteMeldSlotBindings')
export class SkyWhiteMeldSlotBindings extends Component {
    @property(Label) index: Label | null = null;
    @property([Label]) cards: Label[] = [];
}
