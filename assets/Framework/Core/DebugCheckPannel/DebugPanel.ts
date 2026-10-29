import { _decorator, Component, Label } from 'cc';
import { PerformanceMonitor } from './PerformanceMonitor';
const { ccclass, property } = _decorator;
@ccclass('DebugPanel')
export class DebugPanel extends Component {
    @property(Label) fpsLabel: Label | null = null;
    @property(Label) nodeLabel: Label | null = null;
    @property(Label) memLabel: Label | null = null;
    private elapsed = 0;
    protected update(dt: number): void {
        const monitor = PerformanceMonitor.Instance; monitor.update(dt);
        this.elapsed += dt; if (this.elapsed < 0.5) return; this.elapsed = 0;
        if (this.fpsLabel) this.fpsLabel.string = 'FPS: ' + monitor.getFPS().toFixed(1);
        if (this.nodeLabel) this.nodeLabel.string = 'Nodes: ' + monitor.getNode();
        if (this.memLabel) this.memLabel.string = JSON.stringify({ resources: monitor.getResInfo(), pools: monitor.getPoolInfo() });
    }
}
