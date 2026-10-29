/** Framework-only contracts. Game schemas and identifiers belong in the game directory. */
export const FrameworkEvent = {
    UI_OPENED: 'framework:ui-opened', UI_CLOSED: 'framework:ui-closed',
    BUNDLE_RELEASED: 'framework:bundle-released', RED_DOT_UPDATE: 'framework:red-dot',
    LANGUAGE_CHANGED: 'framework:language', SHOW_TOAST: 'framework:toast'
} as const;
export const EventName = FrameworkEvent;
export interface EventPayloadMap {
    'framework:ui-opened': { name: string };
    'framework:ui-closed': { name: string };
    'framework:bundle-released': { name: string };
    'framework:red-dot': { path: string; value: number };
    'framework:language': { locale: string };
    'framework:toast': { message: string };
}
export type DataPayloadMap = Record<string, unknown>;
