import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ids = searchParams.getAll('ids');

  if (ids.length === 0) {
    return NextResponse.json({ message: 'No documents selected.' }, { status: 400 });
  }

  const documents = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true },
  });

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Print Documents</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
      h1 { font-size: 20px; margin-bottom: 16px; }
      ul { padding-left: 20px; }
      li { margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <h1>Selected Documents</h1>
    <ul>
      ${documents.map((doc) => `<li>${doc.title}</li>`).join('')}
    </ul>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'inline; filename="documents-print.html"',
    },
  });
}
