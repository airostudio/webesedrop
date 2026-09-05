This engine has no static frontend — this directory exists only because Vercel's zero-config
"Other" framework detection expects a static Output Directory to exist post-build, and this
project's `package.json` has a `build` script (for the non-Vercel/local `tsc` compile, see the
root README) that would otherwise make Vercel look for one. See `vercel.json`'s
`outputDirectory`/`buildCommand` and `api/index.ts` for how requests are actually served.
