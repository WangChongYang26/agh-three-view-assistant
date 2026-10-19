import { MODELING_SKILL } from './skills.js'
import { renderImageTool, workspaceTool } from './render-image-tool.mjs'
import { mapBlenderExecutionError } from './blender-execution-result.mjs'
export const runtime = {
  inject: ['skills', 'extension'],
  apply(ctx) {
    ctx.skills.register(MODELING_SKILL)
    ctx.extension().registerTool(workspaceTool())
    ctx.extension().registerTool(renderImageTool())
    ctx.extension().registerHook('tool_result', mapBlenderExecutionError)
  },
}
