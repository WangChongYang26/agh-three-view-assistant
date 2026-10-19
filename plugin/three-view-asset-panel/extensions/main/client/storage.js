const DB_NAME = 'agh-three-view-assets'
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function operation(mode, action) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', mode)
      const req = action(tx.objectStore('projects'))
      tx.oncomplete = () => resolve(req.result)
      tx.onabort = () => reject(tx.error || new Error('保存被中断'))
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function listProjects() {
  const items = await operation('readonly', store => store.getAll())
  if (items.length) return items
  for (const key of ['agh-three-view-asset-panel:v2', 'agh-three-view-asset-panel:v1']) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    const legacy = JSON.parse(raw)
    const project = { id: crypto.randomUUID(), name: legacy.name || '旧版资产', dimensions: legacy.dimensions || '', notes: '', views: {}, runs: [], updatedAt: Date.now() }
    for (const id of ['front','side','back']) {
      const item = legacy.views?.[id]
      if (!item?.dataUrl) continue
      if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(item.dataUrl)) throw new Error('旧版图片格式无效，原数据已保留')
      const blob = await (await fetch(item.dataUrl)).blob()
      project.views[id] = await prepareImage(new File([blob], item.name || `${id}.png`, { type: blob.type }))
    }
    await saveProject(project)
    return [project]
  }
  return items
}
export const saveProject = project => operation('readwrite', store => store.put(project))
export const deleteProject = id => operation('readwrite', store => store.delete(id))
export async function exportProject(project) {
  const views = {}
  for (const [id, image] of Object.entries(project.views)) {
    const originalDataUrl = image.original instanceof Blob ? await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(image.original)
    }) : (image.originalDataUrl || image.dataUrl)
    const { original, ...metadata } = image
    views[id] = { ...metadata, originalDataUrl }
  }
  return JSON.stringify({ format:'agh-three-view-project', version:1, project:{...project,views} },null,2)
}
export async function importProject(file) {
  if (file.size > 110 * 1024 * 1024) throw new Error('备份文件超过 110 MB')
  const backup = JSON.parse(await file.text())
  if (backup.format !== 'agh-three-view-project' || backup.version !== 1 || !backup.project?.views) throw new Error('不是有效的三视图项目备份')
  const source = backup.project
  const project = { id:crypto.randomUUID(),name:String(source.name||'导入资产'),dimensions:String(source.dimensions||''),notes:String(source.notes||''),blendPath:String(source.blendPath||''),views:{},runs:Array.isArray(source.runs)?source.runs:[],updatedAt:Date.now() }
  for (const id of ['front','side','back']) {
    const image = source.views[id]
    if (!image) continue
    const data = image.originalDataUrl || image.dataUrl
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(data)) throw new Error('备份图片数据格式无效')
    const blob = await (await fetch(data)).blob()
    project.views[id] = await prepareImage(new File([blob],String(image.name||`${id}.jpg`),{type:blob.type}))
  }
  await saveProject(project)
  return project
}

// Matches AGH local-dev's session-image original-read dimension limit.
export const SUBMISSION_MAX_EDGE = 1456
const PREVIEW_MIME = 'image/jpeg'
const PREVIEW_QUALITY = 0.9

export function submissionDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('图片尺寸无效')
  const scale = Math.min(1, SUBMISSION_MAX_EDGE / Math.max(width, height))
  return { submissionWidth: Math.max(1, Math.round(width * scale)), submissionHeight: Math.max(1, Math.round(height * scale)) }
}

/** Creates a submission copy; the original Blob is never changed. */
async function renderPreview(file) {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  try {
    if (!width || !height) throw new Error('图片尺寸无效')
    const { submissionWidth, submissionHeight } = submissionDimensions(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = submissionWidth
    canvas.height = submissionHeight
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL(PREVIEW_MIME, PREVIEW_QUALITY), width, height, submissionWidth, submissionHeight }
  } finally {
    bitmap.close()
  }
}

export async function prepareImage(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片')
  if (file.size > 24 * 1024 * 1024) throw new Error('单张图片不能超过 24 MB')
  const preview = await renderPreview(file)
  // previewObjectUrl is deliberately NOT persisted: IndexedDB can reject or truncate very large
  // data URLs, which previously left the file name and dimensions visible with a broken image.
  // A fresh object URL is derived from the stored original on every load instead.
  return { name: file.name, type: PREVIEW_MIME, ...preview, original: file }
}

/** Refreshes older saved copies before prompting, without replacing their originals. */
export async function prepareProjectImages(project) {
  const views = { ...project.views }
  for (const id of ['front', 'side', 'back']) {
    const image = views[id]
    if (!image) continue
    const hasOriginal = image.original instanceof Blob
    const originalDataUrl = image.originalDataUrl || image.dataUrl
    if (!hasOriginal && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(originalDataUrl || '')) throw new Error('保存的图片数据格式无效；原记录未修改')
    const source = hasOriginal ? image.original : await (await fetch(originalDataUrl)).blob()
    const preview = await renderPreview(source)
    views[id] = { ...image, ...preview, type: PREVIEW_MIME,
      ...(!hasOriginal ? { originalDataUrl, width: image.width || preview.width, height: image.height || preview.height } : {}) }
  }
  return { ...project, views }
}
/** Object URLs live only as long as the project entry that owns them. */
export function releasePreviewUrls(project) {
  for (const image of Object.values(project?.views || {})) {
    if (image?.previewObjectUrl) {
      URL.revokeObjectURL(image.previewObjectUrl)
      delete image.previewObjectUrl
    }
  }
}

export function previewUrl(image) {
  if (!image) return ''
  if (image.previewObjectUrl) return image.previewObjectUrl
  if (image.original instanceof Blob) {
    image.previewObjectUrl = URL.createObjectURL(image.original)
    return image.previewObjectUrl
  }
  return image.dataUrl || ''
}
