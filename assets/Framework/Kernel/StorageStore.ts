export interface StorageAdapter { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void>; }
type Snapshot = { version: 1; data: Record<string, unknown> };
/** Serialized saves; a failed write leaves the revision dirty and can be retried. */
export class StorageStore {
    private data: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    private revision = 0;
    private saved = 0;
    private saving?: Promise<void>;
    private initialized = false;
    constructor(private adapter: StorageAdapter, private key: string) { if (!key) throw new Error('Storage namespace required'); }
    async init(): Promise<void> {
        if (this.initialized) return;
        const text = await this.adapter.read(this.key);
        if (text !== null) {
            const snapshot = JSON.parse(text) as Snapshot;
            if (snapshot.version !== 1 || !snapshot.data || Array.isArray(snapshot.data) || typeof snapshot.data !== 'object')
                throw new Error('Invalid storage schema');
            this.data = Object.assign(Object.create(null), snapshot.data) as Record<string, unknown>;
        }
        this.initialized = true;
    }
    get dirty(): boolean { return this.revision !== this.saved; }
    get<T>(key: string, fallback: T): T {
        return Object.prototype.hasOwnProperty.call(this.data, key) ? JSON.parse(JSON.stringify(this.data[key])) as T : fallback;
    }
    set(key: string, value: unknown): void {
        if (!this.initialized) throw new Error('Storage not initialized');
        const text = JSON.stringify(value);
        if (text === undefined) throw new Error('Value is not JSON serializable');
        this.data[key] = JSON.parse(text) as unknown; this.revision++;
    }
    remove(key: string): void {
        if (!this.initialized) throw new Error('Storage not initialized');
        if (Object.prototype.hasOwnProperty.call(this.data, key)) { delete this.data[key]; this.revision++; }
    }
    flush(): Promise<void> {
        if (this.saving) return this.saving;
        const task = this.save();
        this.saving = task;
        void task.then(() => { this.saving = undefined; }, () => { this.saving = undefined; });
        return task;
    }
    private async save(): Promise<void> {
        if (!this.initialized) throw new Error('Storage not initialized');
        while (this.dirty) {
            const revision = this.revision;
            const payload = JSON.stringify({ version: 1, data: this.data });
            await this.adapter.write(this.key, payload);
            this.saved = revision;
        }
    }
}
