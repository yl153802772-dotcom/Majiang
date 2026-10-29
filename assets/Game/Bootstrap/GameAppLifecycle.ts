/**
 * Game scene-instance ownership gate. It only coordinates GameBootstrap instances;
 * it does not own a second App/ModuleHost and only calls the public App.dispose().
 */
export class GameAppLifecycle {
    private static current: symbol | null = null;
    private static closing: Promise<void> | null = null;

    static get hasOwner(): boolean { return GameAppLifecycle.current !== null; }

    static tryClaim(): symbol | null {
        if (GameAppLifecycle.current || GameAppLifecycle.closing) return null;
        const token = Symbol('game-app-owner');
        GameAppLifecycle.current = token;
        return token;
    }

    /** Wait one task for a departing scene, then either claim or report a duplicate. */
    static async waitForClaim(): Promise<symbol | null> {
        if (GameAppLifecycle.closing) await GameAppLifecycle.closing;
        else if (GameAppLifecycle.current) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            if (GameAppLifecycle.closing) await GameAppLifecycle.closing;
        }
        return GameAppLifecycle.tryClaim();
    }

    static owns(token: symbol): boolean { return GameAppLifecycle.current === token; }

    /** Start the one shared closing promise before the async scene cleanup runs. */
    static release(token: symbol, close: () => Promise<void>): Promise<void> {
        if (GameAppLifecycle.current !== token) return GameAppLifecycle.closing ?? Promise.resolve();
        GameAppLifecycle.current = null;
        const task = Promise.resolve().then(close).catch(error => {
            // Keep the failure observable to the caller and never mask the next owner.
            console.error('[GAME-UI-01] scene lifecycle close failed', error);
            throw error;
        });
        GameAppLifecycle.closing = task;
        const done = (): void => { if (GameAppLifecycle.closing === task) GameAppLifecycle.closing = null; };
        void task.then(done, done);
        return task;
    }
}
