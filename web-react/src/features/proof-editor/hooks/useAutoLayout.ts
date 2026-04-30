import { useEffect, useRef } from "react";
import { useNodesInitialized, useReactFlow } from "@xyflow/react";
import { useProofStore } from "../store";
import { computeTreeLayout } from "../utils/convert-proof-tree";
import type { ProofTree } from "@pie/protocol";
import type { GoalNode as ProtoGoalNode } from "@pie/protocol";

/**
 * Collect every node ID (goal + tactic) that the proof tree requires.
 * This lets us cross-check whether React Flow already has those nodes
 * before running the layout — preventing stale-node races.
 */
function collectExpectedNodeIds(root: ProtoGoalNode): Set<string> {
  const ids = new Set<string>();

  function traverse(node: ProtoGoalNode) {
    ids.add(node.goal.id);

    if (node.appliedTactic && node.children.length > 0) {
      ids.add(`tactic-for-${node.goal.id}`);
    }
    if (node.completedBy && node.children.length === 0) {
      ids.add(`tactic-completing-${node.goal.id}`);
    }

    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(root);
  return ids;
}

/**
 * useAutoLayout
 *
 * Runs a second layout pass after React Flow has measured all proof nodes.
 * The first pass (in convertProofTreeToReactFlow) places nodes using fallback
 * size constants.  This hook fires once those nodes are rendered and replaces
 * every position with one computed from the actual measured width/height,
 * so the tree stays properly spaced regardless of content length or context
 * variable count.
 *
 * It re-runs automatically after each syncFromWorker call (tactic apply or
 * retract), because proofTreeData gets a new object reference each time.
 *
 * Nodes the user has manually dragged are left in place; if the root goal was
 * manually moved, all non-manual children are offset by the same delta so the
 * tree stays visually connected.
 *
 * Race-condition guard: the effect verifies that getNodes() already contains
 * EVERY node the current proof tree expects before committing a layout.
 * Without this check, the effect can fire (due to proofTreeData changing)
 * while React Flow still holds the previous render's stale nodes, "succeed"
 * with those stale sizes, stamp lastTree.current, and then block the correct
 * retry when nodesInitialized finally fires with the real new nodes.
 */
export function useAutoLayout() {
  const nodesInitialized = useNodesInitialized();
  const { getNodes } = useReactFlow();
  const proofTreeData = useProofStore((s) => s.proofTreeData);
  const setLayoutPositions = useProofStore((s) => s.setLayoutPositions);

  // Track which tree we last laid out so we don't repeat work
  const lastTree = useRef<ProofTree | null>(null);

  useEffect(() => {
    if (!nodesInitialized || !proofTreeData) return;
    if (proofTreeData === lastTree.current) return;

    const nodes = getNodes();

    // ── Race-condition guard ──────────────────────────────────────────────────
    // Verify React Flow already holds every node the proof tree expects.
    // If not, bail out — nodesInitialized will flip false→true once they arrive
    // and re-trigger this effect with the full, correct node set.
    const expectedIds = collectExpectedNodeIds(proofTreeData.root);
    const rfIds = new Set(
      nodes.filter(n => n.type === "goal" || n.type === "tactic").map(n => n.id)
    );
    for (const id of expectedIds) {
      if (!rfIds.has(id)) return; // new nodes not in React Flow yet — wait
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Collect measured sizes for every proof node (goal + tactic).
    // Ghost and lemma nodes are not part of the tree layout, so we skip them.
    const measuredSizes = new Map<string, { width: number; height: number }>();
    for (const node of nodes) {
      if (node.type !== "goal" && node.type !== "tactic") continue;
      if (node.measured?.width != null && node.measured?.height != null) {
        measuredSizes.set(node.id, {
          width: node.measured.width,
          height: node.measured.height,
        });
      }
    }

    // Wait until every expected proof node has been measured
    for (const id of expectedIds) {
      if (!measuredSizes.has(id)) return;
    }

    // Compute positions using actual node sizes
    const newPositions = computeTreeLayout(proofTreeData.root, measuredSizes);

    // ── Manual-position delta propagation ────────────────────────────────────
    // If the root goal (or any ancestor) was manually dragged, offset all
    // non-manual children by the same delta so the tree stays visually intact.
    const manualPositions = useProofStore.getState().manualPositions;
    const rootId = proofTreeData.root.goal.id;
    const rootAutoPos = newPositions.get(rootId);
    const rootManualPos = manualPositions.get(rootId);

    // Global delta: how far the root was moved from its auto position
    const globalDelta =
      rootAutoPos && rootManualPos
        ? { dx: rootManualPos.x - rootAutoPos.x, dy: rootManualPos.y - rootAutoPos.y }
        : { dx: 0, dy: 0 };

    const toApply = new Map<string, { x: number; y: number }>();
    for (const [id, pos] of newPositions) {
      if (manualPositions.has(id)) continue; // user owns this position
      toApply.set(id, {
        x: pos.x + globalDelta.dx,
        y: pos.y + globalDelta.dy,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (toApply.size > 0) {
      setLayoutPositions(toApply);
    }

    lastTree.current = proofTreeData;
  }, [nodesInitialized, proofTreeData, getNodes, setLayoutPositions]);
}
