/**
 * 固定关 888 的推荐操作顺序转录。
 * 只记录 MVP_FINAL §7.3 的 BlockID 数据，不包含胜负判定、不强制通关，也不代表本批已验证其可解性。
 * 规则回放与逐步验证属于后续批次。
 */

import type { BlockID } from '../Domain/BlockTypes';

/** B01～B10 完成三碰一杠与将牌，再按 B21～B32 收尾。 */
export const RECOMMENDED_SOLUTION_888: readonly BlockID[] = [
    'B01', 'B02', 'B03', 'B04', 'B05',
    'B06', 'B07', 'B08', 'B09', 'B10',
    'B21', 'B22', 'B23', 'B24', 'B25', 'B26',
    'B27', 'B28', 'B29', 'B30', 'B31', 'B32',
];
