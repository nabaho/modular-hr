/**
 * M1~M7 · M10 일상 인사노무 관리 시스템 통합 운영 엔진 (HR Operations Suite)
 * - 사업장 초기 세팅(환경설정) 이외의 실무 관리 모듈 전체를 구동·시뮬레이션한다:
 *   1) M1·M2 채용 파이프라인 · 채용절차법 가드레일 · 전자근로계약(제17조) · 4대보험 취득
 *   2) M3 인사기록카드 · 부서 조직현황 · 인사발령(승진·전보·육아휴직·복직) · 재직증명서
 *   3) M4 실시간 출퇴근 · 교대/선택근무제 · 주 52시간 상한 관제 보드
 *   4) M5 연차유급휴가(제60조 자동산정) · 제61조 1·2차 서면 연차사용촉진 · 모성보호
 *   5) M6 인사평가(KPI·역량) · 등급 배분 · 연봉인상/성과급 시뮬레이션(M8 급여 직결)
 *   6) M7 적법 징계 4대 절차 · 제95조 감봉 상한 캡핑 · 30인+ 고충처리위원(10일 기한) 대장
 *   7) M10 노사협의회 위원·안건 · 산업안전보건 선임·위험성평가 · 5대 법정의무교육 이수 감독
 */

import crypto from './browser-crypto-shim.mjs?v=9f5b61edb8c1';
import { addDaysISO, diffDaysISO, isValidIsoDate } from './compliance-provisioner.mjs?v=9f5b61edb8c1';
import { computeMonthlyRefHours } from './lifecycle-payroll.mjs?v=9f5b61edb8c1';
import { LAW_BASELINE } from './labor-rules.mjs?v=9f5b61edb8c1';

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function conflictError(message) {
  const err = new Error(message);
  err.statusCode = 409;
  return err;
}

function assertBoundedFiniteNumber(raw, fieldName, min, max) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    throw badRequest(`${fieldName} 값은 ${min} 이상 ${max.toLocaleString('ko-KR')} 이하의 유한한 숫자여야 합니다.`);
  }
  return raw;
}

export const DEFAULT_POLICY_SETTINGS = Object.freeze({
  leaveAccrualBasis: 'HIRE_DATE', // 'HIRE_DATE' | 'FISCAL_YEAR'
  fiscalYearStartMonthDay: '01-01', // '01-01' | '04-01' | '07-01'
  leaveRoundingRule: 'ROUND_TENTH', // 'ROUND_TENTH' | 'CEIL_HALF' | 'CEIL_INT'
  leaveSettlementPolicy: 'PROMOTE_FIRST', // 'PROMOTE_FIRST' | 'FULL_PAYOUT'
  payDayLabel: '매월 25일',
  withholdingTaxRatePct: 100, // 80 | 100 | 120
  nonTaxableMealLimit: 200000, // 0 ~ 200000
  weeklyWarnHours: 48, // 44 ~ 51
});

export function normalizePolicySettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    leaveAccrualBasis: src.leaveAccrualBasis === 'FISCAL_YEAR' ? 'FISCAL_YEAR' : 'HIRE_DATE',
    fiscalYearStartMonthDay: ['01-01', '04-01', '07-01'].includes(src.fiscalYearStartMonthDay)
      ? src.fiscalYearStartMonthDay
      : '01-01',
    leaveRoundingRule: ['ROUND_TENTH', 'CEIL_HALF', 'CEIL_INT'].includes(src.leaveRoundingRule)
      ? src.leaveRoundingRule
      : 'ROUND_TENTH',
    leaveSettlementPolicy: src.leaveSettlementPolicy === 'FULL_PAYOUT' ? 'FULL_PAYOUT' : 'PROMOTE_FIRST',
    payDayLabel: ['매월 10일', '매월 15일', '매월 25일', '매월 말일'].includes(src.payDayLabel)
      ? src.payDayLabel
      : '매월 25일',
    withholdingTaxRatePct: [80, 100, 120].includes(Number(src.withholdingTaxRatePct))
      ? Number(src.withholdingTaxRatePct)
      : 100,
    nonTaxableMealLimit:
      typeof src.nonTaxableMealLimit === 'number' &&
      Number.isFinite(src.nonTaxableMealLimit) &&
      src.nonTaxableMealLimit >= 0 &&
      src.nonTaxableMealLimit <= 200000
        ? Math.round(src.nonTaxableMealLimit)
        : 200000,
    weeklyWarnHours:
      typeof src.weeklyWarnHours === 'number' &&
      Number.isFinite(src.weeklyWarnHours) &&
      src.weeklyWarnHours >= 44 &&
      src.weeklyWarnHours <= 51
        ? Number(src.weeklyWarnHours)
        : 48,
  };
}

function applyLeaveRounding(rawDays, rule) {
  if (rule === 'CEIL_INT') return Math.ceil(rawDays);
  if (rule === 'CEIL_HALF') return Math.ceil(rawDays * 2) / 2;
  return Math.round(rawDays * 10) / 10;
}

/**
 * 입사일·기준일 및 회사 환경설정(입사일 기준 vs 회계연도 일괄 기준)에 따른 연차유급휴가 자동 산정
 * - HIRE_DATE(입사일 기준): 제60조 원칙 (1년 미만 월차 최대 11일 / 1년 이상 15~25일)
 * - FISCAL_YEAR(회계연도 기준): 회계연도 개시일(예: 매년 01-01) 일괄 부여 (직전연도 중도입사자 비례연차 + 퇴직 시 입사일 기준 비교 안내 포함)
 */
