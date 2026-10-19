# 三视图资产插件

AGH 当前会话中的三视图任务面板。图片不依赖聊天上下文保存；每次分析、建模和修正都会重新提交三张图。

## 安装与兼容基线

插件 ID 为 `@local/three-view-asset-panel`，版本为 `0.7.1`。本目录是 AGH 插件源码包，不包含 AGH 运行时或模型密钥。安装顺序为准备 AGH → 核对并应用必要的兼容补丁 → 构建和启动 AGH → 配置官方 MCP → 安装、信任并启用插件。

### AGH 兼容补丁

本次兼容基线为官方仓库 `https://github.com/AgnesAI-Labs/agnes-harness` 的提交 `cde816b88c737b9fd04e7ef55b899e7b4cd55eb7`。需从该基线复现时，在独立目录获取源码；以下 `agh-source` 应是尚不存在的新目录。已有其他版本时先核对兼容性，不覆盖现有工作区。

```text
git clone https://github.com/AgnesAI-Labs/agnes-harness.git agh-source
cd agh-source
git checkout cde816b88c737b9fd04e7ef55b899e7b4cd55eb7
```

在 AGH 源码根目录，使用本插件 `compat/agh-blender-compat.patch` 的绝对路径依次执行：

```text
git apply --check "<插件绝对目录>/compat/agh-blender-compat.patch"
git apply "<插件绝对目录>/compat/agh-blender-compat.patch"
```

随后按该提交的 `docs/guide/install.zh-CN.md` 准备 Node.js、pnpm 与 Windows 原生构建前置，在源码根目录构建：

```text
pnpm install --frozen-lockfile
pnpm --filter @agnes/cli build:local
```

构建后的运行入口为 `packages/cli/dist/local/agnes.mjs`；按官方文档启动工作台。补丁仅处理超长 MCP 工具名与 `three_view_read_render` 图片生产者授权；Blender 业务错误映射在插件钩子内，不再另改 AGH base。检查失败时先核对基线或是否已应用，勿强行应用。已包含等效修复的版本不重复打补丁。

### 官方 Blender MCP

从 Blender Lab 官方扩展库 `https://lab.blender.org/` 安装并启用 MCP addon，在 Blender 启动官方服务。官方 Python MCP 服务端来源为 `https://projects.blender.org/lab/blender_mcp`，按其说明安装 `mcp` 子目录的 Python 包。不要同时启动旧版或自制的同端口服务。

在 AGH 的“设置 → MCP”填写服务 ID `blender-official`、显示名称 `Blender 官方 MCP`、传输“本地 stdio”、可执行文件为安装了该包的 Python 完整路径、凭据“无凭据”。参数栏按“每行一个”填写两行，不能合写成一个参数：

```text
-m
blmcp
```

审核定义并启用服务器。用官方场景摘要工具确认连接，再进入插件建模阶段；摘要超时应先排查官方服务连接，不绕过插件直接生成模型。

### 插件安装

1. 启动 AGH 工作台，进入“设置 → 插件 → 从来源安装”。
2. 来源填写 `file:<本插件绝对目录>`，例如 `file:C:/材料/plugin/three-view-asset-panel`，选择检查来源并安装。
3. 核对插件 ID、来源和能力并确认启用，确认状态为 `running`。普通 Web 流程在启用确认时完成审核与摘要绑定，不需要另找独立“信任”按钮。
4. 返回当前会话，打开“三视图资产”面板，并按下文顺序操作。会话工作目录应是本次任务工作区。

源码或说明修改后应通过工作台的“从新来源更新”或官方 SDK 包生命周期更新，重新核对完整性与信任；不直接修改 AGH 已安装的运行快照。上述入口依据本次基线的官方插件与 MCP 文档，其他版本的界面可能不同。

## 使用

1. 选择一个 AGH 会话及支持图片的模型。
2. 拖入正面、侧面、背面照片，填写尺寸或补充要求。
3. 点击“分析三视图”，等待分析完成并检查尺寸、部件关系与要求。
4. 点击“自动建模与自检”，等待实际 Blender 执行、模型保存、渲染与图片读回。
5. 需要继续修正时点击“自动对照校正”，等待该阶段完成。
6. 最后点击“查看 Blender”；窗口截图不可用时，只读回退到本任务已保存的渲染图。每个阶段结束后再启动下一阶段。模型的判断与修正效果以工具记录和结果图为准。

拖动标题栏移动，右下角调大小；可以折叠和收起。图片、原图、任务记录保存到当前浏览器同源 IndexedDB。清理浏览器数据会丢失本地项目，因此提供导出备份和导入备份。备份含原始照片，请按私人文件保管。

## 运行边界

插件使用 AGH 的 `ctx.session.commands.prompt`，不另选模型，不直接调用模型 API，不保管 API Key。AGH 仍负责模型支持检查、工具可用性与审批。模型不能看图、账号认证错误或 Blender 未启动时，插件不能替代外部服务。

建模和修正是发送给 Agent 的任务，不是固定建模算法。指令限定 Blender Lab 官方实时 MCP、保留现有对象并在独立集合工作。模型是否遵守及最终几何质量仍需检查 AGH 工具记录和截图。

建模/校正阶段要求实际调用官方实时工具，不以计划、代码块或聊天确认代替执行。每次工具审批仍由AGH正常机制处理，未批准不执行；失败如实报告，不声称已创建资产。开发期机器人测试已有官方工具执行、报错恢复和真实图片读回记录；这不构成全程无干预或视觉质量通过的声明。

会话已结束不等于模型成功。插件保存实际回复、工具状态和截图引用；截图只在其所属会话中通过 AGH 授权接口读取，资源被回收时会显示错误。

## AGH 内部读图

