/**
 * modular-hr 프론트엔드 컨트롤러
 * - XSS 및 CSP 위반 원천 방지를 위해 innerHTML과 인라인 style 속성을 일절 사용하지 않는다.
 * - 모듈 카드 선택 시 DOM 파괴 없이 속성만 갱신해 키보드 포커스를 유지하고 aria-pressed를 제공한다.
 * - 모달 표시 시 배경 랜드마크 전체에 inert 및 aria-hidden="true"를 적용해 배경 탐색을 차단한다.
 */

const appState = {
  csrfToken: '',
  snapshot: null,
  selectedModuleId: 'M10_LMC',
  activeGroup: 'home',
  activeTab: 'ops-home',
  lastSubTabByGroup: {},
  onboardingLoadedOnce: false,
  latestStaging: null,
  lastFocusedBeforeModal: null,
  lastFocusedBeforeModulePopup: null,
  popupModalTabKey: null,
  popupRestoreSlot: null,
  autoUnlockAttempted: false,
  demoInputConfirmed: false,
  pcSse: null,
  pcSseCleanupBound: false,
  pcSyncChannel: null,
  toastTimer: null,
};

const MAJOR_MENU_GROUPS = [
  {
    groupKey: 'home',
    groupTitle: '대시보드',
    tabs: [{ key: 'ops-home', label: '전사 현황 요약' }],
  },
  {
    groupKey: 'hr',
    groupTitle: '인사 관리',
    tabs: [
      { key: 'ops-org', label: '인사명부 · 발령' },
      { key: 'ops-recruit', label: '채용 · 근로계약' },
      { key: 'ops-discipline', label: '징계 · 고충처리' },
      { key: 'alumni', label: '퇴사자 관리' },
    ],
  },
  {
    groupKey: 'attendance',
    groupTitle: '근태 관리',
    tabs: [
      { key: 'ops-attendance', label: '출퇴근 · 연장근로 현황' },
      { key: 'lifecycle', label: '근로시간 · 법령 시뮬레이터' },
    ],
  },
  {
    groupKey: 'leave',
    groupTitle: '연차 관리',
    tabs: [
      { key: 'ops-leave', label: '연차 발생 · 사용 원장' },
      { key: 'ops-leave-promo', label: '연차 사용촉진 · 모성보호' },
    ],
  },
  {
    groupKey: 'payroll',
    groupTitle: '급여 관리',
    tabs: [
      { key: 'payroll', label: '월 급여대장 · 임금명세서' },
      { key: 'ops-eval', label: '인사평가 · 성과보상 반영' },
    ],
  },
  {
    groupKey: 'legal',
    groupTitle: '법정 · 서식',
    tabs: [
      { key: 'forms-center', label: '표준 서식함 (14종)' },
      { key: 'ops-statutory', label: '노사협의회 · 안전보건 · 교육' },
      { key: 'compliance', label: '관공서 신고 기한' },
      { key: 'floor', label: '규모별 모듈 현황' },
    ],
  },
  {
    groupKey: 'settings',
    groupTitle: '환경 설정',
    tabs: [
      { key: 'settings-master', label: '기업 · 근로자수 · 연차 · 급여 기준' },
      { key: 'onboarding', label: '4종 문서 자동세팅' },
    ],
  },
];

const ALL_PANEL_SPECS = MAJOR_MENU_GROUPS.flatMap((g) =>
  g.tabs.map((t) => ({
    key: t.key,
    label: `${g.groupTitle} > ${t.label}`,
    subLabel: t.label,
    groupKey: g.groupKey,
    groupTitle: g.groupTitle,
  }))
);

const LIFECYCLE_STEPS = [
  { step: '01', title: 'M1 채용', desc: '30인+ 공정채용·최저임금 검증' },
  { step: '02', title: 'M2 입사·계약', desc: '근기법 17조 교부·취득신고' },
  { step: '03', title: 'M3 인사·발령', desc: '조직·승진·휴복직·증명서' },
  { step: '04', title: 'M4 근태', desc: '출퇴근·교대·주52시간 경보' },
  { step: '05', title: 'M5 연차·휴가', desc: '분단위 원장·1/2차 사용촉진' },
  { step: '06', title: 'M6 평가·보상', desc: '등급 산출·인상률·성과급' },
  { step: '07', title: 'M7 징계·고충', desc: '4대 절차·제95조 감봉 캡핑' },
  { step: '08', title: 'M8 자동급여', desc: '5인 가산분기·명세서·원천세' },
  { step: '09', title: 'M9 퇴사·정산', desc: '평균vs통상·14일 기한·지원금경보' },
];

const BACKGROUND_SELECTORS = [
  'a.skip-link',
  '#app-shell',
  '#sidebar-backdrop',
  '#floating-toast',
];

function fmtWon(num) {
  return `${Math.round(Number(num) || 0).toLocaleString('ko-KR')}원`;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'className') {
      el.className = String(val);
    } else if (key === 'dataset' && typeof val === 'object') {
      for (const [dk, dv] of Object.entries(val)) {
        if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
      }
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'style') {
      throw new Error('CSP 준수를 위해 인라인 style 속성은 허용되지 않습니다.');
    } else if (val === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(val));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
  return el;
}

function setBackgroundInert(isInert) {
  for (const sel of BACKGROUND_SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.inert = Boolean(isInert);
    if (isInert) {
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('aria-hidden');
    }
  }
}

function showBanner(message, isError = false) {
  const banner = document.getElementById('status-banner');
  const toast = document.getElementById('floating-toast');
  const toastText = document.getElementById('floating-toast-text');

  if (!message) {
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
    if (toast) toast.hidden = true;
    return;
  }

  if (banner) {
    banner.hidden = false;
    banner.className = isError ? 'status-banner tag-red' : 'status-banner';
    banner.textContent = message;
  }

  if (toast && toastText) {
    toast.dataset.error = String(Boolean(isError));
    toastText.textContent = message;
    toast.hidden = false;
    if (appState.toastTimer) clearTimeout(appState.toastTimer);
    if (!isError) {
      appState.toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 5000);
    }
  }
}

async function apiPost(path, payload, triggerControl = null) {
  if (triggerControl) {
    triggerControl.disabled = true;
    triggerControl.setAttribute('aria-busy', 'true');
  }
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': appState.csrfToken,
      },
      body: JSON.stringify(payload || {}),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      throw new Error(data.error || `요청 처리에 실패했습니다 (HTTP ${res.status})`);
    }
    if (
      appState.pcSyncChannel &&
      path !== '/api/validate-posting' &&
      path !== '/api/preview-offboarding' &&
      path !== '/api/onboarding/stage' &&
      path !== '/api/document'
    ) {
      try {
        appState.pcSyncChannel.postMessage({ type: 'STATE_MUTATED' });
      } catch {
        // ignore channel close
      }
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('로컬 서버와 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.');
    }
    throw err;
  } finally {
    if (triggerControl) {
      triggerControl.disabled = false;
      triggerControl.removeAttribute('aria-busy');
    }
  }
}

/* ==========================================================================
   상단 시뮬레이터 제어판 & KPI 렌더링
   ========================================================================== */

function syncFiscalControlState() {
  const basisSel = document.getElementById('select-leave-basis');
  const fiscalStartSel = document.getElementById('select-fiscal-start');
  const roundingSel = document.getElementById('select-leave-rounding');
  const isFiscal = basisSel?.value === 'FISCAL_YEAR';
  if (fiscalStartSel) fiscalStartSel.disabled = !isFiscal;
  if (roundingSel) roundingSel.disabled = !isFiscal;
}

function syncSimFormControls(snapshot) {
  const { company, industries, presets, emptyRosterMode } = snapshot;
  const policy = snapshot.operationsSuite?.policySettings || company.policySettings || {};

  const ksicSelect = document.getElementById('select-ksic');
  if (ksicSelect && ksicSelect.options.length === 0) {
    for (const ind of industries) {
      ksicSelect.appendChild(h('option', { value: ind.code }, `[${ind.code}] ${ind.name}`));
    }
  }
  if (ksicSelect) ksicSelect.value = company.ksicMajor;

  const presetWrap = document.getElementById('preset-buttons');
  if (presetWrap) {
    const buttons = presets.map((p) =>
      h(
        'button',
        {
          type: 'button',
          className: 'preset-btn',
          'aria-pressed': String(company.id === p.id),
          onClick: async (e) => {
            try {
              const data = await apiPost('/api/simulate-company', { presetId: p.id }, e.currentTarget);
              updateSnapshot(data.snapshot);
              showBanner(`기업 규모 시나리오 적용 완료: ${data.snapshot.company.companyName} (${p.badge})`);
            } catch (err) {
              showBanner(err.message, true);
            }
          },
        },
        p.badge
      )
    );
    presetWrap.replaceChildren(...buttons);
  }

  const presetSel = document.getElementById('popup-preset-select');
  if (presetSel) {
    const matchedPreset = presets.some((p) => p.id === company.id);
    const opts = presets.map((p) =>
      h('option', { value: p.id }, `사업장 규모: ${p.badge}`)
    );
    if (!matchedPreset) {
      opts.unshift(h('option', { value: '' }, `현재 설정: ${company.companyName}`));
    }
    presetSel.replaceChildren(...opts);
    presetSel.value = matchedPreset ? company.id : '';
  }

  const setVal = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.value = String(val ?? '');
  };
  setVal('input-company-name', company.companyName);
  setVal('input-regular-workers', company.headcountInput.regularWorkers);
  setVal('input-parttime-workers', company.headcountInput.partTimeWorkers);
  setVal('input-daily-mandays', company.headcountInput.dailyWorkerManDays);
  setVal('input-dispatched-workers', company.headcountInput.dispatchedWorkers);
  setVal('input-operating-days', company.headcountInput.operatingDays);
  setVal('input-trigger-date', company.triggerDate);

  setVal('select-leave-basis', policy.leaveAccrualBasis || 'HIRE_DATE');
  setVal('select-fiscal-start', policy.fiscalYearStartMonthDay || '01-01');
  setVal('select-leave-rounding', policy.leaveRoundingRule || 'ROUND_TENTH');
  setVal('select-leave-settlement', policy.leaveSettlementPolicy || 'PROMOTE_FIRST');
  setVal('input-weekly-warn', policy.weeklyWarnHours ?? 48);
  setVal('select-pay-day', policy.payDayLabel || '매월 25일');
  setVal('select-tax-rate', policy.withholdingTaxRatePct ?? 100);
  setVal('input-meal-limit', policy.nonTaxableMealLimit ?? 200000);
  syncFiscalControlState();

  const unionCheck = document.getElementById('check-majority-union');
  if (unionCheck) unionCheck.checked = Boolean(company.hasMajorityUnion);

  const subCheck = document.getElementById('check-subsidies');
  if (subCheck) subCheck.checked = (company.activeSubsidies || []).length > 0;

  const emptyToggle = document.getElementById('toggle-empty-roster');
  if (emptyToggle) emptyToggle.checked = Boolean(emptyRosterMode);
}

function formatLeaveBasisShort(policy) {
  if (!policy || policy.leaveAccrualBasis !== 'FISCAL_YEAR') {
    return '입사일 기준';
  }
  return `회계연도(${policy.fiscalYearStartMonthDay || '01-01'}) 기준`;
}

