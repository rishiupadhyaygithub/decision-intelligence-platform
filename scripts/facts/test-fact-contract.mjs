// scripts/facts/test-fact-contract.mjs
// Guards the shape contract between ml/*.py and the `facts` table.
//
// Why this exists: publish_facts inserts with
// jsonb_populate_recordset(null::facts, new_facts), which ignores any JSON key
// that is not a column. A misnamed key therefore does NOT raise — the column is
// just written as NULL. That is how the ml/*.py port shipped emitting `window`
// while the column is `time_window`: every ML fact landed with a null horizon and
// nothing anywhere complained.
//
// Run: node scripts/facts/test-fact-contract.mjs

import { keyDrift } from './compute.mjs'

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

// The literal shape ml/forecast.py, ml/churn.py and ml/sentiment.py emit today.
const FORECAST_ROW = {
  metric: 'demand_forecast_next',
  dims: { region: 'West' },
  value: 120.5,
  window: 'next_month',
  method: 'ml:holt',
  sample_n: 12,
  confidence: 0.8,
}
const SENTIMENT_ROW = {
  metric: 'signal_sentiment',
  dims: { category: 'pricing' },
  value: -0.33,
  value_text: 'negative',
  window: 'current',
  method: 'ml:rule',
  sample_n: 9,
  confidence: 0.6,
}

check('forecast.py row has no unknown keys', keyDrift(FORECAST_ROW), [])
check('sentiment.py row has no unknown keys', keyDrift(SENTIMENT_ROW), [])
check('a misspelled column is caught', keyDrift({ ...FORECAST_ROW, timewindow: 'x' }), ['timewindow'])
check('several typos are all reported', keyDrift({ ...FORECAST_ROW, smaple_n: 1, conf: 2 }), ['smaple_n', 'conf'])

// `window` must NOT be reported: compute.mjs deliberately remaps it to time_window.
check('window is tolerated (remapped, not dropped)', keyDrift({ window: 'w' }), [])

// The mapping itself — mirrors the projection in computeFacts().
const mapWindow = (f) => f.time_window ?? f.window ?? null
check('window maps onto time_window', mapWindow(FORECAST_ROW), 'next_month')
check('an explicit time_window wins over window', mapWindow({ time_window: 'a', window: 'b' }), 'a')
check('neither present yields null', mapWindow({ metric: 'x' }), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
