async function getGraphAccessToken(): Promise<string> {
  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GRAPH_CLIENT_ID!,
        client_secret: process.env.GRAPH_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );

  const data = await response.json() as { access_token?: string; error?: unknown };

  if (!response.ok || !data.access_token) {
    throw new Error(`Graph token error: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function readGraphBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function requiredGraphEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function uploadFileToGraph(
  buffer: Buffer,
  fileName: string,
  folder: string
): Promise<{ driveId: string; itemId: string; webUrl: string }> {
  const accessToken = await getGraphAccessToken();
  const driveId = requiredGraphEnv("PMV_DRIVE_ID");
  const headers = { Authorization: `Bearer ${accessToken}` };

  const appFolderUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/special/approot`;
  const appFolderResponse = await fetch(appFolderUrl, { headers, cache: "no-store" });
  const appFolderBody = await readGraphBody(appFolderResponse) as { id?: string } | null;
  if (!appFolderResponse.ok || !appFolderBody?.id) {
    throw new Error(`Graph AppFolder lookup failed (${appFolderResponse.status}): ${JSON.stringify(appFolderBody)}`);
  }

  const escapedFolderName = folder.replaceAll("'", "''");
  const folderFilter = encodeURIComponent(`name eq '${escapedFolderName}'`);
  const childrenUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(appFolderBody.id)}/children?$filter=${folderFilter}`;
  const childrenResponse = await fetch(childrenUrl, { headers, cache: "no-store" });
  const childrenBody = await readGraphBody(childrenResponse) as { value?: Array<{ id?: string; name?: string; folder?: unknown }> } | null;
  if (!childrenResponse.ok) {
    throw new Error(`Graph AppFolder children lookup failed (${childrenResponse.status}): ${JSON.stringify(childrenBody)}`);
  }

  let folderId = childrenBody?.value?.find((item) => item.name === folder && item.id && item.folder)?.id;
  if (!folderId) {
    const createFolderResponse = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(appFolderBody.id)}/children`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: folder, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    const createFolderBody = await readGraphBody(createFolderResponse) as { id?: string } | null;
    if (createFolderResponse.ok && createFolderBody?.id) {
      folderId = createFolderBody.id;
    } else if (createFolderResponse.status === 409) {
      const retryResponse = await fetch(childrenUrl, { headers, cache: "no-store" });
      const retryBody = await readGraphBody(retryResponse) as { value?: Array<{ id?: string; name?: string; folder?: unknown }> } | null;
      folderId = retryBody?.value?.find((item) => item.name === folder && item.id && item.folder)?.id;
    } else {
      throw new Error(`Graph AppFolder folder creation failed (${createFolderResponse.status}): ${JSON.stringify(createFolderBody)}`);
    }
  }

  if (!folderId) throw new Error(`Graph AppFolder folder '${folder}' could not be resolved.`);

  const childFilter = encodeURIComponent(`name eq '${fileName.replaceAll("'", "''")}'`);
  const existingChildrenUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}/children?$filter=${childFilter}`;
  const existingChildrenResponse = await fetch(existingChildrenUrl, { headers, cache: "no-store" });
  const existingChildrenBody = await readGraphBody(existingChildrenResponse) as { value?: Array<{ id?: string; name?: string }> } | null;

  if (existingChildrenResponse.ok) {
    const existingItem = existingChildrenBody?.value?.find((item) => item.name === fileName && item.id)?.id;
    if (existingItem) {
      return replaceFileInGraph(buffer, driveId, existingItem);
    }
  }

  const uploadUrl =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
    },
    body: buffer as BodyInit,
  });

  const result = await readGraphBody(response) as { id?: string; webUrl?: string; parentReference?: { driveId?: string } } | null;

  if (!response.ok) {
    throw new Error(
      `Graph upload failed (${response.status}): ${JSON.stringify(result)}`
    );
  }

  const metadata = {
    driveId: result?.parentReference?.driveId ?? driveId,
    itemId: result?.id ?? "",
    webUrl: result?.webUrl ?? "",
  };

  if (!metadata.itemId) {
    throw new Error(`Graph upload succeeded but no item metadata was returned for '${fileName}'.`);
  }

  return metadata;
}

export async function replaceFileInGraph(
  buffer: Buffer,
  driveId: string,
  itemId: string,
  targetFileName?: string,
): Promise<{ driveId: string; itemId: string; webUrl: string }> {
  const accessToken = await getGraphAccessToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/octet-stream",
  };

  const replaceUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;

  const response = await fetch(replaceUrl, {
    method: "PUT",
    headers,
    body: buffer as BodyInit,
    cache: "no-store",
  });

  const result = await readGraphBody(response) as { id?: string; webUrl?: string; parentReference?: { driveId?: string } } | null;

  if (!response.ok) {
    throw new Error(
      `Graph file replacement failed (${response.status}): ${JSON.stringify(result)}`
    );
  }

  const metadata = {
    driveId: result?.parentReference?.driveId ?? driveId,
    itemId: result?.id ?? itemId,
    webUrl: result?.webUrl ?? "",
  };

  if (targetFileName && targetFileName.trim() && targetFileName.trim() !== "") {
    const currentFileResponse = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
    );

    const currentFileResult = await readGraphBody(currentFileResponse) as { name?: string; webUrl?: string } | null;
    const normalizedTargetName = targetFileName.trim();
    if (currentFileResponse.ok && currentFileResult?.name && currentFileResult.name !== normalizedTargetName) {
      const renameResponse = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: normalizedTargetName }),
          cache: "no-store",
        },
      );

      const renameResult = await readGraphBody(renameResponse) as { webUrl?: string } | null;

      if (!renameResponse.ok) {
        throw new Error(
          `Graph file rename failed (${renameResponse.status}): ${JSON.stringify(renameResult)}`
        );
      }

      if (renameResult?.webUrl) {
        metadata.webUrl = renameResult.webUrl;
      }
    } else if (currentFileResult?.webUrl) {
      metadata.webUrl = currentFileResult.webUrl;
    }
  }

  if (!metadata.webUrl) {
    throw new Error(`Graph file replacement succeeded but webUrl was not returned for itemId '${itemId}'.`);
  }

  return metadata;
}

export async function downloadFileFromGraph(driveId: string, itemId: string): Promise<Buffer> {
  const accessToken = await getGraphAccessToken();
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const result = await readGraphBody(response);
    throw new Error(`Graph download failed (${response.status}): ${JSON.stringify(result)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteFileFromGraph(driveId: string, itemId: string): Promise<void> {
  const accessToken = await getGraphAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "DELETE",
      headers,
      cache: "no-store",
    },
  );

  if (response.status === 404) return;

  if (!response.ok) {
    const result = await readGraphBody(response);
    throw new Error(`Graph delete failed (${response.status}): ${JSON.stringify(result)}`);
  }
}