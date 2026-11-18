# 모듈형 인사노무·급여·자동 컴플라이언스 상세 DB 스키마 및 노동법 규칙 명세서

본 문서는 `modular-hr` 플랫폼의 **향후 프로덕션 전환용 데이터베이스 물리/논리 스키마(PostgreSQL 기준)**, **역할(Role) 및 전 테이블 Row-Level Security(RLS) 격리 정책**, **노동관계법령 계산 공식**, 그리고 **모듈 간 이벤트 파이프라인 인터페이스**를 정의합니다.

---

## 1. 데이터베이스 설계 및 권한 격리 원칙

1. **멀티테넌트 격리 및 비소유자 실행 역할 강제 (`1F Foundation`)**
   - 모든 사업장 테넌트 테이블은 `company_id UUID NOT NULL`을 보유하며 복합 기본키·복합 외래키로 테넌트 경계를 물리적으로 강제합니다.
   - 애플리케이션 런타임은 테이블 소유자(Owner)가 아닌 **`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` 속성의 전용 역할(`app_tenant_worker`)**로만 접속하며, 모든 테넌트 테이블에 `ENABLE ROW LEVEL SECURITY` 및 **`FORCE ROW LEVEL SECURITY`**를 함께 적용하여 소유자 우회까지 차단합니다.
   - 매 트랜잭션 시작 시 서버 인증 미들웨어가 검증된 세션의 사업장 ID를 `SELECT set_config('app.current_company_id', $1, true);` (트랜잭션 로컬 설정)로 주입하며, 값이 없거나 형식이 다르면 `NULLIF(current_setting('app.current_company_id', true), '')::UUID`가 `NULL`을 반환하여 **기본 전체 거부(Fail-Closed)** 됩니다.
2. **개인정보 암호화 금고(`vault`) 접근 권한 물리 분리**
   - `app_tenant_worker`에는 `vault` 스키마에 대한 `USAGE` 및 `SELECT` 권한을 일절 부여하지 않습니다.
   - 오직 공단 신고·급여이체 전문 생성 전용 격리 워커 역할(`vault_crypto_worker`, `NOBYPASSRLS`)만 `vault.pii_secrets`에 RLS 정책 하에 접근할 수 있습니다.
3. **법령 기준판 및 사업장 정책판(Version) 불변성**
   - 공통 법령 기준은 `core.law_rule_versions`(`effective_from ~ effective_to`), 사업장 고유 제도는 `core.company_policy_versions`(`effective_from ~ effective_to`)에 보관하며, 확정 급여(`payroll.runs`)는 두 판 ID를 모두 외래키로 보존합니다.

---

## 2. 계층별 핵심 테이블 및 전수 RLS 명세 (PostgreSQL DDL)

### 2-1. 스키마 · 실행 역할(Role) · `1F` 기반 계층

```sql
-- 스키마 생성
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS leave;
CREATE SCHEMA IF NOT EXISTS payroll;
CREATE SCHEMA IF NOT EXISTS offboarding;
CREATE SCHEMA IF NOT EXISTS recruit;
CREATE SCHEMA IF NOT EXISTS reward;
CREATE SCHEMA IF NOT EXISTS er;
CREATE SCHEMA IF NOT EXISTS compliance;

-- 비특권 런타임 역할 분리 (SUPERUSER / BYPASSRLS 금지)
CREATE ROLE app_tenant_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE vault_crypto_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 안전한 현재 테넌트 UUID 추출 헬퍼 (미설정 시 NULL 반환 -> RLS 자동 거부)
CREATE OR REPLACE FUNCTION core.current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_company_id', true), '')::UUID;
$$;

-- 0. 공통 노동관계법령 기준판 (전역 읽기 전용 참조 테이블, 테넌트 비종속)
CREATE TABLE core.law_rule_versions (
    law_version_id      UUID PRIMARY KEY,
    version_code        VARCHAR(30) NOT NULL UNIQUE,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    minimum_hourly_wage INTEGER NOT NULL,
    non_taxable_meal_limit INTEGER NOT NULL,
    social_ins_rates    JSONB NOT NULL,
    statutory_leaves    JSONB NOT NULL,
    approved_by_cpla    UUID NOT NULL,
    approved_at         TIMESTAMPTZ NOT NULL,
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- 1. 사업장 마스터
CREATE TABLE core.companies (
    company_id          UUID PRIMARY KEY,
    biz_reg_no          VARCHAR(12) NOT NULL UNIQUE,
    company_name        VARCHAR(200) NOT NULL,
    ksic_major          CHAR(1) NOT NULL,
    ksic_code           VARCHAR(5) NOT NULL,
    has_majority_union  BOOLEAN NOT NULL DEFAULT FALSE,
    active_subsidy_codes TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 사업장 정책 설정 판 이력
CREATE TABLE core.company_policy_versions (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    policy_version_id   UUID NOT NULL,
    version_no          INTEGER NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    pay_day             SMALLINT NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
    proration_basis     VARCHAR(20) NOT NULL CHECK (proration_basis IN ('CALENDAR_DAYS', 'WORK_DAYS')),
    leave_accrual_basis VARCHAR(20) NOT NULL CHECK (leave_accrual_basis IN ('HIRE_DATE', 'FISCAL_YEAR')),
    source_type         VARCHAR(30) NOT NULL,
    confirmed_by        UUID NOT NULL,
    confirmed_at        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (company_id, policy_version_id),
    UNIQUE (company_id, version_no),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- 3. 개인정보 암호화 금고 (vault_crypto_worker 전용)
CREATE TABLE vault.pii_secrets (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    person_id           UUID NOT NULL,
    kms_key_id          VARCHAR(128) NOT NULL,
    encrypted_id_no     BYTEA NOT NULL,
    encrypted_bank_acct BYTEA,
    birth_date          DATE NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, person_id)
);
```

