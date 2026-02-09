import os, sys
sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text

engine = create_engine(os.getenv("DATABASE_URL"))
with engine.connect() as conn:
    fks = [
        ("evidences", "uploader_id", "users", "id", "evidences_uploader_id_fkey"),
        ("evidence_analyses", "evidence_id", "evidences", "id", "evidence_analyses_evidence_id_fkey"),
        ("case_evidence_mappings", "evidence_id", "evidences", "id", "case_evidence_mappings_evidence_id_fkey"),
    ]
    for table, col, ref_table, ref_col, name in fks:
        try:
            conn.execute(text(
                f"ALTER TABLE {table} ADD CONSTRAINT {name} "
                f"FOREIGN KEY ({col}) REFERENCES {ref_table}({ref_col}) ON DELETE SET NULL"
            ))
            print(f"[OK] {table}.{col} -> {ref_table}.{ref_col}")
        except Exception as e:
            err = str(e).split("\n")[0][:100]
            print(f"[ERR] {table}.{col}: {err}")
    conn.commit()
    print("\nDone.")
