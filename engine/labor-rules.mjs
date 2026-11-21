/**
 * 대한민국 노동관계법령 기준값 사전 및 모듈·업종 매트릭스 (기준판: 2026-v1)
 * 코드에 숫자를 흩뿌리지 않고 이 기준판 객체에서만 참조한다.
 */

export const LAW_BASELINE = Object.freeze({
  versionCode: 'KR-LABOR-2026.11',
  effectiveYear: 2026,
  minimumHourlyWage: 10320, // 시간급 최저임금 기준값 (원)
  standardMonthlyHours: 209, // 주 40시간 + 유급주휴 8시간 기준 월 환산시간
  weeklyStandardHours: 40,
  weeklyMaxOvertimeHours: 12,
  weeklyHardCapHours: 52,
  nonTaxableMealLimit: 200000,
  disabilityMandatoryRate: 0.031, // 민간기업 장애인 의무고용률 3.1%
  disabilityBaseLevyMonthly: 1291000, // 미달 1인당 월 기본 부담기초액 예시 기준값 (원)
  socialInsurance: Object.freeze({
    nationalPensionRateWorker: 0.045,
    nationalPensionMinBase: 390000,
    nationalPensionMaxBase: 6170000,
    healthInsuranceRateWorker: 0.03545,
    longTermCareRateOfHealth: 0.1295, // 건강보험료 대비 장기요양보험료율
    employmentInsuranceRateWorker: 0.009,
    biz33WithholdingRate: 0.033, // 사업소득 3% + 지방소득세 0.3%
    other88EffectiveRate: 0.088, // 기타소득(필요경비 60% 의제) 실효 원천징수율 8.8%
  }),
  disciplinaryCutLimits: Object.freeze({
    perIncidentDailyAvgRatio: 0.5, // 근로기준법 제95조: 1회 평균임금 1일분의 1/2
    totalMonthlyGrossRatio: 0.1, // 근로기준법 제95조: 총액 1임금지급기 임금총액의 1/10
  }),
  severance: Object.freeze({
    settlementDeadlineDays: 14, // 근로기준법 제36조: 퇴직일로부터 14일 이내 지급
    minWeeklyHours: 15,
    minServiceDays: 365,
  }),
});

/**
 * 한국표준산업분류(KSIC) 대표 업종 및 산업안전보건법 임계치 매핑
 */
