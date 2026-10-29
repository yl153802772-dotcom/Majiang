import type { IState } from './IState';
/** Synchronous FSM; a failed transition stops the machine and propagates its error. */
export class StateMachine<Context = unknown, Data = unknown> {
    private states = new Map<string | number, IState<Context, Data>>();
    private current: string | number | null = null;
    private transitioning = false;
    constructor(private context: Context) {}
    registerState(id: string | number, state: IState<Context, Data>): void {
        if (this.states.has(id)) throw new Error('Duplicate state: ' + id);
        this.states.set(id, state);
    }
    changeState(id: string | number, data?: Data): void {
        if (this.transitioning) throw new Error('Reentrant state transition');
        const next = this.states.get(id);
        if (!next) throw new Error('Unknown state: ' + id);
        if (this.current === id) return;
        this.transitioning = true;
        const previous = this.current;
        try {
            this.current = null;
            if (previous !== null) this.states.get(previous)?.onExit?.(this.context);
            next.onEnter(this.context, data); this.current = id;
        } finally { this.transitioning = false; }
    }
    update(dt: number): void { if (this.current !== null) this.states.get(this.current)?.onUpdate?.(dt, this.context); }
    getCurrentStateId(): string | number | null { return this.current; }
    destroy(): void {
        if (this.transitioning) throw new Error('Destroy during state transition');
        const previous = this.current; this.current = null;
        try { if (previous !== null) this.states.get(previous)?.onExit?.(this.context); } finally { this.states.clear(); }
    }
}
