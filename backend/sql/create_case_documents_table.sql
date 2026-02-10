-- 사건 문서 테이블 생성
CREATE TABLE IF NOT EXISTS case_documents (
    id BIGINT PRIMARY KEY DEFAULT get_time_id(),
    case_id BIGINT NOT NULL,
    law_firm_id BIGINT,
    created_by BIGINT,
    title VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) DEFAULT 'complaint',
    content TEXT,
    version INTEGER DEFAULT 1,
    parent_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_case_documents_case
        FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_case_documents_firm
        FOREIGN KEY (law_firm_id)
        REFERENCES law_firms(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_case_documents_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_case_documents_parent
        FOREIGN KEY (parent_id)
        REFERENCES case_documents(id)
        ON DELETE SET NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_case_documents_case_id ON case_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_documents_law_firm_id ON case_documents(law_firm_id);
CREATE INDEX IF NOT EXISTS idx_case_documents_document_type ON case_documents(document_type);

-- updated_at 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_case_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_case_documents_updated_at ON case_documents;
CREATE TRIGGER trigger_update_case_documents_updated_at
    BEFORE UPDATE ON case_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_case_documents_updated_at();

-- 코멘트 추가
COMMENT ON TABLE case_documents IS '사건 관련 법률 문서 (고소장, 소장, 내용증명 등)';
COMMENT ON COLUMN case_documents.id IS '문서 고유 ID';
COMMENT ON COLUMN case_documents.case_id IS '사건 ID (외래키)';
COMMENT ON COLUMN case_documents.law_firm_id IS '소속 법무법인 ID';
COMMENT ON COLUMN case_documents.created_by IS '작성자 ID';
COMMENT ON COLUMN case_documents.title IS '문서 제목';
COMMENT ON COLUMN case_documents.document_type IS '문서 유형 (complaint, civil_suit, notice, brief, opinion, settlement)';
COMMENT ON COLUMN case_documents.content IS '문서 내용 (Markdown 형식)';
COMMENT ON COLUMN case_documents.version IS '문서 버전';
COMMENT ON COLUMN case_documents.parent_id IS '이전 버전 문서 ID';
COMMENT ON COLUMN case_documents.created_at IS '생성일시';
COMMENT ON COLUMN case_documents.updated_at IS '수정일시';
