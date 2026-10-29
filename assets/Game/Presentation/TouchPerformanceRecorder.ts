/**
 * 有界 TouchEnd User Timing 记录器。
 * 每局最多 256 条；换局/重开 reset；退场只清本模块名称。
 * 不创建全局诊断对象，不改变 BoardInput 的完整 TouchEnd 计时。
 */

export const TOUCH_PERFORMANCE_NAME = 'r02-touchend';
export const MAX_TOUCH_RECORDS = 256;

export interface PerformanceLike {
    now(): number;
    measure(name: string, options?: { readonly start?: number; readonly end?: number }): void;
    clearMeasures(name?: string): void;
}

export type SamplingOutcome =
    | 'written'
    | 'limit'
    | 'unsupported'
    | 'suspended'
    | 'disposed'
    | 'failed';

export type ClearOutcome = 'cleared' | 'unsupported' | 'disposed' | 'failed';

export interface TouchPerformanceStats {
    readonly sessionId: string;
    readonly recorded: number;
    readonly limitSkipped: number;
    readonly unsupported: number;
    readonly failed: number;
    readonly clearCount: number;
    readonly clearFailures: number;
    readonly suspended: boolean;
    readonly lastOutcome: SamplingOutcome | null;
    readonly lastClearOutcome: ClearOutcome | null;
}

function resolvePerformance(): PerformanceLike | null {
    try {
        if (typeof globalThis.performance === 'undefined') return null;
        const candidate = globalThis.performance;
        if (typeof candidate.now !== 'function' ||
            typeof candidate.measure !== 'function' ||
            typeof candidate.clearMeasures !== 'function') {
            return null;
        }
        return candidate;
    } catch { return null; }
}

export class TouchPerformanceRecorder {
    private readonly performanceLike: PerformanceLike | null;
    private sessionId = '';
    private recorded = 0;
    private limitSkipped = 0;
    private unsupported = 0;
    private failed = 0;
    private clearCount = 0;
    private clearFailures = 0;
    private suspended = false;
    private lastOutcome: SamplingOutcome | null = null;
    private lastClearOutcome: ClearOutcome | null = null;
    private disposed = false;

    constructor(performanceLike?: PerformanceLike | null) {
        this.performanceLike = performanceLike === undefined ? resolvePerformance() : performanceLike;
    }

    reset(sessionId: string): ClearOutcome {
        if (this.disposed) {
            this.lastClearOutcome = 'disposed';
            return 'disposed';
        }
        this.sessionId = sessionId;
        this.limitSkipped = 0;
        this.unsupported = 0;
        this.failed = 0;
        this.lastOutcome = null;
        return this.clearModuleRecords();
    }

    record(elapsedMs: number): SamplingOutcome {
        if (this.disposed) {
            this.lastOutcome = 'disposed';
            return 'disposed';
        }
        if (!this.performanceLike) {
            this.unsupported++;
            this.lastOutcome = 'unsupported';
            return 'unsupported';
        }
        if (this.suspended) {
            this.lastOutcome = 'suspended';
            return 'suspended';
        }
        if (this.recorded >= MAX_TOUCH_RECORDS) {
            this.limitSkipped++;
            this.lastOutcome = 'limit';
            return 'limit';
        }
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
            this.failed++;
            this.lastOutcome = 'failed';
            return 'failed';
        }
        try {
            const end = this.performanceLike.now();
            this.performanceLike.measure(TOUCH_PERFORMANCE_NAME, {
                start: end - elapsedMs,
                end,
            });
            this.recorded++;
            this.lastOutcome = 'written';
            return 'written';
        } catch {
            this.failed++;
            // Some hosts may append a record before throwing. Do not retry writes
            // until a successful named clear establishes a fresh, bounded budget.
            this.suspended = true;
            this.lastOutcome = 'failed';
            return 'failed';
        }
    }

    clear(): ClearOutcome {
        if (this.disposed) {
            this.lastClearOutcome = 'disposed';
            return 'disposed';
        }
        return this.clearModuleRecords();
    }

    dispose(): void {
        if (this.disposed) return;
        const outcome = this.clearModuleRecords();
        this.lastClearOutcome = outcome;
        this.disposed = true;
    }

    getStats(): TouchPerformanceStats {
        return {
            sessionId: this.sessionId,
            recorded: this.recorded,
            limitSkipped: this.limitSkipped,
            unsupported: this.unsupported,
            failed: this.failed,
            clearCount: this.clearCount,
            clearFailures: this.clearFailures,
            suspended: this.suspended,
            lastOutcome: this.lastOutcome,
            lastClearOutcome: this.lastClearOutcome,
        };
    }

    private clearModuleRecords(): ClearOutcome {
        if (!this.performanceLike) {
            this.lastClearOutcome = 'unsupported';
            return 'unsupported';
        }
        try {
            this.performanceLike.clearMeasures(TOUCH_PERFORMANCE_NAME);
            this.clearCount++;
            this.recorded = 0;
            this.suspended = false;
            this.lastClearOutcome = 'cleared';
            return 'cleared';
        } catch {
            this.clearFailures++;
            this.suspended = true;
            this.lastClearOutcome = 'failed';
            return 'failed';
        }
    }
}
