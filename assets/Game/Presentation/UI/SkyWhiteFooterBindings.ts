import { _decorator, Button, Component, Label, Node } from 'cc';
const { ccclass, property } = _decorator;

/** 中文注释：所有引用保存在真实预制体；只保存视图字段，不加载图片或创建场景。 */
@ccclass('SkyWhiteFooterBindings')
export class SkyWhiteFooterBindings extends Component {
    @property(Label) meldCount: Label | null = null;
    @property(Label) bufferCount: Label | null = null;
    @property([Node]) meldSlots: Node[] = [];
    @property([Node]) bufferBlocks: Node[] = [];
    @property([Label]) firstCards: Label[] = [];
    @property([Label]) secondCards: Label[] = [];
    @property(Button) addButton: Button | null = null;
}
