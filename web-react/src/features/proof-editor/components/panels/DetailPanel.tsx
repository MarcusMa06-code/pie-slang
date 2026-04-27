import { useState, useCallback, useEffect, useMemo } from 'react';
import { useProofStore, useUIStore } from '../../store';
import type { GoalNode, TacticNode } from '../../store/types';
import { TACTICS } from '../../data/tactics';
import { applyTactic } from '../../utils/tactic-callback';
import { useHintStore } from '../../store/hint-store';
import { useMetadataStore } from '../../store/metadata-store';
import { useGoalDescriptionStore } from '../../store/goal-description-store';
import { describeGoalBrowser } from '../../lib/describeGoalBrowser';
import type { GlobalEntry } from '@pie/protocol';

interface DetailPanelProps {
  definitions?: GlobalEntry[];
  theorems?: GlobalEntry[];
}

type Tab = 'details' | 'context' | 'history';

function getSuggestedTactics(goalType: string): string[] {
  const suggestions: string[] = [];
  if (goalType.includes('Pi') || goalType.includes('->')) suggestions.push('intro');
  if (goalType.includes('Sigma') || goalType.includes('Pair')) suggestions.push('split', 'exists');
  if (goalType.includes('Either')) suggestions.push('left', 'right');
  if (goalType.includes('= Nat') || goalType.includes('Nat')) suggestions.push('elimNat', 'exact');
  if (goalType.includes('= ')) suggestions.push('symm', 'cong');
  suggestions.push('exact');
  return [...new Set(suggestions)].slice(0, 5);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return 'Unknown error'; }
}

// ── AI Overview Section ───────────────────────────────────────────────────────

