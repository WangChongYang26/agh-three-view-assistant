import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { VIEW_IDS, VIEW_LABELS, VERSION, newProject, submitProject, clampLayout } from './core.js'
import { listProjects, saveProject, prepareImage, previewUrl, releasePreviewUrls, exportProject, importProject } from './storage.js'
import { prepareSubmission, assertSubmissionIdentity } from './submission.js'

function Screenshot({ artifact, resources, active }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setUrl(''); setError('')
    if (!active || !resources?.images) return
    let live = true
    let resource
    resources.images.load({ laneId: 'main', artifact }).then(value => {
      if (!live) { value.release(); return }
      resource = value; setUrl(value.url)
    }).catch(e => { if (live) setError(e.message) })
    return () => { live = false; resource?.release() }
  }, [artifact, resources, active])
  if (!active) return h('p',{},'截图属于原会话，请切回原会话查看')
  return url ? h('img',{src:url,alt:'Blender 官方 MCP 截图',style:{width:'100%',objectFit:'contain'}}) : h('p',{},error || '正在读取截图')
}

function Panel({ session, resources }) {
  const sessionId = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('正在读取项目')
  const [persistence, setPersistence] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [layout, setLayout] = useState(() => {
    try { return clampLayout(JSON.parse(localStorage.getItem('tvap-layout') || '{}'), innerWidth, innerHeight) }
    catch { return clampLayout({}, innerWidth, innerHeight) }
  })
  const panel = useRef(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const uploadTokens = useRef({})
  const runningSession = useRef(null)
  const revision = useRef(0)
  const saveQueue = useRef(Promise.resolve())
  const saveError = useRef(null)
  useEffect(() => {
    let live = true
    listProjects().then(items => {
      if (!live) return
      setProjects(items)
      setProject(items.sort((a,b) => b.updatedAt-a.updatedAt)[0] || newProject())
      setStatus('就绪')
    }).catch(e => { setError(`无法读取项目：${e.message}`); setProject(newProject()) })
    return () => { live = false }
  }, [])
  const commit = next => {
    projectRef.current = next
    setProject(next)
    setPersistence('保存中')
    const seq = ++revision.current
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveProject(next)).then(() => {
      saveError.current = null
      setProjects(items => [...items.filter(p => p.id !== next.id), next])
      if (revision.current === seq) setPersistence('已保存')
    }).catch(e => { saveError.current = e; setError(`保存失败：${e.message}`); setPersistence('未保存') })
  }
  const patch = change => commit({ ...projectRef.current, ...change, updatedAt: Date.now() })
  const selectProject = id => {
    const next = projects.find(p => p.id === id)
    if (!next || next.id === projectRef.current?.id) return
    releasePreviewUrls(projectRef.current)
    projectRef.current = next
    setProject(next)
  }
  const createProject = () => {
    releasePreviewUrls(projectRef.current)
    commit(newProject())
  }
  useEffect(() => {
    const resize = () => setLayout(old => clampLayout(old, innerWidth, innerHeight))
    addEventListener('resize', resize)
    return () => removeEventListener('resize', resize)
  }, [])
  useEffect(() => { try { localStorage.setItem('tvap-layout', JSON.stringify(layout)) } catch {} }, [layout])
  const gesture = (event, type) => {
    if (event.button !== 0 || event.target.closest('button,input,select')) return
    const start = { ...layout, px: event.clientX, py: event.clientY }
    const node = event.currentTarget
    node.setPointerCapture(event.pointerId)
    const move = e => setLayout(clampLayout(type === 'drag'
      ? { ...start, x: start.x + e.clientX-start.px, y: start.y + e.clientY-start.py }
      : { ...start, width: start.width + e.clientX-start.px, height: start.height + e.clientY-start.py }, innerWidth, innerHeight))
    const end = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', end) }
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end)
  }
  const upload = async (id, file) => {
    if (!file || busy) return
    setError('')
    const projectId = projectRef.current?.id
    const token = Symbol(id)
    uploadTokens.current[id] = token
    setUploading(count => count + 1)
    try {
      const image = await prepareImage(file)
      if (uploadTokens.current[id] !== token || projectRef.current?.id !== projectId) return
      patch({ views: { ...projectRef.current.views, [id]: image } })
    }
    catch(e) { setError(e.message) }
    finally { setUploading(count => count - 1) }
  }
  const run = async action => {
    if (runningSession.current) return
    const runSessionId = session.sessionId
    const runProject = projectRef.current
    runningSession.current = runSessionId
    setError(''); setBusy(true); setStatus('处理中')
    try {
      const submitted = await prepareSubmission(session, runSessionId, runProject, action, {
        currentProject: () => projectRef.current,
        waitForSave: async () => {
          await saveQueue.current
          if (saveError.current) throw new Error('项目尚未保存，请先导出备份并解决存储错误')
        },
        persist: async prepared => {
          commit(prepared)
          await saveQueue.current
          if (saveError.current) throw new Error('提交副本尚未保存；请先导出备份并解决存储错误')
        },
      })
      assertSubmissionIdentity(session, runSessionId, submitted, () => projectRef.current)
      const receipt = await submitProject(session, submitted, action)
      const response = receipt.result
      if (receipt.feedbackError) setError(receipt.feedbackError)
      const imageDimensions = action === 'inspect' ? null : Object.fromEntries(VIEW_IDS.map(id => { const image = submitted.views[id]; return [id, { original: [image.width, image.height], submission: [image.submissionWidth, image.submissionHeight] }] }))
      const entry = { action, imageDimensions, sessionId: receipt.sessionId, reason: response.reason, lastSeq: response.lastSeq, text: receipt.text, initialText: receipt.initialText, verificationResult: receipt.verificationResult, tools: receipt.tools, screenshots: receipt.screenshots, renderReads: receipt.renderReads, feedbackCycle: receipt.feedbackCycle, at: Date.now() }
      commit({ ...submitted, runs: [...submitted.runs, entry], updatedAt: Date.now() })
      setStatus(receipt.switched ? '原会话任务已结束；结果在原会话中' : `任务结束：${response.reason}`)
    } catch(e) { setError(e.message); setStatus('操作未完成') }
    finally { runningSession.current = null; setBusy(false) }
  }
  if (!open) return h('button', { className:'tvap-launch', onClick:()=>setOpen(true), title:'打开三视图资产面板' }, '三视图资产')
  return h('section', { ref:panel, className:'tvap-panel', 'data-plugin':'three-view-asset-panel', style:{left:layout.x,top:layout.y,width:layout.width,height:collapsed?'auto':layout.height} },
    h('header', { className:'tvap-header', onPointerDown:e=>gesture(e,'drag') },
      h('strong', {}, `三视图资产 ${VERSION}`),
      h('button', {onClick:()=>setCollapsed(!collapsed),title:collapsed?'展开':'折叠'},collapsed?'+':'−'),
      h('button', {onClick:()=>setOpen(false),title:'收起面板'},'×')),
    !collapsed && h('div',{className:'tvap-body'},
      h('div',{className:'tvap-projects'}, h('select',{value:project?.id||'',disabled:busy||uploading>0,onChange:e=>selectProject(e.target.value)},
        project && !projects.some(p=>p.id===project.id) && h('option',{value:project.id},'新资产'),
        projects.map(p=>h('option',{key:p.id,value:p.id},p.name||'未命名资产'))),
        h('button',{disabled:busy||uploading>0,onClick:createProject,title:'新建资产'},'+')),
      project && h('div',{},
        h('div',{className:'tvap-actions'},
          h('button',{disabled:busy||uploading>0,onClick:async()=>{try{const data=await exportProject(projectRef.current);const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`three-view-${projectRef.current.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError(e.message)}}},'导出备份'),
          h('label',{},'导入备份',h('input',{type:'file',accept:'.json',disabled:busy||uploading>0,onChange:async e=>{const file=e.target.files[0];if(!file)return;setBusy(true);try{const next=await importProject(file);commit(next)}catch(error){setError(error.message)}finally{setBusy(false)}}}))),
        h('label',{},'资产名称',h('input',{value:project.name,disabled:busy,onChange:e=>patch({name:e.target.value})})),
        h('label',{},'已知尺寸',h('input',{value:project.dimensions,disabled:busy,onChange:e=>patch({dimensions:e.target.value}),placeholder:'例如：高 30 cm'})),
        h('div',{className:'tvap-grid'},VIEW_IDS.map(id=>h('div',{key:id,className:'tvap-view-card',onDragOver:e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'},onDrop:e=>{e.preventDefault();e.stopPropagation();upload(id,e.dataTransfer.files[0])}},
          h('strong',{},VIEW_LABELS[id]),project.views[id]?h('img',{src:previewUrl(project.views[id]),alt:VIEW_LABELS[id],draggable:false}):h('div',{className:'tvap-empty'},'拖入图片'),
          project.views[id] && h('div',{className:'tvap-filename',title:project.views[id].name},`${project.views[id].name} · 原图 ${project.views[id].width}×${project.views[id].height} · 提交 ${project.views[id].submissionWidth && project.views[id].submissionHeight ? `${project.views[id].submissionWidth}×${project.views[id].submissionHeight}` : '下次提交前生成'}`),
          h('input',{type:'file',accept:'image/png,image/jpeg,image/webp,image/gif',disabled:busy,'aria-label':`${VIEW_LABELS[id]}图片`,onChange:e=>upload(id,e.target.files[0])}),
          project.views[id] && h('button',{disabled:busy,title:`移除${VIEW_LABELS[id]}图`,onClick:()=>{uploadTokens.current[id]=Symbol('removed');const views={...projectRef.current.views};delete views[id];patch({views})}},'移除')))),
        h('details',{},h('summary',{},'设置模型保存位置 (.blend)'),
           h('label',{},'最终模型文件路径',h('input',{value:project.blendPath||'',disabled:busy,placeholder:'例如 C:\\Models\\robot.blend',onChange:e=>patch({blendPath:e.target.value})})),
           h('p',{},'留空则保存到 AGH 工作区 three-view-assets/任务ID/asset.blend；检查图片仍保存在工作区。'),
           h('button',{disabled:busy,onClick:()=>patch({blendPath:''})},'恢复默认位置'),
           h('p',{},'设置下一次建模/校正的保存目标，不会立即保存。整个工程可能包含原Scene和任务Scene。')),
         h('label',{},'补充要求',h('textarea',{value:project.notes,disabled:busy,onChange:e=>patch({notes:e.target.value}),rows:3})),
        h('div',{className:'tvap-status',role:'status'},sessionId?[status,persistence].filter(Boolean).join(' · '):'请先选择 AGH 会话'),
        error && h('div',{className:'tvap-error',role:'alert'},error),
        h('div',{className:'tvap-actions'},[['analyze','分析三视图'],['model','自动建模与自检'],['refine','自动对照校正'],['inspect','查看 Blender']].map(([action,label])=>h('button',{key:action,disabled:busy||uploading>0||!sessionId,onClick:()=>run(action)},label))),
        busy && h('button',{disabled:sessionId!==runningSession.current,onClick:()=>session.commands.cancel().catch(e=>setError(e.message))},'停止本次任务'),
        project.runs.at(-1)?.screenshots?.map(artifact => h(Screenshot,{key:artifact.sha256,artifact,resources,active:sessionId===project.runs.at(-1).sessionId})),
        project.runs.at(-1)?.renderReads?.length > 0 && h('details',{},h('summary',{},`实际读图 ${project.runs.at(-1).renderReads.length} 次 · ${project.runs.at(-1).feedbackCycle?'有修改前后闭环记录':'尚无完整闭环记录'}`),project.runs.at(-1).renderReads.map((r,i)=>h('div',{key:i},`${r.view} · ${r.path}`))),
        project.runs.at(-1)?.text && h('details', {open:true}, h('summary',{},'最近结果'), h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},project.runs.at(-1).text)),
        project.runs.at(-1)?.tools?.length > 0 && h('details',{},h('summary',{},'本轮工具记录'),project.runs.at(-1).tools.map((t,i)=>h('div',{key:i},`${t.name} · ${t.status}`))),
        h('details',{},h('summary',{},'运行记录'),project.runs.slice(-10).reverse().map((r,i)=>h('div',{key:i},`${new Date(r.at).toLocaleString()} · ${r.action} · ${r.reason} · ${r.sessionId}`,r.imageDimensions && h('div',{},Object.entries(r.imageDimensions).map(([id,size]) => `${VIEW_LABELS[id]}：原图 ${size.original.join('×')} / 提交 ${size.submission.join('×')}`).join('；')))))
      )),
    !collapsed && h('div',{className:'tvap-resize',role:'separator','aria-label':'调整面板尺寸',onPointerDown:e=>gesture(e,'resize')})
  )
}
export function apply(ctx) {
  ctx.slots.register({name:'workbench.panel',id:'three-view-asset-panel',priority:10},()=>h(Panel,{session:ctx.session,resources:ctx.resources}))
}
