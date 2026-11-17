// Read-only aggregates only. Never emit identities, names, scan IDs or provider proof.
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { reviewedMigrationPlan } from "../../database/migration-plan.server.ts";
const connection = await connectLocalDatabase();
try {
  await connection.client.begin("isolation level repeatable read read only", async (tx) => {
    console.log(JSON.stringify({ migrationPlan: await reviewedMigrationPlan(tx) }));
    const [gates] = await tx`select
   (select position('s.confidential' in prosrc)>0 from pg_proc where oid='app.reserve_bouncer_scan(uuid,uuid,integer,integer,text)'::regprocedure) reservation_gate,
   exists(select 1 from pg_trigger where tgrelid='app.submissions'::regclass and tgname='external_scan_classification' and tgenabled in ('O','A')) classification_fence`;
    const [inventory] = await tx`select count(*)::int confidential_documents,
   count(*) filter(where j.provider='bouncer' and (j.external_scan_id is not null or j.submitted_at is not null or j.provider_status in ('submitting','ambiguous')))::int possible_external_transfers,
   count(*) filter(where j.provider='bouncer' and j.external_scan_id is not null)::int provider_ids
   from app.documents d join app.submissions s on s.id=d.submission_id left join app.document_scans j on j.document_id=d.id where s.confidential`;
    const held =
      await tx`select provider,state,provider_status,error_category,count(*)::int records from app.document_scans where state='exhausted' or provider_status in ('held','ambiguous') group by provider,state,provider_status,error_category order by provider,state,provider_status,error_category`;
    console.log(JSON.stringify({ gates, confidentialInventory: inventory, held }));
  });
} catch {
  console.error("Read-only pilot inventory failed; no evidence was changed.");
  process.exitCode = 1;
} finally {
  await connection.close();
}