export function computeStatutoryAnnualLeaveDays(hireDate, referenceDate = '2026-11-15', policyInput = {}) {
  const policy = normalizePolicySettings(policyInput);
  if (!isValidIsoDate(hireDate) || !isValidIsoDate(referenceDate) || hireDate > referenceDate) {
    const fallbackYear = isValidIsoDate(referenceDate) ? referenceDate.slice(0, 4) : '2026';
    return {
      accruedDays: 15,
      hireBasisDays: 15,
      ruleBasis: '기본 15일 (입사일 미정 표준치)',
      cycleExpiryDate: `${fallbackYear}-12-31`,
      promoWindowLabel: '만료 6개월·2개월 전',
      serviceMonths: 12,
      serviceYears: 1,
    };
  }
  const days = diffDaysISO(hireDate, referenceDate);
  const serviceMonths = Math.max(0, Math.floor(days / 30.4375));
  const serviceYears = Math.floor(days / 365);

  const hireBasisDays =
    days < 365
      ? Math.min(11, Math.max(1, serviceMonths))
      : Math.min(25, 15 + Math.floor(Math.max(0, serviceYears - 1) / 2));

  if (policy.leaveAccrualBasis === 'FISCAL_YEAR') {
    const refYear = Number(referenceDate.slice(0, 4));
    const candidateStart = `${refYear}-${policy.fiscalYearStartMonthDay}`;
    const fyStartYear = referenceDate >= candidateStart ? refYear : refYear - 1;
    const fyStart = `${fyStartYear}-${policy.fiscalYearStartMonthDay}`;
    const nextFyStart = `${fyStartYear + 1}-${policy.fiscalYearStartMonthDay}`;
    const fyEnd = addDaysISO(nextFyStart, -1);
    const stage1Start = addDaysISO(nextFyStart, -183);
    const stage2Due = addDaysISO(nextFyStart, -61);
    const promoWindowLabel = `1차 ${stage1Start.slice(5)} · 2차 ${stage2Due.slice(5)} (만료 ${fyEnd})`;

    if (hireDate >= fyStart) {
      const curMonths = Math.min(11, Math.max(1, serviceMonths));
      return {
        accruedDays: curMonths,
        hireBasisDays,
        ruleBasis: `회계연도(${policy.fiscalYearStartMonthDay}) 당해입사 · 1개월 개근 월차 ${curMonths}일`,
        cycleExpiryDate: fyEnd,
        promoWindowLabel,
        serviceMonths,
        serviceYears: 0,
      };
    }

    const daysBeforeFy = diffDaysISO(hireDate, fyStart);
    if (daysBeforeFy < 365) {
      const rawProportional = (15 * Math.max(1, daysBeforeFy)) / 365;
      const proportionalDays = applyLeaveRounding(rawProportional, policy.leaveRoundingRule);
      const remainingFirstYearMonths = Math.max(
        0,
        11 - Math.floor(daysBeforeFy / 30.4375)
      );
      const combinedDays = applyLeaveRounding(
        proportionalDays + Math.min(remainingFirstYearMonths, serviceMonths),
        policy.leaveRoundingRule
      );
      const cappedCombined = Math.min(26, Math.max(proportionalDays, combinedDays));
      return {
        accruedDays: cappedCombined,
        hireBasisDays,
        ruleBasis: `회계연도(${fyStart}) 비례 ${proportionalDays}일 + 1년미만 월차분 (퇴직 시 입사일기준 ${hireBasisDays}일 비교)`,
        cycleExpiryDate: fyEnd,
        promoWindowLabel,
        serviceMonths,
        serviceYears: 0,
      };
    }

    const fyYears = Math.floor(daysBeforeFy / 365);
    const fyExtra = Math.floor(Math.max(0, fyYears - 1) / 2);
    const fyTotal = Math.min(25, 15 + fyExtra);
    return {
      accruedDays: fyTotal,
      hireBasisDays,
      ruleBasis: `회계연도(${fyStart} 일괄) 근속 ${fyYears}년: 15일 + 가산 ${fyTotal - 15}일 (입사일기준 ${hireBasisDays}일)`,
      cycleExpiryDate: fyEnd,
      promoWindowLabel,
      serviceMonths,
      serviceYears: fyYears,
    };
  }

  const annivYear = Number(hireDate.slice(0, 4)) + (serviceYears + 1);
  const nextAnnivCandidate = `${annivYear}-${hireDate.slice(5, 10)}`;
  const safeNextAnniv = isValidIsoDate(nextAnnivCandidate)
    ? nextAnnivCandidate
    : `${annivYear}-02-28`;
  const cycleExpiryDate = addDaysISO(safeNextAnniv, -1);
  const promoWindowLabel = `개별만료 ${cycleExpiryDate} (6개월·2개월 전)`;

  if (days < 365) {
    const monthlyAccrued = Math.min(11, Math.max(1, serviceMonths));
    return {
      accruedDays: monthlyAccrued,
      hireBasisDays,
      ruleBasis: `입사일 기준 제60조② (1년 미만 월차 최대 11일 · 현재 ${serviceMonths}개월)`,
      cycleExpiryDate,
      promoWindowLabel,
      serviceMonths,
      serviceYears: 0,
    };
  }
  const extraDays = Math.floor(Math.max(0, serviceYears - 1) / 2);
  const total = Math.min(25, 15 + extraDays);
  return {
    accruedDays: total,
    hireBasisDays,
    ruleBasis: `입사일 기준 제60조①·④ (근속 ${serviceYears}년: 기본 15일 + 가산 ${total - 15}일)`,
    cycleExpiryDate,
    promoWindowLabel,
    serviceMonths,
    serviceYears,
  };
}

