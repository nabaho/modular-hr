/**
 * 통합 평가·보상 모듈 빌더 & 시뮬레이션 엔진 (가인지캠퍼스 + 대한민국 6대 레이어 33개 모듈)
 * - 컨설턴트용 기업 진단 -> 모듈 조립 -> 4역할 운영 -> 노동법 가드레일 -> 급여 연동 -> 고객사 추출 데이터 제공
 * - 브라우저 번들(build:pages) 호환을 위해 node:* import를 사용하지 않는다.
 */

import {
  GAINGE_COMPETENCY_ROLES,
  GAINGE_COMPETENCY_400,
  GAINGE_KPI_ROLES,
  GAINGE_KPI_200,
  GAINGE_SALARY_GRADES,
  GAINGE_SALARY_SHEETS,
  GAINGE_SALARY_TABLES_200,
  GAINGE_HOBONG_TEMPLATE,
  GAINGE_COMPETENCY_TEMPLATE,
  EVAL_REWARD_LAYERS,
  EVAL_REWARD_MODULES,
  DIAGNOSTIC_PRESETS,
  GAINGE_OKR_KIT,
  GAINGE_360_KIT,
  KOREA_HR_SAAS_BENCHMARKS,
} from './eval-reward-catalog.mjs';
import { LAW_BASELINE } from './labor-rules.mjs';

const MODULE_BY_CODE = new Map(EVAL_REWARD_MODULES.map((m) => [m.code, m]));
const COMP_BY_ID = new Map(GAINGE_COMPETENCY_400.map((c) => [c.id, c]));
const KPI_BY_ID = new Map(GAINGE_KPI_200.map((k) => [k.id, k]));
const SAL_BY_ID = new Map(GAINGE_SALARY_TABLES_200.map((s) => [s.id, s]));
const PRESET_BY_ID = new Map(DIAGNOSTIC_PRESETS.map((p) => [p.id, p]));

const VALID_ROLES = new Set(['CONSULTANT', 'HR_ADMIN', 'EVALUATOR', 'EMPLOYEE']);
const VALID_GRADES = ['S', 'A', 'B', 'C', 'D'];

const DEFAULT_MERIT_MATRIX = {
  S: { raisePct: 8, bonusMonths: 1.5, defaultBonus: 500000 },
  A: { raisePct: 5, bonusMonths: 1.0, defaultBonus: 300000 },
  B: { raisePct: 3, bonusMonths: 0.5, defaultBonus: 150000 },
  C: { raisePct: 1, bonusMonths: 0.0, defaultBonus: 0 },
  D: { raisePct: 0, bonusMonths: 0.0, defaultBonus: 0 },
};

const DEFAULT_QUOTA_MAP = { S: 10, A: 20, B: 50, C: 15, D: 5 };

function badRequest(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

function clampInt(val, min, max, fallback) {
  if (val === null || val === undefined || typeof val === 'boolean' || (typeof val === 'string' && !val.trim())) {
    return fallback;
  }
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(val, min, max, fallback) {
  if (val === null || val === undefined || typeof val === 'boolean' || (typeof val === 'string' && !val.trim())) {
    return fallback;
  }
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Number(n.toFixed(2))));
}

/**
 * 가인지 호봉제 파라미터로 25호봉 급여테이블을 실시간 계산한다.
 */
export function computeHobongTable(hobongConfig) {
  const ranks = Array.isArray(hobongConfig?.ranks) && hobongConfig.ranks.length === 6
    ? hobongConfig.ranks
    : GAINGE_HOBONG_TEMPLATE.ranks;

  const rows = [];
  let prevPay = Math.max(1000, Number(ranks[0]?.entryPayManwon) || 3200);
  let step = 1;

  for (let rIdx = 0; rIdx < ranks.length; rIdx += 1) {
    const rankInfo = ranks[rIdx];
    const stayMax = Math.max(1, Math.min(10, Math.round(Number(rankInfo.stdYears) || 2)));
    const normalRate = Math.max(0, Math.min(0.5, Number(rankInfo.normalRate) || 0));
    const promoRate = Math.max(0, Math.min(0.5, Number(rankInfo.promoRate) || 0));

    for (let stay = 1; stay <= stayMax; stay += 1) {
      let annualPay = prevPay;
      let note = '';

      if (step === 1) {
        annualPay = Math.round(prevPay / 10) * 10;
        note = '초임';
      } else if (stay === 1 && rIdx > 0) {
        annualPay = Math.round((prevPay * (1 + promoRate)) / 10) * 10;
        note = '승진';
      } else {
        annualPay = Math.round((prevPay * (1 + normalRate)) / 10) * 10;
      }

      const diff = step === 1 ? 0 : annualPay - prevPay;
      const effRate = step === 1 || prevPay === 0 ? 0 : Number(((diff / prevPay) * 100).toFixed(2));

      rows.push({
        step,
        rank: rankInfo.rank,
        stayYear: stay,
        annualPayManwon: annualPay,
        monthlyEstWon: Math.round((annualPay * 10000) / 12),
        raiseRatePct: effRate,
        raiseAmountManwon: diff,
        note,
      });
      prevPay = annualPay;
      step += 1;
    }
  }
  return rows;
}

/**
 * 기업 진단 조건으로 최적 프리셋을 추천한다.
 */
export function recommendPresetForProfile(profile) {
  const industry = String(profile?.industry || '');
  const sizeBand = String(profile?.sizeBand || '100인미만');
  const hasUnion = Boolean(profile?.hasUnion);
  const culture = String(profile?.cultureType || 'AGILE');

  if (industry.includes('기관') || culture === 'FAIRNESS') {
    return PRESET_BY_ID.get('PRESET-PUBLIC-UNION');
  }
  if (industry.includes('의료') || culture === 'COLLABORATIVE') {
    return PRESET_BY_ID.get('PRESET-MEDICAL-PRO');
  }
  if (industry.includes('판매') || culture === 'PERFORMANCE') {
    return PRESET_BY_ID.get('PRESET-SALES-SERVICE');
  }
  if (sizeBand === '100인이상' || culture === 'STRUCTURED' || hasUnion) {
    return PRESET_BY_ID.get('PRESET-WORK-INNOVATION');
  }
  if (industry.includes('제조') || industry.includes('건설') || culture === 'STABLE') {
    return PRESET_BY_ID.get('PRESET-MFG-SME');
  }
  return PRESET_BY_ID.get('PRESET-GAINGE-UNDER100');
}

/**
 * 노동법 가드레일 자동 진단 (푸른노무법인 실무 기준)
 */
