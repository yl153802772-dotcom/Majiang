/** Implement on a Component. Interfaces are not runtime component names. */
export interface IPoolObject { onSpawn?(data?: unknown): void; onRecycle?(): void; }
