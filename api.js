/**
 * 蓝湖 API 客户端 —— 复用 starql lanhu-mcp 的 cookie
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE_URL = 'https://lanhuapp.com'
const COOKIE_PATH = path.join(os.homedir(), '.lanhu-mcp', 'cookie.json')

/** 读取已保存的 cookie */
function loadCookie() {
  try {
    const raw = fs.readFileSync(COOKIE_PATH, 'utf-8')
    const data = JSON.parse(raw)
    return data.cookie || ''
  } catch {
    return null
  }
}

/** 发起 HTTP 请求 */
async function request(url, cookie) {
  const headers = {
    Cookie: cookie,
    Referer: 'https://lanhuapp.com/',
    'User-Agent': 'Mozilla/5.0',
  }

  const resp = await fetch(url, { headers })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
  }
  return resp.json()
}

/**
 * 获取设计稿结构化数据
 * @param {string} projectId
 * @param {string} imageId
 * @param {string} teamId
 * @returns {Promise<{psRoot: object, sliceScale: number, meta: object}>}
 */
export async function getDesignData(projectId, imageId, teamId) {
  const cookie = loadCookie()
  if (!cookie) {
    throw new Error('未找到蓝湖登录 Cookie，请先使用 lanhu2 MCP 登录')
  }

  // Step 1: 获取 json_url
  const params = new URLSearchParams({
    image_id: imageId,
    project_id: projectId,
    team_id: teamId,
    dds_status: '1',
  })
  const imageResp = await request(`${BASE_URL}/api/project/image?${params}`, cookie)

  if (imageResp.code !== '00000' || !imageResp.result) {
    throw new Error(`API 返回错误: ${imageResp.msg || '未知错误'}`)
  }

  const version = imageResp.result.versions?.[0]
  if (!version?.json_url) {
    throw new Error('设计稿没有 json_url，可能是旧版设计稿')
  }

  // Step 2: 下载原始 PS JSON
  const rawJson = await request(version.json_url, cookie)

  // PS JSON 顶层结构: { info: [...], sliceScale, psVersion, ... }
  const psRoot = rawJson.info?.[0]
  if (!psRoot) {
    throw new Error('无法解析 PS JSON 数据')
  }

  return {
    psRoot,
    sliceScale: rawJson.sliceScale || 2,
    meta: {
      psVersion: rawJson.psVersion,
      width: version.width,
      height: version.height,
      name: imageResp.result.name,
    },
  }
}

/**
 * 获取设计稿预览图 URL
 */
export async function getPreviewUrl(projectId, imageId, teamId) {
  const cookie = loadCookie()
  if (!cookie) throw new Error('未找到登录 Cookie')

  const params = new URLSearchParams({
    image_id: imageId,
    project_id: projectId,
    team_id: teamId,
    dds_status: '1',
  })
  const resp = await request(`${BASE_URL}/api/project/image?${params}`, cookie)
  return resp.result?.versions?.[0]?.url || resp.result?.url || null
}
