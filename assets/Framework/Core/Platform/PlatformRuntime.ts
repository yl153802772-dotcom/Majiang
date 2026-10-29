import { assetManager, sys } from 'cc';
import { LifecycleScope } from '../../Kernel/LifecycleScope';
import { asyncOperation } from '../../Kernel/AsyncOperation';
import type { OperationOptions } from '../../Kernel/AsyncOperation';
import { FrameworkError } from '../../Kernel/Contracts';
import { ResManager } from '../ResManager';
export interface NetworkState { readonly connected: boolean; readonly type: string; }
export interface WindowMetrics {
    readonly width: number; readonly height: number; readonly pixelRatio: number;
    readonly safeArea?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
    readonly menu?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}
export interface SubpackageProgress { readonly progress: number; readonly totalBytesWritten: number; readonly totalBytesExpectedToWrite: number; }
export interface SubpackageTask {
    onProgressUpdate?(listener: (value: SubpackageProgress) => void): void;
    offProgressUpdate?(listener: (value: SubpackageProgress) => void): void;
}
export interface WxRuntimeApi {
    getWindowInfo?(): { windowWidth: number; windowHeight: number; pixelRatio?: number; safeArea?: WindowMetrics['safeArea'] };
    getSystemInfoSync?(): { windowWidth: number; windowHeight: number; pixelRatio?: number; safeArea?: WindowMetrics['safeArea'] };
    getMenuButtonBoundingClientRect?(): NonNullable<WindowMetrics['menu']>;
    getNetworkType?(options: { success(value: { networkType: string }): void; fail(error: unknown): void }): void;
    onNetworkStatusChange?(listener: (value: { isConnected: boolean; networkType: string }) => void): void;
    offNetworkStatusChange?(listener: (value: { isConnected: boolean; networkType: string }) => void): void;
    onMemoryWarning?(listener: (value: { level?: number }) => void): void;
    offMemoryWarning?(listener: (value: { level?: number }) => void): void;
    loadSubpackage?(options: { name: string; success(): void; fail(error: unknown): void }): SubpackageTask;
}
/** Capability-detected runtime hooks. No login, analytics, ads, disk deletion or global downloader tuning. */
export class PlatformRuntime {
    private static instance = new PlatformRuntime();
    static get Instance(): PlatformRuntime { return this.instance; }
    readonly dependencies = ['resources'];
    private scope?: LifecycleScope;
    private network?: NetworkState;
    private warnings = 0;
    private failure?: unknown;
    constructor(private readonly injected?: WxRuntimeApi, private readonly onError?: (error: unknown) => void) {}
    backend(): WxRuntimeApi | undefined {
        return this.injected ?? (sys.platform === sys.Platform.WECHAT_GAME ? (globalThis as unknown as { wx?: WxRuntimeApi }).wx : undefined);
    }
    get capabilities(): Readonly<{ window: boolean; menu: boolean; memory: boolean; network: boolean; subpackage: boolean; diskCache: boolean }> {
        const wx = this.backend();
        return Object.freeze({ window: !!(wx?.getWindowInfo || wx?.getSystemInfoSync), menu: !!wx?.getMenuButtonBoundingClientRect,
            memory: !!(wx?.onMemoryWarning && wx.offMemoryWarning), network: !!wx?.getNetworkType,
            subpackage: !!wx?.loadSubpackage, diskCache: !!assetManager.cacheManager });
    }
    get state(): Readonly<{ network?: NetworkState; memoryWarnings: number; lastError?: unknown }> {
        return Object.freeze({ network: this.network, memoryWarnings: this.warnings, lastError: this.failure });
    }
    init(): void {
        if (this.scope) throw new Error('Platform runtime already initialized');
        const scope = this.scope = new LifecycleScope(), wx = this.backend();
        const memory = () => {
            if (!scope.isActive) return; this.warnings++;
            try { ResManager.Instance.clearExpiredLRU(); } catch (error) { this.report(error); }
        };
        const network = (value: { isConnected: boolean; networkType: string }) => {
            if (scope.isActive) this.network = Object.freeze({ connected: value.isConnected, type: value.networkType });
        };
        try {
            // Register only symmetric listener pairs; older SDKs must not leak global callbacks.
            if (wx?.onMemoryWarning && wx.offMemoryWarning) { scope.add(() => wx.offMemoryWarning!(memory)); wx.onMemoryWarning(memory); }
            if (wx?.onNetworkStatusChange && wx.offNetworkStatusChange) { scope.add(() => wx.offNetworkStatusChange!(network)); wx.onNetworkStatusChange(network); }
        } catch (error) { this.scope = undefined; scope.rollback(error); }
    }
    readWindow(): WindowMetrics | undefined {
        const wx = this.backend(); if (!wx) return undefined;
        try {
            const info = wx.getWindowInfo?.() ?? wx.getSystemInfoSync?.(); if (!info) return undefined;
            const ratio = info.pixelRatio ?? 1;
            if (![info.windowWidth, info.windowHeight, ratio].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid platform window metrics');
            const rect = (value: WindowMetrics['menu']): WindowMetrics['menu'] => {
                if (!value) return undefined;
                if (![value.left, value.top, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) return undefined;
                return Object.freeze({ left: value.left, top: value.top, width: value.width, height: value.height });
            };
            return Object.freeze({ width: info.windowWidth, height: info.windowHeight, pixelRatio: ratio,
                safeArea: rect(info.safeArea), menu: rect(wx.getMenuButtonBoundingClientRect?.()) });
        } catch (error) { this.report(error); return undefined; }
    }
    getNetwork(options: OperationOptions = {}): Promise<NetworkState> {
        return asyncOperation<NetworkState>((resolve, reject) => {
            const wx = this.backend(); if (!wx?.getNetworkType) { reject(new Error('Network capability unsupported')); return; }
            wx.getNetworkType({ success: value => resolve(Object.freeze({ connected: value.networkType !== 'none', type: value.networkType })), fail: reject });
        }, options);
    }
    /** Explicit opt-in only: engine owns its disk-cache format. Never deletes local saves or calls clearCache. */
    trimEngineDiskCache(): boolean {
        if (!assetManager.cacheManager) return false;
        assetManager.cacheManager.clearLRU(); return true;
    }
    private report(error: unknown): void { this.failure = error; try { this.onError?.(error); } catch (reporting) { this.failure = new FrameworkError('Platform observer failed', [error, reporting]); } }
    dispose(): void { const scope = this.scope; this.scope = undefined; this.network = undefined; scope?.dispose(); }
}
