import { _decorator, Color, Component, Graphics, UITransform } from 'cc';
const { ccclass, executeInEditMode, property, requireComponent } = _decorator;

/** 中文注释：Main中可编辑的编号纸片/小装饰，不含玩法、相机或图片合成。 */
@ccclass('MainUiShape')
@executeInEditMode
@requireComponent(Graphics)
export class MainUiShape extends Component {
    @property(Graphics) graphics: Graphics | null = null;
    @property radius = 6;
    @property(Color) fill = new Color(255, 254, 249, 245);

    protected onEnable(): void {
        const graphics = this.graphics;
        const size = this.getComponent(UITransform)?.contentSize;
        if (!graphics || !size) return;
        graphics.clear();
        graphics.fillColor = this.fill;
        graphics.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, this.radius);
        graphics.fill();
    }
}