### 2-2. `2F · 3F · 4F` 전체 운영 테이블 (`company_id` 선두 복합키)

```sql
-- 4. 통합 지급대상자 명부 (M2·M3)
CREATE TABLE hr.people (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    person_id           UUID NOT NULL,
    emp_code            VARCHAR(40) NOT NULL,
    display_name        VARCHAR(200) NOT NULL,
    worker_category     VARCHAR(20) NOT NULL CHECK (
        worker_category IN ('REGULAR', 'FIXED_TERM', 'PART_TIME', 'DAILY', 'BIZ_33', 'OTHER_88', 'DISPATCHED')
    ),
    is_special_emp_ins  BOOLEAN NOT NULL DEFAULT FALSE,
    disability_grade    VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (
        disability_grade IN ('NONE', 'MILD', 'SEVERE')
    ),
    job_type            VARCHAR(20) NOT NULL DEFAULT 'OFFICE' CHECK (
        job_type IN ('OFFICE', 'PRODUCTION', 'FIELD')
    ),
    hire_date           DATE NOT NULL,
    probation_end_date  DATE,
    resign_date         DATE,
    employment_status   VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    PRIMARY KEY (company_id, person_id),
    UNIQUE (company_id, emp_code)
);

-- 5. 근로계약 판 (M2·M6)
CREATE TABLE hr.contracts (
    company_id          UUID NOT NULL,
    contract_id         UUID NOT NULL,
    person_id           UUID NOT NULL,
    version_no          INTEGER NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    weekly_work_hours   NUMERIC(5,2) NOT NULL,
    daily_work_hours    NUMERIC(4,2) NOT NULL,
    base_monthly_pay    BIGINT NOT NULL,
    fixed_ordinary_allowances BIGINT NOT NULL DEFAULT 0,
    meal_allowance      BIGINT NOT NULL DEFAULT 0,
    signed_at           TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    PRIMARY KEY (company_id, contract_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 6. 인사발령 이력 (M3)
CREATE TABLE hr.org_assignments (
    company_id          UUID NOT NULL,
    assignment_id       UUID NOT NULL,
    person_id           UUID NOT NULL,
    action_type         VARCHAR(30) NOT NULL,
    effective_date      DATE NOT NULL,
    dept_name           VARCHAR(100) NOT NULL,
    position_title      VARCHAR(100) NOT NULL,
    is_paid_period      BOOLEAN NOT NULL DEFAULT TRUE,
    ins_defer_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (company_id, assignment_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 7. 월 확정 근태 스냅샷 (M4)
CREATE TABLE attendance.monthly_locks (
    company_id          UUID NOT NULL,
    lock_id             UUID NOT NULL,
    person_id           UUID NOT NULL,
    year_month          CHAR(7) NOT NULL,
    scheduled_minutes   INTEGER NOT NULL,
    worked_minutes      INTEGER NOT NULL,
    overtime_minutes    INTEGER NOT NULL DEFAULT 0,
    night_minutes       INTEGER NOT NULL DEFAULT 0,
    holiday_le8_minutes INTEGER NOT NULL DEFAULT 0,
    holiday_gt8_minutes INTEGER NOT NULL DEFAULT 0,
    unpaid_absence_days NUMERIC(4,2) NOT NULL DEFAULT 0,
    max_weekly_minutes  INTEGER NOT NULL DEFAULT 0,
    locked_at           TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (company_id, lock_id),
    UNIQUE (company_id, person_id, year_month),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 8. 분 단위 연차·법정휴가 원장 (M5)
CREATE TABLE leave.ledger_entries (
    company_id          UUID NOT NULL,
    entry_id            UUID NOT NULL,
    person_id           UUID NOT NULL,
    leave_type_code     VARCHAR(30) NOT NULL,
    entry_kind          VARCHAR(20) NOT NULL,
    delta_minutes       INTEGER NOT NULL,
    occurred_on         DATE NOT NULL,
    expires_on          DATE,
    promo_stage1_sent_at TIMESTAMPTZ,
    promo_stage2_sent_at TIMESTAMPTZ,
    PRIMARY KEY (company_id, entry_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 9. 급여 확정 실행 및 직원별 명세 라인 (M8)
CREATE TABLE payroll.runs (
    company_id          UUID NOT NULL,
    run_id              UUID NOT NULL,
    year_month          CHAR(7) NOT NULL,
    revision_no         INTEGER NOT NULL DEFAULT 1,
    law_version_id      UUID NOT NULL REFERENCES core.law_rule_versions(law_version_id),
    policy_version_id   UUID NOT NULL,
    regular_headcount   NUMERIC(7,2) NOT NULL,
    status              VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'LOCKED')),
    approved_by         UUID,
    locked_at           TIMESTAMPTZ,
    PRIMARY KEY (company_id, run_id),
    UNIQUE (company_id, year_month, revision_no),
    FOREIGN KEY (company_id, policy_version_id)
        REFERENCES core.company_policy_versions(company_id, policy_version_id)
);

CREATE TABLE payroll.lines (
    company_id          UUID NOT NULL,
    line_id             UUID NOT NULL,
    run_id              UUID NOT NULL,
    person_id           UUID NOT NULL,
    ordinary_hourly_wage NUMERIC(12,2) NOT NULL,
    gross_pay           BIGINT NOT NULL,
    non_taxable_amount  BIGINT NOT NULL DEFAULT 0,
    taxable_amount      BIGINT NOT NULL DEFAULT 0,
    overtime_night_hol_pay BIGINT NOT NULL DEFAULT 0,
    unused_leave_pay    BIGINT NOT NULL DEFAULT 0,
    eval_bonus_pay      BIGINT NOT NULL DEFAULT 0,
    disciplinary_cut    BIGINT NOT NULL DEFAULT 0,
    social_ins_total    BIGINT NOT NULL DEFAULT 0,
    income_tax_total    BIGINT NOT NULL DEFAULT 0,
    net_pay             BIGINT NOT NULL,
    formula_breakdown   JSONB NOT NULL,
    warnings            JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (company_id, line_id),
    FOREIGN KEY (company_id, run_id) REFERENCES payroll.runs(company_id, run_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 10. 퇴직 통합 정산 (M9)
CREATE TABLE offboarding.settlements (
    company_id          UUID NOT NULL,
    settlement_id       UUID NOT NULL,
    person_id           UUID NOT NULL,
    resign_reason_code  VARCHAR(30) NOT NULL CHECK (
        resign_reason_code IN ('VOLUNTARY', 'RECOMMENDED', 'CONTRACT_END', 'RETIRE_AGE', 'DISMISSAL')
    ),
    last_work_date      DATE NOT NULL,
    payment_due_date    DATE NOT NULL,
    avg_daily_wage_3m   NUMERIC(12,2) NOT NULL,
    ordinary_daily_wage NUMERIC(12,2) NOT NULL,
    severance_gross     BIGINT NOT NULL,
    subsidy_risk_alert  BOOLEAN NOT NULL DEFAULT FALSE,
    written_notice_verified BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (company_id, settlement_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 11. 채용 공고 (M1)
CREATE TABLE recruit.job_postings (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    posting_id          UUID NOT NULL,
    title               VARCHAR(200) NOT NULL,
    body_text           TEXT NOT NULL,
    fair_hiring_checked BOOLEAN NOT NULL,
    doc_return_notice   BOOLEAN NOT NULL DEFAULT TRUE,
    offered_base_pay    BIGINT NOT NULL,
    PRIMARY KEY (company_id, posting_id)
);

-- 12. 인사평가 및 보상 (M6)
CREATE TABLE reward.evaluations (
    company_id          UUID NOT NULL,
    eval_id             UUID NOT NULL,
    person_id           UUID NOT NULL,
    eval_period         VARCHAR(20) NOT NULL,
    grade               VARCHAR(10) NOT NULL,
    raise_rate_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,
    performance_bonus   BIGINT NOT NULL DEFAULT 0,
    applied_to_payroll_month CHAR(7),
    PRIMARY KEY (company_id, eval_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 13. 징계 사안 및 감봉 통제 (M7)
CREATE TABLE er.discipline_cases (
    company_id          UUID NOT NULL,
    case_id             UUID NOT NULL,
    person_id           UUID NOT NULL,
    sanction_type       VARCHAR(20) NOT NULL CHECK (
        sanction_type IN ('WARNING', 'PAY_CUT', 'SUSPENSION', 'DEMOTION', 'DISMISSAL')
    ),
    work_rule_clause    VARCHAR(100) NOT NULL,
    attendance_notice_sent BOOLEAN NOT NULL DEFAULT FALSE,
    defense_opportunity_given BOOLEAN NOT NULL DEFAULT FALSE,
    committee_resolved  BOOLEAN NOT NULL DEFAULT FALSE,
    written_notice_delivered BOOLEAN NOT NULL DEFAULT FALSE,
    requested_cut_amount BIGINT NOT NULL DEFAULT 0,
    capped_cut_amount    BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, case_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 14. 상시근로자 다중 스냅샷 & 자동 프로비저닝 과제 (4F + M10)
CREATE TABLE compliance.headcount_snapshots (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    snapshot_id         UUID NOT NULL,
    calc_date           DATE NOT NULL,
    operating_days      INTEGER NOT NULL,
    cumulative_workers  NUMERIC(10,2) NOT NULL,
    lsa_regular_count   NUMERIC(7,2) NOT NULL,
    osh_regular_count   NUMERIC(7,2) NOT NULL,
    dis_regular_count   INTEGER NOT NULL,
    PRIMARY KEY (company_id, snapshot_id),
    UNIQUE (company_id, calc_date)
);

CREATE TABLE compliance.obligations (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    obligation_id       UUID NOT NULL,
    rule_code           VARCHAR(60) NOT NULL,
    module_code         VARCHAR(30) NOT NULL,
    triggered_date      DATE NOT NULL,
    statutory_due_date  DATE,
    cycle_type          VARCHAR(20) NOT NULL,
    status              VARCHAR(20) NOT NULL CHECK (
        status IN ('UPCOMING_WARN', 'ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETED', 'SCALE_DOWN_REVIEW')
    ),
    generated_doc_type  VARCHAR(60),
    completed_at        TIMESTAMPTZ,
    receipt_ref         VARCHAR(120),
    PRIMARY KEY (company_id, obligation_id)
);

-- 15. 모바일·웹 통합 계정 및 역할별 2차 인증 정보 (Mobile Auth & MFA)
CREATE TABLE auth.mobile_accounts (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    account_id          UUID NOT NULL,
    person_id           UUID,
    login_id            VARCHAR(80) NOT NULL,
    role_code           VARCHAR(20) NOT NULL CHECK (
        role_code IN ('CEO', 'HR_ADMIN', 'DEPT_MANAGER', 'WORKER')
    ),
    managed_dept_name   VARCHAR(100),
    password_scrypt     TEXT NOT NULL,
    pin_scrypt          TEXT,
    passkey_cred_id     VARCHAR(160),
    passkey_spki_b64    TEXT,
    mfa_required        BOOLEAN NOT NULL DEFAULT TRUE,
    pw_failed_attempts  INTEGER NOT NULL DEFAULT 0,
    mfa_failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    PRIMARY KEY (company_id, account_id),
    UNIQUE (company_id, login_id),
    FOREIGN KEY (company_id, person_id) REFERENCES hr.people(company_id, person_id)
);

-- 16. 모바일 접속 기기 레지스트리 및 원격 세션 해지 (Device Sessions)
-- 쿠키 원문은 저장하지 않고 SHA-256 해시(session_token_sha256)만 저장하여 DB 유출 시에도 세션 재사용을 차단한다.
CREATE TABLE auth.device_sessions (
    company_id          UUID NOT NULL,
    session_id          UUID NOT NULL,
    account_id          UUID NOT NULL,
    session_token_sha256 CHAR(64) NOT NULL UNIQUE,
    device_label        VARCHAR(120) NOT NULL,
    platform_type       VARCHAR(20) NOT NULL CHECK (
        platform_type IN ('IOS_PWA', 'ANDROID_PWA', 'MOBILE_WEB', 'HYBRID_APP', 'DESKTOP_PWA')
    ),
    auth_stage          VARCHAR(20) NOT NULL CHECK (
        auth_stage IN ('MFA_PENDING', 'AUTHENTICATED', 'REVOKED')
    ),
    csrf_secret_hash    TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID,
    PRIMARY KEY (company_id, session_id),
    FOREIGN KEY (company_id, account_id) REFERENCES auth.mobile_accounts(company_id, account_id)
);

-- 인증 전(Pre-Auth) 테넌트 컨텍스트 미설정 상태에서 BYPASSRLS 없이 최소 컬럼만 안전하게 조회하는 SECURITY DEFINER 게이트웨이 함수
CREATE OR REPLACE FUNCTION auth.lookup_session_by_token_sha256(p_token_sha256 CHAR(64))
RETURNS TABLE (company_id UUID, session_id UUID, account_id UUID, auth_stage VARCHAR, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = auth, core, pg_temp AS $$
    SELECT s.company_id, s.session_id, s.account_id, s.auth_stage, s.expires_at
      FROM auth.device_sessions s
     WHERE s.session_token_sha256 = p_token_sha256
       AND s.auth_stage <> 'REVOKED'
       AND s.expires_at > NOW()
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth.lookup_session_by_token_sha256(CHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lookup_session_by_token_sha256(CHAR) TO app_tenant_worker;

-- 17. 모바일 실시간 전자결재 요청함 (연차·연장·급여최종승인·법정신고)
CREATE TABLE hr.approval_requests (
    company_id          UUID NOT NULL,
    request_id          UUID NOT NULL,
    requester_person_id UUID,
    dept_name           VARCHAR(100),
    request_type        VARCHAR(30) NOT NULL CHECK (
        request_type IN ('LEAVE', 'OVERTIME', 'PAYROLL_CLOSE', 'DISCIPLINE', 'STATUTORY_FILING')
    ),
    title               VARCHAR(200) NOT NULL,
    detail_summary      TEXT NOT NULL,
    status              VARCHAR(20) NOT NULL CHECK (
        status IN ('PENDING_DEPT', 'PENDING_CEO', 'APPROVED', 'REJECTED')
    ),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by_account  UUID,
    decided_at          TIMESTAMPTZ,
    decision_comment    VARCHAR(300),
    PRIMARY KEY (company_id, request_id),
    FOREIGN KEY (company_id, requester_person_id) REFERENCES hr.people(company_id, person_id)
);

-- 18. 역할별 실시간 모바일 푸시·배너 알림 로그 (PII 비포함 요약만 저장)
CREATE TABLE core.realtime_notifications (
    company_id          UUID NOT NULL REFERENCES core.companies(company_id),
    notification_id     UUID NOT NULL,
    target_role         VARCHAR(20) NOT NULL CHECK (
        target_role IN ('ALL_MANAGERS', 'CEO_AND_HR', 'CEO', 'HR_ADMIN', 'DEPT_MANAGER', 'WORKER')
    ),
    target_dept_name    VARCHAR(100),
    target_emp_code     VARCHAR(30),
    severity            VARCHAR(15) NOT NULL CHECK (severity IN ('INFO', 'WARN', 'CRITICAL')),
    event_code          VARCHAR(60) NOT NULL,
    title               VARCHAR(160) NOT NULL,
    body_summary        VARCHAR(300) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, notification_id)
);

-- 19. 멀티문서 자동 온보딩 배치 및 건보↔고보 교차대사 감사 이력 (원문 PII 비저장)
CREATE TABLE core.document_ingestion_batches (
    company_id              UUID NOT NULL REFERENCES core.companies(company_id),
    batch_id                UUID NOT NULL,
    executed_by_account_id  UUID,
    detected_ksic_major     CHAR(1) NOT NULL,
    active_workers_linked   INT NOT NULL CHECK (active_workers_linked >= 0),
    alumni_workers_linked   INT NOT NULL CHECK (alumni_workers_linked >= 0),
    excluded_employer_count INT NOT NULL DEFAULT 0 CHECK (excluded_employer_count >= 0),
    reconcile_alert_count   INT NOT NULL DEFAULT 0 CHECK (reconcile_alert_count >= 0),
    source_summary_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    committed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, batch_id)
);

-- 20. 전 주기 퇴사자 사후관리·상실신고·3년 보존연한(근기법 제42조) 및 비식별 툼스톤 통합 원장
CREATE TABLE offboarding.alumni_registry (
    company_id              UUID NOT NULL REFERENCES core.companies(company_id),
    alumni_uid              VARCHAR(32) NOT NULL,
    emp_code                VARCHAR(30) NOT NULL,
    purge_tombstone_hmac    CHAR(64),
    display_name            VARCHAR(100) NOT NULL,
    dept_name               VARCHAR(100) NOT NULL,
    masked_birth_or_id      VARCHAR(24) NOT NULL DEFAULT '******-*',
    hire_date               DATE,
    last_work_date          DATE,
    loss_date_reported      DATE,
    resign_reason           VARCHAR(20) NOT NULL CHECK (
        resign_reason IN ('VOLUNTARY', 'RECOMMENDED', 'CONTRACT_END', 'RETIRE_AGE', 'DISMISSAL', 'PURGED')
    ),
    ei_loss_code            VARCHAR(10) NOT NULL,
    total_settlement_gross  BIGINT NOT NULL DEFAULT 0 CHECK (total_settlement_gross >= 0),
    settlement_due_date     DATE,
    settlement_status       VARCHAR(15) NOT NULL DEFAULT 'PENDING' CHECK (
        settlement_status IN ('PENDING', 'PAID', 'PURGED')
    ),
    nhis_loss_due_date      DATE,
    nhis_loss_status        VARCHAR(15) NOT NULL DEFAULT 'PENDING' CHECK (
        nhis_loss_status IN ('PENDING', 'FILED', 'PURGED')
    ),
    ei_loss_due_date        DATE,
    ei_loss_status          VARCHAR(15) NOT NULL DEFAULT 'PENDING' CHECK (
        ei_loss_status IN ('PENDING', 'FILED', 'PURGED')
    ),
    retention_expires_on    DATE,
    data_lifecycle_status   VARCHAR(30) NOT NULL DEFAULT 'ACTIVE_RETENTION' CHECK (
        data_lifecycle_status IN ('ACTIVE_RETENTION', 'RETENTION_EXPIRED_PURGE_DUE', 'ANONYMIZED_PURGED')
    ),
    anonymized_at           DATE,
    mobile_access_revoked   BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_alumni_lifecycle_integrity CHECK (
        (
            data_lifecycle_status = 'ANONYMIZED_PURGED'
            AND anonymized_at IS NOT NULL
            AND purge_tombstone_hmac IS NOT NULL
            AND hire_date IS NULL
            AND last_work_date IS NULL
            AND loss_date_reported IS NULL
            AND settlement_due_date IS NULL
            AND nhis_loss_due_date IS NULL
            AND ei_loss_due_date IS NULL
            AND retention_expires_on IS NULL
            AND total_settlement_gross = 0
            AND resign_reason = 'PURGED'
            AND settlement_status = 'PURGED'
            AND nhis_loss_status = 'PURGED'
            AND ei_loss_status = 'PURGED'
        )
        OR
        (
            data_lifecycle_status IN ('ACTIVE_RETENTION', 'RETENTION_EXPIRED_PURGE_DUE')
            AND anonymized_at IS NULL
            AND hire_date IS NOT NULL
            AND last_work_date IS NOT NULL
            AND loss_date_reported IS NOT NULL
            AND settlement_due_date IS NOT NULL
            AND nhis_loss_due_date IS NOT NULL
            AND ei_loss_due_date IS NOT NULL
            AND retention_expires_on IS NOT NULL
            AND last_work_date >= hire_date
            AND resign_reason <> 'PURGED'
            AND settlement_status IN ('PENDING', 'PAID')
            AND nhis_loss_status IN ('PENDING', 'FILED')
            AND ei_loss_status IN ('PENDING', 'FILED')
        )
    ),
    PRIMARY KEY (company_id, alumni_uid),
    UNIQUE (company_id, emp_code),
    UNIQUE (company_id, purge_tombstone_hmac)
);
```

