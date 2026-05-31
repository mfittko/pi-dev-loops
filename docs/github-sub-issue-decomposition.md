# GitHub sub-issue decomposition pattern

Use this pattern when an umbrella issue, mini-epic, or refinement pass needs a real execution tree.

## Goal

Keep GitHub's real sub-issue tree as the durable ownership and sequencing surface.

That means:
- parent issues hold the durable problem statement, scope, acceptance boundary, and non-goals
- child issues hold the executable bounded slices
- execution order lives in the sub-issue tree, not in a duplicated parent-body checklist
- `dev-loop` remains the only public workflow entrypoint

## When to use a real sub-issue tree

Prefer a sub-issue tree when all of these are true:
- the parent issue is an umbrella, mini-epic, or decomposition container rather than one executable coding task
- there are multiple bounded child slices with real ownership boundaries
- execution order or reprioritization matters
- you want progress roll-up to live in GitHub's structure rather than in body prose

Use plain related-issue references instead when:
- the issue is already one bounded executable task
- the relationship is informative rather than parent/child ownership
- there is no meaningful execution order to maintain

## Parent-body guidance

Once a real sub-issue tree exists, keep the parent issue body lean:
- preserve summary, scope, acceptance criteria, definition of done, and non-goals
- link relevant seed PRs, prior art, or constraints
- do **not** duplicate child sequencing as a long checklist unless there is a separate durable reason
- do **not** use the parent body as the primary progress tracker when GitHub already owns that structure

## Deterministic helper boundary

Use existing `gh issue create` for child issue creation.

Then use `scripts/github/sub-issue-tree.mjs` for tree ownership:

```sh
# inspect current tree
node scripts/github/sub-issue-tree.mjs inspect \
  --repo <owner/name> \
  --issue <parent>

# attach an existing child issue
node scripts/github/sub-issue-tree.mjs add \
  --repo <owner/name> \
  --parent <parent> \
  --child <child>

# move a child before or after a sibling
node scripts/github/sub-issue-tree.mjs reprioritize \
  --repo <owner/name> \
  --parent <parent> \
  --child <child> \
  --before <sibling>

# verify expected exact order
node scripts/github/sub-issue-tree.mjs verify \
  --repo <owner/name> \
  --parent <parent> \
  --expect-children <child-a>,<child-b>,<child-c>
```

This boundary is intentionally thin:
- child creation stays on standard GitHub tooling
- tree linking/order/verification becomes deterministic and testable
- the repo does **not** grow a generic hierarchy SDK or opaque planning automation

## Refinement expectations

When issue refinement produces multiple child slices:
1. keep the parent focused on umbrella framing and boundaries
2. create explicit child issues
3. attach them as real GitHub sub-issues
4. set the intended execution order in the tree
5. verify the resulting tree deterministically

If the work is still just one executable issue, do not force a tree.