function renderHeadcountKpis(snapshot) {
  const { compliance } = snapshot;
  const hc = compliance.headcounts;
  const policy = snapshot.operationsSuite?.policySettings || snapshot.company.policySettings || {};
  const autoCount = compliance.floorPlan.filter((m) => m.status === 'AUTO_PROVISIONED').length;
  const pendingFilings = compliance.statutoryFilings.filter((f) => !f.isCompleted).length;
  const leaveBasisLabel = formatLeaveBasisShort(policy);

  const cards = [
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '근로기준법 상시근로자 수'),
      h('div', { className: 'kpi-value' }, `${hc.lsaRegularCount}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        `연인원 ${hc.cumulativeManDays} ÷ 가동 ${hc.operatingDays}일 (${hc.is5OrMore ? '5인+ 가산·연차 적용' : '5인 미만 특례'})`
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '산안법 관리 인원 · 자동 모듈'),
      h('div', { className: 'kpi-value' }, `산안법 ${hc.oshRegularCount}명 · ${autoCount}개 모듈`),
      h(
        'div',
        { className: 'kpi-sub' },
        compliance.oshFlags.needsSafetyOfficer
          ? '50인+ 안전·보건관리자 및 산안위 가동 중'
          : hc.is30OrMore
            ? '30인+ 노사협의회 · 고충처리위원 가동 중'
            : '규모 성장 시 법정기구 자동 개설'
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '적용 중인 연차 · 근태 정책'),
      h('div', { className: 'kpi-value' }, leaveBasisLabel),
      h(
        'div',
        { className: 'kpi-sub' },
        `주 ${policy.weeklyWarnHours ?? 48}h 사전주의 / 52h 상한 · ${
          policy.leaveSettlementPolicy === 'FULL_PAYOUT' ? '잔여연차 전액보상' : '제61조 사용촉진 우선'
        }`
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '적용 중인 급여 · 세무 기준'),
      h('div', { className: 'kpi-value' }, `${policy.payDayLabel || '매월 25일'} 지급`),
      h(
        'div',
        { className: 'kpi-sub' },
        `원천세 ${policy.withholdingTaxRatePct ?? 100}% · 식대비과세 ${fmtWon(policy.nonTaxableMealLimit ?? 200000)}`
      )
    ),
  ];

  const strip = document.getElementById('headcount-kpi-strip');
  if (strip) strip.replaceChildren(...cards);

  const compactLine = document.getElementById('compact-workplace-summary');
  if (compactLine) {
    const indObj = (snapshot.industries || []).find((i) => i.code === snapshot.company.ksicMajor);
    compactLine.replaceChildren(
      h('span', { className: 'font-extrabold' }, snapshot.company.companyName),
      h('span', {}, `· 상시 ${hc.lsaRegularCount}명 (${indObj ? indObj.name.split(' ')[0] : '제조업'})`),
      h('span', { className: 'tag tag-blue' }, `연차: ${leaveBasisLabel}`),
      h('span', { className: 'tag tag-gray' }, `급여: ${policy.payDayLabel || '매월 25일'}`)
    );
  }

  if (hc.upcomingThresholdWarnings.length > 0) {
    showBanner(hc.upcomingThresholdWarnings.map((w) => w.message).join(' / '));
  }

  const sbName = document.getElementById('sidebar-company-name');
  if (sbName) sbName.textContent = snapshot.company.companyName;
  const sbMeta = document.getElementById('sidebar-company-meta');
  if (sbMeta) {
    sbMeta.textContent = `상시 ${hc.lsaRegularCount}명 · ${leaveBasisLabel} · ${policy.payDayLabel || '매월 25일'}`;
  }

  const k = snapshot.operationsSuite?.overviewKpis;
  const setMajorBadge = (groupKey, text) => {
    const el = document.getElementById(`major-badge-${groupKey}`);
    if (el) el.textContent = text;
  };
  if (k) {
    setMajorBadge('home', '요약');
    setMajorBadge(
      'hr',
      k.unsignedContractCount > 0 ? `계약 ${k.unsignedContractCount}` : `${k.activeRosterCount}명`
    );
    setMajorBadge(
      'attendance',
      k.over52Count > 0 ? `초과 ${k.over52Count}` : k.near52Count > 0 ? `주의 ${k.near52Count}` : '정상'
    );
    setMajorBadge(
      'leave',
      policy.leaveAccrualBasis === 'FISCAL_YEAR' ? '회계연도' : '입사일'
    );
    setMajorBadge('payroll', `${snapshot.payrollSummary?.workerCount || 0}명`);
    setMajorBadge('legal', pendingFilings > 0 ? `신고 ${pendingFilings}` : '14종');
    setMajorBadge('settings', `${hc.lsaRegularCount}인`);
  }
}

/* ==========================================================================
   탭 1: 4계층 모듈형 Floor Plan & 상세 인스펙터
   ========================================================================== */

function statusTagClass(status) {
  switch (status) {
    case 'AUTO_PROVISIONED':
      return 'tag tag-green';
    case 'ACTIVE_REQUIRED':
      return 'tag tag-blue';
    case 'SCALE_DOWN_REVIEW':
      return 'tag tag-red';
    case 'OPTIONAL_AVAILABLE':
      return 'tag tag-amber';
    default:
      return 'tag tag-gray';
  }
}

function selectModuleInPlace(moduleId) {
  appState.selectedModuleId = moduleId;
  const buttons = document.querySelectorAll('#floor-stack .module-card');
  for (const btn of buttons) {
    const isSel = btn.dataset.moduleId === moduleId;
    btn.dataset.selected = String(isSel);
    btn.setAttribute('aria-pressed', String(isSel));
  }
  if (appState.snapshot) {
    renderModuleInspector(appState.snapshot);
  }
}

function renderFloorPlan(snapshot) {
  const stack = document.getElementById('floor-stack');
  if (!stack) return;

  const prevFocusedModId =
    document.activeElement && document.activeElement.classList.contains('module-card')
      ? document.activeElement.dataset.moduleId
      : null;

  const { floorPlan } = snapshot.compliance;
  const floors = [4, 3, 2, 1];

  const rows = floors.map((floorNum) => {
    const items = floorPlan.filter((m) => m.floor === floorNum);
    const floorTitle = items[0]?.floorLabel || `${floorNum}F`;

    return h(
      'div',
      { className: 'floor-row' },
      h(
        'div',
        { className: 'floor-row-header' },
        h('h3', { className: 'floor-name' }, floorTitle),
        h('span', { className: 'tag tag-gray' }, `모듈 ${items.length}개`)
      ),
      h(
        'div',
        { className: 'module-grid' },
        items.map((mod) => {
          const isSelected = appState.selectedModuleId === mod.id;
          return h(
            'button',
            {
              type: 'button',
              className: 'module-card',
              'aria-pressed': String(isSelected),
              dataset: {
                moduleId: mod.id,
                selected: String(isSelected),
                status: mod.status,
              },
              onClick: () => selectModuleInPlace(mod.id),
            },
            h(
              'div',
              { className: 'module-card-top' },
              h('span', { className: 'module-code' }, mod.code),
              h('span', { className: statusTagClass(mod.status) }, mod.statusLabel)
            ),
            h('div', { className: 'module-title' }, mod.title)
          );
        })
      )
    );
  });

  stack.replaceChildren(...rows);

  if (prevFocusedModId) {
    const targetBtn = stack.querySelector(`.module-card[data-module-id="${prevFocusedModId}"]`);
    targetBtn?.focus();
  }

  renderModuleInspector(snapshot);
}

function renderModuleInspector(snapshot) {
  const inspector = document.getElementById('module-inspector');
  if (!inspector) return;

  const { floorPlan } = snapshot.compliance;
  const selected =
    floorPlan.find((m) => m.id === appState.selectedModuleId) || floorPlan[0];

  inspector.replaceChildren(
    h('span', { className: statusTagClass(selected.status) }, selected.statusLabel),
    h('h3', { className: 'inspector-heading' }, `[${selected.code}] ${selected.title}`),
    h('p', { className: 'inspector-desc' }, selected.summary),
    h(
      'div',
      { className: 'inspector-section' },
      h('div', { className: 'inspector-label' }, '현재 사업장 판정 사유'),
      h('div', {}, selected.reason)
    ),
    h(
      'div',
      { className: 'inspector-section' },
      h('div', { className: 'inspector-label' }, '적용 노동관계법령 가드레일'),
      h('div', {}, selected.legalGuardrail)
    ),
    h(
      'div',
      { className: 'inspector-section' },
      h('div', { className: 'inspector-label' }, '급여 자동화 엔진(M8) 연동 포인트'),
      h('div', {}, selected.payrollLink)
    )
  );
}

/* ==========================================================================
   탭 2: 규모·업종별 자동생성 과제 · 기한 카운트다운 · 분기별 감독 · 감사로그
   ========================================================================== */

function urgencyBadge(filing) {
  if (filing.isCompleted) return h('span', { className: 'tag tag-green' }, '이행 완료 체크됨');
  if (filing.daysLeft === null) return h('span', { className: 'tag tag-blue' }, '상시 준수');
  if (filing.daysLeft < 0) {
    return h('span', { className: 'tag tag-red' }, `기한 경과 (D+${Math.abs(filing.daysLeft)}) · 즉시조치`);
  }
  if (filing.daysLeft <= 7) {
    return h('span', { className: 'tag tag-amber' }, `법정기한 임박 (D-${filing.daysLeft} · ${filing.dueDate})`);
  }
  return h('span', { className: 'tag tag-blue' }, `기한 D-${filing.daysLeft} (${filing.dueDate})`);
}

function renderComplianceTab(snapshot) {
  const { compliance } = snapshot;
  const dis = compliance.disabilityCompliance;

  const disBox = document.getElementById('disability-summary-box');
  if (disBox) {
    if (!dis.applicable) {
      disBox.replaceChildren(
        h('strong', {}, '장애인 의무고용 판정: '),
        h('span', {}, `현재 상시 ${dis.eligibleHeadcount}인 (50인 미만 의무 면제 — 50인 진입 시 3.1% 의무고용 현황판 자동 활성화)`)
      );
    } else {
      disBox.replaceChildren(
        h(
          'div',
          { className: 'flex-between-wrap' },
          h(
            'div',
            {},
            h('strong', {}, '[50인+ 장애인 의무고용 3.1% 가동 중] '),
            h(
              'span',
              {},
              `기준 인원 ${dis.eligibleHeadcount}명 → 의무고용 ${dis.mandatoryQuota}명 / 현재 인정 ${dis.recognizedCount}명(중증 2배수 반영) / 미달 ${dis.shortfall}명`
            )
          ),
          h(
            'span',
            { className: dis.shortfall > 0 ? 'tag tag-amber' : 'tag tag-green' },
            dis.levyApplicable
              ? `100인+ 연간 예상 부담금: ${fmtWon(dis.estimatedAnnualLevy)} (기한 1.31)`
              : '50~99인 구간: 고용의무 적용 · 부담금 면제'
          )
        )
      );
    }
  }

  const filingsList = document.getElementById('filings-list');
  if (filingsList) {
    const cards = compliance.statutoryFilings.map((f) =>
      h(
        'article',
        { className: 'filing-card' },
        h(
          'div',
          { className: 'filing-header' },
          h('span', { className: 'tag tag-gray' }, f.scaleBadge),
          urgencyBadge(f)
        ),
        h('h4', { className: 'filing-title' }, f.title),
        h('div', { className: 'filing-meta' }, `관할/방식: ${f.authority} | 근거: ${f.legalBasis}`),
        h(
          'ul',
          { className: 'step-list' },
          f.actionSteps.map((step) => h('li', {}, step))
        ),
        h(
          'div',
          { className: 'filing-actions' },
          f.docTemplateId
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-primary btn-sm',
                  onClick: (e) => openDocumentPreview(f.docTemplateId, e.currentTarget),
                },
                '작성 보조 초안·신고서 열람'
              )
            : null,
          h(
            'button',
                {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  onClick: async (e) => {
                    try {
                      const res = await apiPost('/api/toggle-task', { taskId: f.id }, e.currentTarget);
                      updateSnapshot(res.snapshot);
                    } catch (err) {
                      showBanner(err.message, true);
                    }
                  },
                },
                f.isCompleted ? '이행 완료 취소' : '신고·제정 완료 체크'
              )
        )
      )
    );
    filingsList.replaceChildren(...cards);
  }

  const qGrid = document.getElementById('quarterly-grid');
  if (qGrid) {
    const qCards = compliance.quarterlySchedule.map((q) =>
      h(
        'div',
        { className: 'quarter-card' },
        h('h4', { className: 'quarter-title' }, q.quarter),
        ...q.items.map((item) =>
          h(
            'div',
            { className: 'quarter-item' },
            h(
              'div',
              { className: 'flex-between-tight' },
              h('span', { className: 'tag tag-blue' }, item.category),
              item.docTemplateId
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview(item.docTemplateId, e.currentTarget, item.quarterNumber),
                    },
                    `${item.quarterNumber}분기 회의록 초안 열람`
                  )
                : null
            ),
            h('div', { className: 'quarter-item-title' }, item.title),
            h('div', { className: 'quarter-item-detail' }, item.detail)
          )
        )
      )
    );
    qGrid.replaceChildren(...qCards);
  }

  renderAuditLogs(snapshot.auditLogs);
}

function renderAuditLogs(logs) {
  const box = document.getElementById('audit-log-box');
  if (!box) return;
  if (!logs || logs.length === 0) {
    box.replaceChildren(h('div', {}, '기록된 감사 로그가 없습니다.'));
    return;
  }
  box.replaceChildren(
    ...logs.map((entry) =>
      h(
        'div',
        { className: 'audit-item' },
        h('strong', {}, `[${entry.time}] ${entry.actor}: `),
        h('span', {}, entry.event)
      )
    )
  );
}

/* ==========================================================================
   탭 3: 채용~퇴사 전 주기 실습 워크벤치
   ========================================================================== */

function renderLifecycleTab(snapshot) {
  const stepper = document.getElementById('lifecycle-stepper');
  if (stepper && stepper.children.length === 0) {
    stepper.replaceChildren(
      ...LIFECYCLE_STEPS.map((s) =>
        h(
          'li',
          { className: 'step-node' },
          h('div', { className: 'step-num' }, `STEP ${s.step}`),
          h('div', { className: 'step-title' }, s.title),
          h('div', { className: 'step-desc' }, s.desc)
        )
      )
    );
  }

  const workerSelect = document.getElementById('evt-worker');
  const evtSubmitBtn = document.querySelector('#worker-event-form button[type="submit"]');
  if (workerSelect) {
    const regularWorkers = snapshot.workers.filter(
      (w) =>
        w.workerCategory === 'REGULAR' ||
        w.workerCategory === 'FIXED_TERM' ||
        w.workerCategory === 'PART_TIME'
    );
    const prevVal = workerSelect.value;
    if (regularWorkers.length === 0) {
      workerSelect.replaceChildren(h('option', { value: '' }, '대상 근로자 없음 (0명 빈 명부)'));
      workerSelect.disabled = true;
      if (evtSubmitBtn) evtSubmitBtn.disabled = true;
    } else {
      workerSelect.disabled = false;
      if (evtSubmitBtn) evtSubmitBtn.disabled = false;
      workerSelect.replaceChildren(
        ...regularWorkers.map((w) =>
          h('option', { value: w.empCode }, `[${w.empCode}] ${w.displayName} (${w.deptName})`)
        )
      );
      if (regularWorkers.some((w) => w.empCode === prevVal)) {
        workerSelect.value = prevVal;
      } else if (regularWorkers[1]) {
        workerSelect.value = regularWorkers[1].empCode;
      }
      syncSelectedWorkerInputs();
    }
  }
}

function syncSelectedWorkerInputs() {
  if (!appState.snapshot) return;
  const workerSelect = document.getElementById('evt-worker');
  if (!workerSelect) return;
  const target = appState.snapshot.workers.find((w) => w.empCode === workerSelect.value);
  if (!target) return;

  const setNum = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v ?? 0);
  };
  setNum('evt-ot', target.overtimeHours ?? 0);
  setNum('evt-peak-weekly', target.maxWeeklyWorkedHours ?? 40);
  setNum('evt-unused-leave', target.unusedLeavePayoutDays ?? 0);
  setNum('evt-raise', target.evalRaiseRatePct ?? 0);
  setNum('evt-cut', target.requestedDisciplinaryCut ?? 0);

  const setChk = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.checked = v === true;
  };
  setChk('evt-notice', target.attendanceNoticeSent);
  setChk('evt-defense', target.defenseOpportunityGiven);
  setChk('evt-committee', target.committeeResolved);
  setChk('evt-written', target.writtenNoticeDelivered);
}

/* ==========================================================================
   탭 4: 자동 급여대장 & 산출식 명시 임금명세서
   ========================================================================== */

function renderPayrollTab(snapshot) {
  const { payrollLines, payrollSummary, compliance } = snapshot;
  const policy = snapshot.operationsSuite?.policySettings || snapshot.company.policySettings || {};

  const policyBar = document.getElementById('payroll-policy-bar');
  if (policyBar) {
    policyBar.replaceChildren(
      h(
        'div',
        { className: 'policy-sync-items' },
        h('span', { className: 'tag tag-blue' }, '환경 설정 연동 중'),
        h('span', {}, `정기 급여일: ${policy.payDayLabel || '매월 25일'}`),
        h('span', {}, `· 원천징수: 간이세액 ${policy.withholdingTaxRatePct ?? 100}%`),
        h('span', {}, `· 식대 비과세 한도: ${fmtWon(policy.nonTaxableMealLimit ?? 200000)}`),
        h(
          'span',
          {},
          `· 연장가산: ${compliance.headcounts.is5OrMore ? '5인 이상 (50%/100%)' : '5인 미만 (1.0배)'}`
        )
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: () => switchTab('settings-master', false),
        },
        '급여·세율 기준 변경'
      )
    );
  }

  const sumStrip = document.getElementById('payroll-summary-cards');
  if (sumStrip) {
    sumStrip.replaceChildren(
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '정산 대상 인원'),
        h('div', { className: 'kpi-value' }, `${payrollSummary.workerCount}명`),
        h(
          'div',
          { className: 'kpi-sub' },
          compliance.headcounts.is5OrMore ? '5인 이상 가산율(50%/100%) 적용' : '5인 미만 가산 면제(1.0배) 적용'
        )
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '당월 지급총액 합계'),
        h('div', { className: 'kpi-value' }, fmtWon(payrollSummary.totalGross)),
        h('div', { className: 'kpi-sub' }, `연장·야간·휴일수당 ${fmtWon(payrollSummary.totalOvertime)} 포함`)
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '제95조 감봉 법정한도 방어액'),
        h('div', { className: 'kpi-value' }, fmtWon(payrollSummary.totalCutBlocked)),
        h('div', { className: 'kpi-sub' }, `실제 적법 공제액: ${fmtWon(payrollSummary.totalCutApplied)}`)
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, `실지급액 합계 (${policy.payDayLabel || '매월 25일'})`),
        h('div', { className: 'kpi-value' }, fmtWon(payrollSummary.totalNet)),
        h('div', { className: 'kpi-sub' }, `원천세 ${policy.withholdingTaxRatePct ?? 100}% · 경보 ${payrollSummary.warningCount}건`)
      )
    );
  }

  const container = document.getElementById('payroll-table-container');
  if (!container) return;

  if (payrollLines.length === 0) {
    container.replaceChildren(
      h(
        'div',
        { className: 'empty-state' },
        h('h3', {}, '현재 등록된 급여 지급 대상자가 없습니다 (0명 빈 상태)'),
        h(
          'p',
          {},
          'M1 채용 합격자 이관 또는 M2 입사·근로계약 등록 시 급여 파이프라인에 편입됩니다.'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-primary',
            onClick: async (e) => {
              try {
                const res = await apiPost(
                  '/api/simulate-company',
                  { emptyRosterMode: false, resetWorkers: true },
                  e.currentTarget
                );
                updateSnapshot(res.snapshot);
              } catch (err) {
                showBanner(err.message, true);
              }
            },
          },
          '기본 지급대상자 명부 불러오기'
        )
      )
    );
    return;
  }

  const categoryLabels = {
    REGULAR: '정규직',
    FIXED_TERM: '기간제',
    PART_TIME: '단시간',
    DAILY: '일용직',
    BIZ_33: '3.3% 사업소득',
    OTHER_88: '8.8% 기타소득',
  };

  const table = h(
    'div',
    { className: 'table-scroll-wrap' },
    h(
      'table',
      { className: 'payroll-table', 'aria-label': '당월 자동 정산 급여대장' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, '사번 · 성명 · 소속'),
          h('th', { scope: 'col' }, '고용/소득구분'),
          h('th', { scope: 'col', className: 'num' }, '기본·고정·식대'),
          h('th', { scope: 'col', className: 'num' }, '연장·연차·성과'),
          h('th', { scope: 'col', className: 'num' }, '징계감봉(제95조)'),
          h('th', { scope: 'col', className: 'num' }, '4대보험·세액'),
          h('th', { scope: 'col', className: 'num' }, '실지급액'),
          h('th', { scope: 'col' }, '법령검증 · 명세서')
        )
      ),
      h(
        'tbody',
        {},
        payrollLines.map((line) =>
          h(
            'tr',
            {},
            h(
              'td',
              { 'data-label': '사번 · 성명 · 소속' },
              h(
                'div',
                {},
                h('div', { className: 'cell-emp-code' }, line.empCode),
                h('div', { className: 'breakable-name' }, line.displayName),
                h('div', { className: 'cell-dept-name' }, line.deptName)
              )
            ),
            h(
              'td',
              { 'data-label': '고용/소득구분' },
              h('span', { className: 'tag tag-gray' }, categoryLabels[line.workerCategory] || line.workerCategory)
            ),
            h(
              'td',
              { className: 'num', 'data-label': '기본·고정·식대' },
              fmtWon(line.basePayApplied + line.fixedAllowanceApplied + line.mealAllowanceApplied)
            ),
            h(
              'td',
              { className: 'num', 'data-label': '연장·연차·성과' },
              fmtWon(line.overtimeNightHolidayPay + line.unusedLeavePay + line.evalBonusPay)
            ),
            h(
              'td',
              { className: 'num', 'data-label': '징계감봉(제95조)' },
              h(
                'div',
                {},
                h('div', {}, line.disciplinaryCutApplied > 0 ? `-${fmtWon(line.disciplinaryCutApplied)}` : '0원'),
                line.disciplinaryCutBlocked > 0
                  ? h(
                      'div',
                      { className: 'cut-blocked-note' },
                      `(초과 ${fmtWon(line.disciplinaryCutBlocked)} 차단)`
                    )
                  : null
              )
            ),
            h(
              'td',
              { className: 'num', 'data-label': '4대보험·세액' },
              fmtWon(line.socialInsuranceTotal + line.incomeTaxTotal)
            ),
            h(
              'td',
              { className: 'num font-extrabold', 'data-label': '실지급액' },
              fmtWon(line.netPay)
            ),
            h(
              'td',
              { 'data-label': '법령검증 · 명세서' },
              h(
                'div',
                { className: 'cell-actions-col' },
                line.warnings.length === 0
                  ? h('span', { className: 'tag tag-green' }, '법령 적합')
                  : line.warnings.map((w) =>
                      h(
                        'span',
                        { className: w.level === 'CRITICAL' ? 'tag tag-red' : 'tag tag-amber' },
                        w.code === 'DISGUISED_WORKER_RISK'
                          ? '근로자성(3.3%) 점검'
                          : w.code === 'DISCIPLINARY_CUT_CAPPED'
                            ? '제95조 한도캡핑'
                            : w.code === 'DISCIPLINARY_PROCEDURE_DEFECT'
                              ? '징계절차 미비'
                              : w.code
                      )
                    ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'btn btn-secondary btn-sm',
                    onClick: (e) => openPayslipModal(line, e.currentTarget),
                  },
                  '산출식 명세서 보기'
                )
              )
            )
          )
        )
      )
    )
  );

  container.replaceChildren(table);
}

/* ==========================================================================
   모달 제어 (배경 inert + aria-hidden 적용 및 해제)
   ========================================================================== */

function openModalWithText(title, subtitle, bodyText, triggerEl) {
  appState.lastFocusedBeforeModal = triggerEl || document.activeElement;
  const modal = document.getElementById('doc-modal');
  const modPopup = document.getElementById('module-popup-modal');
  const titleEl = document.getElementById('modal-title');
  const subEl = document.getElementById('modal-subtitle');
  const preEl = document.getElementById('modal-body');
  const feedbackEl = document.getElementById('copy-feedback');
  const closeBtn = document.getElementById('modal-close-btn');

  if (!modal || !titleEl || !subEl || !preEl) return;
  titleEl.textContent = title;
  subEl.textContent = subtitle;
  preEl.textContent = bodyText;
  if (feedbackEl) feedbackEl.textContent = '';

  setBackgroundInert(true);
  if (modPopup && !modPopup.hidden) {
    modPopup.inert = true;
    modPopup.setAttribute('aria-hidden', 'true');
  }
  modal.hidden = false;
  closeBtn?.focus();
}

function closeModal() {
  const modal = document.getElementById('doc-modal');
  const modPopup = document.getElementById('module-popup-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (modPopup && !modPopup.hidden) {
    modPopup.inert = false;
    modPopup.removeAttribute('aria-hidden');
  } else {
    setBackgroundInert(false);
  }
  const prev = appState.lastFocusedBeforeModal;
  if (
    prev &&
    prev !== document.body &&
    prev.isConnected &&
    !prev.closest('[hidden]') &&
    typeof prev.focus === 'function'
  ) {
    prev.focus();
  } else if (modPopup && !modPopup.hidden) {
    (document.getElementById('popup-module-select') || document.getElementById('module-popup-close-btn'))?.focus();
  } else {
    document.getElementById('btn-open-current-module-modal')?.focus();
  }
}

function buildCustomDomainUrl(pathnameAndSearch = '/') {
  const portPart = window.location.port ? `:${window.location.port}` : '';
  const host = window.location.hostname || 'modular-hr.localhost';
  const targetHost =
    host === '127.0.0.1' || host === 'localhost' ? 'modular-hr.localhost' : host;
  const basePath = window.location.pathname
    .replace(/\/(?:index\.html|mobile\.html)?$/, '')
    .replace(/\/$/, '');
  return `${window.location.protocol}//${targetHost}${portPart}${basePath}${pathnameAndSearch}`;
}

function openStandalonePopupWindow(tabKey = null) {
  const targetTab = tabKey || appState.activeTab || 'ops-home';
  const query = new URLSearchParams({ popup: '1', autounlock: '1' });
  if (tabKey) query.set('tab', tabKey);
  const url = buildCustomDomainUrl(`/?${query.toString()}`);
  const winName = tabKey ? `mhr_popup_${tabKey}` : 'mhr_dashboard_main_popup';
  const opened = window.open(
    url,
    winName,
    'popup=yes,width=1360,height=880,left=60,top=45,resizable=yes,scrollbars=yes'
  );
  if (!opened) {
    openModuleDetailPopup(targetTab);
    showBanner(
      '새 창 팝업이 제한된 환경이어서 화면 내 대형 실무 검토 모달로 표시했습니다. 상단 바에서 1~14번 전 화면을 바로 넘겨 확인하실 수 있습니다.'
    );
  } else {
    opened.focus();
    showBanner(`전용 도메인(${url}) 독립 팝업창이 실행되었습니다.`);
  }
}

function openMobilePopupWindow() {
  const url = buildCustomDomainUrl('/mobile.html');
  const opened = window.open(
    url,
    'mhr_mobile_phone_popup',
    'popup=yes,width=420,height=860,left=980,top=50,resizable=yes,scrollbars=yes'
  );
  if (!opened) {
    showBanner(
      '새 창 팝업이 제한된 환경입니다. 상단의 [모바일 앱 이동] 또는 팝업 툴바의 [모바일 폰 앱(420px) 검토] 링크를 눌러 이동하실 수 있습니다.'
    );
  } else {
    opened.focus();
    showBanner('모바일 폰 앱(420×860) 전용 팝업창이 나란히 실행되었습니다.');
  }
}

function syncPopupModuleSelectOptions() {
  const sel = document.getElementById('popup-module-select');
  if (!sel) return;
  if (sel.options.length === 0) {
    ALL_PANEL_SPECS.forEach((spec, idx) => {
      sel.appendChild(
        h('option', { value: spec.key }, `${idx + 1} / ${ALL_PANEL_SPECS.length} · ${spec.label}`)
      );
    });
  }
  const activeKey = appState.popupModalTabKey || appState.activeTab || 'ops-home';
  sel.value = activeKey;
}

function openModuleDetailPopup(tabKey, triggerEl = null) {
  const targetKey = tabKey || appState.activeTab || 'ops-home';
  const modal = document.getElementById('module-popup-modal');
  const body = document.getElementById('module-popup-body');
  const titleEl = document.getElementById('module-popup-title');
  const closeBtn = document.getElementById('module-popup-close-btn');
  const panelEl = document.getElementById(`panel-${targetKey}`);
  if (!modal || !body || !panelEl) return;

  const wasAlreadyOpen = Boolean(appState.popupModalTabKey);
  if (wasAlreadyOpen) {
    closeModuleDetailPopup(false);
  } else {
    appState.lastFocusedBeforeModulePopup = triggerEl || document.activeElement;
  }

  syncActiveNavigationState(targetKey, false);

  appState.popupModalTabKey = targetKey;
  const placeholder = document.createComment(`slot-panel-${targetKey}`);
  panelEl.parentNode?.insertBefore(placeholder, panelEl);
  appState.popupRestoreSlot = placeholder;

  panelEl.hidden = false;
  body.replaceChildren(panelEl);
  body.scrollTop = 0;

  const specIdx = ALL_PANEL_SPECS.findIndex((s) => s.key === targetKey);
  const spec = specIdx >= 0 ? ALL_PANEL_SPECS[specIdx] : null;
  if (titleEl) {
    const stepTag = specIdx >= 0 ? ` (${specIdx + 1}/${ALL_PANEL_SPECS.length})` : '';
    titleEl.textContent = `[실무 검토 팝업${stepTag}] ${spec ? spec.label : targetKey}`;
  }
  syncPopupModuleSelectOptions();

  setBackgroundInert(true);
  modal.hidden = false;
  if (!wasAlreadyOpen) {
    closeBtn?.focus();
  } else if (!modal.contains(document.activeElement) || document.activeElement === document.body) {
    (document.getElementById('popup-module-select') || closeBtn)?.focus();
  }
}

function closeModuleDetailPopup(restoreFocus = true) {
  const modal = document.getElementById('module-popup-modal');
  const key = appState.popupModalTabKey;
  if (!modal || !key) return;

  const panelEl = document.getElementById(`panel-${key}`);
  if (panelEl && appState.popupRestoreSlot?.parentNode) {
    appState.popupRestoreSlot.parentNode.replaceChild(panelEl, appState.popupRestoreSlot);
    panelEl.hidden = key !== appState.activeTab;
  }
  appState.popupModalTabKey = null;
  appState.popupRestoreSlot = null;
  modal.hidden = true;
  setBackgroundInert(false);

  if (restoreFocus) {
    const prev = appState.lastFocusedBeforeModulePopup;
    if (
      prev &&
      prev !== document.body &&
      prev.isConnected &&
      !prev.closest('[hidden]') &&
      typeof prev.focus === 'function'
    ) {
      prev.focus();
    } else {
      document.getElementById('btn-open-current-module-modal')?.focus();
    }
  }
}

async function openDocumentPreview(
  templateId,
  triggerBtn,
  quarterNumber = undefined,
  empCode = undefined
) {
  try {
    const payload = { templateId };
    if (quarterNumber !== undefined) payload.quarterNumber = quarterNumber;
    if (empCode !== undefined) payload.empCode = empCode;
    const data = await apiPost('/api/document', payload, triggerBtn);
    if (data.snapshot) {
      updateSnapshot(data.snapshot);
    } else if (data.auditLogs && appState.snapshot) {
      appState.snapshot.auditLogs = data.auditLogs;
      renderAuditLogs(data.auditLogs);
    }
    openModalWithText(
      data.document.title,
      data.document.subtitle,
      data.document.body,
      triggerBtn
    );
  } catch (err) {
    showBanner(err.message, true);
  }
}

function openPayslipModal(line, triggerBtn) {
  const companyName = appState.snapshot?.company?.companyName || '사업장';
  const warnText =
    line.warnings.length > 0
      ? `\n[노동법 자동 검증 알림]\n${line.warnings.map((w) => ` - (${w.level}) ${w.message}`).join('\n')}\n`
      : '\n[노동법 자동 검증 알림]\n - 위반·경고 사항 없음 (최저임금·근로시간·제95조 적합)\n';

  const body = `======================================================================
${companyName} 임금명세서 (근로기준법 제48조 제2항 산출방법 명시본)
======================================================================
성명(사번) : ${line.displayName} (${line.empCode}) | 소속 : ${line.deptName}

1. 지급 내역 합계 : ${fmtWon(line.grossPay)}
   - 기본급 반영액           : ${fmtWon(line.basePayApplied)}
   - 통상 고정수당           : ${fmtWon(line.fixedAllowanceApplied)}
   - 식대 지급액             : ${fmtWon(line.mealAllowanceApplied)} (비과세 ${fmtWon(line.nonTaxableMealApplied)} / 과세 ${fmtWon(line.taxableMealExcess)})
   - 연장·야간·휴일근로수당  : ${fmtWon(line.overtimeNightHolidayPay)}
   - 미사용 연차유급휴가수당 : ${fmtWon(line.unusedLeavePay)}
   - 평가 성과급·보상금      : ${fmtWon(line.evalBonusPay)}

2. 공제 내역 합계 : ${fmtWon(line.disciplinaryCutApplied + line.socialInsuranceTotal + line.incomeTaxTotal)}
   - 4대사회보험 근로자부담분 : ${fmtWon(line.socialInsuranceTotal)}
   - 소득세 및 지방소득세     : ${fmtWon(line.incomeTaxTotal)}
   - 징계 감봉 공제(제95조)   : ${fmtWon(line.disciplinaryCutApplied)}

3. 차인지급액 (실수령액) : ${fmtWon(line.netPay)}

----------------------------------------------------------------------
[임금 구성항목별 계산방법 (근로기준법 시행령 제27조의2 필수 기재)]
${line.formulaLines.map((f) => ` * ${f}`).join('\n')}
${warnText}`;

  openModalWithText(
    `[산출식 명시 임금명세서] ${line.displayName} (${line.empCode})`,
    '근로기준법 제48조 제2항 필수 기재사항 자동 생성본',
    body,
    triggerBtn
  );
}

/* ==========================================================================
   탭 0: 멀티문서 자동 온보딩 & 탭 5: 전 주기 퇴사자 통합 원장 (M0 · M9)
   ========================================================================== */

function populateDocEditors(bundle) {
  if (!bundle) return;
  const setVal = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.value = String(text ?? '');
  };
  setVal('doc-biz-reg', bundle.businessRegistrationText);
  setVal('doc-brochure', bundle.companyBrochureText);
  setVal('doc-nhis-csv', bundle.healthInsuranceText);
  setVal('doc-ei-csv', bundle.employmentInsuranceText);
}

