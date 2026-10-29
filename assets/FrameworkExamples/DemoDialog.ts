import { _decorator, Color, Graphics } from 'cc';
import { UIBase } from '../Framework/Components/UIBase';
import { PauseController } from '../Framework/Kernel/PauseController';
import { box, button, label } from './DemoUi';
const { ccclass } = _decorator;
@ccclass('FrameworkDemoDialog')
export class DemoDialog extends UIBase {
    onInit(): void {
        const panel = box(this.node, 'Panel', 600, 360), graphics = panel.addComponent(Graphics);
        graphics.fillColor = new Color(21, 34, 48, 255); graphics.roundRect(-300, -180, 600, 360, 16); graphics.fill();
        const text = label(panel, '模态窗口 · 游戏暂停\n后台恢复不会关闭本窗口的暂停', 560, 150, 25); text.node.setPosition(0, 60, 0);
        const close = button(panel, '关闭并释放暂停租约', 360, 640, () => this.close()); close.setPosition(0, -90, 0);
    }
    onShow(data?: unknown): void {
        if (!(data instanceof PauseController)) throw new Error('Demo dialog requires an explicit pause controller');
        this.showScope.add(data.hold('demo-dialog'));
    }
}