`three_view_read_render` 工具读取当前会话工作区 `three-view-assets/` 下的 PNG/JPEG，通过 AGH 官方图片安全校验后返回真实图像 artifact。普通文本 read 的分页会损坏二进制；该工具使用原始字节读取。单图最多4MiB、边长1456、拒绝目录和符号链接、越界路径与损坏图片；使用会话自己的文件权限和 artifact 存储。

AGH daemon 的图片资源投影增加了该明确工具名的成功、不受信任图片结果，不允许任意其他工具冒充生产者；会话/用户归属和回收限制仍然有效。新工具结果在 ledger 中为 resource_link，插件根据经核对的结构化artifact展示图片。

Skill 要求模型在 AGH 内完成“读修改前图→判断偏差→修改→读修改后图”，最多两轮几何修正。当前版本的交付review仅重附原图并读取已保存的三张最终图片，不再授予新的修正预算，也不要求重渲染；这是模型指令约束，不是Blender Python安全沙箱。只有本次任务三个视角均有核验的图片artifact才启动review，旧会话读图记录不能触发。read-only复核不保证模型一定服从，需结合工具记录判断。

单次model/refine/analyze阶段默认20分钟上限，review默认5分钟；超时请求取消原会话，不自动重试。取消是协作机制，正在运行的MCP动作不保证立即中止，失败时会报告。未得到价格时0估算不代表免费，限时控制不依赖credits。反馈闭环要求同视角前后不同hash与中间成功Blender执行（内部status:error不算成功）；该记录证明执行反馈，不证明质量改善。

模型建模前调用three_view_workspace取得权威AGH工作区，不能用Blender进程os.getcwd()。图片安全边界不变。

Blender 执行错误映射由插件的 `tool_result` transform 钩子负责，无需 AGH base 的 Blender 专用错误映射补丁。仅匹配 `blender-official` 在当前 AGH 命名规则下的两个完整本地工具名：`mcp_blender_official_2d590ef9_execute_blender_code` 和 `mcp_blender_official_2d590ef9_execute_blender_code_for_cli`。文本块必须能解析为非数组 JSON 对象，且顶层 `status` 为 `error`、`message` 为字符串，才设置 `isError=true`；保留原内容、其他结果字段和已有错误。其他服务器及其他工具不受影响。

钩子接收的是 AGH 已处理的结果；若输出保护已截断或包裹 JSON，导致文本块无法完整解析，本规则不会映射，而原 base 补丁检查的是处理前的原始 MCP 文本。钩子的 waterfall/open 行为由 AGH 提供，处理超时或失败时保留原结果。插件必须经 AGH 信任并启用后才会注册该钩子；源码修改后需通过工作台“从新来源更新”或官方 SDK 的 packages.update 更新并重新审核。本映射只修改结果的 `isError`，不修复 verifier，也不保证界面最终显示为 failed；开发期机器人测试的三次 Python 执行失败均记录 isError=true，之后有成功执行与读图；这些是历史测试摘要，公开仓库不包含原始私人会话。

## 验证

- `plugin.test.mjs`：三图标签与 image block、当前会话、忙碌与切换阻止、布局边界、结果和截图引用。
- `blender-execution-result.test.mjs`：实际 runtime 注册的 `tool_result` 钩子、两种执行工具、错误映射边界、已有错误及原内容和字段保留。
- `image-submission.test.mjs`：提交尺寸、旧项目迁移、原图与备份保留。
- `render-image.test.mjs`：读图路径、格式、尺寸与错误边界。
- `image-submission.browser.html`：真实浏览器 Canvas/JPEG、旧记录迁移及备份导入验证。该入口需要独立本地 HTTP 服务，不直接双击打开。

隔离测试使用模拟会话，不代表真实模型建模成功。实际部署通过 AGH 官方 SDK package update，校验完整性和能力哈希，不手改运行快照。
## 参考图提交尺寸兼容

面板保留上传原 File 和原图备份 bytes；给 AGH 的 JPEG 提交副本等比例缩小到长边最多 1456 像素（匹配 AGH local-dev 的 session-image 重读上限），不裁切、不放大小图。界面及运行记录分别显示原图和提交尺寸。旧 IndexedDB 项目在下一次分析/建模/校正前自动从保留原图重建副本；缺原 File 时以保留的数据 URL 生成副本，同时保留该旧数据用于备份。导入备份也保留原图 bytes。

`node --test *.test.mjs` 包含尺寸、旧项目迁移、原图备份契约测试；`image-submission.browser.html` 可在独立本地 HTTP 页面点击运行真实 Canvas/JPEG/备份导入验证（仅生成合成图片，不调用模型或 MCP）。这些是组件验证，不代替模型与 Blender 的实际运行；历史运行结果见仓库根目录 README；本仓库不分发私人诊断包。

已有组件验证：4 个 Node 测试文件合计 23 项通过，其中 plugin.test.mjs 为 9 项，不另计为新增专项测试。独立浏览器真实 Canvas 验证包含 832×1504→805×1456、4000×2000→1456×728、小图保持、旧记录迁移和备份/导入原图 bytes 保留。

在本插件目录执行 `node --test *.test.mjs`；或者在提交材料根目录执行 `node --test ./plugin/three-view-asset-panel/*.test.mjs`。组件测试不代替 Blender 现场运行验证。

## 示例与来源

`examples/isolated-blue-box/references/` 提供程序生成的三张 512×512 合成测试图。上传这三张图可检查输入与阶段流程；本公开包不包含预生成的 .blend 或渲染结果，运行时应通过插件实际创建、保存、渲染与读回。

原创插件代码按仓库根目录 MIT LICENSE 提供；复用 AGH 的图片校验代码保留 Apache-2.0 授权与原始 NOTICE，见本目录 third-party。
