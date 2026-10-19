import { MODELING_SKILL } from '../skills.js'
export const VIEW_IDS = ['front', 'side', 'back']
export const VIEW_LABELS = { front: '正面', side: '侧面', back: '背面' }
export const VERSION = '0.7.1'
export function blendSavePath(value) {
  const path=String(value||'').trim()
  if (!path) return ''
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path) || !/\.blend$/i.test(path) || /[\r\n\0]/.test(path)) throw new Error('请填写完整的 .blend 文件路径，例如 C:\\Models\\robot.blend')
  return path
}
export function newProject() {
  return { id: crypto.randomUUID(), name: '', dimensions: '', notes: '', blendPath:'', views: {}, runs: [], updatedAt: Date.now() }
}
export function buildRequest(project, action, workspace='') {
  const instructions = {
    analyze: '只分析图片，不操作 Blender。逐视图列出可见结构、对应部件、比例、遮挡和透视，区分观察与推测；给出分阶段建模方案。',
    model: '根据三张图片构建资产。先检查本轮已提供的 Blender Lab 官方工具，若存在直接调用，只有缺少时才通过 tool_search 搜索；搜索无结果不能证明已提供工具不存在。读取当前场景；保留已有对象的数据，创建以任务 ID 命名的独立 Scene 与集合，任务 Scene 不链接无关原对象，并切换当前窗口至任务 Scene。渲染前列出对象范围并排除默认方块、旧测试对象等无关内容。由你从图片推断形状、比例和相机。通过官方实时工具逐步建模，禁止使用后台 _for_cli 和 create_white_model。完成后将正侧背检查图渲染到任务目录，调用 three_view_read_render 真正看图，自行指出偏差并修正，然后重渲染读图验证；不得等待用户或DSH告诉你哪里错。保存到当前工作区 three-view-assets/<任务ID>/asset.blend。返回实际文件路径、截图和未解决偏差。',
    refine: '对照重新附上的三张原图检查本任务资产，通过 Blender Lab 官方实时 MCP 修正本任务集合；不要删除其他对象。先核查本任务 Scene 的隔离范围；旧任务混在原 Scene 时，创建独立任务 Scene，只链接确认属于任务的集合及必要环境，保留原 Scene。区分无关对象混入与部件自身穿插。先自行渲染并调用 three_view_read_render 看实际结果，自行指出偏差，再修改；重渲染并再次调用该工具验证，禁止等待外部指出具体错误。返回实际保存路径和不确定的结构。',
    review: '这是同一任务的交付前只读复核阶段。禁止执行Blender Python、修改几何/材质/相机、重渲染、重建或另存资产；只用three_view_read_render读取本次任务最后保存的正侧背图片。下面重新附上用户原始三图，暂不采信之前的PASS。逐项列参考证据、结果图可见证据和通过/不通过/无法判断，任一主要项缺失或不可辨必须PARTIAL，无法读图为UNAVAILABLE。发现偏差只报告，不自动修正或发起下一轮refine。返回FINAL_VISUAL_REVIEW状态、最后保存路径及残留偏差。',
    inspect: `优先直接调用当前已提供的 Blender 官方 get_objects_summary 和 get_screenshot_of_window_as_image，缺少时再使用 tool_search。只读查看，不创建、修改、保存或重新渲染。官方窗口截图不可用或被媒体策略禁用时，先调用three_view_workspace取得权威工作区与renderRoot，再用three_view_read_render依次读取本任务${project.id}目录中已有final_front.png、final_side.png、final_back.png；缺少final时可读取对应视角已有after阶段图片，并如实标明实际路径和阶段。不把原始参考图当作结果图；文件或工具缺失时如实报告。不得修改AGH媒体配置或权限。`,
  }
  if (!instructions[action]) throw new Error('未知操作')
  if (action !== 'inspect' && VIEW_IDS.some(id => !project.views[id]?.dataUrl)) throw new Error('请补齐三张参考图')
  const content = [{ type: 'text', text: [`三视图资产任务 ${project.id}`, `名称：${project.name || '未命名'}`, `已知尺寸：${project.dimensions || '未知，只估计相对比例'}`, `补充要求：${project.notes || '无'}`, workspace ? `AGH会话工作目录（不是Blender安装目录）：${workspace}。所有渲染必须写入 ${workspace}/three-view-assets/${project.id}/ 下，再调用three_view_read_render；推荐直接使用这个绝对目录。` : 'AGH会话工作目录以当前会话cwd为准；不要使用Blender安装目录。', instructions[action]].join('\n') }]
  if (['model','refine'].includes(action)) {
    const target=blendSavePath(project.blendPath)
    content.push({type:'text',text:target ? `最终模型保存位置由用户指定：${JSON.stringify(target)}。此设置覆盖前文默认asset.blend路径，仅作用于最终Blender工程；阶段文件和检查图仍保存在AGH工作区任务目录。保存前检查目标是否存在，若不是本任务已确认的文件则不得覆盖，停止并报告。创建父目录与另存需遵守工具权限；保存后返回真实绝对路径及文件大小。不要清空原Scene；整个.blend可能含原场景和任务Scene，明确说明实际保存范围。` : '最终模型使用默认保存位置：AGH工作区three-view-assets/<任务ID>/asset.blend。'})
  }
  if (['model','refine'].includes(action)) content.push({type:'text',text:'点击本阶段按钮已启动任务；必须实际调用已提供的官方实时工具，不以计划、代码块或文字请求聊天确认替代执行。逐次工具审批由AGH正常机制处理，未获批准不执行；工具失败时如实报告，不声称已创建资产。执行前先调用three_view_workspace取得权威cwd与renderRoot，不使用Blender的os.getcwd()。本次最多2轮几何修正，每轮最多3项；每次修改后保留阶段blend及全部三视图。先比较已通过项是否退步，退步则恢复上个阶段并报告。技术错误最多尝试2次不同修复，仍失败就停并报告，不无限诊断；同一hash图片无需反复读取。最终必须输出最后三图的绝对路径。'})
  if (action !== 'inspect' && action !== 'review') content.push({type:'text',text:`使用 Skill ${MODELING_SKILL.name}。下面是插件绑定的方法正文，当前执行阶段为 ${action}；只执行对应阶段，不越级。参考事实以本轮真实图片为准，不需要寻找外部任务书。模型自己完成视觉检查，不请求外部审核者给偏差答案。\n${MODELING_SKILL.body}`})
  if (action === 'model' || action === 'refine') {
    const analysis = [...project.runs].reverse().find(run => run.action === 'analyze' && run.text)
    if (analysis) content.push({ type:'text', text:`上次分析记录（仍需根据原图核对，不是事实保证）：\n${analysis.text.slice(0, 24000)}` })
  }
  if (action !== 'inspect') for (const id of VIEW_IDS) {
    const item = project.views[id]
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(item.dataUrl || '')
    if (!match) throw new Error(`${VIEW_LABELS[id]}图片格式不受支持，请重新上传`)
    const dimensions = item.submissionWidth && item.submissionHeight ? `；原图 ${item.width}×${item.height}，本次等比例提交副本 ${item.submissionWidth}×${item.submissionHeight}` : ''
    content.push({ type: 'text', text: `下面这张是${VIEW_LABELS[id]}参考图：${item.name}${dimensions}` }, { type: 'image', mimeType: match[1], data: match[2] })
  }
  if (new TextEncoder().encode(JSON.stringify(content)).length > 8 * 1024 * 1024) throw new Error('三张图片合计过大，请降低图片分辨率')
  return content
}
const TASK_TIMEOUT_MS = 20 * 60 * 1000
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000
const BLENDER_CODE_TOOL = /execute_blender_code$/
const IMAGE_RESULT_TOOLS = /get_screenshot|three_view_read_render/

