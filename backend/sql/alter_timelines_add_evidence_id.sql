-- 타임라인 테이블에 증거 연결 컬럼 추가
-- 생성일: 2026-02-02
-- 목적: 타임라인 이벤트와 증거 파일을 연결하여 증거 카드 표시 기능 지원

-- 1. evidence_id 컬럼 추가
ALTER TABLE timelines
ADD COLUMN IF NOT EXISTS evidence_id BIGINT;

-- 2. Foreign Key 제약조건 추가
ALTER TABLE timelines
ADD CONSTRAINT fk_timelines_evidence
    FOREIGN KEY (evidence_id)
    REFERENCES evidences(id)
    ON DELETE SET NULL;

-- 3. 인덱스 생성 (증거 기반 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_timelines_evidence_id ON timelines(evidence_id);

-- 4. 코멘트 추가
COMMENT ON COLUMN timelines.evidence_id IS '연관된 증거 ID (타입이 "증거"인 경우 해당 증거 파일과 연결)';

-- 5. 롤백 스크립트 (필요시 사용)
-- ALTER TABLE timelines DROP CONSTRAINT IF EXISTS fk_timelines_evidence;
-- DROP INDEX IF EXISTS idx_timelines_evidence_id;
-- ALTER TABLE timelines DROP COLUMN IF EXISTS evidence_id;