### 2-3. 권한 부여(GRANT/REVOKE) 및 21개 테넌트 테이블 전수 RLS + FORCE 정책

```sql
-- 스키마 권한 분리: 일반 웹/모바일 워커는 vault 스키마 접근 전면 차단
GRANT USAGE ON SCHEMA core, auth, hr, attendance, leave, payroll, offboarding, recruit, reward, er, compliance TO app_tenant_worker;
GRANT SELECT ON core.law_rule_versions TO app_tenant_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, hr, attendance, leave, payroll, offboarding, recruit, reward, er, compliance TO app_tenant_worker;
GRANT SELECT, UPDATE ON core.companies TO app_tenant_worker;
GRANT SELECT, INSERT, UPDATE ON core.company_policy_versions TO app_tenant_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.realtime_notifications TO app_tenant_worker;
GRANT SELECT, INSERT ON core.document_ingestion_batches TO app_tenant_worker;

REVOKE ALL ON SCHEMA vault FROM PUBLIC, app_tenant_worker;
GRANT USAGE ON SCHEMA core, vault TO vault_crypto_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON vault.pii_secrets TO vault_crypto_worker;

-- 21개 테넌트 종속 테이블 전수 RLS 활성화 + FORCE ROW LEVEL SECURITY + 정책 일괄 적용
DO $$
DECLARE
    tbl TEXT;
    tenant_tables TEXT[] := ARRAY[
        'core.companies',
        'core.company_policy_versions',
        'core.realtime_notifications',
        'core.document_ingestion_batches',
        'auth.mobile_accounts',
        'auth.device_sessions',
        'hr.people',
        'hr.contracts',
        'hr.org_assignments',
        'hr.approval_requests',
        'attendance.monthly_locks',
        'leave.ledger_entries',
        'payroll.runs',
        'payroll.lines',
        'offboarding.settlements',
        'offboarding.alumni_registry',
        'recruit.job_postings',
        'reward.evaluations',
        'er.discipline_cases',
        'compliance.headcount_snapshots',
        'compliance.obligations'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %s FOR ALL TO app_tenant_worker ' ||
            'USING (company_id = core.current_tenant_id()) ' ||
            'WITH CHECK (company_id = core.current_tenant_id())',
            tbl
        );
    END LOOP;
END $$;

-- 암호화 금고(vault.pii_secrets) 전용 격리 정책 (vault_crypto_worker만 테넌트 일치 시 접근 허용)
ALTER TABLE vault.pii_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault.pii_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY vault_tenant_isolation ON vault.pii_secrets
    FOR ALL TO vault_crypto_worker
    USING (company_id = core.current_tenant_id())
    WITH CHECK (company_id = core.current_tenant_id());
```