export const INDUSTRIES = Object.freeze({
  C: Object.freeze({
    code: 'C',
    name: '제조업 (금속·기계·전자·식품 등)',
    oshSafetyOfficerMin: 50, // 50~299인 전문기관 위탁 가능, 300인+ 전담
    oshHealthOfficerMin: 50,
    oshManagerMin: 50, // 안전보건관리책임자(제조업 등 50인 이상)
    oshCommitteeMin: 50, // 산업안전보건위원회(제조업 50인 이상)
    oshRegulationMin: 100, // 안전보건관리규정(제조업 100인 이상)
    quarterlySafetyEduHoursOffice: 3,
    quarterlySafetyEduHoursField: 6,
    isSafetyEduExemptUnder50: false,
  }),
  F: Object.freeze({
    code: 'F',
    name: '건설업 (종합·전문건설)',
    oshSafetyOfficerMin: 50,
    oshHealthOfficerMin: 50,
    oshManagerMin: 50,
    oshCommitteeMin: 50,
    oshRegulationMin: 100,
    quarterlySafetyEduHoursOffice: 3,
    quarterlySafetyEduHoursField: 6,
    isSafetyEduExemptUnder50: false,
  }),
  H: Object.freeze({
    code: 'H',
    name: '운수 및 창고업 (물류·운송)',
    oshSafetyOfficerMin: 50,
    oshHealthOfficerMin: 50,
    oshManagerMin: 100,
    oshCommitteeMin: 100,
    oshRegulationMin: 100,
    quarterlySafetyEduHoursOffice: 3,
    quarterlySafetyEduHoursField: 6,
    isSafetyEduExemptUnder50: false,
  }),
  G: Object.freeze({
    code: 'G',
    name: '도매 및 소매업 · 숙박음식점업',
    oshSafetyOfficerMin: 50,
    oshHealthOfficerMin: 50,
    oshManagerMin: 100,
    oshCommitteeMin: 100,
    oshRegulationMin: 100,
    quarterlySafetyEduHoursOffice: 3,
    quarterlySafetyEduHoursField: 6,
    isSafetyEduExemptUnder50: true, // 일부 도소매/숙박음식 50인 미만 정기교육 특례 표시용
  }),
  J: Object.freeze({
    code: 'J',
    name: '정보통신업 · IT · 소프트웨어 개발업',
    oshSafetyOfficerMin: null, // 소프트웨어 개발 등 일부 사무직 중심 업종 적용 제외(별표1 반영)
    oshHealthOfficerMin: null,
    oshManagerMin: 300,
    oshCommitteeMin: 300,
    oshRegulationMin: 300,
    quarterlySafetyEduHoursOffice: 3,
    quarterlySafetyEduHoursField: 3,
    isSafetyEduExemptUnder50: true,
  }),
  Q: Object.freeze({
    code: 'Q',
    name: '보건업 및 사회복지 서비스업 (병원·요양)',
    oshSafetyOfficerMin: 50, // 병원 등 세부 업종 기준 안전·보건관리 체제 점검
    oshHealthOfficerMin: 50,
    oshManagerMin: 100,
    oshCommitteeMin: 100,
    oshRegulationMin: 100,
    quarterlySafetyEduHoursOffice: 3,
    quarterlySafetyEduHoursField: 6,
    isSafetyEduExemptUnder50: false,
  }),
});

/**
 * 4계층 모듈형 플로어(Floor Plan) 전체 카탈로그
 */
