/**
 * M9 확장: 전 주기 퇴사자 통합 정보관리 원장 (Offboarded / Alumni Lifecycle Registry)
 * - 건강보험·고용보험 상실내역 자동 편입 및 재직자 퇴사 전환을 단일 원장으로 통합 관리한다.
 * - 근로기준법 제36조(14일 금품청산), 건강보험 상실(14일)·고용보험 상실/이직확인서(익월 15일),
 *   고용지원금 감원방지 경보, 근로기준법 제42조(3년 보존 가드레일) 및 개인정보보호법 제21조(만료 후 파기)를 검증한다.
 */

import crypto from './browser-crypto-shim.mjs?v=7df477f6fc75';
import { addDaysISO, assertValidIsoDate, diffDaysISO } from './compliance-provisioner.mjs?v=7df477f6fc75';
import {
  computeMonthlyRefHours,
  computeOffboardingSettlement,
  VALID_RESIGN_REASONS,
} from './lifecycle-payroll.mjs?v=7df477f6fc75';

export function createPurgeTombstoneStore() {
  const secret = crypto.randomBytes(32);
  const empCodeDigests = new Set();
  const personDigests = new Set();

  function hmacHex(payload) {
    return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  }

  function buildEmpPayload(bizRegNo, empCode) {
    const normBiz = String(bizRegNo || '').replace(/[^0-9]/g, '') || '*';
    const normEmp = String(empCode || '').trim().toUpperCase();
    return `${normBiz}::EMP::${normEmp}`;
  }

  function buildPersonPayload(rec = {}) {
    const normBiz = String(rec.bizRegNo || '').replace(/[^0-9]/g, '') || '*';
    const normName = String(rec.displayName || '').replace(/\s+/g, '');
    const id6 = String(rec.maskedBirthOrId || '').match(/(\d{6})/)?.[1] || '';
    const lastDay = String(rec.lastWorkDate || '').trim();
    if (!normName || !lastDay) return null;
    return `${normBiz}::PER::${normName}::${id6}::${lastDay}`;
  }

  function buildHireIdentityPayload(rec = {}) {
    const normBiz = String(rec.bizRegNo || '').replace(/[^0-9]/g, '') || '*';
    const normName = String(rec.displayName || '').replace(/\s+/g, '');
    const id6 = String(rec.maskedBirthOrId || '').match(/(\d{6})/)?.[1] || '';
    const hireDay = String(rec.hireDate || '').trim();
    if (!normName || !id6 || !hireDay) return null;
    return `${normBiz}::HIRE::${normName}::${id6}::${hireDay}`;
  }

  function registerPurgedRecord(rec = {}) {
    let primaryDigest = null;
    if (rec.empCode) {
      primaryDigest = hmacHex(buildEmpPayload(rec.bizRegNo, rec.empCode));
      empCodeDigests.add(primaryDigest);
      empCodeDigests.add(hmacHex(buildEmpPayload('*', rec.empCode)));
    }
    const perPayload = buildPersonPayload(rec);
    if (perPayload) {
      personDigests.add(hmacHex(perPayload));
    }
    const hirePayload = buildHireIdentityPayload(rec);
    if (hirePayload) {
      personDigests.add(hmacHex(hirePayload));
    }
    return primaryDigest;
  }

  function isEmpCodePurged(bizRegNo, empCode) {
    if (!empCode) return false;
    return (
      empCodeDigests.has(hmacHex(buildEmpPayload(bizRegNo, empCode))) ||
      empCodeDigests.has(hmacHex(buildEmpPayload('*', empCode)))
    );
  }

  function isRecordPurged(rec = {}) {
    if (!rec) return false;
    if (rec.empCode && isEmpCodePurged(rec.bizRegNo, rec.empCode)) return true;
    const perPayload = buildPersonPayload(rec);
    if (perPayload && personDigests.has(hmacHex(perPayload))) return true;
    const hirePayload = buildHireIdentityPayload(rec);
    if (hirePayload && personDigests.has(hmacHex(hirePayload))) return true;
    return false;
  }

  return Object.freeze({
    registerPurgedRecord,
    isEmpCodePurged,
    isRecordPurged,
  });
}

const defaultTombstoneStore = createPurgeTombstoneStore();

export function registerPurgedEmpCodeTombstone(bizRegNo, empCode) {
  defaultTombstoneStore.registerPurgedRecord({ bizRegNo, empCode });
}

