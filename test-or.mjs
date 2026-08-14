import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function test() {
  const { data, error } = await supabase.from('facts')
    .select('id, metric, dims')
    .or('metric.ilike.%North%,dims.fts.North')
    .limit(5)
  console.log("Error:", error)
  console.log("Data:", data)
}

test()
