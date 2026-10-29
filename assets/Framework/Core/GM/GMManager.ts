export type GMCommandAction = (args: readonly string[]) => string;
export class GMManager {
    private static instance = new GMManager();
    static get Instance(): GMManager { return this.instance; }
    private commands = new Map<string, { description: string; action: GMCommandAction }>();
    private enabled = false;
    init(enabled = false): void { this.enabled = enabled; }
    register(name: string, description: string, action: GMCommandAction): void {
        if (this.commands.has(name)) throw new Error('Duplicate diagnostic command');
        this.commands.set(name, { description, action });
    }
    execute(input: string): string {
        if (!this.enabled) return 'Diagnostics disabled';
        const [name, ...args] = input.trim().split(/\s+/);
        const command = this.commands.get(name);
        if (!command) return 'Unknown diagnostic command';
        return command.action(args);
    }
    getHelpText(): string { return Array.from(this.commands).map(([name, command]) => name + ': ' + command.description).join('\n'); }
    dispose(): void { this.enabled = false; this.commands.clear(); }
}
