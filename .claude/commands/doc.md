---
name: doc
description: >-
  Inserts documentation into the code the user specifies: the file and/or chunk they
  attach or include in context (@file ranges, selections). Produces JSDoc/TSDoc, block
  comments, or short markdown in place when a path is known; otherwise outputs a
  ready-to-paste string. Use when the user invokes /doc, asks to document a selection,
  or wants a doc block for the current snippet without rewriting the implementation.
---

# /doc — Document a portion from context

## Scope

The **portion** is whatever the user supplied in the message: attached selections (`@file` ranges), pasted snippets, or the symbol under discussion. Do not document unrelated files unless the user included them.

## Where documentation goes

1. **File and chunk in context** — When the user references a workspace file (path, `@file`, or included selection with a known path), **apply the documentation inside that file** at the correct position relative to the chunk (typically immediately above the documented symbol, or at the module/feature boundary the user indicated). Use the tools available in the environment to edit the file; do not only output paste text when a concrete target exists.
2. **Chunk-only / no path** — If there is no writable file path (e.g. pasted snippet only), return **one primary document string** the user can paste, per **Output format** below.
3. **Partial context** — If multiple symbols are included, document only what the user asked for; if ambiguous, attach docs to the narrowest enclosing symbol that matches the selection.

## Output format

When writing **into a file**, preserve existing formatting, imports, and comments unrelated to the new docs; insert only the documentation block(s) needed.

When returning **paste-only** text:

- **TypeScript / JavaScript**: Prefer **JSDoc/TSDoc** above the symbol (`/** ... */`). Match project style (e.g. `@param`, `@returns`, `@see`, `@remarks`).
- **Other languages**: Use that language's conventional doc comment (`///`, `#`, `"""`, etc.) or a brief module-level comment if no symbol anchor exists.
- If the user asked for **markdown** (README, API note), output a single fenced or plain markdown block as the deliverable.

For in-file edits, keep the chat summary short (what symbol or region was documented). For paste-only, lead with the paste-ready block, then at most a short line on where to put it.

## Content rules

1. **Describe behavior**, inputs/outputs, side effects, and async or error cases that are visible from the code.
2. **Omit fluff** ("this function does…") where a one-line summary plus tags is enough.
3. **Link specs** when the code implements a protocol or public API (`@see` URL).
4. **Call out intentional hacks** (hardcoded auth, FIXMEs) in `@remarks` or a short note only when present in the code.
5. If the portion is **ambiguous**, document what is actually there and optionally note assumptions in one line.

## Example shape (TypeScript)

```ts
/**
 * One-line summary of what this does.
 *
 * Extra behavior, invariants, or caveats in plain language.
 *
 * @param name - Meaning and constraints.
 * @returns What the caller receives.
 * @see https://example.com/spec#section (when relevant)
 */
```

## Anti-patterns

- Do not replace or refactor the code unless the user asked.
- Do not duplicate large type information that TypeScript already expresses—summarize or point to the type.
- Do not invent behavior not supported by the provided portion.
- Do not skip applying docs to an included file in favor of paste-only output when the path and insertion point are clear from context.
