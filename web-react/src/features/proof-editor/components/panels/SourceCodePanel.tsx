import { useState, useCallback, useEffect, useRef } from 'react';
import Editor, { type OnMount, type BeforeMount, type Monaco } from '@monaco-editor/react';
import { useProofSession } from '../../hooks/useProofSession';
import { useExampleStore } from '../../store/example-store';
import { diagnosticsWorker } from '@/shared/lib/worker-client';

const SEVERITY_MAP = { error: 8, warning: 4, info: 2, hint: 1 } as const;

const SAMPLE_SOURCE = `; Define addition function
(claim + (-> Nat Nat Nat))
(define +
  (lambda (n m)
    (rec-Nat n
      m
      (lambda (n-1 +n-1)
        (add1 +n-1)))))

; Prove that n = n for all Nat
(claim reflexivity
  (Pi ((n Nat))
    (= Nat n n)))
`;

const PIE_GUARD = '__pieLanguageRegistered' as const;

// Map from our kind strings to Monaco completion item kinds
const KIND_MAP = {
  keyword: 14,   // monaco.languages.CompletionItemKind.Keyword
  type: 6,       // Struct (visual approximation for type)
  function: 2,   // Function
  variable: 5,   // Variable
} as const;

interface CompletionEntry {
  label: string;
  kind: keyof typeof KIND_MAP;
  detail?: string;
  insertText?: string; // snippet syntax with ${1:placeholder}
}

