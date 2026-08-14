import os
import requests
import pandas as pd
import time

def read_supabase(table_or_view, order_by_col=""):
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "count=none"
    }
    
    all_data = []
    limit = 1000
    offset = 0
    
    # bounded retries with exponential backoff for 429 and 5xx
    max_retries = 5
    
    while True:
        headers["Range-Unit"] = "items"
        headers["Range"] = f"{offset}-{offset + limit - 1}"
        
        endpoint = f"{url}/rest/v1/{table_or_view}"
        if order_by_col:
            endpoint += f"?order={order_by_col}"
            
        success = False
        for attempt in range(max_retries):
            try:
                res = requests.get(endpoint, headers=headers, timeout=30)
                if res.status_code in (429, 500, 502, 503, 504):
                    raise requests.exceptions.RequestException(f"Transient error {res.status_code}")
                res.raise_for_status()
                success = True
                break
            except requests.exceptions.RequestException as e:
                if attempt == max_retries - 1:
                    raise SystemExit(f"Failed to fetch {table_or_view} after {max_retries} attempts: {e}")
                time.sleep((2 ** attempt))
                
        if not success:
            break
            
        try:
            data = res.json()
        except Exception as e:
            raise SystemExit(f"Invalid JSON from Supabase: {e}")
            
        if not isinstance(data, list):
            raise SystemExit(f"Invalid response from Supabase, expected a JSON list, got: {type(data)}")
            
        all_data.extend(data)
        if len(data) < limit:
            break
        offset += limit
        
    return pd.DataFrame(all_data)
