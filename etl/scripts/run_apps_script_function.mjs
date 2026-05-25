import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import querystring from 'node:querystring'

const scriptId = process.argv[2]
const functionName = process.argv[3]
const params = process.argv[4] ? JSON.parse(process.argv[4]) : []
const tokenName = process.argv[5] || 'default'

if (!scriptId || !functionName) {
  console.error('Usage: node etl/scripts/run_apps_script_function.mjs <scriptId> <functionName> <jsonParamsArray> [tokenName]')
  process.exit(1)
}

const rcPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.clasprc.json')
const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
const token = rc.tokens?.[tokenName]
if (!token) throw new Error(`Missing clasp token: ${tokenName}`)

function request(method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || ''
    const headers = { ...(options.headers || {}) }
    if (body) headers['Content-Length'] = Buffer.byteLength(body)
    const req = https.request(url, { method, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        const parsed = data ? JSON.parse(data) : {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`${method} ${url} failed with ${res.statusCode}`)
          error.response = parsed
          reject(error)
        } else {
          resolve(parsed)
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function accessToken() {
  const body = querystring.stringify({
    client_id: token.client_id,
    client_secret: token.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token',
  })
  const refreshed = await request('POST', 'https://oauth2.googleapis.com/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return refreshed.access_token || token.access_token
}

async function main() {
  const bearer = await accessToken()
  const result = await request('POST', `https://script.googleapis.com/v1/scripts/${scriptId}:run`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      function: functionName,
      parameters: params,
      devMode: true,
    }),
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error.response ? JSON.stringify(error.response, null, 2) : error.stack || error)
  process.exit(1)
})
