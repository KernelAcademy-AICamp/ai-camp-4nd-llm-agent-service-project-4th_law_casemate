-- 타임라인 테이블 생성
CREATE TABLE IF NOT EXISTS timelines (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL,
    firm_id INTEGER,  -- 소속 법무법인/사무실 ID (데이터 격리)

    -- 날짜/시간 정보
    date VARCHAR(20) NOT NULL,  -- YYYY-MM-DD 또는 "미상"
    time VARCHAR(10) NOT NULL,  -- HH:MM

    -- 이벤트 정보
    title VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL,  -- 의뢰인, 상대방, 증거, 기타
    actor VARCHAR(100),  -- 관련 인물명 또는 증거명

    -- 정렬 순서
    order_index INTEGER DEFAULT 0,

    -- 메타 정보
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Foreign Key 제약조건
    CONSTRAINT fk_case
        FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_firm
        FOREIGN KEY (firm_id)
        REFERENCES law_firms(id)
        ON DELETE SET NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_timelines_case_id ON timelines(case_id);
CREATE INDEX IF NOT EXISTS idx_timelines_firm_id ON timelines(firm_id);
CREATE INDEX IF NOT EXISTS idx_timelines_date ON timelines(date);
CREATE INDEX IF NOT EXISTS idx_timelines_order_index ON timelines(order_index);

-- updated_at 자동 업데이트 트리거 함수 (PostgreSQL)
CREATE OR REPLACE FUNCTION update_timelines_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_timelines_updated_at ON timelines;
CREATE TRIGGER trigger_update_timelines_updated_at
    BEFORE UPDATE ON timelines
    FOR EACH ROW
    EXECUTE FUNCTION update_timelines_updated_at();

-- 코멘트 추가
COMMENT ON TABLE timelines IS '사건 타임라인 정보';
COMMENT ON COLUMN timelines.id IS '타임라인 고유 ID';
COMMENT ON COLUMN timelines.case_id IS '사건 ID (외래키)';
COMMENT ON COLUMN timelines.firm_id IS '소속 법무법인/사무실 ID (멀티테넌트 데이터 격리)';
COMMENT ON COLUMN timelines.date IS '발생 날짜 (YYYY-MM-DD 또는 "미상")';
COMMENT ON COLUMN timelines.time IS '발생 시각 (HH:MM)';
COMMENT ON COLUMN timelines.title IS '타임라인 제목';
COMMENT ON COLUMN timelines.description IS '상세 설명';
COMMENT ON COLUMN timelines.type IS '타입 (의뢰인/상대방/증거/기타)';
COMMENT ON COLUMN timelines.actor IS '관련 인물명 또는 증거명';
COMMENT ON COLUMN timelines.order_index IS '표시 순서 (낮을수록 먼저 표시)';
COMMENT ON COLUMN timelines.created_at IS '생성일시';
COMMENT ON COLUMN timelines.updated_at IS '수정일시';
