import type { ConversationItem } from '../provider/responses.js';

/**
 * The single current memory block (M05B01).
 *
 * The defect this exists to prevent: on every refresh the packet was appended to
 * the request as another copy, so a request that refreshed three times carried
 * three packets, the first two of them stale. Growth was not bounded by anything
 * the budget could see, because the growth happened before the budget did.
 *
 * `ConversationItem` carries no field that marks a memory block, and adding one
 * would change a published contract for a client-side concern. So the block is
 * tracked by the slice of history it occupies. That is sufficient because the
 * loop owns `history` and is the only thing appending to it.
 *
 * A replacement keeps the block at its original position. Order matters: the
 * packet has to arrive before the turn it informs, and moving it would change
 * what the model is shown relative to the tool results it depends on.
 */

/** Which slice of the history currently holds the memory block. */
export interface MemorySlot {
  readonly start: number;
  readonly length: number;
}

export interface HistoryWithMemory {
  readonly history: readonly ConversationItem[];
  /** The block's current position, or null when no block is present. */
  readonly slot: MemorySlot | null;
}

/** The claim rendered into a block, so a reader can tell one packet from another. */
export interface MemoryBlock {
  readonly items: readonly ConversationItem[];
}

function sliceOf(history: readonly ConversationItem[], slot: MemorySlot): readonly ConversationItem[] {
  return history.slice(slot.start, slot.start + slot.length);
}

/** Appends the first block, or replaces the one already present. */
export function placeMemoryBlock(
  history: readonly ConversationItem[],
  slot: MemorySlot | null,
  next: MemoryBlock,
  position:'start'|'end'='end',
): HistoryWithMemory {
  if (slot === null) {
    const items = next.items.length;
    return { history: position==='start'?[...next.items,...history]:[...history, ...next.items], slot: items === 0 ? null : { start: position==='start'?0:history.length, length: items } };
  }

  const previous = sliceOf(history, slot);
  const replacement = next.items;
  if (replacement.length === previous.length && replacement.every((item, index) => item === previous[index])) {
    // Unchanged: leave the history and the slot exactly as they are, so a no-op
    // refresh cannot perturb ordering.
    return { history, slot };
  }

  const replaced = [
    ...history.slice(0, slot.start),
    ...replacement,
    ...history.slice(slot.start + slot.length),
  ];
  return {
    history: replaced,
    slot: replacement.length === 0 ? null : { start: slot.start, length: replacement.length },
  };
}

/** Removes the block entirely, which is what a block with no items means. */
export function clearMemoryBlock(history: readonly ConversationItem[], slot: MemorySlot | null): HistoryWithMemory {
  return placeMemoryBlock(history, slot, { items: [] });
}

/**
 * What a refresh changed, so the caller can record it rather than infer it.
 *
 * `removed` counts the stale items that left the request. It is zero for the
 * first placement and for an unchanged refresh, which is what makes "the block
 * was replaced, not appended" an observable claim rather than an intention.
 */
export interface RefreshEffect {
  readonly kind: 'placed' | 'replaced' | 'unchanged' | 'cleared';
  readonly removedItems: number;
  readonly addedItems: number;
}

export function refreshMemoryBlock(
  current: HistoryWithMemory,
  next: MemoryBlock,
): { readonly value: HistoryWithMemory; readonly effect: RefreshEffect } {
  const previous = current.slot === null ? [] : sliceOf(current.history, current.slot);
  const value = placeMemoryBlock(current.history, current.slot, next);
  if (current.slot === null) {
    return { value, effect: { kind: value.slot === null ? 'cleared' : 'placed', removedItems: 0, addedItems: next.items.length } };
  }
  if (next.items.length === 0) {
    return { value, effect: { kind: 'cleared', removedItems: previous.length, addedItems: 0 } };
  }
  if (value.history === current.history) {
    return { value, effect: { kind: 'unchanged', removedItems: 0, addedItems: 0 } };
  }
  return { value, effect: { kind: 'replaced', removedItems: previous.length, addedItems: next.items.length } };
}

/**
 * Applies a guard's rebuilt input while preserving the single-block invariant.
 *
 * A reconciliation can drop or rewrite items the loop did not author. The slot
 * is recomputed from what actually survives rather than trusted, because a stale
 * offset would silently mark the wrong items as the memory block and then replace
 * real conversation on the next refresh.
 */
export function realignMemorySlot(
  history: readonly ConversationItem[],
  slot: MemorySlot | null,
  blockItems: readonly ConversationItem[],
): MemorySlot | null {
  if (slot === null || blockItems.length === 0) return null;

  // Match the whole block by identity, not just its first item, and search the
  // entire history: a reconciliation can insert or drop items before the block,
  // so the old offset is evidence of nothing. Matching only the head would anchor
  // the slot onto an unrelated item that happened to be the same object.
  const first = blockItems[0] as ConversationItem;
  const last = blockItems[blockItems.length - 1] as ConversationItem;
  for (let start = 0; start + blockItems.length <= history.length; start++) {
    if (history[start] !== first) continue;
    if (!blockItems.every((item, offset) => history[start + offset] === item)) continue;
    if (history[start + blockItems.length - 1] !== last) continue;
    return { start, length: blockItems.length };
  }
  return null;
}