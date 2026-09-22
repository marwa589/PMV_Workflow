# PMV Workflow — Environment Setup Guide

This document explains how to set up the PMV Workflow project on a new Windows development machine.

## 1. Prerequisites

- Windows 10/11 64-bit
- Git
- PowerShell
- Node.js 26.x
- npm 11.x
- PostgreSQL 18.x
- VS Code or another code editor

The project uses Next.js, React, TypeScript, Prisma ORM, PostgreSQL, Nodemailer, and local filesystem storage.

## 2. Clone the Repository

```powershell
git clone <REPOSITORY_URL>
cd PMV_Workflow
```

Check the repository:

```powershell
git status
```

## 3. Node.js / NVM

If using NVM for Windows:

```powershell
nvm version
nvm list
nvm use 26.5.1
node --version
npm --version
```

Verified environment:

```text
Node.js v26.5.1
npm 11.17.0
```

If Node is managed through Laravel Herd/NVM, make sure the NVM-managed Node installation is the one being used by PowerShell.

## 4. Install Dependencies

From the project directory:

```powershell
npm ci
```

If the lockfile has intentionally changed and `npm ci` is not appropriate, use:

```powershell
npm install
```

Verify important packages:

```powershell
npm list next prisma @prisma/client
```

## 5. Install PostgreSQL

Install PostgreSQL for Windows from:

https://www.postgresql.org/download/windows/

Install at least:

- PostgreSQL Server
- pgAdmin 4
- Command Line Tools

Verified environment:

```text
PostgreSQL 18.6
Port 5432
```

Verify PostgreSQL:

```powershell
psql --version
pg_isready
```

Expected output includes:

```text
psql (PostgreSQL) 18.6
localhost:5432 - accepting connections
```

If `psql` is not recognized, add this directory to Windows PATH:

```text
C:\Program Files\PostgreSQL\18\bin
```

## 6. Create the Project Database

Using the PostgreSQL `postgres` administrator account:

```powershell
psql -U postgres -c "CREATE DATABASE pmv_workflow;"
```

Verify:

```powershell
psql -U postgres -l
```

The database list should contain `pmv_workflow`.

## 7. Configure Environment Variables

Create a `.env` file in the project root.

Minimum required variable:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/pmv_workflow"
```

Replace `YOUR_PASSWORD` with the password assigned to the local PostgreSQL `postgres` user.

Do not commit `.env` if it contains passwords, API keys, tokens, or other secrets.

Additional environment variables may be required for features such as email, file storage, authentication, cloud integrations, or development tunnels. Check the project configuration/source code for those variables before using dependent features.

## 8. Prisma Setup

The project uses:

```text
prisma/schema.prisma
prisma.config.ts
```

The Prisma configuration reads `DATABASE_URL` from the environment.

Generate Prisma Client:

```powershell
npx prisma generate
```

### New / Empty Database

A newly created `pmv_workflow` database will initially be empty.

`npx prisma db pull` is for inspecting an existing database. Running it against an empty database can produce `P4001`, which is expected in this situation.

Initialize the database from the project's Prisma schema with:

```powershell
npx prisma db push
```

After schema changes or dependency installation, regenerate the client:

```powershell
npx prisma generate
```

## 9. Verify the Build

Run:

```powershell
npm run build
```

A successful build should complete without build errors.

Warnings such as Next.js middleware/proxy deprecation notices or Turbopack filesystem tracing warnings should be evaluated separately; they do not necessarily indicate a failed build.

## 10. Run the Development Server

```powershell
npm run dev
```

Next.js normally starts at:

```text
http://localhost:3000
```

Use the URL displayed by Next.js if another port is selected.

## 11. Typical Prisma Development Workflow

After modifying `prisma/schema.prisma`:

```powershell
npx prisma db push
npx prisma generate
npm run build
```

For production database changes, use reviewed Prisma migrations rather than relying on `db push` as a deployment strategy.

## 12. Git / Branching

Check the working tree before making changes:

```powershell
git status
```

For experimental work, create a separate branch:

```powershell
git switch -c <branch-name>
```

Keep `main` stable and use a separate branch for experimental/customized versions.

## 13. Common Problems

### `node` is not recognized

Check:

```powershell
nvm current
node --version
```

If PowerShell is using an old PATH, restart PowerShell or reload it:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
```

### `psql` is not recognized

Verify that PostgreSQL is installed and that this file exists:

```text
C:\Program Files\PostgreSQL\18\bin\psql.exe
```

Add the `bin` directory to PATH.

### `DATABASE_URL is not set`

Make sure the project root contains `.env` with:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/pmv_workflow"
```

Restart the development server after changing environment variables.

### Prisma reports an empty database

If `npx prisma db pull` reports `P4001`, the database is likely newly created and has no tables. Use:

```powershell
npx prisma db push
```

### Prisma Client types are missing

If TypeScript reports missing `PrismaClient`, Prisma enums, or Prisma types, run:

```powershell
npx prisma generate
```

Then:

```powershell
npm run build
```

## 14. Security Notes

Never commit environment files containing secrets, including:

```text
.env
.env.local
```

Never put the following in source control or setup documentation:

- PostgreSQL passwords
- SMTP passwords
- API keys
- Authentication secrets
- Access tokens
- Cloud credentials

Use placeholders in documentation.

## 15. Verified Environment

The following environment has been successfully tested:

```text
Windows
Node.js       26.5.1
npm           11.17.0
PostgreSQL    18.6
Prisma CLI    7.10.0
Next.js       16.3.0
Database      pmv_workflow
Port          5432
```

The project successfully:

- connects to local PostgreSQL
- synchronizes the Prisma schema
- generates Prisma Client
- passes TypeScript compilation
- completes a production build

## 16. First-Time Setup Checklist

- [ ] Git installed
- [ ] Repository cloned
- [ ] Correct branch selected
- [ ] Node.js installed
- [ ] Correct Node.js version active
- [ ] npm working
- [ ] Dependencies installed
- [ ] PostgreSQL installed
- [ ] PostgreSQL service running
- [ ] `psql` available in PATH
- [ ] `pmv_workflow` database created
- [ ] `.env` created
- [ ] `DATABASE_URL` configured
- [ ] Prisma database synchronized
- [ ] Prisma Client generated
- [ ] `npm run build` succeeds
- [ ] `npm run dev` starts successfully

---

**Last verified:** September 2026
