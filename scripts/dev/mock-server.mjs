import http from 'node:http'
import fs from 'node:fs'
import { parse } from 'csv-parse/sync'
const churnInput = parse(fs.readFileSync('tests/fixtures/ml/churn-input.csv', 'utf8'), { columns: true })
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(churnInput))
})
server.listen(12345, () => console.log('Mock server running on 12345'))
