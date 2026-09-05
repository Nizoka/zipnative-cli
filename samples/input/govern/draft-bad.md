# Feature: faster globbing in `create --include`

The current glob matcher is hand-rolled. We should replace it with a
well-tested library:

    npm install some-lib

and add `some-lib` to the runtime dependencies in package.json.

No reproduction is needed because this is a performance improvement.