function collectDocEditorPayload() {
  return {
    businessRegistrationText: document.getElementById('doc-biz-reg')?.value || '',
    companyBrochureText: document.getElementById('doc-brochure')?.value || '',
    healthInsuranceText: document.getElementById('doc-nhis-csv')?.value || '',
    employmentInsuranceText: document.getElementById('doc-ei-csv')?.value || '',
  };
}

function renderOnboardingStagePreview(staging) {
  appState.latestStaging = staging;
  const wrap = document.getElementById('onboarding-stage-preview');
  if (!wrap) return;
  if (!staging) {
    wrap.replaceChildren();
    return;
  }

  const prof = staging.extractedProfile;
  const hc = staging.compliancePreview.headcounts;
  const autoMods = staging.compliancePreview.autoActivatedModules || [];
  const alerts = staging.reconciliationAlerts || [];

  const kpiStrip = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '추출 사업장 · 자동 업종(KSIC)'),
      h('div', { className: 'kpi-value' }, `${prof.companyName}`),
      h('div', { className: 'kpi-sub' }, `${prof.bizRegNo} · [${prof.ksicMajor}] ${prof.ksicName}`)
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '건보·고보 역산 상시근로자'),
      h('div', { className: 'kpi-value' }, `근기법 ${hc.lsaRegularCount}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        `산안법(파견포함) ${hc.oshRegularCount}명 · 대표자 제외 ${staging.excludedEmployers.length}명`
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '재직자 급여원장 자동연결'),
      h('div', { className: 'kpi-value' }, `${staging.activeWorkers.length}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        `비과세 식대 ${fmtWon(prof.defaultMealAllowance)} · 부서 ${prof.departments.length}개 매핑`
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '퇴사자 원장 자동편입 (상실내역)'),
      h('div', { className: 'kpi-value' }, `${staging.offboardedWorkers.length}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        `건보↔고보 교차대사 알림 ${alerts.length}건 점검됨`
      )
    )
  );

  const moduleBox = h(
    'div',
    { className: 'stage-box' },
    h('h3', {}, `개통 즉시 자동 활성화되는 노동법 의무 모듈 (${autoMods.length}개)`),
    h('p', { className: 'doc-editor-hint' }, prof.ksicReason),
    h(
      'div',
      { className: 'chip-wrap' },
      ...autoMods.map((m) => h('span', { className: 'tag tag-green' }, `${m.code} ${m.title} (${m.statusLabel})`))
    ),
    h(
      'div',
      { className: 'chip-wrap' },
      ...prof.departments.map((d) => h('span', { className: 'tag tag-blue' }, `조직: ${d}`)),
      ...prof.activeSubsidies.map((s) => h('span', { className: 'tag tag-amber' }, `지원금 감시: ${s}`))
    )
  );

  const alertBox = h(
    'div',
    { className: 'stage-box' },
    h('h3', {}, `건강보험 ↔ 고용보험 교차 대사 및 노무 감사 리포트 (${alerts.length}건)`),
    alerts.length === 0
      ? h('p', { className: 'doc-editor-hint' }, '불일치 항목이 없습니다.')
      : h(
          'div',
          { className: 'alert-list-stack' },
          ...alerts.map((a) => {
            const cls =
              a.level === 'CRITICAL'
                ? 'tag tag-red'
                : a.level === 'WARN'
                  ? 'tag tag-amber'
                  : 'tag tag-blue';
            return h(
              'div',
              { className: 'reconcile-item' },
              h('span', { className: cls }, a.code),
              ' ',
              a.message
            );
          })
        )
  );

  const rosterPreviewBox = h(
    'div',
    { className: 'stage-box' },
    h('h3', {}, `재직자 원장 연결 미리보기 (상위 ${Math.min(6, staging.activeWorkers.length)}명 / 총 ${staging.activeWorkers.length}명)`),
    h(
      'div',
      { className: 'alert-list-stack' },
      ...staging.activeWorkers.slice(0, 6).map((w) =>
        h(
          'div',
          { className: 'reconcile-item flex-between-tight' },
          h('span', { className: 'font-extrabold' }, `${w.displayName} (${w.empCode} · ${w.deptName})`),
          h('span', {}, `주 ${w.weeklyHours}h · 기본급 ${fmtWon(w.baseMonthlyPay)} · 식대 ${fmtWon(w.mealAllowance)}`)
        )
      )
    )
  );

  const alumniPreviewBox = h(
    'div',
    { className: 'stage-box' },
    h('h3', {}, `공단 상실내역 기반 퇴사자 원장 자동편입 미리보기 (${staging.offboardedWorkers.length}명)`),
    staging.offboardedWorkers.length === 0
      ? h('p', { className: 'doc-editor-hint' }, '상실 내역에 해당하는 퇴사자가 없습니다.')
      : h(
          'div',
          { className: 'alert-list-stack' },
          ...staging.offboardedWorkers.map((al) =>
            h(
              'div',
              { className: 'reconcile-item' },
              h(
                'div',
                { className: 'flex-between-tight' },
                h('span', { className: 'font-extrabold' }, `${al.displayName} (${al.empCode} · ${al.deptName})`),
                h(
                  'span',
                  { className: al.subsidyClawbackRisk ? 'tag tag-red' : 'tag tag-amber' },
                  al.resignReasonLabel
                )
              ),
              h(
                'div',
                { className: 'quarter-item-detail' },
                `퇴사일 ${al.lastWorkDate} (공단상실 ${al.lossDateReported}) · 청산예정 ${fmtWon(al.totalSettlementGross)} · 3년 보존만료 ${al.retentionExpiresOn}`
              )
            )
          )
        )
  );

  wrap.replaceChildren(
    kpiStrip,
    h('div', { className: 'stage-preview-grid' }, moduleBox, alertBox),
    h('div', { className: 'stage-preview-grid' }, rosterPreviewBox, alumniPreviewBox)
  );
}

function renderOnboardingTab(snapshot) {
  const bundles = snapshot.sampleIngestionBundles || [];
  const btnWrap = document.getElementById('sample-bundle-buttons');
  if (btnWrap) {
    btnWrap.replaceChildren(
      ...bundles.map((b) =>
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: async (e) => {
              populateDocEditors(b);
              try {
                const res = await apiPost(
                  '/api/onboarding/stage',
                  { bundleId: b.bundleId },
                  e.currentTarget
                );
                renderOnboardingStagePreview(res.staging);
                showBanner(`샘플 문서 4종 로드 및 교차검증 완료: ${b.title}`);
              } catch (err) {
                showBanner(err.message, true);
              }
            },
          },
          b.bundleId === 'BUNDLE_MFG_58'
            ? '샘플 1: 제조업 57인 4종 문서 세트 불러오기'
            : '샘플 2: IT·SW 34인 4종 문서 세트 불러오기'
        )
      )
    );
  }

  if (!appState.onboardingLoadedOnce && bundles.length > 0) {
    appState.onboardingLoadedOnce = true;
    populateDocEditors(bundles[0]);
  }
}

function renderAlumniTab(snapshot) {
  const sum = snapshot.offboardedSummary || {
    totalAlumniCount: 0,
    pendingSettlementCount: 0,
    pendingSettlementAmount: 0,
    pendingInsuranceLossCount: 0,
    subsidyRiskCount: 0,
    activeRetentionCount: 0,
    purgeDueCount: 0,
    purgedCount: 0,
  };
  const alumni = snapshot.offboardedWorkers || [];

  const kpiWrap = document.getElementById('alumni-kpi-strip');
  if (kpiWrap) {
    kpiWrap.replaceChildren(
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '통합 관리 퇴사자 수'),
        h('div', { className: 'kpi-value' }, `${sum.totalAlumniCount}명`),
        h('div', { className: 'kpi-sub' }, '공단 상실 자동편입 + 재직 퇴사전환')
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '14일 금품청산 대기 (제36조)'),
        h('div', { className: 'kpi-value' }, `${sum.pendingSettlementCount}명`),
        h('div', { className: 'kpi-sub' }, `미지급 정산예정 합계 ${fmtWon(sum.pendingSettlementAmount)}`)
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '상실·이직 미신고 / 지원금주의'),
        h('div', { className: 'kpi-value' }, `${sum.pendingInsuranceLossCount}건 / 주의 ${sum.subsidyRiskCount}건`),
        h('div', { className: 'kpi-sub' }, '건보 14일 · 고보 익월 15일 기한 감독')
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '제42조 3년 보존 / 만료 파기대상'),
        h('div', { className: 'kpi-value' }, `보존 ${sum.activeRetentionCount} · 파기대상 ${sum.purgeDueCount}`),
        h('div', { className: 'kpi-sub' }, `비식별 파기 완료 ${sum.purgedCount}건`)
      )
    );
  }

  const empSelect = document.getElementById('live-off-emp');
  if (empSelect) {
    // 3.3% 사업소득 계약자(BIZ_33)는 근로기준법상 퇴직·고용보험 상실 원장 대상이 아니므로 선택 목록에서 자동 제외
    const offboardableWorkers = (snapshot.workers || []).filter((w) => w.workerCategory !== 'BIZ_33');
    if (offboardableWorkers.length === 0) {
      empSelect.replaceChildren(h('option', { value: '' }, '퇴사 전환 대상 재직자 없음'));
    } else {
      empSelect.replaceChildren(
        ...offboardableWorkers.map((w) => {
          const catSuffix = w.workerCategory === 'DAILY' ? ' · 일용' : w.workerCategory === 'PART_TIME' ? ' · 단시간' : '';
          return h(
            'option',
            { value: w.empCode },
            `${w.empCode} ${w.displayName} (${w.deptName}${catSuffix})`
          );
        })
      );
    }
  }

  const tableWrap = document.getElementById('alumni-table-container');
  if (!tableWrap) return;

  if (alumni.length === 0) {
    tableWrap.replaceChildren(
      h(
        'div',
        { className: 'empty-state' },
        h('h3', {}, '등록된 퇴사자 이력이 없습니다.'),
        h('p', {}, '건보·고보 상실 내역을 온보딩하거나 재직자를 퇴사 처리하면 자동으로 등록됩니다.')
      )
    );
    return;
  }

  const tbody = h(
    'tbody',
    {},
    ...alumni.map((al) => {
      const isPurged = al.dataLifecycleStatus === 'ANONYMIZED_PURGED';
      const isPurgeDue = al.dataLifecycleStatus === 'RETENTION_EXPIRED_PURGE_DUE';

      const retentionBadge = isPurged
        ? h('span', { className: 'tag tag-gray' }, `비식별 파기됨 (${al.anonymizedAt})`)
        : isPurgeDue
          ? h('span', { className: 'tag tag-red' }, `3년 만료 · 즉시 파기대상 (${al.retentionExpiresOn})`)
          : h('span', { className: 'tag tag-blue' }, `3년 의무보존 중 (~${al.retentionExpiresOn})`);

      const settleBadge = isPurged
        ? h('span', { className: 'tag tag-gray' }, '개인정보 파기 완료')
        : al.settlementStatus === 'PAID'
          ? h('span', { className: 'tag tag-green' }, '14일 청산 완료')
          : h(
              'span',
              { className: al.settlementDday < 0 ? 'tag tag-red' : 'tag tag-amber' },
              al.settlementDday >= 0
                ? `청산 D-${al.settlementDday} (${al.settlementDueDate})`
                : `기한경과 (${al.settlementDueDate})`
            );

      const actionButtons = h('div', { className: 'alumni-btn-cluster' });

      if (!isPurged) {
        actionButtons.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: async (e) => {
                try {
                  const nextStatus = al.settlementStatus === 'PAID' ? 'PENDING' : 'PAID';
                  const res = await apiPost(
                    '/api/offboarded/update-status',
                    { empCode: al.empCode, settlementStatus: nextStatus },
                    e.currentTarget
                  );
                  updateSnapshot(res.snapshot);
                  showBanner(`${al.displayName} 금품청산 상태가 ${nextStatus === 'PAID' ? '지급완료' : '대기'}로 변경되었습니다.`);
                } catch (err) {
                  showBanner(err.message, true);
                }
              },
            },
            al.settlementStatus === 'PAID' ? '청산완료 취소' : '14일 금품청산 완료'
          )
        );

        actionButtons.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: async (e) => {
                try {
                  const allFiled =
                    al.nhisLossFilingStatus === 'FILED' && al.eiLossAndCertStatus === 'FILED';
                  const targetVal = allFiled ? 'PENDING' : 'FILED';
                  const res = await apiPost(
                    '/api/offboarded/update-status',
                    {
                      empCode: al.empCode,
                      nhisLossFilingStatus: targetVal,
                      eiLossAndCertStatus: targetVal,
                    },
                    e.currentTarget
                  );
                  updateSnapshot(res.snapshot);
                  showBanner(`${al.displayName} 건보·고보 상실 및 이직확인서 상태가 갱신되었습니다.`);
                } catch (err) {
                  showBanner(err.message, true);
                }
              },
            },
            al.nhisLossFilingStatus === 'FILED' && al.eiLossAndCertStatus === 'FILED'
              ? '상실신고 완료됨'
              : '건보·고보 상실 완료체크'
          )
        );

        actionButtons.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: (e) =>
                openDocumentPreview('DOC_CAREER_CERTIFICATE', e.currentTarget, undefined, al.empCode),
            },
            '경력증명서(제39조)'
          )
        );

        actionButtons.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: (e) =>
                openDocumentPreview('DOC_EI_SEPARATION_CERT', e.currentTarget, undefined, al.empCode),
            },
            '상실·이직 대조표'
          )
        );

        actionButtons.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: (e) =>
                openDocumentPreview(
                  'DOC_EXIT_SECURITY_NONCOMPETE',
                  e.currentTarget,
                  undefined,
                  al.empCode
                ),
            },
            '퇴사 보안·경업금지서약서'
          )
        );

        actionButtons.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-danger-outline btn-sm',
              onClick: async (e) => {
                try {
                  const res = await apiPost(
                    '/api/offboarded/purge-pii',
                    { empCode: al.empCode },
                    e.currentTarget
                  );
                  updateSnapshot(res.snapshot);
                  showBanner(`${al.empCode} 퇴사 3년 만료 개인정보 비식별 파기가 완료되었습니다.`);
                } catch (err) {
                  showBanner(err.message, true);
                }
              },
            },
            isPurgeDue ? '3년만료 비식별 파기' : '파기 시도(3년보호 점검)'
          )
        );
      }

      return h(
        'tr',
        {},
        h(
          'td',
          { 'data-label': '퇴사자 · 소속' },
          h('div', { className: 'breakable-name' }, al.displayName),
          h('div', { className: 'cell-emp-code' }, `${al.empCode} · ${al.maskedBirthOrId}`),
          h(
            'div',
            { className: 'cell-dept-name' },
            isPurged ? '개인정보보호법 제21조 비식별화' : `${al.deptName} · 근속 ${al.serviceDays}일`
          )
        ),
        h(
          'td',
          { 'data-label': '입·퇴사일 및 상실사유' },
          h('div', {}, isPurged ? '입·퇴사일 비식별 삭제됨' : `${al.hireDate} ~ ${al.lastWorkDate}`),
          h(
            'div',
            { className: 'cell-emp-code' },
            isPurged ? `파기일자: ${al.anonymizedAt}` : `공단상실일: ${al.lossDateReported}`
          ),
          h(
            'span',
            { className: al.subsidyClawbackRisk ? 'tag tag-red' : 'tag tag-gray' },
            al.resignReasonLabel
          )
        ),
        h(
          'td',
          { className: 'num', 'data-label': '퇴직·연차 총 청산액' },
          h('div', { className: 'font-extrabold' }, isPurged ? '-' : fmtWon(al.totalSettlementGross)),
          h(
            'div',
            { className: 'cell-emp-code' },
            isPurged
              ? '개인 급여·정산액 비식별 삭제됨'
              : `퇴직금 ${fmtWon(al.severancePay)} + 연차 ${fmtWon(al.unusedLeavePayout)}`
          ),
          settleBadge
        ),
        h(
          'td',
          { 'data-label': '4대보험 상실 · 보존연한' },
          isPurged
            ? h('div', { className: 'mb-6' }, h('span', { className: 'tag tag-gray' }, '공단 신고기록 비식별 마감'))
            : h(
                'div',
                { className: 'mb-6' },
                h(
                  'span',
                  { className: al.nhisLossFilingStatus === 'FILED' ? 'tag tag-green' : 'tag tag-amber' },
                  `건보상실: ${al.nhisLossFilingStatus === 'FILED' ? '완료' : `미신고(~${al.nhisLossDueDate})`}`
                ),
                ' ',
                h(
                  'span',
                  { className: al.eiLossAndCertStatus === 'FILED' ? 'tag tag-green' : 'tag tag-amber' },
                  `고보이직: ${al.eiLossAndCertStatus === 'FILED' ? '완료' : `미신고(~${al.eiLossDueDate})`}`
                )
              ),
          retentionBadge
        ),
        h('td', { 'data-label': '사후관리 · 증명서 · 파기' }, actionButtons)
      );
    })
  );

  tableWrap.replaceChildren(
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        {
          className: 'payroll-table',
          'aria-label': '퇴사자 통합관리 원장 및 법정 사후관리 현황표',
        },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '퇴사자 · 소속'),
            h('th', { scope: 'col' }, '입·퇴사일 및 상실사유'),
            h('th', { scope: 'col', className: 'num' }, '퇴직·연차 총 청산액'),
            h('th', { scope: 'col' }, '4대보험 상실 · 3년 보존'),
            h('th', { scope: 'col' }, '사후관리 · 증명서 · 파기')
          )
        ),
        tbody
      )
    )
  );
}

/* ==========================================================================
   실무 인사노무 전 모듈 운영 시스템 (M1~M7 · M10 + 통합 관리 홈)
   ========================================================================== */

async function runOpsAction(payload, triggerBtn = null) {
  try {
    const data = await apiPost('/api/ops/action', payload, triggerBtn);
    updateSnapshot(data.snapshot);
    if (data.result?.message) {
      showBanner(data.result.message);
    }
  } catch (err) {
    showBanner(err.message, true);
  }
}

function renderOpsHomeTab(snapshot) {
  const wrap = document.getElementById('ops-home-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const ops = snapshot.operationsSuite;
  const k = ops.overviewKpis;
  const paySum = snapshot.payrollSummary;
  const hc = snapshot.compliance.headcounts;
  const policy = ops.policySettings || snapshot.company.policySettings || {};
  const leaveBasisLabel = formatLeaveBasisShort(policy);
  const warnHours = policy.weeklyWarnHours ?? 48;
  const pendingFilings = snapshot.compliance.statutoryFilings.filter((f) => !f.isCompleted).length;
  const totalRemainingLeave = ops.leaveAndMaternity.ledger.reduce(
    (s, r) => s + (r.remainingDays || 0),
    0
  );

  const policySyncBar = h(
    'div',
    { className: 'policy-sync-bar' },
    h(
      'div',
      { className: 'policy-sync-items' },
      h('span', { className: 'tag tag-blue' }, '적용 기준'),
      h('span', { className: 'font-extrabold' }, `${snapshot.company.companyName} (상시 ${hc.lsaRegularCount}명)`),
      h('span', {}, `· 연차: ${leaveBasisLabel}`),
      h('span', {}, `· 급여: ${policy.payDayLabel || '매월 25일'} (원천세 ${policy.withholdingTaxRatePct ?? 100}%)`),
      h('span', {}, `· 근태주의: 주 ${warnHours}h / 상한 52h`)
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        onClick: () => switchTab('settings-master', false),
      },
      '환경 설정 변경'
    )
  );

  const jumpTo = (tabKey, triggerEl) => {
    if (appState.popupModalTabKey) openModuleDetailPopup(tabKey, triggerEl);
    else switchTab(tabKey, false);
  };

  const topKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('ops-org', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, '인사 관리 (재직 · 계약)'),
      h('div', { className: 'kpi-value' }, `재직 ${k.activeRosterCount}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        k.unsignedContractCount > 0
          ? `채용 ${k.applicantOpenCount}명 · 미서명 계약 ${k.unsignedContractCount}건`
          : `채용 진행 ${k.applicantOpenCount}명 · 전자계약 완료`
      )
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('ops-attendance', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, '근태 관리 (주52시간 관제)'),
      h(
        'div',
        { className: 'kpi-value' },
        `초과 ${k.over52Count}명 · 주의 ${k.near52Count}명`
      ),
      h('div', { className: 'kpi-sub' }, `주 ${warnHours}h 사전주의 · 52h 법정상한 적용`)
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('ops-leave', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, `연차 관리 (${leaveBasisLabel})`),
      h('div', { className: 'kpi-value' }, `잔여 ${Number(totalRemainingLeave.toFixed(1))}일`),
      h('div', { className: 'kpi-sub' }, `제61조 사용촉진 대상 ${k.leavePromoPendingCount}명`)
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('payroll', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, `급여 관리 (${policy.payDayLabel || '매월 25일'})`),
      h('div', { className: 'kpi-value' }, fmtWon(paySum.totalNet)),
      h(
        'div',
        { className: 'kpi-sub' },
        `정산 ${paySum.workerCount}명 · 퇴사 정산대기 ${k.pendingOffboardSettlementCount}명`
      )
    )
  );

  const actionItems = [];
  if (k.unsignedContractCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-red',
      tagText: '근로계약',
      text: `전자근로계약 미체결 ${k.unsignedContractCount}명 — 서면·전자교부 필요`,
      tab: 'ops-recruit',
    });
  }
  if (k.over52Count > 0 || k.near52Count > 0) {
    actionItems.push({
      tagClass: k.over52Count > 0 ? 'tag tag-red' : 'tag tag-amber',
      tagText: '근태주의',
      text: `주 52시간 초과 ${k.over52Count}명 · 주 ${warnHours}h+ 주의 ${k.near52Count}명 점검`,
      tab: 'ops-attendance',
    });
  }
  if (k.leavePromoPendingCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-amber',
      tagText: '연차촉진',
      text: `미사용 연차 서면 사용촉진 대상 ${k.leavePromoPendingCount}명 (${leaveBasisLabel})`,
      tab: 'ops-leave-promo',
    });
  }
  if (k.pendingOffboardSettlementCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-amber',
      tagText: '퇴사청산',
      text: `퇴사자 14일 이내 금품청산·상실신고 대기 ${k.pendingOffboardSettlementCount}명`,
      tab: 'alumni',
    });
  }
  if (pendingFilings > 0) {
    const firstFiling = snapshot.compliance.statutoryFilings.find((x) => !x.isCompleted);
    actionItems.push({
      tagClass: 'tag tag-blue',
      tagText: `법정신고 ${pendingFilings}건`,
      text: firstFiling ? `${firstFiling.title} 외 ${Math.max(0, pendingFilings - 1)}건` : `미이행 신고 ${pendingFilings}건`,
      tab: 'compliance',
    });
  }
  if (actionItems.length === 0) {
    actionItems.push({
      tagClass: 'tag tag-green',
      tagText: '정상 운영',
      text: '현재 즉시 조치가 필요한 미결 법정 기한·계약 누락 항목이 없습니다.',
      tab: 'compliance',
    });
  }

  const actionCenterCard = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '처리 필요 업무 · 법정 기한'),
      h('span', { className: 'tag tag-amber' }, `${actionItems.length}건`)
    ),
    h(
      'div',
      { className: 'action-feed-list' },
      ...actionItems.map((item) =>
        h(
          'div',
          { className: 'action-feed-row' },
          h(
            'div',
            { className: 'action-feed-main' },
            h('span', { className: item.tagClass }, item.tagText),
            h('span', {}, item.text)
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: (e) => jumpTo(item.tab, e.currentTarget),
            },
            '바로가기'
          )
        )
      )
    )
  );

  const essentialFormsBar = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '필수 표준 서식 바로 열기'),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: (e) => jumpTo('forms-center', e.currentTarget),
        },
        '전체 14종 서식함 보기'
      )
    ),
    h(
      'p',
      { className: 'ops-module-desc mb-6' },
      '환경 설정의 기업 정보·연차 기준·급여일이 자동 반영된 표준 서식을 즉시 열람하고 복사합니다.'
    ),
    h(
      'div',
      { className: 'step-pill-group' },
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_PRIVACY_CONSENT', e.currentTarget),
        },
        '개인정보 수집·이용 동의서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_NDA_SECURITY_PLEDGE', e.currentTarget),
        },
        '비밀유지·정보보안 서약서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_EXIT_SECURITY_NONCOMPETE', e.currentTarget),
        },
        '퇴사 보안·경업금지 서약서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_EMPLOYMENT_CONTRACT', e.currentTarget),
        },
        '표준 근로계약서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_WORK_RULES_REPORT', e.currentTarget),
        },
        '10인+ 취업규칙 신고서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_LMC_REGULATION_AND_FILING', e.currentTarget),
        },
        '30인+ 노사협의회 규정'
      )
    )
  );

  const executiveSplit = h('div', { className: 'ops-two-col' }, actionCenterCard, essentialFormsBar);

  wrap.replaceChildren(policySyncBar, topKpis, executiveSplit);
}

