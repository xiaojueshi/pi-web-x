import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";

/** 会话草稿中可恢复的图片附件。 */
export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

/** 未发送的会话输入及其图片附件。 */
export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
}

const SESSION_STORAGE_KEY = "pi-web-x:chat-drafts";
const drafts = new Map<string, ChatDraft>();
let hydrated = false;

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isStoredDraft(value: unknown): value is ChatDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatDraft>;
  return (
    typeof candidate.value === "string" &&
    Array.isArray(candidate.images) &&
    candidate.images.every(
      (image) =>
        image &&
        typeof image === "object" &&
        typeof (image as ChatDraftImage).data === "string" &&
        typeof (image as ChatDraftImage).mimeType === "string",
    )
  );
}

function hydrateDrafts(): void {
  if (hydrated) return;
  hydrated = true;
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, draft] of Object.entries(stored)) {
      if (!isStoredDraft(draft) || isEmptyDraft(draft)) continue;
      drafts.set(key, {
        value: draft.value,
        images: draft.images
          .filter(isBase64ImageWithinLimits)
          .slice(0, MAX_ATTACHED_IMAGES)
          .map(({ data, mimeType }) => ({ data, mimeType })),
      });
    }
  } catch {
    // 已损坏、被清理或超出配额的 sessionStorage 不应阻断编辑器。
  }
}

function persistDrafts(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(drafts.entries())),
    );
  } catch {
    // 草稿仅是尽力恢复；隐私模式和配额不足时继续保留内存副本。
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0;
}

/**
 * 读取指定会话的未发送草稿。
 * @param key 会话或新会话草稿键
 * @returns 草稿副本；不存在时返回 null
 */
export function getDraft(key: string): ChatDraft | null {
  hydrateDrafts();
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

/**
 * 保存指定会话的未发送草稿，并在当前浏览器会话内恢复。
 * @param key 会话或新会话草稿键
 * @param draft 要保存的草稿
 * @returns 无返回值
 */
export function setDraft(key: string, draft: ChatDraft): void {
  hydrateDrafts();
  if (isEmptyDraft(draft)) drafts.delete(key);
  else drafts.set(key, cloneDraft(draft));
  persistDrafts();
}

/**
 * 删除指定会话的未发送草稿。
 * @param key 会话或新会话草稿键
 * @returns 无返回值
 */
export function clearDraft(key: string): void {
  hydrateDrafts();
  drafts.delete(key);
  persistDrafts();
}

/**
 * 合并待恢复的提交文本与当前输入。
 * @param submitted 需要恢复的文本
 * @param current 当前编辑器文本
 * @returns 合并后的文本
 */
export function mergeRestoredSubmissionText(
  submitted: string,
  current: string,
): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

/**
 * 合并待恢复的提交草稿与当前草稿。
 * @param submittedText 需要恢复的文本
 * @param submittedImages 需要恢复的图片
 * @param currentText 当前草稿文本
 * @param currentImages 当前草稿图片
 * @returns 已按附件限制过滤的合并草稿
 */
export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
  };
}

/**
 * 将一次失败或中断的提交恢复到指定草稿。
 * @param key 会话或新会话草稿键
 * @param text 需要恢复的文本
 * @param images 需要恢复的图片
 * @returns 恢复后的草稿
 */
export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
  );
  setDraft(key, restored);
  return restored;
}

/**
 * 在新会话获得真实会话标识后迁移其草稿。
 * @param previousKey 临时草稿键
 * @param nextKey 目标会话草稿键
 * @param currentDraft 当前编辑器尚未持久化的草稿
 * @returns 迁移后的草稿；不存在时返回 null
 */
export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey)
    return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous =
    currentDraft && !isEmptyDraft(currentDraft)
      ? cloneDraft(currentDraft)
      : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(
        next.value,
        next.images,
        previous.value,
        previous.images,
      )
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
