import { StateStore } from '../Kernel/StateStore';
/** Pure in-memory state. Persistence is explicitly handled by SaveManager. */
export class RuntimeDataCenter<Schema extends object = Record<string, unknown>> extends StateStore<Schema> {
    private static instance = new RuntimeDataCenter();
    static get Instance(): RuntimeDataCenter { return this.instance; }
    init(): void {}
    clearSession(): void { this.clear(); }
}
export { StateStore, RuntimeDataCenter as DataCenter };
