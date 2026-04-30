# pie-slang

Implementation of Pie, following [The Little Typer](https://mitpress.mit.edu/9780262536431/the-little-typer/)

## Proof Editor (demo branch)

The `demo` branch ships a visual, interactive proof editor built on top of the Pie interpreter. It lets you write Pie theorems, then prove them step-by-step using a tactic-driven canvas — no manual term construction needed.

### Features

**Phase-based workflow** — three distinct modes keep authoring and proving cleanly separated:
- **Authoring** — write your theorem in the Monaco source editor (syntax highlighting, completions, inline error markers). The proof canvas is locked until you click *Start Proof*.
- **Proving** — the editor locks and the canvas becomes live. Drag tactics from the palette onto goal nodes, or click suggested tactic chips in the Details panel. An amber banner with *Edit Source* lets you return to authoring (with a confirmation to avoid accidental resets).
- **Completed** — when all goals are closed, a green banner appears with *Save & Edit* (appends the generated proof script to your source) and *New Proof*.

**Proof canvas** — React Flow–based tree showing the live proof state:
- Goal nodes display the current type to prove and local context
- Tactic nodes connect goals to their sub-goals
- Minimap, zoom controls, and fit-view in the toolbar

**Tactic palette** — categorised tactics (Introduction, Constructors, Elimination, Application) draggable onto any goal node. Context-bound tactics (elimNat, elimList, …) require a context variable connection.

**Detail panel** — three tabs:
- *Details* — selected node info, AI-generated goal description (Gemini API), and one-click suggested tactic chips
- *Context* — local variable bindings in scope for the selected goal
- *History* — proof journal with a progress bar, colour-coded step list (click any row to canvas-select that node), and a live proof script preview that builds up as tactics are applied; one-click Copy when the proof is complete

**Monaco editor** — custom `pie` language with:
- Monarch syntax highlighting (keywords, types, tactics, constructors)
- 50+ built-in completions with snippet support
- Live user-symbol completions (picks up your own `claim`/`define` names)
- Diagnostics (inline error squiggles) via the typechecker worker

### Running the Proof Editor locally

```bash
git clone https://github.com/MarcusMa06-code/pie-slang.git
cd pie-slang
git checkout demo

# Install dependencies (root + web-react)
yarn install
cd web-react && npm install

# Start the dev server
npm run dev
# → http://localhost:5173
```

> **Note:** The Monaco editor package lives at the repo root `node_modules/`. If you run from the `web-react/` directory in isolation, symlink it: `ln -s ../node_modules web-react/node_modules`.

---

## Online Playground (main branch)

The hosted playground is available at [source-academy.github.io/pie-slang](https://source-academy.github.io/pie-slang/). It is still under active development and may be buggy.

## VSCode Extension

A Pie language server is published as the [pie-lsp](https://marketplace.visualstudio.com/items?itemName=DaoxinLi.pie-lsp) VSCode extension.

## Getting Started (interpreter / library)

1. **Clone the repository**

   ```bash
   git clone https://github.com/source-academy/pie-slang.git
   cd pie-slang
   ```

2. **Install dependencies**

   ```bash
   yarn install
   ```

3. **Build**

   ```bash
   yarn build
   ```

4. Compiled output is in `./dist`. Try a simple Pie program on Source Academy or the local web interface:

   ```scheme
   (claim identity (-> Nat Nat))
   (define identity (λ (n) n))
   ```

   For more, see the [wiki](../../wiki) and [The Little Typer](https://mitpress.mit.edu/9780262536431/the-little-typer/).
