-- Document IDs and private object keys are independent UUIDs. API document IDs
-- cannot disclose the provider key; authorization still rests on parent RLS.
DROP POLICY document_create ON app.documents;
CREATE POLICY document_create ON app.documents FOR INSERT WITH CHECK
 (app.document_account_allowed() AND state='pending' AND byte_size=0 AND sha256 IS NULL
 AND storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 AND media_type='application/pdf'
 AND EXISTS (SELECT 1 FROM app.submissions s WHERE s.id=submission_id
 AND s.owner_id=app.request_user_id() AND s.status='submitted' AND s.kind='document'));
