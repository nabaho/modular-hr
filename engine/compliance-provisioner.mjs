/**
 * 사업장 상시근로자 수 다중 산정기 및 규모×업종별 노동법 의무 자동 프로비저닝 엔진
 */

import { INDUSTRIES, LAW_BASELINE, MODULE_CATALOG } from './labor-rules.mjs?v=1c398065676d';

const SCALE_THRESHOLDS = Object.freeze([5, 10, 30, 50, 100, 300, 500, 1000]);

export const VALID_STATUTORY_TASK_IDS = Object.freeze([
  'TASK_CONTRACT_PAYSLIP',
  'TASK_5PLUS_GUARDRAIL',
  'TASK_WORK_RULES_10',
  'TASK_LMC_30_REPORT',
  'TASK_OSH_50_OFFICER',
  'TASK_OSH_100_REG',
  'TASK_DISABILITY_REPORT',
  'TASK_EMPLOYMENT_DISCLOSURE_300',
]);

function toNonNegativeNumber(val, fallback = 0, label = 'number') {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (typeof val === 'boolean' || !Number.isFinite(n) || n < 0) {
    const err = new RangeError(`${label} 필드는 0 이상의 유한한 숫자여야 합니다 (${String(val)}).`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function toNonNegativeInteger(val, fallback = 0, label = 'count') {
  if (val === null || val === undefined || val === '') return fallback;
  const n = toNonNegativeNumber(val, fallback, label);
  if (!Number.isInteger(n)) {
    const err = new RangeError(`${label} 필드는 0 이상의 정수여야 합니다 (${String(val)}).`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function toPositiveInteger(val, fallback = 22, label = 'operatingDays') {
  if (val === null || val === undefined || val === '') return fallback;
  const n = toNonNegativeInteger(val, fallback, label);
  if (n < 1) {
    const err = new RangeError(`${label} 필드는 1 이상의 정수여야 합니다 (${String(val)}).`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * 실제 달력에 존재하는 YYYY-MM-DD 날짜인지 검증 (예: 2026-02-31, 2026-99-99 차단)
 */
export function isValidIsoDate(isoDate) {
  if (typeof isoDate !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function assertValidIsoDate(isoDate, label = 'date') {
  if (!isValidIsoDate(isoDate)) {
    const err = new RangeError(`유효하지 않은 날짜 형식 또는 존재하지 않는 달력 일자입니다 (${label}: ${String(isoDate)})`);
    err.statusCode = 400;
    throw err;
  }
  return isoDate.trim();
}

export function addDaysISO(isoDate, days) {
  const valid = assertValidIsoDate(isoDate, 'baseDate');
  const [y, m, d] = valid.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

export function diffDaysISO(fromIso, toIso) {
  const validFrom = assertValidIsoDate(fromIso, 'fromDate');
  const validTo = assertValidIsoDate(toIso, 'toDate');
  const a = new Date(`${validFrom}T00:00:00Z`);
  const b = new Date(`${validTo}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * 기준일(referenceDate) 대비 아직 지나지 않은 가장 가까운 연례 법정 마감일(MM-DD) 반환
 * 예: referenceDate가 2026-01-10이고 monthDay가 '01-31'이면 '2026-01-31',
 *     referenceDate가 2026-11-15이고 monthDay가 '01-31'이면 '2027-01-31' 반환
 */
export function nextAnnualDeadline(referenceDate, monthDay) {
  const validRef = assertValidIsoDate(referenceDate, 'referenceDate');
  const year = Number(validRef.slice(0, 4));
  const thisYearCandidate = `${year}-${monthDay}`;
  if (thisYearCandidate >= validRef) {
    return thisYearCandidate;
  }
  return `${year + 1}-${monthDay}`;
}

function truncateTwoDecimals(value) {
  return Math.floor((value + 1e-12) * 100) / 100;
}

/**
 * 1. 법령별 상시근로자 수 동시 산정 (근로기준법 / 산업안전보건법 / 장애인고용법)
 * - 반올림으로 인한 임계치 조기 발동(예: 929.9/31 = 29.9967 -> 30 오판)을 막기 위해
 *   임계치 비교는 정확한 실수 비율(연인원 >= 임계치 * 가동일수)로 판정하고 표시값은 소수 둘째 자리 버림한다.
 */
export function computeRegularHeadcounts(raw = {}) {
  const operatingDays = toPositiveInteger(raw.operatingDays, 22, 'operatingDays');
  const regularWorkers = toNonNegativeInteger(raw.regularWorkers, 0, 'regularWorkers');
  const partTimeWorkers = toNonNegativeInteger(raw.partTimeWorkers, 0, 'partTimeWorkers');
  const dailyWorkerManDays = toNonNegativeNumber(raw.dailyWorkerManDays, 0, 'dailyWorkerManDays');
  const dispatchedWorkers = toNonNegativeInteger(raw.dispatchedWorkers, 0, 'dispatchedWorkers');
  const biz33Contractors = toNonNegativeInteger(raw.biz33Contractors, 0, 'biz33Contractors');
  const shortTermUnder60h = toNonNegativeInteger(raw.shortTermUnder60h, 0, 'shortTermUnder60h');
  const disabledMild = toNonNegativeInteger(raw.disabledMild, 0, 'disabledMild');
  const disabledSevere = toNonNegativeInteger(raw.disabledSevere, 0, 'disabledSevere');

  const hasExplicitManDays =
    raw.explicitCumulativeManDays !== null &&
    raw.explicitCumulativeManDays !== undefined &&
    raw.explicitCumulativeManDays !== '';

  const cumulativeManDays = hasExplicitManDays
    ? toNonNegativeNumber(raw.explicitCumulativeManDays, 0, 'explicitCumulativeManDays')
    : (regularWorkers + partTimeWorkers) * operatingDays + dailyWorkerManDays;

  const exactLsaRatio = cumulativeManDays / operatingDays;
  const lsaRegularCount = truncateTwoDecimals(exactLsaRatio);

  const oshCumulative = cumulativeManDays + dispatchedWorkers * operatingDays;
  const exactOshRatio = oshCumulative / operatingDays;
  const oshRegularCount = truncateTwoDecimals(exactOshRatio);

  const baseEligible = Math.max(0, Math.floor(regularWorkers + partTimeWorkers - shortTermUnder60h));
  const disRegularCount = baseEligible;
  const recognizedDisabledCount = Math.floor(disabledMild + disabledSevere * 2);

  const meetsLsa = (threshold) => cumulativeManDays + 1e-9 >= threshold * operatingDays;
  const meetsOsh = (threshold) => oshCumulative + 1e-9 >= threshold * operatingDays;

  const upcomingThresholdWarnings = [];
  for (const threshold of SCALE_THRESHOLDS) {
    if (!meetsLsa(threshold)) {
      const rawGap = threshold - exactLsaRatio;
      if (rawGap > 0 && rawGap <= 2.5) {
        const displayGap = Math.ceil(rawGap * 100) / 100;
        upcomingThresholdWarnings.push({
          threshold,
          gap: displayGap,
          message: `상시근로자 ${threshold}인 기준까지 약 ${displayGap}명 남았습니다. 추가 채용 시 신규 법정 의무가 발동됩니다.`,
        });
      }
    }
  }

  return {
    operatingDays,
    cumulativeManDays,
    exactLsaRatio,
    exactOshRatio,
    lsaRegularCount,
    oshRegularCount,
    disRegularCount,
    recognizedDisabledCount,
    dispatchedWorkers,
    biz33Contractors,
    is5OrMore: meetsLsa(5),
    is10OrMore: meetsLsa(10),
    is30OrMore: meetsLsa(30),
    is50OrMoreLsa: meetsLsa(50),
    is50OrMoreOsh: meetsOsh(50),
    is100OrMoreOsh: meetsOsh(100),
    is300OrMoreLsa: meetsLsa(300),
    upcomingThresholdWarnings,
  };
}

/**
 * 2. 사업장 규모 × 업종 기반 모듈·규정·신고·정기운영 자동 프로비저닝
 */
export function provisionWorkplaceSystem(config = {}) {
  const industry = INDUSTRIES[config.ksicMajor] || INDUSTRIES.C;
  const referenceDate = assertValidIsoDate(config.referenceDate || '2026-11-15', 'referenceDate');
  const triggerDate = assertValidIsoDate(config.triggerDate || '2026-11-10', 'triggerDate');
  const refYear = Number(referenceDate.slice(0, 4));
  const completedIds = new Set(Array.isArray(config.completedTaskIds) ? config.completedTaskIds : []);
  const headcounts = computeRegularHeadcounts(config.headcountInput || {});
  const historicalPeak = Math.max(
    headcounts.exactLsaRatio,
    toNonNegativeNumber(config.historicalPeakHeadcount, 0)
  );

  const lsaRatio = headcounts.exactLsaRatio;
  const oshRatio = headcounts.exactOshRatio;
  const lsaDisplay = headcounts.lsaRegularCount;
  const oshDisplay = headcounts.oshRegularCount;

  const needsSafetyOfficer =
    industry.oshSafetyOfficerMin !== null && oshRatio + 1e-9 >= industry.oshSafetyOfficerMin;
  const needsHealthOfficer =
    industry.oshHealthOfficerMin !== null && oshRatio + 1e-9 >= industry.oshHealthOfficerMin;
  const needsOshManager =
    industry.oshManagerMin !== null && oshRatio + 1e-9 >= industry.oshManagerMin;
  const needsOshCommittee =
    industry.oshCommitteeMin !== null && oshRatio + 1e-9 >= industry.oshCommitteeMin;
  const needsOshRegulation =
    industry.oshRegulationMin !== null && oshRatio + 1e-9 >= industry.oshRegulationMin;
  const needsFullTimeSafetyOfficer = needsSafetyOfficer && oshRatio + 1e-9 >= 300;

  // 2-1. 4계층 모듈 상태 결정
  const floorPlan = MODULE_CATALOG.map((mod) => {
    let status = 'ACTIVE_REQUIRED';
    let statusLabel = '기본 활성 (필수)';
    let reason = '전 사업장 기본 적용';

    if (mod.id === 'M10_WORK_RULE') {
      if (headcounts.is10OrMore) {
        status = 'AUTO_PROVISIONED';
        statusLabel = '자동 생성됨 (10인+)';
        reason = `상시 ${lsaDisplay}인 ≥ 10인 (근로기준법 제93조 취업규칙 작성·신고 의무)`;
      } else if (historicalPeak >= 10) {
        status = 'SCALE_DOWN_REVIEW';
        statusLabel = '인원감소 검토필요';
        reason = `과거 ${truncateTwoDecimals(historicalPeak)}인 도달 이력 존재 — 기신고 취업규칙 임의 폐지 불가, 노무사 검토 필요`;
      } else {
        status = 'STANDBY';
        statusLabel = '10인 도달 시 자동생성';
        reason = `현재 상시 ${lsaDisplay}인 (10인 미만 신고 의무 면제)`;
      }
    } else if (mod.id === 'M10_LMC') {
      if (headcounts.is30OrMore) {
        status = 'AUTO_PROVISIONED';
        statusLabel = '자동 생성됨 (30인+)';
        reason = `상시 ${lsaDisplay}인 ≥ 30인 (근참법 제4조 노사협의회·고충처리위원 설치 및 분기 운영 의무)`;
      } else if (historicalPeak >= 30) {
        status = 'SCALE_DOWN_REVIEW';
        statusLabel = '인원감소 검토필요';
        reason = `과거 ${truncateTwoDecimals(historicalPeak)}인 도달로 기설치된 노사협의회 유지 여부 노무사 확인 필요`;
      } else {
        status = 'STANDBY';
        statusLabel = '30인 도달 시 자동생성';
        reason = `현재 상시 ${lsaDisplay}인 (30인 이상 진입 시 규정·투표·신고 자동 개설)`;
      }
    } else if (mod.id === 'M10_OSH_DIS') {
      if (needsSafetyOfficer || needsOshCommittee || headcounts.disRegularCount >= 50) {
        status = 'AUTO_PROVISIONED';
        statusLabel = '자동 생성됨 (50인+/업종)';
        reason = `${industry.name} 상시 ${oshDisplay}인 — 안전·보건관리 선임/산안위 및 장애인 의무고용 자동 구축`;
      } else if (historicalPeak >= 50) {
        status = 'SCALE_DOWN_REVIEW';
        statusLabel = '인원감소 검토필요';
        reason = `과거 ${truncateTwoDecimals(historicalPeak)}인 선임 이력 존재 — 해임/변경 전 상시 인원 추이 검토 필요`;
      } else {
        status = 'STANDBY';
        statusLabel = '50인/업종 도달 시 생성';
        reason = `현재 ${industry.name} 상시 ${oshDisplay}인 (임계치 도달 시 자동 활성화)`;
      }
    } else if (mod.id === 'M1_RECRUIT') {
      if (headcounts.is30OrMore) {
        status = 'AUTO_PROVISIONED';
        statusLabel = '공정채용 강제 (30인+)';
        reason = `상시 ${lsaDisplay}인 ≥ 30인 (채용절차법 제4조의3·제11조 강행규정 필터 강제 활성화)`;
      } else {
        status = 'ACTIVE_REQUIRED';
        statusLabel = '기본 활성';
        reason = '채용 공고~입사 이관 파이프라인 가동 중 (30인 도달 시 채용절차법 과태료 가드레일 추가)';
      }
    } else if (mod.id === 'M6_EVAL_REWARD') {
      status = headcounts.is10OrMore ? 'ACTIVE_REQUIRED' : 'OPTIONAL_AVAILABLE';
      statusLabel = headcounts.is10OrMore ? '활성 (보상연동)' : '선택 활성 가능';
      reason = headcounts.is10OrMore
        ? '인사평가 등급·연봉테이블·성과급 급여 직결'
        : '소규모 사업장 간이 연봉갱신 모드 (언제든 전체 기능 전환 가능)';
    } else if (mod.id === 'M7_DISCIPLINE') {
      status = headcounts.is5OrMore ? 'AUTO_PROVISIONED' : 'OPTIONAL_AVAILABLE';
      statusLabel = headcounts.is5OrMore ? '부당해고 방어 활성 (5인+)' : '해고예고 점검 모드';
      reason = headcounts.is5OrMore
        ? '5인 이상 근기법 제23조(정당한 이유)·제27조(서면통지)·제95조(감봉한도) 전면 강제'
        : '5인 미만 근기법 제26조(30일 전 해고예고) 필수 검증 모드';
    }

    return {
      ...mod,
      status,
      statusLabel,
      reason,
    };
  });

  // 2-2. 자동 생성된 행정관청 신고·법정 문서 과제 목록
  const statutoryFilings = [];

  const pushFiling = (item) => {
    const dueDate = item.dueDate;
    const daysLeft = dueDate ? diffDaysISO(referenceDate, dueDate) : null;
    const isCompleted = completedIds.has(item.id);
    let urgency = 'NORMAL';
    if (isCompleted) urgency = 'COMPLETED';
    else if (daysLeft !== null && daysLeft < 0) urgency = 'OVERDUE';
    else if (daysLeft !== null && daysLeft <= 5) urgency = 'CRITICAL';
    else if (daysLeft !== null && daysLeft <= 10) urgency = 'SOON';

    statutoryFilings.push({
      ...item,
      daysLeft,
      isCompleted,
      urgency,
    });
  };

  pushFiling({
    id: 'TASK_CONTRACT_PAYSLIP',
    scaleBadge: '1인+ 필수',
    title: '표준 근로계약서 서면·전자 교부 및 산출식 명시 임금명세서 교부 체계',
    authority: '사업장 자체 비치·교부 (근로감독 상시 점검)',
    dueDate: addDaysISO(triggerDate, 0),
    legalBasis: '근로기준법 제17조, 제48조 제2항 (미교부·기재누락 시 과태료)',
    actionSteps: [
      '입사 시 근로시간·임금 구성항목·휴일·연차 명시 서명 및 사본 교부',
      '매월 급여 지급 시 연장·야간·휴일 계산식이 적힌 임금명세서 교부',
    ],
    docTemplateId: 'DOC_EMPLOYMENT_CONTRACT',
  });

  if (headcounts.is5OrMore) {
    pushFiling({
      id: 'TASK_5PLUS_GUARDRAIL',
      scaleBadge: '5인+ 자동전환',
      title: '연장·야간·휴일 가산수당(50%/100%)·연차유급휴가·중대재해 안전보건 점검 체계 가동',
      authority: '급여엔진 자동적용 / 반기별 경영책임자 점검보존',
      dueDate: addDaysISO(triggerDate, 7),
      legalBasis: '근로기준법 제50·55·56·60조, 중대재해처벌법 제4조',
      actionSteps: [
        '급여 엔진 가산수당 배율 1.5배/2.0배 자동 전환 및 주 52시간 상한 게이지 활성화',
        '반기 1회 이상 중대재해처벌법 안전보건확보의무 이행점검표 작성·보관',
      ],
      docTemplateId: null,
    });
  }

  if (headcounts.is10OrMore) {
    pushFiling({
      id: 'TASK_WORK_RULES_10',
      scaleBadge: '10인+ 의무신고',
      title: '취업규칙 제정 초안 검토 및 관할 지방고용노동관서 신고',
      authority: '관할 지방고용노동청(지청)',
      dueDate: addDaysISO(triggerDate, 14),
      legalBasis: '근로기준법 제93조·제94조 (미작성·미신고 시 500만 원 이하 과태료)',
      actionSteps: [
        '회사 급여·휴가 설정 기반 표준취업규칙 초안 생성 및 법정 필수항목 검토',
        config.hasMajorityUnion === true
          ? '과반수 노동조합 의견청취서(불이익 변경 시 동의서) 징구'
          : '근로자 과반수 의견청취서(불이익 변경 시 과반수 동의서) 징구',
        '취업규칙 신고서 및 의견청취 증빙 첨부 관할 노동청 제출',
      ],
      docTemplateId: 'DOC_WORK_RULES_REPORT',
    });
  }

  if (headcounts.is30OrMore) {
    pushFiling({
      id: 'TASK_LMC_30_REPORT',
      scaleBadge: '30인+ 법정기한 15일',
      title: '노사협의회 설치 · 근로자위원 선출 · 노사협의회 규정 제정 및 신고',
      authority: '관할 지방고용노동청(지청)',
      dueDate: addDaysISO(triggerDate, 15),
      legalBasis: '근로자참여법 제4조·제17조 (설치일로부터 15일 이내 규정 미제출 시 과태료)',
      actionSteps: [
        '노사 동수 위원(각 3~10인) 구성 확정',
        config.hasMajorityUnion === true
          ? '과반수 노동조합의 근로자위원 위촉장 발급'
          : '근로자 직접·비밀·무기명 투표 실시 및 당선 공고',
        '『노사협의회 규정』 제정 의결 및 설치일로부터 15일 이내 노동청 신고서 제출',
        '고충처리위원(3인 이내) 선임 및 고충처리대장(10일 내 결과 통보) 비치',
      ],
      docTemplateId: 'DOC_LMC_REGULATION_AND_FILING',
    });
  }

  if (needsSafetyOfficer || needsHealthOfficer || needsOshManager) {
    const delegationNote = needsFullTimeSafetyOfficer
      ? '상시 300인 이상이므로 안전관리자·보건관리자를 전담 인력으로 선임해야 합니다(위탁 제한).'
      : '상시 50~299인 구간이므로 자체 유자격자 선임 또는 고용노동부 지정 안전·보건관리전문기관 위탁 선임이 가능합니다.';

    pushFiling({
      id: 'TASK_OSH_50_OFFICER',
      scaleBadge: '50인+ 업종 · 기한 14일',
      title: `[${industry.name}] 안전보건관리책임자 · 안전관리자 · 보건관리자 선임 및 보고`,
      authority: '관할 지방고용노동청(지청) 산재예방지도과',
      dueDate: addDaysISO(triggerDate, 14),
      legalBasis: '산업안전보건법 제15조~제19조 (선임일로부터 14일 이내 보고서 제출 의무)',
      actionSteps: [
        '사업장 총괄 안전보건관리책임자 선임장 및 부서별 관리감독자 지정서 발급',
        delegationNote,
        '선임일(또는 위탁계약일)로부터 14일 이내 『안전관리자·보건관리자 선임 등 보고서』 제출',
      ],
      docTemplateId: 'DOC_OSH_OFFICER_APPOINTMENT',
    });
  }

  if (needsOshRegulation) {
    pushFiling({
      id: 'TASK_OSH_100_REG',
      scaleBadge: `${industry.oshRegulationMin}인+ 업종 의무`,
      title: `[${industry.name}] 안전보건관리규정 작성 및 산업안전보건위원회 심의·의결`,
      authority: '사업장 작성·게시 (산안위 심의 필수)',
      dueDate: addDaysISO(triggerDate, 30),
      legalBasis: '산업안전보건법 제25조·제26조 (사유 발생일로부터 30일 이내 작성)',
      actionSteps: [
        '안전보건관리 조직·안전교육·작업장 안전·보건관리·사고조사 조항 규정 초안 작성',
        '산업안전보건위원회 심의·의결 후 사내 게시 및 공지',
      ],
      docTemplateId: 'DOC_OSH_MINUTES',
    });
  }

  if (headcounts.disRegularCount >= 50) {
    pushFiling({
      id: 'TASK_DISABILITY_REPORT',
      scaleBadge: headcounts.disRegularCount >= 100 ? '100인+ 부담금 신고' : '50인+ 고용현황 보고',
      title:
        headcounts.disRegularCount >= 100
          ? '장애인 의무고용(3.1%) 달성 점검 및 장애인고용부담금 신고·납부 일정'
          : '장애인 의무고용(3.1%) 이행 현황 점검 및 연간 고용계획 보고 일정',
      authority: '한국장애인고용공단 (e신고서비스)',
      dueDate: nextAnnualDeadline(referenceDate, '01-31'),
      legalBasis: '장애인고용법 제28조·제29조·제33조 (매년 1월 31일까지 전년도 부담금 신고·납부)',
      actionSteps: [
        '매월 16일·60시간 이상 상시근로자 대비 장애인(중증 2배수) 고용률 집계',
        headcounts.disRegularCount >= 100
          ? '미달 인원 발생 시 월별 부담금 추계 및 연계고용 도급 감면 검토'
          : '향후 100인 진입 전 직무 개발 및 채용 계획 수립',
      ],
      docTemplateId: null,
    });
  }

  if (headcounts.is300OrMoreLsa) {
    pushFiling({
      id: 'TASK_EMPLOYMENT_DISCLOSURE_300',
      scaleBadge: '300인+ 고용형태 공시',
      title: '고용형태 공시제 연례 현황 집계 및 고용24 공시 일정',
      authority: '고용노동부 (고용안정정보망 공시)',
      dueDate: nextAnnualDeadline(referenceDate, '04-30'),
      legalBasis: '고용정책 기본법 제15조의6 (매년 3월 31일 기준 근로자 고용형태를 4월 30일까지 공시)',
      actionSteps: [
        '상용·기간제·단시간·파견·용역·사내하도급 인원 현황 분류표 작성',
        '매년 3월 31일 기준 집계 확정 후 4월 30일 이전 공시 이행 확인',
      ],
      docTemplateId: null,
    });
  }

  // 2-3. 분기별 · 반기별 · 연간 자동 운영 감독 캘린더 생성
  const quarterlySchedule = [
    { quarterNumber: 1, quarter: `${refYear}년 1분기 (1~3월)`, items: [] },
    { quarterNumber: 2, quarter: `${refYear}년 2분기 (4~6월)`, items: [] },
    { quarterNumber: 3, quarter: `${refYear}년 3분기 (7~9월)`, items: [] },
    { quarterNumber: 4, quarter: `${refYear}년 4분기 (10~12월)`, items: [] },
  ];

  for (let q = 0; q < 4; q++) {
    const qNum = q + 1;
    if (oshRatio + 1e-9 >= 5 && (!industry.isSafetyEduExemptUnder50 || oshRatio + 1e-9 >= 50)) {
      quarterlySchedule[q].items.push({
        code: `Q${qNum}_SAFETY_EDU`,
        quarterNumber: qNum,
        category: '안전보건교육',
        title: `${qNum}분기 정기 산업안전보건교육 실시 및 이수자 서명부 보관`,
        detail: `사무직 분기 ${industry.quarterlySafetyEduHoursOffice}시간 이상 / 현장·생산직 분기 ${industry.quarterlySafetyEduHoursField}시간 이상`,
        docTemplateId: null,
      });
    }

    if (headcounts.is30OrMore) {
      quarterlySchedule[q].items.push({
        code: `Q${qNum}_LMC_MEETING`,
        quarterNumber: qNum,
        category: '노사협의회 (30인+)',
        title: `${qNum}분기 노사협의회 정기회의 (개최 7일 전 의제 통보 → 회의록 3년 보존)`,
        detail: '보고사항(경영·인력계획) / 협의사항(생산성·복지·교육) / 의결사항 점검 및 직전 분기 의결 이행 확인',
        docTemplateId: 'DOC_LMC_MINUTES',
      });
    }

    if (needsOshCommittee) {
      quarterlySchedule[q].items.push({
        code: `Q${qNum}_OSH_COMMITTEE`,
        quarterNumber: qNum,
        category: '산업안전보건위원회',
        title: `${qNum}분기 산업안전보건위원회 정기회의 개최 및 결과 사내 공지`,
        detail: '산재예방계획·안전보건교육·유해위험방지·중대재해 원인조사 심의·의결 (산안법 제24조)',
        docTemplateId: 'DOC_OSH_MINUTES',
      });
    }
  }

  quarterlySchedule[0].items.push({
    code: 'Y_JAN_TAX_INS',
    quarterNumber: 1,
    category: '세무·공단 신고',
    title: '연말정산 결과 급여 반영 · 보수총액/지급명세서 마감 점검',
    detail:
      headcounts.disRegularCount >= 50
        ? '1월 31일까지 장애인 고용부담금/고용계획 보고 포함'
        : '원천징수이행상황신고 및 간이지급명세서 대조',
    docTemplateId: null,
  });

  if (headcounts.is5OrMore) {
    quarterlySchedule[1].items.push({
      code: 'H1_CSAP_CHECK',
      quarterNumber: 2,
      category: '중대재해점검 (반기)',
      title: '상반기 중대재해처벌법 안전보건확보의무 이행점검 및 예산집행 확인',
      detail: '유해·위험요인 확인·개선(정기 위험성평가 연동) 및 종사자 의견청취 증빙 보존',
      docTemplateId: 'DOC_OSH_MINUTES',
    });
    quarterlySchedule[2].items.push({
      code: 'Y_LEAVE_PROMO_1',
      quarterNumber: 3,
      category: '연차사용촉진 (제61조)',
      title: '회계연도 기준 연차유급휴가 1차 사용촉진 서면통지 (7월 1일~10일)',
      detail: '미사용 일수 고지 및 사용시기 통보 촉구 (10월 말 2차 사용시기 지정 일정 연계)',
      docTemplateId: null,
    });
    quarterlySchedule[3].items.push({
      code: 'H2_CSAP_AND_PROMO2',
      quarterNumber: 4,
      category: '중대재해·연차촉진 2차',
      title: '하반기 안전보건 의무 이행점검 + 연차 2차 사용시기 지정통보 + 법정의무교육 마감',
      detail: '성희롱예방·개인정보보호·장애인인식개선·퇴직연금 교육 이수 현황 점검',
      docTemplateId: null,
    });
  } else {
    quarterlySchedule[3].items.push({
      code: 'Y_MANDATORY_EDU_SMALL',
      quarterNumber: 4,
      category: '법정의무교육',
      title: '연간 직장 내 성희롱 예방(10인 미만 게시·배포 가능) 및 개인정보보호 점검',
      detail: '교육 자료 배포 확인 기록 보존 및 차년도 최저임금 기준판 점검',
      docTemplateId: null,
    });
  }

  const mandatoryDisabledQuota =
    headcounts.disRegularCount >= 50
      ? Math.floor(headcounts.disRegularCount * LAW_BASELINE.disabilityMandatoryRate)
      : 0;
  const disabilityShortfall = Math.max(0, mandatoryDisabledQuota - headcounts.recognizedDisabledCount);
  const estimatedMonthlyLevy =
    headcounts.disRegularCount >= 100
      ? disabilityShortfall * LAW_BASELINE.disabilityBaseLevyMonthly
      : 0;

  return {
    lawVersion: LAW_BASELINE.versionCode,
    referenceDate,
    triggerDate,
    industry,
    headcounts,
    historicalPeakHeadcount: truncateTwoDecimals(historicalPeak),
    floorPlan,
    statutoryFilings,
    quarterlySchedule,
    oshFlags: {
      needsSafetyOfficer,
      needsHealthOfficer,
      needsOshManager,
      needsOshCommittee,
      needsOshRegulation,
      needsFullTimeSafetyOfficer,
    },
    disabilityCompliance: {
      applicable: headcounts.disRegularCount >= 50,
      levyApplicable: headcounts.disRegularCount >= 100,
      eligibleHeadcount: headcounts.disRegularCount,
      mandatoryQuota: mandatoryDisabledQuota,
      recognizedCount: headcounts.recognizedDisabledCount,
      shortfall: disabilityShortfall,
      estimatedMonthlyLevy,
      estimatedAnnualLevy: estimatedMonthlyLevy * 12,
    },
  };
}
