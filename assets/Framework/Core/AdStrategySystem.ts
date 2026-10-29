/** Project-injected policy. No built-in quota, placement or reward rules. */
export interface AdPolicy { canShow(placement: string): boolean; recordCompleted(placement: string): void; }
export class AdStrategySystem {
    constructor(private readonly policy: AdPolicy) {}
    canShow(placement: string): boolean { return this.policy.canShow(placement); }
    recordCompleted(placement: string): void { this.policy.recordCompleted(placement); }
}