export function evaluateLegalGuardrails({ enabledSet, params, clientProfile, workers, evalBoard }) {
  const alerts = [];

  // 1. 근기법 제94조 취업규칙 불이익변경 경보
  const riskFactors = [
    enabledSet.has('PAY-PEAK') ? '임금피크제' : '',
    enabledSet.has('PAY-ANNUAL') ? '성과연봉제(하락 가능)' : '',
    enabledSet.has('PAY-JOB') ? '직무급 전환' : '',
    enabledSet.has('SCORE-REL') ? '상대/강제배분' : '',
  ].filter(Boolean);
  if (riskFactors.length > 0) {
    alerts.push({
      id: 'LAW-94-WORK-RULES',
      severity: enabledSet.has('PAY-PEAK') || enabledSet.has('SCORE-REL') ? 'HIGH' : 'MEDIUM',
      lawRef: '근로기준법 제94조 (취업규칙 불이익변경)',
      title: '보상·평가 제도 개편 시 근로자 과반수(또는 과반수 노조) 동의 절차 필요 여부 점검',
      detail: `${riskFactors.join('·')} 도입 시 기존 기득권 임금이 저하될 수 있는 조항이 포함되면 집단적 동의가 없으면 무효가 될 수 있습니다.`,
      actionHint: '서식·법정 → 취업규칙 개정·동의 탭에서 개정안 발송 및 과반수 서명 취합 연동 권장',
    });
  }

  // 2. 최저임금 2026년 기준 검증 (월 209h 기준)
  const minMonthly209 = LAW_BASELINE.minimumHourlyWage * LAW_BASELINE.standardMonthlyHours;
  const underMinWorkers = (evalBoard || []).filter(
    (r) => r.evalEligible && r.projectedBasePay > 0 && r.projectedBasePay < minMonthly209
  );
  if (underMinWorkers.length > 0) {
    alerts.push({
      id: 'LAW-MIN-WAGE',
      severity: 'HIGH',
      lawRef: '최저임금법 제6조 (2026년 기준)',
      title: `평가 반영 후 예상 월 기본급이 2026년 최저임금(${minMonthly209.toLocaleString('ko-KR')}원) 미만인 대상 ${underMinWorkers.length}명 감지`,
      detail: `대상: ${underMinWorkers.map((w) => `${w.displayName}(${w.projectedBasePay.toLocaleString('ko-KR')}원)`).join(', ')}. 커미션·비정기 성과급 제외 기본급+고정수당이 최저임금을 충족해야 합니다.`,
      actionHint: '최저임금 미달 대상자의 기본급 하한선 보정 후 급여 대장에 반영하세요.',
    });
  } else {
    alerts.push({
      id: 'LAW-MIN-WAGE-OK',
      severity: 'OK',
      lawRef: '최저임금법 제6조',
      title: `평가 대상 전원의 예상 기본급이 2026년 월 환산 최저임금(${minMonthly209.toLocaleString('ko-KR')}원) 이상입니다.`,
      detail: '정기상여·성과급 분리 구조에서도 기본급 하한선이 안전하게 유지됩니다.',
      actionHint: '인상 확정 전 통상임금 산입 수당 변동 여부만 최종 확인하세요.',
    });
  }

  // 3. 경영성과급(PS/PI) · 커미션 평균임금/통상임금 리스크
  if (enabledSet.has('REW-PSPI') || enabledSet.has('REW-COMM')) {
    alerts.push({
      id: 'LAW-PSPI-AVG-WAGE',
      severity: 'MEDIUM',
      lawRef: '대법원 2018다244854 등 (경영성과급의 임금성)',
      title: 'PS/PI·인센티브 지급 조건에 따른 평균임금(퇴직금) 산입 리스크 점검',
      detail: '지급기준·지급률·재직자 요건이 사전에 확정되어 계속·정기적 지급 의무가 인정되면 퇴직금 산정 평균임금에 포함될 수 있습니다. 반면 영업이익 달성 여부에 따라 변동·은혜적 성격이 명확하면 임금성 부정이 가능합니다.',
      actionHint: '지급 규정(취업규칙/성과급 운영세칙)에 성과 달성 연동 기준과 지급기준일 재직 요건을 명시하세요.',
    });
  }

  // 4. 저성과자(PIP) · 강제배분 해고·징계 절차 가드레일
  if (enabledSet.has('COMP-PROB') || enabledSet.has('SCORE-REL')) {
    alerts.push({
      id: 'LAW-23-PIP',
      severity: 'MEDIUM',
      lawRef: '근로기준법 제23조·대법원 2018다253680 (저성과 평가·통상해고)',
      title: '하위 등급(C·D) 및 수습·PIP 운영 시 객관성·개선기회·소명절차 필수',
      detail: '평가 결과가 승진누락·임금동결·본채용 거부·PIP로 이어질 경우 ① 평가 기준의 사전 공개·합의, ② 1on1 피드백 및 역량향상 교육(PIP) 기회 부여, ③ 이의신청·소명 기록이 갖춰져야 정당성이 인정됩니다.',
      actionHint: '상시 1on1 기록(PROC-CONT)과 캘리브레이션 사유(PROC-CALIB)를 반드시 저장하세요.',
    });
  }

  // 5. 임금피크제 연령차별 판례 가드레일
  if (enabledSet.has('PAY-PEAK')) {
    alerts.push({
      id: 'LAW-PEAK-AGE',
      severity: 'HIGH',
      lawRef: '고령자고용법 제4조의4 · 대법원 2017다292343',
      title: '임금피크제 도입 시 합리적 이유 및 업무량·근로시간 저감(또는 대상조치) 필수',
      detail: '정년 유지형 임금피크제에서 기존과 동일한 업무량을 유지하면서 급여만 삭감하면 고령자 차별 무효 판결 위험이 큽니다.',
      actionHint: '적합직무 전환, 근로시간 단축, 성과 보전 수당 중 최소 1개 이상 대상조치를 설계서에 포함하세요.',
    });
  }

  // 6. 근로복지기금 활용 팁
  if (enabledSet.has('REW-WELF')) {
    alerts.push({
      id: 'LAW-WELF-OK',
      severity: 'OK',
      lawRef: '근로복지기본법 제50조~ (사내/공동근로복지기금)',
      title: '복지기금 출연 시 임금성·평균임금 배제 및 기업·근로자 절세 효과 기대',
      detail: '영업이익 일부를 사내/공동근로복지기금으로 출연해 복지포인트를 지급하면 퇴직금·4대보험 부담을 줄이면서 실질 보상을 높일 수 있습니다.',
      actionHint: '사내근로복지기금 정관 및 연간 출연 예산과 연계하세요.',
    });
  }

  return {
    moduleCount: enabledSet.size,
    highRiskCount: alerts.filter((a) => a.severity === 'HIGH').length,
    mediumRiskCount: alerts.filter((a) => a.severity === 'MEDIUM').length,
    alerts,
    unionRequired: Boolean(clientProfile?.hasUnion) || (workers || []).length >= 30,
    lmcConsultationRecommended: (workers || []).length >= 30,
  };
}

/**
 * 평가·보상 통합 스튜디오 매니저 생성
 */