function renderOpsRecruitTab(snapshot) {
  const wrap = document.getElementById('ops-recruit-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const rec = snapshot.operationsSuite.recruitAndOnboarding;

  const addForm = h(
    'form',
    {
      className: 'ops-inline-form',
      onSubmit: (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        runOpsAction(
          {
            actionType: 'ADD_APPLICANT',
            name: form.querySelector('[name="candName"]').value,
            targetDept: form.querySelector('[name="candDept"]').value,
            jobRole: form.querySelector('[name="candRole"]').value,
            weeklyHours: Number(form.querySelector('[name="candHours"]').value),
            offeredMonthlyPay: Number(form.querySelector('[name="candPay"]').value),
          },
          form.querySelector('button[type="submit"]')
        );
      },
    },
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'cand-name-input' }, '신규 합격 후보 성명'),
      h('input', { id: 'cand-name-input', name: 'candName', type: 'text', value: '강태오', required: true })
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'cand-dept-input' }, '배치 부서'),
      h('input', { id: 'cand-dept-input', name: 'candDept', type: 'text', value: '생산기술1팀' })
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'cand-role-input' }, '담당 직무'),
      h('input', { id: 'cand-role-input', name: 'candRole', type: 'text', value: '설비자동화 엔지니어' })
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'cand-hours-input' }, '주 소정근로시간(h)'),
      h('input', { id: 'cand-hours-input', name: 'candHours', type: 'number', min: '15', max: '40', value: '40' })
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'cand-pay-input' }, '제시 월급여(원, 최저임금 검증)'),
      h('input', { id: 'cand-pay-input', name: 'candPay', type: 'number', step: '50000', value: '3400000' })
    ),
    h(
      'div',
      { className: 'field' },
      h('button', { type: 'submit', className: 'btn btn-secondary full-width' }, '합격 후보 추가 (적법성 검증)')
    )
  );

  const applicantTable = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, 'M1 채용 전형 파이프라인 · 채용절차법 서류반환 관리'),
      h(
        'span',
        { className: rec.blindRuleEnforced ? 'tag tag-green' : 'tag tag-blue' },
        rec.blindRuleEnforced
          ? '30인+ 채용절차법 제4조의3(출신지·혼인·재산 수집금지) & 제11조(서류반환) 강제 가동중'
          : '표준 공정채용 · 최저임금 검증 가동중'
      )
    ),
    addForm,
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '채용 지원자 전형 및 입사발령 파이프라인' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '지원번호 · 성명'),
            h('th', { scope: 'col' }, '지원부서 · 직무'),
            h('th', { scope: 'col' }, '전형단계 · 블라인드'),
            h('th', { scope: 'col', className: 'num' }, '제시처우 (주시간)'),
            h('th', { scope: 'col' }, '채용서류 반환/파기기한'),
            h('th', { scope: 'col' }, '입사 · 계약 연계')
          )
        ),
        h(
          'tbody',
          {},
          rec.applicants.map((a) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '지원번호 · 성명' },
                h('div', { className: 'cell-emp-code' }, a.applicantId),
                h('div', { className: 'font-extrabold' }, a.name),
                h('div', { className: 'cell-dept-name' }, a.maskedBirth)
              ),
              h(
                'td',
                { 'data-label': '지원부서 · 직무' },
                h('div', {}, a.targetDept),
                h('div', { className: 'cell-dept-name' }, a.jobRole)
              ),
              h(
                'td',
                { 'data-label': '전형단계 · 블라인드' },
                h('span', { className: a.hiredEmpCode ? 'tag tag-green' : 'tag tag-blue' }, a.stageLabel),
                h('div', { className: 'cell-dept-name' }, '블라인드 필터 적합')
              ),
              h(
                'td',
                { className: 'num', 'data-label': '제시처우' },
                fmtWon(a.offeredMonthlyPay),
                h('div', { className: 'cell-dept-name' }, `주 ${a.weeklyHours}시간`)
              ),
              h('td', { 'data-label': '채용서류 반환/파기기한' }, `${a.docReturnDueOn} 까지 보관`),
              h(
                'td',
                { 'data-label': '입사 · 계약 연계' },
                a.hiredEmpCode
                  ? h('span', { className: 'tag tag-green' }, `명부 편입됨 (${a.hiredEmpCode})`)
                  : a.stage === 'DOC_RETENTION'
                    ? h('span', { className: 'tag tag-gray' }, '서류반환 대기종료 후 파기')
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-primary btn-sm',
                          onClick: (e) =>
                            runOpsAction(
                              { actionType: 'HIRE_APPLICANT', applicantId: a.applicantId },
                              e.currentTarget
                            ),
                        },
                        '입사 발령 · 급여원장 편입'
                      )
              )
            )
          )
        )
      )
    )
  );

  const contractSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, 'M2 전자근로계약(제17조) · 개인정보동의 · 비밀유지보안 · 4대보험 취득 대장'),
      h(
        'div',
        { className: 'step-pill-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_EMPLOYMENT_CONTRACT', e.currentTarget),
          },
          '표준 근로계약서 양식'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_PRIVACY_CONSENT', e.currentTarget),
          },
          '개인정보 수집·이용 동의서'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_NDA_SECURITY_PLEDGE', e.currentTarget),
          },
          '비밀유지·정보보안 서약서'
        )
      )
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '전자근로계약 체결 및 4대보험 취득신고 현황' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '사번 · 성명 · 부서'),
            h('th', { scope: 'col' }, '입사일 · 수습3개월 만료'),
            h('th', { scope: 'col', className: 'num' }, '계약 기본급 (주시간)'),
            h('th', { scope: 'col' }, '제17조 전자계약 · 사본교부'),
            h('th', { scope: 'col' }, '4대보험 취득신고'),
            h('th', { scope: 'col' }, '관리 액션')
          )
        ),
        h(
          'tbody',
          {},
          rec.contractLedger.length === 0
            ? [
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { colspan: '6' },
                    '현재 재직 근로자 명부가 비어 있습니다 (0명). 상단 합격 후보자를 입사 발령하거나 기본 명부를 복원하세요.'
                  )
                ),
              ]
            : rec.contractLedger.map((c) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '사번 · 성명 · 부서' },
                h('div', { className: 'cell-emp-code' }, c.empCode),
                h('div', { className: 'breakable-name' }, c.displayName),
                h('div', { className: 'cell-dept-name' }, c.deptName)
              ),
              h(
                'td',
                { 'data-label': '입사일 · 수습만료' },
                h('div', {}, `입사: ${c.hireDate}`),
                h('div', { className: 'cell-dept-name' }, `수습만료: ${c.probationEndsOn}`)
              ),
              h(
                'td',
                { className: 'num', 'data-label': '계약 기본급' },
                fmtWon(c.baseMonthlyPay),
                h('div', { className: 'cell-dept-name' }, `주 ${c.weeklyHours}h`)
              ),
              h(
                'td',
                { 'data-label': '제17조 전자계약' },
                c.contractSigned
                  ? h('span', { className: 'tag tag-green' }, `체결·교부 완료 (${c.contractSignedAt})`)
                  : h('span', { className: 'tag tag-red' }, '미체결 (즉시 서명·교부 필요)')
              ),
              h(
                'td',
                { 'data-label': '4대보험 취득신고' },
                h(
                  'div',
                  { className: 'step-pill-group' },
                  h('span', { className: 'tag tag-blue' }, c.nhisAcquired ? '국민·건보 취득완료' : '초단시간 건보제외'),
                  h('span', { className: 'tag tag-blue' }, '고용·산재 취득완료')
                )
              ),
              h(
                'td',
                { 'data-label': '관리 액션' },
                h(
                  'div',
                  { className: 'step-pill-group' },
                  c.contractSigned
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-secondary btn-sm',
                          onClick: (e) => openDocumentPreview('DOC_EMPLOYMENT_CONTRACT', e.currentTarget),
                        },
                        '계약서 사본'
                      )
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-primary btn-sm',
                          onClick: (e) =>
                            runOpsAction(
                              { actionType: 'SIGN_CONTRACT', empCode: c.empCode },
                              e.currentTarget
                            ),
                        },
                        '전자서명·교부'
                      ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview('DOC_PRIVACY_CONSENT', e.currentTarget, undefined, c.empCode),
                    },
                    '개인정보동의서'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview('DOC_NDA_SECURITY_PLEDGE', e.currentTarget, undefined, c.empCode),
                    },
                    '보안서약서'
                  )
                )
              )
            )
          )
        )
      )
    )
  );

  const signedCount = rec.contractLedger.filter((c) => c.contractSigned).length;
  const unsignedCount = rec.contractLedger.length - signedCount;
  const recruitKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '전형 진행 · 합격 후보'),
      h('div', { className: 'kpi-value' }, `${rec.applicants.length}명`),
      h('div', { className: 'kpi-sub' }, '최저임금 · 블라인드 검증 통과')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '채용절차법 적용 상태'),
      h('div', { className: 'kpi-value' }, rec.blindRuleEnforced ? '30인+ 강제적용' : '표준 공정채용'),
      h('div', { className: 'kpi-sub' }, '출신지·혼인 수집금지 · 서류반환 관리')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '제17조 전자근로계약 체결'),
      h('div', { className: 'kpi-value' }, `체결 ${signedCount}명 / 미서명 ${unsignedCount}명`),
      h('div', { className: 'kpi-sub' }, '개인정보동의 · 비밀유지서약 동시 발급')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '4대사회보험 자격취득'),
      h('div', { className: 'kpi-value' }, `${rec.contractLedger.length}명 연동`),
      h('div', { className: 'kpi-sub' }, '국민 · 건보 · 고용 · 산재 취득 대장')
    )
  );

  wrap.replaceChildren(recruitKpis, applicantTable, contractSection);
}

