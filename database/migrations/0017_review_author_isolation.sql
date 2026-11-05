-- Retain the pre-existing reviewer infrastructure, but never permit self-review or draft review.
-- No reviewer grants, onboarding or decision handler is introduced in Phase 3D.
DROP POLICY submission_review ON app.submissions;
CREATE POLICY submission_review ON app.submissions FOR UPDATE
USING(app.document_account_allowed() AND app.is_reviewer() AND owner_id<>app.request_user_id() AND status::text<>'draft')
WITH CHECK(app.document_account_allowed() AND app.is_reviewer() AND owner_id<>app.request_user_id() AND status::text<>'draft');
DROP POLICY review_append ON app.review_decisions;
CREATE POLICY review_append ON app.review_decisions FOR INSERT WITH CHECK
(app.document_account_allowed() AND app.is_reviewer() AND reviewer_id=app.request_user_id()
 AND EXISTS(SELECT 1 FROM app.submissions WHERE id=submission_id AND owner_id<>app.request_user_id() AND status::text<>'draft'));