export function createEvalRewardStudioManager() {
  const defaultPreset = PRESET_BY_ID.get('PRESET-GAINGE-UNDER100');

  const clientProfile = {
    clientName: '푸른모듈 샘플기업',
    industry: defaultPreset.industry,
    sizeBand: defaultPreset.sizeBand,
    hasUnion: false,
    cultureType: defaultPreset.cultureType,
    evalCycle: 'QUARTERLY_OKR_ANNUAL_REWARD',
    fiscalYear: 2026,
    consultantNote: '가인지캠퍼스 OKR·직무역량 420·KPI 205 및 일터혁신 보상모델 결합 설계',
    activePresetId: defaultPreset.id,
  };

  const enabledModules = new Set(defaultPreset.modules);

  const params = {
    kpiWeightPct: 50,
    compWeightPct: 35,
    peerWeightPct: 15,
    scoringMode: 'SCORE-ABS',
    paySystemType: 'PAY-ANNUAL',
    annualBudgetCapPct: 5.5,
    psPoolAmount: 15000000,
    commissionRatePct: 3.5,
    quotaMap: { ...DEFAULT_QUOTA_MAP },
    meritMatrix: structuredClone(DEFAULT_MERIT_MATRIX),
  };

  // 가인지 420문항 중 기본 편입 (상품기획·IT개발자·경영지원 혼합 10문항)
  const selectedCompetencyIds = new Set(
    GAINGE_COMPETENCY_400.filter((c) =>
      ['GC-COMP-001', 'GC-COMP-002', 'GC-COMP-021', 'GC-COMP-022', 'GC-COMP-121', 'GC-COMP-122', 'GC-COMP-261', 'GC-COMP-262', 'GC-COMP-141', 'GC-COMP-142'].includes(c.id)
    ).map((c) => c.id)
  );

  // 가인지 205 KPI 중 기본 편입 6개
  const selectedKpiIds = new Set(
    GAINGE_KPI_200.filter((k) =>
      ['GC-KPI-001', 'GC-KPI-002', 'GC-KPI-033', 'GC-KPI-077', 'GC-KPI-096', 'GC-KPI-137'].includes(k.id)
    ).map((k) => k.id)
  );

  // 채택 벤치마크 연봉테이블
  let selectedSalaryTableId =
    GAINGE_SALARY_TABLES_200.find((t) => t.industry === 'IT·웹·통신업' && t.sizeBand === '100인미만')?.id ||
    GAINGE_SALARY_TABLES_200[0].id;

  // 가인지 호봉제 설정 (수정 가능)
  let hobongConfig = structuredClone(GAINGE_HOBONG_TEMPLATE.ranks);

  // 가인지 역량평가 자기 vs 리더 척도 시뮬레이션 (양식지 10문항)
  let competencyRatings = GAINGE_COMPETENCY_TEMPLATE.questions.map((q) => ({
    id: q.id,
    group: q.group,
    domain: q.domain,
    question: q.question,
    selfScore: q.sampleSelf,
    leaderScore: q.sampleLeader,
  }));

  // 가인지 OKR 실행 보드
  let okrObjectives = [
    {
      id: 'OKR-2026-Q4-01',
      deptName: '전사 공통 · 영업/개발',
      ownerName: '김대표 / 팀장',
      objective: '핵심 고객 재구매율과 제품 품질을 동시에 도약시킨다',
      quarter: '2026-Q4',
      confidence: 8,
      aarNote: '주간 스프린트에서 고객 온보딩 병목 구간을 발견해 응답시간을 40% 단축함',
      krs: [
        { id: 'KR-1', title: '신규 B2B 고객사 20개사 온보딩 완료', current: 16, target: 20, unit: '개사' },
        { id: 'KR-2', title: '월간 반복매출(MRR) 성장률 18% 달성', current: 15, target: 18, unit: '%' },
        { id: 'KR-3', title: '핵심 역량 1on1 실시율 100% 유지', current: 92, target: 100, unit: '%' },
      ],
    },
  ];

  // 가인지 360 다면피드백 기록
  let peerReviews = [
    {
      id: 'PEER-01',
      targetEmpCode: 'EMP-201',
      reviewerRole: '동료(협업부서)',
      scores: { COLLAB: 5, COMMIT: 5, GROWTH: 4, CUSTOMER: 5, TRUST: 5 },
      keepText: '일정 리스크가 생길 때 숨기지 않고 먼저 공유하고 대안을 가져와 팀 전체 납기를 지켰습니다.',
      tryText: '신규 입사자 온보딩 문서화까지 주간 단위로 공유해 주면 더욱 좋겠습니다.',
      createdAt: '2026-11-20',
    },
  ];

  // 사번별 캘리브레이션 조정 사유 및 커미션/PS 개별 보정
  const workerMetaMap = new Map();
  let activeRoleView = 'CONSULTANT';

  function getOrCreateWorkerMeta(empCode) {
    if (!workerMetaMap.has(empCode)) {
      workerMetaMap.set(empCode, {
        calibrationReason: '',
        commissionSalesWon: 0,
        customBonusWon: null,
        pipStatus: 'NONE',
      });
    }
    return workerMetaMap.get(empCode);
  }

  function resetForNewRoster() {
    workerMetaMap.clear();
  }

  function scrubPurgedPerson(empCode) {
    if (empCode) {
      workerMetaMap.delete(empCode);
      peerReviews = peerReviews.filter((p) => p.targetEmpCode !== empCode);
    }
  }

  function exportPersistenceState() {
    return {
      clientProfile: { ...clientProfile },
      enabledModules: [...enabledModules],
      params: structuredClone(params),
      selectedCompetencyIds: [...selectedCompetencyIds],
      selectedKpiIds: [...selectedKpiIds],
      selectedSalaryTableId,
      hobongConfig: structuredClone(hobongConfig),
      competencyRatings: structuredClone(competencyRatings),
      okrObjectives: structuredClone(okrObjectives),
      peerReviews: structuredClone(peerReviews),
      workerMetaEntries: [...workerMetaMap.entries()],
      activeRoleView,
    };
  }

  function restorePersistenceState(saved) {
    if (!saved || typeof saved !== 'object') return;
    if (saved.clientProfile && typeof saved.clientProfile === 'object') {
      const cp = saved.clientProfile;
      if (typeof cp.clientName === 'string' && cp.clientName.trim()) {
        clientProfile.clientName = cp.clientName.trim().slice(0, 80);
      }
      if (typeof cp.industry === 'string' && cp.industry.trim()) {
        clientProfile.industry = cp.industry.trim().slice(0, 60);
      }
      if (typeof cp.sizeBand === 'string' && cp.sizeBand.trim()) {
        clientProfile.sizeBand = cp.sizeBand.trim().slice(0, 30);
      }
      if (typeof cp.hasUnion === 'boolean') {
        clientProfile.hasUnion = cp.hasUnion;
      }
      if (typeof cp.cultureType === 'string' && cp.cultureType.trim()) {
        clientProfile.cultureType = cp.cultureType.trim().slice(0, 40);
      }
      if (typeof cp.evalCycle === 'string' && cp.evalCycle.trim()) {
        clientProfile.evalCycle = cp.evalCycle.trim().slice(0, 50);
      }
      if (cp.fiscalYear !== undefined) {
        clientProfile.fiscalYear = clampInt(cp.fiscalYear, 2000, 2100, clientProfile.fiscalYear);
      }
      if (typeof cp.consultantNote === 'string') {
        clientProfile.consultantNote = cp.consultantNote.trim().slice(0, 300);
      }
      if (typeof cp.activePresetId === 'string' && cp.activePresetId.trim()) {
        clientProfile.activePresetId = cp.activePresetId.trim().slice(0, 60);
      }
    }
    if (Array.isArray(saved.enabledModules)) {
      enabledModules.clear();
      for (const code of saved.enabledModules) {
        if (MODULE_BY_CODE.has(code)) enabledModules.add(code);
      }
    }
    if (saved.params && typeof saved.params === 'object') {
      params.kpiWeightPct = clampInt(saved.params.kpiWeightPct, 0, 100, params.kpiWeightPct);
      params.compWeightPct = clampInt(saved.params.compWeightPct, 0, 100, params.compWeightPct);
      params.peerWeightPct = clampInt(saved.params.peerWeightPct, 0, 100, params.peerWeightPct);
      if (typeof saved.params.scoringMode === 'string') params.scoringMode = saved.params.scoringMode;
      if (typeof saved.params.paySystemType === 'string') params.paySystemType = saved.params.paySystemType;
      params.annualBudgetCapPct = clampFloat(saved.params.annualBudgetCapPct, 0, 30, params.annualBudgetCapPct);
      params.psPoolAmount = clampInt(saved.params.psPoolAmount, 0, 5000000000, params.psPoolAmount);
      params.commissionRatePct = clampFloat(saved.params.commissionRatePct, 0, 50, params.commissionRatePct);
      if (saved.params.quotaMap && typeof saved.params.quotaMap === 'object') {
        for (const g of VALID_GRADES) {
          if (saved.params.quotaMap[g] !== undefined) {
            params.quotaMap[g] = clampInt(saved.params.quotaMap[g], 0, 100, params.quotaMap[g]);
          }
        }
      }
      if (saved.params.meritMatrix && typeof saved.params.meritMatrix === 'object') {
        for (const g of VALID_GRADES) {
          const row = saved.params.meritMatrix[g];
          if (row && typeof row === 'object') {
            params.meritMatrix[g] = {
              raisePct: clampFloat(row.raisePct, 0, 40, params.meritMatrix[g].raisePct),
              bonusMonths: clampFloat(row.bonusMonths, 0, 12, params.meritMatrix[g].bonusMonths),
              defaultBonus: clampInt(row.defaultBonus, 0, 50000000, params.meritMatrix[g].defaultBonus),
            };
          }
        }
      }
    }
    if (Array.isArray(saved.selectedCompetencyIds)) {
      selectedCompetencyIds.clear();
      for (const id of saved.selectedCompetencyIds) {
        if (COMP_BY_ID.has(id)) selectedCompetencyIds.add(id);
      }
    }
    if (Array.isArray(saved.selectedKpiIds)) {
      selectedKpiIds.clear();
      for (const id of saved.selectedKpiIds) {
        if (KPI_BY_ID.has(id)) selectedKpiIds.add(id);
      }
    }
    if (typeof saved.selectedSalaryTableId === 'string' && SAL_BY_ID.has(saved.selectedSalaryTableId)) {
      selectedSalaryTableId = saved.selectedSalaryTableId;
    }
    if (
      Array.isArray(saved.hobongConfig) &&
      saved.hobongConfig.length === 6 &&
      saved.hobongConfig.every((r) => r && typeof r === 'object' && typeof r.rank === 'string')
    ) {
      hobongConfig = structuredClone(saved.hobongConfig);
    }
    if (Array.isArray(saved.competencyRatings)) {
      competencyRatings = structuredClone(saved.competencyRatings);
    }
    if (Array.isArray(saved.okrObjectives)) {
      okrObjectives = structuredClone(saved.okrObjectives);
    }
    if (Array.isArray(saved.peerReviews)) {
      peerReviews = structuredClone(saved.peerReviews);
    }
    if (Array.isArray(saved.workerMetaEntries)) {
      workerMetaMap.clear();
      for (const [k, v] of saved.workerMetaEntries) {
        if (typeof k === 'string' && v && typeof v === 'object') {
          workerMetaMap.set(k, structuredClone(v));
        }
      }
    }
    if (typeof saved.activeRoleView === 'string' && VALID_ROLES.has(saved.activeRoleView)) {
      activeRoleView = saved.activeRoleView;
    }
  }

  function applyPreset(presetId, customProfile) {
    const explicitPreset = PRESET_BY_ID.get(presetId) || null;
    if (explicitPreset) {
      clientProfile.industry = explicitPreset.industry;
      clientProfile.sizeBand = explicitPreset.sizeBand;
      clientProfile.hasUnion = Boolean(explicitPreset.hasUnion);
      clientProfile.cultureType = explicitPreset.cultureType;
    }
    if (customProfile) {
      if (typeof customProfile.clientName === 'string' && customProfile.clientName.trim()) {
        clientProfile.clientName = customProfile.clientName.trim().slice(0, 80);
      }
      if (typeof customProfile.industry === 'string' && customProfile.industry.trim()) {
        clientProfile.industry = customProfile.industry.trim();
      }
      if (typeof customProfile.sizeBand === 'string' && customProfile.sizeBand.trim()) {
        clientProfile.sizeBand = customProfile.sizeBand.trim();
      }
      if (typeof customProfile.hasUnion === 'boolean') {
        clientProfile.hasUnion = customProfile.hasUnion;
      }
      if (typeof customProfile.cultureType === 'string' && customProfile.cultureType.trim()) {
        clientProfile.cultureType = customProfile.cultureType.trim();
      }
    }
    const preset = explicitPreset || recommendPresetForProfile(clientProfile);
    clientProfile.activePresetId = preset.id;
    enabledModules.clear();
    for (const code of preset.modules) {
      if (MODULE_BY_CODE.has(code)) enabledModules.add(code);
    }
    params.kpiWeightPct = preset.weights.kpi;
    params.compWeightPct = preset.weights.competency;
    params.peerWeightPct = preset.weights.peer;
    params.scoringMode = preset.scoringType;
    params.paySystemType = preset.paySystemType;

    // 추천 직무 기반 가인지 420문항 자동 시드
    const roleMatches = GAINGE_COMPETENCY_400.filter(
      (c) => preset.defaultRoles.includes(c.role) && c.no <= 3
    );
    if (roleMatches.length > 0) {
      selectedCompetencyIds.clear();
      for (const item of roleMatches) selectedCompetencyIds.add(item.id);
    }

    // 추천 산업·규모 기반 연봉테이블 자동 매칭
    const salMatch = GAINGE_SALARY_TABLES_200.find(
      (t) => t.industry === clientProfile.industry && t.sizeBand === clientProfile.sizeBand
    ) || GAINGE_SALARY_TABLES_200.find((t) => t.industry === preset.industry);
    if (salMatch) selectedSalaryTableId = salMatch.id;

    return preset;
  }

  function computeCompetencySummary() {
    const analyzed = competencyRatings.map((item) => {
      const selfVal = clampInt(item.selfScore, 1, 5, 3);
      const leaderVal = clampInt(item.leaderScore, 1, 5, 3);
      const avg = Number(((selfVal + leaderVal) / 2).toFixed(2));
      const gap = leaderVal - selfVal; // 양수: 리더가 더 높게 봄, 음수: 자기평가가 더 높음(셀프 피드백 필요)
      return {
        ...item,
        selfScore: selfVal,
        leaderScore: leaderVal,
        avgScore: avg,
        gap,
      };
    });
    const byStrong = [...analyzed].sort((a, b) => b.avgScore - a.avgScore || b.leaderScore - a.leaderScore);
    const byWeak = [...analyzed].sort((a, b) => a.avgScore - b.avgScore || a.leaderScore - b.leaderScore);
    const bySelfGap = [...analyzed].sort((a, b) => a.gap - b.gap);

    const totalLeaderAvg = analyzed.length
      ? Number((analyzed.reduce((s, r) => s + r.leaderScore, 0) / analyzed.length).toFixed(2))
      : 0;
    const totalSelfAvg = analyzed.length
      ? Number((analyzed.reduce((s, r) => s + r.selfScore, 0) / analyzed.length).toFixed(2))
      : 0;

    return {
      items: analyzed,
      strengths: byStrong.slice(0, 3).map((x) => x.domain),
      weaknesses: byWeak.slice(0, 3).map((x) => x.domain),
      selfFeedbackNeeded: bySelfGap.filter((x) => x.gap < 0).slice(0, 3).map((x) => x.domain),
      totalSelfAvg,
      totalLeaderAvg,
    };
  }

  function computeGradeDistributionAndBudget(evalBoard) {
    const eligible = (evalBoard || []).filter((r) => r.evalEligible);
    const count = eligible.length;
    const counts = { S: 0, A: 0, B: 0, C: 0, D: 0 };

    let currentMonthlyBaseSum = 0;
    let projectedMonthlyBaseSum = 0;
    let totalBonusSum = 0;

    for (const r of eligible) {
      const g = VALID_GRADES.includes(r.grade) ? r.grade : 'B';
      counts[g] += 1;
      const matrix = params.meritMatrix[g] || DEFAULT_MERIT_MATRIX.B;
      const effRaise = Number.isFinite(matrix.raisePct) ? matrix.raisePct : r.recommendedRaisePct;
      const nextBase = Math.round(r.currentBasePay * (1 + effRaise / 100));
      currentMonthlyBaseSum += r.currentBasePay;
      projectedMonthlyBaseSum += nextBase;
      totalBonusSum += Number.isFinite(matrix.defaultBonus) ? matrix.defaultBonus : r.recommendedBonus;
    }

    const actualPct = {};
    for (const g of VALID_GRADES) {
      actualPct[g] = count > 0 ? Number(((counts[g] / count) * 100).toFixed(1)) : 0;
    }

    const monthlyIncrease = projectedMonthlyBaseSum - currentMonthlyBaseSum;
    const annualBaseIncrease = monthlyIncrease * 12;
    const avgRaisePct = currentMonthlyBaseSum > 0
      ? Number(((monthlyIncrease / currentMonthlyBaseSum) * 100).toFixed(2))
      : 0;
    const psPool = enabledModules.has('REW-PSPI') ? params.psPoolAmount : 0;
    const totalAnnualRewardImpact = annualBaseIncrease + totalBonusSum + psPool;

    // 9-Box 집계 (3x3)
    const nineBox = {
      HIGH_HIGH: [], MID_HIGH: [], LOW_HIGH: [],
      HIGH_MID: [], MID_MID: [], LOW_MID: [],
      HIGH_LOW: [], MID_LOW: [], LOW_LOW: [],
    };
    for (const r of eligible) {
      const perfBand = r.kpiScore >= 90 ? 'HIGH' : r.kpiScore >= 80 ? 'MID' : 'LOW';
      const compBand = r.competencyScore >= 90 ? 'HIGH' : r.competencyScore >= 80 ? 'MID' : 'LOW';
      const key = `${compBand}_${perfBand}`;
      nineBox[key].push({
        empCode: r.empCode,
        displayName: r.displayName,
        deptName: r.deptName,
        grade: r.grade,
        kpiScore: r.kpiScore,
        competencyScore: r.competencyScore,
      });
    }

    return {
      eligibleCount: count,
      gradeCounts: counts,
      actualPct,
      quotaMap: { ...params.quotaMap },
      currentMonthlyBaseSum,
      projectedMonthlyBaseSum,
      annualBaseIncrease,
      totalBonusSum,
      psPool,
      totalAnnualRewardImpact,
      avgRaisePct,
      overBudget: avgRaisePct > params.annualBudgetCapPct,
      nineBox,
    };
  }

  function buildView({ company, workers, evalBoard, payrollLines }) {
    const selectedCompetencyItems = GAINGE_COMPETENCY_400.filter((c) => selectedCompetencyIds.has(c.id));
    const selectedKpiItems = GAINGE_KPI_200.filter((k) => selectedKpiIds.has(k.id));
    const selectedSalaryTable = SAL_BY_ID.get(selectedSalaryTableId) || GAINGE_SALARY_TABLES_200[0];
    const hobongTable = computeHobongTable({ ranks: hobongConfig });
    const competencySummary = computeCompetencySummary();
    const budgetAndNineBox = computeGradeDistributionAndBudget(evalBoard);
    const legalGuardrails = evaluateLegalGuardrails({
      enabledSet: enabledModules,
      params,
      clientProfile,
      workers,
      evalBoard,
    });

    const boardWithMeta = (evalBoard || []).map((r) => {
      const meta = workerMetaMap.get(r.empCode) || {};
      const peerForWorker = peerReviews.filter((p) => p.targetEmpCode === r.empCode);
      const peerAvg = peerForWorker.length
        ? Number(
            (
              peerForWorker.reduce((sum, p) => {
                const vals = Object.values(p.scores || {});
                const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 4;
                return sum + avg;
              }, 0) / peerForWorker.length
            ).toFixed(2)
          )
        : 4.2;
      const compositeScore = Number(
        (
          (r.kpiScore * params.kpiWeightPct +
            r.competencyScore * params.compWeightPct +
            peerAvg * 20 * params.peerWeightPct) /
          Math.max(1, params.kpiWeightPct + params.compWeightPct + params.peerWeightPct)
        ).toFixed(1)
      );
      return {
        ...r,
        peerAvg,
        compositeScore,
        calibrationReason: meta.calibrationReason || '',
        commissionSalesWon: meta.commissionSalesWon || 0,
        pipStatus: meta.pipStatus || 'NONE',
      };
    });

    return {
      activeRoleView,
      clientProfile: {
        ...clientProfile,
        companyNameFallback: company?.companyName || clientProfile.clientName,
      },
      enabledModules: [...enabledModules],
      params: structuredClone(params),
      catalogStats: {
        totalModules: EVAL_REWARD_MODULES.length,
        enabledModulesCount: enabledModules.size,
        totalPresets: DIAGNOSTIC_PRESETS.length,
        totalCompRoles: GAINGE_COMPETENCY_ROLES.length,
        totalCompItems: GAINGE_COMPETENCY_400.length,
        selectedCompCount: selectedCompetencyItems.length,
        totalKpiRoles: GAINGE_KPI_ROLES.length,
        totalKpiItems: GAINGE_KPI_200.length,
        selectedKpiCount: selectedKpiItems.length,
        totalSalaryTables: GAINGE_SALARY_TABLES_200.length,
      },
      catalog: {
        layers: EVAL_REWARD_LAYERS,
        modules: EVAL_REWARD_MODULES,
        presets: DIAGNOSTIC_PRESETS,
        benchmarks: KOREA_HR_SAAS_BENCHMARKS,
        okrKit: GAINGE_OKR_KIT,
        peerKit: GAINGE_360_KIT,
        compRoles: GAINGE_COMPETENCY_ROLES,
        compItems: GAINGE_COMPETENCY_400,
        kpiRoles: GAINGE_KPI_ROLES,
        kpiItems: GAINGE_KPI_200,
        salaryGrades: GAINGE_SALARY_GRADES,
        salarySheets: GAINGE_SALARY_SHEETS,
        salaryTablesSummary: GAINGE_SALARY_TABLES_200.map((t) => ({
          id: t.id,
          industry: t.industry,
          sizeBand: t.sizeBand,
          subIndustry: t.subIndustry,
          region: t.region,
          headcount: t.headcount,
          avgSalary: t.avgSalary,
          revenue: t.revenue,
        })),
        compScales: GAINGE_COMPETENCY_TEMPLATE.scales,
      },
      selectedCompetencyIds: [...selectedCompetencyIds],
      selectedCompetencyItems,
      selectedKpiIds: [...selectedKpiIds],
      selectedKpiItems,
      selectedSalaryTableId,
      selectedSalaryTable,
      hobongConfig: structuredClone(hobongConfig),
      hobongTable,
      competencySummary,
      okrObjectives: structuredClone(okrObjectives),
      peerReviews: structuredClone(peerReviews),
      budgetAndNineBox,
      legalGuardrails,
      boardWithMeta,
      payrollSnapshotCount: (payrollLines || []).length,
    };
  }

  function applyAction(actionPayload, { state, evalGradeMap, appendAudit }) {
    const actionType = String(actionPayload?.actionType || '');

    switch (actionType) {
      case 'EVAL_SET_ROLE_VIEW': {
        const nextRole = String(actionPayload.role || '').trim().toUpperCase();
        if (!VALID_ROLES.has(nextRole)) throw badRequest('유효한 역할 뷰가 아닙니다.');
        activeRoleView = nextRole;
        return { message: `평가·보상 화면 뷰가 [${nextRole}] 모드로 전환되었습니다.` };
      }

      case 'EVAL_APPLY_DIAGNOSTIC_PRESET': {
        const presetId = actionPayload.presetId ? String(actionPayload.presetId).trim() : '';
        const profilePatch = {
          clientName: actionPayload.clientName,
          industry: actionPayload.industry,
          sizeBand: actionPayload.sizeBand,
          hasUnion: typeof actionPayload.hasUnion === 'boolean' ? actionPayload.hasUnion : undefined,
          cultureType: actionPayload.cultureType,
        };
        const applied = applyPreset(presetId, profilePatch);
        appendAudit(
          'M6모듈설계',
          `기업 진단 및 프리셋 [${applied.name}] 적용 (활성 모듈 ${enabledModules.size}개 · 가인지 문항 ${selectedCompetencyIds.size}개 자동 세팅)`
        );
        return {
          message: `[${applied.name}] 프리셋이 적용되어 ${enabledModules.size}개 모듈과 맞춤 직무문항·연봉테이블이 구성되었습니다.`,
        };
      }

      case 'EVAL_TOGGLE_MODULE': {
        const code = String(actionPayload.moduleCode || '').trim();
        if (!MODULE_BY_CODE.has(code)) throw badRequest(`알 수 없는 평가·보상 모듈 코드(${code})입니다.`);
        const shouldEnable =
          typeof actionPayload.enabled === 'boolean' ? actionPayload.enabled : !enabledModules.has(code);
        if (shouldEnable) {
          enabledModules.add(code);
        } else {
          enabledModules.delete(code);
        }
        const mod = MODULE_BY_CODE.get(code);
        appendAudit('M6모듈토글', `${mod.name}(${code}) → ${shouldEnable ? '활성' : '비활성'}`);
        return {
          message: `[${mod.name}] 모듈이 고객사 구성에 ${shouldEnable ? '포함' : '제외'}되었습니다. (현재 ${enabledModules.size}개 활성)`,
        };
      }

      case 'EVAL_UPDATE_PARAMS': {
        if (typeof actionPayload.clientName === 'string' && actionPayload.clientName.trim()) {
          clientProfile.clientName = actionPayload.clientName.trim().slice(0, 80);
        }
        if (typeof actionPayload.consultantNote === 'string') {
          clientProfile.consultantNote = actionPayload.consultantNote.trim().slice(0, 300);
        }
        if (actionPayload.kpiWeightPct !== undefined) {
          params.kpiWeightPct = clampInt(actionPayload.kpiWeightPct, 0, 100, params.kpiWeightPct);
        }
        if (actionPayload.compWeightPct !== undefined) {
          params.compWeightPct = clampInt(actionPayload.compWeightPct, 0, 100, params.compWeightPct);
        }
        if (actionPayload.peerWeightPct !== undefined) {
          params.peerWeightPct = clampInt(actionPayload.peerWeightPct, 0, 100, params.peerWeightPct);
        }
        if (actionPayload.annualBudgetCapPct !== undefined) {
          params.annualBudgetCapPct = clampFloat(actionPayload.annualBudgetCapPct, 0, 30, params.annualBudgetCapPct);
        }
        if (actionPayload.psPoolAmount !== undefined) {
          params.psPoolAmount = clampInt(actionPayload.psPoolAmount, 0, 5000000000, params.psPoolAmount);
        }
        if (actionPayload.commissionRatePct !== undefined) {
          params.commissionRatePct = clampFloat(actionPayload.commissionRatePct, 0, 50, params.commissionRatePct);
        }
        if (actionPayload.quotaMap && typeof actionPayload.quotaMap === 'object') {
          for (const g of VALID_GRADES) {
            if (actionPayload.quotaMap[g] !== undefined) {
              params.quotaMap[g] = clampInt(actionPayload.quotaMap[g], 0, 100, params.quotaMap[g]);
            }
          }
        }
        if (actionPayload.meritMatrix && typeof actionPayload.meritMatrix === 'object') {
          for (const g of VALID_GRADES) {
            const row = actionPayload.meritMatrix[g];
            if (row && typeof row === 'object') {
              params.meritMatrix[g] = {
                raisePct: clampFloat(row.raisePct, 0, 40, params.meritMatrix[g].raisePct),
                bonusMonths: clampFloat(row.bonusMonths, 0, 12, params.meritMatrix[g].bonusMonths),
                defaultBonus: clampInt(row.defaultBonus, 0, 50000000, params.meritMatrix[g].defaultBonus),
              };
            }
          }
        }
        appendAudit('M6보상규칙', `평가 가중치(${params.kpiWeightPct}/${params.compWeightPct}/${params.peerWeightPct}) 및 보상예산 한도(${params.annualBudgetCapPct}%) 갱신`);
        return { message: '평가 가중치·등급별 인상률/성과급·예산 기준이 갱신되었습니다.' };
      }

      case 'EVAL_TOGGLE_COMPETENCY_ITEM': {
        if (typeof actionPayload.roleBulk === 'string' && actionPayload.roleBulk.trim()) {
          const roleName = actionPayload.roleBulk.trim();
          const targets = GAINGE_COMPETENCY_400.filter((c) => c.role === roleName);
          if (targets.length === 0) throw badRequest('해당 직무를 찾을 수 없습니다.');
          const shouldAdd = actionPayload.include !== false;
          for (const item of targets) {
            if (shouldAdd) selectedCompetencyIds.add(item.id);
            else selectedCompetencyIds.delete(item.id);
          }
          return { message: `[${roleName}] 직무 역량 ${targets.length}개 문항을 ${shouldAdd ? '일괄 편입' : '일괄 제외'}했습니다.` };
        }
        const itemId = String(actionPayload.itemId || '').trim();
        if (!COMP_BY_ID.has(itemId)) throw badRequest('존재하지 않는 역량 문항 ID입니다.');
        const nextAdd = typeof actionPayload.include === 'boolean' ? actionPayload.include : !selectedCompetencyIds.has(itemId);
        if (nextAdd) selectedCompetencyIds.add(itemId);
        else selectedCompetencyIds.delete(itemId);
        return { message: `역량 문항(${COMP_BY_ID.get(itemId).title})이 고객사 평가표에 ${nextAdd ? '편입' : '제외'}되었습니다.` };
      }

      case 'EVAL_TOGGLE_KPI_ITEM': {
        if (typeof actionPayload.roleBulk === 'string' && actionPayload.roleBulk.trim()) {
          const roleName = actionPayload.roleBulk.trim();
          const targets = GAINGE_KPI_200.filter((k) => k.role === roleName);
          if (targets.length === 0) throw badRequest('해당 KPI 직무를 찾을 수 없습니다.');
          const shouldAdd = actionPayload.include !== false;
          for (const item of targets) {
            if (shouldAdd) selectedKpiIds.add(item.id);
            else selectedKpiIds.delete(item.id);
          }
          return { message: `[${roleName}] 직무 KPI ${targets.length}개를 ${shouldAdd ? '일괄 편입' : '일괄 제외'}했습니다.` };
        }
        const itemId = String(actionPayload.itemId || '').trim();
        if (!KPI_BY_ID.has(itemId)) throw badRequest('존재하지 않는 KPI ID입니다.');
        const nextAdd = typeof actionPayload.include === 'boolean' ? actionPayload.include : !selectedKpiIds.has(itemId);
        if (nextAdd) selectedKpiIds.add(itemId);
        else selectedKpiIds.delete(itemId);
        return { message: `KPI 지표(${KPI_BY_ID.get(itemId).name})가 고객사 KPI 풀에 ${nextAdd ? '편입' : '제외'}되었습니다.` };
      }

      case 'EVAL_SELECT_SALARY_TABLE': {
        const tableId = String(actionPayload.tableId || '').trim();
        if (!SAL_BY_ID.has(tableId)) throw badRequest('존재하지 않는 연봉테이블 ID입니다.');
        selectedSalaryTableId = tableId;
        const tbl = SAL_BY_ID.get(tableId);
        return { message: `벤치마크 연봉테이블이 [${tbl.industry} · ${tbl.subIndustry}(${tbl.sizeBand})]로 설정되었습니다.` };
      }

      case 'EVAL_UPDATE_HOBONG_CONFIG': {
        const idx = clampInt(actionPayload.rankIndex, 0, 5, -1);
        if (idx < 0 || idx > 5) throw badRequest('직급 인덱스(0~5)가 올바르지 않습니다.');
        const cur = { ...hobongConfig[idx] };
        if (actionPayload.stdYears !== undefined) cur.stdYears = clampInt(actionPayload.stdYears, 1, 10, cur.stdYears);
        if (actionPayload.entryPayManwon !== undefined && idx === 0) {
          cur.entryPayManwon = clampInt(actionPayload.entryPayManwon, 1800, 15000, cur.entryPayManwon || 3200);
        }
        if (actionPayload.normalRatePct !== undefined) {
          cur.normalRate = clampFloat(Number(actionPayload.normalRatePct) / 100, 0, 0.3, cur.normalRate);
        }
        if (actionPayload.promoRatePct !== undefined) {
          cur.promoRate = clampFloat(Number(actionPayload.promoRatePct) / 100, 0, 0.4, cur.promoRate);
        }
        hobongConfig[idx] = cur;
        const recalculatedRows = computeHobongTable({ ranks: hobongConfig });
        return { message: `[${cur.rank}] 호봉 기준이 갱신되어 ${recalculatedRows.length}호봉 급여테이블이 즉시 재계산되었습니다.` };
      }

      case 'EVAL_UPDATE_COMPETENCY_SCORE': {
        const itemId = String(actionPayload.itemId || '').trim();
        const target = competencyRatings.find((q) => q.id === itemId);
        if (!target) throw badRequest('역량평가 문항을 찾을 수 없습니다.');
        if (actionPayload.selfScore !== undefined) target.selfScore = clampInt(actionPayload.selfScore, 1, 5, target.selfScore);
        if (actionPayload.leaderScore !== undefined) target.leaderScore = clampInt(actionPayload.leaderScore, 1, 5, target.leaderScore);
        return { message: `[${target.domain}] 역량 점수(자기 ${target.selfScore} / 리더 ${target.leaderScore})가 반영되었습니다.` };
      }

      case 'EVAL_SAVE_OKR_ITEM': {
        const objective = String(actionPayload.objective || '').trim();
        if (!objective) throw badRequest('OKR 목표(Objective)를 입력해 주세요.');
        const deptName = String(actionPayload.deptName || '공통팀').trim().slice(0, 40);
        const confidence = clampInt(actionPayload.confidence, 1, 10, 7);
        const kr1 = String(actionPayload.kr1 || '').trim() || '핵심 결과 지표 달성 100%';
        const kr1Pct = clampInt(actionPayload.kr1Pct, 0, 100, 65);
        const aarNote = String(actionPayload.aarNote || '').trim().slice(0, 200);
        const nextSeq =
          okrObjectives.reduce((mx, o) => Math.max(mx, Number(String(o.id || '').split('-').pop()) || 0), 0) + 1;
        const id = `OKR-2026-Q4-${String(nextSeq).padStart(2, '0')}`;
        okrObjectives.unshift({
          id,
          deptName,
          ownerName: String(actionPayload.ownerName || '담당 리더').trim().slice(0, 40),
          objective: objective.slice(0, 140),
          quarter: '2026-Q4',
          confidence,
          aarNote,
          krs: [{ id: 'KR-1', title: kr1.slice(0, 120), current: kr1Pct, target: 100, unit: '%' }],
        });
        if (okrObjectives.length > 20) okrObjectives.length = 20;
        appendAudit('M6OKR등록', `[${deptName}] OKR 목표 등록: ${objective.slice(0, 50)}`);
        return { message: `[${deptName}] OKR 목표 및 주간 스프린트 카드가 등록되었습니다.` };
      }

      case 'EVAL_SAVE_PEER_REVIEW': {
        const targetEmpCode = String(actionPayload.targetEmpCode || '').trim();
        const w = (state?.workers || []).find((item) => item.empCode === targetEmpCode);
        if (!w) throw badRequest('피평가자(사번)를 찾을 수 없습니다.');
        peerReviews.unshift({
          id: `PEER-${Date.now().toString(36).toUpperCase()}`,
          targetEmpCode,
          reviewerRole: String(actionPayload.reviewerRole || '동료').trim().slice(0, 30),
          scores: {
            COLLAB: clampInt(actionPayload.collabScore, 1, 5, 4),
            COMMIT: clampInt(actionPayload.commitScore, 1, 5, 4),
            GROWTH: clampInt(actionPayload.growthScore, 1, 5, 4),
            CUSTOMER: clampInt(actionPayload.customerScore, 1, 5, 4),
            TRUST: clampInt(actionPayload.trustScore, 1, 5, 4),
          },
          keepText: String(actionPayload.keepText || '').trim().slice(0, 250),
          tryText: String(actionPayload.tryText || '').trim().slice(0, 250),
          createdAt: '2026-11-28',
        });
        if (peerReviews.length > 50) peerReviews.length = 50;
        appendAudit('M6다면피드백', `[${w.displayName}] 360° 다면 피드백 등록`);
        return { message: `[${w.displayName}] 대상 360° 다면 피드백이 저장되었습니다.` };
      }

      case 'EVAL_CALIBRATE_WORKER': {
        const empCode = String(actionPayload.empCode || '').trim();
        const grade = String(actionPayload.grade || '').trim().toUpperCase();
        const reason = String(actionPayload.reason || '').trim().slice(0, 200);
        const w = (state?.workers || []).find((item) => item.empCode === empCode);
        if (!w) throw badRequest('대상 직원을 찾을 수 없습니다.');
        const isEligible =
          w.workerCategory === 'REGULAR' ||
          w.workerCategory === 'FIXED_TERM' ||
          w.workerCategory === 'PART_TIME';
        if (!isEligible) {
          throw badRequest('별도 계약(일용·프리랜서) 직원은 인사평가 등급 보정 대상이 아닙니다.');
        }
        if (!VALID_GRADES.includes(grade)) throw badRequest('등급은 S, A, B, C, D 중 하나여야 합니다.');

        const merit = params.meritMatrix[grade] || DEFAULT_MERIT_MATRIX[grade];
        const defaultKpi = grade === 'S' ? 96 : grade === 'A' ? 91 : grade === 'B' ? 83 : grade === 'C' ? 74 : 65;
        const defaultComp = grade === 'S' ? 95 : grade === 'A' ? 90 : grade === 'B' ? 82 : grade === 'C' ? 75 : 68;
        const prev = evalGradeMap.get(empCode);
        const fallbackKpi = prev && prev.grade === grade ? prev.kpiScore : defaultKpi;
        const fallbackComp = prev && prev.grade === grade ? prev.competencyScore : defaultComp;
        evalGradeMap.set(empCode, {
          kpiScore: actionPayload.kpiScore !== undefined ? clampInt(actionPayload.kpiScore, 0, 100, fallbackKpi) : fallbackKpi,
          competencyScore: actionPayload.competencyScore !== undefined ? clampInt(actionPayload.competencyScore, 0, 100, fallbackComp) : fallbackComp,
          grade,
          recommendedRaisePct: merit.raisePct,
          recommendedBonus: merit.defaultBonus,
          appliedToPayroll: false,
        });
        const meta = getOrCreateWorkerMeta(empCode);
        if (reason) meta.calibrationReason = reason;
        appendAudit('M6캘리브레이션', `[${empCode} ${w.displayName}] ${grade}등급 보정${reason ? ` (${reason})` : ''}`);
        return { message: `[${w.displayName}] 캘리브레이션 등급이 ${grade}등급(+${merit.raisePct}% · 성과급 ${merit.defaultBonus.toLocaleString('ko-KR')}원)으로 조정되었습니다.` };
      }

      case 'EVAL_IMPORT_CLIENT_CONFIG': {
        const cfg = actionPayload.config;
        if (!cfg || typeof cfg !== 'object') throw badRequest('유효한 고객사 프리셋 JSON 객체가 필요합니다.');
        restorePersistenceState({
          clientProfile: cfg.clientProfile,
          enabledModules: cfg.enabledModules,
          params: cfg.params,
          selectedCompetencyIds: cfg.selectedCompetencyIds,
          selectedKpiIds: cfg.selectedKpiIds,
          selectedSalaryTableId: cfg.selectedSalaryTableId,
          hobongConfig: cfg.hobongConfig,
        });
        appendAudit('M6프리셋복원', `고객사 모듈 프리셋 [${clientProfile.clientName}] 불러오기 완료 (${enabledModules.size}개 모듈)`);
        return { message: `[${clientProfile.clientName}] 고객사 평가·보상 프리셋(${enabledModules.size}개 모듈)이 복원되었습니다.` };
      }

      default:
        return null;
    }
  }

  return Object.freeze({
    buildView,
    applyAction,
    resetForNewRoster,
    scrubPurgedPerson,
    exportPersistenceState,
    restorePersistenceState,
  });
}
