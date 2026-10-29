import { PlatformManager } from '../Platform/PlatformManager';
import type { HttpOptions } from '../Platform/PlatformManager';
import { HttpStatusError } from '../Platform/PlatformManager';
import { asyncOperation, OperationCanceledError } from '../../Kernel/AsyncOperation';
/** Explicit requests; automatic retries of non-idempotent requests are intentionally absent. */
export class HttpManager {
    private static instance = new HttpManager();
    static get Instance(): HttpManager { return this.instance; }
    private baseUrl = '';
    private headers: Record<string, string> = {};
    init(baseUrl: string): void {
        if (!/^https:\/\//.test(baseUrl)) throw new Error('HTTPS base URL required');
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    setToken(token: string): void { this.headers = token ? { Authorization: 'Bearer ' + token } : {}; }
    async request<T>(path: string, options: Omit<HttpOptions, 'url'> & { retries?: number; retryDelayMs?: number }): Promise<T> {
        if (!this.baseUrl || !path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid HTTP endpoint');
        const retries = options.retries ?? 0, delay = options.retryDelayMs ?? 150;
        if (!Number.isInteger(retries) || retries < 0 || retries > 2 || !Number.isFinite(delay) || delay < 0 || delay > 5000)
            throw new Error('Invalid HTTP retry policy');
        if (retries && options.method !== 'GET') throw new Error('Only GET requests may opt into automatic retry');
        // Freeze this request's endpoint/token even if another session reconfigures the service.
        const url = this.baseUrl + path, headers = { ...this.headers, ...options.headers };
        for (let attempt = 0; ; attempt++) {
            try { return await PlatformManager.Instance.adapter.request<T>({ ...options, url, headers }); }
            catch (error) {
                if (attempt >= retries || error instanceof SyntaxError || error instanceof OperationCanceledError || (options.scope && !options.scope.isActive)
                    || (error instanceof HttpStatusError && error.status < 500)) throw error;
                await asyncOperation<void>(resolve => { const timer = setTimeout(() => resolve(), delay * (attempt + 1)); return () => clearTimeout(timer); },
                    { scope: options.scope, timeoutMs: Math.max(1, delay * (attempt + 1) + 1000) });
            }
        }
    }
    dispose(): void { this.headers = {}; this.baseUrl = ''; }
}