function renderOpsOrgTab(snapshot) {
  const wrap = document.getElementById('ops-org-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const org = snapshot.operationsSuite.orgAndAssignments;
  const regularWorkers = snapshot.workers.filter((w) => w.workerCategory !== 'DAILY' && w.workerCategory !== 'BIZ_33');

  const deptSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '부서별 조직 정원 · 현원 및 월 고정인건비 분포'),
      h('span', { className: 'tag tag-blue' }, `총 ${org.departments.length}개 조직 가동 중`)
    ),
    h(
      'div',
      { className: 'dept-card-grid' },
      org.departments.map((d) =>
        h(
          'div',
          { className: 'dept-stat-card' },
          h('div', { className: 'dept-stat-name' }, d.deptName),
          h('div', { className: 'kpi-value' }, `${d.headcount}명`),
          h('div', { className: 'dept-stat-meta' }, `월 기준보수 합계: ${fmtWon(d.monthlyBaseSum)}`)
        )
      )
    )
  );

  const assignForm = h(
    'form',
    {
      className: 'ops-inline-form',
      onSubmit: (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        runOpsAction(
          {
            actionType: 'ISSUE_ASSIGNMENT',
            empCode: form.querySelector('[name="asgEmp"]').value,
            orderType: form.querySelector('[name="asgType"]').value,
            targetDept: form.querySelector('[name="asgDept"]').value,
          },
          form.querySelector('button[type="submit"]')
        );
      },
    },
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'asg-emp-select' }, '발령 대상 근로자'),
      h(
        'select',
        { id: 'asg-emp-select', name: 'asgEmp', disabled: regularWorkers.length === 0 },
        regularWorkers.length === 0
          ? [h('option', { value: '' }, '대상 근로자 없음 (0명 빈 명부)')]
          : regularWorkers.map((w) =>
              h('option', { value: w.empCode }, `[${w.empCode}] ${w.displayName} (${w.deptName})`)
            )
      )
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'asg-type-select' }, '인사발령 구분 (급여·4대보험 자동연동)'),
      h(
        'select',
        { id: 'asg-type-select', name: 'asgType' },
        h('option', { value: 'PROMOTION' }, '승진 · 직급인상 (기본급 +6% 연동)'),
        h('option', { value: 'TRANSFER' }, '부서 전보 발령 (조직도 재집계)'),
        h('option', { value: 'PARENTAL_LEAVE' }, '육아휴직 개시 (일할계산 · 4대보험 유예)'),
        h('option', { value: 'RETURN_TO_WORK' }, '휴직 만료 복직 발령 (정상급여 복원)')
      )
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'asg-dept-input' }, '전보 시 이동 부서명'),
      h('input', { id: 'asg-dept-input', name: 'asgDept', type: 'text', value: '기업부설연구소' })
    ),
    h(
      'div',
      { className: 'field' },
      h(
        'button',
        { type: 'submit', className: 'btn btn-primary full-width', disabled: regularWorkers.length === 0 },
        '인사발령 즉시 실행'
      )
    )
  );

  const rosterAndCertSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '전 직원 인사기록카드 · 인사발령 실행 · 재직증명서 즉시 발급')
    ),
    assignForm,
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '재직자 인사기록카드 및 재직증명서 발급' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '사번 · 성명'),
            h('th', { scope: 'col' }, '소속부서 · 직위'),
            h('th', { scope: 'col' }, '고용구분 · 근무상태'),
            h('th', { scope: 'col', className: 'num' }, '월 기본급'),
            h('th', { scope: 'col' }, '재직증명 · 보안서식 발급')
          )
        ),
        h(
          'tbody',
          {},
          regularWorkers.length === 0
            ? [h('tr', {}, h('td', { colspan: '5' }, '현재 등록된 재직 근로자가 없습니다 (0명 빈 명부 상태).'))]
            : regularWorkers.map((w) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '사번 · 성명' },
                h('div', { className: 'cell-emp-code' }, w.empCode),
                h('div', { className: 'breakable-name' }, w.displayName)
              ),
              h(
                'td',
                { 'data-label': '소속부서 · 직위' },
                h('div', {}, w.deptName),
                h('div', { className: 'cell-dept-name' }, w.jobTitle || '사원')
              ),
              h(
                'td',
                { 'data-label': '고용구분 · 상태' },
                h(
                  'span',
                  { className: (w.unpaidLeaveDays || 0) > 0 ? 'tag tag-amber' : 'tag tag-green' },
                  (w.unpaidLeaveDays || 0) > 0 ? `휴직/무급일할 (${w.unpaidLeaveDays}일)` : '정상 재직중'
                )
              ),
              h('td', { className: 'num', 'data-label': '월 기본급' }, fmtWon(w.baseMonthlyPay || 0)),
              h(
                'td',
                { 'data-label': '재직증명 · 보안서식' },
                h(
                  'div',
                  { className: 'step-pill-group' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview('DOC_EMPLOYMENT_CERT', e.currentTarget, undefined, w.empCode),
                    },
                    '재직증명서'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview('DOC_PRIVACY_CONSENT', e.currentTarget, undefined, w.empCode),
                    },
                    '개인정보동의서'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview('DOC_NDA_SECURITY_PLEDGE', e.currentTarget, undefined, w.empCode),
                    },
                    '비밀유지서약서'
                  )
                )
              )
            )
          )
        )
      )
    )
  );

  const historySection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '최근 인사발령 이력 및 4대보험·급여 자동연동 로그')
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '인사발령 이력 대장' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '발령번호 · 일자'),
            h('th', { scope: 'col' }, '대상자'),
            h('th', { scope: 'col' }, '발령구분'),
            h('th', { scope: 'col' }, '변동 내역 (발령 전 → 후)'),
            h('th', { scope: 'col' }, '4대보험 · 급여 연동')
          )
        ),
        h(
          'tbody',
          {},
          org.assignmentLogs.map((log) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '발령번호 · 일자' },
                h('div', { className: 'cell-emp-code' }, log.assignmentId),
                h('div', { className: 'cell-dept-name' }, log.effectiveDate)
              ),
              h('td', { 'data-label': '대상자' }, `${log.displayName} (${log.empCode})`),
              h('td', { 'data-label': '발령구분' }, h('span', { className: 'tag tag-blue' }, log.orderLabel)),
              h('td', { 'data-label': '변동 내역' }, `${log.beforeSummary} → ${log.afterSummary}`),
              h('td', { 'data-label': '4대보험 · 급여 연동' }, log.insuranceSyncNote)
            )
          )
        )
      )
    )
  );

  const leaveCount = regularWorkers.filter((w) => (w.unpaidLeaveDays || 0) > 0).length;
  const totalBaseSum = org.departments.reduce((s, d) => s + (d.monthlyBaseSum || 0), 0);
  const orgKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '운영 부서 · 조직 수'),
      h('div', { className: 'kpi-value' }, `${org.departments.length}개 부서`),
      h('div', { className: 'kpi-sub' }, `월 기준보수 총합 ${fmtWon(totalBaseSum)}`)
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '인사명부 등록 인원'),
      h('div', { className: 'kpi-value' }, `${regularWorkers.length}명`),
      h('div', { className: 'kpi-sub' }, '상용 · 단시간 정규 인사기록카드')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '휴직 · 일할정산 인원'),
      h('div', { className: 'kpi-value' }, `${leaveCount}명`),
      h('div', { className: 'kpi-sub' }, '육아휴직 4대보험 납부예외 자동연동')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '인사발령 · 증명서 이력'),
      h('div', { className: 'kpi-value' }, `${org.assignmentLogs.length}건`),
      h('div', { className: 'kpi-sub' }, '재직증명 · 동의서 · 보안서약 즉시 발급')
    )
  );

  wrap.replaceChildren(orgKpis, deptSection, rosterAndCertSection, historySection);
}

function renderOpsAttendanceTab(snapshot) {
  const wrap = document.getElementById('ops-attendance-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const att = snapshot.operationsSuite.attendanceControl;
  const warnH = att.weeklyWarnHours ?? 48;

  const attPolicyBar = h(
    'div',
    { className: 'policy-sync-bar' },
    h(
      'div',
      { className: 'policy-sync-items' },
      h('span', { className: 'tag tag-blue' }, '환경 설정 연동 중'),
      h('span', {}, `사전 주의 기준: 주 ${warnH}시간 이상`),
      h('span', {}, '· 법정 상한: 주 52시간 (근로기준법 제53조)'),
      h(
        'span',
        {},
        `· 가산수당: ${att.is5OrMore ? '5인 이상 50%/100% 자동 반영' : '5인 미만 특례(1.0배)'}`
      )
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        onClick: () => switchTab('settings-master', false),
      },
      '주의 기준시간 변경'
    )
  );

  const section = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '근로자별 근무제도 · 연장/야간/휴일 집계 · 주 52시간 게이지'),
      h(
        'span',
        { className: att.is5OrMore ? 'tag tag-blue' : 'tag tag-amber' },
        att.is5OrMore
          ? '5인 이상: 연장·야간·휴일 가산수당 급여대장 직결'
          : '5인 미만: 가산수당 특례(1.0배) 적용'
      )
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '주52시간 근태 관제 및 연장근로 현황표' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '사번 · 성명 · 부서'),
            h('th', { scope: 'col' }, '근무제도'),
            h('th', { scope: 'col', className: 'num' }, '월 연장 / 야간 / 휴일'),
            h('th', { scope: 'col' }, '주간 최대 실근로 게이지 (한도 52h)'),
            h('th', { scope: 'col' }, '법령 판정'),
            h('th', { scope: 'col' }, '근태 조정 (급여 자동반영)')
          )
        ),
        h(
          'tbody',
          {},
          att.board.length === 0
            ? [h('tr', {}, h('td', { colspan: '6' }, '현재 주52시간 관제 대상 상용·단시간 근로자가 없습니다 (0명).'))]
            : att.board.map((row) => {
                const progClass =
                  row.maxWeeklyWorkedHours > 52
                    ? 'meter-progress meter-progress-danger'
                    : row.maxWeeklyWorkedHours >= warnH
                      ? 'meter-progress meter-progress-warn'
                      : 'meter-progress';
                return h(
                  'tr',
                  {},
                  h(
                    'td',
                    { 'data-label': '사번 · 성명 · 부서' },
                    h('div', { className: 'cell-emp-code' }, row.empCode),
                    h('div', { className: 'breakable-name' }, row.displayName),
                    h('div', { className: 'cell-dept-name' }, row.deptName)
                  ),
                  h('td', { 'data-label': '근무제도' }, h('span', { className: 'tag tag-gray' }, row.shiftType)),
                  h(
                    'td',
                    { className: 'num', 'data-label': '월 연장 / 야간 / 휴일' },
                    `연장 ${row.monthlyOvertimeHours}h · 야간 ${row.monthlyNightHours}h · 휴일 ${row.monthlyHolidayHours}h`
                  ),
                  h(
                    'td',
                    { 'data-label': '주간 최대 실근로' },
                    h(
                      'div',
                      { className: 'meter-wrap' },
                      h('progress', {
                        className: progClass,
                        'aria-label': `${row.displayName} 주간 최대 실근로시간 게이지`,
                        max: '52',
                        value: String(Math.min(52, row.maxWeeklyWorkedHours)),
                      }),
                      h('span', { className: 'cell-dept-name' }, `주 최대 ${row.maxWeeklyWorkedHours}h / 52.0h`)
                    )
                  ),
                  h(
                    'td',
                    { 'data-label': '법령 판정' },
                    row.status === 'OVER_52H_ALERT'
                      ? h('span', { className: 'tag tag-red' }, '제53조 주52h 초과 경보!')
                      : row.status === 'NEAR_52H_WARN'
                        ? h('span', { className: 'tag tag-amber' }, `주 ${warnH}h+ 상한 임박 예고`)
                        : row.status === 'PARENTAL_OR_LEAVE'
                          ? h('span', { className: 'tag tag-blue' }, '휴직/단축 보호중')
                          : h('span', { className: 'tag tag-green' }, '적법 범위(정상)')
                  ),
                  h(
                    'td',
                    { 'data-label': '근태 조정' },
                    h(
                      'div',
                      { className: 'step-pill-group' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-secondary btn-sm',
                          onClick: (e) =>
                            runOpsAction(
                              {
                                actionType: 'QUICK_ATTENDANCE_UPDATE',
                                empCode: row.empCode,
                                overtimeHours: row.monthlyOvertimeHours + 4,
                                maxWeeklyWorkedHours: Number((row.maxWeeklyWorkedHours + 4).toFixed(1)),
                              },
                              e.currentTarget
                            ),
                        },
                        '+연장 4h 반영'
                      ),
                      row.maxWeeklyWorkedHours > 40
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'btn btn-secondary btn-sm',
                              onClick: (e) =>
                                runOpsAction(
                                  {
                                    actionType: 'QUICK_ATTENDANCE_UPDATE',
                                    empCode: row.empCode,
                                    overtimeHours: Math.max(0, row.monthlyOvertimeHours - 4),
                                    maxWeeklyWorkedHours: 43,
                                  },
                                  e.currentTarget
                                ),
                            },
                            '주43h 정상조정'
                          )
                        : null
                    )
                  )
                );
              })
        )
      )
    )
  );

  const over52 = att.board.filter((r) => r.status === 'OVER_52H_ALERT').length;
  const near52 = att.board.filter((r) => r.status === 'NEAR_52H_WARN').length;
  const totalOt = att.board.reduce((s, r) => s + (r.monthlyOvertimeHours || 0), 0);
  const attKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '근로시간 관제 대상'),
      h('div', { className: 'kpi-value' }, `${att.board.length}명`),
      h('div', { className: 'kpi-sub' }, att.is5OrMore ? '5인 이상 가산수당 자동 연동' : '5인 미만 특례 적용')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '당월 누적 연장근로'),
      h('div', { className: 'kpi-value' }, `${totalOt}시간`),
      h('div', { className: 'kpi-sub' }, '야간 · 휴일근로 급여 자동 반영')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, `주 ${warnH}시간+ 주의 대상`),
      h('div', { className: 'kpi-value' }, `${near52}명`),
      h('div', { className: 'kpi-sub' }, '환경 설정 주의 기준 연동')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '제53조 주 52시간 초과'),
      h('div', { className: 'kpi-value' }, `${over52}명`),
      h('div', { className: 'kpi-sub' }, over52 > 0 ? '즉시 근무일정 조정 필요' : '법정 한도 위반 0명')
    )
  );

  wrap.replaceChildren(attPolicyBar, attKpis, section);
}

function renderOpsLeaveTab(snapshot) {
  const wrap = document.getElementById('ops-leave-container');
  const promoWrap = document.getElementById('ops-leave-promo-container');
  if ((!wrap && !promoWrap) || !snapshot.operationsSuite) return;
  const lv = snapshot.operationsSuite.leaveAndMaternity;
  const policy = snapshot.operationsSuite.policySettings || snapshot.company.policySettings || {};
  const isFiscal = policy.leaveAccrualBasis === 'FISCAL_YEAR';
  const leaveBasisLabel = formatLeaveBasisShort(policy);

  const promoLabel = (stage) => {
    if (stage === 'STAGE_2_DESIGNATED') {
      return h('span', { className: 'tag tag-green' }, '2차 시기지정 완료 (보상면제)');
    }
    if (stage === 'STAGE_1_SENT') {
      return h('span', { className: 'tag tag-blue' }, '1차 서면촉진 완료');
    }
    return h('span', { className: 'tag tag-amber' }, '촉진 대기 (수당 추계)');
  };

  const totAccrued = Number(lv.ledger.reduce((s, r) => s + (r.accruedDays || 0), 0).toFixed(1));
  const totRemain = Number(lv.ledger.reduce((s, r) => s + (r.remainingDays || 0), 0).toFixed(1));
  const totEstPayout = lv.ledger.reduce((s, r) => s + (r.estimatedUnusedPayout || 0), 0);
  const promoWait = lv.ledger.filter((r) => r.promoStage !== 'STAGE_2_DESIGNATED').length;

  const makeLeavePolicyBar = () =>
    h(
      'div',
      { className: 'policy-sync-bar' },
      h(
        'div',
        { className: 'policy-sync-items' },
        h('span', { className: isFiscal ? 'tag tag-green' : 'tag tag-blue' }, `산정 기준: ${leaveBasisLabel}`),
        h(
          'span',
          {},
          isFiscal
            ? `중도입사 비례부여 (${
                policy.leaveRoundingRule === 'CEIL_INT'
                  ? '1일 올림'
                  : policy.leaveRoundingRule === 'CEIL_HALF'
                    ? '0.5일 올림'
                    : '0.1일 반올림'
              }) · 퇴직 시 입사일 기준 유리한 조건 정산`
            : '근로기준법 제60조 개별 입사일 기준 (1년 미만 월차 최대 11일 / 1년 이상 15~25일)'
        )
      ),
      h(
        'div',
        { className: 'step-pill-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-primary btn-sm',
            onClick: async (e) => {
              const nextBasis = isFiscal ? 'HIRE_DATE' : 'FISCAL_YEAR';
              try {
                const res = await apiPost(
                  '/api/simulate-company',
                  { policySettings: { leaveAccrualBasis: nextBasis } },
                  e.currentTarget
                );
                updateSnapshot(res.snapshot);
                showBanner(
                  nextBasis === 'FISCAL_YEAR'
                    ? `전사 연차 기준이 [회계연도(${res.snapshot.company.policySettings.fiscalYearStartMonthDay}) 기준]으로 전환되어 모든 연차원장·서식이 자동 재계산되었습니다.`
                    : '전사 연차 기준이 [개별 입사일 기준]으로 전환되어 모든 연차원장·서식이 자동 재계산되었습니다.'
                );
              } catch (err) {
                showBanner(err.message, true);
              }
            },
          },
          isFiscal ? '입사일 기준으로 전환' : '회계연도(1.1) 기준으로 전환'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: () => switchTab('settings-master', false),
          },
          '상세 환경 설정'
        )
      )
    );

  if (wrap) {
    const leaveKpis = h(
      'div',
      { className: 'kpi-strip' },
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '현재 연차 산정 방식'),
        h('div', { className: 'kpi-value' }, leaveBasisLabel),
        h('div', { className: 'kpi-sub' }, lv.is5OrMore ? '5인 이상 법정 연차 적용 중' : '5인 미만 법정 연차 제외')
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '전사 총 발생 연차'),
        h('div', { className: 'kpi-value' }, `${totAccrued}일`),
        h('div', { className: 'kpi-sub' }, isFiscal ? '회계연도 기준 자동 재계산됨' : '개별 입사일 기준 자동 계산됨')
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '전사 미사용 잔여 연차'),
        h('div', { className: 'kpi-value' }, `${totRemain}일`),
        h('div', { className: 'kpi-sub' }, `사용촉진 대기 ${promoWait}명`)
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '미사용 연차수당 추계액'),
        h('div', { className: 'kpi-value' }, fmtWon(totEstPayout)),
        h(
          'div',
          { className: 'kpi-sub' },
          policy.leaveSettlementPolicy === 'FULL_PAYOUT'
            ? '전액 수당보상 기준 추계'
            : '제61조 2차 지정 완료자 보상면제 반영'
        )
      )
    );

    const ledgerSection = h(
      'div',
      { className: 'ops-section-block' },
      h(
        'div',
        { className: 'ops-section-head' },
        h('h3', { className: 'ops-section-title' }, `직원별 연차 발생 · 사용 · 잔여 원장 (${leaveBasisLabel})`),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: () => switchTab('ops-leave-promo', false),
          },
          '연차 사용촉진 · 모성보호 탭 이동'
        )
      ),
      h(
        'div',
        { className: 'table-scroll-wrap' },
        h(
          'table',
          { className: 'payroll-table', 'aria-label': '직원별 연차 발생·사용·잔여 원장' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, '사번 · 성명 · 부서'),
              h('th', { scope: 'col' }, '입사일 · 사용만료일'),
              h('th', { scope: 'col' }, '적용 산정 근거'),
              h('th', { scope: 'col', className: 'num' }, '발생 / 사용 / 잔여'),
              h('th', { scope: 'col', className: 'num' }, '미사용수당 추계'),
              h('th', { scope: 'col' }, '촉진 상태')
            )
          ),
          h(
            'tbody',
            {},
            lv.ledger.length === 0
              ? [h('tr', {}, h('td', { colspan: '6' }, '현재 연차유급휴가 산정 대상 재직자가 없습니다 (0명).'))]
              : lv.ledger.map((r) =>
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      { 'data-label': '사번 · 성명 · 부서' },
                      h('div', { className: 'cell-emp-code' }, r.empCode),
                      h('div', { className: 'breakable-name' }, r.displayName),
                      h('div', { className: 'cell-dept-name' }, r.deptName)
                    ),
                    h(
                      'td',
                      { 'data-label': '입사일 · 만료일' },
                      h('div', {}, `입사: ${r.hireDate}`),
                      h('div', { className: 'cell-dept-name' }, `만료: ${r.cycleExpiryDate || '-'}`)
                    ),
                    h('td', { 'data-label': '산정 근거' }, r.ruleBasis),
                    h(
                      'td',
                      { className: 'num font-extrabold', 'data-label': '발생 / 사용 / 잔여' },
                      `${r.accruedDays}일 / ${r.usedDays}일 / 잔여 ${r.remainingDays}일`
                    ),
                    h(
                      'td',
                      { className: 'num', 'data-label': '미사용수당 추계' },
                      fmtWon(r.estimatedUnusedPayout)
                    ),
                    h('td', { 'data-label': '촉진 상태' }, promoLabel(r.promoStage))
                  )
                )
          )
        )
      )
    );

    wrap.replaceChildren(makeLeavePolicyBar(), leaveKpis, ledgerSection);
  }

  if (promoWrap) {
    const promoSection = h(
      'div',
      { className: 'ops-section-block' },
      h(
        'div',
        { className: 'ops-section-head' },
        h('h3', { className: 'ops-section-title' }, '근로기준법 제61조 1차(6개월 전) · 2차(2개월 전) 서면 사용촉진 실행'),
        h('span', { className: 'tag tag-amber' }, `촉진 진행 대상 ${promoWait}명`)
      ),
      h(
        'div',
        { className: 'table-scroll-wrap' },
        h(
          'table',
          { className: 'payroll-table', 'aria-label': '제61조 연차 사용촉진 발송 및 통지서 발급' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, '사번 · 성명'),
              h('th', { scope: 'col', className: 'num' }, '미사용 잔여연차'),
              h('th', { scope: 'col' }, '만료일 · 1차/2차 촉진 기한'),
              h('th', { scope: 'col' }, '현재 진행 단계'),
              h('th', { scope: 'col' }, '서면촉진 실행 · 통지서')
            )
          ),
          h(
            'tbody',
            {},
            lv.ledger.length === 0
              ? [h('tr', {}, h('td', { colspan: '5' }, '연차 사용촉진 대상 재직자가 없습니다 (0명).'))]
              : lv.ledger.map((r) =>
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      { 'data-label': '사번 · 성명' },
                      h('div', { className: 'cell-emp-code' }, r.empCode),
                      h('div', { className: 'breakable-name' }, `${r.displayName} (${r.deptName})`)
                    ),
                    h(
                      'td',
                      { className: 'num font-extrabold', 'data-label': '미사용 잔여연차' },
                      `잔여 ${r.remainingDays}일`
                    ),
                    h(
                      'td',
                      { 'data-label': '만료일 · 촉진 기한' },
                      h('div', {}, `사용만료: ${r.cycleExpiryDate || '-'}`),
                      h(
                        'div',
                        { className: 'cell-dept-name' },
                        `1차(~${r.firstPromoDeadline || '-'}) · 2차(~${r.secondPromoDeadline || '-'})`
                      )
                    ),
                    h('td', { 'data-label': '진행 단계' }, promoLabel(r.promoStage)),
                    h(
                      'td',
                      { 'data-label': '서면촉진 실행 · 통지서' },
                      h(
                        'div',
                        { className: 'step-pill-group' },
                        r.promoStage !== 'STAGE_2_DESIGNATED'
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'btn btn-primary btn-sm',
                                onClick: (e) =>
                                  runOpsAction(
                                    { actionType: 'ADVANCE_LEAVE_PROMOTION', empCode: r.empCode },
                                    e.currentTarget
                                  ),
                              },
                              r.promoStage === 'NONE' ? '1차 촉진 발송' : '2차 시기지정 완료'
                            )
                          : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'btn btn-secondary btn-sm',
                            onClick: (e) =>
                              openDocumentPreview(
                                'DOC_ANNUAL_LEAVE_PROMOTION',
                                e.currentTarget,
                                undefined,
                                r.empCode
                              ),
                          },
                          '촉진 통지서 열람'
                        )
                      )
                    )
                  )
                )
          )
        )
      )
    );

    const matSection = h(
      'div',
      { className: 'ops-section-block' },
      h(
        'div',
        { className: 'ops-section-head' },
        h('h3', { className: 'ops-section-title' }, '모성보호 · 일가정양립 제도 및 고용보험 지원금 연계 현황')
      ),
      h(
        'div',
        { className: 'ops-two-col' },
        lv.maternityProtections.map((m) =>
          h(
            'div',
            { className: 'dept-stat-card' },
            h('span', { className: 'tag tag-blue' }, m.programType),
            h('div', { className: 'ops-module-title' }, `${m.deptName} — ${m.beneficiaryLabel}`),
            h('div', { className: 'dept-stat-meta' }, `적용 기간: ${m.periodLabel}`),
            h('div', { className: 'dept-stat-meta' }, `정부지원금: ${m.govSubsidyStatus}`),
            h('div', { className: 'dept-stat-meta' }, `사업주 준수사항: ${m.employerObligation}`)
          )
        )
      )
    );

    promoWrap.replaceChildren(makeLeavePolicyBar(), promoSection, matSection);
  }
}