---

## 3. 노동관계법령 핵심 계산 규칙 명세

1. **법령별 상시근로자 수 분리 산정 및 정수/비율 무결성**
   - 상용·단시간·파견·장애인 인원수 입력은 정수만 허용하며(일용직 연인원은 실수 공수 허용), 임계치 비교는 반올림 없이 원 비율(`cumulative_man_days >= threshold * operating_days`)로 판정합니다.
2. **징계 절차 및 감봉 법정 상한 캡핑 (근기법 제95조)**
   - 사업장 규모와 무관하게 감봉 요청(`requested_cut_amount > 0`)이 있을 때 사전 출석통지·소명기회·징계위 의결·서면통지 4대 절차가 모두 명시적 `true`로 확인되지 않으면 **절차 미확인 경고(`DISCIPLINARY_PROCEDURE_DEFECT`)**를 발생시킵니다.
   - 당월 감봉액은 `min(요청액, 평균일급×0.5×사안수, 당월임금총액×0.1)`로 캡핑합니다.
3. **퇴직금 역일수 및 통상임금 하한 보장**
   - 직전 3개월 역일수(`threeMonthDays`)는 실제 달력상 가능한 `89일 ~ 92일` 정수 범위만 허용하며(범위 외 입력은 `400` 오류로 거부하여 조용한 왜곡 방지), 3개월 평균임금보다 통상임금이 크면 통상임금을 퇴직금 산정 일액으로 적용합니다.