/** A read tool result only counts when the artifact is actually reachable from that result. */
function artifactLinked(content, artifact, strictMime) {
  if (!artifact) return false
  return (content || []).some(block => {
    if (block.type === 'resource_link' && block.uri === `artifact://${artifact.sha256}`)
      return !strictMime || block.mimeType === artifact.mime
    return block.type === 'image' && block.ref?.sha256 === artifact.sha256
  })
}

/** Blender returns business failures inside a successful transport, so the envelope decides. */
function blenderCodeFailed(content) {
  return (content || []).some(block => {
    if (block.type !== 'text') return false
    try { return JSON.parse(block.text)?.status === 'error' } catch { return false }
  })
}

export async function submitProject(session, project, action, limits = {}) {
  const id = session?.sessionId
  const commands = session?.commands
  if (!id || !commands?.prompt) throw new Error('请先创建或选择 AGH 会话')
  const projection = await session.projection.read()
  if (session.sessionId !== id) throw new Error('会话已切换，请重新提交')
  if (projection.status !== 'available') throw new Error('当前会话未就绪')
  if (projection.value?.opState != null) throw new Error('当前会话正在执行任务，请等待结束')
  const startSeq = projection.value?.upto ?? 0
  const originalHandle = session.handle
  const cancelOriginal = () => {
    if (typeof originalHandle?.cancel === 'function') return originalHandle.cancel()
    if (session.sessionId !== id) throw new Error('会话已切换，未取消新会话；请在原会话停止任务')
    return commands.cancel()
  }
  let deadlineError = ''
  const boundedPrompt = async (content, timeoutMs) => {
    let expired = false
    let cancellation
    const timer = setTimeout(() => {
      expired = true
      deadlineError = '本次阶段超过时间上限，已请求停止；保留已有结果，不自动重试。'
      cancellation = Promise.resolve().then(() => cancelOriginal()).catch(error => { deadlineError += ` 停止失败：${error.message}` })
    }, timeoutMs)
    try {
      const receipt = await commands.prompt(content)
      if (cancellation) await cancellation
      return expired ? {...receipt,reason:'timeout'} : receipt
    } finally { clearTimeout(timer) }
  }
  const initialResult = await boundedPrompt(buildRequest(project, action, session.workspace || ''), limits.taskTimeoutMs ?? TASK_TIMEOUT_MS)
  let result = initialResult
  let verificationResult = null
  let verificationStartSeq = null
  let verificationError = ''
  if (['model','refine'].includes(action) && session.sessionId === id && initialResult.reason === 'completed') {
    try {
      const ready = await session.projection.read()
      if (session.sessionId === id && ready.status === 'available' && ready.value?.opState == null) {
        const initialNodes = (ready.value?.nodes || []).filter(node => node.seq > startSeq)
        const finalReads = new Map()
        if (typeof session.handle?.readToolDetail === 'function') {
          for (const node of initialNodes.filter(node => node.kind === 'tool' && node.name === 'three_view_read_render' && node.status === 'completed')) {
            const detail = await session.handle.readToolDetail(node.seq, node.resultSeq)
            const structured = detail.result?.structured
            const artifact = structured?.artifact
            const linked = artifactLinked(detail.result?.content, artifact, false)
            if (!detail.result?.isError && structured?.ok === true && structured.kind !== 'reference-copy' && linked && VIEW_IDS.includes(structured.view) && structured.path?.includes(project.id)) finalReads.set(structured.view, {path:structured.path,artifact})
          }
        }
        if (finalReads.size !== 3) verificationError = '本次任务缺少正侧背三个有效图片结果，跳过交付复核。'
        else {
          verificationStartSeq = ready.value?.upto ?? startSeq
          const request = buildRequest(project, 'review', session.workspace || '')
          request.splice(1, 0, {type:'text',text:'本次已核验的最后图片路径（逐张读取这些文件，不猜路径）：\n'+JSON.stringify(Object.fromEntries(finalReads))})
          verificationResult = await boundedPrompt(request, limits.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS)
          result = verificationResult
        }
      } else verificationError = '交付前原图复核未执行：会话已切换或仍在运行。'
    } catch (error) { verificationError = `初始任务已结束，但交付前复核失败：${error.message}` }
  }
  const switched = session.sessionId !== id
  let after = null
  let feedbackError = deadlineError || verificationError
  if (!switched) {
    try { after = await session.projection.read() }
    catch (error) { feedbackError = `任务已结束，但结果读取失败：${error.message}` }
  }
  const nodes = (after?.value?.nodes || []).filter(node => node.seq > startSeq)
  const screenshots = []
  const renderReads = []
  if (!switched && typeof session.handle?.readToolDetail === 'function') {
    for (const node of nodes.filter(n => n.kind === 'tool' && IMAGE_RESULT_TOOLS.test(n.name) && n.status === 'completed')) {
      try {
        const detail = await session.handle.readToolDetail(node.seq, node.resultSeq)
        const structured = detail.result?.structured
        const hasImage = artifactLinked(detail.result?.content, structured?.artifact, true)
        if (!detail.result?.isError && structured?.ok === true && hasImage) {
          screenshots.push(structured.artifact)
          if (node.name === 'three_view_read_render') renderReads.push({path:structured.path,view:structured.view,seq:node.seq,artifact:structured.artifact})
        }
        for (const block of detail.result?.content || []) {
          if (block.type === 'image' && block.ref) screenshots.push({ ...block.ref, mime: block.mime || block.ref.mime })
        }
      } catch (error) { feedbackError ||= `截图记录读取失败：${error.message}` }
    }
  }
  const successfulExecutions = new Set()
  if (!switched && typeof session.handle?.readToolDetail === 'function') {
    for (const node of nodes.filter(n => n.kind === 'tool' && BLENDER_CODE_TOOL.test(n.name) && n.status === 'completed')) {
      try {
        const detail = await session.handle.readToolDetail(node.seq, node.resultSeq)
        if (detail.result && !detail.result.isError && !blenderCodeFailed(detail.result.content)) successfulExecutions.add(node.seq)
      } catch { /* Unavailable details cannot prove a successful execution. */ }
    }
  }
  const feedbackCycle = renderReads.some(before => renderReads.some(after => after.seq > before.seq && after.view === before.view && after.artifact.sha256 !== before.artifact.sha256 && [...successfulExecutions].some(seq => seq > before.seq && seq < after.seq)))
  if (['model','refine'].includes(action) && !feedbackCycle) feedbackError ||= '未找到同视角修改前读图→Blender执行→修改后不同图片读图的完整记录，不能宣称自主视觉修正已经完成。'
  const uniqueScreenshots = [...new Map(screenshots.map(artifact => [artifact.sha256, artifact])).values()]
  return { sessionId: id, result, initialResult, verificationResult, switched, feedbackError, screenshots: uniqueScreenshots, renderReads, feedbackCycle,
    initialText: nodes.filter(node => node.kind === 'assistant' && (verificationStartSeq == null || node.seq <= verificationStartSeq)).map(node => node.text).join('\n'),
    text: nodes.filter(node => node.kind === 'assistant' && (!verificationResult || node.seq > verificationStartSeq)).map(node => node.text).join('\n'),
    tools: nodes.filter(node => node.kind === 'tool').map(node => ({ name: node.name, status: node.status, result: node.resultPreview || '' })) }

}
export function clampLayout(layout, width, height) {
  const w = Math.min(Math.max(280, Number(layout.width) || 480), width - 16)
  const h = Math.min(Math.max(160, Number(layout.height) || 650), height - 16)
  return { width: w, height: h, x: Math.max(8, Math.min(Number.isFinite(layout.x) ? layout.x : width - w - 24, width - w - 8)), y: Math.max(8, Math.min(Number(layout.y) || 60, height - h - 8)) }
}