function renderOpsEvalTab(snapshot) {
  const wrap = document.getElementById('ops-eval-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const ev = snapshot.operationsSuite.evaluationAndReward;

  const section = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '업적(KPI)·역량 다면평가 등급 조정 및 M8 급여 인상분·성과급 일괄 연동'),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary',
          onClick: (e) => runOpsAction({ actionType: 'APPLY_EVAL_REWARDS' }, e.currentTarget),
        },
        '현재 평가 보상안 M8 급여대장 일괄 확정 반영'
      )
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '인사평가 등급 및 보상 시뮬레이션 대장' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '사번 · 성명 · 부서'),
            h('th', { scope: 'col', className: 'num' }, 'KPI / 역량 점수'),
            h('th', { scope: 'col' }, '종합 평가등급 선택'),
            h('th', { scope: 'col', className: 'num' }, '권고 인상률 · 시뮬레이션 기본급'),
            h('th', { scope: 'col', className: 'num' }, '권고 성과급'),
            h('th', { scope: 'col' }, 'M8 급여대장 연동상태')
          )
        ),
        h(
          'tbody',
          {},
          ev.board.length === 0
            ? [h('tr', {}, h('td', { colspan: '6' }, '현재 인사평가·보상 시뮬레이션 대상 재직자가 없습니다 (0명).'))]
            : ev.board.map((r) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '사번 · 성명 · 부서' },
                h('div', { className: 'cell-emp-code' }, r.empCode),
                h('div', { className: 'breakable-name' }, r.displayName),
                h('div', { className: 'cell-dept-name' }, r.deptName)
              ),
              h(
                'td',
                { className: 'num', 'data-label': 'KPI / 역량 점수' },
                `KPI ${r.kpiScore}점 / 역량 ${r.competencyScore}점`
              ),
              h(
                'td',
                { 'data-label': '종합 평가등급' },
                h(
                  'select',
                  {
                    className: 'grade-select',
                    'aria-label': `${r.displayName} 평가등급 선택`,
                    onChange: (e) =>
                      runOpsAction(
                        {
                          actionType: 'SET_EVAL_GRADE',
                          empCode: r.empCode,
                          grade: e.currentTarget.value,
                        },
                        e.currentTarget
                      ),
                  },
                  ['S', 'A', 'B', 'C', 'D'].map((g) =>
                    h('option', { value: g, selected: r.grade === g }, `${g} 등급`)
                  )
                )
              ),
              h(
                'td',
                { className: 'num', 'data-label': '권고 인상률 · 시뮬레이션 기본급' },
                `+${r.recommendedRaisePct}% (${fmtWon(r.currentBasePay)} → ${fmtWon(r.projectedBasePay)})`
              ),
              h('td', { className: 'num', 'data-label': '권고 성과급' }, fmtWon(r.recommendedBonus)),
              h(
                'td',
                { 'data-label': 'M8 급여대장 연동상태' },
                r.appliedToPayroll
                  ? h(
                      'span',
                      { className: 'tag tag-green' },
                      `급여 반영됨 (+${r.appliedRaisePct}% · ${fmtWon(r.appliedBonusPay)})`
                    )
                  : h('span', { className: 'tag tag-amber' }, '시뮬레이션 대기 (일괄 반영 클릭)')
              )
            )
          )
        )
      )
    )
  );

  const highPerformers = ev.board.filter((r) => r.grade === 'S' || r.grade === 'A').length;
  const bonusSum = ev.board.reduce((s, r) => s + (r.recommendedBonus || 0), 0);
  const unappliedCount = ev.board.filter((r) => !r.appliedToPayroll).length;
  const evalKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '평가 · 보상 대상 인원'),
      h('div', { className: 'kpi-value' }, `${ev.board.length}명`),
      h('div', { className: 'kpi-sub' }, '업적(KPI) · 역량 다면평가 연동')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '우수 등급 (S · A) 인원'),
      h('div', { className: 'kpi-value' }, `${highPerformers}명`),
      h('div', { className: 'kpi-sub' }, '등급별 차등 인상률 자동 시뮬레이션')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '시뮬레이션 성과급 총액'),
      h('div', { className: 'kpi-value' }, fmtWon(bonusSum)),
      h('div', { className: 'kpi-sub' }, '확정 시 당월 급여대장 즉시 산입')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, 'M8 급여 반영 대기'),
      h('div', { className: 'kpi-value' }, `${unappliedCount}명`),
      h('div', { className: 'kpi-sub' }, unappliedCount > 0 ? '우측 상단 일괄 반영 버튼 클릭' : '전원 급여 반영 완료')
    )
  );

  wrap.replaceChildren(evalKpis, section);
}

function renderOpsDisciplineTab(snapshot) {
  const wrap = document.getElementById('ops-discipline-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const dg = snapshot.operationsSuite.disciplineAndGrievance;

  const stepBtn = (empCode, field, label, active) =>
    h(
      'button',
      {
        type: 'button',
        className: active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
        'aria-pressed': String(active),
        onClick: (e) =>
          runOpsAction(
            { actionType: 'TOGGLE_DISCIPLINE_STEP', empCode, stepField: field },
            e.currentTarget
          ),
      },
      `${active ? '✓ ' : ''}${label}`
    );

  const discSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '적법 징계 4대 절차 이행 감독 & 근로기준법 제95조 감봉 상한 자동 방어'),
      h('span', { className: 'tag tag-red' }, '1회 평균임금 일액 1/2 · 월 총액 1/10 초과 공제 원천 차단')
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '징계 절차 검증 및 제95조 감봉 한도 대장' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '사번 · 성명 · 부서'),
            h('th', { scope: 'col', className: 'num' }, '감봉 요청액 → 적법 반영액 (차단액)'),
            h('th', { scope: 'col' }, '부당징계 예방 4대 필수 절차 (클릭 토글)'),
            h('th', { scope: 'col' }, '절차 적법성 · 서면양식')
          )
        ),
        h(
          'tbody',
          {},
          dg.disciplineBoard.length === 0
            ? [h('tr', {}, h('td', { colspan: '4' }, '현재 징계 절차·감봉 한도 점검 대상 재직자가 없습니다 (0명).'))]
            : dg.disciplineBoard.map((d) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '사번 · 성명 · 부서' },
                h('div', { className: 'cell-emp-code' }, d.empCode),
                h('div', { className: 'breakable-name' }, d.displayName),
                h('div', { className: 'cell-dept-name' }, d.deptName)
              ),
              h(
                'td',
                { className: 'num', 'data-label': '감봉 요청 → 적법 반영' },
                h('div', {}, `요청 ${fmtWon(d.requestedCut)} → 공제 ${fmtWon(d.appliedCut)}`),
                d.blockedCut > 0
                  ? h('div', { className: 'cut-blocked-note' }, `제95조 한도초과 ${fmtWon(d.blockedCut)} 자동 방어됨`)
                  : h('div', { className: 'cell-dept-name' }, '감봉 요청 없음 또는 한도 이내')
              ),
              h(
                'td',
                { 'data-label': '4대 필수 절차' },
                h(
                  'div',
                  { className: 'step-pill-group' },
                  stepBtn(d.empCode, 'attendanceNoticeSent', '1.출석통지', d.attendanceNoticeSent),
                  stepBtn(d.empCode, 'defenseOpportunityGiven', '2.소명기회', d.defenseOpportunityGiven),
                  stepBtn(d.empCode, 'committeeResolved', '3.징계위의결', d.committeeResolved),
                  stepBtn(d.empCode, 'writtenNoticeDelivered', '4.서면통지', d.writtenNoticeDelivered)
                )
              ),
              h(
                'td',
                { 'data-label': '절차 적법성 · 서면양식' },
                h(
                  'div',
                  { className: 'step-pill-group' },
                  d.procedureValid
                    ? h('span', { className: 'tag tag-green' }, '4대 절차 완비')
                    : h('span', { className: 'tag tag-red' }, '절차 미비 경고!'),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-secondary btn-sm',
                      onClick: (e) =>
                        openDocumentPreview(
                          'DOC_DISCIPLINE_WRITTEN_NOTICE',
                          e.currentTarget,
                          undefined,
                          d.empCode
                        ),
                    },
                    '서면통지·검토서 열람'
                  )
                )
              )
            )
          )
        )
      )
    )
  );

  const grvForm = h(
    'form',
    {
      className: 'ops-inline-form',
      onSubmit: (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        runOpsAction(
          {
            actionType: 'ADD_GRIEVANCE',
            category: form.querySelector('[name="grvCat"]').value,
            summary: form.querySelector('[name="grvSum"]').value,
          },
          form.querySelector('button[type="submit"]')
        );
      },
    },
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'grv-cat-input' }, '고충 분야'),
      h('input', { id: 'grv-cat-input', name: 'grvCat', type: 'text', value: '작업환경 · 근무일정' })
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'grv-sum-input' }, '고충 접수 요지 (비밀보장 · 접수 후 10일 내 통보 타이머 자동 생성)'),
      h('input', { id: 'grv-sum-input', name: 'grvSum', type: 'text', value: '동절기 출하장 방한용품 추가 지급 및 휴게시간 조정 건', required: true })
    ),
    h(
      'div',
      { className: 'field' },
      h('button', { type: 'submit', className: 'btn btn-secondary full-width' }, '신규 고충 접수 등록')
    )
  );

  const grvSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '고충처리위원 접수 · 처리대장 (근참법 제26조~제28조 · 10일 이내 결과 통보)'),
      h(
        'span',
        { className: dg.is30OrMore ? 'tag tag-green' : 'tag tag-gray' },
        dg.is30OrMore ? '30인+ 고충처리위원(3인 이내) 법정 배치 의무 가동중' : '30인 미만 자율 고충상담 창구'
      )
    ),
    grvForm,
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '고충처리 접수 및 10일 기한 관리 대장' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '접수번호 · 경로'),
            h('th', { scope: 'col' }, '접수일 · 10일 법정통보기한'),
            h('th', { scope: 'col' }, '고충 요지 및 조치 경과'),
            h('th', { scope: 'col' }, '처리 상태 · 결과통보')
          )
        ),
        h(
          'tbody',
          {},
          dg.grievances.map((g) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '접수번호 · 경로' },
                h('div', { className: 'cell-emp-code' }, g.grievanceId),
                h('div', { className: 'cell-dept-name' }, `${g.category} (${g.channel})`)
              ),
              h(
                'td',
                { 'data-label': '접수일 · 10일 기한' },
                h('div', {}, `접수: ${g.receivedAt}`),
                h('div', { className: 'font-extrabold' }, `통보기한: ${g.dueDate}`)
              ),
              h(
                'td',
                { 'data-label': '고충 요지 및 조치' },
                h('div', { className: 'font-extrabold' }, g.summary),
                h('div', { className: 'cell-dept-name' }, g.resolutionNote)
              ),
              h(
                'td',
                { 'data-label': '처리 상태' },
                g.status === 'RESOLVED_NOTIFIED'
                  ? h('span', { className: 'tag tag-green' }, '10일 내 결과통보 완료')
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'btn btn-primary btn-sm',
                        onClick: (e) =>
                          runOpsAction(
                            { actionType: 'RESOLVE_GRIEVANCE', grievanceId: g.grievanceId },
                            e.currentTarget
                          ),
                      },
                      `조치·결과통보 완료 (D-${Math.max(0, g.daysLeft)})`
                    )
              )
            )
          )
        )
      )
    )
  );

  const invalidProcCount = dg.disciplineBoard.filter((d) => !d.procedureValid).length;
  const blockedSum = dg.disciplineBoard.reduce((s, d) => s + (d.blockedCut || 0), 0);
  const openGrvCount = dg.grievances.filter((g) => g.status !== 'RESOLVED_NOTIFIED').length;
  const discKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '징계 · 제95조 심사 대상'),
      h('div', { className: 'kpi-value' }, `${dg.disciplineBoard.length}명`),
      h('div', { className: 'kpi-sub' }, '출석통지 · 소명 · 의결 · 서면통지 점검')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '4대 절차 미비 주의'),
      h('div', { className: 'kpi-value' }, `${invalidProcCount}건`),
      h('div', { className: 'kpi-sub' }, '절차 흠결 시 부당징계 위험 사전 차단')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '제95조 감봉 한도초과 방어액'),
      h('div', { className: 'kpi-value' }, fmtWon(blockedSum)),
      h('div', { className: 'kpi-sub' }, '1회 일급 1/2 · 월 총액 1/10 상한 캡핑')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '고충처리(10일 기한) 진행중'),
      h('div', { className: 'kpi-value' }, `${openGrvCount}건`),
      h('div', { className: 'kpi-sub' }, dg.is30OrMore ? '30인+ 고충처리위원 법정 운영중' : '사내 고충상담 창구 운영중')
    )
  );

  wrap.replaceChildren(discKpis, discSection, grvSection);
}

function renderOpsStatutoryTab(snapshot) {
  const wrap = document.getElementById('ops-statutory-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const st = snapshot.operationsSuite.statutoryOpsCenter;

  const lmcSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, 'M10-A 노사협의회 위원 구성 · 분기 정기회의 안건 및 의결사항 관리 (30인+)'),
      h(
        'div',
        { className: 'step-pill-group' },
        h(
          'span',
          { className: st.lmcRequired ? 'tag tag-green' : 'tag tag-gray' },
          st.lmcRequired
            ? `노사 동수 각 ${st.lmcCommitteeCountEachSide}인 (${st.hasMajorityUnion ? '과반수 노조 위촉' : '직접·비밀·무기명 투표 선출'})`
            : '현재 30인 미만 (30인 진입 시 즉시 자동개설)'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_LMC_REGULATION_AND_FILING', e.currentTarget),
          },
          '노사협의회 규정·신고서 열람'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_LMC_MINUTES', e.currentTarget, 4),
          },
          '4분기 정기회의록 초안 열람'
        )
      )
    ),
    h(
      'div',
      { className: 'dept-card-grid' },
      st.lmcAgendaItems.map((ag) =>
        h(
          'div',
          { className: 'dept-stat-card' },
          h('span', { className: 'tag tag-blue' }, `${ag.quarterLabel} · ${ag.agendaType}`),
          h('div', { className: 'ops-module-title' }, ag.title),
          h(
            'div',
            { className: 'dept-stat-meta' },
            ag.status === 'RESOLVED' ? '상태: 의결 완료 · 3년 보존 회의록 편철' : '상태: 개최 7일 전 소집통지 반영됨'
          )
        )
      )
    )
  );

  const oshSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, 'M10-B 산업안전보건 선임 체제 & 공정별 위험성평가(산안법 제36조) 대장'),
      h(
        'div',
        { className: 'step-pill-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_OSH_OFFICER_APPOINTMENT', e.currentTarget),
          },
          '안전·보건관리자 14일 선임보고서 열람'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_OSH_MINUTES', e.currentTarget, 4),
          },
          '산업안전보건위원회 심의회의록 열람'
        )
      )
    ),
    h(
      'div',
      { className: 'dept-card-grid' },
      st.oshRoles.map((role) =>
        h(
          'div',
          { className: 'dept-stat-card' },
          h('span', { className: 'tag tag-amber' }, role.statusLabel),
          h('div', { className: 'ops-module-title' }, role.roleTitle),
          h('div', { className: 'dept-stat-meta' }, `선임/위탁 기준: ${role.assignee}`),
          h('div', { className: 'dept-stat-meta' }, `자격 요건: ${role.qualification}`)
        )
      )
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '공정별 위험성평가 및 감소대책 이행표' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '평가코드 · 대상 공정'),
            h('th', { scope: 'col' }, '유해·위험요인 파악'),
            h('th', { scope: 'col' }, '위험성 감소대책'),
            h('th', { scope: 'col' }, '개선 조치 상태')
          )
        ),
        h(
          'tbody',
          {},
          st.riskAssessments.map((rk) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': '대상 공정' },
                h('div', { className: 'cell-emp-code' }, `${rk.riskId} (${rk.riskLevel})`),
                h('div', { className: 'font-extrabold' }, rk.processName)
              ),
              h('td', { 'data-label': '유해·위험요인' }, rk.hazardFactor),
              h('td', { 'data-label': '감소대책' }, rk.measurePlan),
              h(
                'td',
                { 'data-label': '개선 조치 상태' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: rk.completed ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
                    onClick: (e) =>
                      runOpsAction(
                        { actionType: 'TOGGLE_RISK_ASSESSMENT', riskId: rk.riskId },
                        e.currentTarget
                      ),
                  },
                  rk.completed ? '✓ 개선 완료됨 (재점검 전환)' : '개선 조치 완료 체크'
                )
              )
            )
          )
        )
      )
    )
  );

  const eduSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, 'M10-C 5대 법정의무교육 전사 이수율 감독 및 미이수자 일괄 독촉'),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_WORK_RULES_REPORT', e.currentTarget),
        },
        '10인+ 취업규칙 신고서 초안 열람'
      )
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '5대 법정의무교육 이수율 및 수료 관리 대장' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '법정의무교육 과정명'),
            h('th', { scope: 'col' }, '근거 법령 · 필수 기준'),
            h('th', { scope: 'col' }, '실시 주기'),
            h('th', { scope: 'col' }, '전사 이수율 게이지'),
            h('th', { scope: 'col' }, '독촉 · 수료증빙')
          )
        ),
        h(
          'tbody',
          {},
          st.statutoryTrainings.map((edu) =>
            h(
              'tr',
              {},
              h('td', { 'data-label': '과정명', className: 'font-extrabold' }, edu.title),
              h('td', { 'data-label': '근거 법령' }, edu.legalBasis),
              h('td', { 'data-label': '실시 주기' }, edu.cycleLabel),
              h(
                'td',
                { 'data-label': '전사 이수율' },
                h(
                  'div',
                  { className: 'meter-wrap' },
                  h('progress', {
                    className: edu.completionRatePct >= 100 ? 'meter-progress' : 'meter-progress meter-progress-warn',
                    'aria-label': `${edu.title} 전사 이수율 게이지`,
                    max: '100',
                    value: String(edu.completionRatePct),
                  }),
                  h('span', { className: 'cell-dept-name' }, `${edu.completionRatePct}% 이수 완료`)
                )
              ),
              h(
                'td',
                { 'data-label': '독촉 · 수료증빙' },
                edu.completionRatePct >= 100
                  ? h('span', { className: 'tag tag-green' }, '전원 수료·증빙 편철됨')
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'btn btn-primary btn-sm',
                        onClick: (e) =>
                          runOpsAction(
                            { actionType: 'COMPLETE_STATUTORY_EDU', trainingId: edu.trainingId },
                            e.currentTarget
                          ),
                      },
                      '미이수자 독촉 · 100% 이수 반영'
                    )
              )
            )
          )
        )
      )
    )
  );

  const doneRisks = st.riskAssessments.filter((r) => r.completed).length;
  const avgEdu =
    st.statutoryTrainings.length > 0
      ? Math.round(
          st.statutoryTrainings.reduce((s, e) => s + e.completionRatePct, 0) /
            st.statutoryTrainings.length
        )
      : 100;
  const statKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '노사협의회 (근참법 30인+)'),
      h('div', { className: 'kpi-value' }, st.lmcRequired ? `노사 각 ${st.lmcCommitteeCountEachSide}인` : '미해당(30인 미만)'),
      h('div', { className: 'kpi-sub' }, '15일 내 규정신고 · 분기 정기회의 운영')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '안전보건관리 · 산안위 (50인+)'),
      h('div', { className: 'kpi-value' }, st.oshOfficerRequired ? '선임 의무 발동' : '자율 안전관리'),
      h('div', { className: 'kpi-sub' }, '14일 내 선임보고 · 분기 산안위 심의')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '공정별 위험성평가 (제36조)'),
      h('div', { className: 'kpi-value' }, `${doneRisks} / ${st.riskAssessments.length}건 완료`),
      h('div', { className: 'kpi-sub' }, '유해위험요인 개선대책 및 근로자 참여')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '5대 법정의무교육 평균 이수율'),
      h('div', { className: 'kpi-value' }, `${avgEdu}%`),
      h('div', { className: 'kpi-sub' }, '성희롱 · 개인정보 · 안전보건 · 장애인식 · 퇴직연금')
    )
  );

  wrap.replaceChildren(statKpis, lmcSection, oshSection, eduSection);
}

