/**
 * Node registry — single source of truth for every node implementation in
 * the signal graph.
 *
 * Each `NodeDef` declares its ports + params declaratively so the engine,
 * the inspector UI, the palette, and the help generator can all introspect
 * it without duplicating per-type logic.
 *
 * Adding a new node = write the def in one of `nodes/*.ts` and `register()`
 * it from there. The split keeps each file ~one screen of related code.
 */

import { NodeDef, NodeType } from './types';

const REGISTRY = new Map<NodeType, NodeDef<unknown>>();

export function register<S>(def: NodeDef<S>): void {
  REGISTRY.set(def.type, def as unknown as NodeDef<unknown>);
}

export function getDef(type: NodeType): NodeDef<unknown> | null {
  return REGISTRY.get(type) ?? null;
}

export function allDefs(): NodeDef<unknown>[] {
  return [...REGISTRY.values()];
}

export function hasDef(type: NodeType): boolean {
  return REGISTRY.has(type);
}