export const MODULE_CATALOG = Object.freeze([
  // 4F: 거버넌스 & 자동 컴플라이언스 컨트롤타워
  {
    id: 'C_TOWER',
    floor: 4,
    floorLabel: '4F 자동 컴플라이언스 컨트롤타워',
    code: 'M10-Core',
    title: '상시근로자 다중 산정 & 법령 프로비저너',
    minWorkers: 1,
    category: 'GOVERNANCE',
    summary: '일별 연인원/가동일수를 집계해 근기법·산안법·장애인법 기준 인원을 산출하고 규모 돌파 시 제도와 일정을 자동 개설합니다.',
    legalGuardrail: '근로기준법 시행령 제7조의2, 산안법 시행령 별표1~5, 장애인고용법 제28조',
    payrollLink: '매월 급여 실행 시 5인 이상/미만 가산율(50%/100%) 자동 결정',
  },
  {
    id: 'C_SUBSIDY',
    floor: 4,
    floorLabel: '4F 자동 컴플라이언스 컨트롤타워',
    code: 'M10-Audit',
    title: '법정기한 에스컬레이션 & 지원금 감원방지 감시',
    minWorkers: 1,
    category: 'GOVERNANCE',
    summary: '관공서 신고(14일/15일)·퇴직금(14일) 마감 카운트다운과 권고사직·해고 시 고용지원금 중단 위험을 사전 차단합니다.',
    legalGuardrail: '고용보험법 고용창출·고용유지 지원금 감원방지 규정, 각 개별법 과태료 조항',
    payrollLink: '지원금 수급 대상자 급여이체 증빙 및 퇴직정산 경고 연동',
  },

  // 3F: 인재·노사·안전보건 플러그인 확장층
  {
    id: 'M1_RECRUIT',
    floor: 3,
    floorLabel: '3F 인재·노사·안전 확장 모듈층',
    code: 'M1',
    title: '채용 · 공정채용 필터 (ATS)',
    minWorkers: 1,
    autoEnforceAt: 30,
    category: 'TALENT',
    summary: '채용요청(TO)~공고~면접~처우 산정을 관리하며, 30인 이상 시 직무 무관 개인정보 요구 차단 및 서류반환 고지를 강제합니다.',
    legalGuardrail: '채용절차의 공정화에 관한 법률 제4조의3(출신지·혼인·재산 요구 금지), 제11조(서류 반환)',
    payrollLink: '처우 확정액 최저임금 역산 검증 후 M2 근로계약·급여 마스터로 무입력 이관',
  },
  {
    id: 'M6_EVAL_REWARD',
    floor: 3,
    floorLabel: '3F 인재·노사·안전 확장 모듈층',
    code: 'M6',
    title: '인사평가 · 성과보상 시뮬레이터',
    minWorkers: 1,
    optionalBelow: 10,
    category: 'TALENT',
    summary: 'KPI/MBO·다면평가 등급을 산출하고 평가 결과에 따른 기본급 인상률·호봉 승급·성과급(PS/PI)을 시뮬레이션합니다.',
    legalGuardrail: '남녀고용평등법 동일가치노동 동일임금 원칙, 통상임금/평균임금 산입 여부 판별',
    payrollLink: '연봉 갱신 확정분·소급 인상분·성과급을 당월 M8 급여 엔진에 자동 주입',
  },
  {
    id: 'M7_DISCIPLINE',
    floor: 3,
    floorLabel: '3F 인재·노사·안전 확장 모듈층',
    code: 'M7',
    title: '징계 · 고충처리 · 부당해고 방어 가드레일',
    minWorkers: 1,
    autoEnforceAt: 5,
    category: 'LABOR_RELATIONS',
    summary: '출석통지→소명기회→징계위 의결→서면통지 절차를 강제하고, 감봉 법정한도 캡핑 및 30인+ 고충처리위원을 운영합니다.',
    legalGuardrail: '근로기준법 제23조(정당한 이유), 제26·27조(해고예고·서면통지), 제95조(감봉 제재 제한)',
    payrollLink: '감봉액(일급 1/2·월급 1/10 상한 캡핑) 및 정직 무급 일할공제를 M8 급여에 자동 반영',
  },
  {
    id: 'M10_WORK_RULE',
    floor: 3,
    floorLabel: '3F 인재·노사·안전 확장 모듈층',
    code: 'M10-Rule',
    title: '취업규칙 작성 · 동의 · 노동청 신고',
    minWorkers: 10,
    autoProvision: true,
    category: 'COMPLIANCE',
    summary: '상시 10인 이상 진입 시 표준취업규칙 기반 초안 작성, 근로자 과반수 의견청취(불이익 변경 시 동의), 노동청 신고서를 생성합니다.',
    legalGuardrail: '근로기준법 제93조(취업규칙 작성·신고), 제94조(규칙의 변경 절차), 제97조(위반 효력)',
    payrollLink: '취업규칙상 수당·상여·휴가·퇴직 기준을 급여 설정 판과 정합성 대조',
  },
  {
    id: 'M10_LMC',
    floor: 3,
    floorLabel: '3F 인재·노사·안전 확장 모듈층',
    code: 'M10-A',
    title: '노사협의회 규정 · 전자투표 · 분기 운영',
    minWorkers: 30,
    autoProvision: true,
    category: 'COMPLIANCE',
    summary: '상시 30인 이상 진입 즉시 노사협의회 규정 초안, 근로자위원 비밀투표, 15일 내 규정 신고서, 분기별 정기회의 시스템을 구축합니다.',
    legalGuardrail: '근로자참여 및 협력증진에 관한 법률 제4조(설치), 제12조(분기 정기회의), 제17조(15일 내 규정신고), 제26조(고충위원)',
    payrollLink: '협의회 의결 복리후생·임금체계 개편 사항의 이행 일정 추적',
  },
  {
    id: 'M10_OSH_DIS',
    floor: 3,
    floorLabel: '3F 인재·노사·안전 확장 모듈층',
    code: 'M10-B/C',
    title: '안전보건관리체제 · 산안위 · 장애인고용',
    minWorkers: 50,
    autoProvision: true,
    category: 'SAFETY_WELFARE',
    summary: '50인+ 제조업 등 안전·보건관리자 선임(14일 내 보고), 산업안전보건위원회 분기 운영, 위험성평가 및 장애인 의무고용(3.1%)을 관리합니다.',
    legalGuardrail: '산업안전보건법 제15~19조·제24·25·36조, 중대재해처벌법 제4조, 장애인고용법 제28·33조',
    payrollLink: '장애인 고용장려금·고용부담금 추계 및 안전보건 직무수당 연동',
  },

  // 2F: 필수 일상 인사·근태·급여 코어 운영층
  {
    id: 'M2_ONBOARD',
    floor: 2,
    floorLabel: '2F 필수 인사·근태·급여 운영층',
    code: 'M2',
    title: '입사 · 전자근로계약 · 4대보험 취득',
    minWorkers: 1,
    category: 'CORE_OPS',
    summary: '근로계약서 필수 명시항목 검증·전자서명·즉시 교부 기록을 남기고 4대보험 자격취득신고 및 채용 시 의무교육을 배정합니다.',
    legalGuardrail: '근로기준법 제17조(근로조건 명시·교부), 기간제법 제17조',
    payrollLink: '입사일 기준 급여 마스터 등록 및 중도입사 일할계산 자동 발동',
  },
  {
    id: 'M3_ORG_HR',
    floor: 2,
    floorLabel: '2F 필수 인사·근태·급여 운영층',
    code: 'M3',
    title: '통합 인사명부 · 발령 · 재직/경력증명',
    minWorkers: 1,
    category: 'CORE_OPS',
    summary: '상용·일용·3.3%·8.8% 대상을 불변 고유번호로 관리하고 전보·승진·휴직·복직 발령과 증명서 발급대장을 운영합니다.',
    legalGuardrail: '근로기준법 제41조(근로자명부), 제39조(사용증명서)',
    payrollLink: '휴·복직 구간 급여 일할계산 및 4대보험 납부예외·유예 신고 자동 생성',
  },
  {
    id: 'M4_ATTENDANCE',
    floor: 2,
    floorLabel: '2F 필수 인사·근태·급여 운영층',
    code: 'M4',
    title: '근태 · 교대/탄력근무 · 주52시간 가드레일',
    minWorkers: 1,
    category: 'CORE_OPS',
    summary: '출퇴근·연장·야간·휴일근로를 집계하며, 5인 이상 사업장에 주 52시간 실시간 경보 및 월말 근태 잠금을 제공합니다.',
    legalGuardrail: '근로기준법 제50~53조(근로시간·탄력근무·연장한도), 제54조(휴게), 제55조(휴일)',
    payrollLink: '확정 연장·야간·휴일근로 분 단위 데이터를 M8 급여 엔진에 직결',
  },
  {
    id: 'M5_LEAVE',
    floor: 2,
    floorLabel: '2F 필수 인사·근태·급여 운영층',
    code: 'M5',
    title: '연차 · 법정휴가 · 모성보호 · 촉진 통지',
    minWorkers: 1,
    category: 'CORE_OPS',
    summary: '입사일/회계연도 분·시간 단위 연차원장, 1·2차 연차사용촉진 자동 통지, 출산·육아휴직 급여/대체인력 서류를 관리합니다.',
    legalGuardrail: '근로기준법 제60조(연차)·제61조(사용촉진)·제74조(출산휴가), 남녀고용평등법 제19조(육아휴직)',
    payrollLink: '무급휴가 차감액 및 촉진 미실시분 미사용연차수당을 M8 급여에 자동 산입',
  },
  {
    id: 'M8_PAYROLL',
    floor: 2,
    floorLabel: '2F 필수 인사·근태·급여 운영층',
    code: 'M8',
    title: '자동 급여 · 원천세 · 4대보험 통합 정산',
    minWorkers: 1,
    category: 'CORE_OPS',
    summary: '전 모듈 이벤트를 수집해 상용·일용·3.3%·8.8% 급여를 원 단위 정산하고 산출식 명시 임금명세서·이체파일·신고파일을 생성합니다.',
    legalGuardrail: '근로기준법 제43조(임금지급 4대 원칙)·제48조(임금대장·명세서 교부)·제56조, 최저임금법 제6조',
    payrollLink: '중심 정산 허브 (스냅샷 판 잠금·3.3% 근로자성 경고·간이지급명세서 출력)',
  },
  {
    id: 'M9_OFFBOARD',
    floor: 2,
    floorLabel: '2F 필수 인사·근태·급여 운영층',
    code: 'M9',
    title: '퇴사 · 퇴직금(평균vs통상) · 이직확인서',
    minWorkers: 1,
    category: 'CORE_OPS',
    summary: '사직코드 검증, 3개월 평균임금·통상임금 비교 퇴직금 정산, 14일 이내 지급 타이머, 4대보험 상실·이직확인서를 원스톱 생성합니다.',
    legalGuardrail: '근로기준법 제36조(금품청산 14일), 근로자퇴직급여 보장법 제8·9조, 고용보험법 제42조',
    payrollLink: '마지막 달 일할급여 + 미사용연차수당 + 퇴직소득세 중도정산 일괄 합산',
  },

  // 1F: 플랫폼 기반 금고·법령DB·이벤트층
  {
    id: 'B_VAULT',
    floor: 1,
    floorLabel: '1F 기반 보안금고 · 법령DB · 이벤트층',
    code: '1F-Vault',
    title: '테넌트 분리 저장소 & 개인정보 암호화 금고',
    minWorkers: 1,
    category: 'FOUNDATION',
    summary: '회사별 데이터 격리(RLS) 및 주민등록번호·계좌번호 분리 암호화 보관, 열람 감사로그를 담당합니다.',
    legalGuardrail: '개인정보 보호법 제24조(고유식별정보 암호화)·제29조(안전조치의무)',
    payrollLink: '은행 급여이체·공단 신고 파일 생성 시에만 권한 검증 후 일회성 복호화',
  },
  {
    id: 'B_LAW_ENGINE',
    floor: 1,
    floorLabel: '1F 기반 보안금고 · 법령DB · 이벤트층',
    code: '1F-LawDB',
    title: '법령 기준판 버전 DB & 문서·전자서명 엔진',
    minWorkers: 1,
    category: 'FOUNDATION',
    summary: '연도별 최저임금·4대보험 요율·법정휴가표를 판(Version)으로 관리하고 규정·계약서·신고서·회의록 초안을 생성합니다.',
    legalGuardrail: '근로기준법 제42조(계약서류 3년 보존), 전자서명법·전자문서법',
    payrollLink: '과거 귀속월 소급 정산 시 해당 시점의 법령 기준판 정확히 재현',
  },
]);

/**
 * 채용절차의 공정화에 관한 법률 제4조의3 (출신지역 등 개인정보 요구 금지) 점검 사전
 */
export const FAIR_HIRING_FORBIDDEN_RULES = Object.freeze([
  { pattern: /출신\s*지역|본적|고향/, label: '출신지역·본적', article: '채용절차법 제4조의3 제1호' },
  { pattern: /혼인\s*여부|결혼\s*여부|미혼|기혼/, label: '혼인여부', article: '채용절차법 제4조의3 제1호' },
  { pattern: /재산|부동산\s*소유|부채\s*현황/, label: '재산 현황', article: '채용절차법 제4조의3 제1호' },
  { pattern: /부모님?\s*직업|직계\s*존비속|형제\s*자매\s*학력|가족\s*학력|부모\s*재산/, label: '직계존비속·형제자매의 학력·직업·재산', article: '채용절차법 제4조의3 제3호' },
  { pattern: /신장\s*체중|키\s*몸무게|용모\s*단정\s*필수|증명사진\s*필수\s*부착\s*\(외모\)/, label: '직무 무관 신체적 조건(키·체중·용모)', article: '채용절차법 제4조의3 제1호' },
]);
