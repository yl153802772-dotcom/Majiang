import { UIManager } from '../Core/UIManager';
export class UINavigation {
    private static instance = new UINavigation();
    static get Instance(): UINavigation { return this.instance; }
    private pages: Array<{ name: string; data?: unknown }> = [];
    private busy = false;
    get current(): string | undefined { return this.pages[this.pages.length - 1]?.name; }
    async openPage(name: string, data?: unknown): Promise<void> {
        if (this.busy) throw new Error('Navigation busy');
        this.busy = true;
        const previous = this.current;
        try {
            await UIManager.Instance.openUI(name, undefined, undefined, data);
            if (previous && previous !== name) UIManager.Instance.closeUI(previous);
            if (previous !== name) this.pages.push({ name, data });
        } finally { this.busy = false; }
    }
    async back(): Promise<void> {
        if (this.pages.length < 2 || this.busy) return;
        this.busy = true;
        const target = this.pages[this.pages.length - 2], current = this.current!;
        try {
            await UIManager.Instance.openUI(target.name, undefined, undefined, target.data);
            UIManager.Instance.closeUI(current); this.pages.pop();
        } finally { this.busy = false; }
    }
    clear(): void { this.pages = []; }
}
