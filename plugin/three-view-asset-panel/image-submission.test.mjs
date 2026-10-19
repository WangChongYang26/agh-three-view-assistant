import test from 'node:test'
import assert from 'node:assert/strict'
import { submissionDimensions, prepareImage, prepareProjectImages, exportProject } from './extensions/main/client/storage.js'
import { buildRequest } from './extensions/main/client/core.js'
import { prepareSubmission, assertSubmissionIdentity } from './extensions/main/client/submission.js'

test('submission dimensions fit 1456 without enlarging or cropping', () => {
  for (const [width, height, expected] of [
    [832, 1504, [805, 1456]], [8000, 4000, [1456, 728]],
    [512, 512, [512, 512]], [1456, 1000, [1456, 1000]], [1, 8000, [1, 1456]],
  ]) {
    const result = submissionDimensions(width, height)
    assert.deepEqual([result.submissionWidth, result.submissionHeight], expected)
    assert.ok(result.submissionWidth <= width && result.submissionHeight <= height)
    assert.ok(Math.abs(result.submissionWidth - Math.max(1, width * Math.min(1, 1456 / Math.max(width, height)))) <= 0.5)
  }
  for (const bad of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => submissionDimensions(bad, 100))
})

test('saved legacy copies are rebuilt and original backup bytes remain intact', async t => {
  const original = new File(['original PNG bytes'], 'reference.png', { type: 'image/png' })
  const fallbackData = 'data:image/png;base64,' + Buffer.from('legacy bytes').toString('base64')
  const draws = []
  const saved = Object.fromEntries(['createImageBitmap','document','FileReader'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis,name)]))
  t.after(() => { for (const [name,descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis,name,descriptor); else delete globalThis[name] } })
  globalThis.createImageBitmap = async () => ({ width: 832, height: 1504, close() {} })
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage(...args) { draws.push(args.slice(1)) } }), toDataURL: () => 'data:image/jpeg;base64,Y29weQ==' }
    return canvas
  } }
  globalThis.FileReader = class {
    readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload() }) }
  }
  const fresh = await prepareImage(original)
  assert.equal(fresh.original, original)
  assert.deepEqual([fresh.width, fresh.height, fresh.submissionWidth, fresh.submissionHeight], [832, 1504, 805, 1456])
  const legacy = { id: 'test', runs: [], views: {
    front: { ...fresh, dataUrl: fallbackData, submissionWidth: 832, submissionHeight: 1504 },
    side: { name: 'side.png', width: 832, height: 1504, dataUrl: fallbackData },
    back: { ...fresh },
  } }
  const prepared = await prepareProjectImages(legacy)
  assert.equal(legacy.views.side.dataUrl, fallbackData)
  assert.equal(prepared.views.front.original, original)
  assert.equal(prepared.views.side.originalDataUrl, fallbackData)
  for (const image of Object.values(prepared.views)) assert.deepEqual([image.submissionWidth, image.submissionHeight], [805, 1456])
  assert.ok(draws.every(args => JSON.stringify(args) === '[0,0,805,1456]'))
  const backup = JSON.parse(await exportProject(prepared))
  assert.equal(backup.project.views.front.originalDataUrl, `data:image/png;base64,${Buffer.from(await original.arrayBuffer()).toString('base64')}`)
  assert.equal(backup.project.views.side.originalDataUrl, fallbackData)
  const blocks = buildRequest(prepared, 'analyze')
  assert.equal(blocks.filter(block => block.type === 'image').length, 3)
  assert.ok(blocks.filter(block => block.type === 'text' && block.text.startsWith('下面这张')).every(block => block.text.includes('原图 832×1504') && block.text.includes('805×1456')))
})

test('asynchronous session/project switches abort preparation before prompting', async () => {
  for (const phase of ['save', 'images', 'persist']) for (const changed of ['session', 'project']) {
    const session = { sessionId: 'clicked' }
    const original = { id: 'asset', views: {} }
    let current = original
    let entered, release
    const started = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const pause = async name => { if (name === phase) { entered(); await gate } }
    let prompted = false
    const pending = (async () => {
      const prepared = await prepareSubmission(session, 'clicked', original, 'analyze', {
        currentProject: () => current,
        waitForSave: () => pause('save'),
        prepareImages: async project => { await pause('images'); return { ...project, normalized: true } },
        persist: async project => { current = project; await pause('persist') },
      })
      assertSubmissionIdentity(session, 'clicked', prepared, () => current)
      prompted = true
    })()
    await started
    if (changed === 'session') session.sessionId = 'later'
    else current = { id: 'other-asset', views: {} }
    release()
    await assert.rejects(pending, changed === 'session' ? /会话已切换/ : /项目已切换或修改/)
    assert.equal(prompted, false, `${phase}/${changed}`)
    if (phase !== 'persist') assert.equal(original.normalized, undefined)
  }
})

test('stable identity permits normalized submission while inspect skips images', async () => {
  const session = { sessionId: 'clicked' }
  const original = { id: 'asset', views: {} }
  let current = original
  const prepared = await prepareSubmission(session, 'clicked', original, 'analyze', {
    currentProject: () => current, waitForSave: async () => {},
    prepareImages: async project => ({ ...project, normalized: true }),
    persist: async project => { current = project },
  })
  assert.equal(prepared.normalized, true)
  assert.equal(current, prepared)
  assertSubmissionIdentity(session, 'clicked', prepared, () => current)
  // Covers the final check after the async helper has returned to Panel.run.
  session.sessionId = 'later'
  assert.throws(() => assertSubmissionIdentity(session, 'clicked', prepared, () => current), /会话已切换/)
  session.sessionId = 'clicked'
  current = { ...prepared }
  assert.throws(() => assertSubmissionIdentity(session, 'clicked', prepared, () => current), /项目已切换或修改/)
  current = prepared
  const inspected = await prepareSubmission(session, 'clicked', prepared, 'inspect', {
    currentProject: () => current, waitForSave: async () => {},
    prepareImages: async () => assert.fail('inspect must not process images'),
    persist: async () => assert.fail('inspect must not persist images'),
  })
  assert.equal(inspected, prepared)
})
