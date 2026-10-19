import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRequest, newProject, submitProject, clampLayout } from './extensions/main/client/core.js'
const project = () => ({ ...newProject(), views: Object.fromEntries(['front','side','back'].map(id=>[id,{name:id+'.jpg',dataUrl:'data:image/jpeg;base64,YQ=='}])) })
test('all three views carry explicit labels and real image blocks',()=>{
  const content=buildRequest(project(),'analyze')
  assert.equal(content.filter(b=>b.type==='image').length,3)
  assert.deepEqual(content.filter(b=>b.type==='image').map(b=>b.mimeType),['image/jpeg','image/jpeg','image/jpeg'])
  assert.deepEqual(content.filter(b=>b.type==='image').map(b=>b.data),['YQ==','YQ==','YQ=='])
  const labels=content.filter(b=>b.type==='text'&&b.text.startsWith('下面这张'))
  assert.match(labels[0].text,/正面/);assert.match(labels[1].text,/侧面/);assert.match(labels[2].text,/背面/)
  assert.ok(content.some(b=>b.type==='text'&&b.text.includes('three-view-modeling-workflow')&&b.text.includes('未经视觉校验')))
})
test('custom blend target overrides model output while review stays read-only',()=>{
  const p=project();p.blendPath='C:\\Models\\robot.blend'
  for(const action of ['model','refine']) {
    const text=buildRequest(p,action).map(b=>b.text||'').join('\n')
    assert.match(text,/最终模型保存位置由用户指定/);assert.match(text,/不得覆盖/)
  }
  for(const path of ['robot.blend','C:\\Models\\robot.blender','C:\\Models\\robot.blend\n']) {
    p.blendPath=path
    if(!path.endsWith('\n'))assert.throws(()=>buildRequest(p,'model'),/完整的/)
  }
})
test('missing images fail before submitting',()=>assert.throws(()=>buildRequest(newProject(),'model'),/补齐/))
test('model and refine resend references and restrict official realtime tools',()=>{
  for(const action of ['model','refine'])assert.equal(buildRequest(project(),action).filter(b=>b.type==='image').length,3)
  assert.match(buildRequest(project(),'model')[0].text,/禁止使用后台/)
  assert.match(buildRequest(project(),'model')[0].text,/独立 Scene/)
  assert.match(buildRequest(project(),'model')[0].text,/排除默认方块/)
  assert.match(buildRequest(project(),'refine')[0].text,/保留原 Scene/)
  assert.ok(buildRequest(project(),'refine').some(b=>b.type==='text'&&b.text.includes('渲染前输出隔离检查表')))
  const method=buildRequest(project(),'model').filter(b=>b.type==='text').map(b=>b.text).join('\n')
  assert.match(method,/独立验收门槛/)
  assert.match(method,/正\/侧\/背全部最终图片/)
  assert.match(method,/不能作为PASS理由/)
  assert.match(method,/is_active_output/)
  assert.match(method,/scene\.collection\.children\.link\/unlink/)
  assert.match(method,/object\.users_collection/)
  assert.match(method,/不要访问 LayerCollection\.hide_render/)
  assert.match(method,/Collection\.hide_render/)
  assert.match(method,/LayerCollection\.exclude/)
  const workspaceText=buildRequest(project(),'model','C:/agh-workspace').map(block=>block.text||'').join('\n')
  assert.match(workspaceText,/C:\/agh-workspace\/three-view-assets/)
  assert.match(workspaceText,/不是Blender安装目录/)
  const saved=project();saved.runs.push({action:'analyze',text:'保存的比例分析'})
  assert.ok(buildRequest(saved,'model').some(block=>block.type==='text'&&block.text.includes('保存的比例分析')))
})
test('current session commands prompt used without model selection or direct API',async()=>{
  let blocks
  let called = false
  const artifact = { sha256: 'a'.repeat(64), size: 100, mime: 'image/png' }
  const session={sessionId:'current',projection:{read:async()=>({status:'available',value:{opState:null,upto:called?10:1,nodes:called?[
    {kind:'assistant',seq:10,text:'真实回复'},
    {kind:'tool',seq:4,resultSeq:9,name:'mcp_get_screenshot_of_window_as_image',status:'completed'},
  ]:[]}})},handle:{readToolDetail:async()=>({result:{content:[{type:'image',ref:artifact,mime:'image/png'}]}})},commands:{prompt:async c=>{blocks=c;called=true;return {reason:'completed',lastSeq:10}}}}
  const result=await submitProject(session,project(),'analyze')
  assert.equal(result.sessionId,'current');assert.equal(blocks.filter(b=>b.type==='image').length,3)
  assert.equal(result.text,'真实回复');assert.equal(result.tools.length,1);assert.deepEqual(result.screenshots,[artifact])
  for (const [changed, pythonError] of [[false,false],[true,false],[true,true]]) {
    let finished=false
    const session2={sessionId:'current',commands:{prompt:async()=>{finished=true;return {reason:'completed',lastSeq:8}}},projection:{read:async()=>({status:'available',value:{opState:null,upto:finished?8:1,nodes:finished?[
      {kind:'tool',seq:2,name:'three_view_read_render',status:'completed'},
      {kind:'tool',seq:4,name:'mcp_blender_official_execute_blender_code',status:'completed'},
      {kind:'tool',seq:6,name:'three_view_read_render',status:'completed'},
    ]:[]}})},handle:{readToolDetail:async seq=>seq===4?({result:{isError:false,content:[{type:'text',text:JSON.stringify(pythonError?{status:'error',message:'Traceback'}:{status:'ok',result:{changed:true}})}]}}):({result:{isError:false,structured:{ok:true,view:'front',path:`three-view-assets/test/${seq}.png`,artifact:{...artifact,sha256:seq===6&&changed?'b'.repeat(64):artifact.sha256}},content:[{type:'resource_link',mimeType:'image/png',uri:'artifact://'+(seq===6&&changed?'b'.repeat(64):artifact.sha256)}]}})}}
    const checked=await submitProject(session2,project(),'refine')
    assert.equal(checked.renderReads.length,2)
    assert.equal(checked.screenshots.length,changed?2:1)
    assert.equal(checked.feedbackCycle,changed&&!pythonError)
    assert.match(checked.feedbackError,/缺少正侧背/)
  }
})
test('review requires three current task artifacts and preserves the final verdict',async()=>{
  for(const mode of ['success','failure','old','wrong-task','missing-link','cancelled']) {
    const p=project(), calls=[]
    const artifact={sha256:'a'.repeat(64),mime:'image/png',size:100}
    const session={sessionId:'a',handle:{readToolDetail:async seq=>({result:{isError:false,structured:{ok:true,view:['front','side','back'][seq-2],path:`three-view-assets/${mode==='wrong-task'?'other':p.id}/${seq}.png`,artifact},content:mode==='missing-link'?[]:[{type:'resource_link',uri:'artifact://'+artifact.sha256,mimeType:'image/png'}]}})},
      projection:{read:async()=>({status:'available',value:{opState:null,upto:calls.length?10:mode==='old'?9:1,nodes:calls.length?[
        ...[2,3,4].map(seq=>({kind:'tool',seq,name:'three_view_read_render',status:'completed'})),
        {kind:'assistant',seq:8,text:'initial PASS'},...(calls.length===2?[{kind:'assistant',seq:12,text:'final PARTIAL'}]:[])
      ]:[]}})},commands:{prompt:async content=>{calls.push(content);if(calls.length===2&&mode==='failure')throw Error('review unavailable');return {reason:mode==='cancelled'?'cancelled':'completed',lastSeq:calls.length===2?12:10}}}}
    const result=await submitProject(session,p,'model')
    assert.equal(calls.length,['success','failure'].includes(mode)?2:1)
    if(mode==='success') {
      assert.equal(result.text,'final PARTIAL');assert.equal(result.initialText,'initial PASS')
      assert.equal(calls[1].filter(b=>b.type==='image').length,3)
      assert.match(calls[1][0].text,/只读复核/)
      assert.ok(calls[1].some(b=>b.text?.includes(p.id+'/2.png')))
      assert.ok(!calls[1].some(b=>b.text?.includes('## 粗模阶段')))
    }
    if(mode==='failure')assert.match(result.feedbackError,/复核失败/)
    if(['old','wrong-task','missing-link'].includes(mode))assert.match(result.feedbackError,/缺少正侧背/)
  }
})
test('stage timeout requests cancellation and does not start review',async()=>{
  let resolvePrompt,cancelled=0
  const session={sessionId:'a',projection:{read:async()=>({status:'available',value:{opState:null,upto:0,nodes:[]}})},commands:{prompt:()=>new Promise(resolve=>{resolvePrompt=resolve}),cancel:async()=>{cancelled++;resolvePrompt({reason:'cancelled'})}}}
  const result=await submitProject(session,project(),'model',{taskTimeoutMs:5})
  assert.equal(cancelled,1);assert.equal(result.result.reason,'timeout');assert.equal(result.verificationResult,null)
  assert.match(result.feedbackError,/时间上限/)
})
test('busy or switched session prevents submission',async()=>{
  const session={sessionId:'a',commands:{prompt:()=>{throw Error('must not run')}},projection:{read:async()=>({status:'available',value:{opState:{}}})}}
  await assert.rejects(submitProject(session,project(),'analyze'),/正在执行/)
  session.projection.read=async()=>{session.sessionId='b';return {status:'available',value:{opState:null}}}
  await assert.rejects(submitProject(session,project(),'analyze'),/切换/)
})
test('layout stays inside desktop and mobile screen',()=>{
  for(const [w,h] of [[1920,1080],[375,667]]){
    const r=clampLayout({x:9000,y:9000,width:9000,height:9000},w,h)
    assert.ok(r.x+r.width<=w);assert.ok(r.y+r.height<=h)
  }
})