export function isPurgedEmpCodeTombstone(bizRegNo, empCode) {
  return defaultTombstoneStore.isEmpCodePurged(bizRegNo, empCode);
}

export function getServerTodayISO(nowFn = () => Date.now()) {
  return new Date(nowFn()).toISOString().slice(0, 10);
}

export const RESIGN_REASON_META = Object.freeze({
  VOLUNTARY: Object.freeze({
    code: 'VOLUNTARY',
    eiLossCode: '11',
    label: '개인사정 자진퇴사 (코드 11)',
    unemploymentEligibleHint: '원칙적 수급 제한 (단, 출퇴근 곤란·질병 등 정당한 이직사유 증빙 시 예외)',
  }),
  RECOMMENDED: Object.freeze({
    code: 'RECOMMENDED',
    eiLossCode: '26',
    label: '경영상 필요 · 권고사직 (코드 26)',
    unemploymentEligibleHint: '비자발적 이직 (구직급여 수급 가능 · 사업장 고용지원금 감원방지 주의!)',
  }),
  CONTRACT_END: Object.freeze({
    code: 'CONTRACT_END',
    eiLossCode: '32',
    label: '계약기간 만료 (코드 32)',
    unemploymentEligibleHint: '비자발적 이직 (구직급여 수급 가능 · 지원금 감원방지 예외 사유)',
  }),
  RETIRE_AGE: Object.freeze({
    code: 'RETIRE_AGE',
    eiLossCode: '31',
    label: '정년퇴직 (코드 31)',
    unemploymentEligibleHint: '비자발적 이직 (구직급여 수급 가능)',
  }),
  DISMISSAL: Object.freeze({
    code: 'DISMISSAL',
    eiLossCode: '22',
    label: '징계·통상 해고 (코드 22/26)',
    unemploymentEligibleHint: '중대 귀책사유 외 구직급여 대상 · 서면통지(제27조)·감원방지 중대 경보!',
  }),
});

export function mapEiLossCodeToResignReason(rawCodeOrText = '') {
  const token = String(rawCodeOrText ?? '').trim().toUpperCase();
  if (VALID_RESIGN_REASONS.includes(token)) return token;
  if (/^(26|23-권고)/.test(token) || /권고|구조조정|경영상/.test(token)) return 'RECOMMENDED';
  if (/^(32|23)/.test(token) || /계약\s*만료|기간\s*만료/.test(token)) return 'CONTRACT_END';
  if (/^31/.test(token) || /정년/.test(token)) return 'RETIRE_AGE';
  if (/^(22|45)/.test(token) || /해고|징계/.test(token)) return 'DISMISSAL';
  return 'VOLUNTARY';
}

function addYearsSafeISO(isoDate, years) {
  const validated = assertValidIsoDate(isoDate, 'date');
  const [y, m, d] = validated.split('-').map(Number);
  const targetYear = y + Number(years);
  const candidate = new Date(Date.UTC(targetYear, m - 1, d));
  if (candidate.getUTCMonth() !== m - 1) {
    // 2월 29일 -> 평년 2월 28일 보정
    const febEnd = new Date(Date.UTC(targetYear, m, 0));
    return febEnd.toISOString().slice(0, 10);
  }
  return candidate.toISOString().slice(0, 10);
}

