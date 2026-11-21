import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeRegularHeadcounts,
  isValidIsoDate,
  provisionWorkplaceSystem,
} from '../src/engine/compliance-provisioner.mjs';
import {
  computeEmployeePayrollLine,
  computeOffboardingSettlement,
  evaluateDisciplineAndCapCut,
  validateJobPosting,
} from '../src/engine/lifecycle-payroll.mjs';
import { generateStatutoryDocument } from '../src/engine/document-generator.mjs';
import {
  SAMPLE_INGESTION_BUNDLES,
  redactAndSanitizeDocText,
  stageMultiDocumentBundle,
} from '../src/engine/document-ingestion.mjs';
import { createMobileHub } from '../src/engine/mobile-auth-realtime.mjs';
import { createAppServer } from '../src/server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

test('상시근로자 산정기: 파견·3.3% 분리, 중증장애인 2배수, 임계치 근접 예고 및 반올림 오판 방지 검증', () => {
  const hc = computeRegularHeadcounts({
    operatingDays: 20,
    regularWorkers: 26,
    partTimeWorkers: 2,
    dailyWorkerManDays: 10,
    dispatchedWorkers: 4,
    biz33Contractors: 3,
    disabledMild: 1,
    disabledSevere: 2,
  });

  assert.equal(hc.lsaRegularCount, 28.5);
  assert.equal(hc.oshRegularCount, 32.5);
  assert.equal(hc.recognizedDisabledCount, 5);
  assert.ok(hc.upcomingThresholdWarnings.some((w) => w.threshold === 30));

  // explicitCumulativeManDays: null 이 regularWorkers: 30 을 0으로 덮어쓰지 않아야 함
  const nullExplicit = computeRegularHeadcounts({
    operatingDays: 22,
    regularWorkers: 30,
    explicitCumulativeManDays: null,
  });
  assert.equal(nullExplicit.lsaRegularCount, 30);
  assert.equal(nullExplicit.is30OrMore, true);

  // 929.9 / 31 = 29.99677... 은 실제 30인 미만이므로 반올림으로 30인 의무가 발동되면 안 됨
  const justBelow30 = computeRegularHeadcounts({
    operatingDays: 31,
    explicitCumulativeManDays: 929.9,
  });
  assert.equal(justBelow30.is30OrMore, false);
  assert.equal(justBelow30.lsaRegularCount, 29.99);

  // 인원수 필드에 소수(29.6명 등) 전달 시 조용히 반올림해 30인으로 오판하지 않고 즉시 400 RangeError 거부
  assert.throws(
    () => computeRegularHeadcounts({ operatingDays: 22, regularWorkers: 29.6 }),
    RangeError
  );
  assert.throws(
    () => computeRegularHeadcounts({ operatingDays: 21.5, regularWorkers: 10 }),
    RangeError
  );
});

test('날짜 실재성 검증 및 연례 법정 신고 마감일(당해 연도 vs 익년도) 정확성 검증', () => {
  assert.equal(isValidIsoDate('2026-02-28'), true);
  assert.equal(isValidIsoDate('2026-02-31'), false);
  assert.equal(isValidIsoDate('2026-99-99'), false);

  assert.throws(
    () =>
      provisionWorkplaceSystem({
        triggerDate: '2026-02-31',
        referenceDate: '2026-03-01',
        headcountInput: { operatingDays: 20, regularWorkers: 35 },
      }),
    RangeError
  );

  // 1월 10일 기준일 때는 당해 연도 1월 31일 및 4월 30일이 마감일이 되어야 함
  const janProvision = provisionWorkplaceSystem({
    ksicMajor: 'C',
    triggerDate: '2026-01-05',
    referenceDate: '2026-01-10',
    headcountInput: { operatingDays: 22, regularWorkers: 310 },
  });
  const disTask = janProvision.statutoryFilings.find((f) => f.id === 'TASK_DISABILITY_REPORT');
  const pubTask = janProvision.statutoryFilings.find(
    (f) => f.id === 'TASK_EMPLOYMENT_DISCLOSURE_300'
  );
  assert.equal(disTask.dueDate, '2026-01-31');
  assert.equal(pubTask.dueDate, '2026-04-30');
});

test('30인 이상 사업장 진입 시 노사협의회 모듈·15일 내 규정신고·분기 정기회의 자동 생성', () => {
  const result = provisionWorkplaceSystem({
    ksicMajor: 'J',
    triggerDate: '2026-11-10',
    referenceDate: '2026-11-15',
    headcountInput: {
      operatingDays: 22,
      regularWorkers: 31,
    },
  });

  const lmcModule = result.floorPlan.find((m) => m.id === 'M10_LMC');
  assert.equal(lmcModule.status, 'AUTO_PROVISIONED');

  const lmcFiling = result.statutoryFilings.find((f) => f.id === 'TASK_LMC_30_REPORT');
  assert.ok(lmcFiling);
  assert.equal(lmcFiling.dueDate, '2026-11-25');
  assert.equal(lmcFiling.daysLeft, 10);

  for (let q = 0; q < 4; q++) {
    assert.ok(
      result.quarterlySchedule[q].items.some(
        (i) => i.code === `Q${q + 1}_LMC_MEETING` && i.quarterNumber === q + 1
      )
    );
  }
});

test('50인 이상 업종 분기: 제조업(C) 안전·보건관리자 14일 내 선임보고 vs IT업(J) 미발동', () => {
  const mfg55 = provisionWorkplaceSystem({
    ksicMajor: 'C',
    triggerDate: '2026-11-10',
    referenceDate: '2026-11-15',
    headcountInput: { operatingDays: 22, regularWorkers: 55 },
  });

  const oshFiling = mfg55.statutoryFilings.find((f) => f.id === 'TASK_OSH_50_OFFICER');
  assert.ok(oshFiling);
  assert.equal(oshFiling.dueDate, '2026-11-24');

  const it55 = provisionWorkplaceSystem({
    ksicMajor: 'J',
    triggerDate: '2026-11-10',
    referenceDate: '2026-11-15',
    headcountInput: { operatingDays: 22, regularWorkers: 55 },
  });
  assert.equal(
    it55.statutoryFilings.find((f) => f.id === 'TASK_OSH_50_OFFICER'),
    undefined
  );
  assert.equal(it55.disabilityCompliance.applicable, true);
});

test('인원 감소 보호 잠금: 과거 34인 사업장이 27인으로 감소 시 SCALE_DOWN_REVIEW 유지', () => {
  const scaledDown = provisionWorkplaceSystem({
    ksicMajor: 'C',
    historicalPeakHeadcount: 34,
    headcountInput: { operatingDays: 22, regularWorkers: 27 },
  });

  const lmcModule = scaledDown.floorPlan.find((m) => m.id === 'M10_LMC');
  assert.equal(lmcModule.status, 'SCALE_DOWN_REVIEW');
});

test('채용(M1)과 급여(M8)의 주 40시간 최저임금 기준시간(209h) 정합성 및 금지어 검증', () => {
  // 2,153,000원은 209h 기준 시급 10,301원으로 최저임금(10,320원) 미달 -> 채용과 급여 모두 동일하게 미달 판정!
  const post2153 = validateJobPosting({
    lsaRegularCount: 35,
    title: '정규직 채용',
    bodyText: '출신지역 및 혼인여부 기재 금지 테스트',
    weeklyHours: 40,
    offeredMonthlyPay: 2153000,
  });
  assert.equal(post2153.wageCheck.monthlyRefHours, 209);
  assert.equal(post2153.wageCheck.isBelowMinWage, true);

  const pay2153 = computeEmployeePayrollLine(
    { empCode: 'EMP-MIN', workerCategory: 'REGULAR', weeklyHours: 40, baseMonthlyPay: 2153000 },
    { lsaRegularCount: 35 }
  );
  assert.ok(pay2153.warnings.some((w) => w.code === 'MINIMUM_WAGE_VIOLATION'));

  // 2,157,000원은 209h 기준 시급 10,320원 이상 -> 채용과 급여 모두 통과!
  const post2157 = validateJobPosting({
    lsaRegularCount: 35,
    title: '정규직 채용',
    bodyText: '직무 역량 중심 평가',
    weeklyHours: 40,
    offeredMonthlyPay: 2157000,
  });
  assert.equal(post2157.passed, true);
  const pay2157 = computeEmployeePayrollLine(
    { empCode: 'EMP-OK', workerCategory: 'REGULAR', weeklyHours: 40, baseMonthlyPay: 2157000 },
    { lsaRegularCount: 35 }
  );
  assert.equal(
    pay2157.warnings.some((w) => w.code === 'MINIMUM_WAGE_VIOLATION'),
    false
  );
});

test('식대 한도 초과 지급액 보존 및 징계 절차 미입력 시 절차 흠결 경고 검증', () => {
  // 1) 식대 300,000원 입력 시 지급총액에 300,000원 전액 포함, 비과세 200,000원 / 과세전환 100,000원 분리
  const mealLine = computeEmployeePayrollLine(
    {
      empCode: 'EMP-MEAL',
      workerCategory: 'REGULAR',
      weeklyHours: 40,
      baseMonthlyPay: 3000000,
      mealAllowance: 300000,
    },
    { lsaRegularCount: 10 }
  );
  assert.equal(mealLine.grossPay, 3300000);
  assert.equal(mealLine.mealAllowanceApplied, 300000);
  assert.equal(mealLine.nonTaxableMealApplied, 200000);
  assert.equal(mealLine.taxableMealExcess, 100000);

  // 2) 징계 절차 필드를 미입력한 채 감봉 요청 시 사업장 규모(5인 미만 포함)와 무관하게 반드시 DISCIPLINARY_PROCEDURE_DEFECT 경고 발생
  const noProcCutLine = computeEmployeePayrollLine(
    {
      empCode: 'EMP-CUT',
      workerCategory: 'REGULAR',
      weeklyHours: 40,
      baseMonthlyPay: 3000000,
      requestedDisciplinaryCut: 50000,
    },
    { lsaRegularCount: 10 }
  );
  assert.ok(
    noProcCutLine.warnings.some((w) => w.code === 'DISCIPLINARY_PROCEDURE_DEFECT'),
    '절차 확인 없이 감봉 시 절차 흠결 경고가 반드시 발생해야 함'
  );

  const under5NoProcLine = computeEmployeePayrollLine(
    {
      empCode: 'EMP-CUT4',
      workerCategory: 'REGULAR',
      weeklyHours: 40,
      baseMonthlyPay: 2800000,
      requestedDisciplinaryCut: 50000,
    },
    { lsaRegularCount: 4 }
  );
  assert.ok(
    under5NoProcLine.warnings.some((w) => w.code === 'DISCIPLINARY_PROCEDURE_DEFECT'),
    '5인 미만(4인) 사업장에서도 절차 증빙 없이 감봉 요청 시 절차 미확인 경고가 발생해야 함'
  );
});

test('근로기준법 제95조 감봉 한도 캡핑: 1회 일급 1/2 및 월 총액 1/10 초과분 차단', () => {
  const singleCase = evaluateDisciplineAndCapCut({
    requestedCutAmount: 450000,
    avgDailyWage: 100000,
    monthlyGrossPay: 3000000,
    incidentCount: 1,
    lsaRegularCount: 10,
    attendanceNoticeSent: true,
    defenseOpportunityGiven: true,
    committeeResolved: true,
    writtenNoticeDelivered: true,
  });
  assert.equal(singleCase.appliedCutAmount, 50000);
  assert.equal(singleCase.blockedExcessAmount, 400000);

  const multiCase = evaluateDisciplineAndCapCut({
    requestedCutAmount: 450000,
    avgDailyWage: 100000,
    monthlyGrossPay: 3000000,
    incidentCount: 8,
    lsaRegularCount: 10,
    attendanceNoticeSent: true,
    defenseOpportunityGiven: true,
    committeeResolved: true,
    writtenNoticeDelivered: true,
  });
  assert.equal(multiCase.appliedCutAmount, 300000);
  assert.equal(multiCase.blockedExcessAmount, 150000);
});

test('퇴사 통합 정산: 통상임금 하한, 14일 기한, 지원금 감원방지 및 잘못된 사유코드 거부', () => {
  const settlement = computeOffboardingSettlement({
    resignReason: 'DISMISSAL',
    serviceDays: 730,
    weeklyHours: 40,
    threeMonthWageTotal: 7500000,
    threeMonthDays: 91,
    annualBonusTotal: 0,
    ordinaryHourlyWage: 15000,
    dailyHours: 8,
    unusedLeaveDays: 2,
    lastWorkDate: '2026-11-30',
    lsaRegularCount: 20,
    activeSubsidies: ['청년일자리도약장려금'],
    advanceNoticeDaysGiven: 5,
    writtenDismissalNoticeGiven: false,
  });

  assert.equal(settlement.ordinaryFloorApplied, true);
  assert.equal(settlement.appliedDailyWage, 120000);
  assert.equal(settlement.paymentDueDate, '2026-12-14');
  assert.ok(settlement.alerts.some((a) => a.code === 'SUBSIDY_CLAWBACK_RISK'));
  assert.ok(settlement.alerts.some((a) => a.code === 'WRITTEN_DISMISSAL_REQUIRED'));

  assert.throws(
    () => computeOffboardingSettlement({ resignReason: 'TYPO' }),
    RangeError
  );
  assert.throws(
    () => computeOffboardingSettlement({ threeMonthDays: 88 }),
    RangeError
  );
  assert.throws(
    () => computeOffboardingSettlement({ threeMonthDays: 93 }),
    RangeError
  );
  assert.throws(
    () => computeOffboardingSettlement({ threeMonthDays: 90.5 }),
    RangeError
  );
});