function AIOverview({ goalNode }: { goalNode: GoalNode }) {
  const apiKey = useHintStore((s) => s.apiKey);
  const sourceCode = useMetadataStore((s) => s.sourceCode);
  const claimName = useMetadataStore((s) => s.claimName);
  const setLoading = useGoalDescriptionStore((s) => s.setLoading);
  const setDescription = useGoalDescriptionStore((s) => s.setDescription);
  const setError = useGoalDescriptionStore((s) => s.setError);
  const rawEntry = useGoalDescriptionStore((s) => s.descriptions.get(goalNode.id));

  const signature = useMemo(() => {
    if (!sourceCode || !claimName) return null;
    const ctxKey = goalNode.data.context.map(e => `${e.name}:${e.type}`).join(',');
    return `${claimName}\x00${goalNode.data.goalType}\x00${ctxKey}\x00${sourceCode}`;
  }, [goalNode.data.context, goalNode.data.goalType, sourceCode, claimName]);

  const entry = rawEntry?.signature === signature ? rawEntry : undefined;

  const fetch = useCallback(async () => {
    if (!apiKey || !sourceCode || !claimName || !signature) return;
    setLoading(goalNode.id, signature);
    try {
      const text = await describeGoalBrowser(
        {
          pieCode: sourceCode,
          claimName,
          goalType: goalNode.data.goalType,
          context: goalNode.data.context.map(e => ({ name: e.name, type: e.type })),
        },
        apiKey,
      );
      setDescription(goalNode.id, signature, text);
    } catch (e) {
      setError(goalNode.id, signature, getErrorMessage(e));
    }
  }, [apiKey, sourceCode, claimName, signature, goalNode.id, goalNode.data, setLoading, setDescription, setError]);

  // Auto-fetch on first open
  useEffect(() => {
    if (apiKey && sourceCode && claimName && signature && !entry) {
      fetch();
    }
  }, [apiKey, sourceCode, claimName, signature, entry, fetch]);

  return (
    <div className="pe-d-section">
      <div className="pe-d-section-hd">
        <span className="pe-d-section-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--pe-accent)', flexShrink: 0 }}>
            <path d="M6 1l1.2 2.8L10 5 7.2 6.2 6 9l-1.2-2.8L2 5l2.8-1.2z" fill="currentColor" />
          </svg>
          AI Overview
        </span>
        {apiKey && (
          <button
            onClick={fetch}
            disabled={entry?.isLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 10.5, padding: '1px 7px', borderRadius: 4,
              background: 'color-mix(in oklab, var(--pe-accent) 10%, white)',
              color: 'var(--pe-accent)',
              border: '1px solid color-mix(in oklab, var(--pe-accent) 22%, white)',
              cursor: entry?.isLoading ? 'not-allowed' : 'pointer',
              opacity: entry?.isLoading ? 0.6 : 1,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              style={entry?.isLoading ? { animation: 'spin 0.8s linear infinite' } : undefined}>
              <path d="M5 1.5A3.5 3.5 0 1 1 1.5 5" />
              <path d="M1.5 1.5v3h3" />
            </svg>
            {entry?.isLoading ? 'Generating…' : 'Refresh'}
          </button>
        )}
      </div>

      {!apiKey ? (
        <p style={{ fontSize: 11.5, color: 'var(--pe-faint)', fontStyle: 'italic' }}>
          Configure a Gemini API key in AI Settings (⚙ top-right) to enable goal descriptions.
        </p>
      ) : !sourceCode || !claimName ? (
        <p style={{ fontSize: 11.5, color: 'var(--pe-faint)', fontStyle: 'italic' }}>
          Start a proof session to generate a description.
        </p>
      ) : entry?.isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--pe-accent)' }}>
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
            <path d="M5 1.5A3.5 3.5 0 1 1 1.5 5" /><path d="M1.5 1.5v3h3" />
          </svg>
          Generating description…
        </div>
      ) : entry?.error ? (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px', borderRadius: 5,
          background: 'color-mix(in oklab, var(--pe-err) 8%, white)',
          border: '1px solid color-mix(in oklab, var(--pe-err) 22%, white)',
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--pe-err)" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="6" cy="6" r="5" /><path d="M6 4v3M6 8.5v.5" />
          </svg>
          <span style={{ fontSize: 11.5, color: 'var(--pe-err)', lineHeight: 1.4 }}>
            {entry.error.length > 120 ? entry.error.slice(0, 120) + '…' : entry.error}
          </span>
        </div>
      ) : entry?.text ? (
        <p style={{ fontSize: 12, color: 'var(--pe-ink-2)', lineHeight: 1.55 }}>
          {entry.text}
        </p>
      ) : (
        <p style={{ fontSize: 11.5, color: 'var(--pe-faint)', fontStyle: 'italic' }}>Fetching…</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function DetailPanel({ definitions = [], theorems = [] }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [selectedDef, setSelectedDef] = useState<string | null>(null);

  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const selectNode = useUIStore((s) => s.selectNode);
  const nodes = useProofStore((s) => s.nodes);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const goalNode = selectedNode?.type === 'goal' ? (selectedNode as GoalNode) : null;

  const suggestions = goalNode ? getSuggestedTactics(goalNode.data.goalType) : [];

  const appliedTactics = (nodes.filter(
    (n) => n.type === 'tactic' && (n.data as TacticNode['data']).status === 'applied'
  ) as TacticNode[]).sort((a, b) => (a.data.appliedAt ?? 0) - (b.data.appliedAt ?? 0));

  const goalMap = new Map(
    nodes.filter((n) => n.type === 'goal').map((n) => [n.id, n as GoalNode])
  );

  const hasContent = selectedNode || definitions.length > 0 || theorems.length > 0;

  return (
    <>
      {/* Tabs */}
      <div className="pe-detail-tabs">
        {(['details', 'context', 'history'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`pe-detail-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'history' && appliedTactics.length > 0 && (
              <span style={{
                marginLeft: 4, fontSize: 9.5, padding: '0px 4px', borderRadius: 99,
                background: activeTab === 'history' ? 'var(--pe-accent)' : 'var(--pe-line)',
                color: activeTab === 'history' ? '#fff' : 'var(--pe-ink-2)',
                fontWeight: 600, verticalAlign: 'middle',
              }}>
                {appliedTactics.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pe-detail-body">

        {/* ── DETAILS TAB ── */}
        {activeTab === 'details' && (
          <>
            {selectedNode ? (
              <div className="pe-d-section" style={{ paddingBottom: 10 }}>
                <div className="pe-d-section-hd">
                  <span className="pe-d-section-label">
                    {selectedNode.type === 'goal'
                      ? `Goal${goalNode?.data.status ? ` · ${goalNode.data.status}` : ''}`
                      : selectedNode.type === 'tactic' ? 'Tactic' : selectedNode.type}
                  </span>
                  <button
                    onClick={() => selectNode(null)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--pe-faint)', padding: 2, borderRadius: 3 }}
                    title="Deselect"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M2 2l6 6M8 2L2 8" />
                    </svg>
                  </button>
                </div>

                {goalNode && (
                  <>
                    <div className="pe-big-type">{goalNode.data.goalType}</div>
                    <div className="pe-meta">
                      <span><b>ctx</b> {goalNode.data.context.length} var{goalNode.data.context.length !== 1 ? 's' : ''}</span>
                      {goalNode.data.parentGoalId && (
                        <span style={{ cursor: 'pointer', color: 'var(--pe-accent)' }}
                          onClick={() => goalNode.data.parentGoalId && selectNode(goalNode.data.parentGoalId)}>
                          ↑ parent
                        </span>
                      )}
                    </div>
                  </>
                )}

                {selectedNode.type === 'tactic' && (
                  <div style={{ fontFamily: 'var(--pe-mono-font)', fontSize: 13, fontWeight: 600, color: 'var(--pe-ink)', marginTop: 4 }}>
                    {(selectedNode.data as { displayName?: string }).displayName ?? 'tactic'}
                  </div>
                )}
              </div>
            ) : !hasContent && (
              <div className="pe-d-section" style={{ color: 'var(--pe-faint)', fontSize: 12 }}>
                Click a node to see details
              </div>
            )}

            {/* AI Overview — only when a goal is selected */}
            {goalNode && <AIOverview goalNode={goalNode} />}

            {/* Suggested tactics */}
            {goalNode && suggestions.length > 0 && (
              <div className="pe-d-section">
                <div className="pe-d-section-hd">
                  <span className="pe-d-section-label">Suggested tactics</span>
                </div>
                <div className="pe-suggested">
                  {suggestions.map((name) => {
                    const info = TACTICS.find(t => t.type === name);
                    const needsCtx = info?.requiresContextVar;
                    return (
                      <button
                        key={name}
                        className="pe-chip"
                        title={needsCtx ? `${info?.description ?? name} · drag from palette to connect context` : (info?.description ?? name)}
                        style={{ cursor: needsCtx ? 'help' : 'pointer', border: 'none', opacity: needsCtx ? 0.6 : 1 }}
                        onClick={() => {
                          if (needsCtx) return;
                          applyTactic(goalNode.id, name as Parameters<typeof applyTactic>[1], {});
                        }}
                      >
                        {name}
                        {needsCtx && <span style={{ marginLeft: 3, fontSize: 9, color: 'var(--pe-faint)' }}>ctx</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--pe-faint)', marginTop: 4 }}>
                  Click to apply · <span style={{ opacity: 0.7 }}>ctx</span> tactics need a context variable — drag from palette
                </div>
              </div>
            )}

            {/* Definitions */}
            {definitions.length > 0 && (
              <div className="pe-d-section">
                <div className="pe-d-section-hd">
                  <span className="pe-d-section-label">Definitions</span>
                  <span className="pe-d-section-count">{definitions.length}</span>
                </div>
                {definitions.map((def) => (
                  <ContextItem key={def.name} entry={def} kind="def"
                    isSelected={selectedDef === def.name}
                    onClick={() => setSelectedDef(selectedDef === def.name ? null : def.name)} />
                ))}
              </div>
            )}

            {/* Theorems & claims */}
            {theorems.length > 0 && (
              <div className="pe-d-section">
                <div className="pe-d-section-hd">
                  <span className="pe-d-section-label">Theorems &amp; claims</span>
                  <span className="pe-d-section-count">{theorems.length}</span>
                </div>
                {theorems.map((thm) => (
                  <ContextItem key={thm.name} entry={thm} kind={thm.kind === 'claim' ? 'claim' : 'thm'}
                    isSelected={selectedDef === thm.name}
                    onClick={() => setSelectedDef(selectedDef === thm.name ? null : thm.name)} />
                ))}
              </div>
            )}

            {!selectedNode && definitions.length === 0 && theorems.length === 0 && (
              <div className="pe-d-section" style={{ color: 'var(--pe-faint)', fontSize: 12 }}>
                No definitions yet · start a proof session to see context
              </div>
            )}
          </>
        )}

        {/* ── CONTEXT TAB ── */}
        {activeTab === 'context' && (
          <>
            {goalNode ? (
              <div className="pe-d-section">
                <div className="pe-d-section-hd">
                  <span className="pe-d-section-label">Local context</span>
                  <span className="pe-d-section-count">{goalNode.data.context.length}</span>
                </div>
                {goalNode.data.context.length === 0 ? (
                  <div style={{ color: 'var(--pe-faint)', fontSize: 12, fontStyle: 'italic' }}>No bindings in scope</div>
                ) : (
                  goalNode.data.context.map((entry) => (
                    <div key={entry.id} className="pe-ctx-row">
                      <span>
                        <span className="pe-ctx-var">{entry.name}</span>
                        <span className="pe-ctx-type"> : {entry.type}</span>
                      </span>
                      {entry.origin === 'introduced' && (
                        <span style={{
                          fontSize: 9.5, padding: '1px 5px', borderRadius: 99,
                          background: 'color-mix(in oklab, var(--pe-accent) 10%, white)',
                          color: 'var(--pe-accent)',
                          border: '1px solid color-mix(in oklab, var(--pe-accent) 22%, white)',
                          fontFamily: 'var(--pe-mono-font)',
                        }}>intro</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="pe-d-section" style={{ color: 'var(--pe-faint)', fontSize: 12 }}>
                Select a goal node to see its local context
              </div>
            )}
          </>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'history' && (
          <>
            {appliedTactics.length === 0 ? (
              <div className="pe-d-section" style={{ color: 'var(--pe-faint)', fontSize: 12 }}>
                No tactics applied yet · apply a tactic to see proof history
              </div>
            ) : (
              <div className="pe-d-section">
                <div className="pe-d-section-hd">
                  <span className="pe-d-section-label">Applied tactics</span>
                  <span className="pe-d-section-count">{appliedTactics.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {appliedTactics.map((tactic, idx) => {
                    const parentGoal = tactic.data.connectedGoalId ? goalMap.get(tactic.data.connectedGoalId) : undefined;
                    const goalType = parentGoal?.data.goalType ?? '';
                    const truncatedGoal = goalType.length > 32 ? goalType.slice(0, 32) + '…' : goalType;
                    return (
                      <div key={tactic.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0',
                        borderBottom: idx < appliedTactics.length - 1 ? '1px solid var(--pe-line-2)' : 'none',
                      }}>
                        <span style={{
                          flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                          background: 'var(--pe-ok)', color: '#fff', fontSize: 9.5, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                        }}>{idx + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontFamily: 'var(--pe-mono-font)', fontSize: 12.5, fontWeight: 600, color: 'var(--pe-ink)' }}>
                              {tactic.data.displayName}
                            </span>
                            <button onClick={() => selectNode(tactic.id)} style={{
                              fontSize: 10, color: 'var(--pe-accent)', background: 'none', border: 'none',
                              cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted',
                            }}>select</button>
                          </div>
                          {truncatedGoal && (
                            <div style={{ fontFamily: 'var(--pe-mono-font)', fontSize: 10.5, color: 'var(--pe-faint)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {truncatedGoal}
                            </div>
                          )}
                          {tactic.data.appliedAt && (
                            <div style={{ fontSize: 10, color: 'var(--pe-faint)', marginTop: 1 }}>
                              {formatTime(tactic.data.appliedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </>
  );
}

function ContextItem({ entry, kind, isSelected, onClick }: {
  entry: GlobalEntry; kind: 'def' | 'thm' | 'claim'; isSelected: boolean; onClick: () => void;
}) {
  return (
    <div className={`pe-d-row${isSelected ? ' active' : ''}`} onClick={onClick}>
      <span className={`pe-kindtag ${kind}`}>{kind}</span>
      <span className="pe-d-name">{entry.name}</span>
      <span className="pe-d-type" title={entry.type}>{entry.type}</span>
    </div>
  );
}
