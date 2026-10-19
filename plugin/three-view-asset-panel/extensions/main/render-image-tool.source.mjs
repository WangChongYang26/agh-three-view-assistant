import { resolve, relative, isAbsolute, extname, basename } from 'node:path'
import { decodeSafeImageBytes } from '@agnes/protocol-validation'
const MAX_BYTES = 4 * 1024 * 1024
const MAX_PIXELS = 1456 * 1456
const Kind = Symbol.for('TypeBox.Kind')
export function workspaceTool() {
  return {
    name:'three_view_workspace',
    description:'Get the authoritative AGH session workspace and render root before Blender rendering. Blender os.getcwd() is NOT the AGH workspace. Does not read files or modify anything.',
    parameters:{[Kind]:'Object',type:'object',properties:{},required:[],additionalProperties:false},
    meta:{isReadOnly:true,isDestructive:false,isConcurrencySafe:true,isOpenWorld:true,replay:'safe',costHint:undefined,deferLoading:false,requiresApproval:'never'},
    async execute(_input,ctx) {
      const data={cwd:ctx.cwd,renderRoot:resolve(ctx.cwd,'three-view-assets')}
      return {content:[{type:'text',text:JSON.stringify(data)}],structured:data}
    },
  }
}
export function renderImageTool() {
  return {
    name: 'three_view_read_render',
    description: 'Read a saved Blender PNG/JPEG render as REAL IMAGE content for visual self-review. Use after rendering; ordinary text read cannot show an image. Reads only current workspace three-view-assets directory. Call one view at a time; render at <=1456 pixels per edge and <=4 MiB. The returned image is available to this same AGH model; compare it to original references before modifying.',
    parameters: { [Kind]:'Object', type:'object', properties:{ path:{[Kind]:'String',type:'string',maxLength:1024,description:'Absolute path or workspace-relative three-view-assets/.../front.png'}, view:{[Kind]:'String',type:'string',enum:['front','side','back','perspective']} }, required:['path','view'],additionalProperties:false },
    meta:{isReadOnly:true,isDestructive:false,isConcurrencySafe:true,isOpenWorld:true,replay:'safe',costHint:undefined,deferLoading:false,requiresApproval:'never'},
    async execute(input, ctx) {
      try {
        if (!input || typeof input.path !== 'string' || !['front','side','back','perspective'].includes(input.view)) throw new Error('path and view required')
        const root=resolve(ctx.cwd,'three-view-assets')
        const path=resolve(ctx.cwd,input.path)
        const local=relative(root,path)
        if (!local || local==='..' || local.startsWith(`..${process.platform==='win32'?'\\':'/'}`) || isAbsolute(local)) throw new Error('Render must be under current workspace three-view-assets. Select the asset workspace in AGH.')
        const ext=extname(path).toLowerCase()
        if (!['.png','.jpg','.jpeg'].includes(ext)) throw new Error('Only PNG/JPEG render files are allowed')
        const segments=local.split(/[\\/]/)
        let directory=root
        for (const segment of ['.', ...segments.slice(0,-1)]) {
          if(segment!=='.')directory=resolve(directory,segment)
          const folder=await ctx.fs.stat(directory)
          if(folder.kind!=='dir')throw new Error('Render directory must be a regular directory, not a link')
        }
        const stat=await ctx.fs.stat(path)
        if (stat.kind!=='file' || stat.size<1 || stat.size>MAX_BYTES) throw new Error('Render is missing, not a regular file, or exceeds 4 MiB')
        ctx.signal.throwIfAborted()
        const bytes=await ctx.fs.read(path)
        const image=decodeSafeImageBytes({bytes,mimeType:ext==='.png'?'image/png':'image/jpeg'}, {maxBytesPerImage:MAX_BYTES,maxPixelsPerImage:MAX_PIXELS,maxAggregateBytes:MAX_BYTES,maxAggregatePixels:MAX_PIXELS})
        if(image.width>1456||image.height>1456)throw new Error('Render edge exceeds 1456px; render a smaller review image')
        const ref=await ctx.artifacts.put(image.bytes,{mime:image.mime,name:`render-${input.view}-${basename(path)}`})
        // The reference set lives in the same directory tree, so a fixed claim that every file is a
        // Blender output would be false whenever the agent reads an original reference image.
        // before_* files are the initial Blender renders used for before/after comparisons.
        // Explicit reference directories and target/original/source/rN names identify references.
        const file=basename(local)
        const referenceCopy=/(?:^|[\\/])(?:reference|references)[\\/]/i.test(local)
          || /^r\d+[_-]/i.test(file)
          || /^(?:target|original|source)[_-]/i.test(file)
        const kind=referenceCopy?'reference-copy':'render'
        const note=referenceCopy
          ? 'This is a copy of an original reference image, not a Blender render. Use it as evidence about the target; do not treat it as your own output.'
          : 'This is your actual Blender output, not the target. Inspect it visually; file existence and successful tool execution are not quality checks.'
        return {content:[{type:'text',text:JSON.stringify({ok:true,view:input.view,path,kind,width:image.width,height:image.height,note})},{type:'image',ref,mime:image.mime}],structured:{ok:true,path,view:input.view,kind,width:image.width,height:image.height,artifact:ref}}
      } catch(error) {
        if(ctx.signal.aborted)throw error
        return {isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:String(error.message),next:'Fix render path/size first. Do not claim visual verification or replace images with text descriptions.'})}]}
      }
    },
  }
}