test('법정 문서 초안 생성기: 분기별 동적 반영(1~4분기) 및 초안 안내문 포함 검증', () => {
  const q1Doc = generateStatutoryDocument('DOC_LMC_MINUTES', {
    companyName: '(주)테스트기계',
    referenceDate: '2026-11-15',
    quarterNumber: 1,
  });
  const q3Doc = generateStatutoryDocument('DOC_LMC_MINUTES', {
    companyName: '(주)테스트기계',
    referenceDate: '2026-11-15',
    quarterNumber: 3,
  });

  assert.match(q1Doc.title, /1분기/);
  assert.match(q1Doc.body, /03월/);
  assert.match(q3Doc.title, /3분기/);
  assert.match(q3Doc.body, /09월/);
  assert.match(q1Doc.body, /초안/);
});

test('웹 서버 보안 및 입력 무결성 검증: Host·CSRF·문자열 boolean 거부·잘못된 날짜 거부·주52h 보존·413 JSON 응답', async () => {
  const { server } = createAppServer({ requirePcAuth: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. 잘못된 Host 헤더 403 차단
    const badHostStatus = await new Promise((resolve, reject) => {
      import('node:http').then(({ default: httpMod }) => {
        const req = httpMod.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/bootstrap',
            method: 'GET',
            headers: { Host: 'evil.attacker.invalid' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          }
        );
        req.on('error', reject);
        req.end();
      });
    });
    assert.equal(badHostStatus, 403);

    const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const { csrfToken } = await bootRes.json();
    const authHeaders = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Origin: baseUrl,
    };

    // 2. 문자열 'false' boolean 우회 시도 400 차단 검증 (보안 회귀)
    const strBoolOffRes = await fetch(`${baseUrl}/api/preview-offboarding`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        resignReason: 'DISMISSAL',
        writtenDismissalNoticeGiven: 'false',
      }),
    });
    assert.equal(strBoolOffRes.status, 400);

    const strBoolWorkerRes = await fetch(`${baseUrl}/api/update-worker-event`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        empCode: 'EMP-202',
        attendanceNoticeSent: 'false',
      }),
    });
    assert.equal(strBoolWorkerRes.status, 400);

    // 3. 잘못된 퇴사 사유 및 존재하지 않는 날짜 400 차단 검증
    const badReasonRes = await fetch(`${baseUrl}/api/preview-offboarding`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ resignReason: 'TYPO' }),
    });
    assert.equal(badReasonRes.status, 400);

    const badDateRes = await fetch(`${baseUrl}/api/simulate-company`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ triggerDate: '2026-99-99' }),
    });
    assert.equal(badDateRes.status, 400);

    // 3-2. 소수점 근로자 수(29.6명 -> 30인 반올림 오판 위험) 및 역일수 범위(89~92) 위반 400 차단 검증
    const fracWorkersRes = await fetch(`${baseUrl}/api/simulate-company`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ headcountInput: { regularWorkers: 29.6 } }),
    });
    assert.equal(fracWorkersRes.status, 400);

    const outOfRange3mRes = await fetch(`${baseUrl}/api/preview-offboarding`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ resignReason: 'VOLUNTARY', threeMonthDays: 88 }),
    });
    assert.equal(outOfRange3mRes.status, 400);

    const frac3mRes = await fetch(`${baseUrl}/api/preview-offboarding`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ resignReason: 'VOLUNTARY', threeMonthDays: 90.5 }),
    });
    assert.equal(frac3mRes.status, 400);

    // 4. 특정 주 53.5h 초과 기록 후 다른 필드(연장 4h)만 수정해도 주간 피크 초과 경보가 사라지지 않는지 검증
    await fetch(`${baseUrl}/api/update-worker-event`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ empCode: 'EMP-201', maxWeeklyWorkedHours: 53.5 }),
    });
    const keepPeakRes = await fetch(`${baseUrl}/api/update-worker-event`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ empCode: 'EMP-201', overtimeHours: 4 }),
    });
    assert.equal(keepPeakRes.status, 200);
    const keepPeakData = await keepPeakRes.json();
    const emp201 = keepPeakData.snapshot.payrollLines.find((l) => l.empCode === 'EMP-201');
    assert.ok(
      emp201.warnings.some((w) => w.code === 'WEEKLY_52H_EXCEEDED'),
      '기존 주간 최고 근로시간(53.5h)이 보존되어 주52시간 초과 경고가 유지되어야 함'
    );

    // 5. 66KB 초과 페이로드 전송 시 소켓 파괴 없이 정상 HTTP 413 JSON 응답 반환 검증
    const hugePayload = JSON.stringify({ title: 'A', bodyText: 'X'.repeat(68 * 1024) });
    const tooLargeRes = await fetch(`${baseUrl}/api/validate-posting`, {
      method: 'POST',
      headers: authHeaders,
      body: hugePayload,
    });
    assert.equal(tooLargeRes.status, 413);
    const tooLargeJson = await tooLargeRes.json();
    assert.match(tooLargeJson.error, /64KB/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('스타일시트 WCAG AA 명도 대비(4.5:1 이상) 및 PII 무결성 검증', () => {
  // 상대휘도 및 대비율 공식 검증 (다크 테마 --surface #131c31 대비 --accent-text #93c5fd 등)
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const chans = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2];
  };
  const contrastRatio = (c1, c2) => {
    const l1 = luminance(c1);
    const l2 = luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  assert.ok(contrastRatio('#93c5fd', '#131c31') >= 4.5, '다크 테마 STEP 텍스트 대비 AA 통과 필수');
  assert.ok(contrastRatio('#93c5fd', '#1e293b') >= 4.5, '다크 테마 선택 탭 텍스트 대비 AA 통과 필수');
  assert.ok(contrastRatio('#1d4ed8', '#ffffff') >= 4.5, '라이트 테마 STEP/Primary 대비 AA 통과 필수');
  assert.ok(contrastRatio('#2563eb', '#ffffff') >= 4.5, '다크 테마 Primary 버튼 대비 AA 통과 필수');

  const mobileCss = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'public', 'mobile.css'), 'utf8');
  assert.match(mobileCss, /--primary-text:\s*#93c5fd/);
  assert.match(mobileCss, /color:\s*var\(--primary-text\)/);

  // 저장소 전체 PII 패턴 검사
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };
  const phonePattern = /\b01[016789]-\d{3,4}-\d{4}\b/;
  const rrnPattern = /\b\d{6}-[1-8]\d{6}\b/;

  for (const file of walk(PROJECT_ROOT)) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(phonePattern.test(content), false);
    assert.equal(rrnPattern.test(content), false);
  }
});

test('프론트엔드 CSP(PC·모바일 인라인 style 0건), SW 민감캐시 차단, 모달 inert, DB 21개 테넌트 테이블 전수 RLS 검증', () => {
  const indexHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'public', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'public', 'app.js'), 'utf8');
  const mobileHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'public', 'mobile.html'), 'utf8');
  const mobileJs = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'public', 'mobile.js'), 'utf8');
  const swJs = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'public', 'sw.js'), 'utf8');
  const dbSpec = fs.readFileSync(path.join(PROJECT_ROOT, 'docs', 'DB_AND_RULES_SPEC.md'), 'utf8');

  // 1) CSP style-src 'self' 및 XSS 방어 확인 (PC + 모바일 앱 모두 innerHTML 및 인라인 style 0건)
  assert.equal(/\bstyle\s*=/i.test(indexHtml), false, 'index.html에 인라인 style 속성이 없어야 함');
  assert.equal(/\bstyle\s*=/i.test(mobileHtml), false, 'mobile.html에 인라인 style 속성이 없어야 함');
  for (const [name, src] of [['app.js', appJs], ['mobile.js', mobileJs]]) {
    assert.equal(/\bstyle\s*:/.test(src), false, `${name} h() 호출에 인라인 style 프로퍼티가 없어야 함`);
    assert.equal(/\.style\b/.test(src), false, `${name}에 DOM .style 직접 조작이 없어야 함`);
    assert.equal(/\.innerHTML\b/.test(src), false, `${name}에 .innerHTML 조작이 없어야 함`);
    assert.equal(/\blocalStorage\./.test(src), false, `${name}에 세션 토큰 localStorage 조작이 없어야 함`);
    assert.match(src, /key === 'style'|k === 'style'/);
    assert.match(src, /function setBackgroundInert\(isInert\)/);
  }

  // 2) 하드코딩 비밀번호/PIN 비노출 확인 및 PWA Service Worker /api/ 비캐시 확인
  assert.equal(/ModHr!2026/.test(mobileHtml), false, 'mobile.html에 하드코딩 비밀번호가 없어야 함');
  assert.equal(/ModHr!2026|DEMO_PIN_BY_ID/.test(mobileJs), false, 'mobile.js에 하드코딩 자격증명이 없어야 함');
  assert.match(swJs, /url\.pathname\.startsWith\('\/api\/'\)/);

  // 3) DB 명세서 19개 테넌트 테이블 전수 RLS + 해시 세션 조회 함수 + vault 분리 확인
  assert.match(dbSpec, /session_token_sha256/);
  assert.match(dbSpec, /lookup_session_by_token_sha256/);
  assert.match(
    dbSpec,
    /CREATE ROLE app_tenant_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/
  );
  assert.match(
    dbSpec,
    /CREATE ROLE vault_crypto_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS/
  );
  assert.match(dbSpec, /REVOKE ALL ON SCHEMA vault FROM PUBLIC, app_tenant_worker/);
  assert.match(dbSpec, /ALTER TABLE vault\.pii_secrets FORCE ROW LEVEL SECURITY/);

  const requiredTenantTables = [
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
    'compliance.obligations',
  ];
  for (const tbl of requiredTenantTables) {
    assert.ok(dbSpec.includes(`'${tbl}'`), `RLS 대상 배열에 ${tbl} 테이블이 포함되어야 함`);
  }
});

