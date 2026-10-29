import type { Asset } from 'cc';
import type { AssetType } from './ResManager';
export interface PreloadItem<T extends Asset = Asset> { id: string; path: string; type: AssetType<T>; bundle?: string; critical?: boolean; }
export interface PreloadReport { completed: string[]; failed: Array<{ id: string; error: unknown }>; }