const PIE_COMPLETIONS: CompletionEntry[] = [
  { label: 'claim',            kind: 'keyword',   detail: 'Declare a claim',                   insertText: '(claim ${1:name} ${2:type})' },
  { label: 'define',           kind: 'keyword',   detail: 'Define a value',                    insertText: '(define ${1:name} ${2:expr})' },
  { label: 'define-tactically',kind: 'keyword',   detail: 'Prove a claim with tactics',        insertText: '(define-tactically ${1:name}\n  (${2:tactics}))' },
  { label: 'lambda',           kind: 'keyword',   detail: 'Lambda expression',                 insertText: '(lambda (${1:x}) ${2:body})' },
  { label: 'the',              kind: 'keyword',   detail: 'Type annotation',                   insertText: '(the ${1:type} ${2:expr})' },
  { label: 'Pi',               kind: 'type',      detail: 'Dependent function type',           insertText: '(Pi ((${1:x} ${2:A}))\n  ${3:B})' },
  { label: 'Sigma',            kind: 'type',      detail: 'Dependent pair type',               insertText: '(Sigma ((${1:x} ${2:A}))\n  ${3:B})' },
  { label: 'Pair',             kind: 'type',      detail: 'Pair type',                         insertText: '(Pair ${1:A} ${2:B})' },
  { label: 'Either',           kind: 'type',      detail: 'Either type',                       insertText: '(Either ${1:L} ${2:R})' },
  { label: 'List',             kind: 'type',      detail: 'List type',                         insertText: '(List ${1:E})' },
  { label: 'Vec',              kind: 'type',      detail: 'Vector type',                       insertText: '(Vec ${1:E} ${2:n})' },
  { label: '=',                kind: 'type',      detail: 'Equality type',                     insertText: '(= ${1:A} ${2:from} ${3:to})' },
  { label: '->',               kind: 'type',      detail: 'Function type',                     insertText: '(-> ${1:A} ${2:B})' },
  { label: 'Nat',              kind: 'type',      detail: 'Natural numbers' },
  { label: 'Atom',             kind: 'type',      detail: 'Atoms' },
  { label: 'Trivial',          kind: 'type',      detail: 'The trivial type' },
  { label: 'Absurd',           kind: 'type',      detail: 'The empty type' },
  { label: 'U',                kind: 'type',      detail: 'Universe of types' },
  { label: 'zero',             kind: 'variable',  detail: 'Zero' },
  { label: 'add1',             kind: 'function',  detail: 'Successor',                         insertText: '(add1 ${1:n})' },
  { label: 'same',             kind: 'function',  detail: 'Reflexivity proof',                 insertText: '(same ${1:expr})' },
  { label: 'sole',             kind: 'variable',  detail: 'Trivial inhabitant' },
  { label: 'nil',              kind: 'variable',  detail: 'Empty list' },
  { label: '::',               kind: 'function',  detail: 'List cons',                         insertText: '(:: ${1:head} ${2:tail})' },
  { label: 'cons',             kind: 'function',  detail: 'Pair constructor',                  insertText: '(cons ${1:car} ${2:cdr})' },
  { label: 'car',              kind: 'function',  detail: 'Pair first projection',             insertText: '(car ${1:pair})' },
  { label: 'cdr',              kind: 'function',  detail: 'Pair second projection',            insertText: '(cdr ${1:pair})' },
  { label: 'left',             kind: 'function',  detail: 'Either left injection',             insertText: '(left ${1:value})' },
  { label: 'right',            kind: 'function',  detail: 'Either right injection',            insertText: '(right ${1:value})' },
  { label: 'rec-Nat',          kind: 'function',  detail: 'Nat recursor',                      insertText: '(rec-Nat ${1:n} ${2:base} ${3:step})' },
  { label: 'ind-Nat',          kind: 'function',  detail: 'Nat induction',                    insertText: '(ind-Nat ${1:n} ${2:mot} ${3:base} ${4:step})' },
  { label: 'ind-List',         kind: 'function',  detail: 'List induction',                   insertText: '(ind-List ${1:xs} ${2:mot} ${3:base} ${4:step})' },
  { label: 'ind-Vec',          kind: 'function',  detail: 'Vec induction',                    insertText: '(ind-Vec ${1:xs} ${2:mot} ${3:base} ${4:step})' },
  { label: 'ind-Either',       kind: 'function',  detail: 'Either induction',                 insertText: '(ind-Either ${1:e} ${2:mot} ${3:l} ${4:r})' },
  { label: 'ind-Absurd',       kind: 'function',  detail: 'Absurd induction',                 insertText: '(ind-Absurd ${1:a} ${2:mot})' },
  { label: 'replace',          kind: 'function',  detail: 'Equality substitution',            insertText: '(replace ${1:eq} ${2:mot} ${3:base})' },
  { label: 'symm',             kind: 'function',  detail: 'Symmetry of equality',             insertText: '(symm ${1:eq})' },
  { label: 'cong',             kind: 'function',  detail: 'Congruence',                       insertText: '(cong ${1:eq} ${2:f})' },
  { label: 'trans',            kind: 'function',  detail: 'Transitivity',                     insertText: '(trans ${1:p} ${2:q})' },
  { label: 'intro',            kind: 'function',  detail: 'Introduce a variable',             insertText: '(intro ${1:name})' },
  { label: 'exact',            kind: 'function',  detail: 'Provide exact proof term',         insertText: '(exact ${1:expr})' },
  { label: 'exists',           kind: 'function',  detail: 'Provide Sigma witness',            insertText: '(exists ${1:witness})' },
  { label: 'elim-Nat',         kind: 'function',  detail: 'Eliminate Nat by induction',       insertText: '(elim-Nat ${1:n})' },
  { label: 'elim-List',        kind: 'function',  detail: 'Eliminate List',                   insertText: '(elim-List ${1:xs})' },
  { label: 'elim-Vec',         kind: 'function',  detail: 'Eliminate Vec',                    insertText: '(elim-Vec ${1:xs})' },
  { label: 'elim-Either',      kind: 'function',  detail: 'Eliminate Either',                 insertText: '(elim-Either ${1:e})' },
  { label: 'elim-Equal',       kind: 'function',  detail: 'Eliminate equality',               insertText: '(elim-Equal ${1:eq})' },
  { label: 'elim-Absurd',      kind: 'function',  detail: 'Eliminate Absurd',                 insertText: '(elim-Absurd ${1:x})' },
  { label: 'apply',            kind: 'function',  detail: 'Apply a theorem or function',      insertText: '(apply ${1:expr})' },
  { label: 'then',             kind: 'keyword',   detail: 'Branch tactic block',              insertText: '(then\n  ${1:tactic})' },
];