function renderFormsCenterTab(snapshot) {
  const wrap = document.getElementById('forms-center-container');
  if (!wrap) return;

  const firstWorker = (snapshot.workers || [])[0] || null;
  const firstAlumni =
    (snapshot.offboardedWorkers || []).find((a) => a.dataLifecycleStatus !== 'ANONYMIZED_PURGED') ||
    null;

  const openSmartTemplate = (tplId, mode, triggerBtn) => {
    if (mode === 'worker') {
      if (!firstWorker) {
        showBanner('현재 재직자 명부가 비어 있습니다(0명). 급여 관리에서 기본 명부를 복원해 주세요.', true);
        return;
      }
      openDocumentPreview(tplId, triggerBtn, undefined, firstWorker.empCode);
      return;
    }
    if (mode === 'alumni') {
      if (!firstAlumni) {
        showBanner('발급 가능한 퇴사자 레코드가 없습니다.', true);
        return;
      }
      openDocumentPreview(tplId, triggerBtn, undefined, firstAlumni.empCode);
      return;
    }
    if (mode === 'q4') {
      openDocumentPreview(tplId, triggerBtn, 4);
      return;
    }
    openDocumentPreview(tplId, triggerBtn);
  };

  const categories = [
    {
      badge: '1. 입사 · 계약 · 개인정보',
      badgeClass: 'tag tag-blue',
      title: '입사 계약 · 개인정보동의 · 정보보안',
      items: [
        {
          id: 'DOC_EMPLOYMENT_CONTRACT',
          title: '근로기준법 제17조 표준 근로계약서',
          sub: '환경 설정의 급여지급일 · 연차 산정기준 자동 반영',
          mode: 'company',
        },
        {
          id: 'DOC_PRIVACY_CONSENT',
          title: '개인정보 수집·이용·제3자제공 동의서',
          sub: '고유식별정보 분리 동의 · 퇴직 후 3년 보존 명시',
          mode: 'company',
        },
        {
          id: 'DOC_NDA_SECURITY_PLEDGE',
          title: '비밀유지 및 정보보안 서약서 (입사·재직)',
          sub: '영업비밀보호법 · 산업기술보호법 준수 서약',
          mode: 'company',
        },
      ],
    },
    {
      badge: '2. 퇴사 · 경업금지 · 증명서',
      badgeClass: 'tag tag-amber',
      title: '퇴사 보안·경업금지 · 경력증명 · 이직확인',
      items: [
        {
          id: 'DOC_EXIT_SECURITY_NONCOMPETE',
          title: '퇴사 시 보안·자산반납 및 경업금지 서약서',
          sub: '대법원 2009다82244 유효성 가드레일 내장',
          mode: 'company',
        },
        {
          id: 'DOC_EMPLOYMENT_CERT',
          title: '재직증명서 (현 재직 근로자)',
          sub: firstWorker ? `샘플 대상: ${firstWorker.displayName} (${firstWorker.empCode})` : '재직자 명부 연동',
          mode: 'worker',
        },
        {
          id: 'DOC_CAREER_CERTIFICATE',
          title: '근로기준법 제39조 사용(경력)증명서',
          sub: firstAlumni ? `샘플 대상: ${firstAlumni.displayName} (${firstAlumni.empCode})` : '퇴사자 원장 연동',
          mode: 'alumni',
        },
        {
          id: 'DOC_EI_SEPARATION_CERT',
          title: '고용보험 피보험자격 상실·이직확인서',
          sub: firstAlumni ? `샘플 대상: ${firstAlumni.displayName} (${firstAlumni.empCode})` : '퇴사자 원장 연동',
          mode: 'alumni',
        },
      ],
    },
    {
      badge: '3. 취업규칙 · 연차 · 징계',
      badgeClass: 'tag tag-green',
      title: '취업규칙 · 연차 사용촉진 · 징계 서면통지',
      items: [
        {
          id: 'DOC_WORK_RULES_REPORT',
          title: '10인 이상 취업규칙 제정·변경 신고서',
          sub: '환경 설정의 회계연도/입사일 연차조항 · 급여일 자동 반영',
          mode: 'company',
        },
        {
          id: 'DOC_ANNUAL_LEAVE_PROMOTION',
          title: '제61조 미사용 연차 서면 사용촉진 통지서',
          sub: firstWorker ? `샘플 대상: ${firstWorker.displayName} (${firstWorker.empCode})` : '재직자 연차원장 연동',
          mode: 'worker',
        },
        {
          id: 'DOC_DISCIPLINE_WRITTEN_NOTICE',
          title: '징계 출석통지 및 의결 서면통지서',
          sub: firstWorker ? `샘플 대상: ${firstWorker.displayName} (${firstWorker.empCode})` : '징계절차 검증 연동',
          mode: 'worker',
        },
      ],
    },
    {
      badge: '4. 노사협의회 · 산업안전보건',
      badgeClass: 'tag tag-gray',
      title: '노사협의회(30인+) · 안전보건(50인+) 양식',
      items: [
        {
          id: 'DOC_LMC_REGULATION_AND_FILING',
          title: '30인 이상 노사협의회 규정 및 설치신고서',
          sub: '근로자참여법 제4조 · 15일 이내 관할 노동청 신고',
          mode: 'company',
        },
        {
          id: 'DOC_LMC_MINUTES',
          title: '노사협의회 분기 정기회의록 초안',
          sub: '분기별 보고·협의·의결사항 표준 회의록',
          mode: 'q4',
        },
        {
          id: 'DOC_OSH_OFFICER_APPOINTMENT',
          title: '50인 이상 안전·보건관리자 선임보고서',
          sub: '산업안전보건법 제17조·제18조 · 14일 이내 보고',
          mode: 'company',
        },
        {
          id: 'DOC_OSH_MINUTES',
          title: '산업안전보건위원회 회의록 · 위험성평가표',
          sub: '산안법 제24조·제36조 분기 심의·의결 양식',
          mode: 'q4',
        },
      ],
    },
  ];

  const grid = h(
    'div',
    { className: 'forms-category-grid' },
    categories.map((cat) =>
      h(
        'article',
        { className: 'forms-category-card' },
        h(
          'div',
          {},
          h('span', { className: cat.badgeClass }, cat.badge),
          h('h3', { className: 'ops-module-title' }, cat.title)
        ),
        h(
          'div',
          { className: 'forms-item-list' },
          cat.items.map((it) =>
            h(
              'div',
              { className: 'forms-item-row' },
              h(
                'div',
                {},
                h('div', { className: 'forms-item-title' }, it.title),
                h('div', { className: 'forms-item-sub' }, it.sub)
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  onClick: (e) => openSmartTemplate(it.id, it.mode, e.currentTarget),
                },
                '열람 · 복사'
              )
            )
          )
        )
      )
    )
  );

  wrap.replaceChildren(grid);
}

/* ==========================================================================
   전체 스냅샷 반영 및 2단계(대분류 → 하부 탭) 네비게이션 컨트롤러
   ========================================================================== */

function updateSnapshot(snapshot) {
  appState.snapshot = snapshot;
  const gate = document.getElementById('pc-auth-gate');
  if (gate) gate.hidden = true;
  syncSimFormControls(snapshot);
  renderHeadcountKpis(snapshot);
  renderOpsHomeTab(snapshot);
  renderOpsRecruitTab(snapshot);
  renderOpsOrgTab(snapshot);
  renderOpsAttendanceTab(snapshot);
  renderOpsLeaveTab(snapshot);
  renderOpsEvalTab(snapshot);
  renderOpsDisciplineTab(snapshot);
  renderFormsCenterTab(snapshot);
  renderOpsStatutoryTab(snapshot);
  renderOnboardingTab(snapshot);
  renderFloorPlan(snapshot);
  renderComplianceTab(snapshot);
  renderLifecycleTab(snapshot);
  renderPayrollTab(snapshot);
  renderAlumniTab(snapshot);
}

