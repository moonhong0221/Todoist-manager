---
name: commit-push
description: Stage all changes, commit with a message the user provides, and push to the current branch's remote. Use when the user runs /commit-push, or asks to "커밋하고 푸시해줘" / "commit and push this" with a description of the change already in hand.
---

# commit-push

Runs the everyday `git add` → `git commit` → `git push` cycle for this repo, using a commit message the user supplies as the skill argument.

## Steps

1. Run `git status` to see what would be staged. If there are files that look like secrets, credentials, or build artifacts that don't belong (e.g. `.env`, `*.db`, `venv/`), stop and ask before staging them, even if `.gitignore` should have caught them.
2. Stage the relevant files. Prefer `git add -A` for this simple workflow, but exclude anything flagged in step 1.
3. Determine the commit message:
   - If the user passed text as the skill argument (e.g. `/commit-push "버그 수정"`), use that verbatim as the commit message.
   - If no argument was given, ask the user for a one-line description before committing — do not invent one.
4. Commit:
   ```
   git commit -m "<user's message>"
   ```
   Append the standard co-author trailer only if this project's other commits already use it; otherwise a plain message is fine.
5. Push to the current branch's tracked remote:
   ```
   git push
   ```
   If the branch has no upstream yet, use `git push -u origin <branch>`.
6. Report the result: what was committed (short summary from `git status`/`git diff --stat`) and confirmation the push succeeded, with the commit hash.

## Guardrails

- Never use `--force`, `--no-verify`, or amend an existing commit — always create a new commit.
- If `git push` is rejected (e.g. remote has new commits), stop and tell the user rather than force-pushing.
- If a pre-commit hook fails, fix the issue, re-stage, and make a new commit — don't bypass the hook.
