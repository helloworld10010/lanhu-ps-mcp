#!/usr/bin/env node
/**
 * lanhu-ps-mcp —— 蓝湖 PS 设计稿 MCP Server
 *
 * 工具列表:
 *   lanhu_ps_get_design  - 获取 PS 设计稿结构化数据
 *   lanhu_ps_get_screenshot - 获取设计稿预览图
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { parsePSJson, collectImageRefs } from './parser.js'
import { getDesignData, getPreviewUrl } from './api.js'

const server = new Server(
  { name: 'lanhu-ps-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

// ── 工具列表 ──
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'lanhu_ps_get_design',
      description:
        '获取蓝湖 PS 设计稿的结构化数据（图层树 + UnoCSS class + 文字内容 + 图片引用）。适用于 Photoshop 版设计稿。',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '蓝湖设计稿 URL（需含 pid, tid, image_id）',
          },
          image_id: {
            type: 'string',
            description: '设计图 ID（URL 中没有时可单独传）',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'lanhu_ps_get_screenshot',
      description: '获取蓝湖 PS 设计稿的预览图 URL。',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '蓝湖设计稿 URL',
          },
          image_id: {
            type: 'string',
            description: '设计图 ID',
          },
        },
        required: ['url'],
      },
    },
  ],
}))

// ── URL 解析（提取 pid / tid / image_id） ──
function parseUrl(url) {
  const result = {}
  // 支持两种格式：
  // stage?tid=xxx&pid=xxx&image_id=xxx
  // detailDetach?pid=xxx&project_id=xxx&image_id=xxx
  const paramsStr = url.split('?')[1] || ''
  for (const pair of paramsStr.split('&')) {
    const [k, v] = pair.split('=')
    if (k === 'pid' || k === 'project_id') result.projectId = decodeURIComponent(v)
    if (k === 'tid' || k === 'team_id') result.teamId = decodeURIComponent(v)
    if (k === 'image_id') result.imageId = decodeURIComponent(v)
  }
  return result
}

// ── 调用分发 ──
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    // ── lanhu_ps_get_design ──
    if (name === 'lanhu_ps_get_design') {
      const parsed = parseUrl(args.url)
      const imageId = args.image_id || parsed.imageId
      const projectId = parsed.projectId
      const teamId = parsed.teamId

      if (!projectId || !teamId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: 'URL 缺少 pid 或 tid 参数' }, null, 2) }],
          isError: true,
        }
      }

      if (!imageId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'need_image_id', message: '请提供 image_id 参数' }, null, 2) }],
        }
      }

      const { psRoot, sliceScale, meta } = await getDesignData(projectId, imageId, teamId)
      const nodes = parsePSJson(psRoot, sliceScale)

      const result = {
        status: 'success',
        meta,
        sliceScale,
        nodes,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }

    // ── lanhu_ps_get_screenshot ──
    if (name === 'lanhu_ps_get_screenshot') {
      const parsed = parseUrl(args.url)
      const imageId = args.image_id || parsed.imageId
      const projectId = parsed.projectId
      const teamId = parsed.teamId

      if (!projectId || !teamId || !imageId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: 'URL 缺少必要参数' }, null, 2) }],
          isError: true,
        }
      }

      const previewUrl = await getPreviewUrl(projectId, imageId, teamId)

      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'success', previewUrl }, null, 2) }],
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: `未知工具: ${name}` }, null, 2) }],
      isError: true,
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: err.message }, null, 2) }],
      isError: true,
    }
  }
})

// ── 启动 ──
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