// Extract user-defined names from document text (claim/define declarations).
// Returns live completions that update as the user types.
function extractUserSymbols(source: string): CompletionEntry[] {
  const items: CompletionEntry[] = [];
  const seen = new Set<string>();
  const add = (label: string, kind: CompletionEntry['kind'], detail: string) => {
    if (label && !seen.has(label)) {
      seen.add(label);
      items.push({ label, kind, detail });
    }
  };
  for (const m of source.matchAll(/\(\s*claim\s+([^\s()]+)/g))  add(m[1], 'type',     'User claim');
  for (const m of source.matchAll(/\(\s*define\s+([^\s()]+)/g)) add(m[1], 'function', 'User definition');
  return items;
}

function registerPieLanguage(monaco: Monaco) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((monaco as any)[PIE_GUARD]) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (monaco as any)[PIE_GUARD] = true;

  monaco.languages.register({ id: 'pie' });

  // Word pattern: Pie identifiers can contain hyphens, ?, !, +, etc.
  monaco.languages.setLanguageConfiguration('pie', {
    comments: { lineComment: ';' },
    brackets: [['(', ')'], ['[', ']']],
    wordPattern: /[^\s()\[\]";]+/,
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('pie', {
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string'],
        [/\d+/, 'number'],
        [
          /\b(claim|define|define-tactically|lambda|Pi|Sigma|the|rec-Nat|ind-Nat|ind-List|ind-Vec|ind-Either|ind-Absurd|replace|symm|cong|trans|data)\b/,
          'keyword',
        ],
        [/\b(Nat|Atom|Trivial|Absurd|U|Pair|Either|List|Vec|->)\b/, 'type'],
        [/\b(zero|add1|same|sole|nil|vecnil|cons|car|cdr|left|right)\b/, 'variable'],
        [
          /\b(intro|exact|split|exists|go-Left|go-Right|elim-Nat|elim-List|elim-Vec|elim-Either|elim-Equal|elim-Absurd|apply|then)\b/,
          'string',
        ],
        [/[()[\]]/, 'delimiter'],
        [/[^\s()\[\]";]+/, 'identifier'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  });

  monaco.editor.defineTheme('pie-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword',  foreground: 'C586C0', fontStyle: 'bold' },
      { token: 'type',     foreground: '4EC9B0' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'string',   foreground: 'CE9178' },
      { token: 'number',   foreground: 'B5CEA8' },
      { token: 'comment',  foreground: '6A9955', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'D4D4D4' },
      { token: 'delimiter',  foreground: 'FFD700' },
    ],
    colors: {},
  });

  // Completion provider: language keywords (static) + user-defined symbols (live from document)
  monaco.languages.registerCompletionItemProvider('pie', {
    triggerCharacters: ['('],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const source = model.getValue();
      const userSymbols = extractUserSymbols(source);

      // Merge: user symbols override built-ins with same label
      const seen = new Set<string>();
      const merged: CompletionEntry[] = [];
      for (const item of [...userSymbols, ...PIE_COMPLETIONS]) {
        if (!seen.has(item.label)) { seen.add(item.label); merged.push(item); }
      }

      const prefix = word.word.toLowerCase();
      const isSnippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

      return {
        suggestions: merged
          .filter(item => !prefix || item.label.toLowerCase().startsWith(prefix))
          .map(item => ({
            label: item.label,
            kind: KIND_MAP[item.kind],
            detail: item.detail,
            insertText: item.insertText ?? item.label,
            insertTextRules: item.insertText?.includes('${') ? isSnippet : undefined,
            range,
          })),
      };
    },
  });
}

interface SourceCodePanelProps {
  onCollapse?: () => void;
}

export function SourceCodePanel({ onCollapse }: SourceCodePanelProps) {
  const [sourceCode, setSourceCode] = useState(SAMPLE_SOURCE);
  const [claimName, setClaimName] = useState('reflexivity');
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const exampleSource = useExampleStore((s) => s.exampleSource);
  const exampleClaim = useExampleStore((s) => s.exampleClaim);

  useEffect(() => {
    if (exampleSource !== undefined) setSourceCode(exampleSource);
  }, [exampleSource]);

  useEffect(() => {
    if (exampleClaim !== undefined) setClaimName(exampleClaim);
  }, [exampleClaim]);

  const {
    startSession,
    isLoading,
    error,
    clearError,
    hasActiveSession,
    claimType,
  } = useProofSession();

  const handleStartProof = useCallback(async () => {
    if (!sourceCode.trim() || !claimName.trim()) return;
    clearError();
    try {
      await startSession(sourceCode, claimName);
      onCollapse?.();
    } catch (e) {
      console.error('Failed to start proof:', e);
    }
  }, [sourceCode, claimName, startSession, clearError, onCollapse]);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerPieLanguage(monaco);
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.setTheme('pie-dark');
    // Run diagnostics immediately on mount so initial errors show at once
    const model = editor.getModel();
    if (model) {
      diagnosticsWorker.checkSource(editor.getValue()).then((result) => {
        monaco.editor.setModelMarkers(model, 'pie', result.diagnostics.map((d) => ({
          severity: SEVERITY_MAP[d.severity] ?? 8,
          message: d.message,
          startLineNumber: d.range.startLine,
          startColumn: d.range.startColumn,
          endLineNumber: d.range.endLine,
          endColumn: d.range.endColumn,
          source: d.source,
        })));
      }).catch(() => { /* worker not ready — first edit will trigger */ });
    }
  }, []);

  // Debounced diagnostics: re-run typechecker 600ms after user stops typing
  useEffect(() => {
    const timer = setTimeout(async () => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (!monaco || !editor) return;
      const model = editor.getModel();
      if (!model) return;
      try {
        const result = await diagnosticsWorker.checkSource(sourceCode);
        monaco.editor.setModelMarkers(model, 'pie', result.diagnostics.map((d) => ({
          severity: SEVERITY_MAP[d.severity] ?? 8,
          message: d.message,
          startLineNumber: d.range.startLine,
          startColumn: d.range.startColumn,
          endLineNumber: d.range.endLine,
          endColumn: d.range.endColumn,
          source: d.source,
        })));
      } catch {
        // worker error — ignore, don't clear existing markers
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [sourceCode]);

  const syncBadgeClass = isLoading
    ? 'pe-sync-badge syncing'
    : hasActiveSession
      ? 'pe-sync-badge'
      : error
        ? 'pe-sync-badge error'
        : 'pe-sync-badge';

  const syncLabel = isLoading ? 'Syncing…' : hasActiveSession ? 'Active' : error ? 'Error' : 'Ready';

  return (
    <>
      {/* Panel head */}
      <div className="pe-panel-head">
        {onCollapse && (
          <button
            className="pe-icon-btn"
            onClick={onCollapse}
            title="Collapse source panel"
            aria-label="Collapse source panel"
            style={{ marginLeft: -4, marginRight: 0, flexShrink: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M9 3L6 7l3 4" />
            </svg>
          </button>
        )}
        <h3>Source</h3>
        <span className={syncBadgeClass}>
          <span className="dot" />
          {syncLabel}
        </span>
        <div style={{ flex: 1 }} />
      </div>

      {/* Claim bar */}
      <div className="pe-source-claim">
        <label>Claim</label>
        <input
          className="pe-input"
          value={claimName}
          onChange={(e) => setClaimName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleStartProof()}
          placeholder="e.g., +zero-identity"
          disabled={isLoading}
        />
        <button
          className="pe-btn"
          onClick={handleStartProof}
          disabled={isLoading || !sourceCode.trim() || !claimName.trim()}
          title={hasActiveSession ? 'Restart proof session' : 'Start proof session'}
        >
          {isLoading ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              Starting…
            </span>
          ) : hasActiveSession ? 'Restart' : 'Start Proof'}
        </button>
      </div>

      {/* Monaco editor — fills remaining height */}
      <div className="pe-editor-frame">
        <Editor
          height="100%"
          language="pie"
          value={sourceCode}
          onChange={(v) => { if (v !== undefined) setSourceCode(v); }}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12.5,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            readOnly: isLoading,
            padding: { top: 12 },
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            overviewRulerLanes: 0,
            folding: false,
            lineDecorationsWidth: 0,
            // Fix space-swallowing: disable word-based suggestions and commit-on-char
            wordBasedSuggestions: 'off',
            acceptSuggestionOnCommitCharacter: false,
            acceptSuggestionOnEnter: 'smart',
            quickSuggestions: { strings: false, comments: false, other: true },
          }}
        />
      </div>

      {/* Diagnostics / status strip */}
      <div className="pe-diag-strip">
        {error ? (
          <>
            <div className="pe-diag-head">
              <div className="title">
                <span style={{ color: 'var(--pe-err)' }}>Error</span>
              </div>
              <button
                style={{ fontSize: 10.5, color: 'var(--pe-err)', cursor: 'pointer', border: 'none', background: 'none', padding: '2px 4px' }}
                onClick={clearError}
              >
                Dismiss
              </button>
            </div>
            <ul className="pe-diag-list">
              <li className="pe-diag-row err">
                <span className="sev" />
                <span className="loc">proof</span>
                <span className="msg">{error}</span>
              </li>
            </ul>
          </>
        ) : hasActiveSession ? (
          <>
            <div className="pe-diag-head">
              <div className="title">
                <span style={{ color: 'var(--pe-ok)' }}>Active</span>
                <span>·</span>
                <span>{claimName}</span>
              </div>
            </div>
            <div className="pe-diag-ok">
              <span className="dot" />
              {claimType
                ? <>Session active · <span style={{ fontFamily: 'var(--pe-mono-font)', fontSize: 11 }}>{claimType.length > 50 ? claimType.slice(0, 50) + '…' : claimType}</span></>
                : 'Proof session active · canvas is live'
              }
            </div>
          </>
        ) : (
          <div className="pe-diag-ok" style={{ color: 'var(--pe-faint)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--pe-faint)', flexShrink: 0 }} />
            No active session · enter source code and start proof
          </div>
        )}
      </div>
    </>
  );
}
