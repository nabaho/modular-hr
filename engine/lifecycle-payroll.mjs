/**
 * 채용(M1) → 입사·발령(M2·M3) → 근태·휴가(M4·M5) → 평가·징계(M6·M7) → 급여(M8) → 퇴사정산(M9)
 * 전 생애주기 근로기준법 검증 및 급여 자동 정산 도메인 엔진
 */

import { FAIR_HIRING_FORBIDDEN_RULES, LAW_BASELINE } from './labor-rules.mjs?v=31adf206a0bc';
import { addDaysISO, assertValidIsoDate } from './compliance-provisioner.mjs?v=31adf206a0bc';

export const VALID_RESIGN_REASONS = Object.freeze([
  'VOLUNTARY',
  'RECOMMENDED',
  'CONTRACT_END',
  'RETIRE_AGE',
  'DISMISSAL',
]);

function cleanNonNeg(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function floorWon(value) {
  return Math.floor(Number(value) || 0);
}

function floorTenWon(value) {
  return Math.floor((Number(value) || 0) / 10) * 10;
}

/**
 * 채용(M1)과 급여(M8)가 공통으로 사용하는 월 통상임금 환산 기준시간 산출 함수
 * - 주 40시간(유급주휴 8시간 포함)인 경우 표준 209시간을 일관되게 반환한다.
 */
export function computeMonthlyRefHours(weeklyHoursInput) {
  const weeklyHours = Math.max(1, cleanNonNeg(weeklyHoursInput, 40));
  if (Math.abs(weeklyHours - 40) < 1e-9) {
    return LAW_BASELINE.standardMonthlyHours;
  }
  const paidWeeklyHours = weeklyHours >= 15 ? weeklyHours + (weeklyHours / 40) * 8 : weeklyHours;
  return Math.round(((paidWeeklyHours * 365) / 7 / 12) * 100) / 100;
}

/**
 * M1. 채용공고 적법성 및 제시 처우 최저임금 검증
 */
export function validateJobPosting(input = {}) {
  const lsaRegularCount = cleanNonNeg(input.lsaRegularCount, 1);
  const isFairHiringMandatory = lsaRegularCount >= 30;
  const title = String(input.title || '').trim();
  const bodyText = String(input.bodyText || '').trim();
  const weeklyHours = Math.max(1, cleanNonNeg(input.weeklyHours, 40));
  const offeredMonthlyPay = cleanNonNeg(input.offeredMonthlyPay, 0);

  const combinedText = `${title}\n${bodyText}`;
  const violations = [];

  for (const rule of FAIR_HIRING_FORBIDDEN_RULES) {
    if (rule.pattern.test(combinedText)) {
      violations.push({
        severity: isFairHiringMandatory ? 'BLOCK' : 'RECOMMEND',
        label: rule.label,
        article: rule.article,
        penaltyNote: isFairHiringMandatory
          ? '상시 30인 이상 사업장 위반 시 500만 원 이하 과태료 대상 (공고 수정 필요)'
          : '30인 미만이나 공정채용 가이드라인상 삭제 권고',
      });
    }
  }

  const monthlyRefHours = computeMonthlyRefHours(weeklyHours);
  const offeredHourlyWage = monthlyRefHours > 0 ? Math.floor(offeredMonthlyPay / monthlyRefHours) : 0;
  const isBelowMinWage = offeredHourlyWage < LAW_BASELINE.minimumHourlyWage;
  const requiredMinMonthlyPay = Math.ceil(monthlyRefHours * LAW_BASELINE.minimumHourlyWage);

  const autoAppendedClauses = [];
  if (isFairHiringMandatory) {
    autoAppendedClauses.push(
      '[채용절차법 제11조 고지문안] 채용 여부가 확정된 날 이후 14일부터 180일 이내에 구직자가 채용서류의 반환을 청구할 경우 본인 확인 후 14일 이내에 반환하며, 청구기간 경과 후 개인정보 보호법에 따라 파기합니다.'
    );
    autoAppendedClauses.push(
      '[채용절차법 제9조 고지문안] 본 채용 전형과 관련하여 구직자에게 채용심사비용을 부담시키지 않습니다.'
    );
  }

  return {
    isFairHiringMandatory,
    passed: violations.filter((v) => v.severity === 'BLOCK').length === 0 && !isBelowMinWage,
    violations,
    wageCheck: {
      weeklyHours,
      monthlyRefHours,
      offeredMonthlyPay,
      offeredHourlyWage,
      minimumHourlyWage: LAW_BASELINE.minimumHourlyWage,
      requiredMinMonthlyPay,
      isBelowMinWage,
    },
    autoAppendedClauses,
  };
}

/**
 * M7. 징계 절차 적법성 점검 및 근로기준법 제95조 감봉 법정한도 자동 캡핑
 * - 절차 필드는 명시적 boolean true 일 때만 완료로 인정한다(미입력/문자열은 미완료 처리).
 */
export function evaluateDisciplineAndCapCut(input = {}) {
  const requestedCut = floorWon(cleanNonNeg(input.requestedCutAmount, 0));
  const avgDailyWage = Math.max(0, cleanNonNeg(input.avgDailyWage, 100000));
  const monthlyGrossPay = Math.max(0, cleanNonNeg(input.monthlyGrossPay, 3000000));
  const incidentCount = Math.max(1, Math.round(cleanNonNeg(input.incidentCount, 1)));
  const lsaRegularCount = cleanNonNeg(input.lsaRegularCount, 5);

  const perIncidentLimit = floorWon(
    avgDailyWage * LAW_BASELINE.disciplinaryCutLimits.perIncidentDailyAvgRatio
  );
  const maxByIncidentCount = perIncidentLimit * incidentCount;
  const monthlyTotalLimit = floorWon(
    monthlyGrossPay * LAW_BASELINE.disciplinaryCutLimits.totalMonthlyGrossRatio
  );

  const legalMaxThisMonth =
    requestedCut === 0 ? 0 : Math.min(maxByIncidentCount, monthlyTotalLimit);
  const appliedCutAmount = Math.min(requestedCut, legalMaxThisMonth);
  const blockedExcessAmount = Math.max(0, requestedCut - appliedCutAmount);

  const proceduralChecks = {
    attendanceNoticeSent: input.attendanceNoticeSent === true,
    defenseOpportunityGiven: input.defenseOpportunityGiven === true,
    committeeResolved: input.committeeResolved === true,
    writtenNoticeDelivered: input.writtenNoticeDelivered === true,
  };

  const missingSteps = [];
  if (!proceduralChecks.attendanceNoticeSent) missingSteps.push('사전 출석통지서 발송 확인 필요');
  if (!proceduralChecks.defenseOpportunityGiven) missingSteps.push('근로자 소명기회 부여 기록 필요');
  if (!proceduralChecks.committeeResolved) missingSteps.push('징계위원회 심의·의결록 확인 필요');
  if (!proceduralChecks.writtenNoticeDelivered) missingSteps.push('징계사유·처분 서면통지 확인 필요');

  return {
    requestedCut,
    incidentCount,
    perIncidentLimit,
    monthlyTotalLimit,
    legalMaxThisMonth,
    appliedCutAmount,
    blockedExcessAmount,
    wasCapped: blockedExcessAmount > 0,
    proceduralValid: missingSteps.length === 0,
    missingSteps,
    lsaRegularCount,
    legalNotice:
      blockedExcessAmount > 0
        ? `근로기준법 제95조에 따라 1회 감봉 상한(${perIncidentLimit.toLocaleString('ko-KR')}원) 및 월 총액 1/10 상한(${monthlyTotalLimit.toLocaleString('ko-KR')}원)을 초과한 ${blockedExcessAmount.toLocaleString('ko-KR')}원을 자동 차단했습니다.`
        : '근로기준법 제95조 감봉 한도 이내입니다.',
  };
}

/**
 * M8. 개별 지급대상자 월 급여 자동 파이프라인 정산
 */
export function computeEmployeePayrollLine(worker = {}, context = {}) {
  const lsaRegularCount = cleanNonNeg(context.lsaRegularCount, 5);
  const is5OrMore = lsaRegularCount >= 5;
  const category = worker.workerCategory || 'REGULAR';
  const warnings = [];
  const formulaLines = [];

  // 1) 3.3% 사업소득자 / 8.8% 기타소득자
  if (category === 'BIZ_33' || category === 'OTHER_88') {
    const grossPay = floorWon(cleanNonNeg(worker.contractFee, 0));
    const rate =
      category === 'BIZ_33'
        ? LAW_BASELINE.socialInsurance.biz33WithholdingRate
        : LAW_BASELINE.socialInsurance.other88EffectiveRate;
    const totalTax = floorTenWon(grossPay * rate);
    const incomeTax = floorTenWon(totalTax / 1.1);
    const localTax = totalTax - incomeTax;
    const netPay = grossPay - totalTax;

    formulaLines.push(
      category === 'BIZ_33'
        ? `사업소득 원천징수(3.3%) = ${grossPay.toLocaleString('ko-KR')}원 × 3.3% = ${totalTax.toLocaleString('ko-KR')}원`
        : `기타소득 원천징수(8.8%, 필요경비 60% 의제) = ${grossPay.toLocaleString('ko-KR')}원 × 8.8% = ${totalTax.toLocaleString('ko-KR')}원`
    );

    if (category === 'BIZ_33' && (cleanNonNeg(worker.fixedSameAmountMonths, 0) >= 3 || worker.hasAttendanceLog === true)) {
      warnings.push({
        code: 'DISGUISED_WORKER_RISK',
        level: 'WARN',
        message: '매월 정액 지급 또는 출퇴근 기록이 감지되었습니다. 근로기준법상 근로자성(가짜 3.3%) 노무사 점검이 필요합니다.',
      });
    }

    return {
      empCode: worker.empCode || 'EXT-000',
      displayName: worker.displayName || '외부용역',
      deptName: worker.deptName || '외부전문가',
      workerCategory: category,
      ordinaryHourlyWage: 0,
      basePayApplied: grossPay,
      fixedAllowanceApplied: 0,
      mealAllowanceApplied: 0,
      nonTaxableMealApplied: 0,
      taxableMealExcess: 0,
      overtimeNightHolidayPay: 0,
      unusedLeavePay: 0,
      evalBonusPay: 0,
      grossPay,
      disciplinaryCutApplied: 0,
      disciplinaryCutBlocked: 0,
      socialInsuranceTotal: 0,
      incomeTaxTotal: totalTax,
      localTax,
      netPay,
      warnings,
      formulaLines,
    };
  }

  // 2) 일용근로자
  if (category === 'DAILY') {
    const workDays = cleanNonNeg(worker.dailyWorkDays, 0);
    const dailyWage = cleanNonNeg(worker.dailyWage, 150000);
    const grossPay = floorWon(workDays * dailyWage);
    const dailyTaxable = Math.max(0, dailyWage - 150000);
    const dailyCalculatedTax = floorWon(dailyTaxable * 0.06 * 0.45);
    const dailyEffectiveTax = dailyCalculatedTax < 1000 ? 0 : dailyCalculatedTax;
    const incomeTax = floorTenWon(dailyEffectiveTax * workDays);
    const localTax = floorTenWon(incomeTax * 0.1);
    const empIns = floorTenWon(grossPay * LAW_BASELINE.socialInsurance.employmentInsuranceRateWorker);
    const netPay = grossPay - empIns - incomeTax - localTax;

    formulaLines.push(
      `일용임금 = ${dailyWage.toLocaleString('ko-KR')}원 × ${workDays}일 = ${grossPay.toLocaleString('ko-KR')}원`
    );
    formulaLines.push(
      `고용보험(0.9%) = ${empIns.toLocaleString('ko-KR')}원, 일용소득세(15만 원 공제·세액공제 55%) = ${(incomeTax + localTax).toLocaleString('ko-KR')}원`
    );

    return {
      empCode: worker.empCode || 'DLY-000',
      displayName: worker.displayName || '일용근로자',
      deptName: worker.deptName || '현장팀',
      workerCategory: category,
      ordinaryHourlyWage: Math.floor(dailyWage / 8),
      basePayApplied: grossPay,
      fixedAllowanceApplied: 0,
      mealAllowanceApplied: 0,
      nonTaxableMealApplied: 0,
      taxableMealExcess: 0,
      overtimeNightHolidayPay: 0,
      unusedLeavePay: 0,
      evalBonusPay: 0,
      grossPay,
      disciplinaryCutApplied: 0,
      disciplinaryCutBlocked: 0,
      socialInsuranceTotal: empIns,
      incomeTaxTotal: incomeTax + localTax,
      localTax,
      netPay,
      warnings,
      formulaLines,
    };
  }

  // 3) 상용근로자 (정규직 · 기간제 · 단시간)
  const weeklyHours = Math.max(1, cleanNonNeg(worker.weeklyHours, 40));
  const dailyHours = Math.max(1, cleanNonNeg(worker.dailyHours, Math.min(8, weeklyHours / 5)));
  const monthlyRefHours = computeMonthlyRefHours(weeklyHours);

  const raiseRatePct = cleanNonNeg(worker.evalRaiseRatePct, 0);
  const rawBasePay = cleanNonNeg(worker.baseMonthlyPay, 0);
  const raisedBasePay = floorWon(rawBasePay * (1 + raiseRatePct / 100));
  const fixedOrdinaryAllowance = cleanNonNeg(worker.fixedOrdinaryAllowance, 0);

  // 식대 총액 보존: 20만 원 초과 식대도 지급총액(grossPay)에 전액 포함하고 비과세 한도(20만 원)만 비과세 차감!
  const contractMealTotal = cleanNonNeg(
    worker.mealAllowance !== undefined ? worker.mealAllowance : worker.nonTaxableMeal,
    0
  );

  const monthDays = Math.max(28, Math.round(cleanNonNeg(context.monthCalendarDays, 30)));
  const unpaidDays = Math.min(
    monthDays,
    cleanNonNeg(worker.unpaidLeaveDays, 0) + cleanNonNeg(worker.suspensionDays, 0)
  );
  const activeRatio = Math.max(0, (monthDays - unpaidDays) / monthDays);

  const basePayApplied = floorWon(raisedBasePay * activeRatio);
  const fixedAllowanceApplied = floorWon(fixedOrdinaryAllowance * activeRatio);
  const mealAllowanceApplied = floorWon(contractMealTotal * activeRatio);
  const configuredMealCap = Math.min(
    LAW_BASELINE.nonTaxableMealLimit,
    cleanNonNeg(context.nonTaxableMealLimit, LAW_BASELINE.nonTaxableMealLimit)
  );
  const nonTaxableMealApplied = Math.min(mealAllowanceApplied, configuredMealCap);
  const taxableMealExcess = Math.max(0, mealAllowanceApplied - nonTaxableMealApplied);

  const monthlyOrdinaryTotal = raisedBasePay + fixedOrdinaryAllowance;
  const ordinaryHourlyWage =
    monthlyRefHours > 0 ? Math.round((monthlyOrdinaryTotal / monthlyRefHours) * 100) / 100 : 0;

  // 최저임금 검증 (채용 M1과 동일한 monthlyRefHours 기준 적용)
  const minWageIncludedTotal = monthlyOrdinaryTotal + contractMealTotal;
  const minWageHourlyCheck =
    monthlyRefHours > 0 ? Math.floor(minWageIncludedTotal / monthlyRefHours) : 0;
  if (minWageHourlyCheck < LAW_BASELINE.minimumHourlyWage) {
    warnings.push({
      code: 'MINIMUM_WAGE_VIOLATION',
      level: 'CRITICAL',
      message: `최저임금 미달 위험: 산입 시급 ${minWageHourlyCheck.toLocaleString('ko-KR')}원 < 법정 최저시급 ${LAW_BASELINE.minimumHourlyWage.toLocaleString('ko-KR')}원`,
    });
  }

  const overtimeHours = cleanNonNeg(worker.overtimeHours, 0);
  const nightHours = cleanNonNeg(worker.nightHours, 0);
  const holidayLe8Hours = cleanNonNeg(worker.holidayLe8Hours, 0);
  const holidayGt8Hours = cleanNonNeg(worker.holidayGt8Hours, 0);

  // 주 최대 근로시간: 주별 피크 기록(maxWeeklyWorkedHours)과 월 평균 환산치 중 큰 값을 사용하여 특정 주 52시간 초과 누락 방지!
  const avgWeeklyFromMonthly =
    weeklyHours + (overtimeHours + holidayLe8Hours + holidayGt8Hours) / 4.345;
  const recordedPeakWeekly = cleanNonNeg(worker.maxWeeklyWorkedHours, 0);
  const maxWeeklyWorkedHours = Math.max(recordedPeakWeekly, avgWeeklyFromMonthly);

  const weeklyWarnThreshold = Math.min(
    LAW_BASELINE.weeklyHardCapHours,
    Math.max(40, cleanNonNeg(context.weeklyWarnHours, 48))
  );
  if (is5OrMore && maxWeeklyWorkedHours > LAW_BASELINE.weeklyHardCapHours) {
    warnings.push({
      code: 'WEEKLY_52H_EXCEEDED',
      level: 'CRITICAL',
      message: `주 최대 근로시간 ${maxWeeklyWorkedHours.toFixed(1)}h > 법정 상한 52h 초과 (근로기준법 제53조 위반 위험)`,
    });
  } else if (is5OrMore && maxWeeklyWorkedHours >= weeklyWarnThreshold) {
    warnings.push({
      code: 'WEEKLY_52H_NEAR',
      level: 'WARN',
      message: `주 최대 근로시간 ${maxWeeklyWorkedHours.toFixed(1)}h — 사내 경고기준(${weeklyWarnThreshold}h) 도달`,
    });
  }

  const otMultiplier = is5OrMore ? 1.5 : 1.0;
  const nightAddMultiplier = is5OrMore ? 0.5 : 0.0;
  const holLe8Multiplier = is5OrMore ? 1.5 : 1.0;
  const holGt8Multiplier = is5OrMore ? 2.0 : 1.0;

  const overtimePay = floorWon(ordinaryHourlyWage * overtimeHours * otMultiplier);
  const nightPay = floorWon(ordinaryHourlyWage * nightHours * nightAddMultiplier);
  const holidayPay = floorWon(
    ordinaryHourlyWage * holidayLe8Hours * holLe8Multiplier +
      ordinaryHourlyWage * holidayGt8Hours * holGt8Multiplier
  );
  const overtimeNightHolidayPay = overtimePay + nightPay + holidayPay;

  const unusedLeaveDays = cleanNonNeg(worker.unusedLeavePayoutDays, 0);
  const ordinaryDailyWage = ordinaryHourlyWage * dailyHours;
  const unusedLeavePay = floorWon(ordinaryDailyWage * unusedLeaveDays);
  const evalBonusPay = floorWon(cleanNonNeg(worker.evalBonusPay, 0));

  const grossPay =
    basePayApplied +
    fixedAllowanceApplied +
    mealAllowanceApplied +
    overtimeNightHolidayPay +
    unusedLeavePay +
    evalBonusPay;

  // M7 징계 감봉: 절차 증빙이 명시적 true가 아니면 반드시 절차 흠결 경고를 발생시킨다!
  const requestedCut = cleanNonNeg(worker.requestedDisciplinaryCut, 0);
  const disciplineResult = evaluateDisciplineAndCapCut({
    requestedCutAmount: requestedCut,
    avgDailyWage: Math.max(ordinaryDailyWage, grossPay / 30),
    monthlyGrossPay: grossPay,
    incidentCount: worker.disciplinaryIncidentCount || 1,
    lsaRegularCount,
    attendanceNoticeSent: worker.attendanceNoticeSent === true,
    defenseOpportunityGiven: worker.defenseOpportunityGiven === true,
    committeeResolved: worker.committeeResolved === true,
    writtenNoticeDelivered: worker.writtenNoticeDelivered === true,
  });

  if (disciplineResult.wasCapped) {
    warnings.push({
      code: 'DISCIPLINARY_CUT_CAPPED',
      level: 'WARN',
      message: disciplineResult.legalNotice,
    });
  }
  if (requestedCut > 0 && !disciplineResult.proceduralValid) {
    warnings.push({
      code: 'DISCIPLINARY_PROCEDURE_DEFECT',
      level: 'CRITICAL',
      message: `징계 절차 증빙 미확인: ${disciplineResult.missingSteps.join(', ')}`,
    });
  }

  // 과세 대상 보수월액 (지급총액 - 비과세 식대 한도액 - 적법 감봉액; 한도 초과 식대는 과세에 자동 포함!)
  const taxablePay = Math.max(
    0,
    grossPay - nonTaxableMealApplied - disciplineResult.appliedCutAmount
  );

  const ins = LAW_BASELINE.socialInsurance;
  const pensionBase = Math.min(
    ins.nationalPensionMaxBase,
    Math.max(taxablePay > 0 ? ins.nationalPensionMinBase : 0, Math.floor(taxablePay / 1000) * 1000)
  );
  const nationalPension = taxablePay > 0 ? floorTenWon(pensionBase * ins.nationalPensionRateWorker) : 0;
  const healthInsurance = floorTenWon(taxablePay * ins.healthInsuranceRateWorker);
  const longTermCare = floorTenWon(healthInsurance * ins.longTermCareRateOfHealth);
  const employmentInsurance = floorTenWon(taxablePay * ins.employmentInsuranceRateWorker);
  const socialInsuranceTotal =
    nationalPension + healthInsurance + longTermCare + employmentInsurance;

  const dependents = Math.max(1, Math.round(cleanNonNeg(worker.dependents, 1)));
  const familyDeduction = 1500000 + (dependents - 1) * 350000;
  const taxBaseApprox = Math.max(0, taxablePay - familyDeduction);
  let rawIncomeTax = 0;
  if (taxBaseApprox <= 1500000) {
    rawIncomeTax = taxBaseApprox * 0.035;
  } else if (taxBaseApprox <= 4500000) {
    rawIncomeTax = 52500 + (taxBaseApprox - 1500000) * 0.085;
  } else {
    rawIncomeTax = 307500 + (taxBaseApprox - 4500000) * 0.16;
  }
  const withholdingPct = [80, 100, 120].includes(Number(context.withholdingTaxRatePct))
    ? Number(context.withholdingTaxRatePct)
    : 100;
  const incomeTax = floorTenWon(rawIncomeTax * (withholdingPct / 100));
  const localTax = floorTenWon(incomeTax * 0.1);
  const incomeTaxTotal = incomeTax + localTax;

  const netPay =
    grossPay - disciplineResult.appliedCutAmount - socialInsuranceTotal - incomeTaxTotal;

  formulaLines.push(
    `통상시급 = (${raisedBasePay.toLocaleString('ko-KR')} + ${fixedOrdinaryAllowance.toLocaleString('ko-KR')}) ÷ ${monthlyRefHours}h = ${Math.round(ordinaryHourlyWage).toLocaleString('ko-KR')}원`
  );
  if (withholdingPct !== 100) {
    formulaLines.push(`소득세 원천징수 선택비율 = 간이세액표 ${withholdingPct}% 기준 적용`);
  }
  if (mealAllowanceApplied > 0) {
    formulaLines.push(
      `식대 지급 = 총 ${mealAllowanceApplied.toLocaleString('ko-KR')}원 (비과세 ${nonTaxableMealApplied.toLocaleString('ko-KR')}원 / 과세전환 ${taxableMealExcess.toLocaleString('ko-KR')}원)`
    );
  }
  if (unpaidDays > 0) {
    formulaLines.push(
      `일할계산(무급·정직 ${unpaidDays}일 제외) = (${monthDays} - ${unpaidDays}) ÷ ${monthDays} 적용`
    );
  }
  if (overtimeNightHolidayPay > 0 || overtimeHours + nightHours + holidayLe8Hours + holidayGt8Hours > 0) {
    formulaLines.push(
      is5OrMore
        ? `연장·야간·휴일(5인 이상 가산 적용) = 시급 × [연장 ${overtimeHours}h×1.5 + 야간 ${nightHours}h×0.5 + 휴일(8h내) ${holidayLe8Hours}h×1.5 + 휴일(8h초과) ${holidayGt8Hours}h×2.0] = ${overtimeNightHolidayPay.toLocaleString('ko-KR')}원`
        : `연장·휴일(5인 미만 가산 면제 1.0배) = 시급 × (${overtimeHours + holidayLe8Hours + holidayGt8Hours}h × 1.0) = ${overtimeNightHolidayPay.toLocaleString('ko-KR')}원`
    );
  }
  if (unusedLeavePay > 0) {
    formulaLines.push(
      `미사용연차수당 = 통상일급 ${Math.round(ordinaryDailyWage).toLocaleString('ko-KR')}원 × ${unusedLeaveDays}일 = ${unusedLeavePay.toLocaleString('ko-KR')}원`
    );
  }
  if (disciplineResult.appliedCutAmount > 0) {
    formulaLines.push(
      `징계감봉 공제(제95조 한도 검증) = -${disciplineResult.appliedCutAmount.toLocaleString('ko-KR')}원 (원 요청 ${disciplineResult.requestedCut.toLocaleString('ko-KR')}원)`
    );
  }

  return {
    empCode: worker.empCode || 'EMP-000',
    displayName: worker.displayName || '근로자',
    deptName: worker.deptName || '일반부서',
    workerCategory: category,
    ordinaryHourlyWage: Math.round(ordinaryHourlyWage),
    basePayApplied,
    fixedAllowanceApplied,
    mealAllowanceApplied,
    nonTaxableMealApplied,
    taxableMealExcess,
    overtimeNightHolidayPay,
    unusedLeavePay,
    evalBonusPay,
    grossPay,
    disciplinaryCutApplied: disciplineResult.appliedCutAmount,
    disciplinaryCutBlocked: disciplineResult.blockedExcessAmount,
    maxWeeklyWorkedHours: Math.round(maxWeeklyWorkedHours * 10) / 10,
    socialInsuranceTotal,
    socialInsuranceDetail: {
      nationalPension,
      healthInsurance,
      longTermCare,
      employmentInsurance,
    },
    incomeTaxTotal,
    localTax,
    netPay,
    warnings,
    formulaLines,
  };
}

/**
 * M9. 퇴사·오프보딩 리스크 검증 및 퇴직금(평균임금 vs 통상임금 하한) 정산기
 */
export function computeOffboardingSettlement(input = {}) {
  const resignReason = String(input.resignReason ?? 'VOLUNTARY');
  if (!VALID_RESIGN_REASONS.includes(resignReason)) {
    const err = new RangeError(
      `유효하지 않은 퇴사 사유 코드입니다 (${resignReason}). 허용값: ${VALID_RESIGN_REASONS.join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }

  const lastWorkDate = assertValidIsoDate(input.lastWorkDate || '2026-11-30', 'lastWorkDate');
  const serviceDays = Math.max(0, Math.round(cleanNonNeg(input.serviceDays, 730)));
  const weeklyHours = cleanNonNeg(input.weeklyHours, 40);
  const threeMonthWageTotal = cleanNonNeg(input.threeMonthWageTotal, 9600000);
  const rawThreeMonthDays = input.threeMonthDays === undefined ? 91 : Number(input.threeMonthDays);
  if (!Number.isInteger(rawThreeMonthDays) || rawThreeMonthDays < 89 || rawThreeMonthDays > 92) {
    const err = new RangeError(
      `직전 3개월 역일수(threeMonthDays)는 89일 이상 92일 이하의 정수여야 합니다 (${String(input.threeMonthDays)}).`
    );
    err.statusCode = 400;
    throw err;
  }
  const threeMonthCalendarDays = rawThreeMonthDays;
  const annualBonusTotal = cleanNonNeg(input.annualBonusTotal, 0);
  const ordinaryHourlyWage = cleanNonNeg(input.ordinaryHourlyWage, 15000);
  const dailyHours = Math.max(1, cleanNonNeg(input.dailyHours, 8));
  const unusedLeaveDays = cleanNonNeg(input.unusedLeaveDays, 0);
  const lsaRegularCount = cleanNonNeg(input.lsaRegularCount, 10);
  const activeSubsidies = Array.isArray(input.activeSubsidies) ? input.activeSubsidies : [];
  const advanceNoticeDaysGiven = cleanNonNeg(input.advanceNoticeDaysGiven, 30);
  const writtenDismissalNoticeGiven = input.writtenDismissalNoticeGiven === true;

  const alerts = [];

  if ((resignReason === 'RECOMMENDED' || resignReason === 'DISMISSAL') && activeSubsidies.length > 0) {
    alerts.push({
      level: 'CRITICAL',
      code: 'SUBSIDY_CLAWBACK_RISK',
      message: `인위적 감원(${resignReason === 'DISMISSAL' ? '해고' : '권고사직'}) 처리 시 현재 수급 중인 [${activeSubsidies.join(', ')}]의 감원방지 의무 위반으로 지원금 지급 중단·환수 위험이 발생합니다!`,
    });
  }

  let dismissalNoticePay = 0;
  if (resignReason === 'DISMISSAL') {
    if (advanceNoticeDaysGiven < 30) {
      dismissalNoticePay = floorWon(ordinaryHourlyWage * dailyHours * 30);
      alerts.push({
        level: 'WARN',
        code: 'DISMISSAL_NOTICE_PAY_ADDED',
        message: `30일 전 해고예고 미실시(현재 ${advanceNoticeDaysGiven}일 전)로 통상임금 30일분 해고예고수당 ${dismissalNoticePay.toLocaleString('ko-KR')}원이 자동 가산되었습니다 (근로기준법 제26조).`,
      });
    }
    if (lsaRegularCount >= 5 && !writtenDismissalNoticeGiven) {
      alerts.push({
        level: 'CRITICAL',
        code: 'WRITTEN_DISMISSAL_REQUIRED',
        message: '상시 5인 이상 사업장에서 해고사유와 해고시기를 서면으로 통지하지 않으면 해고는 무효가 됩니다(근로기준법 제27조). 구두·문자 단독 통지 금지!',
      });
    }
  }

  const eligibleForSeverance =
    serviceDays >= LAW_BASELINE.severance.minServiceDays &&
    weeklyHours >= LAW_BASELINE.severance.minWeeklyHours;

  const threeMonthIncludedTotal = threeMonthWageTotal + (annualBonusTotal * 3) / 12;
  const rawAvgDailyWage = threeMonthIncludedTotal / threeMonthCalendarDays;
  const ordinaryDailyWage = ordinaryHourlyWage * dailyHours;
  const appliedDailyWage = Math.max(rawAvgDailyWage, ordinaryDailyWage);
  const ordinaryFloorApplied = ordinaryDailyWage > rawAvgDailyWage;

  const severancePay = eligibleForSeverance
    ? floorWon(appliedDailyWage * 30 * (serviceDays / 365))
    : 0;

  const unusedLeavePayout = floorWon(ordinaryDailyWage * unusedLeaveDays);
  const paymentDueDate = addDaysISO(lastWorkDate, LAW_BASELINE.severance.settlementDeadlineDays);

  const autoGeneratedExitDocs = [
    '4대보험 피보험자격 상실신고서 초안',
    resignReason === 'VOLUNTARY'
      ? '이직확인서 (근로자 요청 시 10일 이내 발급 대상)'
      : '고용보험 피보험자 이직확인서 초안 (비자발적 이직 사유 확인용)',
    '퇴직소득 원천징수영수증 및 근로소득 중도정산 집계표',
    '사용증명서(경력증명서 — 근로기준법 제39조)',
  ];

  return {
    resignReason,
    eligibleForSeverance,
    serviceDays,
    rawAvgDailyWage: Math.round(rawAvgDailyWage),
    ordinaryDailyWage: Math.round(ordinaryDailyWage),
    appliedDailyWage: Math.round(appliedDailyWage),
    ordinaryFloorApplied,
    severancePay,
    unusedLeavePayout,
    dismissalNoticePay,
    totalSettlementGross: severancePay + unusedLeavePayout + dismissalNoticePay,
    lastWorkDate,
    paymentDueDate,
    alerts,
    autoGeneratedExitDocs,
  };
}
