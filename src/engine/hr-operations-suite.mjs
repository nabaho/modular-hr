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

import crypto from 'node:crypto';
import { addDaysISO, diffDaysISO, isValidIsoDate } from './compliance-provisioner.mjs';
import { computeMonthlyRefHours } from './lifecycle-payroll.mjs';
import { LAW_BASELINE } from './labor-rules.mjs';
import {
  VALID_DOC_TEMPLATES,
  canonicalizePersonDocFields,
  generateStatutoryDocument,
  maskInlinePiiText,
} from './document-generator.mjs';
import { createStatutoryGovernanceManager } from './statutory-governance.mjs';
import { createRosterDossierManager } from './roster-dossier.mjs';
import { createEvalRewardStudioManager } from './eval-reward-studio.mjs';
import { buildStandaloneClientPackage } from './eval-reward-exporter.mjs';

function computeDocPayloadDigest(templateId, info) {
  return crypto
    .createHash('sha256')
    .update(canonicalizePersonDocFields(templateId, info))
    .digest('hex');
}

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

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function isValidYearMonth(ym) {
  if (typeof ym !== 'string') return false;
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2099 && month >= 1 && month <= 12;
}

function getDaysInYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function getUtcWeekday(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const FIXED_STATUTORY_HOLIDAYS = Object.freeze({
  '01-01': '신정',
  '03-01': '삼일절',
  '05-01': '근로자의 날',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
});

const YEAR_SPECIFIC_HOLIDAYS = Object.freeze({
  '2025-01-28': '설날 연휴',
  '2025-01-29': '설날',
  '2025-01-30': '설날 연휴',
  '2025-03-03': '삼일절 대체공휴일',
  '2025-05-06': '대체공휴일',
  '2025-10-05': '추석 연휴',
  '2025-10-06': '추석',
  '2025-10-07': '추석 연휴',
  '2025-10-08': '추석 대체공휴일',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-05': '개천절 대체공휴일',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '설날 대체공휴일',
  '2027-05-13': '부처님오신날',
  '2027-08-16': '광복절 대체공휴일',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-04': '개천절 대체공휴일',
  '2027-10-11': '한글날 대체공휴일',
  '2027-12-27': '성탄절 대체공휴일',
});

export function getKoreanStatutoryHolidayName(isoDate) {
  if (!isValidIsoDate(isoDate)) return null;
  if (Object.hasOwn(YEAR_SPECIFIC_HOLIDAYS, isoDate)) {
    return YEAR_SPECIFIC_HOLIDAYS[isoDate];
  }
  const md = isoDate.slice(5, 10);
  if (Object.hasOwn(FIXED_STATUTORY_HOLIDAYS, md)) {
    return FIXED_STATUTORY_HOLIDAYS[md];
  }
  return null;
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? e - s : 0;
}

/**
 * 출근~퇴근 시각 및 날짜 기반 연장(>8h) · 야간(22:00~07:00) · 법정공휴일/주휴일 휴일근로 자동 판정기
 */
export function computeAutoClassifiedShift({
  date,
  clockIn = '09:00',
  clockOut = '18:00',
  breakHours = undefined,
  customHoliday = false,
  nightEndHour = 7,
} = {}) {
  const hhmmRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const inMatch = String(clockIn || '').trim().match(hhmmRe);
  const outMatch = String(clockOut || '').trim().match(hhmmRe);
  if (!inMatch || !outMatch) {
    throw badRequest('출근·퇴근 시각은 HH:MM(00:00~23:59) 형식이어야 합니다.');
  }
  const inMin = Number(inMatch[1]) * 60 + Number(inMatch[2]);
  const rawOutMin = Number(outMatch[1]) * 60 + Number(outMatch[2]);
  if (inMin === rawOutMin) {
    throw badRequest('출근 시각과 퇴근 시각이 동일할 수 없습니다. 미출근일은 휴무(OFF)로 지정해 주세요.');
  }
  const endMin = rawOutMin < inMin ? rawOutMin + 1440 : rawOutMin;
  const grossHours = (endMin - inMin) / 60;

  let appliedBreak = breakHours;
  if (appliedBreak === undefined || appliedBreak === null || appliedBreak === '') {
    appliedBreak = grossHours >= 9 ? 1 : grossHours >= 4.5 ? 0.5 : 0;
  } else {
    appliedBreak = assertBoundedFiniteNumber(Number(appliedBreak), 'breakHours', 0, 6);
  }
  if (appliedBreak >= grossHours) {
    throw badRequest('휴게시간은 총 체류시간보다 작아야 합니다.');
  }
  const netWorked = Number(Math.max(0, grossHours - appliedBreak).toFixed(1));
  if (netWorked > 24) {
    throw badRequest('1일 실근로시간은 24시간을 초과할 수 없습니다.');
  }

  // 밤 22:00 ~ 새벽 07:00 (기본 nightEndHour = 7) 야간근로 구간 자동 산출
  const nightEndMin = nightEndHour * 60;
  const rawNightMin =
    overlapMinutes(inMin, endMin, 0, nightEndMin) +
    overlapMinutes(inMin, endMin, 22 * 60, 24 * 60 + nightEndMin) +
    overlapMinutes(inMin, endMin, 46 * 60, 48 * 60 + nightEndMin);
  const nightHours = Number(Math.min(netWorked, rawNightMin / 60).toFixed(1));

  const statutoryHolidayName = isValidIsoDate(date) ? getKoreanStatutoryHolidayName(date) : null;
  const wd = isValidIsoDate(date) ? getUtcWeekday(date) : 1;
  const isWeeklyRestSunday = wd === 0;
  const isHolidayWork = Boolean(statutoryHolidayName) || isWeeklyRestSunday || customHoliday === true;
  const holidayReason =
    statutoryHolidayName || (isWeeklyRestSunday ? '주휴일(일요일)' : customHoliday ? '지정휴일' : null);

  if (isHolidayWork) {
    return {
      workStatus: netWorked > 0 ? 'HOLIDAY_WORK' : 'OFF',
      clockIn: `${inMatch[1]}:${inMatch[2]}`,
      clockOut: `${outMatch[1]}:${outMatch[2]}`,
      breakHours: appliedBreak,
      netWorkedHours: netWorked,
      normalHours: 0,
      overtimeHours: 0,
      nightHours,
      holidayHours: netWorked,
      holidayLe8Hours: Number(Math.min(8, netWorked).toFixed(1)),
      holidayGt8Hours: Number(Math.max(0, netWorked - 8).toFixed(1)),
      holidayName: holidayReason,
      isStatutoryHoliday: Boolean(statutoryHolidayName),
      autoOvertime: netWorked > 8,
      autoNight: nightHours > 0,
      autoHoliday: netWorked > 0,
    };
  }

  const normalHours = Number(Math.min(8, netWorked).toFixed(1));
  const overtimeHours = Number(Math.max(0, netWorked - 8).toFixed(1));
  return {
    workStatus: netWorked > 0 ? 'WORK' : 'OFF',
    clockIn: `${inMatch[1]}:${inMatch[2]}`,
    clockOut: `${outMatch[1]}:${outMatch[2]}`,
    breakHours: appliedBreak,
    netWorkedHours: netWorked,
    normalHours,
    overtimeHours,
    nightHours,
    holidayHours: 0,
    holidayLe8Hours: 0,
    holidayGt8Hours: 0,
    holidayName: null,
    isStatutoryHoliday: false,
    autoOvertime: overtimeHours > 0,
    autoNight: nightHours > 0,
    autoHoliday: false,
  };
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
      grantedCount: 1,
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
        grantedCount: curMonths,
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
      const addedMonths = Math.min(remainingFirstYearMonths, serviceMonths);
      const combinedDays = applyLeaveRounding(
        proportionalDays + addedMonths,
        policy.leaveRoundingRule
      );
      const cappedCombined = Math.min(26, Math.max(proportionalDays, combinedDays));
      return {
        grantedCount: 1 + addedMonths,
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
      grantedCount: 1,
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
      grantedCount: monthlyAccrued,
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
    grantedCount: 1,
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
  const statutoryGovernance = createStatutoryGovernanceManager();
  const rosterDossier = createRosterDossierManager();
  const evalRewardStudio = createEvalRewardStudioManager();
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
    [
      'EMP-201',
      {
        signed: true,
        signedAt: '2026-03-02',
        employmentContractSigned: true,
        privacyConsentSigned: true,
        ndaPledgeSigned: true,
        nhisAcquired: true,
        eiAcquired: true,
      },
    ],
    [
      'EMP-202',
      {
        signed: true,
        signedAt: '2026-03-02',
        employmentContractSigned: true,
        privacyConsentSigned: true,
        ndaPledgeSigned: true,
        nhisAcquired: true,
        eiAcquired: true,
      },
    ],
    [
      'EMP-203',
      {
        signed: false,
        signedAt: null,
        employmentContractSigned: false,
        privacyConsentSigned: false,
        ndaPledgeSigned: false,
        nhisAcquired: true,
        eiAcquired: true,
      },
    ],
    [
      'EMP-204',
      {
        signed: true,
        signedAt: '2026-04-01',
        employmentContractSigned: true,
        privacyConsentSigned: true,
        ndaPledgeSigned: true,
        nhisAcquired: true,
        eiAcquired: true,
      },
    ],
  ]);

  // 전 영역 범용 리스트 항목 체크박스(☐) · 별표(★) 저장소 (`${groupKey}:${itemId}` -> { checked, starred })
  const listItemMarks = new Map();

  // 직원별 추가 인적·근무 조건 프로필 (`empCode` -> { maskedPhone, address, workplaceLocation, workStartEnd })
  const workerProfileExtrasMap = new Map([
    [
      'EMP-201',
      {
        maskedPhone: '010-****-2011',
        address: '경기도 화성시 동탄첨단산업1로 45',
        workplaceLocation: '본사 제1공장 생산기술동',
        workStartEnd: '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
      },
    ],
    [
      'EMP-202',
      {
        maskedPhone: '010-****-2022',
        address: '경기도 수원시 영통구 광교중앙로 120',
        workplaceLocation: '본사 품질보증센터',
        workStartEnd: '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
      },
    ],
    [
      'EMP-203',
      {
        maskedPhone: '010-****-2033',
        address: '서울특별시 금천구 가산디지털1로 168',
        workplaceLocation: '본사 기업부설연구소',
        workStartEnd: '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
      },
    ],
  ]);

  let signedDocSeq = 110;
  let customPersonSeq = 500;
  const seedEmp201Payload = {
    empCode: 'EMP-201',
    displayName: '김하늘',
    personName: '김하늘',
    deptName: '생산기술1팀',
    jobTitle: '사원',
    hireDate: '2022-03-02',
    maskedBirthOrId: '940315-*******',
    maskedPhone: '010-****-2011',
    address: '경기도 화성시 동탄첨단산업1로 45',
    workplaceLocation: '본사 제1공장 생산기술동',
    workStartEnd: '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
    weeklyHours: 40,
    dailyHours: 8,
    baseMonthlyPay: 3400000,
    fixedOrdinaryAllowance: 200000,
    mealAllowance: 200000,
  };
  const computeSeedUnsignedSha = (tplId) => {
    const gen = generateStatutoryDocument(tplId, {
      companyName: '(주)대한정밀기계공업',
      bizRegNo: '214-86-00941',
      ceoName: '대표이사',
      ksicMajor: 'C',
      lsaRegularCount: 60,
      oshRegularCount: 64,
      triggerDate: '2026-11-11',
      referenceDate: '2026-11-15',
      dueDate: '2026-11-15',
      hasMajorityUnion: false,
      policySettings: DEFAULT_POLICY_SETTINGS,
      workerRecord: seedEmp201Payload,
      signatureInfo: null,
    });
    return crypto.createHash('sha256').update(gen.body).digest('hex');
  };
  // 사업장(bizRegNo) · 고유 personId/personKey별 작성 및 전자서명 완료 서식 불변 보관함
  const signedDocumentsArchive = [
    {
      docRecordId: 'SDOC-101',
      version: 1,
      superseded: false,
      bizRegNo: '214-86-00941',
      personKey: 'EMP:EMP-201',
      personId: 'PER-INIT-EMP-201',
      templateId: 'DOC_EMPLOYMENT_CONTRACT',
      templateLabel: '표준 근로계약서',
      ...seedEmp201Payload,
      payloadDigest: computeDocPayloadDigest('DOC_EMPLOYMENT_CONTRACT', seedEmp201Payload),
      unsignedBodySha256: computeSeedUnsignedSha('DOC_EMPLOYMENT_CONTRACT'),
      signed: true,
      signerName: '김하늘',
      signedAt: '2026-11-15',
      signatureCode: 'SIG-EMP201-CNT',
      signatureDataUrl: '',
    },
    {
      docRecordId: 'SDOC-102',
      version: 1,
      superseded: false,
      bizRegNo: '214-86-00941',
      personKey: 'EMP:EMP-201',
      personId: 'PER-INIT-EMP-201',
      templateId: 'DOC_PRIVACY_CONSENT',
      templateLabel: '개인정보 수집·이용 동의서',
      ...seedEmp201Payload,
      payloadDigest: computeDocPayloadDigest('DOC_PRIVACY_CONSENT', seedEmp201Payload),
      unsignedBodySha256: computeSeedUnsignedSha('DOC_PRIVACY_CONSENT'),
      signed: true,
      signerName: '김하늘',
      signedAt: '2026-11-15',
      signatureCode: 'SIG-EMP201-PRV',
      signatureDataUrl: '',
    },
    {
      docRecordId: 'SDOC-103',
      version: 1,
      superseded: false,
      bizRegNo: '214-86-00941',
      personKey: 'EMP:EMP-201',
      personId: 'PER-INIT-EMP-201',
      templateId: 'DOC_NDA_SECURITY_PLEDGE',
      templateLabel: '비밀유지 및 정보보안 서약서',
      ...seedEmp201Payload,
      payloadDigest: computeDocPayloadDigest('DOC_NDA_SECURITY_PLEDGE', seedEmp201Payload),
      unsignedBodySha256: computeSeedUnsignedSha('DOC_NDA_SECURITY_PLEDGE'),
      signed: true,
      signerName: '김하늘',
      signedAt: '2026-11-15',
      signatureCode: 'SIG-EMP201-NDA',
      signatureDataUrl: '',
    },
  ];

  const leaveUsageMap = new Map([
    ['EMP-201', { usedDays: 6.5, promoStage: 'STAGE_1_SENT' }],
    ['EMP-202', { usedDays: 4.0, promoStage: 'NONE' }],
    ['EMP-203', { usedDays: 3.0, promoStage: 'STAGE_2_DESIGNATED' }],
    ['EMP-204', { usedDays: 2.0, promoStage: 'NONE' }],
  ]);

  let selectedYearMonth = '2026-11';
  let leaveSeq = 500;

  // 근로자별 연차 신청일(appliedAt) · 사용일(useDate) · 사용일수 상세 이력
  const leaveRecordsMap = new Map([
    [
      'EMP-201',
      [
        { recordId: 'LV-201-1', appliedAt: '2026-04-03', useDate: '2026-04-10', days: 1, leaveType: '연차(1일)', reason: '개인 용무' },
        { recordId: 'LV-201-2', appliedAt: '2026-05-18', useDate: '2026-05-22', days: 1, leaveType: '연차(1일)', reason: '가족 행사' },
        { recordId: 'LV-201-3', appliedAt: '2026-07-20', useDate: '2026-08-03', days: 1, leaveType: '연차(1일)', reason: '하계 휴가' },
        { recordId: 'LV-201-4', appliedAt: '2026-07-20', useDate: '2026-08-04', days: 1, leaveType: '연차(1일)', reason: '하계 휴가' },
        { recordId: 'LV-201-5', appliedAt: '2026-09-10', useDate: '2026-09-18', days: 1, leaveType: '연차(1일)', reason: '개인 휴무' },
        { recordId: 'LV-201-6', appliedAt: '2026-11-02', useDate: '2026-11-11', days: 1, leaveType: '연차(1일)', reason: '자녀 학교 방문' },
        { recordId: 'LV-201-7', appliedAt: '2026-11-16', useDate: '2026-11-20', days: 0.5, leaveType: '오후반차(0.5일)', reason: '병원 진료' },
      ],
    ],
    [
      'EMP-202',
      [
        { recordId: 'LV-202-1', appliedAt: '2026-05-01', useDate: '2026-05-08', days: 1, leaveType: '연차(1일)', reason: '가족 방문' },
        { recordId: 'LV-202-2', appliedAt: '2026-08-03', useDate: '2026-08-14', days: 1, leaveType: '연차(1일)', reason: '하계 휴가' },
        { recordId: 'LV-202-3', appliedAt: '2026-10-05', useDate: '2026-10-16', days: 1, leaveType: '연차(1일)', reason: '개인 용무' },
        { recordId: 'LV-202-4', appliedAt: '2026-11-04', useDate: '2026-11-13', days: 1, leaveType: '연차(1일)', reason: '정기 건강검진' },
      ],
    ],
    [
      'EMP-203',
      [
        { recordId: 'LV-203-1', appliedAt: '2026-08-18', useDate: '2026-08-25', days: 1, leaveType: '연차(1일)', reason: '개인 용무' },
        { recordId: 'LV-203-2', appliedAt: '2026-09-21', useDate: '2026-09-30', days: 1, leaveType: '연차(1일)', reason: '행정 기관 방문' },
        { recordId: 'LV-203-3', appliedAt: '2026-11-03', useDate: '2026-11-09', days: 1, leaveType: '연차(1일)', reason: '개인 휴무' },
      ],
    ],
    [
      'EMP-204',
      [
        { recordId: 'LV-204-1', appliedAt: '2026-07-10', useDate: '2026-07-17', days: 1, leaveType: '연차(1일)', reason: '개인 용무' },
        { recordId: 'LV-204-2', appliedAt: '2026-11-05', useDate: '2026-11-18', days: 1, leaveType: '연차(1일)', reason: '가족 돌봄' },
      ],
    ],
  ]);

  // 근로자·귀속월별 일간 근태 캘린더 저장소 (`${empCode}|${yearMonth}` -> Map<isoDate, DayEntry>)
  const dailyAttendanceMap = new Map();
  // 연차 삭제 시 원본 일별 근태 복원 백업 (`recordId` -> Array<{ key, date, entry }>)
  const leavePrevCalendarBackup = new Map();

  function expandLeaveRecordDates(rec) {
    if (Array.isArray(rec.coveredDates) && rec.coveredDates.length > 0) {
      return rec.coveredDates;
    }
    const baseDate = rec.useDate;
    const totalDays = Number(rec.days) || 0;
    if (!isValidIsoDate(baseDate) || totalDays <= 0) return [];
    if (totalDays === 0.5) {
      return [{ date: baseDate, dayFraction: 0.5 }];
    }
    if (totalDays === 1) {
      return [{ date: baseDate, dayFraction: 1 }];
    }
    const slots = [];
    let rem = totalDays;
    let cursor = baseDate;
    let guard = 0;
    while (rem > 0 && guard < 60) {
      const wd = getUtcWeekday(cursor);
      if (wd >= 1 && wd <= 5) {
        const chunk = rem >= 1 ? 1 : 0.5;
        slots.push({ date: cursor, dayFraction: chunk });
        rem = Number((rem - chunk).toFixed(1));
      }
      cursor = addDaysISO(cursor, 1);
      guard += 1;
    }
    return slots;
  }

  function invalidateWorkerCalendar(empCode) {
    const clean = String(empCode || '').trim();
    if (!clean) return;
    for (const key of Array.from(dailyAttendanceMap.keys())) {
      if (key.startsWith(`${clean}|`)) {
        dailyAttendanceMap.delete(key);
      }
    }
  }

  function resetForNewRoster(opts = {}) {
    dailyAttendanceMap.clear();
    leavePrevCalendarBackup.clear();
    leaveRecordsMap.clear();
    leaveUsageMap.clear();
    contractSignedMap.clear();
    evalGradeMap.clear();
    workerProfileExtrasMap.clear();
    statutoryGovernance.resetForNewRoster();
    rosterDossier.resetForNewRoster(opts);
    evalRewardStudio.resetForNewRoster();
  }

  function exportPersistenceState() {
    const calendars = {};
    for (const [key, dayMap] of dailyAttendanceMap.entries()) {
      calendars[key] = Array.from(dayMap.entries());
    }
    const leaveRecords = {};
    for (const [empCode, recs] of leaveRecordsMap.entries()) {
      leaveRecords[empCode] = structuredClone(recs);
    }
    const leaveBackups = {};
    for (const [recId, bk] of leavePrevCalendarBackup.entries()) {
      leaveBackups[recId] = structuredClone(bk);
    }
    const itemMarksObj = {};
    for (const [k, v] of listItemMarks.entries()) {
      itemMarksObj[k] = { checked: Boolean(v?.checked), starred: Boolean(v?.starred) };
    }
    const profileExtrasObj = {};
    for (const [k, v] of workerProfileExtrasMap.entries()) {
      profileExtrasObj[k] = structuredClone(v);
    }
    const contractMapObj = {};
    for (const [k, v] of contractSignedMap.entries()) {
      contractMapObj[k] = structuredClone(v);
    }
    return {
      selectedYearMonth,
      calendars,
      leaveRecords,
      leaveBackups,
      itemMarks: itemMarksObj,
      profileExtras: profileExtrasObj,
      contractSigned: contractMapObj,
      signedDocumentsArchive: structuredClone(signedDocumentsArchive),
      statutoryGovernance: statutoryGovernance.exportPersistenceState(),
      rosterDossier: rosterDossier.exportPersistenceState(),
      evalRewardStudio: evalRewardStudio.exportPersistenceState(),
    };
  }

  function restorePersistenceState(saved = {}) {
    if (!saved || typeof saved !== 'object') return;
    if (isValidYearMonth(saved.selectedYearMonth)) {
      selectedYearMonth = saved.selectedYearMonth;
    }
    if (saved.calendars && typeof saved.calendars === 'object') {
      dailyAttendanceMap.clear();
      for (const [key, entries] of Object.entries(saved.calendars)) {
        if (Array.isArray(entries)) {
          dailyAttendanceMap.set(key, new Map(entries));
        }
      }
    }
    if (saved.leaveRecords && typeof saved.leaveRecords === 'object') {
      leaveRecordsMap.clear();
      for (const [empCode, recs] of Object.entries(saved.leaveRecords)) {
        if (Array.isArray(recs)) {
          leaveRecordsMap.set(empCode, structuredClone(recs));
        }
      }
    }
    if (saved.leaveBackups && typeof saved.leaveBackups === 'object') {
      leavePrevCalendarBackup.clear();
      for (const [recId, bk] of Object.entries(saved.leaveBackups)) {
        if (Array.isArray(bk)) {
          leavePrevCalendarBackup.set(recId, structuredClone(bk));
        }
      }
    }
    if (saved.itemMarks && typeof saved.itemMarks === 'object') {
      listItemMarks.clear();
      for (const [k, v] of Object.entries(saved.itemMarks)) {
        listItemMarks.set(k, { checked: Boolean(v?.checked), starred: Boolean(v?.starred) });
      }
    }
    if (saved.profileExtras && typeof saved.profileExtras === 'object') {
      workerProfileExtrasMap.clear();
      for (const [k, v] of Object.entries(saved.profileExtras)) {
        if (v && typeof v === 'object') workerProfileExtrasMap.set(k, structuredClone(v));
      }
    }
    if (saved.contractSigned && typeof saved.contractSigned === 'object') {
      contractSignedMap.clear();
      for (const [k, v] of Object.entries(saved.contractSigned)) {
        if (v && typeof v === 'object') contractSignedMap.set(k, structuredClone(v));
      }
    }
    if (Array.isArray(saved.signedDocumentsArchive)) {
      signedDocumentsArchive.length = 0;
      signedDocumentsArchive.push(...structuredClone(saved.signedDocumentsArchive));
      for (const rec of signedDocumentsArchive) {
        const mDoc = String(rec.docRecordId || '').match(/^SDOC-(\d+)$/);
        if (mDoc) signedDocSeq = Math.max(signedDocSeq, Number(mDoc[1]));
        const mExt = String(rec.personKey || '').match(/^EXT-(\d+)$/);
        if (mExt) customPersonSeq = Math.max(customPersonSeq, Number(mExt[1]));
      }
    }
    if (saved.statutoryGovernance && typeof saved.statutoryGovernance === 'object') {
      statutoryGovernance.restorePersistenceState(saved.statutoryGovernance);
    }
    if (saved.rosterDossier && typeof saved.rosterDossier === 'object') {
      rosterDossier.restorePersistenceState(saved.rosterDossier);
    } else {
      rosterDossier.resetForNewRoster({ withDemoSeeds: false });
    }
    if (saved.evalRewardStudio && typeof saved.evalRewardStudio === 'object') {
      evalRewardStudio.restorePersistenceState(saved.evalRewardStudio);
    }
  }

  function isRecordValidForRoster(d, bizRegNo, workers = [], offboardedWorkers = []) {
    if (bizRegNo && d.bizRegNo && d.bizRegNo !== bizRegNo) return false;
    if (d.empCode && d.personId) {
      const w = workers.find((x) => x.empCode === d.empCode);
      if (w && w.personId && w.personId !== d.personId) return false;
      const al = offboardedWorkers.find((x) => x.empCode === d.empCode);
      if (al && al.personId && al.personId !== d.personId) return false;
    }
    return true;
  }

  function getArchivedDocById(docRecordId, scope = {}) {
    const id = String(docRecordId || '').trim();
    if (!id) return null;
    const found = signedDocumentsArchive.find(
      (d) =>
        d.docRecordId === id &&
        isRecordValidForRoster(
          d,
          scope.bizRegNo || '',
          scope.workers || [],
          scope.offboardedWorkers || []
        )
    );
    return found ? structuredClone(found) : null;
  }

  function findMatchingSignedDoc({
    bizRegNo = '',
    templateId,
    empCode = '',
    personId = null,
    personKey = '',
    renderUnsignedAtSignedDate = null,
  }) {
    const tid = String(templateId || '').trim();
    const code = String(empCode || '').trim().toUpperCase();
    // 사번(empCode)이 지정된 경우 클라이언트가 보낸 임의 personKey를 무시하고 항상 서버 사번·personId로 귀속 확정
    const resolvedPersonKey = code ? `EMP:${code}` : String(personKey || '').trim();
    if (!tid || !resolvedPersonKey) return null;
    const rec = signedDocumentsArchive.find(
      (d) =>
        d.templateId === tid &&
        d.personKey === resolvedPersonKey &&
        d.signed === true &&
        !d.superseded &&
        (!bizRegNo || !d.bizRegNo || d.bizRegNo === bizRegNo) &&
        (!personId || !d.personId || d.personId === personId)
    );
    if (!rec) return null;
    if (typeof renderUnsignedAtSignedDate === 'function' && rec.unsignedBodySha256) {
      const renderedUnsignedBody = renderUnsignedAtSignedDate(rec.signedAt || null);
      const currentSha = crypto
        .createHash('sha256')
        .update(String(renderedUnsignedBody || ''))
        .digest('hex');
      if (currentSha !== rec.unsignedBodySha256) {
        return null;
      }
    }
    return structuredClone(rec);
  }

  function getWorkerLeaveRecords(w) {
    if (w.workerCategory === 'DAILY' || w.workerCategory === 'BIZ_33') return [];
    if (leaveRecordsMap.has(w.empCode)) {
      return leaveRecordsMap.get(w.empCode);
    }
    const usage = leaveUsageMap.get(w.empCode);
    if (usage && usage.usedDays === 0) {
      leaveRecordsMap.set(w.empCode, []);
      return [];
    }
    const targetUsed = usage ? usage.usedDays : 2;
    const seeded = [];
    if (targetUsed >= 1) {
      seeded.push({
        recordId: `LV-AUTO-${w.empCode}-1`,
        appliedAt: '2026-10-05',
        useDate: '2026-10-14',
        days: 1,
        leaveType: '연차(1일)',
        reason: '개인 휴무',
      });
    }
    if (targetUsed >= 2) {
      seeded.push({
        recordId: `LV-AUTO-${w.empCode}-2`,
        appliedAt: '2026-11-03',
        useDate: '2026-11-12',
        days: Number((targetUsed - 1).toFixed(1)),
        leaveType: targetUsed - 1 === 0.5 ? '반차(0.5일)' : `연차(${Number((targetUsed - 1).toFixed(1))}일)`,
        reason: '개인 용무',
      });
    }
    leaveRecordsMap.set(w.empCode, seeded);
    return seeded;
  }

  function buildInitialMonthDayMap(w, ym, payrollYm = '2026-11') {
    const dayCount = getDaysInYearMonth(ym);
    const map = new Map();
    const leaveByDate = new Map();
    for (const rec of getWorkerLeaveRecords(w)) {
      for (const slot of expandLeaveRecordDates(rec)) {
        if (slot.date.startsWith(`${ym}-`)) {
          leaveByDate.set(slot.date, { rec, dayFraction: slot.dayFraction });
        }
      }
    }
    const dailyH = w.workerCategory === 'PART_TIME' ? w.dailyHours || 4 : w.dailyHours || 8;
    const isPayrollMonth = ym === payrollYm;

    if (w.workerCategory === 'BIZ_33') {
      for (let d = 1; d <= dayCount; d++) {
        const iso = `${ym}-${String(d).padStart(2, '0')}`;
        const wd = getUtcWeekday(iso);
        map.set(iso, {
          date: iso,
          day: d,
          weekday: WEEKDAY_KO[wd],
          weekdayIdx: wd,
          workStatus: 'OFF',
          statusLabel: '자율위탁',
          clockIn: '-',
          clockOut: '-',
          normalHours: 0,
          overtimeHours: 0,
          nightHours: 0,
          holidayHours: 0,
          memo: '',
        });
      }
      return map;
    }

    if (w.workerCategory === 'DAILY') {
      let remainingDays = isPayrollMonth
        ? Math.max(0, Math.min(dayCount, Math.round(w.dailyWorkDays || 8)))
        : 8;
      for (let d = 1; d <= dayCount; d++) {
        const iso = `${ym}-${String(d).padStart(2, '0')}`;
        const wd = getUtcWeekday(iso);
        const isWork = wd >= 1 && wd <= 5 && remainingDays > 0;
        if (isWork) remainingDays -= 1;
        map.set(iso, {
          date: iso,
          day: d,
          weekday: WEEKDAY_KO[wd],
          weekdayIdx: wd,
          workStatus: isWork ? 'WORK' : 'OFF',
          statusLabel: isWork ? '일용출근' : '휴무',
          clockIn: isWork ? '08:00' : '-',
          clockOut: isWork ? '17:00' : '-',
          normalHours: isWork ? 8 : 0,
          overtimeHours: 0,
          nightHours: 0,
          holidayHours: 0,
          memo: '',
        });
      }
      return map;
    }

    let remOt = isPayrollMonth ? Number(w.overtimeHours || 0) : 0;
    let remNight = isPayrollMonth ? Number(w.nightHours || 0) : 0;
    let remHol = isPayrollMonth
      ? Number((w.holidayLe8Hours || 0) + (w.holidayGt8Hours || 0))
      : 0;
    const weeklyPeakCap = Math.max(w.weeklyHours || 40, w.maxWeeklyWorkedHours || 40);

    // 주(일~토)별 기본 소정 실근로시간을 먼저 계산해 주간 한도(weeklyPeakCap)를 넘지 않도록 배분
    const weekIndexByDay = [];
    const weekBaseWorked = [];
    let wIdx = 0;
    for (let d = 1; d <= dayCount; d++) {
      const iso = `${ym}-${String(d).padStart(2, '0')}`;
      const wd = getUtcWeekday(iso);
      if (wd === 0 && d > 1) wIdx += 1;
      weekIndexByDay[d] = wIdx;
      if (weekBaseWorked[wIdx] === undefined) weekBaseWorked[wIdx] = 0;
      const lvInfo = leaveByDate.get(iso);
      const pubHoliday = getKoreanStatutoryHolidayName(iso);
      if (lvInfo) {
        if (lvInfo.dayFraction < 1) {
          weekBaseWorked[wIdx] += Number((dailyH / 2).toFixed(1));
        }
      } else if (wd >= 1 && wd <= 5 && !pubHoliday) {
        weekBaseWorked[wIdx] += dailyH;
      }
    }
    const weekRemainingRoom = weekBaseWorked.map((base) =>
      Math.max(0, Number((weeklyPeakCap - base).toFixed(1)))
    );

    for (let d = 1; d <= dayCount; d++) {
      const iso = `${ym}-${String(d).padStart(2, '0')}`;
      const wd = getUtcWeekday(iso);
      const curWeek = weekIndexByDay[d];
      const lvInfo = leaveByDate.get(iso);
      const pubHoliday = getKoreanStatutoryHolidayName(iso);

      if (lvInfo) {
        const isHalf = lvInfo.dayFraction < 1;
        map.set(iso, {
          date: iso,
          day: d,
          weekday: WEEKDAY_KO[wd],
          weekdayIdx: wd,
          workStatus: isHalf ? 'HALF_LEAVE' : 'LEAVE',
          statusLabel: isHalf ? '반차휴가' : '연차휴가',
          clockIn: isHalf ? '09:00' : '-',
          clockOut: isHalf ? '13:00' : '-',
          breakHours: 0,
          normalHours: isHalf ? Number((dailyH / 2).toFixed(1)) : dailyH,
          overtimeHours: 0,
          nightHours: 0,
          holidayHours: 0,
          holidayName: pubHoliday,
          isStatutoryHoliday: Boolean(pubHoliday),
          autoOvertime: false,
          autoNight: false,
          autoHoliday: false,
          memo: lvInfo.rec.reason || lvInfo.rec.leaveType,
        });
        continue;
      }

      if (pubHoliday) {
        map.set(iso, {
          date: iso,
          day: d,
          weekday: WEEKDAY_KO[wd],
          weekdayIdx: wd,
          workStatus: 'OFF',
          statusLabel: pubHoliday,
          clockIn: '-',
          clockOut: '-',
          breakHours: 0,
          normalHours: 0,
          overtimeHours: 0,
          nightHours: 0,
          holidayHours: 0,
          holidayName: pubHoliday,
          isStatutoryHoliday: true,
          autoOvertime: false,
          autoNight: false,
          autoHoliday: false,
          memo: `법정공휴일 (${pubHoliday})`,
        });
        continue;
      }

      if (wd === 0) {
        map.set(iso, {
          date: iso,
          day: d,
          weekday: WEEKDAY_KO[wd],
          weekdayIdx: wd,
          workStatus: 'OFF',
          statusLabel: '주휴일',
          clockIn: '-',
          clockOut: '-',
          breakHours: 0,
          normalHours: 0,
          overtimeHours: 0,
          nightHours: 0,
          holidayHours: 0,
          holidayName: '주휴일',
          isStatutoryHoliday: false,
          autoOvertime: false,
          autoNight: false,
          autoHoliday: false,
          memo: '',
        });
        continue;
      }

      if (wd === 6) {
        const room = weekRemainingRoom[curWeek] || 0;
        if (remHol > 0 && room >= 2) {
          const hHours = Number(Math.min(10, remHol, room).toFixed(1));
          remHol = Number((remHol - hHours).toFixed(1));
          weekRemainingRoom[curWeek] = Number((room - hHours).toFixed(1));
          const brk = hHours >= 8 ? 1 : hHours >= 4 ? 0.5 : 0;
          const endHour = Math.min(22, 9 + Math.ceil(hHours + brk));
          map.set(iso, {
            date: iso,
            day: d,
            weekday: WEEKDAY_KO[wd],
            weekdayIdx: wd,
            workStatus: 'HOLIDAY_WORK',
            statusLabel: '휴일근무',
            clockIn: '09:00',
            clockOut: `${String(endHour).padStart(2, '0')}:00`,
            breakHours: brk,
            normalHours: 0,
            overtimeHours: 0,
            nightHours: 0,
            holidayHours: hHours,
            holidayName: '휴일근무',
            isStatutoryHoliday: false,
            autoOvertime: hHours > 8,
            autoNight: false,
            autoHoliday: true,
            memo: '휴일 특근',
          });
        } else {
          map.set(iso, {
            date: iso,
            day: d,
            weekday: WEEKDAY_KO[wd],
            weekdayIdx: wd,
            workStatus: 'OFF',
            statusLabel: '휴무',
            clockIn: '-',
            clockOut: '-',
            breakHours: 0,
            normalHours: 0,
            overtimeHours: 0,
            nightHours: 0,
            holidayHours: 0,
            holidayName: null,
            isStatutoryHoliday: false,
            autoOvertime: false,
            autoNight: false,
            autoHoliday: false,
            memo: '',
          });
        }
        continue;
      }

      // 평일(월~금)
      let ot = 0;
      const room = weekRemainingRoom[curWeek] || 0;
      if (remOt > 0 && room > 0 && (wd === 2 || wd === 4 || d > 18)) {
        ot = Number(Math.min(3, remOt, room).toFixed(1));
        remOt = Number((remOt - ot).toFixed(1));
        weekRemainingRoom[curWeek] = Number((room - ot).toFixed(1));
      }
      let nt = 0;
      if (remNight > 0 && ot > 0) {
        nt = Number(Math.min(2, remNight, dailyH + ot).toFixed(1));
        remNight = Number((remNight - nt).toFixed(1));
      }
      const brk = dailyH >= 8 ? 1 : 0.5;
      const startH = nt > 0 ? 13 : 9;
      const totalSpan = dailyH + ot + brk;
      const rawEnd = startH + totalSpan;
      const endH = Math.floor(rawEnd) % 24;
      const endM = Math.round((rawEnd % 1) * 60);
      map.set(iso, {
        date: iso,
        day: d,
        weekday: WEEKDAY_KO[wd],
        weekdayIdx: wd,
        workStatus: 'WORK',
        statusLabel: ot > 0 ? '연장근무' : '정상근무',
        clockIn: `${String(startH).padStart(2, '0')}:00`,
        clockOut: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
        breakHours: brk,
        normalHours: dailyH,
        overtimeHours: ot,
        nightHours: nt,
        holidayHours: 0,
        holidayName: null,
        isStatutoryHoliday: false,
        autoOvertime: ot > 0,
        autoNight: nt > 0,
        autoHoliday: false,
        memo: '',
      });
    }
    return map;
  }

  function ensureWorkerMonthCalendar(w, ym, payrollYm = '2026-11') {
    const key = `${w.empCode}|${ym}`;
    if (!dailyAttendanceMap.has(key)) {
      dailyAttendanceMap.set(key, buildInitialMonthDayMap(w, ym, payrollYm));
    }
    return dailyAttendanceMap.get(key);
  }

  function summarizeMonthCalendar(w, ym, payrollYm = '2026-11') {
    const dayMap = ensureWorkerMonthCalendar(w, ym, payrollYm);
    const days = Array.from(dayMap.values());
    let workDaysCount = 0;
    let leaveDaysCount = 0;
    let totalNormalHours = 0;
    let totalOvertimeHours = 0;
    let totalNightHours = 0;
    let totalHolidayHours = 0;

    for (const d of days) {
      if (d.workStatus === 'WORK' || d.workStatus === 'HOLIDAY_WORK' || d.workStatus === 'HALF_LEAVE') {
        workDaysCount += 1;
      }
      if (d.workStatus === 'LEAVE') leaveDaysCount += 1;
      if (d.workStatus === 'HALF_LEAVE') leaveDaysCount += 0.5;
      totalNormalHours += d.normalHours || 0;
      totalOvertimeHours += d.overtimeHours || 0;
      totalNightHours += d.nightHours || 0;
      totalHolidayHours += d.holidayHours || 0;
    }

    return {
      yearMonth: ym,
      firstWeekdayIdx: days[0]?.weekdayIdx ?? 0,
      workDaysCount,
      leaveDaysCount: Number(leaveDaysCount.toFixed(1)),
      totalNormalHours: Number(totalNormalHours.toFixed(1)),
      totalOvertimeHours: Number(totalOvertimeHours.toFixed(1)),
      totalNightHours: Number(totalNightHours.toFixed(1)),
      totalHolidayHours: Number(totalHolidayHours.toFixed(1)),
      days,
    };
  }

  function recalculateWorkerFromCalendar(w, ym, dayMap, payrollYm = '2026-11') {
    // 당월 급여 귀속월(payrollYm)과 다른 과거·미래 달의 캘린더 수정은 당월 급여 필드를 덮어쓰지 않음!
    if (ym !== payrollYm) return;
    const days = Array.from(dayMap.values());
    if (w.workerCategory === 'DAILY') {
      w.dailyWorkDays = days.filter((d) => d.workStatus === 'WORK' || d.workStatus === 'HOLIDAY_WORK').length;
      return;
    }
    if (w.workerCategory === 'BIZ_33') return;

    let otSum = 0;
    let nightSum = 0;
    let holLe8 = 0;
    let holGt8 = 0;
    let currentWeekHours = 0;
    let peakWeekHours = 0;

    for (const d of days) {
      if (d.weekdayIdx === 0 && d.day > 1) {
        peakWeekHours = Math.max(peakWeekHours, currentWeekHours);
        currentWeekHours = 0;
      }
      otSum += d.overtimeHours || 0;
      nightSum += d.nightHours || 0;
      const hol = d.holidayHours || 0;
      holLe8 += Math.min(8, hol);
      holGt8 += Math.max(0, hol - 8);
      // 야간근로(nightHours, 22:00~06:00)는 소정/연장/휴일근로 시간대 안의 가산 구간이므로 총 근로시간에 중복 합산하지 않음!
      const workedToday =
        (d.workStatus === 'WORK' || d.workStatus === 'HALF_LEAVE' ? d.normalHours || 0 : 0) +
        (d.overtimeHours || 0) +
        hol;
      currentWeekHours += workedToday;
    }
    peakWeekHours = Math.max(peakWeekHours, currentWeekHours);

    w.overtimeHours = Number(otSum.toFixed(1));
    w.nightHours = Number(nightSum.toFixed(1));
    w.holidayLe8Hours = Number(holLe8.toFixed(1));
    w.holidayGt8Hours = Number(holGt8.toFixed(1));
    w.maxWeeklyWorkedHours = Number(Math.max(w.weeklyHours || 40, peakWeekHours).toFixed(1));
  }

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
      workerProfileExtrasMap.delete(cleanCode);
      leaveUsageMap.delete(cleanCode);
      leaveRecordsMap.delete(cleanCode);
      evalGradeMap.delete(cleanCode);
      for (const key of Array.from(dailyAttendanceMap.keys())) {
        if (key.toUpperCase().startsWith(`${cleanCode}|`)) {
          dailyAttendanceMap.delete(key);
        }
      }
      for (const key of Array.from(listItemMarks.keys())) {
        if (key.toUpperCase().endsWith(`:${cleanCode}`)) {
          listItemMarks.delete(key);
        }
      }
    }
    for (let i = signedDocumentsArchive.length - 1; i >= 0; i--) {
      const sd = signedDocumentsArchive[i];
      if (
        (cleanCode && String(sd.empCode || '').toUpperCase() === cleanCode) ||
        (origPersonId && sd.personId && sd.personId === origPersonId)
      ) {
        signedDocumentsArchive.splice(i, 1);
      }
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
    statutoryGovernance.scrubPurgedPerson(origEmpCode, origDisplayName);
    rosterDossier.scrubPurgedPerson(origEmpCode);
    evalRewardStudio.scrubPurgedPerson(origEmpCode);
  }

  /**
   * 현재 스냅샷(company, workers, payrollLines, compliance, offboardedSummary)과 결합된 전 모듈 운영 뷰 생성
   */
  function buildView({ company, workers, payrollLines, compliance, offboardedSummary }) {
    const refDate = company.referenceDate || '2026-11-15';
    const payrollYm = refDate.slice(0, 7);
    const activeYm = isValidYearMonth(selectedYearMonth) ? selectedYearMonth : payrollYm;
    const policy = normalizePolicySettings(company.policySettings);
    const hc = compliance.headcounts;
    const regularRoster = workers.filter(
      (w) =>
        w.workerCategory === 'REGULAR' ||
        w.workerCategory === 'FIXED_TERM' ||
        w.workerCategory === 'PART_TIME'
    );

    // 1) M1·M2 계약·취득 테이블 (전 직원 No. 1..N · 사번 · 성명 · 체크 · 별표 · 입사 3종 서식 100% 일치)
    const contractLedger = workers.map((w, idx) => {
      const meta = contractSignedMap.get(w.empCode) || {
        signed: true,
        signedAt: w.hireDate || '2026-01-02',
        employmentContractSigned: true,
        privacyConsentSigned: true,
        ndaPledgeSigned: true,
        nhisAcquired: w.workerCategory !== 'DAILY' && w.workerCategory !== 'BIZ_33' && (w.weeklyHours ?? 40) >= 15,
        eiAcquired: w.workerCategory !== 'BIZ_33',
      };
      const extras = workerProfileExtrasMap.get(w.empCode) || {};
      const hireDate = w.hireDate || '2024-03-02';
      const probationEndsOn = addDaysISO(hireDate, 90);
      const empContractSigned = meta.employmentContractSigned ?? Boolean(meta.signed);
      const privacySigned = meta.privacyConsentSigned ?? Boolean(meta.signed);
      const ndaSigned = meta.ndaPledgeSigned ?? Boolean(meta.signed);
      return {
        rowNo: idx + 1,
        checked: Boolean(w.checked),
        starred: Boolean(w.starred),
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        jobTitle: w.jobTitle || (w.workerCategory === 'BIZ_33' ? '위탁계약' : w.workerCategory === 'DAILY' ? '일용직' : '사원'),
        workerCategory: w.workerCategory,
        hireDate,
        probationEndsOn,
        maskedBirthOrId: w.maskedBirthOrId || '900101-*******',
        maskedPhone: extras.maskedPhone || '010-****-0000',
        address: extras.address || `${company.companyName} 등록 주소지`,
        workplaceLocation: extras.workplaceLocation || `${company.companyName} 본사 사업장`,
        workStartEnd: extras.workStartEnd || '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
        weeklyHours: w.weeklyHours || (w.workerCategory === 'DAILY' ? 18 : 0),
        baseMonthlyPay:
          w.baseMonthlyPay || w.contractFee || (w.dailyWage || 0) * (w.dailyWorkDays || 0),
        mealAllowance: w.mealAllowance ?? 200000,
        contractSigned: Boolean(meta.signed),
        contractSignedAt: meta.signedAt,
        employmentContractSigned: empContractSigned,
        privacyConsentSigned: privacySigned,
        ndaPledgeSigned: ndaSigned,
        allOnboardingSigned: empContractSigned && privacySigned && ndaSigned,
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

    // 3) M4 근태 · 월간 캘린더 · 주52시간 관제 보드 (전 직원 No. 1..N · 사번 · 성명 100% 동기화)
    const attendanceBoard = workers.map((w, idx) => {
      const monthlyCalendar = summarizeMonthCalendar(w, activeYm, payrollYm);
      const payrollMonthCalendar =
        activeYm === payrollYm ? monthlyCalendar : summarizeMonthCalendar(w, payrollYm, payrollYm);
      const isContractor = w.workerCategory === 'BIZ_33';
      const isDaily = w.workerCategory === 'DAILY';
      const maxWeekly = isContractor
        ? 0
        : isDaily
          ? Number((((w.dailyWorkDays || 8) * 8) / 4.345).toFixed(1))
          : Number((w.maxWeeklyWorkedHours ?? w.weeklyHours ?? 40).toFixed(1));
      const status = isContractor
        ? 'CONTRACTOR_33'
        : w.unpaidLeaveDays > 0
          ? 'PARENTAL_OR_LEAVE'
          : maxWeekly > 52
            ? 'OVER_52H_ALERT'
            : maxWeekly >= policy.weeklyWarnHours
              ? 'NEAR_52H_WARN'
              : 'NORMAL_WORKING';
      const shiftType = isContractor
        ? '외주·위탁(3.3%)'
        : isDaily
          ? `일용근무 (월 ${monthlyCalendar.workDaysCount}일)`
          : idx % 3 === 1
            ? '생산 2교대제'
            : idx % 3 === 2
              ? '선택적 근로시간제'
              : '주 40h 통상근무';
      return {
        rowNo: idx + 1,
        checked: Boolean(w.checked),
        starred: Boolean(w.starred),
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        workerCategory: w.workerCategory,
        shiftType,
        weeklyContractHours: w.weeklyHours || 40,
        monthlyOvertimeHours: isContractor || isDaily ? 0 : w.overtimeHours || 0,
        monthlyNightHours: isContractor || isDaily ? 0 : w.nightHours || 0,
        monthlyHolidayHours:
          isContractor || isDaily ? 0 : (w.holidayLe8Hours || 0) + (w.holidayGt8Hours || 0),
        maxWeeklyWorkedHours: maxWeekly,
        warnThresholdHours: policy.weeklyWarnHours,
        status,
        monthlyCalendar,
        payrollMonthCalendar,
      };
    });

    // 4) M5 연차원장 · 신청일/사용일 이력 · 발생횟수/사용횟수 (전 직원 No. 1..N · 사번 · 성명 100% 동기화)
    const leaveLedger = workers.map((w, idx) => {
      const isEligibleWorker =
        w.workerCategory !== 'DAILY' && w.workerCategory !== 'BIZ_33';
      const hireDate = w.hireDate || '2023-03-02';
      if (!isEligibleWorker) {
        return {
          rowNo: idx + 1,
          checked: Boolean(w.checked),
          starred: Boolean(w.starred),
          empCode: w.empCode,
          displayName: w.displayName,
          deptName: w.deptName,
          workerCategory: w.workerCategory,
          leaveEligible: false,
          hireDate: w.hireDate || '-',
          ruleBasis:
            w.workerCategory === 'BIZ_33'
              ? '3.3% 사업소득 계약자 (연차 비대상)'
              : '일용직 근로자 (상용 연차 비대상)',
          cycleExpiryDate: '-',
          firstPromoDeadline: '-',
          secondPromoDeadline: '-',
          promoWindowLabel: '-',
          hireBasisDays: 0,
          grantedCount: 0,
          accruedDays: 0,
          usedCount: 0,
          usedDays: 0,
          monthUsedCount: 0,
          monthUsedDays: 0,
          remainingDays: 0,
          promoStage: 'EXEMPT',
          dailyOrdinaryWage: 0,
          estimatedUnusedPayout: 0,
          records: [],
        };
      }

      const statutory = computeStatutoryAnnualLeaveDays(hireDate, refDate, policy);
      const records = [...getWorkerLeaveRecords(w)].sort((a, b) =>
        b.useDate.localeCompare(a.useDate)
      );
      const rawUsedSum = Number(
        records.reduce((sum, r) => sum + (Number(r.days) || 0), 0).toFixed(1)
      );
      const usageMeta = leaveUsageMap.get(w.empCode) || {
        usedDays: rawUsedSum,
        promoStage: 'NONE',
      };
      usageMeta.usedDays = rawUsedSum;
      leaveUsageMap.set(w.empCode, usageMeta);

      const grantedCount = hc.is5OrMore ? statutory.grantedCount : 0;
      const accruedDays = hc.is5OrMore ? statutory.accruedDays : 0;
      const usedDays = hc.is5OrMore ? Math.min(accruedDays, rawUsedSum) : 0;
      const usedCount = hc.is5OrMore ? records.length : 0;
      let monthSlotSum = 0;
      let monthRecHits = 0;
      if (hc.is5OrMore) {
        for (const r of records) {
          const slotsInMonth = expandLeaveRecordDates(r).filter((s) =>
            s.date.startsWith(`${activeYm}-`)
          );
          if (slotsInMonth.length > 0) {
            monthRecHits += 1;
            monthSlotSum += slotsInMonth.reduce((acc, s) => acc + s.dayFraction, 0);
          }
        }
      }
      const monthUsedCount = monthRecHits;
      const monthUsedDays = Number(monthSlotSum.toFixed(1));
      const remainingDays = Math.max(0, Number((accruedDays - usedDays).toFixed(1)));
      const payLine = payrollLines.find((p) => p.empCode === w.empCode);
      const dailyOrdinary = Math.round(
        (payLine?.ordinaryHourlyWage || payLine?.ordinaryHourly || LAW_BASELINE.minimumHourlyWage) *
          (w.dailyHours || 8)
      );
      const exemptByPromo =
        policy.leaveSettlementPolicy === 'PROMOTE_FIRST' &&
        usageMeta.promoStage === 'STAGE_2_DESIGNATED';
      const estimatedPayout = exemptByPromo ? 0 : Math.round(remainingDays * dailyOrdinary);
      return {
        rowNo: idx + 1,
        checked: Boolean(w.checked),
        starred: Boolean(w.starred),
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        workerCategory: w.workerCategory,
        leaveEligible: true,
        hireDate,
        ruleBasis: hc.is5OrMore ? statutory.ruleBasis : '5인 미만 사업장 법정 연차 의무 미적용',
        cycleExpiryDate: statutory.cycleExpiryDate,
        firstPromoDeadline: addDaysISO(statutory.cycleExpiryDate, -180),
        secondPromoDeadline: addDaysISO(statutory.cycleExpiryDate, -60),
        promoWindowLabel: statutory.promoWindowLabel,
        hireBasisDays: statutory.hireBasisDays,
        grantedCount,
        accruedDays,
        usedCount,
        usedDays,
        monthUsedCount,
        monthUsedDays,
        remainingDays,
        promoStage: usageMeta.promoStage,
        dailyOrdinaryWage: dailyOrdinary,
        estimatedUnusedPayout: estimatedPayout,
        records: structuredClone(records),
      };
    });

    // 5) M6 인사평가 · 보상 시뮬레이션 보드 (전 직원 No. 1..N 동기화)
    const evaluationBoard = workers.map((w, idx) => {
      const isRegular =
        w.workerCategory === 'REGULAR' ||
        w.workerCategory === 'FIXED_TERM' ||
        w.workerCategory === 'PART_TIME';
      const preset = evalGradeMap.get(w.empCode) || {
        kpiScore: 82 + (idx % 4) * 3,
        competencyScore: 80 + (idx % 5) * 3,
        grade: idx % 5 === 0 ? 'A' : 'B',
        recommendedRaisePct: isRegular ? (idx % 5 === 0 ? 5 : 3) : 0,
        recommendedBonus: isRegular ? (idx % 5 === 0 ? 250000 : 100000) : 0,
        appliedToPayroll: (w.evalRaiseRatePct || 0) > 0 || (w.evalBonusPay || 0) > 0,
      };
      const basePay =
        w.baseMonthlyPay || w.contractFee || (w.dailyWage || 0) * (w.dailyWorkDays || 0);
      const projectedBasePay = Math.round(basePay * (1 + preset.recommendedRaisePct / 100));
      return {
        rowNo: idx + 1,
        checked: Boolean(w.checked),
        starred: Boolean(w.starred),
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        workerCategory: w.workerCategory,
        evalEligible: isRegular,
        currentBasePay: basePay,
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

    // 6) M7 징계 적법절차 & 제95조 감봉 상한 보드 + 고충처리 D-Day (마스터 번호 · 체크 · 별표 동기화)
    const disciplineBoard = regularRoster
      .filter((w, idx) => (w.requestedDisciplinaryCut || 0) > 0 || idx < 2)
      .map((w) => {
        const masterIdx = workers.findIndex((item) => item.empCode === w.empCode);
        const payLine = payrollLines.find((p) => p.empCode === w.empCode);
        const allStepsDone =
          Boolean(w.attendanceNoticeSent) &&
          Boolean(w.defenseOpportunityGiven) &&
          Boolean(w.committeeResolved) &&
          Boolean(w.writtenNoticeDelivered);
        return {
          rowNo: masterIdx >= 0 ? masterIdx + 1 : 1,
          checked: Boolean(w.checked),
          starred: Boolean(w.starred),
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

    const grievanceBoard = grievances.map((g, idx) => ({
      ...g,
      rowNo: idx + 1,
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
        workerRegistry: rosterDossier.buildView({
          company,
          workers,
          contractLedger,
          workerProfileExtrasMap,
          offboardedSummary,
        }),
      },
      attendanceControl: {
        is5OrMore: hc.is5OrMore,
        selectedYearMonth: activeYm,
        weeklyWarnHours: policy.weeklyWarnHours,
        board: attendanceBoard,
      },
      leaveAndMaternity: {
        is5OrMore: hc.is5OrMore,
        selectedYearMonth: activeYm,
        ledger: leaveLedger,
        maternityProtections: structuredClone(maternityProtections),
      },
      evaluationAndReward: {
        board: evaluationBoard,
        studio: evalRewardStudio.buildView({
          company,
          workers,
          evalBoard: evaluationBoard,
          payrollLines,
        }),
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
      statutoryGovernance: statutoryGovernance.buildView({
        company,
        workers,
        compliance,
        getMaskedPhoneFn: (empCode) =>
          workerProfileExtrasMap.get(empCode)?.maskedPhone || '010-****-0000',
      }),
      listItemMarks: Object.fromEntries(listItemMarks.entries()),
      signedDocumentsArchive: signedDocumentsArchive
        .filter((d) => !d.superseded && isRecordValidForRoster(d, company.bizRegNo, workers, []))
        .map((d) => ({
          docRecordId: d.docRecordId,
          version: d.version || 1,
          personKey: d.personKey || (d.empCode ? `EMP:${d.empCode}` : ''),
          templateId: d.templateId,
          templateLabel: d.templateLabel,
          empCode: d.empCode || '',
          personName: d.personName,
          deptName: d.deptName,
          jobTitle: d.jobTitle,
          hireDate: d.hireDate,
          maskedBirthOrId: d.maskedBirthOrId,
          maskedPhone: d.maskedPhone,
          weeklyHours: d.weeklyHours,
          baseMonthlyPay: d.baseMonthlyPay,
          mealAllowance: d.mealAllowance,
          signed: Boolean(d.signed),
          signerName: d.signerName || '',
          signedAt: d.signedAt || null,
          signatureCode: d.signatureCode || '',
          payloadDigest: d.payloadDigest || '',
          hasSignatureImage: Boolean(d.signatureDataUrl),
          hasSavedBody: Boolean(d.savedBody),
        })),
    };
  }

  /**
   * 관리 시스템 인터랙티브 액션 처리기 (`POST /api/ops/action`)
   */
  function applyAction(
    actionPayload = {},
    {
      state,
      payrollLocked = false,
      appendAudit,
      tombstoneStore = null,
      lsaRegularCount = 60,
      docLsaCount = undefined,
      docOshCount = undefined,
    }
  ) {
    const actionType = String(actionPayload.actionType || '').trim();
    if (!actionType) throw badRequest('actionType이 필요합니다.');

    const payrollMutatingActions = new Set([
      'HIRE_APPLICANT',
      'ISSUE_ASSIGNMENT',
      'APPLY_EVAL_REWARDS',
      'QUICK_ATTENDANCE_UPDATE',
      'SET_DAILY_ATTENDANCE',
      'ADD_LEAVE_USAGE',
      'DELETE_LEAVE_USAGE',
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
        state.workers.push({
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
          employmentContractSigned: false,
          privacyConsentSigned: false,
          ndaPledgeSigned: false,
          nhisAcquired: app.weeklyHours >= 15,
          eiAcquired: true,
        });
        workerProfileExtrasMap.set(newEmpCode, {
          maskedPhone: '010-****-0000',
          address: `${state.company.companyName} 관할 거주지`,
          workplaceLocation: `${state.company.companyName} ${app.targetDept}`,
          workStartEnd: '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
        });
        leaveUsageMap.set(newEmpCode, { usedDays: 0, promoStage: 'NONE' });
        appendAudit(
          'M1채용→M2입사',
          `[${app.name} → ${newEmpCode}] 합격자 인사명부·입사 3종 서식(근로계약·개인정보동의·보안서약) 자동생성·M8 급여원장 편입 완료`
        );
        return {
          message: `${app.name}님이 ${newEmpCode} 사번으로 입사 발령되어 입사 3종 필수 서식(근로계약서·개인정보동의서·보안서약서)이 자동 생성되었습니다.`,
          hiredEmpCode: newEmpCode,
          hiredName: app.name,
          autoOpenOnboardingDocs: true,
        };
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
          employmentContractSigned: true,
          privacyConsentSigned: true,
          ndaPledgeSigned: true,
          nhisAcquired: (w.weeklyHours || 40) >= 15,
          eiAcquired: true,
        });
        appendAudit(
          'M2전자계약',
          `[${empCode} ${w.displayName}] 근로기준법 제17조 전자근로계약 체결·즉시교부 및 4대보험 취득 연동 완료`
        );
        return { message: `[${empCode} ${w.displayName}] 전자근로계약 서명·즉시교부가 완료되었습니다.` };
      }

      case 'SAVE_PERSON_DOC_AND_SIGN': {
        const rawCode = String(actionPayload.empCode || '').trim().slice(0, 30);
        const matchedWorker = rawCode ? state.workers.find((item) => item.empCode === rawCode) : null;
        const matchedAlumni =
          !matchedWorker && rawCode
            ? (state.offboardedWorkers || []).find((item) => item.empCode === rawCode)
            : null;
        if (
          rawCode &&
          tombstoneStore &&
          tombstoneStore.isEmpCodePurged(state.company.bizRegNo, rawCode)
        ) {
          throw conflictError('비식별 파기 완료된 사번의 서식은 생성·서명할 수 없습니다.');
        }

        const personName = maskInlinePiiText(
          String(
            actionPayload.personName ||
              matchedWorker?.displayName ||
              matchedAlumni?.displayName ||
              ''
          )
            .trim()
            .slice(0, 40)
        );
        if (!personName) {
          throw badRequest('서식에 기입할 대상자 성명(personName)을 입력해 주세요.');
        }
        if (actionPayload.signNow !== undefined && typeof actionPayload.signNow !== 'boolean') {
          throw badRequest('signNow 값은 boolean이어야 합니다.');
        }
        const signNow = actionPayload.signNow === true;
        if (
          actionPayload.consentConfirmed !== undefined &&
          typeof actionPayload.consentConfirmed !== 'boolean'
        ) {
          throw badRequest('consentConfirmed 값은 boolean이어야 합니다.');
        }
        if (signNow && actionPayload.consentConfirmed !== true) {
          throw badRequest('전자서명 진행을 위해 내용 확인 및 명시적 동의(consentConfirmed: true)가 필수입니다.');
        }

        const rawTemplateIds = Array.isArray(actionPayload.templateIds)
          ? actionPayload.templateIds
          : actionPayload.templateId
            ? [actionPayload.templateId]
            : ['DOC_EMPLOYMENT_CONTRACT', 'DOC_PRIVACY_CONSENT', 'DOC_NDA_SECURITY_PLEDGE'];
        if (rawTemplateIds.length === 0 || rawTemplateIds.length > 6) {
          throw badRequest('저장·서명할 서식 목록(templateIds)은 1~6개여야 합니다.');
        }
        const templateIds = rawTemplateIds.map((id) => String(id || '').trim());
        for (const tid of templateIds) {
          if (!VALID_DOC_TEMPLATES.includes(tid)) {
            throw badRequest(`지원하지 않는 서식 ID입니다 (${tid}).`);
          }
        }

        const sigDataUrl = String(actionPayload.signatureDataUrl || '').trim();
        if (
          sigDataUrl &&
          (!sigDataUrl.startsWith('data:image/png;base64,') || sigDataUrl.length > 36000)
        ) {
          throw badRequest('자필 서명 이미지는 PNG 데이터(36KB 이하) 형식이어야 합니다.');
        }

        const deptName = maskInlinePiiText(
          String(actionPayload.deptName || matchedWorker?.deptName || matchedAlumni?.deptName || '일반부서')
            .trim()
            .slice(0, 40)
        );
        const jobTitle = maskInlinePiiText(
          String(actionPayload.jobTitle || matchedWorker?.jobTitle || matchedAlumni?.jobTitle || '사원')
            .trim()
            .slice(0, 40)
        );
        const hireDateRaw = String(
          actionPayload.hireDate ||
            matchedWorker?.hireDate ||
            matchedAlumni?.hireDate ||
            state.company.referenceDate ||
            '2026-11-15'
        ).trim();
        if (!isValidIsoDate(hireDateRaw)) {
          throw badRequest('입사일(hireDate)은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.');
        }
        const maskedBirthOrId = maskInlinePiiText(
          String(
            actionPayload.maskedBirthOrId ||
              matchedWorker?.maskedBirthOrId ||
              matchedAlumni?.maskedBirthOrId ||
              '950101-*******'
          )
            .trim()
            .slice(0, 30)
        );
        const maskedPhone = maskInlinePiiText(
          String(actionPayload.maskedPhone || '010-****-0000').trim().slice(0, 30)
        );
        const address = maskInlinePiiText(
          String(actionPayload.address || `${state.company.companyName} 관할 거주지`)
            .trim()
            .slice(0, 120)
        );
        const workplaceLocation = maskInlinePiiText(
          String(actionPayload.workplaceLocation || `${state.company.companyName} 본사 사업장`)
            .trim()
            .slice(0, 80)
        );
        const workStartEnd = maskInlinePiiText(
          String(
            actionPayload.workStartEnd ||
              '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00'
          )
            .trim()
            .slice(0, 100)
        );

        const weeklyHours =
          actionPayload.weeklyHours === undefined
            ? matchedWorker?.weeklyHours ?? 40
            : assertBoundedFiniteNumber(Number(actionPayload.weeklyHours), 'weeklyHours', 1, 52);
        const baseMonthlyPay =
          actionPayload.baseMonthlyPay === undefined
            ? matchedWorker?.baseMonthlyPay ?? 3200000
            : Math.round(
                assertBoundedFiniteNumber(
                  Number(actionPayload.baseMonthlyPay),
                  'baseMonthlyPay',
                  0,
                  100_000_000
                )
              );
        const mealAllowance =
          actionPayload.mealAllowance === undefined
            ? matchedWorker?.mealAllowance ?? 200000
            : Math.round(
                assertBoundedFiniteNumber(
                  Number(actionPayload.mealAllowance),
                  'mealAllowance',
                  0,
                  5_000_000
                )
              );

        if (matchedWorker) {
          const isSalariedWorker =
            matchedWorker.workerCategory === 'REGULAR' ||
            matchedWorker.workerCategory === 'FIXED_TERM' ||
            matchedWorker.workerCategory === 'PART_TIME';
          const currentRefPay = isSalariedWorker
            ? matchedWorker.baseMonthlyPay ?? 0
            : matchedWorker.contractFee ||
              (matchedWorker.dailyWage || 0) * (matchedWorker.dailyWorkDays || 0);
          const payMutated =
            (actionPayload.baseMonthlyPay !== undefined && baseMonthlyPay !== currentRefPay) ||
            (isSalariedWorker &&
              actionPayload.mealAllowance !== undefined &&
              mealAllowance !== (matchedWorker.mealAllowance ?? 0)) ||
            (isSalariedWorker &&
              actionPayload.weeklyHours !== undefined &&
              weeklyHours !== (matchedWorker.weeklyHours ?? 40));
          if (payrollLocked && payMutated) {
            throw conflictError(
              '당월 급여대장이 잠금 확정(APPROVED_LOCKED) 상태여서 급여·소정근로시간 항목 변경은 수행할 수 없습니다.'
            );
          }
          matchedWorker.displayName = personName;
          matchedWorker.deptName = deptName;
          matchedWorker.jobTitle = jobTitle;
          matchedWorker.hireDate = hireDateRaw;
          matchedWorker.maskedBirthOrId = maskedBirthOrId;
          if (!payrollLocked && isSalariedWorker) {
            matchedWorker.weeklyHours = weeklyHours;
            matchedWorker.baseMonthlyPay = baseMonthlyPay;
            matchedWorker.mealAllowance = mealAllowance;
          }
          workerProfileExtrasMap.set(matchedWorker.empCode, {
            maskedPhone,
            address,
            workplaceLocation,
            workStartEnd,
          });
        }

        const signedAt = state.company.referenceDate || '2026-11-15';
        const signerName = maskInlinePiiText(
          String(actionPayload.signerName || personName).trim().slice(0, 40)
        );

        const templateLabels = {
          DOC_EMPLOYMENT_CONTRACT: '표준 근로계약서',
          DOC_PRIVACY_CONSENT: '개인정보 수집·이용 동의서',
          DOC_NDA_SECURITY_PLEDGE: '비밀유지 및 정보보안 서약서',
          DOC_EXIT_SECURITY_NONCOMPETE: '퇴사 시 보안·경업금지 서약서',
          DOC_EMPLOYMENT_CERT: '재직증명서',
          DOC_CAREER_CERTIFICATE: '사용(경력)증명서',
          DOC_EI_SEPARATION_CERT: '고용보험 상실·이직확인서',
          DOC_WORK_RULES_REPORT: '취업규칙 제정·변경 신고서',
          DOC_ANNUAL_LEAVE_PROMOTION: '미사용 연차 사용촉진 통지서',
          DOC_DISCIPLINE_WRITTEN_NOTICE: '징계 출석 · 서면통지서',
          DOC_LMC_REGULATION_AND_FILING: '노사협의회 규정 및 신고서',
          DOC_LMC_MINUTES: '노사협의회 정기회의록',
          DOC_OSH_OFFICER_APPOINTMENT: '안전·보건관리자 선임보고서',
          DOC_OSH_MINUTES: '산업안전보건위원회 회의록',
        };

        const currentBizRegNo = state.company.bizRegNo || '';
        const requestedPersonKey = String(actionPayload.personKey || '').trim();
        const isKnownExtKey =
          !rawCode &&
          /^EXT-\d+$/.test(requestedPersonKey) &&
          signedDocumentsArchive.some(
            (d) => d.personKey === requestedPersonKey && (!d.bizRegNo || d.bizRegNo === currentBizRegNo)
          );
        const personKey = rawCode
          ? `EMP:${rawCode}`
          : isKnownExtKey
            ? requestedPersonKey
            : `EXT-${++customPersonSeq}`;
        const boundPersonId = matchedWorker?.personId || matchedAlumni?.personId || null;

        const savedDocIds = [];
        for (const tid of templateIds) {
          const personPayload = {
            empCode: rawCode || '',
            displayName: personName,
            personName,
            deptName,
            jobTitle,
            hireDate: hireDateRaw,
            maskedBirthOrId,
            maskedPhone,
            address,
            workplaceLocation,
            workStartEnd,
            weeklyHours,
            baseMonthlyPay,
            mealAllowance,
          };
          const payloadDigest = computeDocPayloadDigest(tid, personPayload);

          const baseDocContext = {
            companyName: state.company.companyName,
            bizRegNo: currentBizRegNo,
            ceoName: state.company.ceoName,
            ksicMajor: state.company.ksicMajor,
            lsaRegularCount: docLsaCount ?? Math.round(lsaRegularCount),
            oshRegularCount: docOshCount ?? docLsaCount ?? Math.round(lsaRegularCount),
            triggerDate: state.company.triggerDate,
            referenceDate: signedAt,
            dueDate: signedAt,
            hasMajorityUnion: state.company.hasMajorityUnion,
            policySettings: state.company.policySettings,
            workerRecord: matchedWorker || undefined,
            alumniRecord: matchedAlumni || undefined,
            personInfo: { ...personPayload, empCode: rawCode || '외부·신규' },
          };

          const unsignedDoc = generateStatutoryDocument(tid, {
            ...baseDocContext,
            signatureInfo: null,
          });
          const unsignedBodySha256 = crypto
            .createHash('sha256')
            .update(unsignedDoc.body)
            .digest('hex');
          const fullDocHashHex = crypto
            .createHash('sha256')
            .update(`${unsignedDoc.body}|${signerName}|${signedAt}|${sigDataUrl}`)
            .digest('hex')
            .toUpperCase();
          const signatureCode = `SIG-${fullDocHashHex.slice(0, 12)}`;

          const genDoc = signNow
            ? generateStatutoryDocument(tid, {
                ...baseDocContext,
                signatureInfo: { signed: true, signerName, signedAt, signatureCode },
              })
            : unsignedDoc;

          // 동일 (사업장, 서식, personKey)의 기존 기록 처리:
          // - signNow=true(서명 확정): 기존 활성 서명본·초안을 모두 superseded=true로 전환해 단일 활성 서명본만 남기고 구 서명본은 불변 보존
          // - signNow=false(초안 저장): 기존 미서명 초안만 갱신하고 기 서명본(signed=true)은 절대 건드리지 않음
          const matchingIndices = [];
          let maxPriorVersion = 0;
          for (let idx = 0; idx < signedDocumentsArchive.length; idx++) {
            const d = signedDocumentsArchive[idx];
            if (
              d.templateId === tid &&
              d.personKey === personKey &&
              (!d.bizRegNo || d.bizRegNo === currentBizRegNo)
            ) {
              maxPriorVersion = Math.max(maxPriorVersion, d.version || 1);
              if (!d.superseded) matchingIndices.push(idx);
            }
          }

          let nextVersion = maxPriorVersion > 0 ? maxPriorVersion + 1 : 1;
          let replaceDraftIdx = -1;
          if (signNow) {
            for (const mIdx of matchingIndices) {
              signedDocumentsArchive[mIdx].superseded = true;
            }
          } else {
            const draftIdx = matchingIndices.find((mIdx) => !signedDocumentsArchive[mIdx].signed);
            if (draftIdx !== undefined) {
              replaceDraftIdx = draftIdx;
              nextVersion = signedDocumentsArchive[draftIdx].version || 1;
            }
          }

          const nextRec = {
            docRecordId:
              replaceDraftIdx >= 0
                ? signedDocumentsArchive[replaceDraftIdx].docRecordId
                : `SDOC-${++signedDocSeq}`,
            version: nextVersion,
            superseded: false,
            bizRegNo: currentBizRegNo,
            personKey,
            personId: boundPersonId,
            templateId: tid,
            templateLabel: templateLabels[tid] || genDoc.title,
            empCode: rawCode || '',
            personName,
            deptName,
            jobTitle,
            hireDate: hireDateRaw,
            maskedBirthOrId,
            maskedPhone,
            address,
            workplaceLocation,
            workStartEnd,
            weeklyHours,
            baseMonthlyPay,
            mealAllowance,
            payloadDigest,
            unsignedBodySha256,
            docBodySha256: fullDocHashHex,
            signed: signNow,
            signerName: signNow ? signerName : '',
            signedAt: signNow ? signedAt : null,
            signatureCode: signNow ? signatureCode : '',
            signatureDataUrl: signNow ? sigDataUrl : '',
            savedBody: genDoc.body,
          };
          if (replaceDraftIdx >= 0) {
            signedDocumentsArchive[replaceDraftIdx] = nextRec;
          } else {
            signedDocumentsArchive.unshift(nextRec);
          }
          savedDocIds.push(nextRec.docRecordId);
        }

        if (matchedWorker && signNow) {
          const prevC = contractSignedMap.get(matchedWorker.empCode) || {
            signed: false,
            signedAt: null,
            employmentContractSigned: false,
            privacyConsentSigned: false,
            ndaPledgeSigned: false,
            nhisAcquired: (matchedWorker.weeklyHours || 40) >= 15,
            eiAcquired: matchedWorker.workerCategory !== 'BIZ_33',
          };
          const empSigned =
            prevC.employmentContractSigned || templateIds.includes('DOC_EMPLOYMENT_CONTRACT');
          const prvSigned =
            prevC.privacyConsentSigned || templateIds.includes('DOC_PRIVACY_CONSENT');
          const ndaSigned =
            prevC.ndaPledgeSigned || templateIds.includes('DOC_NDA_SECURITY_PLEDGE');
          contractSignedMap.set(matchedWorker.empCode, {
            ...prevC,
            signed: empSigned,
            signedAt: empSigned ? signedAt : prevC.signedAt,
            employmentContractSigned: empSigned,
            privacyConsentSigned: prvSigned,
            ndaPledgeSigned: ndaSigned,
          });
        }

        appendAudit(
          '인사서식·전자서명',
          `[${personName}${rawCode ? ` (${rawCode})` : ''}] 서식 ${templateIds.length}종 개인정보 반영 및 ${signNow ? '전자서명 완료' : '초안 저장'}`
        );
        return {
          message: `[${personName}] 서식 ${templateIds.length}종에 개인정보가 자동 기입되고 ${signNow ? '전자서명이 완료·보관되었습니다.' : '작성 내역에 저장되었습니다.'}`,
          savedDocIds,
          personKey,
          personName,
          empCode: rawCode,
        };
      }

      case 'TOGGLE_LIST_ITEM_CHECK': {
        const groupKey = String(actionPayload.groupKey || '').trim().slice(0, 40);
        const itemId = String(actionPayload.itemId || '').trim().slice(0, 80);
        if (!groupKey || !itemId) throw badRequest('groupKey 및 itemId가 필요합니다.');
        if (actionPayload.checked !== undefined && typeof actionPayload.checked !== 'boolean') {
          throw badRequest('checked 값은 boolean이어야 합니다.');
        }
        const k = `${groupKey}:${itemId}`;
        const cur = listItemMarks.get(k) || { checked: false, starred: false };
        const nextChecked =
          actionPayload.checked !== undefined ? actionPayload.checked : !cur.checked;
        listItemMarks.set(k, { ...cur, checked: nextChecked });
        return { message: '' };
      }

      case 'TOGGLE_LIST_ITEM_STAR': {
        const groupKey = String(actionPayload.groupKey || '').trim().slice(0, 40);
        const itemId = String(actionPayload.itemId || '').trim().slice(0, 80);
        if (!groupKey || !itemId) throw badRequest('groupKey 및 itemId가 필요합니다.');
        if (actionPayload.starred !== undefined && typeof actionPayload.starred !== 'boolean') {
          throw badRequest('starred 값은 boolean이어야 합니다.');
        }
        const k = `${groupKey}:${itemId}`;
        const cur = listItemMarks.get(k) || { checked: false, starred: false };
        const nextStarred =
          actionPayload.starred !== undefined ? actionPayload.starred : !cur.starred;
        listItemMarks.set(k, { ...cur, starred: nextStarred });
        return { message: '' };
      }

      case 'TOGGLE_LIST_GROUP_CHECK': {
        const groupKey = String(actionPayload.groupKey || '').trim().slice(0, 40);
        const itemIds = Array.isArray(actionPayload.itemIds) ? actionPayload.itemIds : [];
        if (!groupKey) throw badRequest('groupKey가 필요합니다.');
        if (itemIds.length > 500) throw badRequest('항목 수가 허용 범위를 초과했습니다.');
        if (typeof actionPayload.checked !== 'boolean') {
          throw badRequest('checked 값은 boolean이어야 합니다.');
        }
        for (const rawId of itemIds) {
          const cleanId = String(rawId || '').trim().slice(0, 80);
          if (!cleanId) continue;
          const k = `${groupKey}:${cleanId}`;
          const cur = listItemMarks.get(k) || { checked: false, starred: false };
          listItemMarks.set(k, { ...cur, checked: actionPayload.checked });
        }
        return { message: '' };
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
        rosterDossier.recordAssignmentChange(
          w.empCode,
          orderLabel,
          `${prevDept} · ${prevTitle} → ${afterSummary}`,
          state.company.referenceDate || '2026-11-15'
        );
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
        for (const key of Array.from(dailyAttendanceMap.keys())) {
          if (key.startsWith(`${empCode}|`)) {
            dailyAttendanceMap.delete(key);
          }
        }
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

      case 'TOGGLE_WORKER_CHECK': {
        const empCode = String(actionPayload.empCode || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 직원을 찾을 수 없습니다.');
        if (actionPayload.checked !== undefined && typeof actionPayload.checked !== 'boolean') {
          throw badRequest('checked 값은 boolean이어야 합니다.');
        }
        w.checked = actionPayload.checked !== undefined ? actionPayload.checked : !w.checked;
        return { message: '' };
      }

      case 'TOGGLE_ALL_WORKER_CHECK': {
        if (typeof actionPayload.checked !== 'boolean') {
          throw badRequest('checked 값은 boolean이어야 합니다.');
        }
        const subsetCodes = Array.isArray(actionPayload.empCodes)
          ? new Set(actionPayload.empCodes.map((c) => String(c || '').trim()))
          : null;
        for (const w of state.workers) {
          if (!subsetCodes || subsetCodes.has(w.empCode)) {
            w.checked = actionPayload.checked;
          }
        }
        return { message: '' };
      }

      case 'TOGGLE_WORKER_STAR': {
        const empCode = String(actionPayload.empCode || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 직원을 찾을 수 없습니다.');
        if (actionPayload.starred !== undefined && typeof actionPayload.starred !== 'boolean') {
          throw badRequest('starred 값은 boolean이어야 합니다.');
        }
        w.starred = actionPayload.starred !== undefined ? actionPayload.starred : !w.starred;
        return { message: '' };
      }

      case 'SET_ATTENDANCE_MONTH': {
        const ym = String(actionPayload.yearMonth || '').trim();
        if (!isValidYearMonth(ym)) {
          throw badRequest('유효한 귀속 연월(YYYY-MM)을 입력해 주세요.');
        }
        selectedYearMonth = ym;
        return { message: '' };
      }

      case 'SET_DAILY_ATTENDANCE': {
        const empCode = String(actionPayload.empCode || '').trim();
        const date = String(actionPayload.date || '').trim();
        if (!isValidIsoDate(date)) {
          throw badRequest('유효한 근무일자(YYYY-MM-DD)가 필요합니다.');
        }
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 직원을 찾을 수 없습니다.');
        if (w.workerCategory === 'BIZ_33') {
          throw badRequest('3.3% 사업소득 계약자는 출퇴근 시간 통제 대상이 아닙니다.');
        }
        const payrollYm = (state.company.referenceDate || '2026-11-15').slice(0, 7);
        const ym = date.slice(0, 7);
        selectedYearMonth = ym;
        const allowedStatus = ['AUTO', 'WORK', 'HOLIDAY_WORK', 'LEAVE', 'HALF_LEAVE', 'OFF'];
        const requestedStatus = String(actionPayload.workStatus || 'WORK').trim();
        if (!allowedStatus.includes(requestedStatus)) {
          throw badRequest('유효하지 않은 근무 구분(workStatus)입니다.');
        }

        const pubHoliday = getKoreanStatutoryHolidayName(date);
        const wd = getUtcWeekday(date);
        const dayNum = Number(date.slice(8, 10));
        const memo = String(actionPayload.memo ?? '').trim().slice(0, 80);
        const dayMap = ensureWorkerMonthCalendar(w, ym, payrollYm);

        // 출근~퇴근 시각 기반 연장(>8h) · 야간(22:00~07:00) · 법정공휴일 휴일근로 자동 판정 모드
        const shouldAutoClassify =
          actionPayload.autoClassify === true || requestedStatus === 'AUTO';

        if (
          shouldAutoClassify &&
          requestedStatus !== 'OFF' &&
          requestedStatus !== 'LEAVE' &&
          requestedStatus !== 'HALF_LEAVE'
        ) {
          const autoRes = computeAutoClassifiedShift({
            date,
            clockIn: actionPayload.clockIn || '09:00',
            clockOut: actionPayload.clockOut || '18:00',
            breakHours: actionPayload.breakHours,
            customHoliday:
              requestedStatus === 'HOLIDAY_WORK' || actionPayload.customHoliday === true,
            nightEndHour: 7,
          });
          const statusLabel =
            autoRes.workStatus === 'HOLIDAY_WORK'
              ? autoRes.holidayName
                ? `휴일근로(${autoRes.holidayName})`
                : '휴일근로'
              : autoRes.overtimeHours > 0 && autoRes.nightHours > 0
                ? '연장·야간'
                : autoRes.overtimeHours > 0
                  ? '연장근무'
                  : autoRes.nightHours > 0
                    ? '야간근무'
                    : '정상근무';

          dayMap.set(date, {
            date,
            day: dayNum,
            weekday: WEEKDAY_KO[wd],
            weekdayIdx: wd,
            workStatus: autoRes.workStatus,
            statusLabel,
            clockIn: autoRes.clockIn,
            clockOut: autoRes.clockOut,
            breakHours: autoRes.breakHours,
            normalHours: autoRes.normalHours,
            overtimeHours: autoRes.overtimeHours,
            nightHours: autoRes.nightHours,
            holidayHours: autoRes.holidayHours,
            holidayName: autoRes.holidayName,
            isStatutoryHoliday: autoRes.isStatutoryHoliday,
            autoOvertime: autoRes.autoOvertime,
            autoNight: autoRes.autoNight,
            autoHoliday: autoRes.autoHoliday,
            memo,
          });

          recalculateWorkerFromCalendar(w, ym, dayMap, payrollYm);
          const autoChecks = [];
          if (autoRes.autoHoliday) {
            autoChecks.push(
              autoRes.holidayGt8Hours > 0
                ? `휴일 ${autoRes.holidayHours}h(8h초과 ${autoRes.holidayGt8Hours}h)`
                : `휴일 ${autoRes.holidayHours}h`
            );
          }
          if (autoRes.overtimeHours > 0) autoChecks.push(`8h초과 연장 ${autoRes.overtimeHours}h`);
          if (autoRes.autoNight) autoChecks.push(`야간(22~07시) ${autoRes.nightHours}h`);
          appendAudit(
            'M4자동시간판정',
            `[${empCode} ${w.displayName}] ${date} (${autoRes.clockIn}~${autoRes.clockOut}) 자동분류(${autoChecks.join(' · ') || `정상 ${autoRes.normalHours}h`}) → 급여명세서 연동`
          );
          return {
            message: `[${w.displayName}] ${date} (${autoRes.clockIn}~${autoRes.clockOut}) 출퇴근 기록이 자동 판정(${autoChecks.join(' · ') || `정상 ${autoRes.normalHours}h`})되어 반영되었습니다.`,
          };
        }

        const workStatus = requestedStatus === 'AUTO' ? 'WORK' : requestedStatus;
        const normalHours =
          actionPayload.normalHours === undefined
            ? workStatus === 'OFF' || workStatus === 'HOLIDAY_WORK'
              ? 0
              : workStatus === 'HALF_LEAVE'
                ? (w.dailyHours || 8) / 2
                : w.dailyHours || 8
            : assertBoundedFiniteNumber(actionPayload.normalHours, 'normalHours', 0, 16);
        const overtimeHours =
          actionPayload.overtimeHours === undefined
            ? 0
            : assertBoundedFiniteNumber(actionPayload.overtimeHours, 'overtimeHours', 0, 16);
        const nightHours =
          actionPayload.nightHours === undefined
            ? 0
            : assertBoundedFiniteNumber(actionPayload.nightHours, 'nightHours', 0, 16);
        const holidayHours =
          actionPayload.holidayHours === undefined
            ? 0
            : assertBoundedFiniteNumber(actionPayload.holidayHours, 'holidayHours', 0, 16);

        const isOffOrFullLeave = workStatus === 'OFF' || workStatus === 'LEAVE';
        const effectiveNorm =
          workStatus === 'OFF' || workStatus === 'HOLIDAY_WORK' ? 0 : Number(normalHours.toFixed(1));
        const effectiveOt = isOffOrFullLeave ? 0 : Number(overtimeHours.toFixed(1));
        const effectiveHol = workStatus === 'HOLIDAY_WORK' ? Number(holidayHours.toFixed(1)) : 0;
        const effectiveNight = isOffOrFullLeave ? 0 : Number(nightHours.toFixed(1));
        const totalActiveHours = effectiveNorm + effectiveOt + effectiveHol;
        if (totalActiveHours > 24) {
          throw badRequest('1일 총 근로시간 합계는 24시간을 초과할 수 없습니다.');
        }
        if (effectiveNight > totalActiveHours) {
          throw badRequest('야간근로 시간은 당일 실근로시간 합계를 초과할 수 없습니다.');
        }

        const clockInRaw = String(actionPayload.clockIn ?? '').trim();
        const clockOutRaw = String(actionPayload.clockOut ?? '').trim();
        const hhmmRe = /^([01]\d|2[0-3]):[0-5]\d$/;
        const finalClockIn = isOffOrFullLeave ? '-' : clockInRaw || '09:00';
        const finalClockOut = isOffOrFullLeave ? '-' : clockOutRaw || '18:00';
        if (!isOffOrFullLeave && (!hhmmRe.test(finalClockIn) || !hhmmRe.test(finalClockOut))) {
          throw badRequest('출근·퇴근 시각은 HH:MM(00:00~23:59) 형식이어야 합니다.');
        }

        const statusLabelMap = {
          WORK: effectiveOt > 0 ? '연장근무' : '정상근무',
          HOLIDAY_WORK: pubHoliday ? `휴일근로(${pubHoliday})` : '휴일근무',
          LEAVE: '연차휴가',
          HALF_LEAVE: '반차휴가',
          OFF: pubHoliday || '휴무',
        };
        dayMap.set(date, {
          date,
          day: dayNum,
          weekday: WEEKDAY_KO[wd],
          weekdayIdx: wd,
          workStatus,
          statusLabel: statusLabelMap[workStatus],
          clockIn: finalClockIn,
          clockOut: finalClockOut,
          breakHours: isOffOrFullLeave ? 0 : totalActiveHours >= 8 ? 1 : totalActiveHours >= 4 ? 0.5 : 0,
          normalHours: effectiveNorm,
          overtimeHours: effectiveOt,
          nightHours: effectiveNight,
          holidayHours: effectiveHol,
          holidayName: pubHoliday || (wd === 0 ? '주휴일' : null),
          isStatutoryHoliday: Boolean(pubHoliday),
          autoOvertime: effectiveOt > 0 || effectiveHol > 8,
          autoNight: effectiveNight > 0,
          autoHoliday: effectiveHol > 0,
          memo,
        });

        recalculateWorkerFromCalendar(w, ym, dayMap, payrollYm);
        appendAudit(
          'M4월간캘린더',
          `[${empCode} ${w.displayName}] ${date} 근태(${statusLabelMap[workStatus]} · 정상 ${effectiveNorm}h · 연장 ${effectiveOt}h · 휴일 ${effectiveHol}h) 기록 → 급여명세서 연동`
        );
        return {
          message:
            ym === payrollYm
              ? `[${w.displayName}] ${date} 근태 기록이 저장되어 급여 대장 및 급여 명세서에 즉시 반영되었습니다.`
              : `[${w.displayName}] ${date} (${ym} 귀속) 근태 캘린더 기록이 저장되었습니다.`,
        };
      }

      case 'ADD_LEAVE_USAGE': {
        if (lsaRegularCount < 5) {
          throw badRequest('상시 5인 미만 사업장은 법정 연차유급휴가 의무 대상이 아닙니다.');
        }
        const empCode = String(actionPayload.empCode || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 직원을 찾을 수 없습니다.');
        if (w.workerCategory === 'DAILY' || w.workerCategory === 'BIZ_33') {
          throw badRequest('일용직 또는 3.3% 사업소득 계약자는 상용 연차휴가 기록 대상이 아닙니다.');
        }
        const appliedAt = String(actionPayload.appliedAt || '').trim();
        const useDate = String(actionPayload.useDate || '').trim();
        if (!isValidIsoDate(appliedAt) || !isValidIsoDate(useDate)) {
          throw badRequest('유효한 연차 신청일(appliedAt)과 사용일(useDate)을 입력해 주세요.');
        }
        if (appliedAt > useDate) {
          throw badRequest('연차 신청일은 사용일보다 늦을 수 없습니다.');
        }
        const days = assertBoundedFiniteNumber(actionPayload.days, 'days', 0.5, 10);
        if ((days * 2) % 1 !== 0) {
          throw badRequest('연차 사용일수는 0.5일(반차) 단위로 입력해 주세요.');
        }
        const refDate = state.company.referenceDate || '2026-11-15';
        const payrollYm = refDate.slice(0, 7);
        const statutory = computeStatutoryAnnualLeaveDays(
          w.hireDate || '2023-03-02',
          refDate,
          state.company.policySettings
        );
        const records = getWorkerLeaveRecords(w);
        const currentUsed = Number(
          records.reduce((s, r) => s + (Number(r.days) || 0), 0).toFixed(1)
        );
        const remainingBefore = Math.max(0, Number((statutory.accruedDays - currentUsed).toFixed(1)));
        if (currentUsed + days > statutory.accruedDays) {
          throw badRequest(
            `잔여 연차(${remainingBefore}일)를 초과하여 ${days}일 연차를 등록할 수 없습니다.`
          );
        }

        const coveredDates = expandLeaveRecordDates({ useDate, days });
        if (coveredDates.length === 0) {
          throw badRequest('연차 사용 대상 일자를 산정할 수 없습니다.');
        }
        const existingDateSet = new Set();
        for (const r of records) {
          for (const s of expandLeaveRecordDates(r)) {
            existingDateSet.add(s.date);
          }
        }
        const conflictSlot = coveredDates.find((s) => existingDateSet.has(s.date));
        if (conflictSlot) {
          throw badRequest(`이미 ${conflictSlot.date} 일자에 등록된 연차 기록이 있습니다.`);
        }

        const leaveType = String(
          actionPayload.leaveType || (days === 0.5 ? '반차(0.5일)' : `연차(${days}일)`)
        )
          .trim()
          .slice(0, 40);
        const reason = String(actionPayload.reason || '연차 사용').trim().slice(0, 80);

        const recordId = `LV-${++leaveSeq}`;
        records.push({
          recordId,
          appliedAt,
          useDate,
          days,
          leaveType,
          reason,
          coveredDates,
        });
        const totalUsed = Number(records.reduce((s, r) => s + (Number(r.days) || 0), 0).toFixed(1));
        const prevMeta = leaveUsageMap.get(empCode) || { usedDays: 0, promoStage: 'NONE' };
        leaveUsageMap.set(empCode, { ...prevMeta, usedDays: totalUsed });

        // 근태 캘린더에 모든 사용일(다일 연차 포함) 반영 + 삭제 시 복원용 원본 스냅샷 백업
        const dailyH = w.dailyHours || 8;
        const backupEntries = [];
        const touchedMonths = new Set();
        for (const slot of coveredDates) {
          const slotYm = slot.date.slice(0, 7);
          const dayMap = ensureWorkerMonthCalendar(w, slotYm, payrollYm);
          const prevEntry = dayMap.get(slot.date);
          if (prevEntry) {
            backupEntries.push({
              ym: slotYm,
              date: slot.date,
              entry: structuredClone(prevEntry),
            });
          }
          const wd = getUtcWeekday(slot.date);
          const isHalf = slot.dayFraction < 1;
          dayMap.set(slot.date, {
            date: slot.date,
            day: Number(slot.date.slice(8, 10)),
            weekday: WEEKDAY_KO[wd],
            weekdayIdx: wd,
            workStatus: isHalf ? 'HALF_LEAVE' : 'LEAVE',
            statusLabel: isHalf ? '반차휴가' : '연차휴가',
            clockIn: isHalf ? '09:00' : '-',
            clockOut: isHalf ? '13:00' : '-',
            normalHours: isHalf ? Number((dailyH / 2).toFixed(1)) : dailyH,
            overtimeHours: 0,
            nightHours: 0,
            holidayHours: 0,
            memo: `${leaveType} (신청 ${appliedAt})`,
          });
          touchedMonths.add(slotYm);
        }
        leavePrevCalendarBackup.set(recordId, backupEntries);
        for (const touchedYm of touchedMonths) {
          recalculateWorkerFromCalendar(w, touchedYm, ensureWorkerMonthCalendar(w, touchedYm, payrollYm), payrollYm);
        }

        appendAudit(
          'M5연차기록',
          `[${empCode} ${w.displayName}] 연차 신청(${appliedAt}) · 사용(${useDate}, ${days}일) 등록 → 근태캘린더·급여명세서 동기화`
        );
        return {
          message: `[${w.displayName}] 연차 기록(신청일 ${appliedAt} · 사용일 ${useDate} · ${days}일)이 저장되어 근태 캘린더와 급여 명세서에 반영되었습니다.`,
        };
      }

      case 'DELETE_LEAVE_USAGE': {
        const empCode = String(actionPayload.empCode || '').trim();
        const recordId = String(actionPayload.recordId || '').trim();
        const w = state.workers.find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 직원을 찾을 수 없습니다.');
        const records = getWorkerLeaveRecords(w);
        const idx = records.findIndex((r) => r.recordId === recordId);
        if (idx < 0) throw badRequest('삭제할 연차 기록을 찾을 수 없습니다.');
        const [removed] = records.splice(idx, 1);
        const totalUsed = Number(records.reduce((s, r) => s + (Number(r.days) || 0), 0).toFixed(1));
        const prevMeta = leaveUsageMap.get(empCode) || { usedDays: 0, promoStage: 'NONE' };
        leaveUsageMap.set(empCode, { ...prevMeta, usedDays: totalUsed });

        const payrollYm = (state.company.referenceDate || '2026-11-15').slice(0, 7);
        const touchedMonths = new Set();
        const backedUp = leavePrevCalendarBackup.get(recordId);
        if (backedUp && backedUp.length > 0) {
          for (const item of backedUp) {
            const key = `${empCode}|${item.ym}`;
            if (dailyAttendanceMap.has(key)) {
              dailyAttendanceMap.get(key).set(item.date, structuredClone(item.entry));
              touchedMonths.add(item.ym);
            }
          }
          leavePrevCalendarBackup.delete(recordId);
        } else {
          for (const slot of expandLeaveRecordDates(removed)) {
            const slotYm = slot.date.slice(0, 7);
            const key = `${empCode}|${slotYm}`;
            if (dailyAttendanceMap.has(key)) {
              const dayMap = dailyAttendanceMap.get(key);
              const wd = getUtcWeekday(slot.date);
              const isWeekday = wd >= 1 && wd <= 5;
              const dailyH = w.dailyHours || 8;
              dayMap.set(slot.date, {
                date: slot.date,
                day: Number(slot.date.slice(8, 10)),
                weekday: WEEKDAY_KO[wd],
                weekdayIdx: wd,
                workStatus: isWeekday ? 'WORK' : 'OFF',
                statusLabel: isWeekday ? '정상근무' : '휴무',
                clockIn: isWeekday ? '09:00' : '-',
                clockOut: isWeekday ? (dailyH <= 4 ? '13:00' : '18:00') : '-',
                normalHours: isWeekday ? dailyH : 0,
                overtimeHours: 0,
                nightHours: 0,
                holidayHours: 0,
                memo: '',
              });
              touchedMonths.add(slotYm);
            }
          }
        }
        for (const touchedYm of touchedMonths) {
          recalculateWorkerFromCalendar(w, touchedYm, ensureWorkerMonthCalendar(w, touchedYm, payrollYm), payrollYm);
        }

        appendAudit(
          'M5연차삭제',
          `[${empCode} ${w.displayName}] 연차 기록(${removed.useDate}, ${removed.days}일) 취소 반영`
        );
        return {
          message: `[${w.displayName}] ${removed.useDate} 연차 기록이 취소되어 잔여 연차와 캘린더에 반영되었습니다.`,
        };
      }

      default: {
        const rosterRes = rosterDossier.applyAction(actionPayload, {
          state,
          payrollLocked,
          workerProfileExtrasMap,
          contractSignedMap,
          appendAudit,
          tombstoneStore,
        });
        if (rosterRes !== null) return rosterRes;
        const govRes = statutoryGovernance.applyAction(actionPayload, { state, appendAudit });
        if (govRes !== null) return govRes;
        const evalRes = evalRewardStudio.applyAction(actionPayload, { state, evalGradeMap, appendAudit });
        if (evalRes !== null) return evalRes;
        throw badRequest(`지원하지 않는 관리 액션(${actionType})입니다.`);
      }
    }
  }

  function buildStandaloneEvalPackage({ company, workers, payrollLines, compliance, offboardedSummary }) {
    const view = buildView({ company, workers, payrollLines, compliance, offboardedSummary });
    return buildStandaloneClientPackage({
      studioView: view.evaluationAndReward.studio,
      company,
      evalBoard: view.evaluationAndReward.board,
    });
  }

  return Object.freeze({
    buildView,
    applyAction,
    buildStandaloneEvalPackage,
    inspectPublicSignTarget: statutoryGovernance.inspectPublicSignTarget,
    submitPublicSignTarget: statutoryGovernance.submitPublicSignTarget,
    resetManualScaleOverrides: statutoryGovernance.resetManualScaleOverrides,
    scrubPurgedPerson,
    invalidateWorkerCalendar,
    resetForNewRoster,
    exportPersistenceState,
    restorePersistenceState,
    getArchivedDocById,
    findMatchingSignedDoc,
  });
}
