import test from 'node:test'
import assert from 'node:assert/strict'
import {deflateSync} from 'node:zlib'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {renderImageTool,workspaceTool} from './extensions/main/render-image-tool.mjs'
import {submitProject,newProject} from './extensions/main/client/core.js'
// Delivery-only adaptation: generate valid PNG bytes instead of reading a private old asset.
const cwd=fileURLToPath(new URL('./test-workspace/',import.meta.url))
const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32BE(value>>>0);return bytes}
const crc32=bytes=>{
  let crc=0xffffffff
  for(const byte of bytes){
    crc^=byte
    for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1
  }
  return (crc^0xffffffff)>>>0
}
const chunk=(type,data)=>{
  const typed=Buffer.concat([Buffer.from(type,'ascii'),data])
  return Buffer.concat([u32(data.length),typed,u32(crc32(typed))])
}
const png=Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',Buffer.concat([u32(520),u32(760),Buffer.from([1,0,0,0,0])])),
  chunk('IDAT',deflateSync(Buffer.alloc(760*(1+Math.ceil(520/8))))),
  chunk('IEND',Buffer.alloc(0)),
])
const ctx=()=>({cwd,signal:new AbortController().signal,fs:{stat:async path=>path.endsWith('.png')?({kind:'file',size:png.length}):({kind:'dir',size:0}),read:async(path,opts)=>{assert.equal(opts,undefined,'binary read must not request text line pagination');return png}},artifacts:{put:async(bytes,meta)=>({sha256:'a'.repeat(64),size:bytes.length,mime:meta.mime})}})
test('workspace discovery uses AGH cwd without reading files',async()=>{
  const result=await workspaceTool().execute({}, {cwd})
  assert.equal(result.structured.cwd,cwd)
  assert.equal(result.structured.renderRoot,resolve(cwd,'three-view-assets'))
})
test('reference copies are labelled as evidence, never as Blender output',async()=>{
  const cases=[
    ['three-view-assets/test/reference/front.png','front','reference-copy'],
    ['three-view-assets/test/references/before_side.png','side','reference-copy'],
    ['three-view-assets/test/before_front.png','front','render'],
    ['three-view-assets/test/before_side.png','side','render'],
    ['three-view-assets/test/before-back.png','back','render'],
    ['three-view-assets/test/r0_side.png','side','reference-copy'],
    ['three-view-assets/test/target_front.png','front','reference-copy'],
    ['three-view-assets/test/original_side.png','side','reference-copy'],
    ['three-view-assets/test/source_back.png','back','reference-copy'],
    ['three-view-assets/test/after_1_front.png','front','render'],
    ['three-view-assets/test/final_back.png','back','render'],
  ]
  for(const [path,view,kind] of cases){
    const result=await renderImageTool().execute({path,view},ctx())
    const note=JSON.parse(result.content[0].text)
    assert.equal(note.kind,kind,path)
    assert.equal(result.structured.kind,kind,path)
    assert.match(note.note,kind==='reference-copy'?/not a Blender render/:/actual Blender output/,path)
  }
})
test('valid PNG produces image blocks and three-view before renders qualify for review',async()=>{
 const result=await renderImageTool().execute({path:'three-view-assets/test/front.png',view:'front'},ctx())
 assert.equal(result.isError,undefined);assert.equal(result.content[1].type,'image');assert.equal(result.structured.width,520);assert.equal(result.structured.height,760)
 const views=['front','side','back'],project={...newProject(),views:Object.fromEntries(views.map(view=>[view,{name:view+'.png',dataUrl:'data:image/png;base64,YQ=='}]))}
 const details=await Promise.all(views.map(view=>renderImageTool().execute({path:`three-view-assets/${project.id}/before_${view}.png`,view},ctx())))
 assert.deepEqual(details.map(detail=>detail.structured.kind),['render','render','render'])
 const calls=[],nodes=views.map((_view,index)=>({kind:'tool',seq:index+2,name:'three_view_read_render',status:'completed'}))
 const session={sessionId:'before-review',
   projection:{read:async()=>({status:'available',value:{opState:null,upto:calls.length?10:1,nodes:calls.length?nodes:[]}})},
   handle:{readToolDetail:async seq=>({result:details[seq-2]})},
   commands:{prompt:async content=>{calls.push(content);return {reason:'completed',lastSeq:10}}},
 }
 const receipt=await submitProject(session,project,'model')
 assert.equal(receipt.verificationResult.reason,'completed')
 assert.equal(calls.length,2,'all three actual before render artifacts permit read-only review')
 for(const view of views)assert.ok(calls[1].some(block=>block.text?.includes(`before_${view}.png`)))
})
test('reject paths outside assets before filesystem access',async()=>{
 for(const path of ['../secret.png','robot-replica-final/front.png','three-view-assets/../../secret.png']){
  const context=ctx();context.fs.stat=()=>{throw Error('must not touch filesystem')}
  const result=await renderImageTool().execute({path,view:'front'},context)
  assert.equal(result.isError,true);assert.match(result.content[0].text,/must be under/)
 }
})
test('reject huge, non-file, or linked parent without byte read',async()=>{
 for(const stat of [{kind:'file',size:5*1024*1024},{kind:'symlink',size:1},{kind:'dir',size:1}]){
  const context=ctx();context.fs.stat=async path=>path.endsWith('.png')?stat:({kind:'dir',size:0});context.fs.read=()=>{throw Error('must not read')}
  assert.equal((await renderImageTool().execute({path:'three-view-assets/x.png',view:'side'},context)).isError,true)
 }
 const linked=ctx();linked.fs.stat=async path=>path.endsWith('linked')?({kind:'symlink',size:0}):({kind:'dir',size:0});linked.fs.read=()=>{throw Error('must not read')}
 assert.equal((await renderImageTool().execute({path:'three-view-assets/linked/x.png',view:'front'},linked)).isError,true)
})
test('corrupt PNG and non-image files do not publish artifact',async()=>{
 const context=ctx();context.fs.read=async()=>new Uint8Array([1,2,3]);context.artifacts.put=()=>{throw Error('must not publish')}
 assert.equal((await renderImageTool().execute({path:'three-view-assets/x.png',view:'back'},context)).isError,true)
 assert.equal((await renderImageTool().execute({path:'three-view-assets/x.blend',view:'back'},context)).isError,true)
})
