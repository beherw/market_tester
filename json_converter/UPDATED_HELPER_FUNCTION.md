# Updated Helper Function - sql_query Parameter

## What Changed

The `exec_sql` helper function now uses `sql_query` as the parameter name instead of `query`.

## Updated Function in Supabase

```sql
-- 1. Completely delete the old version of the function
DROP FUNCTION IF EXISTS exec_sql(text);

-- 2. Create the new version with the correct parameter name
CREATE OR REPLACE FUNCTION exec_sql(sql_query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_query;
END;
$$;

-- 3. Re-apply the security restrictions
REVOKE EXECUTE ON FUNCTION exec_sql(text) FROM public;
REVOKE EXECUTE ON FUNCTION exec_sql(text) FROM anon;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
```

## Scripts Updated

All sync scripts have been updated to use `sql_query` parameter:

- ✅ `sync_smart.js` - Uses `sql_query`
- ✅ `sync_to_supabase.js` - Uses `sql_query`
- ✅ `create_tables_via_api.js` - Uses `sql_query`

## Usage in Scripts

```javascript
// Correct way to call exec_sql
await supabase.rpc('exec_sql', { sql_query: 'CREATE TABLE ...' });
```

## Verification

To verify the function works:

```sql
-- In Supabase SQL Editor
SELECT exec_sql('SELECT 1');
```

Or test via RPC:
```javascript
const { error } = await supabase.rpc('exec_sql', { 
  sql_query: 'SELECT 1' 
});
```

## Next Steps

1. ✅ Function updated in Supabase (you did this!)
2. ✅ Scripts updated to use `sql_query`
3. ✅ Push to GitHub
4. ✅ Workflow will use correct parameter name

Everything is now synchronized! 🎉
