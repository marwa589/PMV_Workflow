import { NextResponse } from "next/server";

export const runtime = "nodejs";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function graphDiagnostics(response: Response, body: unknown) {
  return {
    status: response.status,
    requestId: response.headers.get("request-id"),
    clientRequestId: response.headers.get("client-request-id"),
    body,
  };
}

export async function GET() {
  try {
    const tenantId = requiredEnv("GRAPH_TENANT_ID");
    const clientId = requiredEnv("GRAPH_CLIENT_ID");
    const clientSecret = requiredEnv("GRAPH_CLIENT_SECRET");
    const driveId = requiredEnv("PMV_DRIVE_ID");

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
        cache: "no-store",
      },
    );
    const tokenBody = await responseBody(tokenResponse);

    if (!tokenResponse.ok || typeof tokenBody !== "object" || tokenBody === null || !("access_token" in tokenBody) || typeof tokenBody.access_token !== "string") {
      console.error("Graph token request failed", graphDiagnostics(tokenResponse, tokenBody));
      return NextResponse.json({ message: "Unable to obtain a Graph access token.", token: graphDiagnostics(tokenResponse, tokenBody) }, { status: 502 });
    }

    const accessToken = tokenBody.access_token;
    const headers = { Authorization: `Bearer ${accessToken}` };
    // app url working sing general url
    const appFolderUrl = `https://graph.microsoft.com/v1.0/drive/special/approot`;
    // app url using env drive id
    // const appFolderUrl =`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/special/approot`;
    const appFolderResponse = await fetch(appFolderUrl, { headers, cache: "no-store" });
    const appFolderBody = await responseBody(appFolderResponse);
    console.info("Graph AppFolder response", graphDiagnostics(appFolderResponse, appFolderBody));

    if (!appFolderResponse.ok || typeof appFolderBody !== "object" || appFolderBody === null || !("id" in appFolderBody) || typeof appFolderBody.id !== "string") {
      return NextResponse.json({ message: "Unable to resolve the Graph AppFolder.", appFolder: graphDiagnostics(appFolderResponse, appFolderBody) }, { status: 502 });
    }

    const fileName = "pmv-test.txt";
    // working general url
    const uploadUrl = `https://graph.microsoft.com/v1.0/drive/special/approot:/pmv-test.txt:/content`;

    // url using env drive id
    // const uploadUrl =`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(appFolderBody.id)}:/${encodeURIComponent(fileName)}:/content`;
    // working drive id
    // const uploadUrl = `https://graph.microsoft.com/v1.0/drives/b!k0ft4Ufqk0qwiUvqpLnDpxUvmpTozgBPmBzk_5VhxMF6MKnsJ3SOT7U6CuA9ea_X/items/01ENDTKF66XZJH5KYHJ5AJHIBDR5DLPUIV:/${encodeURIComponent(fileName)}:/content`;
    // not working drive id
    // const uploadUrl = `https://graph.microsoft.com/v1.0/drives/b!kOmWGFE02UCzK0uQBusXQS8160m1z-1OsMTU7bJUhDHYLhmvrbo6T4zkmZCLVRWZ/items/01ENDTKF66XZJH5KYHJ5AJHIBDR5DLPUIV:/${encodeURIComponent(fileName)}:/content`;
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "text/plain" },
      body: `PMV test upload\nUploaded at ${new Date().toISOString()}\n`,
      cache: "no-store",
    });
    const uploadBody = await responseBody(uploadResponse);
    console.info("Graph AppFolder upload response", graphDiagnostics(uploadResponse, uploadBody));

    return NextResponse.json({
      success: uploadResponse.ok,
      message: uploadResponse.ok ? "pmv-test.txt uploaded successfully." : "Graph AppFolder upload failed.",
    //   driveId,
      appFolderId: appFolderBody.id,
      upload: graphDiagnostics(uploadResponse, uploadBody),
    }, { status: uploadResponse.ok ? 200 : 502 });
  } catch (error) {
    console.error("Graph AppFolder test route failed", error);
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unexpected Graph test failure." }, { status: 500 });
  }
}