---

## 4. 모듈 간 이벤트 버스 규격 (`Event-Bus`)

| 발행 모듈 | 이벤트 타입 | 주요 페이로드 | 구독 모듈 및 자동 후속 처리 |
|---|---|---|---|
| `M1 채용` | `recruit.offer.accepted` | 지원자 기본정보, 확정 기본급, 입사예정일 | `M2 입사`: 근로계약서 초안 생성 / `4F 타워`: 상시근로자 임계치 돌파 예측 |
| `M2 입사` | `onboarding.contract.signed` | `person_id`, `contract_id`, `hire_date` | `M8 급여`: 중도입사 일할 반영 / `Mobile`: 대표·인사관리자 실시간 체결 알림 |
| `M4 근태` | `attendance.clocked` / `month.locked` | 출퇴근 타각, 확정 연장·야간·휴일, 주간 피크 근로시간 | `M8 급여`: 가산수당·주52h 경보 / `Mobile`: 대표·부서장 출근 현황판 즉시 갱신 |
| `M5·M8 결재` | `approval.requested` / `decided` | `request_type`, 요청자, 승인권자, 상태 | `Mobile`: 대표·관리자 원터치 결재함 및 근로자 처리 알림 즉시 전파 |
| `M6 평가` | `reward.compensation.confirmed` | 인상률, 성과급 | `M8 급여`: 통상시급 재산정 및 성과급 합산 |
| `M7 징계` | `er.discipline.finalized` | 4대 절차 증빙 여부, 요청 감봉액 | `M8 급여`: 절차 검증 및 제95조 한도 캡핑 공제 |
| `M9 퇴사` | `offboarding.initiated` | 퇴사사유코드, 마지막 근무일 | `4F 타워`: 정부지원금 감원방지 경보 / `M9`: 14일 내 퇴직 통합정산 |
| `4F 타워` | `compliance.threshold.crossed` | `lsa_regular_count`, `ksic_major` | `M10` 자동 개설 + `Mobile`: 대표·인사관리자 긴급 법정기한(`D-Day`) 푸시 |

