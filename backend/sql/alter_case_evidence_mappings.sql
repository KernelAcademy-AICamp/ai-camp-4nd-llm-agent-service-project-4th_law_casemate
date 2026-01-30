-- case_evidence_mappings 테이블에 증거 날짜 및 설명 필드 추가
-- 이 필드들은 "사건-증거 관계"의 속성으로, 같은 증거가 여러 사건에 연결될 때 각 사건별로 다른 값을 가질 수 있습니다.

-- 증거 발생일 필드 추가 (이 사건에서의 증거 관련 날짜)
ALTER TABLE case_evidence_mappings
ADD COLUMN IF NOT EXISTS evidence_date VARCHAR(20);

-- 증거 설명 필드 추가 (이 사건에서의 증거 맥락/의미)
ALTER TABLE case_evidence_mappings
ADD COLUMN IF NOT EXISTS description TEXT;

-- 코멘트 추가
COMMENT ON COLUMN case_evidence_mappings.evidence_date IS '증거 발생일 (이 사건에서의 관련 날짜, YYYY-MM-DD 형식 또는 "미상")';
COMMENT ON COLUMN case_evidence_mappings.description IS '증거 설명 (이 사건에서의 맥락 및 의미)';

-- 인덱스 추가 (날짜 기반 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_case_evidence_mappings_evidence_date ON case_evidence_mappings(evidence_date);
