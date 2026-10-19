import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime } from './extensions/main/index.mjs'

const execute = 'mcp_blender_official_2d590ef9_execute_blender_code'
const cli = `${execute}_for_cli`
const payload = (name, text, fields = {}) => ({
  toolUseId: 'synthetic-call', name, args: { code: 'pass' },
  result: { content: [{ type: 'text', text }], ...fields },
  enforcement: { level: 'none', scope: [] },
})

function registeredHandler() {
  const tools = [], skills = [], hooks = new Map()
  runtime.apply({
    skills: { register: skill => skills.push(skill) },
    extension: () => ({
      registerTool: tool => tools.push(tool),
      registerHook: (event, handler) => hooks.set(event, handler),
    }),
  })
  assert.deepEqual(tools.map(tool => tool.name), ['three_view_workspace', 'three_view_read_render'])
  assert.equal(skills.length, 1)
  assert.equal(typeof hooks.get('tool_result'), 'function')
  return hooks.get('tool_result')
}

test('runtime registers a result transform with the six migrated Blender mapping cases', () => {
  const handler = registeredHandler()
  for (const [name, text, failed] of [
    [execute, '{"status":"error","message":"Traceback: SyntaxError"}', true],
    [cli, '{"status":"error","message":"NameError"}', true],
    [execute, '{"status":"ok","result":{"status":"error"}}', false],
    ['mcp_blender_official_2d590ef9_get_objects_summary', '{"status":"error","message":"sample data"}', false],
    ['mcp_other_server_989a7c9a_execute_blender_code', '{"status":"error","message":"sample data"}', false],
    [execute, 'Traceback is documentation, not a JSON result', false],
  ]) {
    const input = payload(name, text, { isError: false })
    const output = handler(input)
    assert.deepEqual(output, failed ? { result: { ...input.result, isError: true } } : {})
    assert.equal(input.result.isError, false)
    if (failed) assert.equal(output.result.content, input.result.content)
  }
})

test('result transform ignores incomplete, malformed, nested and non-official error envelopes', () => {
  const handler = registeredHandler()
  const error = '{"status":"error","message":"failure"}'
  for (const [name, text] of [
    [execute, '{"status":"error"}'],
    [execute, '{"status":"error","message":null}'],
    [execute, '{"status":"error","message":42}'],
    [execute, '{"status":"error","message":"truncated'],
    [execute, '[{"status":"error","message":"failure"}]'],
    [execute, 'null'],
    [execute, '"error"'],
    [execute, '{"status":"ok","result":{"status":"error","message":"nested"}}'],
    [execute, '{"status":"ERROR","message":"failure"}'],
    ['mcp_blender_official_deadbeef_execute_blender_code', error],
    ['mcp_blender_official_execute_blender_code', error],
    [`${execute}_extra`, error],
    ['three_view_read_render', error],
  ]) {
    const input = payload(name, text)
    assert.deepEqual(handler(input), {}, `${name}: ${text}`)
    assert.equal(input.result.isError, undefined)
  }
  assert.deepEqual(handler({ ...payload(execute, error), result: { content: [] } }), {})
  assert.deepEqual(handler({ ...payload(execute, error), result: { content: [{ type: 'ref', ref: { sha256: 'a'.repeat(64), size: 1 } }] } }), {})
})

test('matching multi-block results retain content identity and every result field', () => {
  const handler = registeredHandler()
  const content = Object.freeze([
    Object.freeze({ type: 'text', text: 'ordinary output' }),
    Object.freeze({ type: 'ref', ref: Object.freeze({ sha256: 'a'.repeat(64), size: 1 }) }),
    Object.freeze({ type: 'text', text: '{"status":"error","message":""}' }),
    Object.freeze({ type: 'text', text: '{"status":"ok"}' }),
  ])
  const result = Object.freeze({ content, isError: false, details: { source: 'previous hook' }, structured: { previousHook: true }, terminate: false })
  const input = Object.freeze({ ...payload(cli, ''), result })
  const output = handler(input)
  assert.deepEqual(output, { result: { ...result, isError: true } })
  assert.equal(output.result.content, content)
  assert.equal(output.result.structured, result.structured)
  assert.equal(output.result.details, result.details)
  assert.equal(result.isError, false)
})

test('existing transport or earlier hook errors stay intact', () => {
  const handler = registeredHandler()
  for (const [name, text] of [
    [execute, '{"status":"error","message":"failure"}'],
    [execute, '{"status":"ok"}'],
    ['other_tool', '{"status":"error","message":"failure"}'],
  ]) {
    const input = payload(name, text, { isError: true, details: { reason: 'already failed' } })
    assert.deepEqual(handler(input), {})
    assert.equal(input.result.isError, true)
    assert.deepEqual(input.result.details, { reason: 'already failed' })
  }
})