test('모바일 폰 앱 V2 보안·실시간 통합 검증: 비노출 난수 시드·ECDSA P-256 패스키 서명·MFA 카운터 분리·2단계 결재·급여잠금(409)·PC 경계보호·원격 기기해지·SSE', async () => {
  const cryptoMod = (await import('node:crypto')).default;
  const httpMod = (await import('node:http')).default;

  // 0. 기본 모드(demoMode=false)에서 /api/mobile/bootstrap 이 비밀번호·PIN을 절대 노출하지 않는지 검증
  const defaultApp = createAppServer();
  await new Promise((resolve) => defaultApp.server.listen(0, '127.0.0.1', resolve));
  try {
    const defPort = defaultApp.server.address().port;
    const defBoot = await (await fetch(`http://127.0.0.1:${defPort}/api/mobile/bootstrap`)).json();
    for (const acc of defBoot.demoAccounts) {
      assert.equal(acc.demoPassword, undefined, '기본 보안 모드에서 비밀번호가 노출되면 안 됨');
      assert.equal(acc.demoPin, undefined, '기본 보안 모드에서 PIN이 노출되면 안 됨');
    }
  } finally {
    await new Promise((resolve) => defaultApp.server.close(resolve));
  }

  const testSeeds = {
    ceo: { password: 'TestCeo!9912', pin: '258080' },
    'hr.admin': { password: 'TestHr!8823', pin: '135790' },
    'dept.lead': { password: 'TestMgr!7734', pin: '246810' },
    'emp.201': { password: 'TestWrk!6645', pin: null },
  };

  const { server } = createAppServer({ seedCredentials: testSeeds });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const extractSessionCookie = (res) => {
    const raw = res.headers.get('set-cookie') || '';
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /SameSite=Strict/i);
    return raw.split(';')[0];
  };

  try {
    // 0-2. 기본 보안 정책(requirePcAuth=true): 무인증(쿠키 없음) 요청 시 PC /api/bootstrap 도 401 차단 필수!
    const unauthPcBootRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(unauthPcBootRes.status, 401, '무인증 PC /api/bootstrap 요청은 기본 401로 차단되어야 함');

    const bootRes = await fetch(`${baseUrl}/api/mobile/bootstrap`);
    assert.equal(bootRes.status, 200);
    const { loginCsrfToken } = await bootRes.json();

    // 1. 대표이사(CEO) 1차 로그인 -> MFA_PENDING 상태에서 모바일 대시보드 및 PC API 조기 접근 403 차단 검증
    const ceoLogin1 = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        loginId: 'ceo',
        password: testSeeds.ceo.password,
        deviceLabel: '대표님 iPhone 16 Pro',
        platformType: 'IOS_PWA',
      }),
    });
    assert.equal(ceoLogin1.status, 200);
    let ceoCookie = extractSessionCookie(ceoLogin1);
    const { session: ceoPending1 } = await ceoLogin1.json();
    assert.equal(ceoPending1.authStage, 'MFA_PENDING');

    const earlyDashRes = await fetch(`${baseUrl}/api/mobile/dashboard`, {
      headers: { Cookie: ceoCookie },
    });
    assert.equal(earlyDashRes.status, 403);

    const earlyPcGuardRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: ceoCookie },
    });
    assert.equal(earlyPcGuardRes.status, 403, 'MFA_PENDING 쿠키로 PC 전사 API 접근 시 차단되어야 함');

    // PIN으로 1회 정상 인증 후 PIN 재확인을 거쳐 ECDSA P-256 공개키(SPKI) 등록 -> 재로그인 후 실제 암호화 서명 검증
    const ceoPinVerify = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending1.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds.ceo.pin }),
    });
    assert.equal(ceoPinVerify.status, 200);

    const { publicKey, privateKey } = cryptoMod.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicKeySpkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    // PIN 재입력 누락 시 400 및 오입력 시 401 차단 검증
    const regNoPinRes = await fetch(`${baseUrl}/api/mobile/passkey/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending1.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ publicKeySpkiBase64 }),
    });
    assert.equal(regNoPinRes.status, 400);

    const regWrongPinRes = await fetch(`${baseUrl}/api/mobile/passkey/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending1.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ currentPin: '000000', publicKeySpkiBase64 }),
    });
    assert.equal(regWrongPinRes.status, 401);

    const regPkRes = await fetch(`${baseUrl}/api/mobile/passkey/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending1.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ currentPin: testSeeds.ceo.pin, publicKeySpkiBase64 }),
    });
    assert.equal(regPkRes.status, 200);
    const { credentialId: registeredCredId } = await regPkRes.json();
    assert.match(registeredCredId, /^PK-/);

    // 로그아웃 후 패스키 전자서명으로 재로그인 검증
    await fetch(`${baseUrl}/api/mobile/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending1.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });

    const ceoLogin2 = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        loginId: 'ceo',
        password: testSeeds.ceo.password,
        deviceLabel: '대표님 iPhone 16 Pro',
        platformType: 'IOS_PWA',
      }),
    });
    ceoCookie = extractSessionCookie(ceoLogin2);
    const { session: ceoPending2 } = await ceoLogin2.json();

    const chalRes1 = await fetch(`${baseUrl}/api/mobile/mfa/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending2.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    assert.equal(chalRes1.status, 200);
    const { challenge: ch1 } = await chalRes1.json();
    assert.equal(ch1.credentialId, undefined, '챌린지 응답에 credentialId가 노출되면 안 됨');

    // 위조 서명 제출 시 401 차단 및 일회용 챌린지 소모 확인
    const forgedSigRes = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending2.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        method: 'PASSKEY',
        challengeId: ch1.challengeId,
        credentialId: registeredCredId,
        clientDataJSON: JSON.stringify({
          type: 'mhr.passkey.get',
          challenge: ch1.nonce,
          origin: baseUrl,
        }),
        signatureBase64: Buffer.alloc(64, 1).toString('base64'),
      }),
    });
    assert.equal(forgedSigRes.status, 401);

    // 새 일회용 챌린지 발급 후 실제 ECDSA P-256(ieee-p1363) 전자서명으로 통과(200)
    const chalRes2 = await fetch(`${baseUrl}/api/mobile/mfa/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending2.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    const { challenge: ch2 } = await chalRes2.json();
    const clientDataJSON = JSON.stringify({
      type: 'mhr.passkey.get',
      challenge: ch2.nonce,
      origin: baseUrl,
    });
    const validSigB64 = cryptoMod
      .sign('sha256', Buffer.from(clientDataJSON, 'utf8'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      .toString('base64');

    const ceoMfaOkRes = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending2.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        method: 'PASSKEY',
        challengeId: ch2.challengeId,
        credentialId: registeredCredId,
        clientDataJSON,
        signatureBase64: validSigB64,
      }),
    });
    assert.equal(ceoMfaOkRes.status, 200);
    const { session: ceoSession } = await ceoMfaOkRes.json();
    assert.equal(ceoSession.authStage, 'AUTHENTICATED');

    // 2. CEO 실시간 SSE 스트림 연결 및 근로자 출근 이벤트 실시간 푸시 수신 검증
    const sseEvents = [];
    const activeSseReq = await new Promise((resolve, reject) => {
      const sseReq = httpMod.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/mobile/stream',
          method: 'GET',
          headers: { Cookie: ceoCookie },
        },
        (sseRes) => {
          sseRes.setEncoding('utf8');
          sseRes.on('data', (chunk) => {
            sseEvents.push(chunk);
            if (chunk.includes('event: connected')) {
              resolve(sseReq);
            }
          });
        }
      );
      sseReq.on('error', reject);
      sseReq.end();
    });

    // 3. 근로자(emp.201) 로그인 -> PC 전사 API 우회 접근 차단(403) -> 출근 체크 시 CEO SSE 즉시 수신!
    const wrkLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        loginId: 'emp.201',
        password: testSeeds['emp.201'].password,
        deviceLabel: '김하늘 사원 폰',
        platformType: 'ANDROID_PWA',
      }),
    });
    assert.equal(wrkLoginRes.status, 200);
    const wrkCookie = extractSessionCookie(wrkLoginRes);
    const { session: wrkSession } = await wrkLoginRes.json();

    const wrkPcBypassRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: wrkCookie },
    });
    assert.equal(wrkPcBypassRes.status, 403, 'WORKER 모바일 세션으로 PC 전사 급여 API 접근 시 차단 필수');

    const noConsentClock = await fetch(`${baseUrl}/api/mobile/worker/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ action: 'CLOCK_IN', locationConsent: false }),
    });
    assert.equal(noConsentClock.status, 400);

    const okClock = await fetch(`${baseUrl}/api/mobile/worker/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ action: 'CLOCK_IN', locationConsent: true }),
    });
    assert.equal(okClock.status, 200);

    await new Promise((r) => setTimeout(r, 40));
    assert.ok(
      sseEvents.some((chunk) => chunk.includes('WORKER_CLOCK_IN')),
      '근로자 모바일 출근 즉시 대표이사 SSE 스트림으로 실시간 알림이 도착해야 함'
    );
    activeSseReq.destroy();

    // 근로자의 권한 밖 접근(급여승인·회사규정 열람) 403 차단 검증
    const wrkApprovePay = await fetch(`${baseUrl}/api/mobile/approve-payroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    assert.equal(wrkApprovePay.status, 403);

    const wrkForbiddenDoc = await fetch(`${baseUrl}/api/mobile/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_LMC_REGULATION_AND_FILING' }),
    });
    assert.equal(wrkForbiddenDoc.status, 403);

    // 4. 부서장(dept.lead) 및 인사팀장(hr.admin) 로그인 -> RBAC 경고 필터링 및 2단계 결재 상태 머신 검증
    const mgrLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        loginId: 'dept.lead',
        password: testSeeds['dept.lead'].password,
        deviceLabel: '팀장 태블릿',
        platformType: 'MOBILE_WEB',
      }),
    });
    const mgrCookie = extractSessionCookie(mgrLoginRes);
    const { session: mgrPending } = await mgrLoginRes.json();

    await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mgrCookie,
        'X-CSRF-Token': mgrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds['dept.lead'].pin }),
    });

    const mgrPcBypass = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: mgrCookie },
    });
    assert.equal(mgrPcBypass.status, 403);

    const mgrDashRes = await fetch(`${baseUrl}/api/mobile/dashboard`, {
      headers: { Cookie: mgrCookie },
    });
    const { dashboard: mgrDash } = await mgrDashRes.json();
    assert.equal(mgrDash.payrollSummary, null);
    assert.ok(mgrDash.workersAttendance.every((w) => w.deptName === '생산기술1팀'));
    assert.ok(
      mgrDash.workersAttendance.every((w) =>
        w.warnings.every((warn) => warn.code.startsWith('WEEKLY_52H'))
      ),
      '부서관리자에게 시급·감봉액 등 임금 경고가 노출되면 안 됨'
    );
    assert.ok(
      mgrDash.notifications.every(
        (n) =>
          n.eventCode !== 'PASSKEY_REGISTERED' &&
          n.eventCode !== 'COMPLIANCE_DDAY_ALERT' &&
          n.eventCode !== 'DEVICE_REVOKED'
      ),
      '부서관리자에게 전사 보안·법정신고 알림이 노출되면 안 됨'
    );

    // 타 부서(APR-102, PENDING_CEO) 승인 시도 -> 403 차단
    const crossDeptApprove = await fetch(`${baseUrl}/api/mobile/decide-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mgrCookie,
        'X-CSRF-Token': mgrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ requestId: 'APR-102', decision: 'APPROVE' }),
    });
    assert.equal(crossDeptApprove.status, 403);

    // 본인 부서(APR-101, PENDING_DEPT) 1차 승인 -> PENDING_CEO 로 승격되어야 함 (즉시 APPROVED 우회 금지!)
    const step1ApproveRes = await fetch(`${baseUrl}/api/mobile/decide-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mgrCookie,
        'X-CSRF-Token': mgrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ requestId: 'APR-101', decision: 'APPROVE' }),
    });
    assert.equal(step1ApproveRes.status, 200);
    const step1ApproveJson = await step1ApproveRes.json();
    assert.equal(step1ApproveJson.decided.status, 'PENDING_CEO');

    // 인사팀장(hr.admin) 로그인 -> PENDING_CEO 결재 시도 시 403 차단 확인
    const hrLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        loginId: 'hr.admin',
        password: testSeeds['hr.admin'].password,
        deviceLabel: '인사팀장 폰',
        platformType: 'ANDROID_PWA',
      }),
    });
    const hrCookie = extractSessionCookie(hrLoginRes);
    const { session: hrPending } = await hrLoginRes.json();
    await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: hrCookie,
        'X-CSRF-Token': hrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds['hr.admin'].pin }),
    });

    const hrTryCeoStage = await fetch(`${baseUrl}/api/mobile/decide-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: hrCookie,
        'X-CSRF-Token': hrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ requestId: 'APR-101', decision: 'APPROVE' }),
    });
    assert.equal(hrTryCeoStage.status, 403, 'PENDING_CEO 단계는 대표이사(CEO)만 최종 승인 가능해야 함');

    // 잘못된 taskId 허용목록 외 입력 400 차단 확인
    const badTaskRes = await fetch(`${baseUrl}/api/mobile/toggle-statutory-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: hrCookie,
        'X-CSRF-Token': hrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ taskId: 'INVALID_ARBITRARY_TASK' }),
    });
    assert.equal(badTaskRes.status, 400);

    // CEO가 APR-101 최종 승인 -> APPROVED 전환 및 주 52.5h 초과 경보 반영!
    const ceoFinalApprove = await fetch(`${baseUrl}/api/mobile/decide-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ requestId: 'APR-101', decision: 'APPROVE' }),
    });
    assert.equal(ceoFinalApprove.status, 200);
    const ceoFinalJson = await ceoFinalApprove.json();
    assert.equal(ceoFinalJson.decided.status, 'APPROVED');

    // 5. CEO 급여 최종 승인(APPROVED_LOCKED) 후 재상신·PC 급여수정·추가 연장신청 모두 409 잠금 차단 검증
    const ceoPayApprove = await fetch(`${baseUrl}/api/mobile/approve-payroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    assert.equal(ceoPayApprove.status, 200);
    const ceoPayData = await ceoPayApprove.json();
    assert.equal(ceoPayData.payrollCloseState.status, 'APPROVED_LOCKED');
    assert.equal(ceoPayData.dashboard.kpis.weekly52ExceededCount, 1);

    const hrReopenBlocked = await fetch(`${baseUrl}/api/mobile/submit-payroll-close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: hrCookie,
        'X-CSRF-Token': hrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    assert.equal(hrReopenBlocked.status, 409, '대표 최종 승인 잠금 후 인사팀 재상신으로 잠금이 풀리면 안 됨');

    const pcBootAuthRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: ceoCookie },
    });
    assert.equal(pcBootAuthRes.status, 200, 'CEO 2차 인증 쿠키 보유 시 PC /api/bootstrap 정상 접근');
    const { csrfToken: pcCsrfToken, snapshot: lockedSnapBefore } = await pcBootAuthRes.json();
    assert.equal(
      pcCsrfToken,
      ceoSession.csrfToken,
      'PC 관리자 CSRF 토큰은 전역 공개 토큰이 아닌 인증된 세션 전용 토큰에 바인딩되어야 함'
    );

    const pcGlobalCsrfRejected = await fetch(`${baseUrl}/api/toggle-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ taskId: 'TASK_LMC_RULES_FILING' }),
    });
    assert.equal(pcGlobalCsrfRejected.status, 403, '무인증 loginCsrfToken으로 PC 쓰기 요청 시 403 거부되어야 함');

    const pcMutateWhileLocked = await fetch(`${baseUrl}/api/update-worker-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': pcCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-201', baseMonthlyPay: 4000000 }),
    });
    assert.equal(pcMutateWhileLocked.status, 409, '급여 잠금 후 PC 근로자 급여 수정도 409로 차단되어야 함');

    const pcResetBypassBlocked = await fetch(`${baseUrl}/api/simulate-company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': pcCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ resetWorkers: true }),
    });
    assert.equal(
      pcResetBypassBlocked.status,
      409,
      '급여 잠금 후 resetWorkers 또는 presetId를 통한 잠금 우회 해제도 409로 차단되어야 함'
    );

    const pcHeadcountBypassBlocked = await fetch(`${baseUrl}/api/simulate-company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': pcCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ headcountInput: { regularWorkers: 2 } }),
    });
    assert.equal(
      pcHeadcountBypassBlocked.status,
      409,
      '급여 잠금 후 headcountInput 변경을 통한 5인 미만 가산배율 변동 우회도 409로 전면 차단되어야 함'
    );

    const pcBootAfterRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: ceoCookie },
    });
    const { snapshot: lockedSnapAfter } = await pcBootAfterRes.json();
    assert.equal(
      lockedSnapAfter.payrollSummary.totalNet,
      lockedSnapBefore.payrollSummary.totalNet,
      '급여 잠금 이후 확정 실수령 총액이 변동되면 안 됨'
    );

    const wrkOvertimeWhileLocked = await fetch(`${baseUrl}/api/mobile/worker/request-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ requestType: 'OVERTIME', amount: 2, reason: '잠금 후 연장 신청' }),
    });
    assert.equal(wrkOvertimeWhileLocked.status, 409);

    // 6. 부서장 기기 원격 강제 로그아웃 후 즉시 401 차단 검증
    const revokeRes = await fetch(`${baseUrl}/api/mobile/revoke-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ deviceId: mgrPending.deviceId }),
    });
    assert.equal(revokeRes.status, 200);

    const revokedMgrCheck = await fetch(`${baseUrl}/api/mobile/dashboard`, {
      headers: { Cookie: mgrCookie },
    });
    assert.equal(revokedMgrCheck.status, 401, '원격 해제된 기기 세션은 즉시 401로 차단되어야 함');

    // 7. 1차 재로그인(loginStep1)을 끼워 넣어도 2차 PIN 실패 카운터(mfaFailedAttempts)가 초기화되지 않고 5회째 429 잠금되는지 검증!
    const pinLockLoginA = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ loginId: 'hr.admin', password: testSeeds['hr.admin'].password }),
    });
    const lockCookieA = extractSessionCookie(pinLockLoginA);
    const { session: lockSessA } = await pinLockLoginA.json();

    for (let i = 0; i < 4; i++) {
      const badPinRes = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: lockCookieA,
          'X-CSRF-Token': lockSessA.csrfToken,
          Origin: baseUrl,
        },
        body: JSON.stringify({ method: 'PIN', pin: '000000' }),
      });
      assert.equal(badPinRes.status, 401);
    }

    // 4회 틀린 뒤 1차 비밀번호 로그인을 다시 성공시켜 카운터 초기화를 시도!
    const pinLockLoginB = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ loginId: 'hr.admin', password: testSeeds['hr.admin'].password }),
    });
    const lockCookieB = extractSessionCookie(pinLockLoginB);
    const { session: lockSessB } = await pinLockLoginB.json();

    // 5번째 오입력 시 카운터가 보존되어 즉시 429 ACCOUNT_LOCKED가 발동되어야 함!
    const fifthBadPinRes = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: lockCookieB,
        'X-CSRF-Token': lockSessB.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: '000000' }),
    });
    assert.equal(
      fifthBadPinRes.status,
      429,
      '1차 재로그인으로 MFA 실패 횟수를 우회 초기화할 수 없어야 함'
    );

    // 8. 미등록 아이디도 5회 실패 시 동일하게 429 잠금을 반환(계정 존재 열거 차단)하며 타 계정 로그인은 정상 허용(전역 DoS 방지)되는지 검증!
    let ghostLastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const ghostRes = await fetch(`${baseUrl}/api/mobile/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': loginCsrfToken,
          Origin: baseUrl,
        },
        body: JSON.stringify({ loginId: 'unknown.ghost.user', password: 'bad-password' }),
      });
      ghostLastStatus = ghostRes.status;
    }
    assert.equal(ghostLastStatus, 429, '미등록 아이디도 5회 실패 시 실존 계정과 동일하게 429를 반환해야 함');

    const otherAccountStillWorks = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(otherAccountStillWorks.status, 200, '타인의 로그인 폭주가 정상 계정의 로그인을 차단하면 안 됨');

    // 9. MHR_INIT_CREDENTIALS_JSON 엄격 검증 및 데모 모드 동시 사용 기동 거부 검증
    const prevEnvSeed = process.env.MHR_INIT_CREDENTIALS_JSON;
    try {
      process.env.MHR_INIT_CREDENTIALS_JSON = '{broken-json';
      assert.throws(() => createMobileHub({}), /올바른 JSON/);

      process.env.MHR_INIT_CREDENTIALS_JSON = JSON.stringify({
        ceo: { password: 'short', pin: '123456' },
      });
      assert.throws(() => createMobileHub({}), /최소 8자/);

      process.env.MHR_INIT_CREDENTIALS_JSON = JSON.stringify({
        ceo: { password: 'ValidPassword!99', pin: '12ab' },
      });
      assert.throws(() => createMobileHub({}), /6자리 숫자/);

      process.env.MHR_INIT_CREDENTIALS_JSON = JSON.stringify({
        ceo: { password: 'ValidPassword!99', pin: '654321' },
      });
      assert.throws(() => createMobileHub({ demoMode: true }), /보안 정책 위반/);
    } finally {
      if (prevEnvSeed === undefined) {
        delete process.env.MHR_INIT_CREDENTIALS_JSON;
      } else {
        process.env.MHR_INIT_CREDENTIALS_JSON = prevEnvSeed;
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('멀티문서 무입력 자동 온보딩 엔진: PII 즉시 마스킹, 업종(KSIC) 추론, 대표자 분리, 건보↔고보 교차대사 및 상실자 자동분기 검증', () => {
  // 1. 런타임 동적 조합 문자열로 주민번호·휴대전화번호 즉시 비식별 마스킹 검증 (소스파일 내 리터럴 PII 미포함)
  const syntheticRrn = `${'900315'}-${'1'}${'234567'}`;
  const syntheticPhone = `${'010'}-${'9876'}-${'5432'}`;
  const sanitized = redactAndSanitizeDocText(`성명: 홍길동, 주민번호: ${syntheticRrn}, 연락처: ${syntheticPhone}`);
  assert.equal(sanitized.includes(syntheticRrn), false, '원문 주민번호가 남으면 안 됨');
  assert.equal(sanitized.includes(syntheticPhone), false, '원문 전화번호가 남으면 안 됨');
  assert.match(sanitized, /900315-\*{7}/);
  assert.match(sanitized, /010-\*{4}-\*{4}/);

  // 2. 제조업 57인 4종 문서 번들 대사 검증
  const mfgStage = stageMultiDocumentBundle({
    ...SAMPLE_INGESTION_BUNDLES.BUNDLE_MFG_58,
    referenceDate: '2026-11-15',
  });
  assert.equal(mfgStage.extractedProfile.ksicMajor, 'C');
  assert.equal(mfgStage.excludedEmployers.length, 1, '건강보험 직장가입 대표자(사용자)는 상시근로자에서 자동 분리되어야 함');
  assert.equal(mfgStage.activeWorkers.length, 56, '상용 54명 + 단시간 2명 = 재직 급여원장 56명');
  assert.equal(mfgStage.offboardedWorkers.length, 3, '상실일 보유 3명은 퇴사자 원장으로 자동 편입되어야 함');
  assert.ok(mfgStage.compliancePreview.headcounts.lsaRegularCount >= 50);
  assert.ok(mfgStage.compliancePreview.headcounts.oshRegularCount >= 60);

  const autoModIds = mfgStage.compliancePreview.autoActivatedModules.map((m) => m.id);
  assert.ok(autoModIds.includes('M10_LMC'), '30인 이상 노사협의회 자동 개설 포함 필수');
  assert.ok(autoModIds.includes('M10_OSH_DIS'), '50인 이상 제조업 안전보건관리체제 자동 개설 포함 필수');

  const alertCodes = mfgStage.reconciliationAlerts.map((a) => a.code);
  assert.ok(alertCodes.includes('EMPLOYER_AUTO_EXCLUDED'));
  assert.ok(alertCodes.includes('NHIS_ONLY_NO_EI'), '고용보험 누락자(한소희) 탐지 필수');
  assert.ok(alertCodes.includes('COMPENSATION_GAP'), '건보↔고보 보수월액 10%+ 괴리자(이지안) 탐지 필수');
  assert.ok(alertCodes.includes('EI_SHORT_OR_DAILY_EXEMPT_NHIS'), '일용직 건강보험 제외 적법 판별 필수');
  assert.ok(alertCodes.includes('INGESTED_SUBSIDY_RISK'), '상실코드 26 권고사직자 고용지원금 감원방지 경보 필수');

  // 3. IT·SW 34인 번들: 노사협의회(30+) 발동 vs 안전보건관리자(IT 업종) 미발동 검증
  const itStage = stageMultiDocumentBundle({
    ...SAMPLE_INGESTION_BUNDLES.BUNDLE_IT_34,
    referenceDate: '2026-11-15',
  });
  assert.equal(itStage.extractedProfile.ksicMajor, 'J');
  const itModIds = itStage.compliancePreview.autoActivatedModules.map((m) => m.id);
  assert.ok(itModIds.includes('M10_LMC'));
  assert.equal(itModIds.includes('M10_OSH_DIS'), false);

  // 4. 멀티파일 배열(`files`) 자동 분류 검증
  const fileBasedStage = stageMultiDocumentBundle({
    referenceDate: '2026-11-15',
    files: [
      { fileName: '01_사업자등록증.txt', content: SAMPLE_INGESTION_BUNDLES.BUNDLE_IT_34.businessRegistrationText },
      { fileName: '02_회사홍보자료.txt', content: SAMPLE_INGESTION_BUNDLES.BUNDLE_IT_34.companyBrochureText },
      { fileName: '03_건강보험내역.csv', content: SAMPLE_INGESTION_BUNDLES.BUNDLE_IT_34.healthInsuranceText },
      { fileName: '04_고용보험내역.csv', content: SAMPLE_INGESTION_BUNDLES.BUNDLE_IT_34.employmentInsuranceText },
    ],
  });
  assert.equal(fileBasedStage.classifiedFiles.length, 4);
  assert.equal(fileBasedStage.activeWorkers.length, 34);
  assert.equal(fileBasedStage.offboardedWorkers.length, 1);
});

test('전 주기 퇴사자 통합관리 & 멀티문서 개통 서버 통합 검증: 모바일 세션 즉시 차단 · 제39조 사용증명서 · 제42조 3년 보존 가드레일 · 급여잠금(409)', async () => {
  const testSeeds = {
    ceo: { password: 'TestCeo!9912', pin: '258080' },
    'hr.admin': { password: 'TestHr!8823', pin: '135790' },
    'dept.lead': { password: 'TestMgr!7734', pin: '246810' },
    'emp.201': { password: 'TestWrk!6645', pin: null },
  };

  const { server } = createAppServer({ seedCredentials: testSeeds });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const extractCookie = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

  try {
    const { loginCsrfToken } = await (await fetch(`${baseUrl}/api/mobile/bootstrap`)).json();

    // 1. CEO 2FA 로그인 및 근로자(emp.201) 모바일 로그인
    const ceoRes1 = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'ceo', password: testSeeds.ceo.password }),
    });
    const ceoCookie = extractCookie(ceoRes1);
    const { session: ceoPending } = await ceoRes1.json();
    const ceoMfaRes = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds.ceo.pin }),
    });
    const { session: ceoSession } = await ceoMfaRes.json();

    const wrkLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(wrkLoginRes.status, 200);
    const wrkCookie = extractCookie(wrkLoginRes);

    // 2. PC에서 멀티문서 번들(BUNDLE_MFG_58) 일괄 개통 -> 전 모듈·재직자·퇴사자 원장·모바일 동시 동기화 확인
    const commitRes = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_MFG_58' }),
    });
    assert.equal(commitRes.status, 200);
    const commitData = await commitRes.json();
    assert.equal(commitData.snapshot.company.companyName, '주식회사 한빛정밀메카트로닉스');
    assert.equal(commitData.snapshot.workers.length, 56);
    assert.equal(commitData.snapshot.offboardedWorkers.length, 3);

    // 3. 부서장(DEPT_MANAGER)은 퇴사자 원장 조회(빈 배열) 및 상태 변경(403) 불가 확인
    const mgrLogin = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'dept.lead', password: testSeeds['dept.lead'].password }),
    });
    const mgrCookie = extractCookie(mgrLogin);
    const { session: mgrPending } = await mgrLogin.json();
    await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mgrCookie,
        'X-CSRF-Token': mgrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds['dept.lead'].pin }),
    });
    const mgrDash = await (
      await fetch(`${baseUrl}/api/mobile/dashboard`, { headers: { Cookie: mgrCookie } })
    ).json();
    assert.equal(mgrDash.dashboard.offboardedSummary, null);
    assert.equal(mgrDash.dashboard.offboardedWorkers.length, 0);

    const mgrForbiddenAlumni = await fetch(`${baseUrl}/api/mobile/offboarded/update-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mgrCookie,
        'X-CSRF-Token': mgrPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-191', settlementStatus: 'PAID' }),
    });
    assert.equal(mgrForbiddenAlumni.status, 403);

    // 4. 재직자 EMP-201(김하늘) 퇴사 전환 -> 퇴사자 원장 등록 + 모바일 세션 즉시 401 차단 + 재로그인 403 차단 검증!
    const offboardRes = await fetch(`${baseUrl}/api/offboard-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        empCode: 'EMP-201',
        lastWorkDate: '2026-11-15',
        resignReason: 'RECOMMENDED',
        unusedLeaveDays: 4,
      }),
    });
    assert.equal(offboardRes.status, 200);
    const offboardJson = await offboardRes.json();
    assert.equal(offboardJson.offboardedRecord.settlementDueDate, '2026-11-29');
    assert.equal(offboardJson.offboardedRecord.subsidyClawbackRisk, true);
    assert.equal(offboardJson.revokedSessionCount, 1);

    const revokedWrkDash = await fetch(`${baseUrl}/api/mobile/dashboard`, {
      headers: { Cookie: wrkCookie },
    });
    assert.equal(revokedWrkDash.status, 401, '퇴사 처리 즉시 기존 근로자 모바일 세션은 차단되어야 함');

    const wrkReloginBlocked = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(wrkReloginBlocked.status, 403, '퇴사 처리된 사번 계정의 모바일 재로그인도 403 차단되어야 함');

    // 5. 사용증명서(경력증명서, 제39조) 발급 -> 불이익 퇴사사유 미기재 확인
    const certRes = await fetch(`${baseUrl}/api/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_CAREER_CERTIFICATE', empCode: 'EMP-201' }),
    });
    assert.equal(certRes.status, 200);
    const certJson = await certRes.json();
    assert.match(certJson.document.body, /근로기준법 제39조 제2항에 따라 미기재/);
    assert.equal(/권고사직/.test(certJson.document.body), false, '사용증명서 본문에 권고사직 등 사유가 노출되면 안 됨');

    // 6. 근로기준법 제42조 3년 보존 가드레일: 3년 미경과 퇴사자(EMP-201) 파기 요청 시 409 차단 vs 3년 경과자(EMP-105) 200 비식별 파기!
    const earlyPurgeRes = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-201' }),
    });
    assert.equal(earlyPurgeRes.status, 409, '퇴사 후 3년 미경과 서류는 임의 파기가 409로 차단되어야 함');

    const validPurgeRes = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-105' }),
    });
    assert.equal(validPurgeRes.status, 200, '퇴사 후 3년 경과 서류는 개인정보보호법 제21조에 따라 적법 비식별 파기');
    const validPurgeJson = await validPurgeRes.json();
    assert.equal(validPurgeJson.purged.dataLifecycleStatus, 'ANONYMIZED_PURGED');
    assert.match(validPurgeJson.purged.displayName, /^비식별파기/);

    const certAfterPurge = await fetch(`${baseUrl}/api/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_CAREER_CERTIFICATE', empCode: 'EMP-105' }),
    });
    assert.equal(certAfterPurge.status, 409);

    // 7. 대표이사 모바일에서 당월 급여 최종 승인(APPROVED_LOCKED) 후 멀티문서 덮어쓰기·추가 퇴사전환 모두 409 차단 검증
    await fetch(`${baseUrl}/api/mobile/approve-payroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });

    const commitWhileLocked = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_IT_34' }),
    });
    assert.equal(commitWhileLocked.status, 409);

    const offboardWhileLocked = await fetch(`${baseUrl}/api/offboard-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-202', lastWorkDate: '2026-11-15' }),
    });
    assert.equal(offboardWhileLocked.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('보안·경계 회귀 검증: 보존중 원장 재개통 보호 · 사번 재사용/타사업장 세션차단 · 미래 기준일 파기우회 차단 · 비가역 파기 및 복제본 제거 · 일용/3.3%/단위셀 검증', async () => {
  // 1. 단위 포함 CSV 셀("4일", "12일", "25시간") 정상 파싱 및 문서 legalBasis 반환 검증
  const unitStage = stageMultiDocumentBundle({
    referenceDate: '2026-11-15',
    employmentInsuranceText: [
      '사번,성명,생년월일,고용형태,주소정근로시간,취득일,상실일,상실사유코드,월평균보수,미사용연차,월근무일수',
      'EMP-301,장단위,920101-*******,단시간,25시간,2024-01-01,2026-11-10,11,180만원,4일,15일',
      'DLY-310,박일용,850505-*******,일용,40시간,2026-11-01,,,200만원,0일,12일',
    ].join('\n'),
  });
  assert.equal(unitStage.offboardedWorkers[0].unusedLeaveDays, 4, '"4일" 단위 포함 연차일수가 누락되면 안 됨');
  assert.equal(unitStage.offboardedWorkers[0].weeklyContractHours, 25, '"25시간" 단위 포함 주근로시간 파싱 필수');
  assert.equal(unitStage.stagedCompany.headcountInput.dailyWorkerManDays, 12, '"12일" 단위 포함 일용 근무일수 파싱 필수');

  const sampleDoc = generateStatutoryDocument('DOC_LMC_REGULATION_AND_FILING', { companyName: '테스트사' });
  assert.ok(sampleDoc.legalBasis && sampleDoc.legalBasis.length > 5, '모바일 모달용 legalBasis 필드 포함 필수');

  const testSeeds = {
    ceo: { password: 'TestCeo!9912', pin: '258080' },
    'hr.admin': { password: 'TestHr!8823', pin: '135790' },
    'dept.lead': { password: 'TestMgr!7734', pin: '246810' },
    'emp.201': { password: 'TestWrk!6645', pin: null },
  };

  const { server } = createAppServer({ seedCredentials: testSeeds, serverTodayIso: '2026-11-15' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const extractCookie = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

  try {
    const { loginCsrfToken } = await (await fetch(`${baseUrl}/api/mobile/bootstrap`)).json();

    // 2. DESKTOP_PWA 플랫폼 보존 및 CEO 2FA 세션 수립
    const ceoRes1 = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({
        loginId: 'ceo',
        password: testSeeds.ceo.password,
        deviceLabel: 'PC 통합콘솔',
        platformType: 'DESKTOP_PWA',
      }),
    });
    const ceoCookie = extractCookie(ceoRes1);
    const { session: ceoPending } = await ceoRes1.json();
    assert.equal(ceoPending.platformType, 'DESKTOP_PWA', 'DESKTOP_PWA 플랫폼 타입이 유지되어야 함');

    const ceoMfa = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds.ceo.pin }),
    });
    const { session: ceoSession } = await ceoMfa.json();

    // 3. 3.3% 사업소득자(EXT-401) 퇴사원장 전환 시 400 거부 & 일용직(DLY-301) 퇴사 시 상용직 인원수 보존·연인원만 차감 검증
    const bootBefore = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: ceoCookie } })).json();
    const regBefore = bootBefore.snapshot.company.headcountInput.regularWorkers;
    const manDaysBefore = bootBefore.snapshot.company.headcountInput.dailyWorkerManDays;

    const biz33Reject = await fetch(`${baseUrl}/api/offboard-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EXT-401', lastWorkDate: '2026-11-15' }),
    });
    assert.equal(biz33Reject.status, 400, '3.3% 사업소득 외주계약자는 근로자 퇴사원장 전환 시 400 거부되어야 함');

    const dailyOffRes = await fetch(`${baseUrl}/api/offboard-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'DLY-301', lastWorkDate: '2026-11-15' }),
    });
    assert.equal(dailyOffRes.status, 200);
    const dailyOffJson = await dailyOffRes.json();
    assert.equal(
      dailyOffJson.snapshot.company.headcountInput.regularWorkers,
      regBefore,
      '일용직 퇴사 처리 시 상용직(regularWorkers) 수가 차감되면 안 됨'
    );
    assert.equal(
      dailyOffJson.snapshot.company.headcountInput.dailyWorkerManDays,
      manDaysBefore - 8,
      '일용직 퇴사 처리 시 일용 연인원(dailyWorkerManDays)이 차감되어야 함'
    );
    assert.equal(dailyOffJson.offboardedRecord.baseMonthlyPay, 170000 * 8);

    // 4. 미래 기준일(2035-01-01)로 시뮬레이션 날짜를 조작해도 서버 현재시각 기준 3년 미경과 레코드(EMP-191) 파기는 409 차단!
    const simFutureRes = await fetch(`${baseUrl}/api/simulate-company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ referenceDate: '2035-01-01' }),
    });
    assert.equal(simFutureRes.status, 200);

    const bypassPurgeAttempt = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-191' }),
    });
    assert.equal(
      bypassPurgeAttempt.status,
      409,
      '시뮬레이션 기준일을 2035년으로 바꿔도 서버 실제 시계 기준 보존기간 내 서류 파기는 409 차단 필수'
    );

    // 기준일 원복
    await fetch(`${baseUrl}/api/simulate-company`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ referenceDate: '2026-11-15' }),
    });

    // 5. 3년 만료 레코드(EMP-105 노기범) 파기 후 사번·성명·부서·날짜·급여 및 감사로그/알림 복제본 잔존 0건 검증
    await fetch(`${baseUrl}/api/offboarded/update-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-105', settlementStatus: 'PAID' }),
    });

    const purgeOkRes = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-105' }),
    });
    assert.equal(purgeOkRes.status, 200);
    const purgeOkJson = await purgeOkRes.json();
    assert.match(purgeOkJson.purged.empCode, /^PURGED-/);
    assert.equal(purgeOkJson.purged.hireDate, null);
    assert.equal(purgeOkJson.purged.lastWorkDate, null);
    assert.equal(purgeOkJson.purged.baseMonthlyPay, 0);
    assert.equal(purgeOkJson.purged.totalSettlementGross, 0);

    const { sampleIngestionBundles: _staticSamples, ...liveStateAfterPurge } = purgeOkJson.snapshot;
    const serializedAfterPurge = JSON.stringify(liveStateAfterPurge);
    assert.equal(serializedAfterPurge.includes('EMP-105'), false, '파기 완료 후 런타임 원장/감사로그에 구 사번이 남으면 안 됨');
    assert.equal(serializedAfterPurge.includes('노기범'), false, '파기 완료 후 런타임 원장/감사로그에 성명이 남으면 안 됨');

    const ceoMobDash = await (
      await fetch(`${baseUrl}/api/mobile/dashboard`, { headers: { Cookie: ceoCookie } })
    ).json();
    const serializedMob = JSON.stringify(ceoMobDash);
    assert.equal(serializedMob.includes('EMP-105'), false, '모바일 알림/원장 복제본에도 구 사번이 남으면 안 됨');
    assert.equal(serializedMob.includes('노기범'), false, '모바일 알림/원장 복제본에도 성명이 남으면 안 됨');

    // 5-b. 파기 후 원본 BUNDLE_MFG_58(EMP-105 노기범 포함) 재개통 시 파기 툼스톤으로 개인정보 부활 원천 차단 + 구 사번 API 재호출 409 검증
    const recommitAfterPurgeRes = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_MFG_58' }),
    });
    assert.equal(recommitAfterPurgeRes.status, 200);
    const recommitAfterPurgeJson = await recommitAfterPurgeRes.json();
    const { sampleIngestionBundles: _staticSamples2, ...liveAfterRecommit } = recommitAfterPurgeJson.snapshot;
    const serializedAfterRecommit = JSON.stringify(liveAfterRecommit);
    assert.equal(
      serializedAfterRecommit.includes('EMP-105'),
      false,
      '원본 번들 재개통 시에도 이미 파기된 EMP-105 사번은 툼스톤으로 부활이 차단되어야 함'
    );
    assert.equal(
      serializedAfterRecommit.includes('노기범'),
      false,
      '원본 번들 재개통 시에도 이미 파기된 성명(노기범)은 부활이 차단되어야 함'
    );

    // 5-c. 파기 후 /api/onboarding/stage 프리뷰 및 과거 기준일(2023-08-01, 상실일 이전 → activeWorkers 분기 유도) 재개통에서도 EMP-105/노기범 재생성·노출 0건 검증
    const stageAfterPurgeRes = await fetch(`${baseUrl}/api/onboarding/stage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_MFG_58', referenceDate: '2023-08-01' }),
    });
    assert.equal(stageAfterPurgeRes.status, 200);
    const stageAfterPurgeText = JSON.stringify(await stageAfterPurgeRes.json());
    assert.equal(
      stageAfterPurgeText.includes('EMP-105') || stageAfterPurgeText.includes('노기범'),
      false,
      '파기 후 /api/onboarding/stage 프리뷰에서도 파기된 사번/성명이 노출되면 안 됨'
    );

    const pastDateCommitRes = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_MFG_58', referenceDate: '2023-08-01' }),
    });
    assert.equal(pastDateCommitRes.status, 200);
    const { sampleIngestionBundles: _staticSamples3, ...liveAfterPastCommit } = (
      await pastDateCommitRes.json()
    ).snapshot;
    const pastCommitText = JSON.stringify(liveAfterPastCommit);
    assert.equal(
      pastCommitText.includes('EMP-105') || pastCommitText.includes('노기범'),
      false,
      '과거 기준일(상실일 이전)로 원본 문서를 재개통해도 activeWorkers 명부에 파기 인원이 재생성되면 안 됨'
    );

    // 기준일 2026-11-15 복원
    await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_MFG_58', referenceDate: '2026-11-15' }),
    });

    const docPurgedEmp105 = await fetch(`${baseUrl}/api/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_CAREER_CERTIFICATE', empCode: 'EMP-105' }),
    });
    assert.equal(docPurgedEmp105.status, 409, '파기된 구 사번(EMP-105)으로 증명서 발급 요청 시 404가 아닌 409(파기됨) 반환 필수');

    const purgeAgainEmp105 = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-105' }),
    });
    assert.equal(purgeAgainEmp105.status, 409, '파기된 구 사번(EMP-105) 재파기 요청 시 409 반환 필수');

    // 6. 최소 1개 문서만 있는 재개통 시 기존 3년 보존 중 퇴사 원장(EMP-191, EMP-192) 보존 및 강제 덮어쓰기(replaceAlumniLedger:true) 409 차단 검증
    const replaceBlocked = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        replaceAlumniLedger: true,
        businessRegistrationText: '법인명: 주식회사 한빛정밀메카트로닉스\n사업자등록번호: 214-86-00941\n업태: 제조업',
      }),
    });
    assert.equal(replaceBlocked.status, 409, '3년 보존 중 원장이 있을 때 replaceAlumniLedger 강제 초기화는 409 차단 필수');

    // 7. 근로자(emp.201 김하늘) 로그인 후 동명이인(생년월일 누락 또는 입사일 상이)·타 인물·타 사업장 개통 시 세션 즉시 폐기(401) 및 재로그인 차단(403) 검증
    const wrkLogin = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(wrkLogin.status, 200);
    const wrkCookie = extractCookie(wrkLogin);

    // 7-a. 동일 사업장(214-86-00941) + 동일 사번(EMP-201) + 동명이인(김하늘)이지만 생년월일이 누락되고 입사일이 다른 행 개통 시 폴백 없이 즉시 차단!
    const sameNameMissingBirthCommit = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        businessRegistrationText: '법인명: 주식회사 한빛정밀메카트로닉스\n사업자등록번호: 214-86-00941\n업태: 제조업',
        employmentInsuranceText: [
          '사번,성명,생년월일,고용형태,주소정근로시간,취득일,월평균보수',
          'EMP-201,김하늘,,상용,40,2026-11-01,3500000',
        ].join('\n'),
      }),
    });
    assert.equal(sameNameMissingBirthCommit.status, 200);
    const diffPersonSnap = (await sameNameMissingBirthCommit.json()).snapshot;
    assert.ok(
      diffPersonSnap.offboardedWorkers.some((a) => a.empCode === 'EMP-191'),
      '상실내역 없는 최소 문서 재개통 시에도 기존 3년 보존 퇴사자 원장(EMP-191)은 반드시 보존되어야 함'
    );

    const wrkAfterMissingBirth = await fetch(`${baseUrl}/api/mobile/dashboard`, {
      headers: { Cookie: wrkCookie },
    });
    assert.equal(
      wrkAfterMissingBirth.status,
      401,
      '생년월일 누락·입사일 상이 동명이인(EMP-201 김하늘) 개통 시 기존 세션은 폴백 없이 즉시 폐기(401)되어야 함'
    );

    const wrkReloginMissingBirth = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(
      wrkReloginMissingBirth.status,
      403,
      '생년월일 누락 동명이인 배정 시 구 emp.201 계정 로그인은 403 차단 필수'
    );

    // 7-b. 동일 사업장·동일 사번·동명이인·동일 생년월일(940315)이라도 입사일(2026-11-01 !== 2022-03-02)이 다르면 다른 인물로 판정해 403 차단!
    const sameBirthDiffHireCommit = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        businessRegistrationText: '법인명: 주식회사 한빛정밀메카트로닉스\n사업자등록번호: 214-86-00941\n업태: 제조업',
        employmentInsuranceText: [
          '사번,성명,생년월일,고용형태,주소정근로시간,취득일,월평균보수',
          'EMP-201,김하늘,940315-*******,상용,40,2026-11-01,3500000',
        ].join('\n'),
      }),
    });
    assert.equal(sameBirthDiffHireCommit.status, 200);

    const wrkReloginDiffHire = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(
      wrkReloginDiffHire.status,
      403,
      '입사일(hireDate)이 불일치하거나 불변 personId가 갱신된 경우에도 구 계정 로그인은 403 차단 필수'
    );

    // 타 사업장(BUNDLE_IT_34, 사업자번호 120-88-00419 — 동일 이름 EMP-201 김하늘 존재)으로 전환해도 사업장 불일치로 여전히 403 차단!
    const otherBizCommit = await fetch(`${baseUrl}/api/onboarding/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ bundleId: 'BUNDLE_IT_34' }),
    });
    assert.equal(otherBizCommit.status, 200);

    const wrkOtherBizLogin = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(
      wrkOtherBizLogin.status,
      403,
      '타 사업장(사업자등록번호 불일치) 개통 시 동명이인 EMP-201이 있어도 기존 계정 로그인은 403 차단 필수'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('18. 비식별 파기 시 전자결재·알림·감사로그·근로자계정 구조화 복제본 완전 삭제 및 SQL DDL 무결성 제약 정합성 검증', async () => {
  const testSeeds = {
    ceo: { password: 'TestCeo!9912', pin: '258080' },
    'hr.admin': { password: 'TestHr!8823', pin: '135790' },
    'dept.lead': { password: 'TestMgr!7734', pin: '246810' },
    'emp.201': { password: 'TestWrk!6645', pin: null },
  };
  const { server } = createAppServer({
    demoMode: false,
    seedCredentials: testSeeds,
    serverTodayIso: '2030-01-01',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const extractCookie = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

  try {
    const bootRes = await fetch(`${baseUrl}/api/mobile/bootstrap`);
    const { loginCsrfToken } = await bootRes.json();

    // 1. 근로자(emp.201 김하늘) 로그인 후 전자결재(연차) 신청 → 구조화 결재 객체·알림·감사로그 생성
    const wrkLogin = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(wrkLogin.status, 200);
    const wrkCookie = extractCookie(wrkLogin);
    const wrkSession = (await wrkLogin.json()).session;

    const uniqueReason = '파기검증용-고유연차사유-9941';
    const leaveReqRes = await fetch(`${baseUrl}/api/mobile/worker/request-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ requestType: 'LEAVE', amount: 1.5, reason: uniqueReason }),
    });
    assert.equal(leaveReqRes.status, 200);

    // 2. 대표이사 로그인·2FA 통과 후 결재함에 해당 항목이 존재하는지 확인
    const ceoStep1 = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'ceo', password: testSeeds.ceo.password }),
    });
    const ceoCookie = extractCookie(ceoStep1);
    const ceoStep1Session = (await ceoStep1.json()).session;

    const ceoStep2 = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoStep1Session.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds.ceo.pin }),
    });
    assert.equal(ceoStep2.status, 200);
    const ceoSession = (await ceoStep2.json()).session;

    const preDash = (
      await (await fetch(`${baseUrl}/api/mobile/dashboard`, { headers: { Cookie: ceoCookie } })).json()
    ).dashboard;
    assert.equal(
      preDash.approvals.some((a) => a.detailSummary === uniqueReason),
      true,
      '파기 전에는 근로자가 올린 전자결재 객체가 결재함에 존재해야 함'
    );

    // 3. EMP-201 퇴사 전환(2026-11-15) 후 서버시각(2030-01-01 > 3년 만료) 기준 비식별 파기 실행
    const offRes = await fetch(`${baseUrl}/api/offboard-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        empCode: 'EMP-201',
        hireDate: '2022-03-02',
        lastWorkDate: '2026-11-15',
        resignReason: 'VOLUNTARY',
        unusedLeaveDays: 2,
      }),
    });
    assert.equal(offRes.status, 200);

    const purgeRes = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-201' }),
    });
    assert.equal(purgeRes.status, 200);
    const purgeBody = await purgeRes.json();

    // 4. 구조화 복제본(전자결재 객체 전체·알림·감사로그·근로자 계정) 완전 삭제 검증
    const postDash = (
      await (await fetch(`${baseUrl}/api/mobile/dashboard`, { headers: { Cookie: ceoCookie } })).json()
    ).dashboard;
    const postDashText = JSON.stringify(postDash);
    assert.equal(
      postDashText.includes(uniqueReason),
      false,
      '비식별 파기 시 단순 문자열 마스킹이 아니라 해당 근로자의 전자결재 구조화 객체 전체가 삭제되어야 함'
    );
    assert.equal(postDashText.includes('EMP-201'), false, '파기 후 모바일 대시보드 어디에도 EMP-201이 남으면 안 됨');
    assert.equal(postDashText.includes('김하늘'), false, '파기 후 모바일 대시보드 어디에도 성명이 남으면 안 됨');

    const { sampleIngestionBundles: _samples, ...liveSnap } = purgeBody.snapshot;
    const liveSnapText = JSON.stringify(liveSnap);
    assert.equal(liveSnapText.includes(uniqueReason), false);
    assert.equal(liveSnapText.includes('EMP-201'), false);
    assert.equal(liveSnapText.includes('김하늘'), false);

    // 근로자 계정 자체도 비식별 스크럽되어 재로그인 불가(403)
    const purgedWrkLogin = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'emp.201', password: testSeeds['emp.201'].password }),
    });
    assert.equal(purgedWrkLogin.status, 403);

    // 5. DB_AND_RULES_SPEC.md offboarding.alumni_registry 의 chk_alumni_lifecycle_integrity 제약 정합성 검증
    const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (const row of liveSnap.offboardedWorkers) {
      assert.ok(typeof row.alumniUid === 'string' && row.alumniUid.length > 0, 'alumniUid 필수');
      if (row.dataLifecycleStatus === 'ANONYMIZED_PURGED') {
        assert.equal(row.personId, null);
        assert.equal(row.hireDate, null);
        assert.equal(row.lastWorkDate, null);
        assert.equal(row.settlementDueDate, null);
        assert.equal(row.nhisLossDueDate, null);
        assert.equal(row.eiLossDueDate, null);
        assert.equal(row.retentionExpiresOn, null, '파기 레코드의 retentionExpiresOn은 잘못된 날짜 문자열이 아닌 null이어야 함');
        assert.equal(row.resignReason, 'PURGED');
        assert.equal(row.settlementStatus, 'PURGED');
        assert.equal(row.nhisLossFilingStatus, 'PURGED');
        assert.equal(row.eiLossAndCertStatus, 'PURGED');
        assert.match(row.anonymizedAt, isoDateRe);
        assert.ok(typeof row.purgeTombstoneHmac === 'string' && row.purgeTombstoneHmac.length === 64);
      } else {
        assert.match(row.hireDate, isoDateRe);
        assert.match(row.lastWorkDate, isoDateRe);
        assert.match(row.settlementDueDate, isoDateRe);
        assert.match(row.nhisLossDueDate, isoDateRe);
        assert.match(row.eiLossDueDate, isoDateRe);
        assert.match(row.retentionExpiresOn, isoDateRe);
        assert.equal(row.anonymizedAt, null);
        assert.ok(['PENDING', 'PAID'].includes(row.settlementStatus));
        assert.ok(['PENDING', 'FILED'].includes(row.nhisLossFilingStatus));
        assert.ok(['PENDING', 'FILED'].includes(row.eiLossAndCertStatus));
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('19. 실무 인사노무 전 관리 모듈(M1~M7 · M10) 통합 운영 엔진 및 급여잠금(409) · 증명서/통지서 생성 검증', async () => {
  const testSeeds = {
    ceo: { password: 'TestCeo!9912', pin: '258080' },
    'hr.admin': { password: 'TestHr!8823', pin: '135790' },
    'dept.lead': { password: 'TestMgr!7734', pin: '246810' },
    'emp.201': { password: 'TestWrk!6645', pin: null },
  };
  const { server } = createAppServer({ demoMode: false, seedCredentials: testSeeds });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const extractCookie = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

  try {
    const { loginCsrfToken } = await (await fetch(`${baseUrl}/api/mobile/bootstrap`)).json();
    const ceoStep1 = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loginCsrfToken, Origin: baseUrl },
      body: JSON.stringify({ loginId: 'ceo', password: testSeeds.ceo.password }),
    });
    const ceoCookie = extractCookie(ceoStep1);
    const { session: ceoPending } = await ceoStep1.json();

    const ceoStep2 = await fetch(`${baseUrl}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ceoCookie,
        'X-CSRF-Token': ceoPending.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds.ceo.pin }),
    });
    const { session: ceoSession } = await ceoStep2.json();
    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: ceoCookie,
      'X-CSRF-Token': ceoSession.csrfToken,
      Origin: baseUrl,
    };

    // 1. M1 최저임금 미달·비유한(Infinity/문자열)·불합격 보관자(APP-104) 입사 400 차단 검증
    const lowWageCand = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        actionType: 'ADD_APPLICANT',
        name: '저임금테스트',
        weeklyHours: 40,
        offeredMonthlyPay: 1800000,
      }),
    });
    assert.equal(lowWageCand.status, 400, '최저임금 미달 처우 후보 등록은 400 차단 필수');

    const infWageCand = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        actionType: 'ADD_APPLICANT',
        name: '오버플로테스트',
        weeklyHours: 40,
        offeredMonthlyPay: '1e309',
      }),
    });
    assert.equal(infWageCand.status, 400, '문자열 또는 비유한 급여(1e309)는 400 차단 필수');

    const nanAttRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        actionType: 'QUICK_ATTENDANCE_UPDATE',
        empCode: 'EMP-201',
        overtimeHours: 'bad',
      }),
    });
    assert.equal(nanAttRes.status, 400, '비숫자 근태 입력(bad)은 400 차단 필수');

    const rejectedHireRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'HIRE_APPLICANT', applicantId: 'APP-104' }),
    });
    assert.equal(rejectedHireRes.status, 400, '불합격 서류보관자(APP-104)는 입사 발령 400 차단 필수');

    // 2. M1→M2 합격자(APP-101 서지훈) 입사 발령 후 기존 재직자 퇴사 시에도 차기 합격자(APP-102) 유일 사번 채번 보장 검증
    const hireRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'HIRE_APPLICANT', applicantId: 'APP-101' }),
    });
    assert.equal(hireRes.status, 200);
    const hireData = await hireRes.json();
    const hiredWorker = hireData.snapshot.workers.find((w) => w.displayName === '서지훈');
    assert.ok(hiredWorker, '합격자 입사 발령 즉시 재직자 및 급여원장에 추가되어야 함');

    await fetch(`${baseUrl}/api/offboard-worker`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ empCode: 'EMP-204', lastWorkDate: '2026-11-15', resignReason: 'VOLUNTARY' }),
    });

    const hireRes2 = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'HIRE_APPLICANT', applicantId: 'APP-102' }),
    });
    assert.equal(hireRes2.status, 200);
    const hireData2 = await hireRes2.json();
    const hiredWorker2 = hireData2.snapshot.workers.find((w) => w.displayName === '윤채원');
    assert.notEqual(hiredWorker2.empCode, hiredWorker.empCode, '퇴사 후 추가 채용 시 사번 충돌이 발생하면 안 됨');

    const signRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'SIGN_CONTRACT', empCode: hiredWorker.empCode }),
    });
    assert.equal(signRes.status, 200);

    // 2-b. BIZ_33 / DAILY 정규 발령 차단 및 미존재/퇴사 사번 재직증명서 404 차단 검증
    const biz33AsgRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'ISSUE_ASSIGNMENT', empCode: 'EXT-401', orderType: 'PROMOTION' }),
    });
    assert.equal(biz33AsgRes.status, 400, '3.3% 사업소득자는 정규 인사발령 400 차단 필수');

    const missingCertRes = await fetch(`${baseUrl}/api/document`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ templateId: 'DOC_EMPLOYMENT_CERT', empCode: 'EMP-999' }),
    });
    assert.equal(missingCertRes.status, 404, '미존재 사번 재직증명서 요청 시 타인 폴백 없이 404 반환 필수');

    const offboardedCertRes = await fetch(`${baseUrl}/api/document`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ templateId: 'DOC_EMPLOYMENT_CERT', empCode: 'EMP-204' }),
    });
    assert.equal(offboardedCertRes.status, 404, '퇴사자 사번으로 재직증명서 요청 시 404 반환 필수');

    // 3. M3 인사발령(육아휴직 → 일할 안분 반영), M5 연차사용촉진 단계 전환, M6 평가 보상안 급여 일괄 반영, M7 고충처리, M10 교육·위험성평가 검증
    const leaveOrderRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        actionType: 'ISSUE_ASSIGNMENT',
        empCode: 'EMP-202',
        orderType: 'PARENTAL_LEAVE',
      }),
    });
    assert.equal(leaveOrderRes.status, 200);

    const promoRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'ADVANCE_LEAVE_PROMOTION', empCode: 'EMP-202' }),
    });
    assert.equal(promoRes.status, 200);

    const evalRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'APPLY_EVAL_REWARDS' }),
    });
    assert.equal(evalRes.status, 200);

    const grvRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'RESOLVE_GRIEVANCE', grievanceId: 'GRV-401' }),
    });
    assert.equal(grvRes.status, 200);

    const eduRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'COMPLETE_STATUTORY_EDU', trainingId: 'EDU-OSH' }),
    });
    assert.equal(eduRes.status, 200);

    // 4. 신규 실무 문서 3종(재직증명서 · 제61조 연차촉진 통지서 · 제27조/제95조 징계통지서) 정상 생성 검증
    for (const tpl of [
      'DOC_EMPLOYMENT_CERT',
      'DOC_ANNUAL_LEAVE_PROMOTION',
      'DOC_DISCIPLINE_WRITTEN_NOTICE',
    ]) {
      const docRes = await fetch(`${baseUrl}/api/document`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ templateId: tpl, empCode: 'EMP-202' }),
      });
      assert.equal(docRes.status, 200);
      const docJson = await docRes.json();
      assert.ok(docJson.document.body.includes('이바다'));
    }

    // 5. 대표이사 급여 최종 잠금(APPROVED_LOCKED) 후 급여 영향 인사발령/평가반영 409 차단 검증
    await fetch(`${baseUrl}/api/mobile/submit-payroll-close`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    await fetch(`${baseUrl}/api/mobile/approve-payroll`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });

    const lockedMutateRes = await fetch(`${baseUrl}/api/ops/action`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actionType: 'APPLY_EVAL_REWARDS' }),
    });
    assert.equal(lockedMutateRes.status, 409, '급여 마감 잠금 이후 급여 변동 평가는 409 차단 필수');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // 6. 채용 후 퇴사·3년 만료 파기 시 채용 지원자 원본(APP-101 서지훈)까지 완전 삭제되어 재채용 불가 검증
  const { server: srv2 } = createAppServer({
    demoMode: false,
    seedCredentials: testSeeds,
    serverTodayIso: '2030-01-01',
  });
  await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve));
  const p2 = srv2.address().port;
  const u2 = `http://127.0.0.1:${p2}`;
  try {
    const { loginCsrfToken: cToken2 } = await (await fetch(`${u2}/api/mobile/bootstrap`)).json();
    const s1 = await fetch(`${u2}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': cToken2, Origin: u2 },
      body: JSON.stringify({ loginId: 'ceo', password: testSeeds.ceo.password }),
    });
    const ck2 = extractCookie(s1);
    const { session: pend2 } = await s1.json();
    const s2 = await fetch(`${u2}/api/mobile/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ck2, 'X-CSRF-Token': pend2.csrfToken, Origin: u2 },
      body: JSON.stringify({ method: 'PIN', pin: testSeeds.ceo.pin }),
    });
    const { session: sess2 } = await s2.json();
    const hdr2 = { 'Content-Type': 'application/json', Cookie: ck2, 'X-CSRF-Token': sess2.csrfToken, Origin: u2 };

    const h1 = await (
      await fetch(`${u2}/api/ops/action`, {
        method: 'POST',
        headers: hdr2,
        body: JSON.stringify({ actionType: 'HIRE_APPLICANT', applicantId: 'APP-101' }),
      })
    ).json();
    const seoWorker = h1.snapshot.workers.find((w) => w.displayName === '서지훈');
    await fetch(`${u2}/api/offboard-worker`, {
      method: 'POST',
      headers: hdr2,
      body: JSON.stringify({ empCode: seoWorker.empCode, lastWorkDate: '2026-11-15' }),
    });
    const prgRes = await fetch(`${u2}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: hdr2,
      body: JSON.stringify({ empCode: seoWorker.empCode }),
    });
    assert.equal(prgRes.status, 200);
    const prgSnap = (await prgRes.json()).snapshot;
    const { sampleIngestionBundles: _sb, ...liveOnly } = prgSnap;
    assert.equal(
      JSON.stringify(liveOnly).includes('서지훈'),
      false,
      '파기 완료 후 채용 파이프라인 지원자 원본에도 성명(서지훈)이 남으면 안 됨'
    );
    const rehireAttempt = await fetch(`${u2}/api/ops/action`, {
      method: 'POST',
      headers: hdr2,
      body: JSON.stringify({ actionType: 'HIRE_APPLICANT', applicantId: 'APP-101' }),
    });
    assert.equal(rehireAttempt.status, 400, '파기 삭제된 지원자(APP-101) 재채용 시도는 거부되어야 함');
  } finally {
    await new Promise((resolve) => srv2.close(resolve));
  }
});

test('20. 전용 로컬 커스텀 도메인(modular-hr.localhost) Host·Origin 허용 및 외부 위조 도메인 403 차단·팝업 UI 검증', async () => {
  const httpMod = (await import('node:http')).default;
  const fsMod = (await import('node:fs')).default;
  const pathMod = (await import('node:path')).default;

  const indexHtml = fsMod.readFileSync(
    pathMod.join(process.cwd(), 'src', 'public', 'index.html'),
    'utf8'
  );
  assert.ok(indexHtml.includes('id="module-popup-modal"'), '모듈별 상세 팝업 모달 존재 필수');
  assert.ok(indexHtml.includes('id="btn-open-dashboard-popup"'), '독립 대시보드 팝업창 버튼 존재 필수');
  assert.ok(indexHtml.includes('id="review-tour-bar"'), '전 모듈 검토 가이드 바 존재 필수');

  const testSeeds = {
    ceo: { password: 'TestCeo!9912', pin: '258080' },
    'hr.admin': { password: 'TestHr!8823', pin: '135790' },
    'dept.lead': { password: 'TestMgr!7734', pin: '246810' },
    'emp.201': { password: 'TestWrk!6645', pin: null },
  };
  const { server } = createAppServer({ demoMode: true, seedCredentials: testSeeds });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const rawHttpRequest = ({ method = 'GET', reqPath = '/', hostHeader, headers = {}, bodyObj = null }) =>
    new Promise((resolve, reject) => {
      const payload = bodyObj !== null ? JSON.stringify(bodyObj) : null;
      const req = httpMod.request(
        {
          hostname: '127.0.0.1',
          port,
          path: reqPath,
          method,
          headers: {
            Host: hostHeader,
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
            resolve({
              status: res.statusCode,
              setCookie: (res.headers['set-cookie'] || [])[0] || '',
              json,
              text,
            });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  try {
    const customHost = `modular-hr.localhost:${port}`;
    const customOrigin = `http://modular-hr.localhost:${port}`;

    // 1. 전용 로컬 도메인(modular-hr.localhost)으로 부트스트랩·2FA 인증·대시보드·액션 정상 호출 검증
    const mBoot = await rawHttpRequest({
      method: 'GET',
      reqPath: '/api/mobile/bootstrap',
      hostHeader: customHost,
    });
    assert.equal(mBoot.status, 200);

    const step1 = await rawHttpRequest({
      method: 'POST',
      reqPath: '/api/mobile/login',
      hostHeader: customHost,
      headers: {
        Origin: customOrigin,
        'X-CSRF-Token': mBoot.json.loginCsrfToken,
      },
      bodyObj: { loginId: 'ceo', password: testSeeds.ceo.password },
    });
    assert.equal(step1.status, 200);
    const cookie = step1.setCookie.split(';')[0];

    const step2 = await rawHttpRequest({
      method: 'POST',
      reqPath: '/api/mobile/mfa/verify',
      hostHeader: customHost,
      headers: {
        Origin: customOrigin,
        Cookie: cookie,
        'X-CSRF-Token': step1.json.session.csrfToken,
      },
      bodyObj: { method: 'PIN', pin: testSeeds.ceo.pin },
    });
    assert.equal(step2.status, 200);

    const pcBoot = await rawHttpRequest({
      method: 'GET',
      reqPath: '/api/bootstrap',
      hostHeader: customHost,
      headers: { Cookie: cookie },
    });
    assert.equal(pcBoot.status, 200);
    assert.ok(pcBoot.json.snapshot.operationsSuite, '전용 도메인에서 전 관리 모듈 데이터 정상 반환 필수');

    // 2. 유사 사칭 외부 도메인(modular-hr.localhost.evil.com) 및 비허용 Origin은 즉시 403 차단 검증
    const spoofedHostRes = await rawHttpRequest({
      method: 'GET',
      reqPath: '/api/mobile/bootstrap',
      hostHeader: `modular-hr.localhost.evil.com:${port}`,
    });
    assert.equal(spoofedHostRes.status, 403, '위조 도메인(DNS Rebinding)은 403 차단 필수');

    const spoofedOriginRes = await rawHttpRequest({
      method: 'POST',
      reqPath: '/api/ops/action',
      hostHeader: customHost,
      headers: {
        Origin: 'http://evil-origin.example.com',
        Cookie: cookie,
        'X-CSRF-Token': pcBoot.json.csrfToken,
      },
      bodyObj: { actionType: 'APPLY_EVAL_REWARDS' },
    });
    assert.equal(spoofedOriginRes.status, 403, '비허용 외부 Origin은 403 차단 필수');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('21. GitHub Pages 무서버 정적 런타임(SharedWorker + server-core) 서버 동등성·RBAC·급여잠금(409)·파기·SPKI 검증', async () => {
  const { execFileSync } = await import('node:child_process');
  const pathMod = (await import('node:path')).default;
  const { pathToFileURL } = await import('node:url');

  execFileSync(process.execPath, [pathMod.join(process.cwd(), 'scripts', 'build-gh-pages.mjs')], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  const workerModUrl = pathToFileURL(
    pathMod.join(process.cwd(), 'dist-pages', 'virtual-server-worker.mjs')
  ).href;
  const { invokeDirectInTab } = await import(workerModUrl);

  const callVirtual = async (method, url, body = null, cookie = '', csrf = '') => {
    const headers = {};
    if (body !== null) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await invokeDirectInTab({
      method,
      url,
      headers,
      bodyText: body !== null ? JSON.stringify(body) : '',
    });
    return {
      status: res.status,
      cookie: res.headers?.['set-cookie'] ? String(res.headers['set-cookie']).split(';')[0] : cookie,
      json: res.bodyText ? JSON.parse(res.bodyText) : {},
    };
  };

  // 1. 데모 부트스트랩 -> CEO 2FA 로그인 및 WORKER 로그인
  const boot = await callVirtual('GET', '/api/mobile/bootstrap');
  assert.equal(boot.status, 200);
  const ceoMeta = boot.json.demoAccounts.find((a) => a.loginId === 'ceo');
  const wrkMeta = boot.json.demoAccounts.find((a) => a.loginId === 'emp.201');

  const ceoL1 = await callVirtual(
    'POST',
    '/api/mobile/login',
    { loginId: 'ceo', password: ceoMeta.demoPassword },
    '',
    boot.json.loginCsrfToken
  );
  assert.equal(ceoL1.status, 200);
  const ceoCookie = ceoL1.cookie;
  const ceoCsrf = ceoL1.json.session.csrfToken;

  const ceoL2 = await callVirtual(
    'POST',
    '/api/mobile/mfa/verify',
    { method: 'PIN', pin: ceoMeta.demoPin },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(ceoL2.status, 200);

  // 2. 쓰레기 SPKI 공개키 등록 시 createPublicKey WebCrypto 검증으로 즉시 400 차단 확인
  const badSpkiRes = await callVirtual(
    'POST',
    '/api/mobile/passkey/register',
    { currentPin: ceoMeta.demoPin, publicKeySpkiBase64: Buffer.alloc(64, 7).toString('base64') },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(badSpkiRes.status, 400, '잘못된 SPKI 키는 등록 단계에서 즉시 400 차단 필수');

  // 3. WORKER 역할 RBAC 검증 (법정과제 토글 및 타 문서 열람 403 차단)
  const wrkL1 = await callVirtual(
    'POST',
    '/api/mobile/login',
    { loginId: 'emp.201', password: wrkMeta.demoPassword },
    '',
    boot.json.loginCsrfToken
  );
  assert.equal(wrkL1.status, 200);
  const wrkCookie = wrkL1.cookie;
  const wrkCsrf = wrkL1.json.session.csrfToken;

  const wrkTaskRes = await callVirtual(
    'POST',
    '/api/mobile/toggle-statutory-task',
    { taskId: 'TASK_LMC_30_SETUP' },
    wrkCookie,
    wrkCsrf
  );
  assert.equal(wrkTaskRes.status, 403);

  const wrkDocRes = await callVirtual(
    'POST',
    '/api/mobile/document',
    { templateId: 'DOC_EMPLOYMENT_CERT', empCode: 'EMP-202' },
    wrkCookie,
    wrkCsrf
  );
  assert.equal(wrkDocRes.status, 403);

  // 4. 5종 프리셋 존재, 일용직(DLY-301) 퇴사 정상 산정, EMP-105 비식별 파기 후 감사로그/증명서 409 검증
  const pcBoot = await callVirtual('GET', '/api/bootstrap', null, ceoCookie);
  assert.equal(pcBoot.status, 200);
  assert.equal(pcBoot.json.snapshot.presets.length, 5, '서버와 동일한 5종 프리셋 제공 필수');

  const dlyOff = await callVirtual(
    'POST',
    '/api/offboard-worker',
    { empCode: 'DLY-301', lastWorkDate: '2026-11-15' },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(dlyOff.status, 200);
  assert.equal(dlyOff.json.offboardedRecord.baseMonthlyPay, 170000 * 8, '일용직 퇴사 기준보수 정합성 필수');

  const purgeRes = await callVirtual(
    'POST',
    '/api/offboarded/purge-pii',
    { empCode: 'EMP-105' },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(purgeRes.status, 200);
  const { sampleIngestionBundles: _s, ...liveSnap } = purgeRes.json.snapshot;
  assert.equal(JSON.stringify(liveSnap).includes('EMP-105'), false);
  assert.equal(JSON.stringify(liveSnap).includes('노기범'), false);

  const purgedDocMobile = await callVirtual(
    'POST',
    '/api/mobile/document',
    { templateId: 'DOC_CAREER_CERTIFICATE', empCode: 'EMP-105' },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(purgedDocMobile.status, 409);

  // 5. 급여 최종 승인 잠금(APPROVED_LOCKED) 후 /api/simulate-company 및 /api/update-worker-event 409 차단 확인
  await callVirtual('POST', '/api/mobile/submit-payroll-close', {}, ceoCookie, ceoCsrf);
  await callVirtual('POST', '/api/mobile/approve-payroll', {}, ceoCookie, ceoCsrf);

  const simAfterLock = await callVirtual(
    'POST',
    '/api/simulate-company',
    { companyName: '잠금후변경시도' },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(simAfterLock.status, 409);

  const evtAfterLock = await callVirtual(
    'POST',
    '/api/update-worker-event',
    { empCode: 'EMP-201', overtimeHours: 2 },
    ceoCookie,
    ceoCsrf
  );
  assert.equal(evtAfterLock.status, 409);
});


test('22. 필수 인사·보안 서식 3종(개인정보동의서 · 비밀유지보안서약서 · 퇴사 경업금지서약서) 생성·바인딩·RBAC·파기차단(409) 검증', async () => {
  const { server } = createAppServer({ demoMode: true, requirePcAuth: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const { csrfToken, snapshot } = await bootRes.json();

    const postPcDoc = async (payload) => {
      const r = await fetch(`${baseUrl}/api/document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Origin: baseUrl,
        },
        body: JSON.stringify(payload),
      });
      return { status: r.status, json: await r.json() };
    };

    // 1. 전사 표준 양식(공란) 3종 생성 및 필수 법정 가드레일 문구 검증
    const privacyBlank = await postPcDoc({ templateId: 'DOC_PRIVACY_CONSENT' });
    assert.equal(privacyBlank.status, 200);
    assert.match(privacyBlank.json.document.body, /개인정보 보호법/);
    assert.match(privacyBlank.json.document.body, /제24조의2/);
    assert.match(privacyBlank.json.document.body, /3년간 의무 보존/);

    const ndaBlank = await postPcDoc({ templateId: 'DOC_NDA_SECURITY_PLEDGE' });
    assert.equal(ndaBlank.status, 200);
    assert.match(ndaBlank.json.document.body, /부정경쟁방지/);
    assert.match(ndaBlank.json.document.body, /외부 생성형 AI/);

    const exitBlank = await postPcDoc({ templateId: 'DOC_EXIT_SECURITY_NONCOMPETE' });
    assert.equal(exitBlank.status, 200);
    assert.match(exitBlank.json.document.body, /2009다82244/);
    assert.match(exitBlank.json.document.body, /경업금지 대가\(보상\)/);

    // 2. 개별 재직자(EMP-201 김하늘) 및 퇴사자 바인딩 검증
    const privacyBound = await postPcDoc({ templateId: 'DOC_PRIVACY_CONSENT', empCode: 'EMP-201' });
    assert.equal(privacyBound.status, 200);
    assert.match(privacyBound.json.document.title, /김하늘/);
    assert.match(privacyBound.json.document.body, /EMP-201/);

    const firstAlumni = snapshot.offboardedWorkers.find((a) => a.dataLifecycleStatus !== 'ANONYMIZED_PURGED');
    assert.ok(firstAlumni, '보존 중인 퇴사자 레코드 존재 필수');
    const exitBound = await postPcDoc({
      templateId: 'DOC_EXIT_SECURITY_NONCOMPETE',
      empCode: firstAlumni.empCode,
    });
    assert.equal(exitBound.status, 200);
    assert.ok(exitBound.json.document.title.includes(firstAlumni.displayName));
    assert.ok(exitBound.json.document.body.includes(firstAlumni.lastWorkDate));

    // 3. 모바일 근로자(WORKER: emp.201) 본인 동의서/보안서약서 허용 및 타인/퇴사서약서 403 차단 검증
    const mBoot = await (await fetch(`${baseUrl}/api/mobile/bootstrap`)).json();
    const wrkDemo = mBoot.demoAccounts.find((a) => a.loginId === 'emp.201');
    const wrkLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': mBoot.loginCsrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ loginId: 'emp.201', password: wrkDemo.demoPassword }),
    });
    assert.equal(wrkLoginRes.status, 200);
    const wrkCookie = (wrkLoginRes.headers.get('set-cookie') || '').split(';')[0];
    const wrkSession = (await wrkLoginRes.json()).session;

    const wrkSelfNda = await fetch(`${baseUrl}/api/mobile/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_NDA_SECURITY_PLEDGE' }),
    });
    assert.equal(wrkSelfNda.status, 200);
    const wrkSelfNdaJson = await wrkSelfNda.json();
    assert.match(wrkSelfNdaJson.document.title, /김하늘/);

    const wrkOtherEmp = await fetch(`${baseUrl}/api/mobile/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_PRIVACY_CONSENT', empCode: 'EMP-202' }),
    });
    assert.equal(wrkOtherEmp.status, 403);

    const wrkExitDoc = await fetch(`${baseUrl}/api/mobile/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrkCookie,
        'X-CSRF-Token': wrkSession.csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ templateId: 'DOC_EXIT_SECURITY_NONCOMPETE' }),
    });
    assert.equal(wrkExitDoc.status, 403);

    // 4. 3년 보존 만료 파기 퇴사자(EMP-105)의 퇴사 경업금지서약서 발급 시도 시 409 차단 검증
    const purgeRes = await fetch(`${baseUrl}/api/offboarded/purge-pii`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Origin: baseUrl,
      },
      body: JSON.stringify({ empCode: 'EMP-105' }),
    });
    assert.equal(purgeRes.status, 200);

    const exitPurged = await postPcDoc({
      templateId: 'DOC_EXIT_SECURITY_NONCOMPETE',
      empCode: 'EMP-105',
    });
    assert.equal(exitPurged.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('23. 깔끔한 7대 메뉴·서브탭 UI 구조 및 환경 설정(회계연도 연차 · 원천세율 · 식대비과세 · 주간경보 · 급여일) 전사 자동연동 검증', async () => {
  const indexHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'src/public/index.html'), 'utf8');
  for (const requiredId of [
    'major-nav-home',
    'major-nav-hr',
    'major-nav-attendance',
    'major-nav-leave',
    'major-nav-payroll',
    'major-nav-legal',
    'major-nav-settings',
    'domain-subtabs-bar',
    'panel-settings-master',
    'panel-forms-center',
    'panel-ops-leave-promo',
    'select-leave-basis',
    'select-fiscal-start',
    'select-pay-day',
    'select-tax-rate',
  ]) {
    assert.ok(indexHtml.includes(`id="${requiredId}"`), `index.html에 ${requiredId} 요소가 존재해야 함`);
  }

  const { server } = createAppServer({ requirePcAuth: false, demoMode: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://modular-hr.localhost:${port}`;
  const localLoopback = `http://127.0.0.1:${port}`;

  try {
    const bootRes = await fetch(`${localLoopback}/api/bootstrap`, {
      headers: { Host: `modular-hr.localhost:${port}` },
    });
    assert.equal(bootRes.status, 200);
    const { csrfToken, snapshot: snap0 } = await bootRes.json();

    assert.equal(snap0.company.policySettings.leaveAccrualBasis, 'HIRE_DATE');
    const emp201HireLeave = snap0.operationsSuite.leaveAndMaternity.ledger.find(
      (r) => r.empCode === 'EMP-201'
    );
    const emp203HireLeave = snap0.operationsSuite.leaveAndMaternity.ledger.find(
      (r) => r.empCode === 'EMP-203'
    );
    assert.ok(emp201HireLeave.ruleBasis.includes('입사일 기준'));
    assert.notEqual(emp201HireLeave.cycleExpiryDate, '2026-12-31');
    const netBefore = snap0.payrollSummary.totalNet;
    const taxBefore = snap0.payrollSummary.totalTax;
    const nearBefore = snap0.operationsSuite.overviewKpis.near52Count;

    // 1. 잘못된 policySettings 입력 시 400 거부 및 기존 상태 무결성 보존 확인
    const invalidPolicyRes = await fetch(`${localLoopback}/api/simulate-company`, {
      method: 'POST',
      headers: {
        Host: `modular-hr.localhost:${port}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        policySettings: { withholdingTaxRatePct: 95 },
        ksicMajor: 'INVALID_CODE',
      }),
    });
    assert.equal(invalidPolicyRes.status, 400);

    // 2. 환경 설정 변경: 회계연도(01-01) 일괄 연차 + 원천세 80% + 식대 비과세 10만 원 + 주간 주의 44h + 매월 10일 급여일
    const updateRes = await fetch(`${localLoopback}/api/simulate-company`, {
      method: 'POST',
      headers: {
        Host: `modular-hr.localhost:${port}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        policySettings: {
          leaveAccrualBasis: 'FISCAL_YEAR',
          fiscalYearStartMonthDay: '01-01',
          leaveRoundingRule: 'CEIL_HALF',
          leaveSettlementPolicy: 'FULL_PAYOUT',
          weeklyWarnHours: 44,
          payDayLabel: '매월 10일',
          withholdingTaxRatePct: 80,
          nonTaxableMealLimit: 100000,
        },
      }),
    });
    assert.equal(updateRes.status, 200);
    const { snapshot: snapFiscal } = await updateRes.json();

    assert.equal(snapFiscal.company.policySettings.leaveAccrualBasis, 'FISCAL_YEAR');
    assert.equal(snapFiscal.operationsSuite.policySettings.payDayLabel, '매월 10일');

    // 전 직원 연차 만료일이 회계연도 말일(2026-12-31)로 일괄 정렬되고 산정 근거가 회계연도로 전환되는지 확인
    const emp201FiscalLeave = snapFiscal.operationsSuite.leaveAndMaternity.ledger.find(
      (r) => r.empCode === 'EMP-201'
    );
    const emp203FiscalLeave = snapFiscal.operationsSuite.leaveAndMaternity.ledger.find(
      (r) => r.empCode === 'EMP-203'
    );
    assert.ok(emp201FiscalLeave.ruleBasis.includes('회계연도(2026-01-01'));
    assert.equal(emp201FiscalLeave.cycleExpiryDate, '2026-12-31');
    assert.equal(emp203FiscalLeave.cycleExpiryDate, '2026-12-31');
    assert.notEqual(
      emp203FiscalLeave.accruedDays,
      emp203HireLeave.accruedDays,
      '중도입사자의 회계연도 비례부여 연차는 개별 입사일 기준과 구분 산정되어야 함'
    );

    // 주간 주의 기준 48h -> 44h 하향 시 EMP-202(44h)가 주의 대상에 자동 편입되는지 확인
    assert.ok(
      snapFiscal.operationsSuite.overviewKpis.near52Count > nearBefore,
      '환경 설정의 주간 주의 시간(44h) 변경 시 근태 관제 주의 인원이 자동 연동되어야 함'
    );

    // 급여 원천세 80% 및 식대 비과세 한도 10만 원 반영 확인
    const emp201Line = snapFiscal.payrollLines.find((l) => l.empCode === 'EMP-201');
    assert.equal(emp201Line.nonTaxableMealApplied, 100000);
    assert.equal(emp201Line.taxableMealExcess, 100000);
    assert.ok(
      emp201Line.formulaLines.some((f) => f.includes('간이세액표 80% 기준 적용')),
      '임금명세서 산출식에 80% 원천징수 선택세율이 명시되어야 함'
    );
    assert.notEqual(snapFiscal.payrollSummary.totalNet, netBefore);
    assert.notEqual(snapFiscal.payrollSummary.totalTax, taxBefore);

    // 3. 표준 근로계약서 및 취업규칙 신고서에 환경 설정(매월 10일, 회계연도 일괄 기준)이 자동 반영되는지 확인
    const contractDocRes = await fetch(`${localLoopback}/api/document`, {
      method: 'POST',
      headers: {
        Host: `modular-hr.localhost:${port}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ templateId: 'DOC_EMPLOYMENT_CONTRACT' }),
    });
    assert.equal(contractDocRes.status, 200);
    const { document: contractDoc } = await contractDocRes.json();
    assert.ok(contractDoc.body.includes('매월 10일'));
    assert.ok(contractDoc.body.includes('회계연도 일괄 기준 (매년 01-01 부여'));

    const workRulesDocRes = await fetch(`${localLoopback}/api/document`, {
      method: 'POST',
      headers: {
        Host: `modular-hr.localhost:${port}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ templateId: 'DOC_WORK_RULES_REPORT' }),
    });
    assert.equal(workRulesDocRes.status, 200);
    const { document: workRulesDoc } = await workRulesDocRes.json();
    assert.ok(workRulesDoc.body.includes('매월 10일'));
    assert.ok(workRulesDoc.body.includes('회계연도 일괄 기준 (매년 01-01 부여'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
