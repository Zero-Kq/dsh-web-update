import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

test('declares an installable dsh bundle', () => {
  assert.equal(typeof manifest.dsh?.bundle?.patch, 'string')
  assert.ok(existsSync(path.join(root, manifest.dsh.bundle.patch)), 'bundle patch file exists')
  assert.equal(manifest.name, 'dsh-web-update')
})

test('every published file exists', () => {
  for (const file of manifest.files) {
    if (file.includes('*')) continue
    assert.ok(existsSync(path.join(root, file)), `missing published file: ${file}`)
  }
  for (const target of Object.values(manifest.exports)) {
    if (typeof target === 'string' && target.startsWith('./') && !target.includes('*')) {
      assert.ok(existsSync(path.join(root, target.replace(/^\.\//u, ''))), `missing export: ${target}`)
    }
  }
})

test('the client module registers under the package name', () => {
  const client = readFileSync(path.join(root, 'client.js'), 'utf8')
  assert.match(client, /__ModuleLoader__\.load\(\{\s*id: 'dsh-web-update'/)
  const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes('name: \'dsh-web-update\''), 'bundle patch names the package')
})

test('plugin metadata is localized', () => {
  for (const locale of ['en', 'zh']) {
    const text = JSON.parse(readFileSync(path.join(root, 'locale', `${locale}.json`), 'utf8'))
    assert.ok(text.meta?.title && text.meta?.description, `locale/${locale}.json has meta title and description`)
  }
})
