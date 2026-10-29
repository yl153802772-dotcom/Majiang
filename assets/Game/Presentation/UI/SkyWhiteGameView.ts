import { Button, Label, Node, UITransform } from 'cc';
import { LifecycleScope } from '../../../Framework/Kernel/LifecycleScope';
import { PauseController } from '../../../Framework/Kernel/PauseController';
import { UIManager, UILayer } from '../../../Framework/Core/UIManager';
import type { GameSnapshot } from '../../Application/GameSnapshot';
import type { BlockID } from '../../Domain/BlockTypes';
import type { TableProjector } from '../TableProjector';
import { cardColor, cardText, createLabelNode, createUiNode, hexColor, placeAtDesign } from './HudView';
import type { SkyWhiteModalData } from './SkyWhiteModal';
import { SkyWhiteFooterBindings } from './SkyWhiteFooterBindings';
import { SkyWhiteMeldSlotBindings } from './SkyWhiteMeldSlotBindings';
// 中文注释：必须加载类注册，Prefab只保存该组件；不创建另一套UI管理器。
import './SkyWhiteModal';

export const SKY_BOARD = { x: 16, y: 156, width: 612, height: 824 } as const;
export const SKY_BUFFER = { firstX: 157.62, step: 79.575, y: 1167.95, width: 73, height: 82 } as const;
export const SKY_MELD = { firstX: 179.43, step: 124.718, y: 1063.89, width: 118, height: 78 } as const;
export function skyBufferTarget(snapshot: GameSnapshot, id: BlockID): { x: number; y: number } {
    const entry = snapshot.buffer.find(block => block.blockId === id);
    return { x: SKY_BUFFER.firstX + ((entry?.startSlot ?? 0) + ((entry?.slotCount ?? 1) - 1) / 2) * SKY_BUFFER.step, y: SKY_BUFFER.y };
}

function child(root: Node, path: string): Node {
    let node = root;
    for (const part of path.split('/')) {
        const next = node.getChildByName(part);
        if (!next) throw new Error('SkyWhite binding missing: ' + path);
        node = next;
    }
    return node;
}
function label(root: Node, path: string): Label {
    const result = child(root, path).getComponent(Label);
    if (!result) throw new Error('SkyWhite Label missing: ' + path);
    return result;
}

/** 中文注释：只绑定Main场景保存的UI字段；不以旧预览为布局依据，不在运行时替代排版。 */
export class SkyWhiteGameView {
    private readonly scope = new LifecycleScope();
    private readonly root: Node;
    private readonly remaining: Label;
    private readonly level: Label;
    private readonly phase: Label;
    private readonly toast: Label;
    private readonly bufferCount: Label;
    private readonly meldCount: Label;
    private readonly blocks: Array<{ node: Node; labels: Label[] }> = [];
    private readonly melds: Array<{ node: Node; labels: Label[]; index: Label }> = [];
    private disposed = false;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(parent: Node, private readonly hud: Node, private readonly projector: TableProjector,
        private readonly pauses: PauseController, private readonly restart: () => void) {
        this.root = createUiNode(parent, 'GameHudMessages', 720, 1280);
        try {
            this.remaining = label(hud, 'TopHud/Remaining_Value');
            this.level = label(hud, 'TopHud/Level_Text');
            // 中文注释：原MVP没有计时/星级规则，保留效果图占位，不伪造运行中的计时或评分。
            label(hud, 'TopHud/Clock_Value').string = '00:00';
            label(hud, 'TopHud/Star_Value').string = '0';
            const native = child(hud, 'FooterExactReference/OriginalImageMapping/FooterExactNative');
            const bindings = native.getComponent(SkyWhiteFooterBindings);
            if (!bindings?.meldCount || !bindings.bufferCount || bindings.meldSlots.length !== 4
                || bindings.bufferBlocks.length !== 7 || bindings.firstCards.length !== 7 || bindings.secondCards.length !== 7)
                throw new Error('Footer prefab bindings incomplete');
            this.meldCount = bindings.meldCount;
            this.bufferCount = bindings.bufferCount;
            if (bindings.addButton) bindings.addButton.interactable = false;
            for (const name of ['magnet', 'remove', 'shuffle', 'flip']) {
                const button = child(hud, 'ToolRail/' + name).getComponent(Button);
                if (button) button.interactable = false;
            }
            for (let i = 0; i < 7; i++) this.blocks.push({ node: bindings.bufferBlocks[i],
                labels: [bindings.firstCards[i], bindings.secondCards[i]] });
            for (const node of bindings.meldSlots) {
                const slot = node.getComponent(SkyWhiteMeldSlotBindings);
                if (!slot?.index || slot.cards.length !== 4) throw new Error('Meld slot prefab bindings incomplete');
                this.melds.push({ node, index: slot.index, labels: slot.cards });
            }
            this.phase = this.text('Phase', '', 315, 966, 20, 600, 30);
            this.toast = this.text('Toast', '', 325, 192, 22, 600, 40);
            this.toast.node.active = false;
            this.bindButton('TopHud/PauseHit', 'menu');
            this.bindButton('TopHud/HelpHit', 'help');
            UIManager.Instance.register('sky-menu', {
                path: 'SkyWhiteV2/Prefabs/GameMenu', bundle: 'game-ui', layer: UILayer.Popup, modal: true, cache: 'keep',
            });
            this.scope.add(() => UIManager.Instance.destroyUI('sky-menu'));
        } catch (error) {
            this.root.destroy();
            throw this.scope.rollback(error);
        }
    }

