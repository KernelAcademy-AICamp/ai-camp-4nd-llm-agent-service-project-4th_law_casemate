-- 판례 즐겨찾기 테이블 생성
CREATE TABLE IF NOT EXISTS precedent_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    case_number VARCHAR(50) NOT NULL,

    -- 메타 정보
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 제약조건: 같은 사용자가 같은 판례를 중복 즐겨찾기 방지
    CONSTRAINT unique_user_case UNIQUE (user_id, case_number),

    -- Foreign Key 제약조건
    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_precedent_favorites_user_id ON precedent_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_precedent_favorites_case_number ON precedent_favorites(case_number);
CREATE INDEX IF NOT EXISTS idx_precedent_favorites_created_at ON precedent_favorites(created_at);

-- 코멘트 추가
COMMENT ON TABLE precedent_favorites IS '판례 즐겨찾기';
COMMENT ON COLUMN precedent_favorites.id IS '즐겨찾기 고유 ID';
COMMENT ON COLUMN precedent_favorites.user_id IS '사용자 ID (외래키)';
COMMENT ON COLUMN precedent_favorites.case_number IS '판례 사건번호 (Qdrant 참조용)';
COMMENT ON COLUMN precedent_favorites.created_at IS '즐겨찾기 추가일시';
