// tool_result exposes the local MCP name, not the server id or remote tool origin.
const executionTools = new Set([
  'mcp_blender_official_2d590ef9_execute_blender_code',
  'mcp_blender_official_2d590ef9_execute_blender_code_for_cli',
])

export function mapBlenderExecutionError(payload) {
  if (!executionTools.has(payload.name) || payload.result.isError === true) return {}
  for (const block of payload.result.content) {
    if (block.type !== 'text') continue
    let value
    try {
      value = JSON.parse(block.text)
    } catch {
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        value.status === 'error' && typeof value.message === 'string') {
      return { result: { ...payload.result, isError: true } }
    }
  }
  return {}
}