    private text(name: string, value: string, x: number, y: number, size: number, w: number, h: number): Label {
        const result = createLabelNode(this.root, name, value, size, hexColor('#1D416A'), w, h);
        result.enableWrapText = true;
        placeAtDesign(this.projector, result.node, x, y);
        return result;
    }
    async loadArt(): Promise<void> {
        // 中文注释：皮肤由场景/Prefab序列化引用持有，无运行时切图或另一套底部。
    }
    private bindButton(path: string, kind: 'menu' | 'help'): void {
        const node = child(this.hud, path), button = node.getComponent(Button);
        if (!button) throw new Error('SkyWhite Button missing: ' + path);
        button.interactable = true;
        let opening = false;
        const click = (): void => {
            if (opening || this.disposed) return;
            opening = true;
            const release = this.pauses.hold('modal-loading');
            const data: SkyWhiteModalData = { pauses: this.pauses, kind, restart: this.restart };
            void UIManager.Instance.openUI('sky-menu', undefined, undefined, data)
                .catch(error => { if (!this.disposed) { console.error('[SKY-GAME] modal load failed', error); this.showToast('窗口加载失败，请重试'); } })
                .finally(() => { release(); opening = false; });
        };
        node.on(Button.EventType.CLICK, click);
        this.scope.add(() => { node.off(Button.EventType.CLICK, click); button.interactable = false; });
    }
    render(snapshot: GameSnapshot, _lastTouchMs: number | null): void {
        this.level.string = '第' + snapshot.levelId + '关';
        this.remaining.string = String(snapshot.board.reduce((n, block) => n + block.definition.cards.length, 0));
        this.phase.string = snapshot.phase === 'Tenpai' ? '听牌 · 请选择将牌' : snapshot.stalled ? '暂无可行动作' : '';
        this.meldCount.string = snapshot.melds.length + '/4';
        this.bufferCount.string = snapshot.occupiedSlots + '/7';
    }
    renderBuffer(snapshot: GameSnapshot): void {
        this.blocks.forEach((block, i) => {
            const entry = snapshot.buffer[i]; block.node.active = !!entry;
            if (!entry) return;
            const width = 96 + (entry.slotCount - 1) * 104;
            block.node.getComponent(UITransform)!.setContentSize(width, 110);
            block.node.setPosition(-264.5 + (entry.startSlot + (entry.slotCount - 1) / 2) * 104, -40, 0);
            block.labels.forEach((view, n) => {
                const card = entry.cards[n]; view.node.active = !!card;
                if (!card) return;
                view.string = cardText(card); view.color = cardColor(card);
                view.node.setPosition(entry.slotCount === 1 ? 0 : (n - 0.5) * 104, 0, 0);
            });
        });
    }
    renderMeld(snapshot: GameSnapshot): void {
        this.melds.forEach((panel, i) => {
            const meld = snapshot.melds[i]; panel.index.node.active = !meld;
            const paper = panel.node.getChildByName('IndexPaper');
            if (paper) paper.active = !meld;
            panel.labels.forEach((view, n) => {
                const card = meld?.cards[n]; view.node.active = !!card;
                if (!card || !meld) return;
                const step = meld.cards.length === 4 ? 36 : 42;
                view.string = cardText(card); view.color = cardColor(card);
                view.node.setPosition((n - (meld.cards.length - 1) / 2) * step, 0, 0);
            });
        });
    }
    setMetrics(_last: number | null, _p95: number): void { /* 中文注释：指标保留在采样器，不覆盖已验收HUD。 */ }
    showToast(message: string): void {
        if (this.disposed) return;
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        this.toast.string = message; this.toast.node.active = true;
        this.toastTimer = setTimeout(() => { this.toastTimer = null; if (!this.disposed) this.toast.node.active = false; }, 1200);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        // 先销毁使用资产的节点，再释放scope中的handle与监听。
        if (this.root.isValid !== false) { this.root.active = false; this.root.destroy(); }
        this.scope.dispose();
    }
}
