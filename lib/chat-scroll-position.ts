/**
 * 会话阅读位置的持久化锚点模型。
 *
 * 聊天窗口在卸载（切换会话）前记录当前阅读位置：要么在底部，要么以
 * 某条消息（entryId）的视口偏移为锚点。重新进入会话时依据锚点恢复
 * 滚动位置，而不是每次都跳回底部。
 */

/** `atBottom: true` 表示离开时视口处于聊天底部；否则使用锚点消息定位。 */
export type ChatScrollPosition =
 | { atBottom: true }
 | {
    atBottom: false;
    /** 锚点消息的 entryId。 */
    anchorEntryId: string;
    /** 锚点消息顶部相对视口顶部的偏移（px，可为负）。 */
    anchorOffset: number;
    /** 记录时已加载的最旧 entryId，用于判断是否需要继续向前翻页。 */
    oldestEntryId: string | null;
   };

/** 参与锚点计算的候选元素（带 entryId 的消息容器）。 */
export interface ChatScrollAnchorCandidate {
 entryId: string;
 top: number;
 bottom: number;
}

/**
 * 从候选消息中找出视口顶部上方最近的一条作为阅读锚点。
 *
 * @param candidates 按文档顺序排列的候选消息（须带 `dataset.entryId`）。
 * @param viewportTop 视口顶部的 getBoundingClientRect().top。
 * @returns 锚点 entryId 与偏移；候选为空时返回 null。
 */
export function findChatScrollAnchor(
 candidates: ChatScrollAnchorCandidate[],
 viewportTop: number,
): Pick<
 Extract<ChatScrollPosition, { atBottom: false }>,
 "anchorEntryId" | "anchorOffset"
> | null {
 let candidate = candidates[0];
 for (const item of candidates) {
  if (item.top > viewportTop) break;
  candidate = item;
 }
 if (!candidate) return null;
 return {
  anchorEntryId: candidate.entryId,
  anchorOffset: candidate.top - viewportTop,
 };
}
