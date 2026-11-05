-- Author-visible lifecycle events are separate from private reviewer notes.
-- Existing decisions stay immutable and retained; no reviewer UI is introduced.
DROP POLICY review_read ON app.review_decisions;
CREATE POLICY review_read ON app.review_decisions FOR SELECT USING
(app.document_account_allowed() AND app.is_reviewer()
 AND EXISTS(SELECT 1 FROM app.submissions WHERE id=submission_id AND owner_id<>app.request_user_id()));
