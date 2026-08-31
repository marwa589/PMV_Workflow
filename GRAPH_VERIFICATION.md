# Live Graph Verification Guide

## Step 1: Start the app

```powershell
npm run start
```

Wait until you see:
```
> ready - started server on 0.0.0.0:3000, url: http://localhost:3000
```

## Step 2: Run the verification script

In a new terminal:

```powershell
cd "C:\Users\Dell\Desktop\MARWA\PMV_AWF\PMV_Workflow"
node scripts/verify-graph-sync.mjs
```

This will show:
- Recently synced versions with full Graph metadata
- Unsynced or partial versions (waiting for sync)
- Recent Graph upload/delete audit events
- Overall sync rate

## Step 3: Create and upload a test document

1. Open http://localhost:3000 and log in as a clerk
2. Click "New Document" or use the upload flow
3. Select a test PDF and submit
4. Watch for upload success in the UI

## Step 4: Check database immediately after upload

Run the verification script again:

```powershell
node scripts/verify-graph-sync.mjs
```

You should see:
- ✅ Your new document in "Recently Synced Versions"
- `driveId`, `itemId`, `webUrl` all populated
- `graphUploadedAt` timestamp recent
- Audit log entry with status="success"

## Step 5: Verify the file is accessible in Graph

Copy the `webUrl` from the verification output and:
1. Open it in your browser
2. Should show the PDF or download prompt
3. If access denied → Graph permissions issue

## Step 6: Test deletion

1. Go back to the app and delete the document
2. Run verification script again

You should see:
- Document removed from "Recently Synced Versions"
- New audit log entry: `GRAPH_DELETE_RESULT` with status="success"
- File no longer accessible at the webUrl

## Expected Behavior

### Upload Flow
```
Local Save ✓
  → Graph Upload ✓
    → Metadata Write (driveId, itemId, webUrl) ✓
      → Audit Log "success" ✓
```

### Delete Flow
```
Local Delete ✓
  → Graph Delete ✓
    → Audit Log "success" ✓
```

### If Graph upload fails (network, auth, etc.)
```
Local Save ✓
  → Graph Upload ✗
    → Audit Log "failed" with error message ✓
    → No metadata written (driveId/itemId stay null)
```

## Troubleshooting

### No synced versions appear
- Check env vars: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `PMV_DRIVE_ID`
- Check app logs for Graph errors
- Verify Graph access token is obtained successfully

### Versions appear but metadata is incomplete
- This should not happen now (enforced in `uploadSavedFileToGraph`)
- If it does, check the audit log for the error message

### Metadata exists but webUrl is inaccessible
- Check if the Graph folder path is correct
- Verify OneDrive folder permissions
- Ensure `PMV_DRIVE_ID` points to a valid shared drive
