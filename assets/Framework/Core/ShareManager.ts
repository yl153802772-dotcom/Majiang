import { PlatformManager } from './Platform/PlatformManager';
import type { ShareOptions, CapabilityResult } from './Platform/PlatformManager';
export class ShareManager {
    private static instance = new ShareManager();
    static get Instance(): ShareManager { return this.instance; }
    share(options: ShareOptions): Promise<CapabilityResult> { return PlatformManager.Instance.adapter.share(options); }
}
