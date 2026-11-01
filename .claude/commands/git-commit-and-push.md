---
name: git-commit-and-push
description: >-
  Stage, commit, and push changes as cherry-pickable atomic commits. Groups
  related changes into separate commits with conventional-commit messages,
  then pushes to the origin remote.
---

Stage, commit, and push changes as cherry-pickable atomic commits.

$ARGUMENTS

## Goal

Produce one or more atomic git commits — each self-contained and independently
cherry-pickable — then push them to `origin`.

## Steps

### 1. Inspect current state

Run these in parallel:

- `git status` — list modified, untracked, and staged files.
- `git diff` — see unstaged changes.
- `git diff --cached` — see already-staged changes.
- `git log --oneline -10` — understand recent commit style on this branch.
- `git remote get-url origin` — confirm origin exists.

If there are **no changes at all**, stop and inform the user.

### 2. Plan atomic commits

Group changes into the smallest logical units that:

- Can be reverted without breaking unrelated functionality.
- Make sense as a standalone change when cherry-picked to another branch.
- Share a single `type(scope)` in the conventional-commit scheme.

Typical groupings (in order of precedence):

| Grouping | When to split |
|----------|---------------|
| One commit per feature/fix | Different problem domains (e.g. auth vs. logging) |
| One commit per file type | Config changes separate from source changes |
| One commit for each unrelated refactor | Style/rename commits should not mix with logic changes |
| Bundle tightly coupled changes | Files that only make sense together stay in one commit |

Do **not** split arbitrarily. Two files that always change together belong in
one commit.

### 3. Write commit messages

Use the **Conventional Commits** format:

```
<type>(<scope>): <short imperative summary>

<optional body — explain WHY, not WHAT; wrap at 72 chars>

<optional footer — breaking changes, issue refs>
```

Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`, `perf`, `ci`.

Rules:
- Summary line ≤ 72 characters, imperative mood ("add" not "added").
- Body only when the *why* is non-obvious from the diff.
- No trailing period on the summary line.
- Reference issues/tickets if $ARGUMENTS contains one (e.g. `APP-1234`).

### 4. Stage and commit each group

For each planned commit, in order:

1. Stage only the files belonging to that group:
   `git add <file1> <file2> ...`
   (use `git add -p <file>` mentally — stage only the relevant hunks if a
   single file contains changes belonging to different groups).
2. Commit:
   ```
   git commit -m "$(cat <<'EOF'
   type(scope): summary

   Optional body.
   EOF
   )"
   ```
3. Verify with `git show --stat HEAD`.

Repeat for every group.

### 5. Push to origin

After all commits are made:

```
git push origin HEAD
```

If the branch has no upstream yet, use:

```
git push -u origin HEAD
```

Do **not** force-push unless the user explicitly requested it.

### 6. Report

Print a summary:

- Each commit: hash (short), type, and summary line.
- The remote URL and branch that was pushed to.
- Any caveats (e.g. "branch had no upstream, set it now").
