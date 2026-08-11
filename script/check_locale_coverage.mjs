// Cross-check a set of ERB email templates against the locale file that is supposed to
// feed them.
//
//   node script/check_locale_coverage.mjs <templates-dir> <locale.yml>
//
// Why this is a script and not a reading exercise: a missing i18n key does not raise.
// It renders as empty, the layout survives, and the email looks fine until a customer
// notices a blank where the order number should be. There are hundreds of keys across
// these templates and eyes do not find the one that is absent.
//
// Reports both directions:
//   - keys a template asks for that the locale does not define  (renders blank)
//   - keys the locale defines that nothing asks for             (dead, or a renamed key)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const [dir, localePath] = process.argv.slice(2)
if (!dir || !localePath) {
  console.error('usage: node script/check_locale_coverage.mjs <templates-dir> <locale.yml>')
  process.exit(1)
}

// ── a small YAML reader, enough for a plain nested key/value locale file ─────
// Avoids adding a dependency for something this shape. Handles nesting by
// indentation, quoted and bare scalars, and ignores comments and blank lines.
function flattenYaml(text) {
  const out = new Map()
  const stack = []
  for (const raw of text.split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue
    const indent = raw.match(/^\s*/)[0].length
    const line = raw.trim()
    const m = line.match(/^([^:]+):\s*(.*)$/)
    if (!m) continue
    const [, key, rest] = m
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const path = [...stack.map((s) => s.key), key.trim()]
    if (rest === '' || rest === '|' || rest === '>') {
      stack.push({ indent, key: key.trim() })
    } else {
      out.set(path.join('.'), rest.replace(/^['"]|['"]$/g, ''))
    }
  }
  return out
}

const locale = flattenYaml(readFileSync(localePath, 'utf8'))

// Locale files are nested under en.spree.…; templates address them without that.
const defined = new Set()
for (const k of locale.keys()) {
  defined.add(k.replace(/^en\.spree\./, '').replace(/^en\./, ''))
}

function walk(d) {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const files = walk(dir).filter((f) => f.endsWith('.erb'))
const used = new Map() // key -> Set(file)

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  // Spree.t(:key, scope: [:a, :b])  ->  a.b.key
  for (const m of src.matchAll(/Spree\.t\(\s*:([a-z0-9_]+)\s*,\s*scope:\s*\[([^\]]+)\]/gi)) {
    const scope = m[2].split(',').map((s) => s.trim().replace(/^:/, '')).join('.')
    const key = `${scope}.${m[1]}`
    if (!used.has(key)) used.set(key, new Set())
    used.get(key).add(relative(dir, file))
  }
  // Spree.t('a.b.key')  and  Spree.t(:key)
  for (const m of src.matchAll(/Spree\.t\(\s*['"]([a-z0-9_.]+)['"]/gi)) {
    if (!used.has(m[1])) used.set(m[1], new Set())
    used.get(m[1]).add(relative(dir, file))
  }
}

const missing = [...used.keys()].filter((k) => !defined.has(k)).sort()
const unused = [...defined].filter((k) => !used.has(k)).sort()

console.log(`templates: ${files.length}   keys used: ${used.size}   keys defined: ${defined.size}\n`)

if (missing.length) {
  console.log(`MISSING — asked for by a template, not in the locale. These render EMPTY:\n`)
  for (const k of missing) console.log(`  ${k}\n      ${[...used.get(k)].join('\n      ')}`)
  console.log('')
}

if (unused.length) {
  console.log(`UNUSED — defined but nothing asks for them (${unused.length}):\n`)
  for (const k of unused) console.log(`  ${k}`)
  console.log('')
}

if (!missing.length) console.log('No template asks for a key the locale does not define.')
process.exit(missing.length ? 1 : 0)
