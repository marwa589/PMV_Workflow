-- Clearer descriptions for every permission.
UPDATE "Permission" SET "description" = 'See documents (and open them) that fall inside the scope of the assignment: its project, location, company, document type or sub type. Without it a person only sees documents they uploaded or are asked to review.' WHERE "code" = 'documents.view';
UPDATE "Permission" SET "description" = 'See reference documents attached to process steps, inside the assignment scope. Without it reference documents are hidden everywhere, even from approvers. Also needs View documents for normal documents.' WHERE "code" = 'documents.view_reference';
UPDATE "Permission" SET "description" = 'Download documents inside the assignment scope, one by one or in bulk (ZIP, process package).' WHERE "code" = 'documents.download';
UPDATE "Permission" SET "description" = 'Print documents inside the assignment scope, one by one or in bulk.' WHERE "code" = 'documents.print';
UPDATE "Permission" SET "description" = 'Archive approved documents inside the scope and restore them from the archive.' WHERE "code" = 'documents.archive';
UPDATE "Permission" SET "description" = 'Mark an approved document (for example a purchase order) as received. Shows the Confirm receipt button on the document page.' WHERE "code" = 'documents.confirm_receipt';
UPDATE "Permission" SET "description" = 'Ask for a document inside the scope to be deleted. The request goes to the people who can review deletions.' WHERE "code" = 'documents.delete_request';
UPDATE "Permission" SET "description" = 'Approve or reject deletion requests for documents inside the scope. Approving deletes the document. Adds the Deletion Requests page.' WHERE "code" = 'documents.delete_review';
UPDATE "Permission" SET "description" = 'Create and edit process definitions: steps, document types per step, reference documents and waiting periods. Adds Process Setup to the menu.' WHERE "code" = 'processes.manage';
UPDATE "Permission" SET "description" = 'Create and edit approval flows (levels, approvers, signature required) and assign them to document types, sub types and projects. Adds Flows and Flow Assignments.' WHERE "code" = 'flows.manage';
UPDATE "Permission" SET "description" = 'Create and edit document types, sub types, custom fields and numbering codes.' WHERE "code" = 'types.manage';
UPDATE "Permission" SET "description" = 'Create and edit users: name, email, user type, active state and password resets.' WHERE "code" = 'users.manage';
UPDATE "Permission" SET "description" = 'Give roles to users with a scope (project, location, company, type, sub type) and edit roles and the mailing list.' WHERE "code" = 'assignments.manage';
UPDATE "Permission" SET "description" = 'Create and remove approval delegations, so one person can approve on behalf of another for a period.' WHERE "code" = 'delegations.manage';
UPDATE "Permission" SET "description" = 'Create and edit locations, companies and projects.' WHERE "code" = 'projects.manage';
UPDATE "Permission" SET "description" = 'Get an email when a document inside the scope is fully approved.' WHERE "code" = 'mail.receive_approved';
UPDATE "Permission" SET "description" = 'Get an email when a document inside the scope is rejected.' WHERE "code" = 'mail.receive_rejected';
UPDATE "Permission" SET "description" = 'Get an email when a document inside the scope is sent back for revision.' WHERE "code" = 'mail.receive_revision';