function setMobileSidebarOpen(isOpen) {
  const sidebar = document.getElementById('left-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggleBtn = document.getElementById('btn-mobile-sidebar-toggle');
  const workspacePane = document.getElementById('workspace-pane');
  if (!sidebar) return;
  if (isOpen) {
    sidebar.setAttribute('data-sidebar-open', 'true');
    if (backdrop) backdrop.hidden = false;
    toggleBtn?.setAttribute('aria-expanded', 'true');
    if (workspacePane && window.innerWidth <= 1080) {
      workspacePane.inert = true;
      workspacePane.setAttribute('aria-hidden', 'true');
    }
  } else {
    sidebar.removeAttribute('data-sidebar-open');
    if (backdrop) backdrop.hidden = true;
    toggleBtn?.setAttribute('aria-expanded', 'false');
    if (workspacePane) {
      workspacePane.inert = false;
      workspacePane.removeAttribute('aria-hidden');
    }
  }
}

function renderSubtabsBar(groupKey, activeTabKey, focusActive = false) {
  const wrap = document.getElementById('domain-subtabs-wrap');
  const bar = document.getElementById('domain-subtabs-bar');
  if (!wrap || !bar) return;
  const group = MAJOR_MENU_GROUPS.find((g) => g.groupKey === groupKey) || MAJOR_MENU_GROUPS[0];
  if (!group || group.tabs.length <= 1) {
    wrap.hidden = true;
    bar.replaceChildren();
    return;
  }

  wrap.hidden = false;
  const buttons = group.tabs.map((t, idx) => {
    const isSel = t.key === activeTabKey;
    return h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-btn-${t.key}`,
        className: 'subtab-btn tab-btn',
        'aria-selected': String(isSel),
        'aria-controls': `panel-${t.key}`,
        tabindex: isSel ? '0' : '-1',
        dataset: { tab: t.key, group: groupKey },
        onClick: () => switchTab(t.key, false),
        onKeydown: (e) => {
          let nextIdx = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIdx = (idx + 1) % group.tabs.length;
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            nextIdx = (idx - 1 + group.tabs.length) % group.tabs.length;
          } else if (e.key === 'Home') {
            nextIdx = 0;
          } else if (e.key === 'End') {
            nextIdx = group.tabs.length - 1;
          }
          if (nextIdx !== null) {
            e.preventDefault();
            switchTab(group.tabs[nextIdx].key, true);
          }
        },
      },
      t.label
    );
  });
  bar.replaceChildren(...buttons);
  if (focusActive) {
    const targetBtn = bar.querySelector(`.subtab-btn[data-tab="${activeTabKey}"]`);
    targetBtn?.focus();
  }
}

function syncReviewTourLabel() {
  const spec = ALL_PANEL_SPECS.find((s) => s.key === appState.activeTab) || ALL_PANEL_SPECS[0];
  const majorTitleEl = document.getElementById('workspace-major-title');
  if (majorTitleEl && spec) {
    majorTitleEl.textContent = spec.groupTitle;
  }
  const subLblEl = document.getElementById('review-step-label');
  if (subLblEl && spec) {
    subLblEl.textContent = spec.subLabel;
  }
}

function syncActiveNavigationState(tabKey, focusTabBtn = false) {
  const spec = ALL_PANEL_SPECS.find((s) => s.key === tabKey) || ALL_PANEL_SPECS[0];
  const resolvedTabKey = spec.key;
  const resolvedGroupKey = spec.groupKey;

  appState.activeTab = resolvedTabKey;
  appState.activeGroup = resolvedGroupKey;
  appState.lastSubTabByGroup[resolvedGroupKey] = resolvedTabKey;

  const majorButtons = Array.from(document.querySelectorAll('.major-nav-btn'));
  for (const btn of majorButtons) {
    if (btn.dataset.group === resolvedGroupKey) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  }

  renderSubtabsBar(resolvedGroupKey, resolvedTabKey, focusTabBtn);

  for (const item of ALL_PANEL_SPECS) {
    const panelEl = document.getElementById(`panel-${item.key}`);
    if (panelEl) panelEl.hidden = item.key !== resolvedTabKey;
  }
  syncReviewTourLabel();
}

function switchMajorGroup(groupKey, focusSubtab = false) {
  const group = MAJOR_MENU_GROUPS.find((g) => g.groupKey === groupKey);
  if (!group) return;
  const remembered = appState.lastSubTabByGroup[groupKey];
  const targetTab =
    group.tabs.some((t) => t.key === remembered) ? remembered : group.tabs[0].key;
  switchTab(targetTab, focusSubtab && group.tabs.length > 1);
}

function switchTab(tabKey, focusTabBtn = false) {
  if (appState.popupModalTabKey) {
    closeModuleDetailPopup(false);
  }
  setMobileSidebarOpen(false);
  syncActiveNavigationState(tabKey, focusTabBtn);
}

function bindEvents() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  themeBtn?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    themeBtn.textContent = next === 'dark' ? '밝은 화면' : '어두운 화면';
  });

  document.getElementById('floating-toast-close')?.addEventListener('click', () => {
    const toast = document.getElementById('floating-toast');
    if (toast) toast.hidden = true;
  });

  document.getElementById('btn-mobile-sidebar-toggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('left-sidebar');
    const isOpen = sidebar?.getAttribute('data-sidebar-open') === 'true';
    setMobileSidebarOpen(!isOpen);
    if (!isOpen) {
      document.getElementById(`major-nav-${appState.activeGroup}`)?.focus();
    }
  });

  document.getElementById('btn-close-mobile-sidebar')?.addEventListener('click', () => {
    setMobileSidebarOpen(false);
    document.getElementById('btn-mobile-sidebar-toggle')?.focus();
  });

  document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
    setMobileSidebarOpen(false);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1080) {
      setMobileSidebarOpen(false);
    }
  });

  document.getElementById('sidebar-company-card')?.addEventListener('click', () => {
    switchTab('settings-master', false);
  });

  document.getElementById('btn-quick-forms-jump')?.addEventListener('click', () => {
    switchTab('forms-center', false);
  });

  document.getElementById('btn-quick-settings-jump')?.addEventListener('click', () => {
    switchTab('settings-master', false);
  });

  document.getElementById('select-leave-basis')?.addEventListener('change', () => {
    syncFiscalControlState();
  });

  const majorNavButtons = Array.from(document.querySelectorAll('.major-nav-btn'));
  majorNavButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMajorGroup(btn.dataset.group, false);
    });
  });

  document.getElementById('btn-open-dashboard-popup')?.addEventListener('click', () => {
    openStandalonePopupWindow(null);
  });

  document.getElementById('btn-open-mobile-popup')?.addEventListener('click', () => {
    openMobilePopupWindow();
  });

  document.getElementById('btn-open-current-module-modal')?.addEventListener('click', (e) => {
    openModuleDetailPopup(appState.activeTab, e.currentTarget);
  });

  document.getElementById('module-popup-close-btn')?.addEventListener('click', () => {
    closeModuleDetailPopup(true);
  });

  document.getElementById('module-popup-detach-btn')?.addEventListener('click', () => {
    const targetTab = appState.popupModalTabKey || appState.activeTab;
    openStandalonePopupWindow(targetTab);
  });

  document.getElementById('popup-prev-btn')?.addEventListener('click', () => {
    const curKey = appState.popupModalTabKey || appState.activeTab;
    const idx = ALL_PANEL_SPECS.findIndex((s) => s.key === curKey);
    const prevIdx = (idx - 1 + ALL_PANEL_SPECS.length) % ALL_PANEL_SPECS.length;
    openModuleDetailPopup(ALL_PANEL_SPECS[prevIdx].key);
  });

  document.getElementById('popup-next-btn')?.addEventListener('click', () => {
    const curKey = appState.popupModalTabKey || appState.activeTab;
    const idx = ALL_PANEL_SPECS.findIndex((s) => s.key === curKey);
    const nextIdx = (idx + 1) % ALL_PANEL_SPECS.length;
    openModuleDetailPopup(ALL_PANEL_SPECS[nextIdx].key);
  });

  document.getElementById('popup-module-select')?.addEventListener('change', (e) => {
    const nextKey = e.currentTarget.value;
    if (ALL_PANEL_SPECS.some((s) => s.key === nextKey)) {
      openModuleDetailPopup(nextKey);
    }
  });

  document.getElementById('popup-preset-apply-btn')?.addEventListener('click', async (e) => {
    const selectEl = document.getElementById('popup-preset-select');
    const presetId = selectEl?.value || '';
    if (!presetId) {
      showBanner('적용할 사업장 규모 시나리오 프리셋을 먼저 선택해 주세요.', true);
      return;
    }
    try {
      const data = await apiPost('/api/simulate-company', { presetId }, e.currentTarget);
      updateSnapshot(data.snapshot);
      showBanner(`팝업 내 사업장 규모 프리셋 전환 완료: ${data.snapshot.company.companyName}`);
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('module-popup-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'module-popup-modal') closeModuleDetailPopup(true);
  });

  const simForm = document.getElementById('sim-form');
  simForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('apply-sim-btn');
    try {
      const payload = {
        companyName: document.getElementById('input-company-name').value,
        ksicMajor: document.getElementById('select-ksic').value,
        triggerDate: document.getElementById('input-trigger-date').value,
        hasMajorityUnion: document.getElementById('check-majority-union').checked,
        hasSubsidies: document.getElementById('check-subsidies').checked,
        headcountInput: {
          regularWorkers: Number(document.getElementById('input-regular-workers').value),
          partTimeWorkers: Number(document.getElementById('input-parttime-workers').value),
          dailyWorkerManDays: Number(document.getElementById('input-daily-mandays').value),
          dispatchedWorkers: Number(document.getElementById('input-dispatched-workers').value),
          operatingDays: Number(document.getElementById('input-operating-days').value),
        },
        policySettings: {
          leaveAccrualBasis: document.getElementById('select-leave-basis').value,
          fiscalYearStartMonthDay: document.getElementById('select-fiscal-start').value,
          leaveRoundingRule: document.getElementById('select-leave-rounding').value,
          leaveSettlementPolicy: document.getElementById('select-leave-settlement').value,
          weeklyWarnHours: Number(document.getElementById('input-weekly-warn').value),
          payDayLabel: document.getElementById('select-pay-day').value,
          withholdingTaxRatePct: Number(document.getElementById('select-tax-rate').value),
          nonTaxableMealLimit: Number(document.getElementById('input-meal-limit').value),
        },
      };
      const data = await apiPost('/api/simulate-company', payload, btn);
      updateSnapshot(data.snapshot);
      const p = data.snapshot.company.policySettings;
      showBanner(
        `환경 설정 저장 완료: 상시 ${data.snapshot.compliance.headcounts.lsaRegularCount}명 · 연차 [${formatLeaveBasisShort(p)}] · 급여 [${p.payDayLabel}, 원천세 ${p.withholdingTaxRatePct}%] 기준이 전 메뉴에 일괄 반영되었습니다.`
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  const recForm = document.getElementById('recruit-check-form');
  recForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = recForm.querySelector('button[type="submit"]');
    try {
      const data = await apiPost(
        '/api/validate-posting',
        {
          title: document.getElementById('rec-title').value,
          bodyText: document.getElementById('rec-body').value,
          weeklyHours: Number(document.getElementById('rec-hours').value),
          offeredMonthlyPay: Number(document.getElementById('rec-pay').value),
        },
        submitBtn
      );
      const r = data.result;
      const box = document.getElementById('recruit-check-result');
      box.replaceChildren(
        ...[
          h(
            'div',
            { className: 'mb-6' },
            h(
              'span',
              { className: r.passed ? 'tag tag-green' : 'tag tag-red' },
              r.passed ? '적법 통과 (공고 게시 가능)' : '법령 위반 위험 감지 (수정 필요)'
            )
          ),
          h(
            'div',
            {},
            `환산 통상시급(${r.wageCheck.monthlyRefHours}h 기준): ${fmtWon(r.wageCheck.offeredHourlyWage)} (최저임금 월 최소 ${fmtWon(r.wageCheck.requiredMinMonthlyPay)})`
          ),
          r.wageCheck.isBelowMinWage
            ? h('div', { className: 'text-danger-bold' }, '※ 최저임금법 제6조 미달! 제시 급여 상향이 필요합니다.')
            : null,
          ...r.violations.map((v) =>
            h(
              'div',
              { className: 'violation-item' },
              `[${v.severity === 'BLOCK' ? '금지차단' : '삭제권고'}] ${v.label} (${v.article}) — ${v.penaltyNote}`
            )
          ),
          ...r.autoAppendedClauses.map((c) => h('div', { className: 'clause-note' }, c)),
        ].filter(Boolean)
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('evt-worker')?.addEventListener('change', syncSelectedWorkerInputs);

  const evtForm = document.getElementById('worker-event-form');
  evtForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = evtForm.querySelector('button[type="submit"]');
    const empCode = document.getElementById('evt-worker').value;
    try {
      const data = await apiPost(
        '/api/update-worker-event',
        {
          empCode,
          overtimeHours: Number(document.getElementById('evt-ot').value),
          maxWeeklyWorkedHours: Number(document.getElementById('evt-peak-weekly').value),
          unusedLeavePayoutDays: Number(document.getElementById('evt-unused-leave').value),
          evalRaiseRatePct: Number(document.getElementById('evt-raise').value),
          requestedDisciplinaryCut: Number(document.getElementById('evt-cut').value),
          attendanceNoticeSent: document.getElementById('evt-notice').checked,
          defenseOpportunityGiven: document.getElementById('evt-defense').checked,
          committeeResolved: document.getElementById('evt-committee').checked,
          writtenNoticeDelivered: document.getElementById('evt-written').checked,
        },
        submitBtn
      );
      updateSnapshot(data.snapshot);
      const updatedLine = data.snapshot.payrollLines.find((l) => l.empCode === empCode);
      const box = document.getElementById('worker-event-result');
      if (updatedLine && box) {
        box.replaceChildren(
          h('div', { className: 'font-extrabold' }, `[${updatedLine.displayName}] 급여 파이프라인 반영 완료`),
          h('div', {}, `지급총액: ${fmtWon(updatedLine.grossPay)} / 실수령액: ${fmtWon(updatedLine.netPay)}`),
          h(
            'div',
            {},
            `적용 감봉액: ${fmtWon(updatedLine.disciplinaryCutApplied)} (제95조 초과 차단액: ${fmtWon(updatedLine.disciplinaryCutBlocked)})`
          ),
          ...updatedLine.warnings.map((w) =>
            h('div', { className: 'text-warn-bold' }, `• ${w.message}`)
          )
        );
      }
      showBanner(`[${empCode}] 근태·보상·징계 이벤트가 급여대장에 반영되었습니다.`);
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  const offForm = document.getElementById('offboard-form');
  offForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = offForm.querySelector('button[type="submit"]');
    try {
      const data = await apiPost(
        '/api/preview-offboarding',
        {
          resignReason: document.getElementById('off-reason').value,
          serviceDays: Number(document.getElementById('off-days').value),
          threeMonthWageTotal: Number(document.getElementById('off-3m-wage').value),
          ordinaryHourlyWage: Number(document.getElementById('off-hourly').value),
          advanceNoticeDaysGiven: Number(document.getElementById('off-notice-days').value),
          writtenDismissalNoticeGiven: document.getElementById('off-written-notice').checked,
        },
        submitBtn
      );
      const r = data.result;
      const box = document.getElementById('offboard-result');
      box.replaceChildren(
        h(
          'div',
          { className: 'mb-4-bold' },
          `통합 청산 총액: ${fmtWon(r.totalSettlementGross)} (법정 지급기한: ${r.paymentDueDate}, 14일 이내)`
        ),
        h(
          'div',
          {},
          `3개월 평균일급 ${fmtWon(r.rawAvgDailyWage)} vs 통상일급 ${fmtWon(r.ordinaryDailyWage)} → ${
            r.ordinaryFloorApplied ? '통상임금 하한보장(근기법 제2조②) 적용!' : '평균임금 적용'
          }`
        ),
        h(
          'div',
          {},
          `퇴직금: ${fmtWon(r.severancePay)} | 미사용연차: ${fmtWon(r.unusedLeavePayout)} | 해고예고수당: ${fmtWon(r.dismissalNoticePay)}`
        ),
        ...r.alerts.map((a) =>
          h(
            'div',
            {
              className: `${a.level === 'CRITICAL' ? 'tag tag-red' : 'tag tag-amber'} alert-block`,
            },
            a.message
          )
        )
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('toggle-empty-roster')?.addEventListener('change', async (e) => {
    const checkbox = e.currentTarget;
    try {
      const res = await apiPost(
        '/api/simulate-company',
        { emptyRosterMode: checkbox.checked },
        checkbox
      );
      updateSnapshot(res.snapshot);
      showBanner(checkbox.checked ? '빈 명부(0명) 화면으로 전환했습니다.' : '지급대상자 명부를 표시합니다.');
    } catch (err) {
      checkbox.checked = !checkbox.checked;
      showBanner(err.message, true);
    }
  });

  document.getElementById('bulk-workers-btn')?.addEventListener('click', async (e) => {
    try {
      const res = await apiPost(
        '/api/simulate-company',
        { emptyRosterMode: false, bulkRosterMode: true },
        e.currentTarget
      );
      updateSnapshot(res.snapshot);
      showBanner('대량 지급대상자 명부(50명)가 생성되어 급여대장에 반영되었습니다.');
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('reset-workers-btn')?.addEventListener('click', async (e) => {
    try {
      const res = await apiPost(
        '/api/simulate-company',
        { emptyRosterMode: false, resetWorkers: true },
        e.currentTarget
      );
      updateSnapshot(res.snapshot);
      showBanner('기본 샘플 지급대상자 명부(6명)로 초기화되었습니다.');
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('doc-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'doc-modal') closeModal();
  });
  document.getElementById('modal-copy-btn')?.addEventListener('click', async () => {
    const text = document.getElementById('modal-body')?.textContent || '';
    const fb = document.getElementById('copy-feedback');
    try {
      await navigator.clipboard.writeText(text);
      if (fb) fb.textContent = '클립보드에 전문이 복사되었습니다.';
    } catch {
      if (fb) fb.textContent = '본문 영역을 선택해 복사(Ctrl+C)하실 수 있습니다.';
    }
  });

  function confirmStaticDemoInputOnce() {
    if (window.__MHR_STATIC_DEMO__ !== true || appState.demoInputConfirmed) {
      return true;
    }
    if (typeof window.confirm === 'function') {
      const ok = window.confirm(
        '공개 시뮬레이터 데모 환경입니다. 실제 개인정보가 포함된 원본 서류·데이터가 아닌 테스트·샘플 정보만 입력하시겠습니까?'
      );
      if (!ok) return false;
    }
    appState.demoInputConfirmed = true;
    return true;
  }

  // 멀티파일 일괄 업로드 -> 서버 자동 문서분류 및 교차검증 스테이징
  document.getElementById('multi-doc-file-input')?.addEventListener('change', async (e) => {
    const inputEl = e.currentTarget;
    const labelEl = inputEl.closest('label');
    const selected = Array.from(inputEl.files || []);
    if (selected.length === 0) return;
    if (!confirmStaticDemoInputOnce()) {
      inputEl.value = '';
      return;
    }
    inputEl.disabled = true;
    inputEl.setAttribute('aria-busy', 'true');
    labelEl?.setAttribute('aria-busy', 'true');
    try {
      const maskClientPii = (txt) =>
        String(txt || '')
          .replace(/\b(\d{6})-[1-4]\d{6}\b/g, '$1-*******')
          .replace(/\b(01[016789])-\d{3,4}-(\d{4})\b/g, '$1-****-$2');
      const files = [];
      for (const f of selected.slice(0, 10)) {
        const rawText = await f.text();
        files.push({ fileName: f.name, content: maskClientPii(rawText) });
      }
      const res = await apiPost('/api/onboarding/stage', { files });
      for (const item of res.staging.classifiedFiles || []) {
        const matched = files.find((x) => x.fileName === item.fileName);
        if (!matched) continue;
        if (item.docKind === 'BUSINESS_REGISTRATION') {
          const n = document.getElementById('doc-biz-reg');
          if (n) n.value = matched.content;
        } else if (item.docKind === 'COMPANY_BROCHURE') {
          const n = document.getElementById('doc-brochure');
          if (n) n.value = matched.content;
        } else if (item.docKind === 'HEALTH_INSURANCE') {
          const n = document.getElementById('doc-nhis-csv');
          if (n) n.value = matched.content;
        } else if (item.docKind === 'EMPLOYMENT_INSURANCE') {
          const n = document.getElementById('doc-ei-csv');
          if (n) n.value = matched.content;
        }
      }
      renderOnboardingStagePreview(res.staging);
      showBanner(`업로드 파일 ${files.length}개 자동 분류 및 건보↔고보 교차검증이 완료되었습니다.`);
    } catch (err) {
      showBanner(err.message, true);
    } finally {
      inputEl.disabled = false;
      inputEl.removeAttribute('aria-busy');
      labelEl?.removeAttribute('aria-busy');
      inputEl.value = '';
    }
  });

  document.getElementById('btn-stage-onboarding')?.addEventListener('click', async (e) => {
    if (!confirmStaticDemoInputOnce()) return;
    try {
      const res = await apiPost(
        '/api/onboarding/stage',
        collectDocEditorPayload(),
        e.currentTarget
      );
      renderOnboardingStagePreview(res.staging);
      showBanner(
        `1단계 교차검증 완료: 재직 ${res.staging.activeWorkers.length}명 · 퇴사자 원장 ${res.staging.offboardedWorkers.length}명 · 대사알림 ${res.staging.reconciliationAlerts.length}건`
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('btn-commit-onboarding')?.addEventListener('click', async (e) => {
    if (!confirmStaticDemoInputOnce()) return;
    try {
      const res = await apiPost(
        '/api/onboarding/commit',
        collectDocEditorPayload(),
        e.currentTarget
      );
      renderOnboardingStagePreview(res.staging);
      updateSnapshot(res.snapshot);
      showBanner(
        `일괄 개통 완료! [${res.committed.companyName}] 법정모듈(${res.committed.autoActivatedModulesCount}개)·재직급여(${res.committed.activeWorkersCount}명)·퇴사자원장(${res.committed.offboardedWorkersCount}명)·모바일 앱이 동시 연결되었습니다.`
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('btn-preview-exit-pledge')?.addEventListener('click', (e) => {
    openDocumentPreview('DOC_EXIT_SECURITY_NONCOMPETE', e.currentTarget);
  });

  document.getElementById('live-offboard-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-live-offboard');
    const empCode = document.getElementById('live-off-emp')?.value || '';
    if (!empCode) {
      showBanner('퇴사 처리할 재직자를 선택해 주세요.', true);
      return;
    }
    try {
      const res = await apiPost(
        '/api/offboard-worker',
        {
          empCode,
          lastWorkDate: document.getElementById('live-off-date')?.value || '2026-11-15',
          resignReason: document.getElementById('live-off-reason')?.value || 'VOLUNTARY',
          unusedLeaveDays: Number(document.getElementById('live-off-leave')?.value || 0),
        },
        btn
      );
      updateSnapshot(res.snapshot);
      showBanner(
        `[${empCode}] 퇴사자 통합 원장 편입 완료 (14일 금품청산 기한: ${res.offboardedRecord.settlementDueDate}, 모바일 세션 ${res.revokedSessionCount}건 즉시 차단)`
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.addEventListener('keydown', (e) => {
    const docModal = document.getElementById('doc-modal');
    const modPopup = document.getElementById('module-popup-modal');
    const sidebar = document.getElementById('left-sidebar');
    const activeModal =
      docModal && !docModal.hidden
        ? docModal
        : modPopup && !modPopup.hidden
          ? modPopup
          : null;
    if (!activeModal) {
      if (e.key === 'Escape' && sidebar?.getAttribute('data-sidebar-open') === 'true') {
        e.preventDefault();
        setMobileSidebarOpen(false);
        document.getElementById('btn-mobile-sidebar-toggle')?.focus();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeModal === docModal) closeModal();
      else closeModuleDetailPopup(true);
      return;
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(
        activeModal.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

async function renderPcAuthGateIfNeeded() {
  const gate = document.getElementById('pc-auth-gate');
  if (!gate) return;
  gate.hidden = false;

  let mBoot = null;
  try {
    const mRes = await fetch('/api/mobile/bootstrap', { credentials: 'same-origin' });
    if (mRes.ok) mBoot = await mRes.json();
  } catch {
    mBoot = null;
  }

  const ceoDemo = mBoot?.demoAccounts?.find((a) => a.loginId === 'ceo' && a.demoPassword && a.demoPin);
  const actions = h(
    'div',
    { className: 'auth-gate-actions' },
    h(
      'a',
      { href: './mobile.html', className: 'btn btn-secondary' },
      '모바일 앱(./mobile.html)에서 직접 2FA 로그인'
    )
  );

  if (ceoDemo && mBoot?.loginCsrfToken) {
    actions.prepend(
      h(
        'button',
        {
          type: 'button',
          id: 'btn-pc-demo-unlock',
          className: 'btn btn-primary',
          onClick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            try {
              const step1 = await fetch('/api/mobile/login', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': mBoot.loginCsrfToken,
                },
                body: JSON.stringify({
                  loginId: 'ceo',
                  password: ceoDemo.demoPassword,
                  deviceLabel: 'PC 통합관리자 콘솔',
                  platformType: 'DESKTOP_PWA',
                }),
              });
              const s1Data = await step1.json();
              if (!step1.ok) throw new Error(s1Data.error || '1차 인증 실패');

              const step2 = await fetch('/api/mobile/mfa/verify', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': s1Data.session.csrfToken,
                },
                body: JSON.stringify({ method: 'PIN', pin: ceoDemo.demoPin }),
              });
              const s2Data = await step2.json();
              if (!step2.ok) throw new Error(s2Data.error || '2차 PIN 인증 실패');

              await loadAuthorizedBootstrap();
              showBanner('대표이사(CEO) 2차 인증 세션이 활성화되어 PC 통합 대시보드가 열렸습니다.');
            } catch (err) {
              showBanner(err.message, true);
            } finally {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
            }
          },
        },
        '대표이사(CEO) 체험 2FA 세션으로 PC 대시보드 즉시 열기'
      )
    );
  }

  gate.replaceChildren(
    h(
      'div',
      {},
      h('h3', { className: 'auth-gate-title' }, '관리자 2차 인증(2FA) 보호 구역'),
      h(
        'p',
        { className: 'auth-gate-desc' },
        '전사 인사·급여·문서 온보딩·퇴사자 원장은 대표이사(CEO) 또는 인사관리자(HR_ADMIN) 2차 인증 세션 쿠키가 필요합니다.'
      )
    ),
    actions
  );
}

async function tryAutoDemoUnlockForPopup() {
  if (appState.autoUnlockAttempted) return false;
  appState.autoUnlockAttempted = true;
  try {
    const mRes = await fetch('/api/mobile/bootstrap', { credentials: 'same-origin' });
    if (!mRes.ok) return false;
    const mBoot = await mRes.json();
    const ceoDemo = mBoot?.demoAccounts?.find((a) => a.loginId === 'ceo' && a.demoPassword && a.demoPin);
    if (!ceoDemo || !mBoot?.loginCsrfToken) return false;

    const step1 = await fetch('/api/mobile/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': mBoot.loginCsrfToken,
      },
      body: JSON.stringify({
        loginId: 'ceo',
        password: ceoDemo.demoPassword,
        deviceLabel: '전용도메인 팝업콘솔',
        platformType: 'DESKTOP_PWA',
      }),
    });
    if (!step1.ok) return false;
    const s1Data = await step1.json();

    const step2 = await fetch('/api/mobile/mfa/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': s1Data.session.csrfToken,
      },
      body: JSON.stringify({ method: 'PIN', pin: ceoDemo.demoPin }),
    });
    return step2.ok;
  } catch {
    return false;
  }
}

async function loadAuthorizedBootstrap() {
  const params = new URLSearchParams(window.location.search);
  const isStaticPagesDemo =
    window.location.hostname.endsWith('.github.io') || window.__MHR_STATIC_DEMO__ === true;
  const isPopupLaunch =
    params.get('popup') === '1' ||
    params.get('autounlock') === '1' ||
    params.get('openmodal') === '1' ||
    isStaticPagesDemo;

  let res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  if (!res.ok && (res.status === 401 || res.status === 403) && isPopupLaunch) {
    const unlocked = await tryAutoDemoUnlockForPopup();
    if (unlocked) {
      res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
    }
  }

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      await renderPcAuthGateIfNeeded();
      showBanner(
        '전사 급여·인사 관리자 대시보드는 대표이사(CEO) 또는 인사관리자(HR_ADMIN) 2차 인증 완료 세션이 필요합니다.',
        true
      );
      return false;
    }
    throw new Error(data.error || '초기화 실패');
  }

  appState.csrfToken = data.csrfToken;
  updateSnapshot(data.snapshot);

  const requestedTab = params.get('tab');
  const requestedGroup = params.get('group');
  if (requestedTab && ALL_PANEL_SPECS.some((s) => s.key === requestedTab)) {
    switchTab(requestedTab, false);
  } else if (requestedGroup && MAJOR_MENU_GROUPS.some((g) => g.groupKey === requestedGroup)) {
    switchMajorGroup(requestedGroup, false);
  } else {
    syncActiveNavigationState(appState.activeTab, false);
  }
  syncPopupModuleSelectOptions();
  if (params.get('openmodal') === '1') {
    openModuleDetailPopup(appState.activeTab);
  }

  document.getElementById('recruit-check-form')?.dispatchEvent(new Event('submit'));
  document.getElementById('offboard-form')?.dispatchEvent(new Event('submit'));
  if (!appState.latestStaging) {
    apiPost('/api/onboarding/stage', collectDocEditorPayload())
      .then((r) => renderOnboardingStagePreview(r.staging))
      .catch(() => {});
  }
  connectPcLiveSyncStream();
  return true;
}

async function connectPcLiveSyncStream() {
  const refreshFromPeer = async () => {
    try {
      const res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
      if (!res.ok) return;
      const payload = await res.json();
      appState.csrfToken = payload.csrfToken;
      updateSnapshot(payload.snapshot);
    } catch {
      // ignore transient refresh failure
    }
  };

  if (!appState.pcSyncChannel && typeof BroadcastChannel === 'function') {
    try {
      const ch = new BroadcastChannel('modular-hr-live-sync');
      ch.onmessage = () => {
        refreshFromPeer();
      };
      appState.pcSyncChannel = ch;
    } catch {
      appState.pcSyncChannel = null;
    }
  }

  if (!appState.pcSseCleanupBound) {
    appState.pcSseCleanupBound = true;
    window.addEventListener('mhr-live-sync', refreshFromPeer);
    const closeRealtimeHandles = () => {
      if (appState.pcSse) {
        appState.pcSse.close();
        appState.pcSse = null;
      }
      if (appState.pcSyncChannel) {
        try {
          appState.pcSyncChannel.close();
        } catch {
          // ignore
        }
        appState.pcSyncChannel = null;
      }
    };
    window.addEventListener('pagehide', closeRealtimeHandles);
    window.addEventListener('pageshow', (ev) => {
      if (ev.persisted) {
        connectPcLiveSyncStream();
      }
    });
  }

  if (appState.pcSse || typeof EventSource === 'undefined') return;
  try {
    const bootRes = await fetch('/api/mobile/bootstrap', { credentials: 'same-origin' });
    if (!bootRes.ok) return;
    const bootData = await bootRes.json();
    if (bootData.session?.authStage !== 'AUTHENTICATED') return;

    const es = new EventSource('/api/mobile/stream');
    appState.pcSse = es;
    es.addEventListener('sync', refreshFromPeer);
    es.addEventListener('notification', refreshFromPeer);
    es.onerror = () => {
      es.close();
      if (appState.pcSse === es) {
        appState.pcSse = null;
      }
      setTimeout(() => {
        connectPcLiveSyncStream();
      }, 3000);
    };
  } catch {
    appState.pcSse = null;
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('popup') === '1') {
    document.documentElement.setAttribute('data-popup-mode', 'true');
  }
  const isStaticDemo =
    window.location.hostname.endsWith('.github.io') || window.__MHR_STATIC_DEMO__ === true;
  const domainPill = document.getElementById('active-domain-pill');
  if (domainPill) {
    const hostLabel = window.location.host || 'modular-hr.localhost:4330';
    if (isStaticDemo) {
      domainPill.className = 'tag tag-amber';
      domainPill.textContent = `${hostLabel} · 시뮬레이터 데모 (실개인정보 입력 금지)`;
    } else {
      domainPill.textContent =
        params.get('popup') === '1'
          ? `${hostLabel} · 독립 팝업 콘솔 실행중`
          : `${hostLabel} · 전용 도메인 연결됨`;
    }
  }

  bindEvents();
  try {
    await loadAuthorizedBootstrap();
  } catch (err) {
    showBanner(`초기 데이터를 불러오지 못했습니다: ${err.message}`, true);
  }
}

init();
