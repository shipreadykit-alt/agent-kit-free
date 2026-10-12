---
name: test-integrity
description: "Use after modifying tests or when tests were failing and now pass. Analyzes the diff for test-weakening: .skip/.only, deleted assertions or test files, changed expected values, tautologies, loosened test config, `|| true` in test scripts."
---

# Test integrity

**Why:** agents "make tests pass" by changing the premise: rewriting assertions, skipping tests, or editing the Makefile to run only passing "safe-tests" (anthropics/claude-code#319, #7074).

## Run
```bash
node .claude/agent-kit/bin/test-integrity.mjs             # uncommitted changes vs HEAD
node .claude/agent-kit/bin/test-integrity.mjs --base main # whole branch
```
Exit 1 on any HIGH finding.

## Rules
- A failing test is information. Fix the implementation, or report that the test contradicts the requirement and **ask**.
- Changing an expected value (`toBe(42)` → `toBe(40)`) is only allowed when the user changed the spec. Say so explicitly in your summary.
- Never commit `.only`, `.skip`, `xit`, `@pytest.mark.skip`, `|| true`, `--passWithNoTests` or new `testPathIgnorePatterns`.
- For every finding the tool reports, either revert it or justify it in one sentence to the user.
