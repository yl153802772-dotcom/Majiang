import { sys } from 'cc';
import { FrameworkError, runCleanups } from '../../Kernel/Contracts';
import { asyncOperation } from '../../Kernel/AsyncOperation';
import type { LifecycleScope } from '../../Kernel/LifecycleScope';
export type CapabilityResult = { status: 'completed' | 'requested' | 'canceled' | 'unsupported' | 'failed'; error?: unknown };
export interface ShareOptions { title: string; imageUrl?: string; query?: string; }
export interface HttpOptions { method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; url: string; data?: unknown; headers?: Record<string, string>; timeoutMs?: number; scope?: LifecycleScope; }
export class HttpStatusError extends Error { constructor(readonly status: number) { super('HTTP status ' + status); } }
export interface IPlatformService {
    readonly kind: 'web' | 'wechat' | 'native-unsupported';
    share(options: ShareOptions): Promise<CapabilityResult>;
    showRewardAd(id: string): Promise<CapabilityResult>;
    request<T>(options: HttpOptions): Promise<T>;
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
}
function getRequestUrl(options: HttpOptions): string {
    if (options.method !== 'GET' || options.data === undefined) return options.url;
    if (!options.data || typeof options.data !== 'object' || Array.isArray(options.data)) throw new Error('GET data must be a query record');
    const query: string[] = [];
    for (const [key, value] of Object.entries(options.data)) {
        if (value === undefined) continue;
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Query values must be scalar');
        query.push(encodeURIComponent(key) + '=' + encodeURIComponent(value === null ? '' : String(value)));
    }
    return options.url + (query.length ? (options.url.includes('?') ? '&' : '?') + query.join('&') : '');
}
interface WxAd {
    onClose(cb: (result?: { isEnded?: boolean }) => void): void;
    offClose(cb: (result?: { isEnded?: boolean }) => void): void;
    onError(cb: (error: unknown) => void): void; offError(cb: (error: unknown) => void): void;
    show(): Promise<void>; load(): Promise<void>; destroy(): void;
}
interface WxApi {
    shareAppMessage?(options: ShareOptions & { fail: (error: unknown) => void }): void;
    createRewardedVideoAd?(options: { adUnitId: string }): WxAd;
    request?(options: { url: string; method: string; data?: unknown; header?: Record<string, string>; timeout: number;
        success: (value: { statusCode: number; data: unknown }) => void; fail: (error: unknown) => void }): void | { abort(): void };
    getStorage?(options: { key: string; success: (value: { data: unknown }) => void; fail: (error: { errMsg?: string }) => void }): void;
    setStorage?(options: { key: string; data: string; success: () => void; fail: (error: unknown) => void }): void;
}
function wxApi(): WxApi | undefined { return (globalThis as unknown as { wx?: WxApi }).wx; }
class WebAdapter implements IPlatformService {
    readonly kind: IPlatformService['kind'];
    constructor() { this.kind = sys.isNative ? 'native-unsupported' : 'web'; }
    async share(_options: ShareOptions): Promise<CapabilityResult> { return { status: 'unsupported' }; }
    async showRewardAd(_id: string): Promise<CapabilityResult> { return { status: 'unsupported' }; }
    async request<T>(options: HttpOptions): Promise<T> {
        if (typeof fetch === 'undefined') throw new Error('HTTP unsupported on this platform');
        return asyncOperation<T>((resolve, reject) => {
            const controller = new AbortController();
            void fetch(getRequestUrl(options), { method: options.method, headers: options.headers,
                body: options.method === 'GET' || options.data === undefined ? undefined : JSON.stringify(options.data),
                signal: controller.signal }).then(async response => {
                if (!response.ok) throw new HttpStatusError(response.status);
                return response.status === 204 ? undefined as T : await response.json() as T;
            }).then(resolve, reject);
            return () => controller.abort();
        }, { scope: options.scope, timeoutMs: options.timeoutMs ?? 8000 });
    }
    async read(key: string): Promise<string | null> { return sys.localStorage.getItem(key); }
    async write(key: string, value: string): Promise<void> { sys.localStorage.setItem(key, value); }
}
class WechatAdapter implements IPlatformService {
    readonly kind = 'wechat' as const;
    private adPending = false;
    async share(options: ShareOptions): Promise<CapabilityResult> {
        if (!wxApi()?.shareAppMessage) return { status: 'unsupported' };
        // WeChat does not offer a reliable share-success receipt; never issue rewards here.
        try { wxApi()!.shareAppMessage!({ ...options, fail: () => {} }); return { status: 'requested' }; }
        catch (error) { return { status: 'failed', error }; }
    }
    showRewardAd(id: string): Promise<CapabilityResult> {
        const wx = wxApi();
        if (!wx?.createRewardedVideoAd) return Promise.resolve({ status: 'unsupported' });
        if (this.adPending || !id) return Promise.resolve({ status: 'failed', error: new Error('Ad busy or unconfigured') });
        this.adPending = true;
        return new Promise(resolve => {
            let ad: WxAd | undefined;
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = (result: CapabilityResult) => {
                if (settled) return;
                settled = true;
                let outcome = result;
                try {
                    runCleanups('Ad cleanup failed', [
                        () => { if (timer !== undefined) clearTimeout(timer); },
                        () => ad?.offClose(close), () => ad?.offError(fail), () => ad?.destroy(),
                    ]);
                } catch (cleanup) {
                    // A watched video remains completed; cleanup errors are explicit,
                    // but cannot strand the caller or falsely award an unwatched ad.
                    outcome = { ...result, error: new FrameworkError('Ad cleanup failed',
                        result.error === undefined ? [cleanup] : [result.error, cleanup]) };
                } finally { this.adPending = false; resolve(outcome); }
            };
            const close = (result?: { isEnded?: boolean }) => finish({ status: result?.isEnded === true ? 'completed' : 'canceled' });
            const fail = (error: unknown) => finish({ status: 'failed', error });
            try {
                ad = wx.createRewardedVideoAd!({ adUnitId: id });
                ad.onClose(close); if (settled) return;
                ad.onError(fail); if (settled) return;
                timer = setTimeout(() => fail(new Error('Ad callback timed out')), 120000);
                const current = ad;
                void current.show().catch(async () => {
                    if (settled) return;
                    await current.load();
                    if (!settled) await current.show();
                }).catch(fail);
            } catch (error) { fail(error); }
        });
    }
    request<T>(options: HttpOptions): Promise<T> {
        return asyncOperation<T>((resolve, reject) => {
            const wx = wxApi();
            if (!wx?.request) { reject(new Error('wx.request unavailable')); return; }
            const task = wx.request({ url: getRequestUrl(options), method: options.method, data: options.method === 'GET' ? undefined : options.data, header: options.headers,
                timeout: options.timeoutMs ?? 8000,
                success: result => result.statusCode >= 200 && result.statusCode < 300 ? resolve(result.statusCode === 204 ? undefined as T : result.data as T)
                    : reject(new HttpStatusError(result.statusCode)), fail: reject });
            return () => task?.abort();
        }, { scope: options.scope, timeoutMs: options.timeoutMs ?? 8000 });
    }
    read(key: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            const wx = wxApi();
            if (!wx?.getStorage) { reject(new Error('Storage unsupported')); return; }
            wx.getStorage({ key, success: result => typeof result.data === 'string' ? resolve(result.data)
                : reject(new Error('Storage is not a string')),
                fail: error => /not found|不存在/i.test(error.errMsg ?? '') ? resolve(null) : reject(error) });
        });
    }
    write(key: string, value: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const wx = wxApi();
            if (!wx?.setStorage) { reject(new Error('Storage unsupported')); return; }
            wx.setStorage({ key, data: value, success: resolve, fail: reject });
        });
    }
}
export class PlatformManager {
    private static instance = new PlatformManager();
    static get Instance(): PlatformManager { return this.instance; }
    private service?: IPlatformService;
    get adapter(): IPlatformService {
        if (!this.service) this.service = sys.platform === sys.Platform.WECHAT_GAME && wxApi() ? new WechatAdapter() : new WebAdapter();
        return this.service;
    }
    setAdapter(adapter: IPlatformService): void { this.service = adapter; }
}