function computeEiNextMonth15ISO(lastWorkDate) {
  const validated = assertValidIsoDate(lastWorkDate, 'lastWorkDate');
  const [y, m] = validated.split('-').map(Number);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-15`;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function conflictError(message, code = 'RETENTION_LOCKED') {
  const err = new Error(message);
  err.statusCode = 409;
  err.code = code;
  return err;
}

/**
 * 퇴사자 통합 원장 단일 레코드 생성 및 법정 기한·퇴직금·보존연한 산출
 */
export function buildOffboardedWorkerRecord(input = {}, context = {}) {
  const referenceDate = assertValidIsoDate(context.referenceDate || '2026-11-15', 'referenceDate');
  const lsaRegularCount = Number(context.lsaRegularCount ?? 50);
  const activeSubsidies = Array.isArray(context.activeSubsidies)
    ? context.activeSubsidies
    : ['청년일자리도약장려금', '고용촉진장려금'];

  const bizRegNo = String(input.bizRegNo || context.bizRegNo || '214-86-00941').trim().slice(0, 20);
  const alumniUid = String(
    input.alumniUid || `ALM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  ).slice(0, 32);
  const empCode = String(input.empCode || 'ALM-001').trim().slice(0, 30);
  const displayName = String(input.displayName || '퇴사근로자').trim().slice(0, 60);
  const deptName = String(input.deptName || '일반부서').trim().slice(0, 60);
  const jobTitle = String(input.jobTitle || '담당').trim().slice(0, 60);
  const maskedBirthOrId = String(input.maskedBirthOrId || '******-*').trim().slice(0, 24);

  const hireDate = assertValidIsoDate(input.hireDate || '2024-03-01', 'hireDate');
  const lastWorkDate = assertValidIsoDate(input.lastWorkDate || '2026-11-05', 'lastWorkDate');
  if (lastWorkDate < hireDate) {
    throw badRequest(`퇴사일(${lastWorkDate})은 입사일(${hireDate})보다 앞설 수 없습니다.`);
  }

  // 건강보험·고용보험 실무상 자격상실일은 마지막 근무일(퇴사일)의 다음 날
  const lossDateReported = input.lossDateReported
    ? assertValidIsoDate(input.lossDateReported, 'lossDateReported')
    : addDaysISO(lastWorkDate, 1);

  const resignReason = mapEiLossCodeToResignReason(input.resignReason || input.eiLossCode || 'VOLUNTARY');
  const reasonMeta = RESIGN_REASON_META[resignReason] || RESIGN_REASON_META.VOLUNTARY;
  const serviceDays = Math.max(1, diffDaysISO(hireDate, lastWorkDate) + 1);

  const weeklyHours = Math.max(1, Number(input.weeklyContractHours ?? input.weeklyHours ?? 40));
  const baseMonthlyPay = Math.max(0, Number(input.baseMonthlyPay ?? 3200000));
  const fixedAllowance = Math.max(0, Number(input.fixedAllowance ?? 0));
  const mealAllowance = Math.max(0, Number(input.mealAllowance ?? 200000));
  const monthlyRefHours = computeMonthlyRefHours(weeklyHours);
  const ordinaryHourlyWage =
    input.ordinaryHourlyWage !== undefined
      ? Number(input.ordinaryHourlyWage)
      : (baseMonthlyPay + fixedAllowance) / monthlyRefHours;

  const monthlyGrossApprox = baseMonthlyPay + fixedAllowance + mealAllowance;
  const threeMonthWageTotal =
    input.threeMonthWageTotal !== undefined
      ? Number(input.threeMonthWageTotal)
      : monthlyGrossApprox * 3;

  const settlement = computeOffboardingSettlement({
    resignReason,
    lastWorkDate,
    serviceDays,
    weeklyHours,
    threeMonthWageTotal,
    threeMonthDays: input.threeMonthDays ?? 91,
    annualBonusTotal: Number(input.annualBonusTotal ?? 0),
    ordinaryHourlyWage,
    dailyHours: Math.min(8, weeklyHours / 5 || 8),
    unusedLeaveDays: Number(input.unusedLeaveDays ?? 0),
    lsaRegularCount,
    activeSubsidies,
    advanceNoticeDaysGiven: Number(input.advanceNoticeDaysGiven ?? 30),
    writtenDismissalNoticeGiven: input.writtenDismissalNoticeGiven !== false,
  });

  const nhisLossDueDate = addDaysISO(lossDateReported, 14);
  const eiLossDueDate = computeEiNextMonth15ISO(lastWorkDate);
  const retentionExpiresOn = addYearsSafeISO(lastWorkDate, 3);

  const record = {
    alumniUid,
    personId: input.personId || null,
    bizRegNo,
    empCode,
    displayName,
    deptName,
    jobTitle,
    maskedBirthOrId,
    hireDate,
    lastWorkDate,
    lossDateReported,
    resignReason,
    resignReasonLabel: reasonMeta.label,
    eiLossCode: String(input.eiLossCode || reasonMeta.eiLossCode),
    unemploymentEligibleHint: reasonMeta.unemploymentEligibleHint,
    serviceDays,
    weeklyContractHours: weeklyHours,
    baseMonthlyPay,
    mealAllowance,
    eligibleForSeverance: settlement.eligibleForSeverance,
    ordinaryFloorApplied: settlement.ordinaryFloorApplied,
    appliedDailyWage: settlement.appliedDailyWage,
    severancePay: settlement.severancePay,
    unusedLeaveDays: Number(input.unusedLeaveDays ?? 0),
    unusedLeavePayout: settlement.unusedLeavePayout,
    dismissalNoticePay: settlement.dismissalNoticePay,
    totalSettlementGross: settlement.totalSettlementGross,
    settlementDueDate: settlement.paymentDueDate,
    settlementStatus: input.settlementStatus === 'PAID' ? 'PAID' : 'PENDING',
    nhisLossDueDate,
    nhisLossFilingStatus: input.nhisLossFilingStatus === 'FILED' ? 'FILED' : 'PENDING',
    eiLossDueDate,
    eiLossAndCertStatus: input.eiLossAndCertStatus === 'FILED' ? 'FILED' : 'PENDING',
    retentionExpiresOn,
    anonymizedAt: input.anonymizedAt || null,
    mobileAccessRevoked: true,
    careerCertIssuedCount: Number(input.careerCertIssuedCount ?? 0),
    ingestionSource: String(input.ingestionSource || 'INSURANCE_LOSS_LEDGER'),
    alerts: settlement.alerts,
    subsidyClawbackRisk: settlement.alerts.some((a) => a.code === 'SUBSIDY_CLAWBACK_RISK'),
  };

  return refreshOffboardedLifecycle(record, referenceDate);
}

