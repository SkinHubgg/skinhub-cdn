#!/usr/bin/env bash
#
# Release @skinhub/cdn to npm.
#
#   bun run release                 # patch bump  (0.1.0 -> 0.1.1)
#   bun run release minor           # 0.1.0 -> 0.2.0
#   bun run release major           # 0.1.0 -> 1.0.0
#   bun run release 0.5.0           # explicit version
#   bun run release patch --no-git  # bump + publish, skip commit/tag
#   bun run release patch --dry-run # do everything except actually publish
#
# Why not `npm version`: it runs an install to sync a lockfile (this repo is bun-managed, there is
# no package-lock.json to sync) and it reformats package.json, so the version bump arrives buried in
# a whitespace diff. We rewrite the one line instead, and fail loudly if the substitution matched
# nothing.
#
# `npm publish` itself is fine — `prepublishOnly` runs typecheck + a clean build, so a package with
# type errors cannot be published even by hand. tsconfig.build.json sets `noEmitOnError`, so a
# failed build produces no dist rather than a stale one.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PKG="$ROOT/package.json"

BUMP="patch"
DO_GIT=1
DRY_RUN=0
for arg in "$@"; do
	case "$arg" in
	--no-git) DO_GIT=0 ;;
	--dry-run) DRY_RUN=1 ;;
	patch | minor | major | [0-9]*) BUMP="$arg" ;;
	*)
		echo "usage: bun run release [patch|minor|major|<version>] [--no-git] [--dry-run]" >&2
		exit 1
		;;
	esac
done

NAME=$(node -p "require('$PKG').name")
CURRENT=$(node -p "require('$PKG').version")
NEXT=$(node -e '
	const [cur, bump] = process.argv.slice(1)
	if (/^\d/.test(bump)) {
		if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(bump)) throw new Error(`not a version: ${bump}`)
		console.log(bump)
	} else {
		const [ma, mi, pa] = cur.split(".").map(Number)
		console.log(bump === "major" ? `${ma + 1}.0.0` : bump === "minor" ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`)
	}
' "$CURRENT" "$BUMP")

echo "==> $NAME  $CURRENT -> $NEXT"

# The tree must be clean before we commit/tag on top of it. Standalone repo, so this is the whole
# repo rather than one workspace directory.
if [ "$DO_GIT" = 1 ] && ! git diff --quiet --ignore-submodules HEAD 2>/dev/null; then
	echo "error: the working tree has uncommitted changes — commit them first (or pass --no-git)" >&2
	exit 1
fi

# Cheap pre-flight: don't build a tarball we can't upload.
if npm view "$NAME" versions --json 2>/dev/null | node -e '
	let s = ""
	process.stdin.on("data", (d) => (s += d)).on("end", () => {
		const v = JSON.parse(s || "[]")
		process.exit((Array.isArray(v) ? v : [v]).includes(process.argv[1]) ? 0 : 1)
	})
' "$NEXT"; then
	echo "error: $NAME@$NEXT is already published — pick a higher version" >&2
	exit 1
fi

# Rewrite only the version line so npm's JSON formatting doesn't land in the diff.
node -e '
	const fs = require("fs")
	const [file, cur, next] = process.argv.slice(1)
	const src = fs.readFileSync(file, "utf8")
	const out = src.replace(new RegExp(`("version"\\s*:\\s*")${cur}(")`), `$1${next}$2`)
	if (out === src) throw new Error(`could not rewrite version ${cur} in ${file}`)
	fs.writeFileSync(file, out)
' "$PKG" "$CURRENT" "$NEXT"

# Put the old version back if typecheck, build or publish fails, so a failed release leaves no
# dangling bump behind.
restore() { node -e '
	const fs = require("fs")
	const [file, next, cur] = process.argv.slice(1)
	fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(new RegExp(`("version"\\s*:\\s*")${next}(")`), `$1${cur}$2`))
' "$PKG" "$NEXT" "$CURRENT"; }
trap 'code=$?; if [ $code -ne 0 ]; then restore; echo "==> release failed, reverted version to $CURRENT" >&2; fi' EXIT

if [ "$DRY_RUN" = 1 ]; then
	npm publish --dry-run # prepublishOnly: typecheck + clean build
	restore
	trap - EXIT
	echo "==> dry run complete, version left at $CURRENT"
	exit 0
fi

npm publish # prepublishOnly: typecheck + clean build

if [ "$DO_GIT" = 1 ]; then
	git add "$PKG"
	git commit -m "v$NEXT"
	git tag "v$NEXT"
	echo "==> committed + tagged v$NEXT (not pushed: git push && git push origin v$NEXT)"
fi

echo "==> published $NAME@$NEXT"
