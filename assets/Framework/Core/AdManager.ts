import { PlatformManager } from './Platform/PlatformManager';
import type { CapabilityResult } from './Platform/PlatformManager';
/** Platform transport only. The game owns rewards, placement IDs and pause policy. */
export class AdManager {
    private static instance = new AdManager();
    static get Instance(): AdManager { return this.instance; }
    showRewardAd(adUnitId: string): Promise<CapabilityResult> { return PlatformManager.Instance.adapter.showRewardAd(adUnitId); }
}