export function createOperationsSuiteManager() {
  let applicantSeq = 105;
  let hireEmpSeq = 266;
  let assignmentSeq = 304;
  let grievanceSeq = 403;

  const applicants = [
    {
      applicantId: 'APP-101',
      name: '서지훈',
      maskedBirth: '930618-*******',
      targetDept: '정밀가공2팀',
      jobRole: 'CNC 5축 정밀가공 기사',
      stage: 'OFFER_CONFIRMED',
      stageLabel: '최종합격 · 처우확정',
      weeklyHours: 40,
      offeredMonthlyPay: 3300000,
      blindCheckPassed: true,
      docReturnDueOn: '2026-12-30',
      hiredEmpCode: null,
    },
    {
      applicantId: 'APP-102',
      name: '윤채원',
      maskedBirth: '961104-*******',
      targetDept: '품질보증팀',
      jobRole: '품질보증(QA) 전담 엔지니어',
      stage: 'INTERVIEW_2',
      stageLabel: '2차 실무면접 진행중',
      weeklyHours: 40,
      offeredMonthlyPay: 3150000,
      blindCheckPassed: true,
      docReturnDueOn: '2026-12-30',
      hiredEmpCode: null,
    },
    {
      applicantId: 'APP-103',
      name: '한도현',
      maskedBirth: '880923-*******',
      targetDept: '생산기술1팀',
      jobRole: '산업안전기사 (안전관리자 후보)',
      stage: 'OFFER_REVIEW',
      stageLabel: '처우·최저임금 검증중',
      weeklyHours: 40,
      offeredMonthlyPay: 3850000,
      blindCheckPassed: true,
      docReturnDueOn: '2026-12-30',
      hiredEmpCode: null,
    },
    {
      applicantId: 'APP-104',
      name: '김민규',
      maskedBirth: '990211-*******',
      targetDept: '물류출하팀',
      jobRole: '출하검수 단시간 사원',
      stage: 'DOC_RETENTION',
      stageLabel: '불합격 · 반환청구 대비 보관(D-14)',
      weeklyHours: 25,
      offeredMonthlyPay: 1450000,
      blindCheckPassed: true,
      docReturnDueOn: '2026-11-29',
      hiredEmpCode: null,
    },
  ];

  // 근로자별 전자계약 체결 · 연차사용일 · 연차촉진 단계 · 평가등급 오버라이드 맵
  const contractSignedMap = new Map([
    ['EMP-201', { signed: true, signedAt: '2026-03-02', nhisAcquired: true, eiAcquired: true }],
    ['EMP-202', { signed: true, signedAt: '2026-03-02', nhisAcquired: true, eiAcquired: true }],
    ['EMP-203', { signed: false, signedAt: null, nhisAcquired: true, eiAcquired: true }],
    ['EMP-204', { signed: true, signedAt: '2026-04-01', nhisAcquired: true, eiAcquired: true }],
  ]);

  const leaveUsageMap = new Map([
    ['EMP-201', { usedDays: 6.5, promoStage: 'STAGE_1_SENT' }],
    ['EMP-202', { usedDays: 4.0, promoStage: 'NONE' }],
    ['EMP-203', { usedDays: 3.0, promoStage: 'STAGE_2_DESIGNATED' }],
    ['EMP-204', { usedDays: 2.0, promoStage: 'NONE' }],
  ]);

  const evalGradeMap = new Map([
    ['EMP-201', { kpiScore: 93, competencyScore: 91, grade: 'A', recommendedRaisePct: 5, recommendedBonus: 300000, appliedToPayroll: true }],
    ['EMP-202', { kpiScore: 79, competencyScore: 81, grade: 'B', recommendedRaisePct: 3, recommendedBonus: 150000, appliedToPayroll: false }],
    ['EMP-203', { kpiScore: 88, competencyScore: 86, grade: 'A', recommendedRaisePct: 4, recommendedBonus: 200000, appliedToPayroll: false }],
    ['EMP-204', { kpiScore: 95, competencyScore: 94, grade: 'S', recommendedRaisePct: 7, recommendedBonus: 400000, appliedToPayroll: false }],
  ]);

  let assignmentLogs = [
    {
      assignmentId: 'ASG-301',
      effectiveDate: '2026-10-01',
      empCode: 'EMP-201',
      displayName: '김하늘',
      orderType: 'PROMOTION',
      orderLabel: '정기 승진 및 호봉 인상',
      beforeSummary: '생산기술1팀 · 기사',
      afterSummary: '생산기술1팀 · 선임기사 (기본급 +5% 연동)',
      insuranceSyncNote: '보수월액 변경신고 기준 반영',
    },
    {
      assignmentId: 'ASG-302',
      effectiveDate: '2026-10-15',
      empCode: 'EMP-202',
      displayName: '이바다',
      orderType: 'TRANSFER',
      orderLabel: '부서 전보 발령',
      beforeSummary: '생산기술1팀 · 주임',
      afterSummary: '품질보증팀 · 주임',
      insuranceSyncNote: '산재 직종코드 동일 유지',
    },
    {
      assignmentId: 'ASG-303',
      effectiveDate: '2026-11-01',
      empCode: 'EMP-204',
      displayName: '박산들',
      orderType: 'SHORTENED_HOURS',
      orderLabel: '가족돌봄 근로시간 단축 (주 20h)',
      beforeSummary: '고객지원파트 · 주 40시간',
      afterSummary: '고객지원파트 · 주 20시간 단시간 전환',
      insuranceSyncNote: '남녀고용평등법 제22조의3 · 워라밸장려금 연계',
    },
  ];

  const maternityProtections = [
    {
      caseId: 'MAT-01',
      programType: '출산전후휴가 (근기법 제74조)',
      periodLabel: '2026-10-01 ~ 2026-12-29 (90일 · 다태아 120일)',
      deptName: '경영지원팀',
      beneficiaryLabel: '보호대상 근로자 A (비식별)',
      govSubsidyStatus: '우선지원대상기업 90일분 고용보험 급여 신청 완료',
      employerObligation: '최초 60일 통상임금 차액 지급 · 휴가 종료 후 동일업무 복귀 보장',
    },
    {
      caseId: 'MAT-02',
      programType: '육아기 근로시간 단축 (남녀고용평등법 제19조의2)',
      periodLabel: '2026-11-01 ~ 2027-04-30 (주 40h → 주 25h)',
      deptName: '품질보증팀',
      beneficiaryLabel: '보호대상 근로자 B (비식별)',
      govSubsidyStatus: '육아기 근로시간 단축 급여 + 사업주 장려금(월 30만 원) 수급 중',
      employerObligation: '단축 시간 비례 외 불이익 금지 · 명시적 청구 외 연장근로 금지',
    },
  ];

  let grievances = [
    {
      grievanceId: 'GRV-401',
      receivedAt: '2026-11-09',
      dueDate: '2026-11-19',
      category: '작업환경 · 교대휴게',
      channel: '익명 온라인 고충함',
      summary: '정밀가공 2교대 야간조 휴게실 난방 및 국소배기장치 소음 개선 요청',
      assignedCommissioner: '근로자측 고충처리위원',
      status: 'IN_PROGRESS',
      resolutionNote: '현장 설비팀 점검 완료 · 흡음재 시공 견적 승인 대기',
    },
    {
      grievanceId: 'GRV-402',
      receivedAt: '2026-11-02',
      dueDate: '2026-11-12',
      category: '직장 내 고충 · 업무배분',
      channel: '고충처리위원 대면상담',
      summary: '신규 검사장비 도입에 따른 품질보증팀 교육시간 확보 및 연장근로 편중 조정 건',
      assignedCommissioner: '노사 공동 고충처리위원',
      status: 'RESOLVED_NOTIFIED',
      resolutionNote: '2026-11-08 주간 교육 4h 유급 배정 및 순환배치 조치 통보 완료 (6일 내 처리)',
    },
  ];

  const riskAssessments = [
    {
      riskId: 'RSK-01',
      processName: 'CNC 선반·밀링 절삭가공 공정',
      hazardFactor: '회전체 칩 비산 및 절삭유 미스트 흡입 위험',
      riskLevel: 'HIGH',
      measurePlan: '인터록 안전도어 점검 및 고효율 오일미스트 집진기 필터 교체',
      completed: false,
    },
    {
      riskId: 'RSK-02',
      processName: '중량 금형 지게차 입출고 구역',
      hazardFactor: '보행 작업자·지게차 동선 교차 충돌 위험',
      riskLevel: 'HIGH',
      measurePlan: '레이저 투광 안전가드 설치 및 보행자 전용 통로 구획 도색',
      completed: true,
    },
    {
      riskId: 'RSK-03',
      processName: '유기용제 세척 및 포장 라인',
      hazardFactor: 'MSDS 경고표지 마모 및 국소배기 제어풍속 저하',
      riskLevel: 'MEDIUM',
      measurePlan: '물질안전보건자료(MSDS) 현장 비치 갱신 및 풍속 측정 완료',
      completed: true,
    },
  ];

  const statutoryTrainings = [
    {
      trainingId: 'EDU-HARASSMENT',
      title: '직장 내 성희롱 예방교육',
      legalBasis: '남녀고용평등법 제13조 (연 1회 · 1시간 이상 · 전 사업장 의무)',
      cycleLabel: '연 1회 (2026년 하반기)',
      completionRatePct: 92,
      remindedCount: 1,
    },
    {
      trainingId: 'EDU-OSH',
      title: '산업안전보건 정기안전보건교육',
      legalBasis: '산업안전보건법 제29조 (분기별 사무직 3h / 현장·생산직 6h 이상)',
      cycleLabel: '매 분기 (2026년 4분기)',
      completionRatePct: 84,
      remindedCount: 0,
    },
    {
      trainingId: 'EDU-PRIVACY',
      title: '개인정보보호 취급자 보안교육',
      legalBasis: '개인정보보호법 제28조 (인사·급여·고객정보 취급자 정기교육)',
      cycleLabel: '연 1회 (상시 점검)',
      completionRatePct: 100,
      remindedCount: 1,
    },
    {
      trainingId: 'EDU-DISABILITY',
      title: '직장 내 장애인 인식개선 교육',
      legalBasis: '장애인고용촉진법 제5조의2 (연 1회 · 1시간 이상 · 50인+ 결과보고)',
      cycleLabel: '연 1회 (2026년)',
      completionRatePct: 88,
      remindedCount: 0,
    },
    {
      trainingId: 'EDU-PENSION',
      title: '퇴직연금 제도 가입자 교육',
      legalBasis: '근로자퇴직급여보장법 제32조 (퇴직연금 설정 사업장 연 1회 이상)',
      cycleLabel: '연 1회 (2026년)',
      completionRatePct: 95,
      remindedCount: 1,
    },
  ];

  const lmcAgendaItems = [
    {
      agendaId: 'LMC-Q4-01',
      quarterLabel: '2026년 4분기 정기회의',
      agendaType: '보고사항 (제22조)',
      title: '2026년 하반기 생산·수주 실적 및 2027년 인력채용 계획 보고',
      status: 'READY',
    },
    {
      agendaId: 'LMC-Q4-02',
      quarterLabel: '2026년 4분기 정기회의',
      agendaType: '협의사항 (제20조)',
      title: '교대근무자 야간 휴게환경 개선 및 건강검진 유소견자 사후관리 방안',
      status: 'IN_REVIEW',
    },
    {
      agendaId: 'LMC-Q4-03',
      quarterLabel: '2026년 4분기 정기회의',
      agendaType: '의결사항 (제21조)',
      title: '2027년도 직무역량 교육훈련 기본계획 및 사내 고충처리 절차 개선안 의결',
      status: 'RESOLVED',
    },
  ];

  /**
   * 비식별 파기(개인정보보호법 제21조) 실행 시 내부 운영 이력 및 채용 지원자 원본까지 구 사번·성명·personId 완전 삭제
   */
  function scrubPurgedPerson(origEmpCode, origDisplayName, origPersonId = null) {
    const cleanCode = String(origEmpCode || '').trim().toUpperCase();
    const cleanName = String(origDisplayName || '').trim();
    if (cleanCode) {
      contractSignedMap.delete(cleanCode);
      leaveUsageMap.delete(cleanCode);
      evalGradeMap.delete(cleanCode);
    }
    assignmentLogs = assignmentLogs.filter((item) => {
      if (cleanCode && String(item.empCode || '').toUpperCase() === cleanCode) return false;
      if (cleanName && String(item.displayName || '').includes(cleanName)) return false;
      return true;
    });
    for (let i = applicants.length - 1; i >= 0; i--) {
      const app = applicants[i];
      if (
        (origPersonId && app.hiredPersonId === origPersonId) ||
        (cleanCode && app.hiredEmpCode === cleanCode) ||
        (cleanName && app.name === cleanName)
      ) {
        applicants.splice(i, 1);
      }
    }
  }

  /**
   * 현재 스냅샷(company, workers, payrollLines, compliance, offboardedSummary)과 결합된 전 모듈 운영 뷰 생성
   */
  function buildView({ company, workers, payrollLines, compliance, offboardedSummary }) {
    const refDate = company.referenceDate || '2026-11-15';
    const policy = normalizePolicySettings(company.policySettings);
    const hc = compliance.headcounts;
    const regularRoster = workers.filter(
      (w) =>
        w.workerCategory === 'REGULAR' ||
        w.workerCategory === 'FIXED_TERM' ||
        w.workerCategory === 'PART_TIME'
    );

    // 1) M1·M2 계약·취득 테이블
    const contractLedger = regularRoster.map((w) => {
      const meta = contractSignedMap.get(w.empCode) || {
        signed: true,
        signedAt: w.hireDate || '2026-01-02',
        nhisAcquired: w.weeklyHours >= 15,
        eiAcquired: true,
      };
      const hireDate = w.hireDate || '2024-03-02';
      const probationEndsOn = addDaysISO(hireDate, 90);
      return {
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        jobTitle: w.jobTitle || '사원',
        workerCategory: w.workerCategory,
        hireDate,
        probationEndsOn,
        weeklyHours: w.weeklyHours || 40,
        baseMonthlyPay: w.baseMonthlyPay || 0,
        contractSigned: meta.signed,
        contractSignedAt: meta.signedAt,
        nhisAcquired: meta.nhisAcquired,
        eiAcquired: meta.eiAcquired,
      };
    });

    // 2) M3 부서별 조직 집계
    const deptMap = new Map();
    for (const w of workers) {
      const dept = w.deptName || '일반부서';
      const cur = deptMap.get(dept) || { deptName: dept, headcount: 0, monthlyBaseSum: 0 };
      cur.headcount += 1;
      cur.monthlyBaseSum += w.baseMonthlyPay || w.contractFee || (w.dailyWage || 0) * (w.dailyWorkDays || 0);
      deptMap.set(dept, cur);
    }
    const orgDepartments = Array.from(deptMap.values());

    // 3) M4 근태 · 주52시간 상한 관제 보드 (환경설정 weeklyWarnHours 실시간 반영)
    const attendanceBoard = regularRoster.map((w, idx) => {
      const maxWeekly = Number((w.maxWeeklyWorkedHours ?? w.weeklyHours ?? 40).toFixed(1));
      const status =
        w.unpaidLeaveDays > 0
          ? 'PARENTAL_OR_LEAVE'
          : maxWeekly > 52
            ? 'OVER_52H_ALERT'
            : maxWeekly >= policy.weeklyWarnHours
              ? 'NEAR_52H_WARN'
              : 'NORMAL_WORKING';
      const shiftType =
        idx % 3 === 1 ? '생산 2교대제' : idx % 3 === 2 ? '선택적 근로시간제' : '주 40h 통상근무';
      return {
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        shiftType,
        weeklyContractHours: w.weeklyHours || 40,
        monthlyOvertimeHours: w.overtimeHours || 0,
        monthlyNightHours: w.nightHours || 0,
        monthlyHolidayHours: (w.holidayLe8Hours || 0) + (w.holidayGt8Hours || 0),
        maxWeeklyWorkedHours: maxWeekly,
        warnThresholdHours: policy.weeklyWarnHours,
        status,
      };
    });

    // 4) M5 연차원장 · 제61조 1/2차 사용촉진 · 미사용수당 추계 (환경설정 입사일/회계연도 기준 실시간 반영)
    const leaveLedger = regularRoster.map((w) => {
      const hireDate = w.hireDate || '2023-03-02';
      const statutory = computeStatutoryAnnualLeaveDays(hireDate, refDate, policy);
      const usage = leaveUsageMap.get(w.empCode) || { usedDays: 3, promoStage: 'NONE' };
      const accruedDays = hc.is5OrMore ? statutory.accruedDays : 0;
      const usedDays = hc.is5OrMore ? Math.min(accruedDays, usage.usedDays) : 0;
      const remainingDays = Math.max(0, Number((accruedDays - usedDays).toFixed(1)));
      const payLine = payrollLines.find((p) => p.empCode === w.empCode);
      const dailyOrdinary = Math.round(
        (payLine?.ordinaryHourlyWage || payLine?.ordinaryHourly || LAW_BASELINE.minimumHourlyWage) *
          (w.dailyHours || 8)
      );
      const exemptByPromo =
        policy.leaveSettlementPolicy === 'PROMOTE_FIRST' &&
        usage.promoStage === 'STAGE_2_DESIGNATED';
      const estimatedPayout = exemptByPromo ? 0 : Math.round(remainingDays * dailyOrdinary);
      return {
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        hireDate,
        ruleBasis: hc.is5OrMore ? statutory.ruleBasis : '5인 미만 사업장 법정 연차 의무 미적용',
        cycleExpiryDate: statutory.cycleExpiryDate,
        firstPromoDeadline: addDaysISO(statutory.cycleExpiryDate, -180),
        secondPromoDeadline: addDaysISO(statutory.cycleExpiryDate, -60),
        promoWindowLabel: statutory.promoWindowLabel,
        hireBasisDays: statutory.hireBasisDays,
        accruedDays,
        usedDays,
        remainingDays,
        promoStage: usage.promoStage,
        dailyOrdinaryWage: dailyOrdinary,
        estimatedUnusedPayout: estimatedPayout,
      };
    });

    // 5) M6 인사평가 · 보상 시뮬레이션 보드
    const evaluationBoard = regularRoster.map((w, idx) => {
      const preset = evalGradeMap.get(w.empCode) || {
        kpiScore: 82 + (idx % 4) * 3,
        competencyScore: 80 + (idx % 5) * 3,
        grade: idx % 5 === 0 ? 'A' : 'B',
        recommendedRaisePct: idx % 5 === 0 ? 5 : 3,
        recommendedBonus: idx % 5 === 0 ? 250000 : 100000,
        appliedToPayroll: (w.evalRaiseRatePct || 0) > 0 || (w.evalBonusPay || 0) > 0,
      };
      const projectedBasePay = Math.round((w.baseMonthlyPay || 0) * (1 + preset.recommendedRaisePct / 100));
      return {
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        currentBasePay: w.baseMonthlyPay || 0,
        kpiScore: preset.kpiScore,
        competencyScore: preset.competencyScore,
        grade: preset.grade,
        recommendedRaisePct: preset.recommendedRaisePct,
        recommendedBonus: preset.recommendedBonus,
        projectedBasePay,
        appliedRaisePct: w.evalRaiseRatePct || 0,
        appliedBonusPay: w.evalBonusPay || 0,
        appliedToPayroll: preset.appliedToPayroll || (w.evalRaiseRatePct || 0) > 0,
      };
    });

    // 6) M7 징계 적법절차 & 제95조 감봉 상한 보드 + 고충처리 D-Day
    const disciplineBoard = regularRoster
      .filter((w, idx) => (w.requestedDisciplinaryCut || 0) > 0 || idx < 2)
      .map((w) => {
        const payLine = payrollLines.find((p) => p.empCode === w.empCode);
        const allStepsDone =
          Boolean(w.attendanceNoticeSent) &&
          Boolean(w.defenseOpportunityGiven) &&
          Boolean(w.committeeResolved) &&
          Boolean(w.writtenNoticeDelivered);
        return {
          empCode: w.empCode,
          displayName: w.displayName,
          deptName: w.deptName,
          requestedCut: w.requestedDisciplinaryCut || 0,
          appliedCut: payLine?.disciplinaryCutApplied || 0,
          blockedCut: payLine?.disciplinaryCutBlocked || 0,
          attendanceNoticeSent: Boolean(w.attendanceNoticeSent),
          defenseOpportunityGiven: Boolean(w.defenseOpportunityGiven),
          committeeResolved: Boolean(w.committeeResolved),
          writtenNoticeDelivered: Boolean(w.writtenNoticeDelivered),
          procedureValid: allStepsDone,
        };
      });

    const grievanceBoard = grievances.map((g) => ({
      ...g,
      daysLeft: diffDaysISO(refDate, g.dueDate),
    }));

    // 7) M10 노사·안전·법정교육 요약
    const oshRoles = [
      {
        roleTitle: '안전보건관리책임자 (산안법 제15조)',
        assignee: '공장장 / 대표이사 총괄',
        qualification: '사업장 실질 총괄관리자',
        statusLabel: compliance.oshFlags.needsSafetyManager ? '당연직 선임대상 (14일 내 보고)' : '규모 미해당 (자율운영)',
      },
      {
        roleTitle: '안전관리자 (산안법 제17조)',
        assignee: hc.oshRegularCount >= 300 ? '전담 안전관리자 선임 필수' : '산업안전기사 또는 안전관리전문기관 위탁 가능',
        qualification: '산업안전기사·산업기사 이상 / 전문기관',
        statusLabel: compliance.oshFlags.needsSafetyOfficer ? '법정 의무 발동중' : '현재 업종·규모 면제',
      },
      {
        roleTitle: '보건관리자 (산안법 제18조)',
        assignee: hc.oshRegularCount >= 300 ? '전담 보건관리자 선임 필수' : '간호사·산업위생관리기사 또는 보건관리전문기관 위탁',
        qualification: '의사·간호사·산업위생기사 / 전문기관',
        statusLabel: compliance.oshFlags.needsHealthOfficer ? '법정 의무 발동중' : '현재 업종·규모 면제',
      },
      {
        roleTitle: '관리감독자 (산안법 제16조)',
        assignee: '생산·가공·품질 각 부서장 지정',
        qualification: '연간 정기 관리감독자 교육 16시간 이수',
        statusLabel: hc.is5OrMore ? '부서별 지정 운영중' : '5인 미만 제외',
      },
    ];

    const unsignedContractCount = contractLedger.filter((c) => !c.contractSigned).length;
    const over52Count = attendanceBoard.filter((a) => a.status === 'OVER_52H_ALERT').length;
    const near52Count = attendanceBoard.filter((a) => a.status === 'NEAR_52H_WARN').length;
    const leavePromoPendingCount = leaveLedger.filter(
      (l) => l.remainingDays >= 5 && l.promoStage === 'NONE'
    ).length;
    const openGrievanceCount = grievanceBoard.filter((g) => g.status !== 'RESOLVED_NOTIFIED').length;
    const avgEduRate = Math.round(
      statutoryTrainings.reduce((s, t) => s + t.completionRatePct, 0) / statutoryTrainings.length
    );

    return {
      policySettings: policy,
      overviewKpis: {
        activeRosterCount: workers.length,
        applicantOpenCount: applicants.filter((a) => !a.hiredEmpCode && a.stage !== 'DOC_RETENTION').length,
        unsignedContractCount,
        over52Count,
        near52Count,
        leavePromoPendingCount,
        pendingEvalApplyCount: evaluationBoard.filter((e) => !e.appliedToPayroll).length,
        openGrievanceCount,
        pendingOffboardSettlementCount: offboardedSummary?.pendingSettlementCount || 0,
        avgStatutoryEduRatePct: avgEduRate,
      },
      recruitAndOnboarding: {
        blindRuleEnforced: hc.is30OrMore,
        applicants: structuredClone(applicants),
        contractLedger,
      },
      orgAndAssignments: {
        departments: orgDepartments,
        assignmentLogs: structuredClone(assignmentLogs),
      },
      attendanceControl: {
        is5OrMore: hc.is5OrMore,
        weeklyWarnHours: policy.weeklyWarnHours,
        board: attendanceBoard,
      },
      leaveAndMaternity: {
        is5OrMore: hc.is5OrMore,
        ledger: leaveLedger,
        maternityProtections: structuredClone(maternityProtections),
      },
      evaluationAndReward: {
        board: evaluationBoard,
      },
      disciplineAndGrievance: {
        is30OrMore: hc.is30OrMore,
        disciplineBoard,
        grievances: grievanceBoard,
      },
      statutoryOpsCenter: {
        lmcRequired: hc.is30OrMore,
        oshOfficerRequired: Boolean(compliance.oshFlags?.needsSafetyOfficer),
        hasMajorityUnion: Boolean(company.hasMajorityUnion),
        lmcCommitteeCountEachSide: hc.lsaRegularCount >= 100 ? 5 : 3,
        lmcAgendaItems: structuredClone(lmcAgendaItems),
        oshRoles,
        riskAssessments: structuredClone(riskAssessments),
        statutoryTrainings: structuredClone(statutoryTrainings),
      },
    };
  }

  /**
   * 관리 시스템 인터랙티브 액션 처리기 (`POST /api/ops/action`)
   */
  function applyAction(
    actionPayload = {},
    { state, payrollLocked = false, appendAudit, tombstoneStore = null, lsaRegularCount = 60 }
  ) {
    const actionType = String(actionPayload.actionType || '').trim();
    if (!actionType) throw badRequest('actionType이 필요합니다.');

    const payrollMutatingActions = new Set([
      'HIRE_APPLICANT',
      'ISSUE_ASSIGNMENT',
      'APPLY_EVAL_REWARDS',
      'QUICK_ATTENDANCE_UPDATE',
      'TOGGLE_DISCIPLINE_STEP',
    ]);
    if (payrollLocked && payrollMutatingActions.has(actionType)) {
      throw conflictError(
        '당월 급여대장이 대표이사 최종 승인으로 잠금 확정(APPROVED_LOCKED)되어 급여 연동 인사·근태·보상 변경을 수행할 수 없습니다.'
      );
    }

    switch (actionType) {
      case 'HIRE_APPLICANT': {
        const applicantId = String(actionPayload.applicantId || '').trim();
        const app = applicants.find((a) => a.applicantId === applicantId);
        if (!app) throw badRequest('대상 채용 지원자를 찾을 수 없습니다.');
        if (app.hiredEmpCode) throw conflictError(`이미 입사 발령 완료된 합격자(${app.hiredEmpCode})입니다.`);
        if (app.stage === 'DOC_RETENTION') {
          throw badRequest('불합격 서류보관(DOC_RETENTION) 상태의 지원자는 입사 발령할 수 없습니다.');
        }

        const hireDate = state.company.referenceDate || '2026-11-15';
        if (
          tombstoneStore &&
          tombstoneStore.isRecordPurged({
            bizRegNo: state.company.bizRegNo,
            displayName: app.name,
            maskedBirthOrId: app.maskedBirth,
            hireDate,
          })
        ) {
          throw conflictError('이미 비식별 파기되어 툼스톤에 등록된 인원 정보로는 재입사 생성을 수행할 수 없습니다.');
        }

        // 단조 증가 유일 사번 채번 (퇴사·파기로 재직자 수가 줄어도 기존/퇴사/파기 사번과 절대 충돌하지 않음)
        let maxNum = hireEmpSeq;
        for (const rec of [...state.workers, ...(state.offboardedWorkers || [])]) {
          const m = String(rec.empCode || '').match(/^EMP-(\d+)$/i);
          if (m) maxNum = Math.max(maxNum, Number(m[1]));
        }
        let candidateNum = maxNum + 1;
        while (
          tombstoneStore &&
          tombstoneStore.isEmpCodePurged(state.company.bizRegNo, `EMP-${candidateNum}`)
        ) {
          candidateNum += 1;
        }
        hireEmpSeq = candidateNum;
        const newEmpCode = `EMP-${candidateNum}`;
        const mintedPersonId = `PER-${crypto.randomUUID()}`;

        const minMonthlyForHours = Math.ceil(
          computeMonthlyRefHours(app.weeklyHours) * LAW_BASELINE.minimumHourlyWage
        );
        const mealForHire = app.weeklyHours < 40 ? Math.min(100000, Math.floor(app.offeredMonthlyPay * 0.1)) : 200000;
        const baseForHire = Math.max(minMonthlyForHours, app.offeredMonthlyPay - mealForHire);

        app.hiredEmpCode = newEmpCode;
        app.hiredPersonId = mintedPersonId;
        app.stage = 'HIRED_ONBOARDED';
        app.stageLabel = `입사완료 (${newEmpCode})`;

        state.emptyRosterMode = false;
        state.workers.unshift({
          personId: mintedPersonId,
          empCode: newEmpCode,
          displayName: app.name,
          deptName: app.targetDept,
          jobTitle: app.jobRole,
          maskedBirthOrId: app.maskedBirth,
          hireDate,
          workerCategory: app.weeklyHours < 40 ? 'PART_TIME' : 'REGULAR',
          weeklyHours: app.weeklyHours,
          dailyHours: Math.min(8, Math.max(1, app.weeklyHours / 5)),
          baseMonthlyPay: baseForHire,
          fixedOrdinaryAllowance: 0,
          mealAllowance: mealForHire,
          overtimeHours: 0,
          nightHours: 0,
          holidayLe8Hours: 0,
          holidayGt8Hours: 0,
          maxWeeklyWorkedHours: app.weeklyHours,
          unpaidLeaveDays: 0,
          suspensionDays: 0,
          unusedLeavePayoutDays: 0,
          evalRaiseRatePct: 0,
          evalBonusPay: 0,
          requestedDisciplinaryCut: 0,
          attendanceNoticeSent: true,
          defenseOpportunityGiven: true,
          committeeResolved: true,
          writtenNoticeDelivered: true,
          dependents: 1,
        });
        if (app.weeklyHours < 40) {
          state.company.headcountInput.partTimeWorkers += 1;
        } else {
          state.company.headcountInput.regularWorkers += 1;
        }
        contractSignedMap.set(newEmpCode, {
          signed: false,
          signedAt: null,
          nhisAcquired: app.weeklyHours >= 15,
          eiAcquired: true,
        });
        leaveUsageMap.set(newEmpCode, { usedDays: 0, promoStage: 'NONE' });
        appendAudit(
          'M1채용→M2입사',
          `[${app.name} → ${newEmpCode}] 합격자 인사명부·전자계약 초안·4대보험 취득·M8 급여원장 자동 편입 완료`
        );
        return { message: `${app.name}님이 ${newEmpCode} 사번으로 입사 발령되어 전자근로계약 대기 및 급여대장에 자동 편입되었습니다.` };
      }

      case 'ADD_APPLICANT': {
        const name = String(actionPayload.name || '').trim().slice(0, 40);
        const targetDept = String(actionPayload.targetDept || '생산기술1팀').trim().slice(0, 40);
        const jobRole = String(actionPayload.jobRole || '정규직 사원').trim().slice(0, 60);
        if (!name) throw badRequest('지원자 성명을 입력해 주세요.');
        const weeklyHours =
          actionPayload.weeklyHours === undefined
            ? 40
            : assertBoundedFiniteNumber(actionPayload.weeklyHours, 'weeklyHours', 15, 40);
        const offeredMonthlyPay = Math.round(
          assertBoundedFiniteNumber(actionPayload.offeredMonthlyPay, 'offeredMonthlyPay', 0, 100_000_000)
        );
        const minReq = Math.ceil(
          computeMonthlyRefHours(weeklyHours) * LAW_BASELINE.minimumHourlyWage
        );
        if (offeredMonthlyPay < minReq) {
          throw badRequest(
            `최저임금법 제6조 위반 차단: 주 ${weeklyHours}h 기준 월 최저임금(${minReq.toLocaleString('ko-KR')}원) 이상으로 처우를 설정해야 합니다.`
          );
        }
        const id = `APP-${applicantSeq++}`;
        applicants.unshift({
          applicantId: id,
          name,
          maskedBirth: '950101-*******',
          targetDept,
          jobRole,
          stage: 'OFFER_CONFIRMED',
          stageLabel: '최종합격 · 처우확정',
          weeklyHours,
          offeredMonthlyPay,
          blindCheckPassed: true,
          docReturnDueOn: addDaysISO(state.company.referenceDate || '2026-11-15', 30),
          hiredEmpCode: null,
          hiredPersonId: null,
        });
        appendAudit('M1채용관리', `[${id} ${name}] 채용절차법·최저임금 검증 통과 후 합격 후보 등록`);
        return { message: `신규 채용 후보자 ${name}(${id})님이 최저임금·블라인드 검증을 통과하여 등록되었습니다.` };
      }

      case 'SIGN_CONTRACT': {
        const empCode = String(actionPayload.empCode || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 근로자를 찾을 수 없습니다.');
        const signedAt = state.company.referenceDate || '2026-11-15';
        contractSignedMap.set(empCode, {
          signed: true,
          signedAt,
          nhisAcquired: (w.weeklyHours || 40) >= 15,
          eiAcquired: true,
        });
        appendAudit(
          'M2전자계약',
          `[${empCode} ${w.displayName}] 근로기준법 제17조 전자근로계약 체결·즉시교부 및 4대보험 취득 연동 완료`
        );
        return { message: `[${empCode} ${w.displayName}] 전자근로계약 서명·즉시교부가 완료되었습니다.` };
      }

      case 'ISSUE_ASSIGNMENT': {
        const empCode = String(actionPayload.empCode || '').trim();
        const orderType = String(actionPayload.orderType || '').trim();
        const targetDept = String(actionPayload.targetDept || '').trim().slice(0, 40);
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('발령 대상 재직 근로자를 찾을 수 없습니다.');
        if (w.workerCategory === 'BIZ_33' || w.workerCategory === 'DAILY') {
          throw badRequest('일용직 또는 3.3% 사업소득 계약자는 정규 인사발령(승진·전보·육아휴직) 대상이 아닙니다.');
        }

        const prevDept = w.deptName;
        const prevTitle = w.jobTitle || '사원';
        let orderLabel = '';
        let afterSummary = '';
        let insuranceSyncNote = '';

        if (orderType === 'PROMOTION') {
          w.jobTitle = '책임매니저(승진)';
          w.evalRaiseRatePct = Math.max(w.evalRaiseRatePct || 0, 6);
          orderLabel = '승진 및 직급호봉 인상 발령';
          afterSummary = `${w.deptName} · ${w.jobTitle} (기본급 +6% 급여 직결)`;
          insuranceSyncNote = '건강·고용 보수월액 인상분 반영';
        } else if (orderType === 'TRANSFER') {
          const nextDept = targetDept || '품질보증팀';
          w.deptName = nextDept;
          orderLabel = '부서 전보 발령';
          afterSummary = `${nextDept} · ${prevTitle}`;
          insuranceSyncNote = '조직도·부서별 인건비 자동 재집계';
        } else if (orderType === 'PARENTAL_LEAVE') {
          w.unpaidLeaveDays = 15;
          orderLabel = '육아휴직 발령 (남녀고용평등법 제19조)';
          afterSummary = `${w.deptName} · 육아휴직 개시 (당월 15일 일할 안분)`;
          insuranceSyncNote = '국민연금 납부예외 · 건강보험 납부유예 · 대체인력지원금 안내 발동';
        } else if (orderType === 'RETURN_TO_WORK') {
          w.unpaidLeaveDays = 0;
          orderLabel = '휴직 만료 복직 발령';
          afterSummary = `${w.deptName} · 정상 복직 (전일 급여 복원)`;
          insuranceSyncNote = '4대보험 납부재개 신고 연동';
        } else {
          throw badRequest('유효하지 않은 인사발령 구분(orderType)입니다.');
        }

        const asgId = `ASG-${assignmentSeq++}`;
        assignmentLogs.unshift({
          assignmentId: asgId,
          effectiveDate: state.company.referenceDate || '2026-11-15',
          empCode: w.empCode,
          displayName: w.displayName,
          orderType,
          orderLabel,
          beforeSummary: `${prevDept} · ${prevTitle}`,
          afterSummary,
          insuranceSyncNote,
        });
        appendAudit('M3인사발령', `[${asgId}] ${w.displayName}(${w.empCode}) ${orderLabel} → 급여·4대보험 자동 반영`);
        return { message: `[${w.displayName}] ${orderLabel} 처리가 완료되어 급여대장 및 조직현황에 즉시 반영되었습니다.` };
      }

      case 'QUICK_ATTENDANCE_UPDATE': {
        const empCode = String(actionPayload.empCode || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 근로자를 찾을 수 없습니다.');
        if (w.workerCategory === 'BIZ_33' || w.workerCategory === 'DAILY') {
          throw badRequest('일용직 또는 3.3% 사업소득 계약자는 주52시간 상용 근태 조정 대상이 아닙니다.');
        }
        const overtimeHours =
          actionPayload.overtimeHours === undefined
            ? w.overtimeHours ?? 0
            : assertBoundedFiniteNumber(actionPayload.overtimeHours, 'overtimeHours', 0, 80);
        const maxWeekly =
          actionPayload.maxWeeklyWorkedHours === undefined
            ? w.maxWeeklyWorkedHours ?? 40
            : assertBoundedFiniteNumber(actionPayload.maxWeeklyWorkedHours, 'maxWeeklyWorkedHours', 15, 80);
        w.overtimeHours = overtimeHours;
        w.maxWeeklyWorkedHours = maxWeekly;
        appendAudit(
          'M4근태관제',
          `[${empCode} ${w.displayName}] 월 연장 ${overtimeHours}h · 주간 최대 ${maxWeekly}h 갱신 → M8 가산수당·주52h 점검 연동`
        );
        return {
          message:
            maxWeekly > 52
              ? `[경보] ${w.displayName} 주간 실근로 ${maxWeekly}h로 근로기준법 제53조(주52시간 상한) 초과 경보가 발동되었습니다!`
              : `[${w.displayName}] 근태 시간(월 연장 ${overtimeHours}h · 주간 피크 ${maxWeekly}h)이 급여대장에 즉시 반영되었습니다.`,
        };
      }

      case 'ADVANCE_LEAVE_PROMOTION': {
        if (lsaRegularCount < 5) {
          throw badRequest('상시 5인 미만 사업장은 근로기준법 제60조·제61조 법정 연차사용촉진 의무 대상이 아닙니다.');
        }
        const empCode = String(actionPayload.empCode || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 근로자를 찾을 수 없습니다.');
        if (w.workerCategory === 'BIZ_33' || w.workerCategory === 'DAILY') {
          throw badRequest('일용직 또는 3.3% 사업소득 계약자는 법정 연차사용촉진 대상이 아닙니다.');
        }
        const cur = leaveUsageMap.get(empCode) || { usedDays: 3, promoStage: 'NONE' };
        const nextStage =
          cur.promoStage === 'NONE'
            ? 'STAGE_1_SENT'
            : cur.promoStage === 'STAGE_1_SENT'
              ? 'STAGE_2_DESIGNATED'
              : 'STAGE_2_DESIGNATED';
        leaveUsageMap.set(empCode, { ...cur, promoStage: nextStage });
        const stageText =
          nextStage === 'STAGE_1_SENT'
            ? '1차 서면 촉진(미사용일수 고지 및 사용시기 통보 촉구, 만료 6개월 전)'
            : '2차 서면 사용시기 지정 통보(만료 2개월 전 · 제61조 수당 지급의무 면제 요건 충족)';
        appendAudit('M5연차촉진', `[${empCode} ${w.displayName}] 근로기준법 제61조 ${stageText} 발송 기록`);
        return { message: `[${w.displayName}] ${stageText} 처리가 완료되었습니다.` };
      }

      case 'APPLY_EVAL_REWARDS': {
        let appliedCount = 0;
        for (const w of state.workers) {
          if (w.workerCategory !== 'REGULAR' && w.workerCategory !== 'FIXED_TERM' && w.workerCategory !== 'PART_TIME') {
            continue;
          }
          const meta = evalGradeMap.get(w.empCode);
          if (meta) {
            w.evalRaiseRatePct = meta.recommendedRaisePct;
            w.evalBonusPay = meta.recommendedBonus;
            meta.appliedToPayroll = true;
            appliedCount += 1;
          } else {
            w.evalRaiseRatePct = 3;
            w.evalBonusPay = 100000;
            evalGradeMap.set(w.empCode, {
              kpiScore: 84,
              competencyScore: 83,
              grade: 'B',
              recommendedRaisePct: 3,
              recommendedBonus: 100000,
              appliedToPayroll: true,
            });
            appliedCount += 1;
          }
        }
        appendAudit(
          'M6평가보상→M8급여',
          `전사 인사평가 등급별 기본급 인상률·성과급 시뮬레이션 안(${appliedCount}명) M8 급여대장 일괄 확정 반영`
        );
        return { message: `인사평가 보상안(${appliedCount}명)이 M8 자동 급여대장 기본급·성과급에 일괄 반영되었습니다.` };
      }

      case 'SET_EVAL_GRADE': {
        const empCode = String(actionPayload.empCode || '').trim();
        const grade = String(actionPayload.grade || '').trim().toUpperCase();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 근로자를 찾을 수 없습니다.');
        const table = {
          S: { kpiScore: 96, competencyScore: 95, recommendedRaisePct: 8, recommendedBonus: 500000 },
          A: { kpiScore: 91, competencyScore: 90, recommendedRaisePct: 5, recommendedBonus: 300000 },
          B: { kpiScore: 83, competencyScore: 82, recommendedRaisePct: 3, recommendedBonus: 150000 },
          C: { kpiScore: 74, competencyScore: 75, recommendedRaisePct: 1, recommendedBonus: 0 },
          D: { kpiScore: 65, competencyScore: 68, recommendedRaisePct: 0, recommendedBonus: 0 },
        };
        if (!table[grade]) throw badRequest('평가 등급은 S, A, B, C, D 중 하나여야 합니다.');
        evalGradeMap.set(empCode, {
          ...table[grade],
          grade,
          appliedToPayroll: false,
        });
        return { message: `[${w.displayName}] 평가 등급이 ${grade}등급(권고 인상률 ${table[grade].recommendedRaisePct}% · 성과급 ${table[grade].recommendedBonus.toLocaleString('ko-KR')}원)으로 변경되었습니다. [보상안 급여 일괄 반영]을 누르면 급여대장에 적용됩니다.` };
      }

      case 'TOGGLE_DISCIPLINE_STEP': {
        const empCode = String(actionPayload.empCode || '').trim();
        const stepField = String(actionPayload.stepField || '').trim();
        const allowed = [
          'attendanceNoticeSent',
          'defenseOpportunityGiven',
          'committeeResolved',
          'writtenNoticeDelivered',
        ];
        if (!allowed.includes(stepField)) throw badRequest('유효하지 않은 징계 절차 항목입니다.');
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 근로자를 찾을 수 없습니다.');
        w[stepField] = !w[stepField];
        appendAudit('M7징계절차', `[${empCode} ${w.displayName}] 징계 절차 체크 변경 (${stepField}: ${w[stepField]})`);
        return { message: `[${w.displayName}] 징계 적법절차 이행 상태가 갱신되어 급여 법령검증에 반영되었습니다.` };
      }

      case 'RESOLVE_GRIEVANCE': {
        const grievanceId = String(actionPayload.grievanceId || '').trim();
        const g = grievances.find((item) => item.grievanceId === grievanceId);
        if (!g) throw badRequest('고충 접수 건을 찾을 수 없습니다.');
        g.status = 'RESOLVED_NOTIFIED';
        g.resolutionNote = `${state.company.referenceDate || '2026-11-15'} 고충처리위원 조치 완료 및 근로자 결과 통보 완료 (근참법 제28조 10일 기한 준수)`;
        appendAudit('M7고충처리', `[${grievanceId}] 고충처리 조치 및 10일 내 당사자 결과 통보 완료`);
        return { message: `[${grievanceId}] 고충 처리 결과 통보가 완료 기록되었습니다.` };
      }

      case 'ADD_GRIEVANCE': {
        const category = String(actionPayload.category || '작업환경·복리후생').trim().slice(0, 40);
        const summary = String(actionPayload.summary || '').trim().slice(0, 200);
        if (!summary) throw badRequest('고충 접수 내용을 입력해 주세요.');
        const refDate = state.company.referenceDate || '2026-11-15';
        const gid = `GRV-${grievanceSeq++}`;
        grievances.unshift({
          grievanceId: gid,
          receivedAt: refDate,
          dueDate: addDaysISO(refDate, 10),
          category,
          channel: '사내 익명 고충접수창구',
          summary,
          assignedCommissioner: '노사 고충처리위원',
          status: 'IN_PROGRESS',
          resolutionNote: '접수 완료 · 사실확인 및 개선협의 진행 중 (10일 내 결과 통보 의무)',
        });
        appendAudit('M7고충접수', `[${gid}] 신규 고충 접수 등록 (법정 통보기한: ${addDaysISO(refDate, 10)})`);
        return { message: `신규 고충(${gid})이 접수되어 10일 이내 처리 통보 타이머(${addDaysISO(refDate, 10)})가 가동되었습니다.` };
      }

      case 'TOGGLE_RISK_ASSESSMENT': {
        const riskId = String(actionPayload.riskId || '').trim();
        const r = riskAssessments.find((item) => item.riskId === riskId);
        if (!r) throw badRequest('위험성평가 항목을 찾을 수 없습니다.');
        r.completed = !r.completed;
        appendAudit('M10안전보건', `[${riskId}] ${r.processName} 위험성 감소대책 이행 상태 변경 (${r.completed ? '완료' : '진행중'})`);
        return { message: `[${r.processName}] 위험성 감소대책 상태가 '${r.completed ? '개선 완료' : '개선 진행중'}'으로 갱신되었습니다.` };
      }

      case 'COMPLETE_STATUTORY_EDU': {
        const trainingId = String(actionPayload.trainingId || '').trim();
        const edu = statutoryTrainings.find((item) => item.trainingId === trainingId);
        if (!edu) throw badRequest('법정의무교육 과정을 찾을 수 없습니다.');
        edu.remindedCount += 1;
        edu.completionRatePct = 100;
        appendAudit('M10법정의무교육', `[${edu.title}] 미이수자 독촉 및 전 부서 이수율 100% 수료 증빙 완료`);
        return { message: `[${edu.title}] 미이수자 독촉 알림 발송 및 전사 이수율 100% 반영이 완료되었습니다.` };
      }

      default:
        throw badRequest(`지원하지 않는 관리 액션(${actionType})입니다.`);
    }
  }

  return Object.freeze({
    buildView,
    applyAction,
    scrubPurgedPerson,
  });
}
