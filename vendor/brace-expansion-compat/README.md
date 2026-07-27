# brace-expansion compatibility adapter

This package preserves the callable CommonJS API required by `minimatch`
3, 5, and 9 while delegating all expansion work to the patched
`brace-expansion` 5.0.8 implementation. `minimatch` 10 continues to work
through the adapter's `expand` property.

The repository consumes a content-addressed packed
`vendor/brace-expansion-5.0.8-<hash>.tgz` artifact so npm installs a real
package for transitive overrides and cannot reuse a stale npm-cache entry after
the package changes. A directory `file:` override is not safe here: npm
resolves nested overrides relative to their consumers and can produce broken
links beneath `minimatch/vendor`.

`brace-expansion` 5.0.8 is the first release patched for
GHSA-mh99-v99m-4gvg. It exports `expand` as a named function, while older
`minimatch` majors call the package itself as a CommonJS function.

This adapter delegates all expansion work to the unmodified, registry-pinned
5.0.8 implementation and exposes both API shapes. Remove it after every
upstream consumer has moved to the patched API.
