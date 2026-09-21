import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("Starting ErrUserAccess project-specific role migration...");

    // 1. Check if column projectName exists
    const colCheck = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ErrUserAccess' AND column_name = 'projectName'`
    );
    const hasProjectName = colCheck.rows.length > 0;

    // 2. Add projectId column if not exists
    await client.query(`
      ALTER TABLE "ErrUserAccess" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
    `);

    // 3. Drop old unique constraint first so a user can have multiple project entries
    await client.query(`
      ALTER TABLE "ErrUserAccess" DROP CONSTRAINT IF EXISTS "ErrUserAccess_userId_role_key";
    `);
    await client.query(`
      DROP INDEX IF EXISTS "ErrUserAccess_userId_role_key";
    `);

    // 4. Migrate existing records with projectName
    if (hasProjectName) {
      const accessWithProjectName = await client.query(
        `SELECT id, "userId", role, "projectName" FROM "ErrUserAccess" WHERE "projectName" IS NOT NULL AND TRIM("projectName") != ''`
      );

      for (const row of accessWithProjectName.rows) {
        const matches = await client.query(
          `SELECT id, name FROM "ErrProject" WHERE name = $1`,
          [row.projectName.trim()]
        );

        if (matches.rows.length === 1) {
          await client.query(
            `UPDATE "ErrUserAccess" SET "projectId" = $1 WHERE id = $2`,
            [matches.rows[0].id, row.id]
          );
          console.log(`Matched access record ${row.id} (${row.role}) to project '${matches.rows[0].name}' (${matches.rows[0].id})`);
        } else if (matches.rows.length === 0) {
          console.warn(`[MIGRATION REPORT - MISSING MATCH] ErrUserAccess record ${row.id} (user: ${row.userId}, role: ${row.role}) has projectName '${row.projectName}', but no matching ErrProject was found in the database. Leaving record intact with projectId=NULL.`);
        } else {
          console.warn(`[MIGRATION REPORT - AMBIGUOUS MATCH] ErrUserAccess record ${row.id} (user: ${row.userId}, role: ${row.role}) has projectName '${row.projectName}', which matched ${matches.rows.length} ErrProject records. Leaving record intact with projectId=NULL.`);
        }
      }
    }

    // 5. Also migrate PROJECT_DIRECTOR records that are linked via ErrProject.directorId
    const directorAccess = await client.query(
      `SELECT id, "userId", role, "isActive" FROM "ErrUserAccess" WHERE role = 'PROJECT_DIRECTOR' AND "projectId" IS NULL`
    );

    for (const row of directorAccess.rows) {
      const directedProjects = await client.query(
        `SELECT id, name FROM "ErrProject" WHERE "directorId" = $1`,
        [row.userId]
      );

      if (directedProjects.rows.length > 0) {
        // Assign the first project to this access record
        const first = directedProjects.rows[0];
        await client.query(
          `UPDATE "ErrUserAccess" SET "projectId" = $1 WHERE id = $2`,
          [first.id, row.id]
        );
        console.log(`Assigned director ${row.userId} access record to directed project '${first.name}' (${first.id})`);

        // If director has additional directed projects, insert records for those projects
        for (let i = 1; i < directedProjects.rows.length; i++) {
          const nextProj = directedProjects.rows[i];
          const exists = await client.query(
            `SELECT id FROM "ErrUserAccess" WHERE "userId" = $1 AND role = 'PROJECT_DIRECTOR' AND "projectId" = $2`,
            [row.userId, nextProj.id]
          );
          if (exists.rows.length === 0) {
            const cuid = 'c' + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
            await client.query(
              `INSERT INTO "ErrUserAccess" (id, "userId", role, "projectId", "isActive", "createdAt", "updatedAt")
               VALUES ($1, $2, 'PROJECT_DIRECTOR', $3, $4, NOW(), NOW())`,
              [cuid, row.userId, nextProj.id, row.isActive]
            );
            console.log(`Created additional project access for director ${row.userId} on project '${nextProj.name}' (${nextProj.id})`);
          }
        }
      }
    }

    // 5. Drop old unique constraint if present
    await client.query(`
      ALTER TABLE "ErrUserAccess" DROP CONSTRAINT IF EXISTS "ErrUserAccess_userId_role_key";
    `);
    await client.query(`
      DROP INDEX IF EXISTS "ErrUserAccess_userId_role_key";
    `);

    // 6. Add foreign key constraint on projectId referencing ErrProject(id)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'ErrUserAccess_projectId_fkey'
        ) THEN
          ALTER TABLE "ErrUserAccess"
          ADD CONSTRAINT "ErrUserAccess_projectId_fkey"
          FOREIGN KEY ("projectId") REFERENCES "ErrProject"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // 7. Add new compound unique constraint @@unique([userId, role, projectId])
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ErrUserAccess_userId_role_projectId_key"
      ON "ErrUserAccess"("userId", "role", "projectId");
    `);

    // 8. Add unique partial index for global roles (where projectId IS NULL)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ErrUserAccess_userId_role_global_key"
      ON "ErrUserAccess"("userId", "role")
      WHERE "projectId" IS NULL;
    `);

    // 9. Add index on projectId and isActive
    await client.query(`
      CREATE INDEX IF NOT EXISTS "ErrUserAccess_projectId_isActive_idx"
      ON "ErrUserAccess"("projectId", "isActive");
    `);

    // 10. Drop column projectName if it existed
    if (hasProjectName) {
      await client.query(`
        ALTER TABLE "ErrUserAccess" DROP COLUMN IF EXISTS "projectName";
      `);
      console.log("Dropped deprecated column 'projectName' from ErrUserAccess.");
    }

    await client.query("COMMIT");
    console.log("Migration completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate-err-access.mjs")) {
  runMigration().then(() => pool.end()).catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
}
