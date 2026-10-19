# AGH 三视图建模与视觉自纠正助手

在 AGH（Agnes Harness）会话中上传正面、侧面、背面参考图，分阶段完成分析、Blender 建模与自检、按需修正和结果查看。

插件通过 **Blender Lab 官方 MCP** 操作 Blender，将实际渲染图片读回同一个 AGH 会话，让模型对照参考图判断偏差。它是 AGH 插件，不是独立应用，也不是单独的 Blender MCP 服务端。

[演示视频](https://www.bilibili.com/video/BV184pS67Ebo/)

## 使用流程

1. 上传正面、侧面、背面三张参考图，填写尺寸和补充要求。
2. 点击 **分析三视图**，等待完成并检查分析结果。
3. 点击 **自动建模与自检**，等待实际创建场景、保存 `.blend`、渲染与读图。
4. 如需继续修正，点击 **自动对照校正**，等待该阶段完成。
5. 点击 **查看 Blender**；窗口截图不可用时，读取本任务已有渲染图。

各阶段完成后再操作下一阶段。工具审批由 AGH 正常处理；模型生成质量仍需结合图像和工具记录检查。

## 功能

- 三图上传、原图保存、IndexedDB 持久化及备份导入导出。
- 提交副本等比例缩小到最长边 1456 像素，不裁切、不放大小图。
- `three_view_workspace` 提供当前会话的权威工作区。
- `three_view_read_render` 读取真实 PNG/JPEG，并通过 AGH 图片授权机制送回会话。
- `tool_result` waterfall 钩子把指定官方 Blender 执行工具返回的完整 `status:error` JSON 映射为 `isError=true`。
- 阶段超时控制、会话切换检查，以及最终三图的只读复核指令。

## 安装

插件版本：`@local/three-view-asset-panel` **0.7.1**。

开发验证环境为 Windows 11、Node.js 24.21.0、pnpm 10.34.5、Blender 5.2.2。AGH 兼容补丁基线为 `cde816b88c737b9fd04e7ef55b899e7b4cd55eb7`，其他 AGH 版本需要先核对兼容性。

1. 准备 AGH 与 Blender；按需检查并应用随包的兼容补丁，再构建、启动 AGH。
2. 安装并启动 Blender Lab 官方 MCP addon 和 Python 服务端，在 AGH **设置 → MCP** 配置服务 `blender-official`。
3. 在 AGH **设置 → 插件 → 从来源安装**，来源填写 `file:<克隆目录>/plugin/three-view-asset-panel` 的绝对路径，检查、安装并启用。
4. 确认插件状态为 `running`，选择支持图片的模型和会话，再打开“三视图资产”面板。

**[完整安装步骤与 MCP 参数填写方式](plugin/three-view-asset-panel/README.md#安装与兼容基线)**

补丁位于 [`compat/agh-blender-compat.patch`](plugin/three-view-asset-panel/compat/agh-blender-compat.patch)，只处理超长工具名与自定义读图工具的图片生产者授权。Blender 业务错误映射在插件钩子内实现。

## 仓库结构

```text
README.md                         项目介绍与公开说明
LICENSE                           原创代码的 MIT 许可
plugin/three-view-asset-panel/
  package.json                    AGH 包清单
  README.md                       安装与技术说明
  extensions/main/                runtime 与面板源码
  compat/                         AGH 兼容补丁
  examples/isolated-blue-box/      合成参考三图
  third-party/                    AGH 许可与 NOTICE
  *.test.mjs                      Node 组件测试
  image-submission.browser.html   浏览器 Canvas 验证入口
```

示例参考图由程序生成。模型和渲染结果应通过插件实际生成；仓库不分发 AGH 运行时、私人诊断包、聊天记录、密钥配置或比赛个人信息。

## 测试

在仓库根目录执行：

```sh
node --test ./plugin/three-view-asset-panel/*.test.mjs
```

四个测试文件合计 23 项，覆盖请求与会话约束、原图及备份保留、提交尺寸、读图边界和 Blender 错误映射。其中 `plugin.test.mjs` 的 9 项属于上述总数，不另计。

浏览器验证入口为 [`image-submission.browser.html`](plugin/three-view-asset-panel/image-submission.browser.html)，需要通过独立本地 HTTP 服务打开；它生成合成图片并验证 Canvas/JPEG 与备份，不调用模型或 MCP。组件测试不能替代 Blender 现场验收。

## 历史运行结果与限制

开发期机器人任务使用 DeepSeek，诊断调用别名为 `deepseek-flash`。历史记录包含官方 Blender 执行 19 次成功、3 次失败，真实渲染图读取 25 次成功；最终三视图为 560×1000。相关原始私人诊断不在本仓库公开，这些数字是开发期结果摘要，不是本次重新运行的结果。

生成模型仍有侧面、背面、关节和光照差异。工具执行成功、图片 hash 变化和会话完成均不能单独证明视觉质量通过；本项目不宣称成品级复原或定量重建精度达标。

建模和修正由当前 AGH 模型执行，不是固定几何重建算法。插件不单独选择模型、不直接调用模型 API，也不保存模型密钥。只读复核、独立集合和超时取消属于流程约束，不是任意 Blender Python 的完整安全沙箱。

## 代码与数据来源

原创插件代码按 [MIT](LICENSE) 许可发布。`render-image-tool.mjs` 打包复用了 AGH 图片校验代码；AGH 部分继续遵循 [Apache-2.0](plugin/three-view-asset-panel/third-party/AGH-LICENSE.txt) 和 [原始 NOTICE](plugin/three-view-asset-panel/third-party/AGH-NOTICE.txt)。AGH 兼容补丁是针对同一上游的修改。

Blender MCP 使用 [Blender Lab 官方项目](https://projects.blender.org/lab/blender_mcp)，不在本仓库重新实现或打包。示例参考图为程序生成的合成测试输入。
