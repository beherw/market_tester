# Smart Sync Guide

## What This Does

The `sync_smart.js` script:
1. ✅ **Automatically creates tables** using your `exec_sql` helper function
2. ✅ **Infers column types** from CSV data (INTEGER, TEXT, JSONB, BOOLEAN)
3. ✅ **Handles multi-line CSV values** properly
4. ✅ **Syncs data in chunks** (500 rows at a time)
5. ✅ **Creates indexes** automatically on `id` columns

## How It Works

```
1. Read CSV file
   ↓
2. Parse headers and sample data
   ↓
3. Infer column types (INTEGER, TEXT, JSONB, etc.)
   ↓
4. Create table using exec_sql helper function
   ↓
5. Sync data in chunks (upsert/insert)
   ↓
6. Done! ✅
```

## Requirements

### 1. Helper Function Must Exist

You've already done this! ✅
- Run `create_helper_function.sql` in Supabase SQL Editor
- This creates the `exec_sql` function

### 2. CSV Files Ready

The workflow automatically:
- Converts JSON → CSV
- Then syncs CSV → Supabase

## Column Type Inference

The script automatically detects:
- **INTEGER** - All numeric integer values
- **NUMERIC** - Decimal numbers
- **BOOLEAN** - true/false values
- **JSONB** - Arrays and objects
- **TEXT** - Everything else (default)

**Special handling:**
- `id` column → Always `INTEGER PRIMARY KEY`
- Arrays/objects → `JSONB` type

## Usage

### Automatic (GitHub Actions)

Just push to GitHub - the workflow runs `sync_smart.js` automatically!

### Manual Test

```bash
cd json_converter

export SUPABASE_URL="https://dojkqotccerymtnqnyfj.supabase.co"
export SUPABASE_SERVICE_KEY="sb_secret_Lpd3cK-AMqwfBYYaWakH8w_QRQ3f8w5"

node sync_smart.js
```

## What Gets Created

For each CSV file, the script:
1. Creates table with proper column types
2. Sets `id` as PRIMARY KEY (if exists)
3. Creates index on `id` column
4. Syncs all data rows

## Example Table Creation

For `tw_items.csv`:
```csv
id,tw
1,Gil
2,火之碎晶
```

Creates:
```sql
CREATE TABLE IF NOT EXISTS public."tw_items" (
  "id" INTEGER PRIMARY KEY,
  "tw" TEXT
);
CREATE INDEX IF NOT EXISTS idx_tw_items_id ON public."tw_items"(id);
```

## Troubleshooting

### "Helper function exec_sql not found"
- Run `create_helper_function.sql` in Supabase SQL Editor
- Verify function exists: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'exec_sql';`

### "Error creating table"
- Check helper function permissions
- Verify service role key is correct
- Check Supabase logs for detailed errors

### "Column type mismatch"
- The script infers types from sample data
- If wrong, you can manually adjust table schema in Supabase
- Or modify `inferColumnType` function in script

## Advantages Over Manual Creation

✅ **Automatic** - No manual SQL needed  
✅ **Smart** - Infers types from data  
✅ **Flexible** - Handles any CSV structure  
✅ **Safe** - Uses `IF NOT EXISTS`  
✅ **Fast** - Creates tables on-the-fly  

## Next Steps

1. ✅ Helper function created (you did this!)
2. ✅ Push to GitHub
3. ✅ Workflow runs `sync_smart.js`
4. ✅ Tables created automatically
5. ✅ Data synced automatically

**That's it!** 🎉
