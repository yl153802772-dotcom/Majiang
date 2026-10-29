import { _decorator, Graphics } from 'cc';
import { UIBase } from '../../../Framework/Components/UIBase';
import { PauseController } from '../../../Framework/Kernel/PauseController';
import { TableProjector } from '../TableProjector';
import { createLabelNode, createTextButton, drawPanel, hexColor } from './HudView';

const { ccclass } = _decorator;
export interface SkyWhiteModalData {
    readonly pauses: PauseController;
    readonly kind: 'menu' | 'help';
    readonly restart: () => void;
}

/** 中文注释：模态与资源由通用UIManager持有，展示期只拥有本窗口暂停租约。 */
@ccclass('SkyWhiteModal')
export class SkyWhiteModal extends UIBase {
    private data: SkyWhiteModalData | null = null;
    onInit(): void {
        const projector = new TableProjector();
        const panel = this.node.addComponent(Graphics);
        drawPanel(panel, 600, 470, '#F1F8FF', '#84B9E5', 24);
        const title = createLabelNode(this.node, 'ModalTitle', '', 32, hexColor('#1D416A'), 540, 60);
        title.node.setPosition(0, 165, 0);
        const rules = createLabelNode(this.node, 'ModalText', '', 24, hexColor('#1D416A'), 550, 230);
        rules.enableWrapText = true;
        rules.node.setPosition(0, 20, 0);
        const render = (): void => {
            title.string = this.data?.kind === 'help' ? '玩法帮助' : '游戏暂停';
            rules.string = this.data?.kind === 'help'
                ? '单块与双块凑成吃、碰或杠。\n四副听牌，相同双块或两单块作将。\n胡牌触发大招，底槽稳定满七格失败。\n清空桌面与底槽即可通关。'
                : '关闭窗口继续游戏\n后台恢复不会解除其他暂停原因';
        };
        this.renderContent = render;
        createTextButton(this.node, projector, 'ModalClose', '继续 / 关闭', 250, 800, 190, 52, () => this.close());
        createTextButton(this.node, projector, 'ModalRestart', '重开', 485, 800, 150, 52, () => {
            const restart = this.data?.restart;
            this.close();
            restart?.();
        });
    }
    private renderContent: () => void = () => {};
    onShow(data?: unknown): void {
        const value = data as SkyWhiteModalData | undefined;
        if (!value || !(value.pauses instanceof PauseController) || typeof value.restart !== 'function')
            throw new Error('SkyWhiteModal requires typed game bindings');
        this.data = value;
        this.showScope.add(value.pauses.hold(value.kind));
        this.showScope.add(() => { this.data = null; });
        this.renderContent();
    }
}