/**
 * 기준일(referenceDate) 변경 시 D-Day 및 3년 법정 보존/파기 수명주기 재계산
 * - 이미 비식별 파기(ANONYMIZED_PURGED)된 레코드는 일자 필드가 제거되므로 즉시 안전 반환한다.
 */
export function refreshOffboardedLifecycle(record, referenceDateInput = '2026-11-15') {
  const referenceDate = assertValidIsoDate(referenceDateInput, 'referenceDate');
  if (record.anonymizedAt || record.dataLifecycleStatus === 'ANONYMIZED_PURGED') {
    return {
      ...record,
      settlementDday: null,
      nhisLossDday: null,
      eiLossDday: null,
      retentionDday: -1,
      dataLifecycleStatus: 'ANONYMIZED_PURGED',
    };
  }

  const settlementDday = diffDaysISO(referenceDate, record.settlementDueDate);
  const nhisLossDday = diffDaysISO(referenceDate, record.nhisLossDueDate);
  const eiLossDday = diffDaysISO(referenceDate, record.eiLossDueDate);
  const retentionDday = diffDaysISO(referenceDate, record.retentionExpiresOn);

  let dataLifecycleStatus = 'ACTIVE_RETENTION';
  if (retentionDday < 0) {
    dataLifecycleStatus = 'RETENTION_EXPIRED_PURGE_DUE';
  }

  return {
    ...record,
    settlementDday,
    nhisLossDday,
    eiLossDday,
    retentionDday,
    dataLifecycleStatus,
  };
}

/**
 * 퇴사자 사후관리 이행 상태(14일 금품청산 · 건보 상실 · 고보 상실/이직확인서) 갱신
 */
export function updateOffboardedChecklist(record, patch = {}, referenceDate = '2026-11-15') {
  if (!record) throw badRequest('대상 퇴사자 레코드를 찾을 수 없습니다.');
  if (record.anonymizedAt || record.dataLifecycleStatus === 'ANONYMIZED_PURGED') {
    throw conflictError(
      '이미 비식별 파기 완료된 퇴사자 기록은 상태를 변경할 수 없습니다.',
      'ALREADY_PURGED'
    );
  }

  const next = { ...record };
  if (patch.settlementStatus !== undefined) {
    if (patch.settlementStatus !== 'PENDING' && patch.settlementStatus !== 'PAID') {
      throw badRequest('settlementStatus는 PENDING 또는 PAID여야 합니다.');
    }
    next.settlementStatus = patch.settlementStatus;
  }
  if (patch.nhisLossFilingStatus !== undefined) {
    if (patch.nhisLossFilingStatus !== 'PENDING' && patch.nhisLossFilingStatus !== 'FILED') {
      throw badRequest('nhisLossFilingStatus는 PENDING 또는 FILED여야 합니다.');
    }
    next.nhisLossFilingStatus = patch.nhisLossFilingStatus;
  }
  if (patch.eiLossAndCertStatus !== undefined) {
    if (patch.eiLossAndCertStatus !== 'PENDING' && patch.eiLossAndCertStatus !== 'FILED') {
      throw badRequest('eiLossAndCertStatus는 PENDING 또는 FILED여야 합니다.');
    }
    next.eiLossAndCertStatus = patch.eiLossAndCertStatus;
  }
  if (patch.incrementCareerCert === true) {
    next.careerCertIssuedCount = (Number(next.careerCertIssuedCount) || 0) + 1;
  }

  return refreshOffboardedLifecycle(next, referenceDate);
}

