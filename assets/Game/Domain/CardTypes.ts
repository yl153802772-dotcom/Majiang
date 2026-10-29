/**
 * 牌面基础类型。
 * MVP_FINAL §3.1：仅万、筒、条三种花色，点数 1～9；不使用风牌、箭牌、白板、花牌、季节牌。
 * 纯 TypeScript：不依赖 cc、wx、Framework 单例、随机、网络或存储。
 */

/** 花色：万 / 筒 / 条。 */
export type Suit = 'wan' | 'tong' | 'tiao';

/** 点数：1～9。 */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 单张牌面。 */
export interface Card {
    readonly suit: Suit;
    readonly rank: Rank;
}

/** 合法花色，顺序稳定，供校验与诊断使用。 */
export const SUITS: readonly Suit[] = ['wan', 'tong', 'tiao'];

/** 合法点数，顺序稳定，供校验与诊断使用。 */
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 运行时判定花色；接收 unknown 以便校验外部数据。 */
export function isSuit(value: unknown): value is Suit {
    return value === 'wan' || value === 'tong' || value === 'tiao';
}

/** 运行时判定点数；仅接受 1～9 的整数。 */
export function isRank(value: unknown): value is Rank {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9;
}

/** 运行时判定完整牌面。 */
export function isCard(value: unknown): value is Card {
    if (typeof value !== 'object' || value === null) return false;
    return isSuit((value as { readonly suit?: unknown }).suit) &&
        isRank((value as { readonly rank?: unknown }).rank);
}

/** 牌面相等比较：花色与点数都相同。 */
export function cardsEqual(a: Card, b: Card): boolean {
    return a.suit === b.suit && a.rank === b.rank;
}

/** 稳定牌面键，用于计数或诊断，不作为游戏状态。 */
export function cardKey(card: Card): string {
    return card.suit + ':' + card.rank;
}
