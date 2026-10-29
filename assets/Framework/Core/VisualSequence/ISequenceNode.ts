/*动作策略接口
* 定义一个两段式的通用特效生命周期（完美对应你原本的 absorb 和 burst，但名字更具通用性）*/

import { Node } from 'cc';
import { SequenceContext } from './SequenceContext';

export interface ISequenceNode {
    /** * 阶段一：通常用于处理多个替身节点的飞行、汇聚、吸收等动画
     */
    playPhase1(dummyNodes: Node[], ctx: SequenceContext, onComplete: () => void): void;

    /** * 阶段二：通常用于阶段一结束后，在中心点播放单一的爆点、碎裂等特效
     */
    playPhase2(ctx: SequenceContext, onComplete: () => void): void;

    /** * 中断清理
     */
    cancel?(dummyNodes: Node[]): void;
}