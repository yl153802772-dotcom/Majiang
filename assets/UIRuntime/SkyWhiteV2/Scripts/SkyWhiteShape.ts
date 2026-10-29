import { _decorator, Color, Component, Graphics } from 'cc';

const { ccclass, executeInEditMode, property } = _decorator;

/** 本预览 UI 的编号纸片；矢量绘制以便编辑器与运行画面使用相同尺寸。 */
@ccclass('SkyWhiteShape')
@executeInEditMode
export class SkyWhiteShape extends Component {
    @property(Graphics) graphics: Graphics | null = null;
    @property width = 22;
    @property height = 28;
    @property radius = 4;
    @property(Color) fill = new Color(255, 254, 249, 245);

    protected onEnable(): void { this.draw(); }

    private draw(): void {
        const graphics = this.graphics;
        if (!graphics) return;
        graphics.clear();
        graphics.fillColor = this.fill;
        graphics.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, this.radius);
        graphics.fill();
    }
}