---

## 5. 모바일 앱 인증 · RBAC · 실시간 스트림 보안 명세

1. **2단계 인증 승격(`MFA_PENDING` → `AUTHENTICATED`), 카운터 분리 및 공개키 서명 검증**
   - 대표(`CEO`), 인사관리자(`HR_ADMIN`), 부서관리자(`DEPT_MANAGER`) 계정은 1차 비동기 `scrypt` 비밀번호 검증 통과 시 `MFA_PENDING` 상태만 부여되며, **2차 인증(6자리 보안 PIN `scrypt` 검증 또는 등록된 ECDSA P-256 공개키 `SPKI` 기반 챌린지·Origin 전자서명 검증)** 완료 전까지 모든 대시보드·결재·스트림 API 접근을 `403 MFA_REQUIRED`로 차단합니다.
   - `pw_failed_attempts`(1차 비밀번호)와 `mfa_failed_attempts`(2차 인증) 카운터를 분리하여 **1차 재로그인으로 2차 실패 횟수를 초기화할 수 없도록 차단**하며, 각각 5회 연속 실패 시 계정을 5분간 잠금(`429`)합니다.
2. **`HttpOnly` 세션 쿠키 + SHA-256 토큰 저장 + 원격 기기 강제 해지 및 만료 정리**
   - 모바일 세션 식별자는 `localStorage`에 저장하지 않고 `HttpOnly; SameSite=Strict; Path=/` 쿠키로만 발급하며, 인증 전 조회는 `SET search_path`가 고정된 좁은 범위의 `SECURITY DEFINER` 함수(`auth.lookup_session_by_token_sha256`)로 수행한 뒤 즉시 `set_config('app.current_company_id', ...)`를 바인딩합니다.
   - 기기 원격 해지(`REVOKED`) 또는 세션 만료(`expires_at`) 시 API 접근 차단과 동시에 활성 SSE 스트림 연결을 즉시 종료합니다.
3. **서버 강제 역할별 데이터 필터링 (`RBAC`) 및 결재·급여 잠금 상태 전이**
   - 결재 상태는 `PENDING_DEPT`(부서장·인사·대표 승인 가능, 부서장·인사 승인 시 `PENDING_CEO`로 승격) → `PENDING_CEO`(**오직 `CEO`만 최종 승인/반려 가능**) → `APPROVED` / `REJECTED` 전이 규칙을 강제합니다.
   - 급여 마감 상태가 `APPROVED_LOCKED`(대표이사 최종 승인 잠금)에 도달하면 인사관리자의 재상신(`409`) 및 개별 근로자 급여 변동(`409`)을 모두 차단합니다.
   - `DEPT_MANAGER`에게는 소속 부서원의 근로시간 관련 경보(`WEEKLY_52H_*`)만 전달하고 시급·감봉액이 포함된 급여 경보 및 타 부서·전사 급여 데이터를 원천 제거합니다.