/**
 * 근로기준법 제42조(3년 보존 의무) 가드레일 검증 후 만료된 퇴사자 개인정보 비가역 비식별 파기(개인정보보호법 제21조)
 * - 파기 허용 판단은 시뮬레이션 기준일이 아닌 서버 현재시각(serverTodayInput)을 기준으로 강제한다.
 * - 사번·성명·부서·입퇴사일·보수·정산금액 등 개인 재결합 가능 속성을 모두 제거하고 일방향 파기 토큰으로 대체한다.
 */
export function purgeExpiredOffboardedPii(
  record,
  serverTodayInput = getServerTodayISO(),
  tombstoneStore = defaultTombstoneStore
) {
  if (!record) throw badRequest('대상 퇴사자 레코드를 찾을 수 없습니다.');
  const store = tombstoneStore || defaultTombstoneStore;
  const verifiedToday = assertValidIsoDate(serverTodayInput, 'serverToday');

  if (
    record.anonymizedAt ||
    record.dataLifecycleStatus === 'ANONYMIZED_PURGED' ||
    store.isRecordPurged(record) ||
    store.isEmpCodePurged(record.bizRegNo, record.empCode)
  ) {
    throw conflictError('이미 개인정보 비식별 파기가 완료된 레코드입니다.', 'ALREADY_PURGED');
  }

  const refreshed = refreshOffboardedLifecycle(record, verifiedToday);
  if (refreshed.retentionDday >= 0) {
    throw conflictError(
      `근로기준법 제42조(계약 서류의 보존) 위반 차단: 퇴사일(${refreshed.lastWorkDate})로부터 3년 보존기한(${refreshed.retentionExpiresOn}, 서버시각 ${verifiedToday} 기준 잔여 ${refreshed.retentionDday}일)이 경과하지 않아 파기할 수 없습니다.`,
      'STATUTORY_RETENTION_ACTIVE'
    );
  }

  const purgeTombstoneHmac = store.registerPurgedRecord(refreshed);
  const purgeToken = `PURGED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  return refreshOffboardedLifecycle(
    {
      alumniUid: refreshed.alumniUid || purgeToken,
      personId: null,
      bizRegNo: refreshed.bizRegNo || null,
      empCode: purgeToken,
      purgeTombstoneHmac,
      displayName: '비식별파기완료',
      deptName: '비식별부서',
      jobTitle: '보존만료파기',
      maskedBirthOrId: '******-*',
      hireDate: null,
      lastWorkDate: null,
      lossDateReported: null,
      resignReason: 'PURGED',
      resignReasonLabel: '보존만료 비식별 파기',
      eiLossCode: '-',
      unemploymentEligibleHint: '개인정보보호법 제21조 비식별 파기 완료',
      serviceDays: 0,
      weeklyContractHours: 0,
      baseMonthlyPay: 0,
      mealAllowance: 0,
      eligibleForSeverance: false,
      ordinaryFloorApplied: false,
      appliedDailyWage: 0,
      severancePay: 0,
      unusedLeaveDays: 0,
      unusedLeavePayout: 0,
      dismissalNoticePay: 0,
      totalSettlementGross: 0,
      settlementDueDate: null,
      settlementStatus: 'PURGED',
      nhisLossDueDate: null,
      nhisLossFilingStatus: 'PURGED',
      eiLossDueDate: null,
      eiLossAndCertStatus: 'PURGED',
      retentionExpiresOn: null,
      anonymizedAt: verifiedToday,
      mobileAccessRevoked: true,
      careerCertIssuedCount: 0,
      ingestionSource: 'PURGED_TOMBSTONE',
      alerts: [],
      subsidyClawbackRisk: false,
    },
    verifiedToday
  );
}

/**
 * 멀티문서 재개통 시 퇴사자 원장 병합 및 3년 법정보존·파기 툼스톤 가드레일(근로기준법 제42조 · 개인정보보호법 제21조)
 * - 기존 원장의 3년 보존 대상 레코드가 새 문서 재개통으로 유실·무단삭제되는 것을 원천 차단한다.
 * - 이미 비식별 파기되어 툼스톤(tombstoneStore)에 등록된 인물·사번은 원본 문서 재개통 시에도 개인정보 재생성을 전면 차단한다.
 */
export function mergeOffboardedLedgers(existingRecords = [], incomingRecords = [], options = {}) {
  const store = options.tombstoneStore || defaultTombstoneStore;
  const serverTodayIso = assertValidIsoDate(
    options.serverTodayIso || getServerTodayISO(),
    'serverTodayIso'
  );
  const displayReferenceDate = assertValidIsoDate(
    options.displayReferenceDate || serverTodayIso,
    'displayReferenceDate'
  );

  const filteredIncoming = incomingRecords.filter(
    (inc) => !store.isRecordPurged(inc) && !store.isEmpCodePurged(inc.bizRegNo, inc.empCode)
  );

  if (options.replaceAlumniLedger === true) {
    const activeProtected = existingRecords.find(
      (r) => refreshOffboardedLifecycle(r, serverTodayIso).dataLifecycleStatus === 'ACTIVE_RETENTION'
    );
    if (activeProtected) {
      throw conflictError(
        `근로기준법 제42조 위반 차단: 3년 법정보존 기간이 남아 있는 퇴사자 원장(${activeProtected.empCode}, 만료일 ${activeProtected.retentionExpiresOn})이 존재하여 원장을 덮어쓰거나 삭제할 수 없습니다.`,
        'STATUTORY_RETENTION_ACTIVE'
      );
    }
    const existingTombstones = existingRecords
      .filter((r) => r.dataLifecycleStatus === 'ANONYMIZED_PURGED')
      .map((r) => refreshOffboardedLifecycle(structuredClone(r), displayReferenceDate));
    return [
      ...existingTombstones,
      ...filteredIncoming.map((r) =>
        refreshOffboardedLifecycle(structuredClone(r), displayReferenceDate)
      ),
    ];
  }

  const merged = existingRecords.map((r) =>
    refreshOffboardedLifecycle(structuredClone(r), displayReferenceDate)
  );

  for (const incoming of filteredIncoming) {
    const normBiz = String(incoming.bizRegNo || '').replace(/[^0-9]/g, '');
    const normEmp = String(incoming.empCode || '').trim().toUpperCase();
    const matchIdx = merged.findIndex((ex) => {
      if (ex.dataLifecycleStatus === 'ANONYMIZED_PURGED') return false;
      const exBiz = String(ex.bizRegNo || '').replace(/[^0-9]/g, '');
      const exEmp = String(ex.empCode || '').trim().toUpperCase();
      return (
        exBiz === normBiz &&
        exEmp === normEmp &&
        ex.displayName === incoming.displayName &&
        ex.lastWorkDate === incoming.lastWorkDate
      );
    });

    if (matchIdx >= 0) {
      const prev = merged[matchIdx];
      merged[matchIdx] = refreshOffboardedLifecycle(
        {
          ...structuredClone(incoming),
          alumniUid: prev.alumniUid,
          settlementStatus: prev.settlementStatus === 'PAID' ? 'PAID' : incoming.settlementStatus,
          nhisLossFilingStatus:
            prev.nhisLossFilingStatus === 'FILED' ? 'FILED' : incoming.nhisLossFilingStatus,
          eiLossAndCertStatus:
            prev.eiLossAndCertStatus === 'FILED' ? 'FILED' : incoming.eiLossAndCertStatus,
          careerCertIssuedCount: prev.careerCertIssuedCount || 0,
        },
        displayReferenceDate
      );
    } else {
      merged.push(refreshOffboardedLifecycle(structuredClone(incoming), displayReferenceDate));
    }
  }

  return merged;
}

/**
 * 퇴사자 통합 원장 KPI 요약 집계
 */
export function summarizeOffboardedRegistry(records = [], referenceDate = '2026-11-15') {
  const normalized = records.map((r) => refreshOffboardedLifecycle(r, referenceDate));
  return normalized.reduce(
    (acc, item) => {
      acc.totalAlumniCount += 1;
      if (item.settlementStatus === 'PENDING') {
        acc.pendingSettlementCount += 1;
        acc.pendingSettlementAmount += item.totalSettlementGross;
        if (item.settlementDday !== null && item.settlementDday <= 3) acc.urgentSettlementCount += 1;
      }
      if (item.nhisLossFilingStatus === 'PENDING' || item.eiLossAndCertStatus === 'PENDING') {
        acc.pendingInsuranceLossCount += 1;
      }
      if (item.subsidyClawbackRisk) {
        acc.subsidyRiskCount += 1;
      }
      if (item.dataLifecycleStatus === 'ACTIVE_RETENTION') {
        acc.activeRetentionCount += 1;
      } else if (item.dataLifecycleStatus === 'RETENTION_EXPIRED_PURGE_DUE') {
        acc.purgeDueCount += 1;
      } else if (item.dataLifecycleStatus === 'ANONYMIZED_PURGED') {
        acc.purgedCount += 1;
      }
      return acc;
    },
    {
      totalAlumniCount: 0,
      pendingSettlementCount: 0,
      urgentSettlementCount: 0,
      pendingSettlementAmount: 0,
      pendingInsuranceLossCount: 0,
      subsidyRiskCount: 0,
      activeRetentionCount: 0,
      purgeDueCount: 0,
      purgedCount: 0,
    }
  );
}

/**
 * 초기 시뮬레이터 구동용 기본 퇴사자 원장 (14일 금품청산 진행중 · 지원금 주의 · 3년 경과 파기대상 포함)
 */
export function createInitialOffboardedWorkers(referenceDate = '2026-11-15') {
  const defaultBizRegNo = '214-86-00941';
  return [
    buildOffboardedWorkerRecord(
      {
        bizRegNo: defaultBizRegNo,
        empCode: 'EMP-191',
        displayName: '정태윤',
        deptName: '정밀가공2팀',
        jobTitle: '선임기사',
        maskedBirthOrId: '880412-*******',
        hireDate: '2022-05-01',
        lastWorkDate: '2026-11-07',
        lossDateReported: '2026-11-08',
        resignReason: 'RECOMMENDED',
        eiLossCode: '26',
        weeklyContractHours: 40,
        baseMonthlyPay: 3550000,
        mealAllowance: 200000,
        unusedLeaveDays: 5,
        settlementStatus: 'PENDING',
        nhisLossFilingStatus: 'FILED',
        eiLossAndCertStatus: 'FILED',
        ingestionSource: 'INSURANCE_LOSS_LEDGER',
      },
      { referenceDate, bizRegNo: defaultBizRegNo, lsaRegularCount: 60 }
    ),
    buildOffboardedWorkerRecord(
      {
        bizRegNo: defaultBizRegNo,
        empCode: 'EMP-192',
        displayName: '백서하',
        deptName: '품질보증팀',
        jobTitle: '주임',
        maskedBirthOrId: '950921-*******',
        hireDate: '2024-06-01',
        lastWorkDate: '2026-11-09',
        lossDateReported: '2026-11-10',
        resignReason: 'VOLUNTARY',
        eiLossCode: '11',
        weeklyContractHours: 40,
        baseMonthlyPay: 3050000,
        mealAllowance: 200000,
        unusedLeaveDays: 3,
        settlementStatus: 'PENDING',
        nhisLossFilingStatus: 'FILED',
        eiLossAndCertStatus: 'FILED',
        ingestionSource: 'INSURANCE_LOSS_LEDGER',
      },
      { referenceDate, bizRegNo: defaultBizRegNo, lsaRegularCount: 60 }
    ),
    buildOffboardedWorkerRecord(
      {
        bizRegNo: defaultBizRegNo,
        empCode: 'EMP-105',
        displayName: '노기범',
        deptName: '생산기술1팀',
        jobTitle: '기장',
        maskedBirthOrId: '830210-*******',
        hireDate: '2019-03-01',
        lastWorkDate: '2023-08-31',
        lossDateReported: '2023-09-01',
        resignReason: 'CONTRACT_END',
        eiLossCode: '32',
        weeklyContractHours: 40,
        baseMonthlyPay: 3400000,
        mealAllowance: 200000,
        unusedLeaveDays: 0,
        settlementStatus: 'PAID',
        nhisLossFilingStatus: 'FILED',
        eiLossAndCertStatus: 'FILED',
        ingestionSource: 'INSURANCE_LOSS_LEDGER',
      },
      { referenceDate, bizRegNo: defaultBizRegNo, lsaRegularCount: 60 }
    ),
  ];
}
