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
  lastFocusedBeforeAttModal: null,
  popupModalTabKey: null,
  popupRestoreSlot: null,
  autoUnlockAttempted: false,
  demoInputConfirmed: false,
  pcSse: null,
  pcSseCleanupBound: false,
  pcSyncChannel: null,
  toastTimer: null,
  selectedEmpCode: 'EMP-201',
  selectedAttDate: '2026-11-11',
  starredOnlyFilter: false,
  genericStarFilter: {},
  onboardingDocEmpCode: 'EMP-203',
  onboardingActiveTpl: 'DOC_EMPLOYMENT_CONTRACT',
  onboardingCompareMode: false,
  onboardingDraftPerson: null,
  onboardingSigState: { boundKey: '', signerName: '', dataUrl: '', consentConfirmed: false },
  onboardingDocTimer: null,
  onboardingReqSeq: 0,
  formsSelectedTpl: 'DOC_EMPLOYMENT_CONTRACT',
  formsViewMode: 'COMPARE',
  formsDraftPerson: null,
  formsSigState: { signerName: '', dataUrl: '', consentConfirmed: false },
  expandedArchivedDocs: {},
  formsDocTimer: null,
  formsReqSeq: 0,
  showCodeDiffMarks: true,
};

const RECENT_CODE_CHANGES = [
  {
    id: 'CHG-UNIVERSAL-MARKS',
    menuGroup: 'hr',
    badge: '변경 1 · 전 영역 번호·체크·별표',
    desc: '인사·채용·계약·징계·고충·퇴사·연차·서식·법정 모든 인원·리스트에 No. 번호 · ☐ 네모 체크 · ★ 별표 전면 적용',
    btnLabel: '징계·고충 체크 보기',
    action: () => {
      switchTab('ops-discipline', false);
    },
  },
  {
    id: 'CHG-ONBOARDING-3DOCS',
    menuGroup: 'hr',
    badge: '변경 2 · 입사 3종 서식 자동연결·서명',
    desc: '채용·입사 시 근로계약서·보안서약서·개인정보동의서 자동 오픈 + 좌측 개인정보 실시간 기입 + 자필 전자서명 연결',
    btnLabel: '입사 서식·서명 열기',
    action: () => {
      switchTab('ops-recruit', false);
      document.getElementById('onboarding-doc-studio')?.scrollIntoView({ block: 'start' });
    },
  },
  {
    id: 'CHG-FORMS-SPLIT-STUDIO',
    menuGroup: 'legal',
    badge: '변경 3 · 서식 좌우 분할·변경비교·이름조회',
    desc: '서식·법정 클릭 시 오른쪽 화면에 기본양식↔변경양식 실시간 비교 및 사람 이름별 반영·서명 내역 즉시 확인',
    btnLabel: '분할 서식함 열기',
    action: () => {
      switchTab('forms-center', false);
    },
  },
  {
    id: 'CHG-LEAVE-ALUMNI-MARKS',
    menuGroup: 'leave',
    badge: '변경 4 · 퇴사·연차 전 리스트 동기화',
    desc: '퇴사(은퇴) 관리 원장·연차 사용이력·연차 사용촉진·육아보호 리스트까지 번호·체크·별표 일괄 적용',
    btnLabel: '연차·촉진 보기',
    action: () => {
      switchTab('ops-leave-promo', false);
    },
  },
];

const MAJOR_MENU_GROUPS = [
  {
    groupKey: 'home',
    groupTitle: '대시보드',
    tabs: [{ key: 'ops-home', label: '요약' }],
  },
  {
    groupKey: 'hr',
    groupTitle: '인사 관리',
    tabs: [
      { key: 'ops-org', label: '직원 명부' },
      { key: 'ops-recruit', label: '채용 · 계약' },
      { key: 'ops-discipline', label: '징계 · 고충' },
      { key: 'alumni', label: '퇴사 관리' },
    ],
  },
  {
    groupKey: 'attendance',
    groupTitle: '근태 관리',
    tabs: [
      { key: 'ops-attendance', label: '출퇴근 · 근로시간' },
      { key: 'lifecycle', label: '급여 · 퇴직 계산기' },
    ],
  },
  {
    groupKey: 'leave',
    groupTitle: '연차 관리',
    tabs: [
      { key: 'ops-leave', label: '연차 현황' },
      { key: 'ops-leave-promo', label: '사용촉진 · 육아' },
    ],
  },
  {
    groupKey: 'payroll',
    groupTitle: '급여 관리',
    tabs: [
      { key: 'payroll', label: '급여 대장' },
      { key: 'ops-eval', label: '평가 · 인상 반영' },
    ],
  },
  {
    groupKey: 'legal',
    groupTitle: '서식 · 법정',
    tabs: [
      { key: 'forms-center', label: '표준 서식함' },
      { key: 'ops-statutory', label: '노사 · 안전 · 교육' },
      { key: 'compliance', label: '신고 일정' },
      { key: 'floor', label: '적용 모듈' },
    ],
  },
  {
    groupKey: 'settings',
    groupTitle: '환경 설정',
    tabs: [
      { key: 'settings-master', label: '기본 · 연차 · 급여 설정' },
      { key: 'onboarding', label: '문서 자동입력' },
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
    if (isError) {
      banner.hidden = false;
      banner.className = 'status-banner tag-red';
      banner.textContent = message;
    } else {
      banner.hidden = true;
      banner.textContent = '';
    }
  }

  if (toast && toastText) {
    toast.dataset.error = String(Boolean(isError));
    toastText.textContent = message;
    toast.hidden = false;
    if (appState.toastTimer) clearTimeout(appState.toastTimer);
    if (!isError) {
      appState.toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 3200);
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
  setVal('input-biz-reg-no', company.bizRegNo || '');
  setVal('input-ceo-name', company.ceoName || '');
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
  const leaveBasisLabel = formatLeaveBasisShort(policy);

  const cards = [
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '상시근로자'),
      h('div', { className: 'kpi-value' }, `${hc.lsaRegularCount}명`),
      h('div', { className: 'kpi-sub' }, hc.is5OrMore ? '5인 이상 기준 적용' : '5인 미만 기준 적용')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '자동 활성 모듈'),
      h('div', { className: 'kpi-value' }, `${autoCount}개`),
      h('div', { className: 'kpi-sub' }, `산안법 관리 ${hc.oshRegularCount}명`)
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '연차 · 근태 기준'),
      h('div', { className: 'kpi-value' }, leaveBasisLabel),
      h('div', { className: 'kpi-sub' }, `주 ${policy.weeklyWarnHours ?? 48}h 주의 기준`)
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '급여 · 세율 기준'),
      h('div', { className: 'kpi-value' }, policy.payDayLabel || '매월 25일'),
      h('div', { className: 'kpi-sub' }, `원천세 ${policy.withholdingTaxRatePct ?? 100}%`)
    ),
  ];

  const strip = document.getElementById('headcount-kpi-strip');
  if (strip) strip.replaceChildren(...cards);

  const compactLine = document.getElementById('compact-workplace-summary');
  if (compactLine) {
    compactLine.textContent = `상시 ${hc.lsaRegularCount}명 · ${leaveBasisLabel} · ${policy.payDayLabel || '매월 25일'}`;
  }

  const sbName = document.getElementById('sidebar-company-name');
  if (sbName) sbName.textContent = snapshot.company.companyName;
  const sbMeta = document.getElementById('sidebar-company-meta');
  if (sbMeta) {
    sbMeta.textContent = `상시 ${hc.lsaRegularCount}명 (${hc.is5OrMore ? '5인 이상' : '5인 미만'}) · ${leaveBasisLabel}`;
  }
}

function renderMonthlyChangeBannerAndScaleBox(snapshot) {
  const notice = snapshot.monthlyStartNotice;
  const banner = document.getElementById('monthly-change-banner');
  const scaleBox = document.getElementById('settings-scale-check-box');

  const applyScaleQuick = async (targetRegularCount, triggerBtn) => {
    try {
      const res = await apiPost(
        '/api/simulate-company',
        {
          headcountInput: {
            regularWorkers: targetRegularCount,
            partTimeWorkers: 0,
            dailyWorkerManDays: 0,
            dispatchedWorkers: 0,
            operatingDays: 22,
          },
          resetPeak: true,
        },
        triggerBtn
      );
      updateSnapshot(res.snapshot);
      const nextN = res.snapshot.monthlyStartNotice;
      showBanner(
        `사업장 규모 변경 적용: [${nextN.scaleBadge}] (상시 ${nextN.lsaRegularCount}명) — ${nextN.monthStartDate} 월초 변경 표시가 활성화되었습니다.`
      );
    } catch (err) {
      showBanner(err.message, true);
    }
  };

  if (banner) {
    if (!notice || !notice.hasChanges) {
      banner.hidden = true;
      banner.replaceChildren();
    } else {
      banner.hidden = false;
      banner.className = notice.checked
        ? 'monthly-change-banner is-checked-done'
        : 'monthly-change-banner';
      banner.replaceChildren(
        h(
          'div',
          { className: 'monthly-change-main' },
          h(
            'div',
            { className: 'monthly-change-badges' },
            h(
              'span',
              {
                className: notice.checked
                  ? 'tag tag-green'
                  : notice.scaleTransitioned
                    ? 'tag tag-red'
                    : 'tag tag-amber',
              },
              `★ ${notice.monthStartBadgeText}`
            ),
            h(
              'span',
              { className: notice.is5OrMore ? 'tag tag-blue' : 'tag tag-amber' },
              `${notice.scaleBadge} (상시 ${notice.lsaRegularCount}명)`
            ),
            h('span', { className: 'tag tag-gray' }, notice.scaleRuleSummary)
          ),
          h(
            'ul',
            { className: 'monthly-change-reasons' },
            ...notice.changeReasons.map((reason) => h('li', {}, reason))
          )
        ),
        h(
          'div',
          { className: 'step-pill-group' },
          h(
            'button',
            {
              type: 'button',
              className: notice.checked ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
              'aria-pressed': String(Boolean(notice.checked)),
              onClick: (e) =>
                runOpsAction(
                  {
                    actionType: 'ACK_MONTHLY_CHANGE_NOTICE',
                    checked: !notice.checked,
                    expectedSignature: notice.signature,
                  },
                  e.currentTarget
                ),
            },
            notice.checked
              ? `☑ 월초(${notice.monthStartDate}) 변화 확인완료`
              : `☐ 월초(${notice.monthStartDate}) 변화 확인 체크`
          )
        )
      );
    }
  }

  if (scaleBox && notice) {
    scaleBox.className = 'settings-scale-check-box code-diff-box';
    const is5 = Boolean(notice.is5OrMore);
    scaleBox.replaceChildren(
      h(
        'div',
        { className: 'step-pill-group' },
        h('span', { className: 'code-diff-pill' }, '변경됨 · 5인 미만/이상 자동 판정 및 월초 표시 연동')
      ),
      h(
        'div',
        { className: 'scale-check-grid' },
        h(
          'div',
          { className: !is5 ? 'scale-check-card is-active-scale' : 'scale-check-card' },
          h(
            'div',
            { className: 'scale-check-head' },
            h('span', {}, `${!is5 ? '☑' : '☐'} 5인 미만 사업장`),
            h('span', { className: !is5 ? 'tag tag-amber' : 'tag tag-gray' }, !is5 ? `현재 적용 (상시 ${notice.lsaRegularCount}명)` : '미적용')
          ),
          h(
            'p',
            { className: 'scale-check-desc' },
            '연장·야간·휴일 가산수당 미적용(1.0배 정산) · 법정 연차휴가 의무 제외 · 해고제한 일부 제외'
          ),
          h(
            'button',
            {
              type: 'button',
              className: !is5 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
              'aria-pressed': String(!is5),
              onClick: (e) => applyScaleQuick(4, e.currentTarget),
            },
            !is5 ? '5인 미만(4인) 적용중' : '5인 미만(4인)으로 전환'
          )
        ),
        h(
          'div',
          { className: is5 ? 'scale-check-card is-active-scale' : 'scale-check-card' },
          h(
            'div',
            { className: 'scale-check-head' },
            h('span', {}, `${is5 ? '☑' : '☐'} 5인 이상 사업장`),
            h('span', { className: is5 ? 'tag tag-blue' : 'tag tag-gray' }, is5 ? `현재 적용 (상시 ${notice.lsaRegularCount}명)` : '미적용')
          ),
          h(
            'p',
            { className: 'scale-check-desc' },
            '연장·야간·휴일 50%·100% 가산수당 자동 반영 · 법정 연차휴가 및 법정공휴일 유급 적용'
          ),
          h(
            'button',
            {
              type: 'button',
              className: is5 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
              'aria-pressed': String(is5),
              onClick: (e) => applyScaleQuick(Math.max(10, notice.lsaRegularCount >= 5 ? notice.lsaRegularCount : 10), e.currentTarget),
            },
            is5 ? '5인 이상 적용중' : '5인 이상(10인)으로 전환'
          )
        )
      ),
      h(
        'div',
        { className: 'ops-section-head' },
        h(
          'div',
          { className: 'step-pill-group' },
          h(
            'span',
            { className: notice.hasChanges ? 'tag tag-amber' : 'tag tag-green' },
            notice.hasChanges
              ? `★ ${notice.monthStartBadgeText} (${notice.checked ? '확인 체크 완료' : '확인 체크 필요'})`
              : `${notice.monthStartDate} 월초 기준 변동 없음 (${notice.scaleBadge})`
          )
        ),
        notice.hasChanges
          ? h(
              'button',
              {
                type: 'button',
                className: notice.checked ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
                'aria-pressed': String(Boolean(notice.checked)),
                onClick: (e) =>
                  runOpsAction(
                    {
                      actionType: 'ACK_MONTHLY_CHANGE_NOTICE',
                      checked: !notice.checked,
                      expectedSignature: notice.signature,
                    },
                    e.currentTarget
                  ),
              },
              notice.checked ? '☑ 변화 확인 완료' : '☐ 변화 확인 체크'
            )
          : null
      )
    );
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
    const indexedFilings = compliance.statutoryFilings.map((f, idx) => ({ ...f, _rowNo: idx + 1 }));
    const visibleFilings = applyGenericStarFilter(
      snapshot,
      'filings',
      indexedFilings,
      (f) => f.id
    );
    const toolbar = h(
      'div',
      { className: 'ops-section-head' },
      h('span', { className: 'cell-dept-name' }, '관공서 신고·제정 과제 체크 및 별표 관리'),
      renderGenericSyncControls(
        snapshot,
        'filings',
        indexedFilings,
        (f) => f.id,
        renderComplianceTab,
        '건'
      )
    );
    const cards =
      visibleFilings.length === 0
        ? [h('div', { className: 'empty-state' }, '표시할 별표(★) 신고 과제가 없습니다.')]
        : visibleFilings.map((f) =>
            h(
              'article',
              { className: 'filing-card' },
              h(
                'div',
                { className: 'filing-header' },
                renderGenericInlineMark(snapshot, 'filings', f.id, f._rowNo, f.title),
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
    filingsList.replaceChildren(toolbar, ...cards);
  }

  const qGrid = document.getElementById('quarterly-grid');
  if (qGrid) {
    const qCards = compliance.quarterlySchedule.map((q, qIdx) =>
      h(
        'div',
        { className: 'quarter-card' },
        h('h4', { className: 'quarter-title' }, q.quarter),
        ...q.items.map((item, iIdx) =>
          h(
            'div',
            { className: 'quarter-item' },
            h(
              'div',
              { className: 'flex-between-tight' },
              renderGenericInlineMark(
                snapshot,
                'qsched',
                `${qIdx + 1}-${iIdx + 1}`,
                iIdx + 1,
                item.title
              ),
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
          h(
            'option',
            { value: w.empCode },
            `No.${w.rowNo ?? 1} [${w.empCode}] ${w.displayName} (${w.deptName})`
          )
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
   전 메뉴 공통 마스터 사원 식별 셀 (체크박스 ☐ · 별표 ★ · 넘버링 No. · 사번 · 이름 동기화)
   ========================================================================== */

function shiftYearMonth(ym, deltaMonths) {
  const m = String(ym || '2026-11').match(/^(\d{4})-(\d{2})$/);
  const baseYear = m ? Number(m[1]) : 2026;
  const baseMonthIdx = m ? Number(m[2]) - 1 : 10;
  const d = new Date(Date.UTC(baseYear, baseMonthIdx + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function resolveSelectedWorkerCode(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  if (rows.some((r) => r.empCode === appState.selectedEmpCode)) {
    return appState.selectedEmpCode;
  }
  appState.selectedEmpCode = rows[0].empCode;
  return appState.selectedEmpCode;
}

function applyStarFilter(rows) {
  if (!appState.starredOnlyFilter) return rows;
  return rows.filter((r) => r.starred);
}

function renderRosterSyncControls(allRows, rerenderCurrent) {
  const checkedCount = allRows.filter((r) => r.checked).length;
  const starredCount = allRows.filter((r) => r.starred).length;
  return h(
    'div',
    { className: 'step-pill-group' },
    h(
      'span',
      { className: 'tag tag-gray' },
      `총 ${allRows.length}명 · 체크 ${checkedCount} · ★ ${starredCount}`
    ),
    h(
      'button',
      {
        type: 'button',
        className: appState.starredOnlyFilter ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
        'aria-pressed': String(appState.starredOnlyFilter),
        onClick: () => {
          appState.starredOnlyFilter = !appState.starredOnlyFilter;
          if (appState.snapshot && typeof rerenderCurrent === 'function') {
            rerenderCurrent(appState.snapshot);
          }
        },
      },
      appState.starredOnlyFilter ? '★ 별표 필터 해제' : '★ 별표만 보기'
    )
  );
}

function renderMasterSelectHeaderTh(allRows, tableLabel) {
  const allChecked = allRows.length > 0 && allRows.every((r) => r.checked);
  return h(
    'th',
    { scope: 'col' },
    h(
      'div',
      { className: 'master-mark-wrap' },
      h(
        'label',
        { className: 'row-check-label' },
        h('input', {
          type: 'checkbox',
          className: 'row-check-input',
          checked: allChecked,
          disabled: allRows.length === 0,
          'aria-label': `${tableLabel} 전체 직원 체크 선택`,
          onChange: (e) => {
            e.stopPropagation();
            runOpsAction(
              {
                actionType: 'TOGGLE_ALL_WORKER_CHECK',
                empCodes: allRows.map((r) => r.empCode),
                checked: e.currentTarget.checked,
              },
              e.currentTarget
            );
          },
        })
      ),
      h('span', {}, '★ · No.')
    )
  );
}

function renderMasterMarkTd(row) {
  const rowNo = row.rowNo ?? 1;
  const isStarred = Boolean(row.starred);
  return h(
    'td',
    { 'data-label': '확인 · 별표 · 번호', onClick: (e) => e.stopPropagation() },
    h(
      'div',
      { className: 'master-mark-wrap' },
      h(
        'label',
        { className: 'row-check-label' },
        h('input', {
          type: 'checkbox',
          className: 'row-check-input',
          checked: Boolean(row.checked),
          'aria-label': `No.${rowNo} ${row.displayName} 확인 체크`,
          onChange: (e) => {
            e.stopPropagation();
            runOpsAction(
              {
                actionType: 'TOGGLE_WORKER_CHECK',
                empCode: row.empCode,
                checked: e.currentTarget.checked,
              },
              e.currentTarget
            );
          },
        })
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'star-toggle-btn',
          'aria-pressed': String(isStarred),
          'aria-label': `No.${rowNo} ${row.displayName} 별표 표시`,
          onClick: (e) => {
            e.stopPropagation();
            runOpsAction(
              {
                actionType: 'TOGGLE_WORKER_STAR',
                empCode: row.empCode,
                starred: !isStarred,
              },
              e.currentTarget
            );
          },
        },
        isStarred ? '★' : '☆'
      ),
      h('span', { className: 'row-num-pill' }, String(rowNo))
    )
  );
}

function getGenericMark(snapshot, groupKey, itemId) {
  const map = snapshot?.operationsSuite?.listItemMarks || {};
  const rec = map[`${groupKey}:${itemId}`];
  return {
    checked: Boolean(rec?.checked),
    starred: Boolean(rec?.starred),
  };
}

function applyGenericStarFilter(snapshot, groupKey, items, getId) {
  if (!appState.genericStarFilter?.[groupKey]) return items;
  return items.filter((item) => getGenericMark(snapshot, groupKey, getId(item)).starred);
}

const GENERIC_GROUP_LABELS = Object.freeze({
  filings: '관공서 신고 과제',
  qsched: '분기별 감독 일정',
  alumni: '퇴사자 통합 원장',
  homeActions: '대시보드 확인할 업무',
  applicants: '채용 후보자',
  leaveRecords: '연차 신청·사용 이력',
  maternity: '육아·모성보호 현황',
  grievances: '고충 처리 대장',
  lmcAgenda: '노사협의회 안건',
  oshRoles: '산업안전 선임 현황',
  risks: '공정별 위험성평가',
  trainings: '법정의무교육',
  stdForms: '표준 서식 목록',
  signedDocs: '이름별 서명 서식',
});

function renderGenericSyncControls(
  snapshot,
  groupKey,
  items,
  getId,
  rerenderCurrent,
  unitLabel = '건',
  options = {}
) {
  const checkedCount = items.filter((it) => getGenericMark(snapshot, groupKey, getId(it)).checked).length;
  const starredCount = items.filter((it) => getGenericMark(snapshot, groupKey, getId(it)).starred).length;
  const allChecked = items.length > 0 && checkedCount === items.length;
  const filterOn = Boolean(appState.genericStarFilter?.[groupKey]);
  const korLabel = GENERIC_GROUP_LABELS[groupKey] || '목록 항목';
  const showGroupCheckbox = options?.showGroupCheckbox !== false;

  return h(
    'div',
    { className: 'step-pill-group' },
    showGroupCheckbox
      ? h(
          'label',
          { className: 'row-check-label' },
          h('input', {
            type: 'checkbox',
            className: 'row-check-input',
            checked: allChecked,
            disabled: items.length === 0,
            'aria-label': `${korLabel} 전체 체크 선택`,
            onChange: (e) => {
              e.stopPropagation();
              runOpsAction(
                {
                  actionType: 'TOGGLE_LIST_GROUP_CHECK',
                  groupKey,
                  itemIds: items.map((it) => String(getId(it))),
                  checked: e.currentTarget.checked,
                },
                e.currentTarget
              );
            },
          })
        )
      : null,
    h(
      'span',
      { className: 'tag tag-gray' },
      `총 ${items.length}${unitLabel} · 체크 ${checkedCount} · ★ ${starredCount}`
    ),
    h(
      'button',
      {
        type: 'button',
        className: filterOn ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
        'aria-pressed': String(filterOn),
        onClick: () => {
          appState.genericStarFilter[groupKey] = !filterOn;
          if (appState.snapshot && typeof rerenderCurrent === 'function') {
            rerenderCurrent(appState.snapshot);
          }
        },
      },
      filterOn ? '★ 별표 필터 해제' : '★ 별표만 보기'
    )
  );
}

function renderGenericSelectHeaderTh(snapshot, groupKey, items, getId, tableLabel) {
  const allChecked =
    items.length > 0 &&
    items.every((it) => getGenericMark(snapshot, groupKey, getId(it)).checked);
  return h(
    'th',
    { scope: 'col' },
    h(
      'div',
      { className: 'master-mark-wrap' },
      h(
        'label',
        { className: 'row-check-label' },
        h('input', {
          type: 'checkbox',
          className: 'row-check-input',
          checked: allChecked,
          disabled: items.length === 0,
          'aria-label': `${tableLabel} 전체 체크 선택`,
          onChange: (e) => {
            e.stopPropagation();
            runOpsAction(
              {
                actionType: 'TOGGLE_LIST_GROUP_CHECK',
                groupKey,
                itemIds: items.map((it) => String(getId(it))),
                checked: e.currentTarget.checked,
              },
              e.currentTarget
            );
          },
        })
      ),
      h('span', {}, '★ · No.')
    )
  );
}

function renderGenericMarkTd(snapshot, groupKey, itemId, rowNo, itemLabel) {
  const mark = getGenericMark(snapshot, groupKey, itemId);
  return h(
    'td',
    { 'data-label': '확인 · 별표 · 번호', onClick: (e) => e.stopPropagation() },
    h(
      'div',
      { className: 'master-mark-wrap' },
      h(
        'label',
        { className: 'row-check-label' },
        h('input', {
          type: 'checkbox',
          className: 'row-check-input',
          checked: mark.checked,
          'aria-label': `No.${rowNo} ${itemLabel} 확인 체크`,
          onChange: (e) => {
            e.stopPropagation();
            runOpsAction(
              {
                actionType: 'TOGGLE_LIST_ITEM_CHECK',
                groupKey,
                itemId: String(itemId),
                checked: e.currentTarget.checked,
              },
              e.currentTarget
            );
          },
        })
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'star-toggle-btn',
          'aria-pressed': String(mark.starred),
          'aria-label': `No.${rowNo} ${itemLabel} 별표 표시`,
          onClick: (e) => {
            e.stopPropagation();
            runOpsAction(
              {
                actionType: 'TOGGLE_LIST_ITEM_STAR',
                groupKey,
                itemId: String(itemId),
                starred: !mark.starred,
              },
              e.currentTarget
            );
          },
        },
        mark.starred ? '★' : '☆'
      ),
      h('span', { className: 'row-num-pill' }, String(rowNo))
    )
  );
}

function renderGenericInlineMark(snapshot, groupKey, itemId, rowNo, itemLabel) {
  const mark = getGenericMark(snapshot, groupKey, itemId);
  return h(
    'span',
    { className: 'inline-mark-bar', onClick: (e) => e.stopPropagation() },
    h(
      'label',
      { className: 'row-check-label' },
      h('input', {
        type: 'checkbox',
        className: 'row-check-input',
        checked: mark.checked,
        'aria-label': `No.${rowNo} ${itemLabel} 확인 체크`,
        onChange: (e) => {
          e.stopPropagation();
          runOpsAction(
            {
              actionType: 'TOGGLE_LIST_ITEM_CHECK',
              groupKey,
              itemId: String(itemId),
              checked: e.currentTarget.checked,
            },
            e.currentTarget
          );
        },
      })
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'star-toggle-btn',
        'aria-pressed': String(mark.starred),
        'aria-label': `No.${rowNo} ${itemLabel} 별표 표시`,
        onClick: (e) => {
          e.stopPropagation();
          runOpsAction(
            {
              actionType: 'TOGGLE_LIST_ITEM_STAR',
              groupKey,
              itemId: String(itemId),
              starred: !mark.starred,
            },
            e.currentTarget
          );
        },
      },
      mark.starred ? '★' : '☆'
    ),
    h('span', { className: 'row-num-pill' }, `No.${rowNo}`)
  );
}

function renderHighlightedDocPre(bodyText, tokens = []) {
  const raw = String(bodyText || '');
  const cleanTokens = Array.from(
    new Set(
      (tokens || [])
        .map((t) => String(t || '').trim())
        .filter((t) => t.length >= 2)
    )
  ).sort((a, b) => b.length - a.length);

  if (cleanTokens.length === 0) {
    return h('div', { className: 'doc-paper-box' }, raw);
  }
  const escaped = cleanTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const tokenSet = new Set(cleanTokens);
  const parts = raw.split(re);
  const nodes = parts
    .filter((p) => p.length > 0)
    .map((p) => (tokenSet.has(p) ? h('mark', { className: 'doc-filled-mark' }, p) : p));
  return h('div', { className: 'doc-paper-box' }, ...nodes);
}

async function fetchRenderedDocQuiet(payload) {
  const res = await fetch('/api/document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': appState.csrfToken,
    },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '서식 미리보기 조회 실패');
  }
  return data.document;
}

function createSignatureCanvasControl(initialSignerName = '', idPrefix = 'sig', persistState = null) {
  const resolvedSigner =
    persistState && persistState.signerName ? persistState.signerName : initialSignerName || '';
  const canvas = h('canvas', {
    className: 'sig-canvas',
    width: '320',
    height: '92',
    tabindex: '0',
    role: 'img',
    'aria-label': '마우스 또는 터치로 자필 전자서명을 그리는 영역',
  });
  const signerInput = h('input', {
    id: `${idPrefix}-signer-input`,
    type: 'text',
    value: resolvedSigner,
    placeholder: '서명자 성명 입력',
    onInput: (e) => {
      if (persistState) persistState.signerName = e.currentTarget.value;
    },
  });
  const consentInput = h('input', {
    id: `${idPrefix}-consent-check`,
    type: 'checkbox',
    checked: Boolean(persistState?.consentConfirmed),
    onChange: (e) => {
      if (persistState) persistState.consentConfirmed = e.currentTarget.checked;
    },
  });
  const statusTag = h('span', { className: 'tag tag-gray' }, '자필서명 대기 (성명 서명 가능)');

  let isDrawing = false;
  let hasInk = Boolean(persistState?.dataUrl);
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx) {
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }

  if (ctx && persistState?.dataUrl && typeof Image === 'function') {
    statusTag.className = 'tag tag-green';
    statusTag.textContent = '자필서명 입력됨 ✓';
    const restoredImg = new Image();
    restoredImg.onload = () => {
      try {
        ctx.drawImage(restoredImg, 0, 0, canvas.width, canvas.height);
      } catch {
        // ignore
      }
    };
    restoredImg.src = persistState.dataUrl;
  }

  const syncDataUrlToState = () => {
    if (!persistState) return;
    if (!hasInk || typeof canvas.toDataURL !== 'function') {
      persistState.dataUrl = '';
      return;
    }
    try {
      const url = canvas.toDataURL('image/png');
      persistState.dataUrl = url.length <= 36000 ? url : '';
    } catch {
      persistState.dataUrl = '';
    }
  };

  const getPoint = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (ev.clientX - rect.left) * scaleX,
      y: (ev.clientY - rect.top) * scaleY,
    };
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (!ctx) return;
    isDrawing = true;
    hasInk = true;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    const pt = getPoint(ev);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    statusTag.className = 'tag tag-green';
    statusTag.textContent = '자필서명 입력됨 ✓';
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!isDrawing || !ctx) return;
    const pt = getPoint(ev);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  });

  const stopDraw = () => {
    if (isDrawing) {
      isDrawing = false;
      syncDataUrlToState();
    }
  };
  canvas.addEventListener('pointerup', stopDraw);
  canvas.addEventListener('pointercancel', stopDraw);

  const clearCanvas = () => {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
    if (persistState) persistState.dataUrl = '';
    statusTag.className = 'tag tag-gray';
    statusTag.textContent = '자필서명 대기 (성명 서명 가능)';
  };

  const rootEl = h(
    'div',
    { className: 'sig-pad-card' },
    h(
      'div',
      { className: 'flex-between-tight' },
      h('strong', {}, '전자서명 패드 (마우스·터치 자필 서명 + 성명 확인)'),
      statusTag
    ),
    canvas,
    h(
      'div',
      { className: 'studio-mini-grid' },
      h(
        'div',
        { className: 'field' },
        h('label', { for: `${idPrefix}-signer-input` }, '서명자 성명'),
        signerInput
      ),
      h(
        'div',
        { className: 'field' },
        h('span', { className: 'field-label-text' }, '서명 패드 초기화'),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm full-width',
            onClick: clearCanvas,
          },
          '자필 서명 지우기'
        )
      )
    ),
    h(
      'label',
      { className: 'check-label', for: `${idPrefix}-consent-check` },
      consentInput,
      h('span', {}, '기재된 근로조건·보안·개인정보 조항을 확인하였으며 전자서명에 동의합니다.')
    )
  );

  return {
    rootEl,
    setSignerName(nextName) {
      const s = String(nextName || '');
      signerInput.value = s;
      if (persistState) persistState.signerName = s;
    },
    getSignerName() {
      return signerInput.value.trim();
    },
    isConsentConfirmed() {
      return Boolean(consentInput.checked);
    },
    invalidateConsent() {
      consentInput.checked = false;
      if (persistState) persistState.consentConfirmed = false;
    },
    focusConsent() {
      consentInput.focus();
    },
    getSignatureDataUrl() {
      if (persistState?.dataUrl && !isDrawing) return persistState.dataUrl;
      if (!hasInk || typeof canvas.toDataURL !== 'function') return '';
      try {
        const url = canvas.toDataURL('image/png');
        const safeUrl = url.length <= 36000 ? url : '';
        if (persistState) persistState.dataUrl = safeUrl;
        return safeUrl;
      } catch {
        return '';
      }
    },
    clearCanvas,
  };
}

function buildDraftFromContractRow(c) {
  if (!c) return null;
  return {
    empCode: c.empCode || '',
    personName: c.displayName || '',
    deptName: c.deptName || '일반부서',
    jobTitle: c.jobTitle || '사원',
    hireDate: c.hireDate || '2026-11-15',
    maskedBirthOrId: c.maskedBirthOrId || '950101-*******',
    maskedPhone: c.maskedPhone || '010-****-0000',
    address: c.address || '',
    weeklyHours: c.weeklyHours || 40,
    baseMonthlyPay: c.baseMonthlyPay || 3200000,
    mealAllowance: c.mealAllowance ?? 200000,
  };
}

function openWorkerInOnboardingStudio(empCode, templateId = 'DOC_EMPLOYMENT_CONTRACT') {
  const snapshot = appState.snapshot;
  if (!snapshot?.operationsSuite) return;
  const ledger = snapshot.operationsSuite.recruitAndOnboarding?.contractLedger || [];
  const target = ledger.find((c) => c.empCode === empCode) || ledger[0];
  if (target) {
    appState.onboardingDocEmpCode = target.empCode;
    appState.onboardingDraftPerson = buildDraftFromContractRow(target);
  }
  if (templateId) {
    appState.onboardingActiveTpl = templateId;
  }
  switchTab('ops-recruit', false);
  renderOpsRecruitTab(snapshot);
  document.getElementById('onboarding-doc-studio')?.scrollIntoView({ block: 'start' });
}

function openPayslipByEmpCode(empCode, triggerBtn) {
  const line = appState.snapshot?.payrollLines?.find((p) => p.empCode === empCode);
  if (!line) {
    showBanner('해당 직원의 급여 명세서 정보를 찾을 수 없습니다.', true);
    return;
  }
  openPayslipModal(line, triggerBtn);
}

/* ==========================================================================
   탭 4: 자동 급여대장 & 산출식 명시 임금명세서
   ========================================================================== */

function renderPayrollTab(snapshot) {
  const { payrollLines, payrollSummary, compliance } = snapshot;
  const policy = snapshot.operationsSuite?.policySettings || snapshot.company.policySettings || {};

  const policyBar = document.getElementById('payroll-policy-bar');
  const notice = snapshot.monthlyStartNotice || null;
  if (policyBar) {
    policyBar.replaceChildren(
      h(
        'div',
        { className: 'policy-sync-items' },
        h('span', { className: 'tag tag-blue' }, '환경 설정 연동 중'),
        notice && notice.hasChanges
          ? h(
              'span',
              { className: notice.checked ? 'tag tag-green' : 'tag tag-amber' },
              `★ ${notice.monthStartBadgeText}`
            )
          : null,
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
    const totalDeducted = payrollSummary.totalGross - payrollSummary.totalNet;
    sumStrip.replaceChildren(
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '대상 인원'),
        h('div', { className: 'kpi-value' }, `${payrollSummary.workerCount}명`),
        h('div', { className: 'kpi-sub' }, compliance.headcounts.is5OrMore ? '5인 이상 사업장' : '5인 미만 사업장')
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '지급총액'),
        h('div', { className: 'kpi-value' }, fmtWon(payrollSummary.totalGross)),
        h('div', { className: 'kpi-sub' }, `수당 ${fmtWon(payrollSummary.totalOvertime)} 포함`)
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '공제합계'),
        h('div', { className: 'kpi-value' }, fmtWon(totalDeducted)),
        h('div', { className: 'kpi-sub' }, `4대보험 · 원천세 ${policy.withholdingTaxRatePct ?? 100}%`)
      ),
      h(
        'div',
        { className: 'kpi-card' },
        h('div', { className: 'kpi-label' }, '실지급액'),
        h('div', { className: 'kpi-value' }, fmtWon(payrollSummary.totalNet)),
        h('div', { className: 'kpi-sub' }, `${policy.payDayLabel || '매월 25일'} 지급`)
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

  const visibleLines = applyStarFilter(payrollLines);

  const tableSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '급여 대장'),
      renderRosterSyncControls(payrollLines, renderPayrollTab)
    ),
    h(
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
            renderMasterSelectHeaderTh(payrollLines, '급여 대장'),
            h('th', { scope: 'col' }, '사번 · 이름 · 소속'),
            h('th', { scope: 'col' }, '구분'),
            h('th', { scope: 'col', className: 'num' }, '기본·고정·식대'),
            h('th', { scope: 'col', className: 'num' }, '연장·연차·성과'),
            h('th', { scope: 'col', className: 'num' }, '감봉공제'),
            h('th', { scope: 'col', className: 'num' }, '4대보험·세액'),
            h('th', { scope: 'col', className: 'num' }, '실지급액'),
            h('th', { scope: 'col' }, '급여 명세서')
          )
        ),
        h(
          'tbody',
          {},
          visibleLines.length === 0
            ? [h('tr', {}, h('td', { colspan: '9' }, '표시할 별표(★) 직원이 없습니다.'))]
            : visibleLines.map((line) =>
                h(
                  'tr',
                  {},
                  renderMasterMarkTd(line),
                  h(
                    'td',
                    { 'data-label': '사번 · 이름 · 소속' },
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
                    { 'data-label': '구분' },
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
                    { className: 'num', 'data-label': '감봉공제' },
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
                    { 'data-label': '급여 명세서' },
                    h(
                      'div',
                      { className: 'cell-actions-col' },
                      line.warnings.length === 0
                        ? h('span', { className: 'tag tag-green' }, '적합')
                        : line.warnings.map((w) =>
                            h(
                              'span',
                              { className: w.level === 'CRITICAL' ? 'tag tag-red' : 'tag tag-amber' },
                              w.code === 'DISGUISED_WORKER_RISK'
                                ? '3.3% 점검'
                                : w.code === 'DISCIPLINARY_CUT_CAPPED'
                                  ? '한도캡핑'
                                  : w.code === 'DISCIPLINARY_PROCEDURE_DEFECT'
                                    ? '절차미비'
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
                        '명세서 보기'
                      )
                    )
                  )
                )
              )
        )
      )
    )
  );

  container.replaceChildren(tableSection);
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
  const attModal = document.getElementById('att-calendar-modal');
  if (attModal && !attModal.hidden) {
    attModal.inert = true;
    attModal.setAttribute('aria-hidden', 'true');
  }
  if (modPopup && !modPopup.hidden) {
    modPopup.inert = true;
    modPopup.setAttribute('aria-hidden', 'true');
  }
  modal.hidden = false;
  closeBtn?.focus();
}

function closeModal() {
  const modal = document.getElementById('doc-modal');
  const attModal = document.getElementById('att-calendar-modal');
  const modPopup = document.getElementById('module-popup-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (attModal && !attModal.hidden) {
    attModal.inert = false;
    attModal.removeAttribute('aria-hidden');
  } else if (modPopup && !modPopup.hidden) {
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
  } else if (attModal && !attModal.hidden) {
    document.getElementById('att-cal-close-btn')?.focus();
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
  const notice = appState.snapshot?.monthlyStartNotice || null;
  const scaleMeta = notice
    ? ` | 사업장 기준 : ${notice.scaleBadge} (${notice.monthStartBadgeText}${notice.hasChanges ? (notice.checked ? ' · 확인완료' : ' · 변화확인필요') : ''})`
    : '';
  const att = line.attendanceSummary || null;
  const lv = line.leaveSummary || null;

  const attSection = att
    ? [
        '----------------------------------------------------------------------',
        `4. 당월 일별 근태 · 근로시간 기록 (${att.yearMonth})`,
        `   - 요약 : 출근 ${att.workDaysCount}일 (연차·반차 ${att.leaveDaysCount}일) | 소정 ${att.totalNormalHours}h | 연장 ${att.totalOvertimeHours}h | 야간 ${att.totalNightHours}h | 휴일 ${att.totalHolidayHours}h`,
        ...(att.workedDays.length === 0
          ? ['   * 당월 출퇴근 기록 없음']
          : att.workedDays.map((d) => {
              const timePart = d.clockIn && d.clockIn !== '-' ? `${d.clockIn}~${d.clockOut} ` : '';
              const hParts = [];
              if (d.normalHours > 0) hParts.push(`정상 ${d.normalHours}h`);
              if (d.overtimeHours > 0) hParts.push(`연장(8h초과) ${d.overtimeHours}h`);
              if (d.nightHours > 0) hParts.push(`야간(22~07시) ${d.nightHours}h`);
              if (d.holidayHours > 0) hParts.push(`휴일 ${d.holidayHours}h`);
              if (hParts.length === 0) hParts.push(d.statusLabel);
              const memoPart = d.memo ? ` (${d.memo})` : '';
              return `   * ${d.date}(${d.weekday}) [${d.statusLabel}] ${timePart}— ${hParts.join(' · ')}${memoPart}`;
            })),
        '',
      ].join('\n')
    : '';

  const leaveSection = lv
    ? [
        '----------------------------------------------------------------------',
        '5. 연차유급휴가 발생 · 신청 · 사용 상세 기록',
        lv.leaveEligible
          ? `   - 요약 : 발생 ${lv.grantedCount}회 (총 ${lv.accruedDays}일) | 사용 ${lv.usedCount}회 (총 ${lv.usedDays}일 · 당월 ${lv.monthUsedDays}일) | 잔여 ${lv.remainingDays}일`
          : `   - 구분 : ${lv.ruleBasis}`,
        lv.leaveEligible ? `   - 기준 : ${lv.ruleBasis}` : null,
        ...(lv.leaveEligible
          ? lv.records.length === 0
            ? ['   * 연차 신청·사용 내역 없음']
            : lv.records.map(
                (r) =>
                  `   * 신청일 ${r.appliedAt} → 사용일 ${r.useDate} | ${r.leaveType} (${r.days}일) | 사유: ${r.reason}`
              )
          : []),
        '',
      ]
        .filter((x) => x !== null)
        .join('\n')
    : '';

  const warnText =
    line.warnings.length > 0
      ? `[노동법 자동 검증 알림]\n${line.warnings.map((w) => ` - (${w.level}) ${w.message}`).join('\n')}\n`
      : '[노동법 자동 검증 알림]\n - 위반·경고 사항 없음 (최저임금·근로시간·제95조 적합)\n';

  const body = `======================================================================
${companyName} 급여 명세서 (근태 캘린더 · 연차 이력 · 산출식 통합본)
======================================================================
순번 · 성명(사번) : No.${line.rowNo ?? '-'} ${line.displayName} (${line.empCode}) | 소속 : ${line.deptName}${scaleMeta}

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

${attSection}${leaveSection}${warnText}`;

  openModalWithText(
    `[급여 명세서] No.${line.rowNo ?? '-'} ${line.displayName} (${line.empCode})`,
    '급여 산출식 · 월간 일별 근무시간 · 연차 발생/신청/사용 통합 명세서',
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
      ...staging.activeWorkers.slice(0, 6).map((w, idx) =>
        h(
          'div',
          { className: 'reconcile-item flex-between-tight' },
          h(
            'span',
            { className: 'font-extrabold' },
            `No.${idx + 1} ${w.displayName} (${w.empCode} · ${w.deptName})`
          ),
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
          ...staging.offboardedWorkers.map((al, idx) =>
            h(
              'div',
              { className: 'reconcile-item' },
              h(
                'div',
                { className: 'flex-between-tight' },
                h(
                  'span',
                  { className: 'font-extrabold' },
                  `No.${idx + 1} ${al.displayName} (${al.empCode} · ${al.deptName})`
                ),
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
  const offBtn = document.getElementById('btn-live-offboard');
  if (empSelect) {
    // 3.3% 사업소득 계약자(BIZ_33)는 근로기준법상 퇴직·고용보험 상실 원장 대상이 아니므로 선택 목록에서 자동 제외
    const offboardableWorkers = (snapshot.workers || []).filter((w) => w.workerCategory !== 'BIZ_33');
    if (offboardableWorkers.length === 0) {
      empSelect.replaceChildren(h('option', { value: '' }, '퇴사 전환 대상 재직자 없음'));
      empSelect.disabled = true;
      if (offBtn) offBtn.disabled = true;
    } else {
      empSelect.disabled = false;
      if (offBtn) offBtn.disabled = false;
      empSelect.replaceChildren(
        ...offboardableWorkers.map((w) => {
          const catSuffix = w.workerCategory === 'DAILY' ? ' · 일용' : w.workerCategory === 'PART_TIME' ? ' · 단시간' : '';
          return h(
            'option',
            { value: w.empCode },
            `No.${w.rowNo ?? 1} ${w.empCode} ${w.displayName} (${w.deptName}${catSuffix})`
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

  const visibleAlumni = applyGenericStarFilter(
    snapshot,
    'alumni',
    alumni,
    (al) => al.empCode
  );

  const tbody = h(
    'tbody',
    {},
    ...(visibleAlumni.length === 0
      ? [h('tr', {}, h('td', { colspan: '6' }, '표시할 별표(★) 퇴사자가 없습니다.'))]
      : visibleAlumni.map((al, idx) => {
          const isPurged = al.dataLifecycleStatus === 'ANONYMIZED_PURGED';
          const isPurgeDue = al.dataLifecycleStatus === 'RETENTION_EXPIRED_PURGE_DUE';
          const rowNo = al.rowNo || idx + 1;

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
                      showBanner(
                        `${al.displayName} 금품청산 상태가 ${nextStatus === 'PAID' ? '지급완료' : '대기'}로 변경되었습니다.`
                      );
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
            renderGenericMarkTd(snapshot, 'alumni', al.empCode, rowNo, al.displayName),
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
        }))
  );

  tableWrap.replaceChildren(
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '퇴사(은퇴)자 통합관리 원장'),
      renderGenericSyncControls(snapshot, 'alumni', alumni, (al) => al.empCode, renderAlumniTab, '명', {
        showGroupCheckbox: false,
      })
    ),
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
            renderGenericSelectHeaderTh(
              snapshot,
              'alumni',
              alumni,
              (al) => al.empCode,
              '퇴사자 통합관리 원장'
            ),
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
    if (data.result?.autoOpenOnboardingDocs && data.result?.hiredEmpCode) {
      const ledger = data.snapshot?.operationsSuite?.recruitAndOnboarding?.contractLedger || [];
      const hiredRow = ledger.find((c) => c.empCode === data.result.hiredEmpCode);
      appState.onboardingDocEmpCode = data.result.hiredEmpCode;
      appState.onboardingActiveTpl = 'DOC_EMPLOYMENT_CONTRACT';
      if (hiredRow) {
        appState.onboardingDraftPerson = buildDraftFromContractRow(hiredRow);
      }
    }
    updateSnapshot(data.snapshot);
    if (data.result?.autoOpenOnboardingDocs && data.result?.hiredEmpCode) {
      document.getElementById('onboarding-doc-studio')?.scrollIntoView({ block: 'start' });
    }
    if (data.result?.message) {
      showBanner(data.result.message);
    }
    return data;
  } catch (err) {
    showBanner(err.message, true);
    return null;
  }
}

function renderOpsHomeTab(snapshot) {
  const wrap = document.getElementById('ops-home-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const ops = snapshot.operationsSuite;
  const k = ops.overviewKpis;
  const paySum = snapshot.payrollSummary;
  const policy = ops.policySettings || snapshot.company.policySettings || {};
  const leaveBasisLabel = formatLeaveBasisShort(policy);
  const warnHours = policy.weeklyWarnHours ?? 48;
  const pendingFilings = snapshot.compliance.statutoryFilings.filter((f) => !f.isCompleted).length;
  const totalRemainingLeave = ops.leaveAndMaternity.ledger.reduce(
    (s, r) => s + (r.remainingDays || 0),
    0
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
      h('div', { className: 'kpi-label' }, '전체 직원'),
      h('div', { className: 'kpi-value' }, `${k.activeRosterCount}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        k.unsignedContractCount > 0
          ? `계약 미서명 ${k.unsignedContractCount}건`
          : `채용 진행 ${k.applicantOpenCount}명`
      )
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('ops-attendance', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, '근태 현황'),
      h(
        'div',
        { className: 'kpi-value' },
        k.over52Count > 0 ? `초과 ${k.over52Count}명` : k.near52Count > 0 ? `주의 ${k.near52Count}명` : '정상'
      ),
      h('div', { className: 'kpi-sub' }, `주 ${warnHours}h 주의 기준`)
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('ops-leave', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, '잔여 연차'),
      h('div', { className: 'kpi-value' }, `${Number(totalRemainingLeave.toFixed(1))}일`),
      h('div', { className: 'kpi-sub' }, leaveBasisLabel)
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'kpi-card kpi-card-clickable',
        onClick: (e) => jumpTo('payroll', e.currentTarget),
      },
      h('div', { className: 'kpi-label' }, '이번 달 급여'),
      h('div', { className: 'kpi-value' }, fmtWon(paySum.totalNet)),
      h('div', { className: 'kpi-sub' }, `${policy.payDayLabel || '매월 25일'} 지급`)
    )
  );

  const actionItems = [];
  const monthNotice = snapshot.monthlyStartNotice;
  if (monthNotice && monthNotice.hasChanges && !monthNotice.checked) {
    actionItems.push({
      tagClass: monthNotice.scaleTransitioned ? 'tag tag-red' : 'tag tag-amber',
      tagText: `월초(${monthNotice.monthStartDate})`,
      text: `${monthNotice.scaleBadge} · 당월 급여·규모 변화 확인 체크 필요`,
      tab: 'settings-master',
    });
  }
  if (k.unsignedContractCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-red',
      tagText: '계약',
      text: `근로계약 미서명 ${k.unsignedContractCount}명`,
      tab: 'ops-recruit',
    });
  }
  if (k.over52Count > 0 || k.near52Count > 0) {
    actionItems.push({
      tagClass: k.over52Count > 0 ? 'tag tag-red' : 'tag tag-amber',
      tagText: '근태',
      text: `주간 연장근로 주의 ${k.over52Count + k.near52Count}명`,
      tab: 'ops-attendance',
    });
  }
  if (k.leavePromoPendingCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-amber',
      tagText: '연차',
      text: `미사용 연차 촉진 대상 ${k.leavePromoPendingCount}명`,
      tab: 'ops-leave-promo',
    });
  }
  if (k.pendingOffboardSettlementCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-amber',
      tagText: '퇴사',
      text: `퇴사 정산 대기 ${k.pendingOffboardSettlementCount}명`,
      tab: 'alumni',
    });
  }
  if (pendingFilings > 0) {
    actionItems.push({
      tagClass: 'tag tag-blue',
      tagText: '신고',
      text: `관공서 신고 과제 ${pendingFilings}건`,
      tab: 'compliance',
    });
  }
  if (actionItems.length === 0) {
    actionItems.push({
      tagClass: 'tag tag-green',
      tagText: '완료',
      text: '현재 처리 대기 중인 업무가 없습니다.',
      tab: 'ops-org',
    });
  }

  const indexedActions = actionItems.map((it, idx) => ({
    ...it,
    itemId: `ACT-${it.tab}-${idx + 1}`,
    rowNo: idx + 1,
  }));
  const visibleActions = applyGenericStarFilter(
    snapshot,
    'homeActions',
    indexedActions,
    (it) => it.itemId
  );

  const actionCenterCard = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '확인할 업무'),
      renderGenericSyncControls(
        snapshot,
        'homeActions',
        indexedActions,
        (it) => it.itemId,
        renderOpsHomeTab,
        '건'
      )
    ),
    h(
      'div',
      { className: 'action-feed-list' },
      ...(visibleActions.length === 0
        ? [h('div', { className: 'empty-state' }, '표시할 별표(★) 업무가 없습니다.')]
        : visibleActions.map((item) =>
            h(
              'div',
              { className: 'action-feed-row' },
              h(
                'div',
                { className: 'action-feed-main' },
                renderGenericInlineMark(snapshot, 'homeActions', item.itemId, item.rowNo, item.text),
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
                '확인'
              )
            )
          ))
    )
  );

  wrap.replaceChildren(topKpis, actionCenterCard);
}

function renderOpsRecruitTab(snapshot) {
  const wrap = document.getElementById('ops-recruit-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const rec = snapshot.operationsSuite.recruitAndOnboarding;
  const signedArchive = snapshot.operationsSuite.signedDocumentsArchive || [];

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

  const indexedApplicants = rec.applicants.map((a, idx) => ({ ...a, rowNo: idx + 1 }));
  const visibleApplicants = applyGenericStarFilter(
    snapshot,
    'applicants',
    indexedApplicants,
    (a) => a.applicantId
  );

  const applicantTable = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '채용 후보자 (입사 발령 시 필수 3종 서식 자동 오픈)'),
      renderGenericSyncControls(
        snapshot,
        'applicants',
        indexedApplicants,
        (a) => a.applicantId,
        renderOpsRecruitTab,
        '명',
        { showGroupCheckbox: false }
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
            renderGenericSelectHeaderTh(
              snapshot,
              'applicants',
              indexedApplicants,
              (a) => a.applicantId,
              '채용 후보자'
            ),
            h('th', { scope: 'col' }, '지원번호 · 성명'),
            h('th', { scope: 'col' }, '지원부서 · 직무'),
            h('th', { scope: 'col' }, '전형단계 · 블라인드'),
            h('th', { scope: 'col', className: 'num' }, '제시처우 (주시간)'),
            h('th', { scope: 'col' }, '채용서류 반환/파기기한'),
            h('th', { scope: 'col' }, '입사 · 3종 계약서 자동연계')
          )
        ),
        h(
          'tbody',
          {},
          visibleApplicants.length === 0
            ? [h('tr', {}, h('td', { colspan: '7' }, '표시할 별표(★) 채용 후보자가 없습니다.'))]
            : visibleApplicants.map((a) =>
                h(
                  'tr',
                  {},
                  renderGenericMarkTd(snapshot, 'applicants', a.applicantId, a.rowNo, a.name),
                  h(
                    'td',
                    { 'data-label': '지원번호 · 성명' },
                    h('div', { className: 'cell-emp-code' }, a.applicantId),
                    h('div', { className: 'breakable-name' }, a.name),
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
                    { 'data-label': '입사 · 3종 계약서 자동연계' },
                    a.hiredEmpCode
                      ? h(
                          'div',
                          { className: 'step-pill-group' },
                          h('span', { className: 'tag tag-green' }, `편입됨 (${a.hiredEmpCode})`),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'btn btn-secondary btn-sm',
                              onClick: () => openWorkerInOnboardingStudio(a.hiredEmpCode),
                            },
                            '입사 3종 서식 열기'
                          )
                        )
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
                            '입사 발령 · 3종서식 자동생성'
                          )
                  )
                )
              )
        )
      )
    )
  );

  // 입사 필수 3종(근로계약서 · 개인정보동의서 · 보안서약서) 자동연결 · 개인정보 실시간 기입 · 전자서명 스튜디오
  const ledger = rec.contractLedger || [];
  if (!appState.onboardingDocEmpCode || !ledger.some((c) => c.empCode === appState.onboardingDocEmpCode)) {
    const firstUnsigned = ledger.find((c) => !c.allOnboardingSigned) || ledger[0];
    appState.onboardingDocEmpCode = firstUnsigned ? firstUnsigned.empCode : '';
  }
  const activeContractRow =
    ledger.find((c) => c.empCode === appState.onboardingDocEmpCode) || ledger[0] || null;

  if (
    !appState.onboardingDraftPerson ||
    appState.onboardingDraftPerson._boundEmpCode !== (activeContractRow?.empCode || '')
  ) {
    appState.onboardingDraftPerson = activeContractRow
      ? { ...buildDraftFromContractRow(activeContractRow), _boundEmpCode: activeContractRow.empCode }
      : {
          empCode: '',
          personName: '신규입사자',
          deptName: '생산기술1팀',
          jobTitle: '사원',
          hireDate: '2026-11-15',
          maskedBirthOrId: '950101-*******',
          maskedPhone: '010-****-0000',
          address: '경기도 화성시 동탄첨단산업1로 45',
          weeklyHours: 40,
          baseMonthlyPay: 3200000,
          mealAllowance: 200000,
          _boundEmpCode: '',
        };
  }
  const draft = appState.onboardingDraftPerson;
  const currentBoundKey = draft.empCode || 'NEW';
  if (appState.onboardingSigState.boundKey !== currentBoundKey) {
    appState.onboardingSigState = {
      boundKey: currentBoundKey,
      signerName: draft.personName,
      dataUrl: '',
      consentConfirmed: false,
    };
  }
  const sigPad = createSignatureCanvasControl(
    draft.personName,
    'onboard-sig',
    appState.onboardingSigState
  );

  const onboardingTplSpecs = [
    {
      id: 'DOC_EMPLOYMENT_CONTRACT',
      shortTitle: '1. 표준 근로계약서',
      signedFlag: Boolean(activeContractRow?.employmentContractSigned),
    },
    {
      id: 'DOC_PRIVACY_CONSENT',
      shortTitle: '2. 개인정보 수집·이용 동의서',
      signedFlag: Boolean(activeContractRow?.privacyConsentSigned),
    },
    {
      id: 'DOC_NDA_SECURITY_PLEDGE',
      shortTitle: '3. 비밀유지·정보보안 서약서',
      signedFlag: Boolean(activeContractRow?.ndaPledgeSigned),
    },
    {
      id: 'DOC_EXIT_SECURITY_NONCOMPETE',
      shortTitle: '4. 퇴사 보안·경업금지 약정',
      signedFlag: false,
    },
  ];

  const viewerBodyWrap = h(
    'div',
    { id: 'onboarding-doc-viewer-pane', 'aria-live': 'polite' },
    h('div', { className: 'doc-paper-box' }, '서식 양식을 불러오는 중입니다...')
  );

  const renderOnboardingDocIntoPane = async () => {
    const reqId = ++appState.onboardingReqSeq;
    try {
      const doc = await fetchRenderedDocQuiet({
        previewOnly: true,
        templateId: appState.onboardingActiveTpl,
        empCode: draft.empCode || undefined,
        personInfo: {
          empCode: draft.empCode,
          personName: draft.personName,
          deptName: draft.deptName,
          jobTitle: draft.jobTitle,
          hireDate: draft.hireDate,
          maskedBirthOrId: draft.maskedBirthOrId,
          maskedPhone: draft.maskedPhone,
          address: draft.address,
          weeklyHours: Number(draft.weeklyHours) || 40,
          baseMonthlyPay: Number(draft.baseMonthlyPay) || 0,
          mealAllowance: Number(draft.mealAllowance) || 0,
        },
      });
      if (reqId !== appState.onboardingReqSeq) return;

      const verifiedSigned = doc.signedRecord || null;
      const hadPriorSignedRecord = signedArchive.some(
        (d) => d.templateId === appState.onboardingActiveTpl && draft.empCode && d.empCode === draft.empCode && d.signed
      );

      const sigStampBlock = verifiedSigned
        ? h(
            'div',
            { className: 'person-doc-history-card' },
            h(
              'div',
              { className: 'flex-between-tight' },
              h(
                'span',
                { className: 'tag tag-green' },
                `전자서명 완료 ✓ (${verifiedSigned.signerName} · ${verifiedSigned.signedAt} · ${verifiedSigned.signatureCode})`
              ),
              h('span', { className: 'cell-dept-name' }, doc.title)
            ),
            verifiedSigned.signatureDataUrl
              ? h('img', {
                  className: 'sig-saved-preview',
                  src: verifiedSigned.signatureDataUrl,
                  alt: `${verifiedSigned.signerName} 자필 전자서명 이미지`,
                })
              : null
          )
        : hadPriorSignedRecord
          ? h(
              'div',
              { className: 'person-doc-history-card' },
              h(
                'span',
                { className: 'tag tag-amber' },
                '기재 내용이 수정되어 기존 서명 증명이 해제되었습니다 — 변경된 내용으로 재서명 후 저장해 주세요.'
              )
            )
          : null;

      if (appState.onboardingCompareMode) {
        viewerBodyWrap.replaceChildren(
          h(
            'div',
            { className: 'doc-compare-grid' },
            h(
              'div',
              {},
              h('div', { className: 'mb-6' }, h('span', { className: 'tag tag-gray' }, '기본 양식 (미기입 표준원본)')),
              h('div', { className: 'doc-paper-box' }, doc.blankTemplateBody || doc.body)
            ),
            h(
              'div',
              {},
              h(
                'div',
                { className: 'mb-6' },
                h('span', { className: 'tag tag-amber' }, '변경된 양식 (좌측 개인정보·처우 자동기입)')
              ),
              renderHighlightedDocPre(doc.body, doc.autoFilledTokens)
            )
          ),
          sigStampBlock
        );
      } else {
        viewerBodyWrap.replaceChildren(
          h(
            'div',
            { className: 'flex-between-tight mb-6' },
            h('strong', {}, doc.title),
            h('span', { className: 'tag tag-blue' }, '노란 하이라이트 = 좌측 입력 개인정보 실시간 반영 항목')
          ),
          renderHighlightedDocPre(doc.body, doc.autoFilledTokens),
          sigStampBlock
        );
      }
    } catch (err) {
      if (reqId !== appState.onboardingReqSeq) return;
      viewerBodyWrap.replaceChildren(h('div', { className: 'tag tag-red' }, err.message));
    }
  };

  const scheduleOnboardingDocRefresh = () => {
    if (appState.onboardingDocTimer) clearTimeout(appState.onboardingDocTimer);
    appState.onboardingDocTimer = setTimeout(() => {
      renderOnboardingDocIntoPane();
    }, 90);
  };

  const submitOnboardingSign = async (templateIds, triggerBtn) => {
    if (!sigPad.isConsentConfirmed()) {
      showBanner('전자서명을 진행하려면 조항 확인 및 전자서명 동의 체크박스를 선택해 주세요.', true);
      sigPad.focusConsent();
      return;
    }
    const signerNameVal = sigPad.getSignerName() || draft.personName;
    const sigUrl = sigPad.getSignatureDataUrl();
    const prevBound = draft.empCode;
    appState.onboardingDraftPerson = null;
    await runOpsAction(
      {
        actionType: 'SAVE_PERSON_DOC_AND_SIGN',
        empCode: prevBound || undefined,
        personName: draft.personName,
        deptName: draft.deptName,
        jobTitle: draft.jobTitle,
        hireDate: draft.hireDate,
        maskedBirthOrId: draft.maskedBirthOrId,
        maskedPhone: draft.maskedPhone,
        address: draft.address,
        weeklyHours: Number(draft.weeklyHours) || 40,
        baseMonthlyPay: Number(draft.baseMonthlyPay) || 0,
        mealAllowance: Number(draft.mealAllowance) || 0,
        templateIds,
        signNow: true,
        consentConfirmed: true,
        signerName: signerNameVal,
        signatureDataUrl: sigUrl,
      },
      triggerBtn
    );
  };

  const onboardingStudioSection = h(
    'div',
    { className: 'ops-section-block code-diff-box', id: 'onboarding-doc-studio' },
    h(
      'div',
      { className: 'ops-section-head' },
      h(
        'div',
        { className: 'step-pill-group' },
        h('h3', { className: 'ops-section-title' }, '입사 필수 3종 서식 자동연결 · 개인정보 자동기입 · 전자서명'),
        h('span', { className: 'code-diff-pill' }, '변경됨 · 좌측 개인정보 입력 즉시 우측 계약서·서약서·동의서 자동 반영 + 서명')
      ),
      activeContractRow
        ? h(
            'span',
            { className: activeContractRow.allOnboardingSigned ? 'tag tag-green' : 'tag tag-amber' },
            activeContractRow.allOnboardingSigned
              ? `No.${activeContractRow.rowNo} ${activeContractRow.displayName} — 입사 3종 서명 완료 ✓`
              : `No.${activeContractRow.rowNo} ${activeContractRow.displayName} — 미서명 서식 확인 필요`
          )
        : null
    ),
    h(
      'div',
      { className: 'forms-studio-layout' },
      // 좌측: 대상 직원 선택 + 개인정보 입력 + 자필 전자서명 패드
      h(
        'div',
        { className: 'forms-studio-sidebar' },
        h(
          'div',
          {
            className: 'studio-person-box',
            onInput: (e) => {
              const target = e.target;
              if (!target || !target.name) return;
              draft[target.name] = target.value;
              if (target.name === 'personName') {
                sigPad.setSignerName(target.value);
              }
              sigPad.invalidateConsent();
              scheduleOnboardingDocRefresh();
            },
          },
          h(
            'div',
            { className: 'field' },
            h('label', { for: 'onboard-emp-select' }, '대상 직원 선택 (입사 발령 시 자동 선택됨)'),
            h(
              'select',
              {
                id: 'onboard-emp-select',
                disabled: ledger.length === 0,
                onChange: (e) => {
                  const nextCode = e.currentTarget.value;
                  appState.onboardingDocEmpCode = nextCode;
                  const row = ledger.find((x) => x.empCode === nextCode);
                  appState.onboardingDraftPerson = row
                    ? { ...buildDraftFromContractRow(row), _boundEmpCode: row.empCode }
                    : null;
                  renderOpsRecruitTab(snapshot);
                },
              },
              ...(ledger.length === 0
                ? [h('option', { value: '' }, '등록된 직원이 없습니다')]
                : ledger.map((c) =>
                    h(
                      'option',
                      { value: c.empCode, selected: c.empCode === activeContractRow?.empCode },
                      `No.${c.rowNo} ${c.displayName} (${c.empCode}) — ${c.allOnboardingSigned ? '3종 서명완료' : '서명필요'}`
                    )
                  ))
            )
          ),
          h(
            'div',
            { className: 'studio-mini-grid' },
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-person-name' }, '성명 (우측 서식 자동기입)'),
              h('input', { id: 'ob-person-name', name: 'personName', type: 'text', value: draft.personName })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-dept-name' }, '소속 부서'),
              h('input', { id: 'ob-dept-name', name: 'deptName', type: 'text', value: draft.deptName })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-job-title' }, '직위 · 담당업무'),
              h('input', { id: 'ob-job-title', name: 'jobTitle', type: 'text', value: draft.jobTitle })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-hire-date' }, '입사일(계약시작일)'),
              h('input', { id: 'ob-hire-date', name: 'hireDate', type: 'date', value: draft.hireDate })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-birth' }, '생년월일(마스킹)'),
              h('input', {
                id: 'ob-birth',
                name: 'maskedBirthOrId',
                type: 'text',
                value: draft.maskedBirthOrId,
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-phone' }, '연락처(자동마스킹)'),
              h('input', { id: 'ob-phone', name: 'maskedPhone', type: 'text', value: draft.maskedPhone })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-base-pay' }, '월 기본급(원)'),
              h('input', {
                id: 'ob-base-pay',
                name: 'baseMonthlyPay',
                type: 'number',
                step: '50000',
                value: String(draft.baseMonthlyPay),
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'ob-weekly-hours' }, '주 소정근로시간(h)'),
              h('input', {
                id: 'ob-weekly-hours',
                name: 'weeklyHours',
                type: 'number',
                min: '1',
                max: '52',
                value: String(draft.weeklyHours),
              })
            )
          ),
          h(
            'div',
            { className: 'field' },
            h('label', { for: 'ob-address' }, '거주지 주소 (계약서 · 서약서 · 동의서 동시 반영)'),
            h('input', { id: 'ob-address', name: 'address', type: 'text', value: draft.address })
          )
        ),
        sigPad.rootEl,
        h(
          'div',
          { className: 'step-pill-group' },
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary full-width',
              onClick: (e) =>
                submitOnboardingSign(
                  ['DOC_EMPLOYMENT_CONTRACT', 'DOC_PRIVACY_CONSENT', 'DOC_NDA_SECURITY_PLEDGE'],
                  e.currentTarget
                ),
            },
            '입사 필수 3종(근로계약·개인정보동의·보안서약) 일괄 서명 · 저장'
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary full-width',
              onClick: (e) => submitOnboardingSign([appState.onboardingActiveTpl], e.currentTarget),
            },
            '현재 열람 중인 서식만 서명 · 저장'
          )
        )
      ),
      // 우측: 입사 연결 서식 탭 + 기본양식↔변경양식 비교 + 실시간 하이라이트 문서
      h(
        'div',
        { className: 'forms-studio-viewer' },
        h(
          'div',
          { className: 'ops-section-head' },
          h(
            'div',
            { className: 'step-pill-group' },
            ...onboardingTplSpecs.map((sp) =>
              h(
                'button',
                {
                  type: 'button',
                  className:
                    appState.onboardingActiveTpl === sp.id
                      ? 'btn btn-primary btn-sm'
                      : 'btn btn-secondary btn-sm',
                  'aria-pressed': String(appState.onboardingActiveTpl === sp.id),
                  onClick: () => {
                    appState.onboardingActiveTpl = sp.id;
                    renderOpsRecruitTab(snapshot);
                  },
                },
                `${sp.shortTitle}${sp.signedFlag ? ' ✓' : ''}`
              )
            )
          ),
          h(
            'div',
            { className: 'step-pill-group' },
            h(
              'button',
              {
                type: 'button',
                className: !appState.onboardingCompareMode
                  ? 'btn btn-primary btn-sm'
                  : 'btn btn-secondary btn-sm',
                'aria-pressed': String(!appState.onboardingCompareMode),
                onClick: () => {
                  appState.onboardingCompareMode = false;
                  renderOpsRecruitTab(snapshot);
                },
              },
              '반영된 양식 보기'
            ),
            h(
              'button',
              {
                type: 'button',
                className: appState.onboardingCompareMode
                  ? 'btn btn-primary btn-sm'
                  : 'btn btn-secondary btn-sm',
                'aria-pressed': String(appState.onboardingCompareMode),
                onClick: () => {
                  appState.onboardingCompareMode = true;
                  renderOpsRecruitTab(snapshot);
                },
              },
              '기본양식 ↔ 변경양식 비교'
            )
          )
        ),
        viewerBodyWrap
      )
    )
  );

  renderOnboardingDocIntoPane();

  const visibleContracts = applyStarFilter(rec.contractLedger);
  const contractSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '근로계약 · 보안서약 · 개인정보동의 현황'),
      h(
        'div',
        { className: 'step-pill-group' },
        renderRosterSyncControls(rec.contractLedger, renderOpsRecruitTab)
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
            renderMasterSelectHeaderTh(rec.contractLedger, '근로계약 현황'),
            h('th', { scope: 'col' }, '사번 · 이름 · 부서'),
            h('th', { scope: 'col' }, '입사일 · 수습만료'),
            h('th', { scope: 'col', className: 'num' }, '계약 기준액'),
            h('th', { scope: 'col' }, '입사 필수 3종 서명 상태'),
            h('th', { scope: 'col' }, '4대보험'),
            h('th', { scope: 'col' }, '서식 · 전자서명 연결')
          )
        ),
        h(
          'tbody',
          {},
          visibleContracts.length === 0
            ? [
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { colspan: '7' },
                    rec.contractLedger.length === 0
                      ? '등록된 직원이 없습니다.'
                      : '표시할 별표(★) 직원이 없습니다.'
                  )
                ),
              ]
            : visibleContracts.map((c) =>
                h(
                  'tr',
                  {},
                  renderMasterMarkTd(c),
                  h(
                    'td',
                    { 'data-label': '사번 · 이름 · 부서' },
                    h('div', { className: 'cell-emp-code' }, c.empCode),
                    h('div', { className: 'breakable-name' }, c.displayName),
                    h('div', { className: 'cell-dept-name' }, c.deptName)
                  ),
                  h(
                    'td',
                    { 'data-label': '입사일 · 수습만료' },
                    h('div', {}, c.hireDate),
                    h('div', { className: 'cell-dept-name' }, `수습 ~${c.probationEndsOn}`)
                  ),
                  h(
                    'td',
                    { className: 'num', 'data-label': '계약 기준액' },
                    fmtWon(c.baseMonthlyPay),
                    h(
                      'div',
                      { className: 'cell-dept-name' },
                      c.workerCategory === 'BIZ_33' ? '위탁계약' : `주 ${c.weeklyHours}h`
                    )
                  ),
                  h(
                    'td',
                    { 'data-label': '입사 필수 3종 서명 상태' },
                    h(
                      'div',
                      { className: 'step-pill-group' },
                      h(
                        'span',
                        { className: c.employmentContractSigned ? 'tag tag-green' : 'tag tag-red' },
                        c.employmentContractSigned ? '근로계약 ✓' : '근로계약 미서명'
                      ),
                      h(
                        'span',
                        { className: c.privacyConsentSigned ? 'tag tag-green' : 'tag tag-amber' },
                        c.privacyConsentSigned ? '개인정보동의 ✓' : '동의서 미서명'
                      ),
                      h(
                        'span',
                        { className: c.ndaPledgeSigned ? 'tag tag-green' : 'tag tag-amber' },
                        c.ndaPledgeSigned ? '보안서약 ✓' : '보안서약 미서명'
                      )
                    )
                  ),
                  h(
                    'td',
                    { 'data-label': '4대보험' },
                    c.workerCategory === 'BIZ_33'
                      ? h('span', { className: 'tag tag-gray' }, '3.3% 원천세')
                      : h(
                          'div',
                          { className: 'step-pill-group' },
                          h('span', { className: 'tag tag-blue' }, c.nhisAcquired ? '국민·건보' : '건보제외'),
                          h('span', { className: 'tag tag-blue' }, '고용·산재')
                        )
                  ),
                  h(
                    'td',
                    { 'data-label': '서식 · 전자서명 연결' },
                    h(
                      'div',
                      { className: 'step-pill-group' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: c.allOnboardingSigned
                            ? 'btn btn-secondary btn-sm'
                            : 'btn btn-primary btn-sm',
                          onClick: () =>
                            openWorkerInOnboardingStudio(c.empCode, 'DOC_EMPLOYMENT_CONTRACT'),
                        },
                        c.allOnboardingSigned ? '입사 3종 열람·재서명' : '입사 3종 자동기입·서명'
                      )
                    )
                  )
                )
              )
        )
      )
    )
  );

  wrap.replaceChildren(onboardingStudioSection, contractSection, applicantTable);
}

function renderOpsOrgTab(snapshot) {
  const wrap = document.getElementById('ops-org-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const allWorkers = snapshot.workers || [];
  const regularWorkers = allWorkers.filter(
    (w) => w.workerCategory !== 'DAILY' && w.workerCategory !== 'BIZ_33'
  );
  const visibleWorkers = applyStarFilter(allWorkers);

  const catLabels = {
    REGULAR: '정규직',
    FIXED_TERM: '기간제',
    PART_TIME: '단시간',
    DAILY: '일용직',
    BIZ_33: '3.3% 사업소득',
  };

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
      h('label', { for: 'asg-emp-select' }, '발령 대상 직원'),
      h(
        'select',
        { id: 'asg-emp-select', name: 'asgEmp', disabled: regularWorkers.length === 0 },
        regularWorkers.length === 0
          ? [h('option', { value: '' }, '직원 없음')]
          : regularWorkers.map((w) =>
              h('option', { value: w.empCode }, `No.${w.rowNo} ${w.empCode} ${w.displayName} (${w.deptName})`)
            )
      )
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'asg-type-select' }, '발령 구분'),
      h(
        'select',
        { id: 'asg-type-select', name: 'asgType' },
        h('option', { value: 'PROMOTION' }, '승진 (+6%)'),
        h('option', { value: 'TRANSFER' }, '부서 이동'),
        h('option', { value: 'PARENTAL_LEAVE' }, '육아휴직'),
        h('option', { value: 'RETURN_TO_WORK' }, '복직')
      )
    ),
    h(
      'div',
      { className: 'field' },
      h('label', { for: 'asg-dept-input' }, '이동 부서'),
      h('input', { id: 'asg-dept-input', name: 'asgDept', type: 'text', value: '기업부설연구소' })
    ),
    h(
      'div',
      { className: 'field' },
      h(
        'button',
        { type: 'submit', className: 'btn btn-primary full-width', disabled: regularWorkers.length === 0 },
        '발령 적용'
      )
    )
  );

  const rosterAndCertSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '직원 명부 (전 메뉴 번호 · 사번 동기화)'),
      renderRosterSyncControls(allWorkers, renderOpsOrgTab)
    ),
    assignForm,
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '직원 명부' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            renderMasterSelectHeaderTh(allWorkers, '직원 명부'),
            h('th', { scope: 'col' }, '사번 · 이름'),
            h('th', { scope: 'col' }, '부서 · 고용구분'),
            h('th', { scope: 'col' }, '상태'),
            h('th', { scope: 'col', className: 'num' }, '기준 급여'),
            h('th', { scope: 'col' }, '서류 · 명세서')
          )
        ),
        h(
          'tbody',
          {},
          visibleWorkers.length === 0
            ? [
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { colspan: '6' },
                    allWorkers.length === 0 ? '등록된 직원이 없습니다.' : '표시할 별표(★) 직원이 없습니다.'
                  )
                ),
              ]
            : visibleWorkers.map((w) => {
                const refPay =
                  w.baseMonthlyPay || w.contractFee || (w.dailyWage || 0) * (w.dailyWorkDays || 0);
                return h(
                  'tr',
                  {},
                  renderMasterMarkTd(w),
                  h(
                    'td',
                    { 'data-label': '사번 · 이름' },
                    h('div', { className: 'cell-emp-code' }, w.empCode),
                    h('div', { className: 'breakable-name' }, w.displayName)
                  ),
                  h(
                    'td',
                    { 'data-label': '부서 · 고용구분' },
                    h('div', {}, w.deptName),
                    h(
                      'div',
                      { className: 'cell-dept-name' },
                      `${catLabels[w.workerCategory] || w.workerCategory} · ${w.jobTitle || '담당'}`
                    )
                  ),
                  h(
                    'td',
                    { 'data-label': '상태' },
                    h(
                      'span',
                      { className: (w.unpaidLeaveDays || 0) > 0 ? 'tag tag-amber' : 'tag tag-green' },
                      (w.unpaidLeaveDays || 0) > 0 ? `휴직 (${w.unpaidLeaveDays}일)` : '재직'
                    )
                  ),
                  h('td', { className: 'num', 'data-label': '기준 급여' }, fmtWon(refPay)),
                  h(
                    'td',
                    { 'data-label': '서류 · 명세서' },
                    h(
                      'div',
                      { className: 'step-pill-group' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-primary btn-sm',
                          onClick: () => openWorkerInOnboardingStudio(w.empCode),
                        },
                        '입사 3종 서식 · 서명'
                      ),
                      w.workerCategory !== 'BIZ_33'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'btn btn-secondary btn-sm',
                              onClick: (e) =>
                                openDocumentPreview('DOC_EMPLOYMENT_CERT', e.currentTarget, undefined, w.empCode),
                            },
                            '재직증명서'
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-secondary btn-sm',
                          onClick: (e) => openPayslipByEmpCode(w.empCode, e.currentTarget),
                        },
                        '급여명세서'
                      )
                    )
                  )
                );
              })
        )
      )
    )
  );

  wrap.replaceChildren(rosterAndCertSection);
}

const CLIENT_FIXED_HOLIDAYS = Object.freeze({
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

const CLIENT_YEAR_HOLIDAYS = Object.freeze({
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

function getClientStatutoryHolidayName(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return null;
  if (Object.hasOwn(CLIENT_YEAR_HOLIDAYS, isoDate)) return CLIENT_YEAR_HOLIDAYS[isoDate];
  const md = isoDate.slice(5, 10);
  if (Object.hasOwn(CLIENT_FIXED_HOLIDAYS, md)) return CLIENT_FIXED_HOLIDAYS[md];
  return null;
}

function computeClientAutoShift(date, clockIn, clockOut, breakHoursRaw, customHoliday = false) {
  const hhmmRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const inM = String(clockIn || '').trim().match(hhmmRe);
  const outM = String(clockOut || '').trim().match(hhmmRe);
  if (!inM || !outM) {
    return { valid: false, error: '출근·퇴근 시각(HH:MM)을 올바르게 입력해 주세요.' };
  }
  const inMin = Number(inM[1]) * 60 + Number(inM[2]);
  const rawOutMin = Number(outM[1]) * 60 + Number(outM[2]);
  if (inMin === rawOutMin) {
    return { valid: false, error: '출근 시각과 퇴근 시각이 동일합니다. 미출근일은 휴무로 지정해 주세요.' };
  }
  const endMin = rawOutMin < inMin ? rawOutMin + 1440 : rawOutMin;
  const grossHours = (endMin - inMin) / 60;

  let brk =
    breakHoursRaw === '' || breakHoursRaw === undefined || breakHoursRaw === null
      ? grossHours >= 9
        ? 1
        : grossHours >= 4.5
          ? 0.5
          : 0
      : Number(breakHoursRaw);
  if (!Number.isFinite(brk) || brk < 0) brk = 0;
  if (brk >= grossHours) {
    return { valid: false, error: '휴게시간이 총 체류시간 이상입니다.' };
  }
  const netWorked = Number(Math.max(0, grossHours - brk).toFixed(1));
  const overlap = (aS, aE, bS, bE) => Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
  const nightMin =
    overlap(inMin, endMin, 0, 7 * 60) +
    overlap(inMin, endMin, 22 * 60, 31 * 60) +
    overlap(inMin, endMin, 46 * 60, 55 * 60);
  const nightHours = Number(Math.min(netWorked, nightMin / 60).toFixed(1));

  const pubHoliday = getClientStatutoryHolidayName(date);
  const [y, m, d] = String(date || '2026-11-02').split('-').map(Number);
  const wd = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  const isSunday = wd === 0;
  const isHol = Boolean(pubHoliday) || isSunday || customHoliday === true;
  const holidayReason = pubHoliday || (isSunday ? '주휴일(일요일)' : customHoliday ? '지정 공휴일' : null);

  if (isHol) {
    return {
      valid: true,
      netWorked,
      breakHours: brk,
      normalHours: 0,
      overtimeHours: 0,
      nightHours,
      holidayHours: netWorked,
      holidayGt8Hours: Number(Math.max(0, netWorked - 8).toFixed(1)),
      autoOvertime: netWorked > 8,
      autoNight: nightHours > 0,
      autoHoliday: netWorked > 0,
      holidayReason,
    };
  }
  const normalHours = Number(Math.min(8, netWorked).toFixed(1));
  const overtimeHours = Number(Math.max(0, netWorked - 8).toFixed(1));
  return {
    valid: true,
    netWorked,
    breakHours: brk,
    normalHours,
    overtimeHours,
    nightHours,
    holidayHours: 0,
    holidayGt8Hours: 0,
    autoOvertime: overtimeHours > 0,
    autoNight: nightHours > 0,
    autoHoliday: false,
    holidayReason: null,
  };
}

function openAttCalendarModal(empCode, triggerEl = null) {
  if (!appState.snapshot) return;
  const modal = document.getElementById('att-calendar-modal');
  const modPopup = document.getElementById('module-popup-modal');
  if (!modal) return;
  const wasHidden = modal.hidden;
  if (empCode) {
    appState.selectedEmpCode = empCode;
  }
  if (wasHidden) {
    appState.lastFocusedBeforeAttModal = triggerEl || document.activeElement;
  }
  renderOpsAttendanceTab(appState.snapshot);
  renderAttCalendarModalContent(appState.snapshot);
  setBackgroundInert(true);
  if (modPopup && !modPopup.hidden) {
    modPopup.inert = true;
    modPopup.setAttribute('aria-hidden', 'true');
  }
  modal.hidden = false;
  modal.inert = false;
  modal.removeAttribute('aria-hidden');
  if (wasHidden) {
    document.getElementById('att-cal-close-btn')?.focus();
  }
}

function closeAttCalendarModal(restoreFocus = true) {
  const modal = document.getElementById('att-calendar-modal');
  const modPopup = document.getElementById('module-popup-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (modPopup && !modPopup.hidden) {
    modPopup.inert = false;
    modPopup.removeAttribute('aria-hidden');
  } else {
    setBackgroundInert(false);
  }
  if (appState.snapshot) {
    renderOpsAttendanceTab(appState.snapshot);
  }
  if (restoreFocus) {
    const prev = appState.lastFocusedBeforeAttModal;
    if (
      prev &&
      prev !== document.body &&
      prev.isConnected &&
      !prev.closest('[hidden]') &&
      typeof prev.focus === 'function'
    ) {
      prev.focus();
    } else if (appState.selectedEmpCode) {
      const recreatedBtn = Array.from(document.querySelectorAll('[data-att-cal-btn]')).find(
        (b) => b.dataset.attCalBtn === appState.selectedEmpCode && !b.closest('[hidden]')
      );
      recreatedBtn?.focus();
    }
  }
}

function renderAttCalendarModalContent(snapshot) {
  const bodyEl = document.getElementById('att-cal-modal-body');
  const titleEl = document.getElementById('att-cal-modal-title');
  const subEl = document.getElementById('att-cal-modal-subtitle');
  if (!bodyEl || !snapshot?.operationsSuite) return;

  const att = snapshot.operationsSuite.attendanceControl;
  const notice = snapshot.monthlyStartNotice || null;
  const selectedCode = resolveSelectedWorkerCode(att.board);
  const selectedRow = att.board.find((r) => r.empCode === selectedCode) || att.board[0] || null;
  if (!selectedRow || !selectedRow.monthlyCalendar) {
    bodyEl.replaceChildren(h('div', { className: 'empty-state' }, '표시할 직원 근태 캘린더가 없습니다.'));
    return;
  }

  const cal = selectedRow.monthlyCalendar;
  const ym = cal.yearMonth;
  if (!appState.selectedAttDate || !appState.selectedAttDate.startsWith(`${ym}-`)) {
    appState.selectedAttDate = cal.days[0]?.date || `${ym}-01`;
  }
  const activeDay = cal.days.find((d) => d.date === appState.selectedAttDate) || cal.days[0];

  if (titleEl) {
    titleEl.textContent = `[월간 근태 캘린더] No.${selectedRow.rowNo} ${selectedRow.displayName} (${selectedRow.empCode} · ${selectedRow.deptName})`;
  }
  if (subEl) {
    const scaleTxt = notice ? ` · ${notice.scaleBadge}` : '';
    subEl.textContent = `${ym} 귀속 | 출근 ${cal.workDaysCount}일 · 정상 ${cal.totalNormalHours}h · 8h초과 연장 ${cal.totalOvertimeHours}h · 야간(22~07시) ${cal.totalNightHours}h · 휴일 ${cal.totalHolidayHours}h${scaleTxt}`;
  }

  const changeMonthInModal = (nextYm, triggerEl) => {
    if (!nextYm) return;
    appState.selectedAttDate = `${nextYm}-01`;
    runOpsAction({ actionType: 'SET_ATTENDANCE_MONTH', yearMonth: nextYm }, triggerEl);
  };

  const modalTopToolbar = h(
    'div',
    { className: 'ops-section-head' },
    h(
      'div',
      { className: 'step-pill-group' },
      h(
        'select',
        {
          className: 'month-input-box',
          'aria-label': '캘린더 대상 직원 선택',
          onChange: (e) => {
            appState.selectedEmpCode = e.currentTarget.value;
            renderAttCalendarModalContent(snapshot);
            renderOpsAttendanceTab(snapshot);
          },
        },
        ...att.board.map((r) =>
          h(
            'option',
            { value: r.empCode, selected: r.empCode === selectedRow.empCode },
            `No.${r.rowNo} ${r.displayName} (${r.empCode} · ${r.deptName})`
          )
        )
      ),
      h(
        'div',
        { className: 'month-nav-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            'aria-label': '이전 달',
            onClick: (e) => changeMonthInModal(shiftYearMonth(ym, -1), e.currentTarget),
          },
          '◀'
        ),
        h('input', {
          type: 'month',
          className: 'month-input-box',
          value: ym,
          'aria-label': '캘린더 연월 선택',
          onChange: (e) => changeMonthInModal(e.currentTarget.value, e.currentTarget),
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            'aria-label': '다음 달',
            onClick: (e) => changeMonthInModal(shiftYearMonth(ym, 1), e.currentTarget),
          },
          '▶'
        )
      ),
      h(
        'button',
        {
          type: 'button',
          className: ym === '2026-10' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
          onClick: (e) => {
            appState.selectedAttDate = '2026-10-09';
            runOpsAction({ actionType: 'SET_ATTENDANCE_MONTH', yearMonth: '2026-10' }, e.currentTarget);
          },
        },
        '2026-10 (개천절·한글날)'
      ),
      h(
        'button',
        {
          type: 'button',
          className: ym === '2026-11' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
          onClick: (e) => {
            appState.selectedAttDate = '2026-11-11';
            runOpsAction({ actionType: 'SET_ATTENDANCE_MONTH', yearMonth: '2026-11' }, e.currentTarget);
          },
        },
        '2026-11 (당월)'
      )
    ),
    notice
      ? h(
          'div',
          { className: 'step-pill-group' },
          h(
            'span',
            {
              className: notice.hasChanges
                ? notice.checked
                  ? 'tag tag-green'
                  : 'tag tag-amber'
                : 'tag tag-blue',
            },
            notice.hasChanges ? `★ ${notice.monthStartBadgeText}` : notice.monthStartBadgeText
          ),
          notice.hasChanges
            ? h(
                'button',
                {
                  type: 'button',
                  className: notice.checked ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
                  'aria-pressed': String(Boolean(notice.checked)),
                  onClick: (e) =>
                    runOpsAction(
                      {
                        actionType: 'ACK_MONTHLY_CHANGE_NOTICE',
                        checked: !notice.checked,
                        expectedSignature: notice.signature,
                      },
                      e.currentTarget
                    ),
                },
                notice.checked ? '☑ 월초 변화 확인완료' : '☐ 월초 변화 확인 체크'
              )
            : null
        )
      : null
  );

  const blankCells = Array.from({ length: cal.firstWeekdayIdx }, () =>
    h('div', { className: 'att-cal-empty', 'aria-hidden': 'true' })
  );

  const dayCells = cal.days.map((d) => {
    const isSundayOrHol = d.weekdayIdx === 0 || Boolean(d.isStatutoryHoliday) || Boolean(d.holidayName);
    const classes = ['att-day-cell'];
    if (d.workStatus === 'OFF') classes.push('is-off');
    if (d.overtimeHours > 0 || d.workStatus === 'HOLIDAY_WORK') classes.push('is-overtime');
    if (d.isStatutoryHoliday) classes.push('is-holiday-cell');
    if (d.workStatus === 'LEAVE' || d.workStatus === 'HALF_LEAVE') classes.push('is-leave');
    if (d.day === 1 && notice?.hasChanges) classes.push('is-month-start-changed');
    if (activeDay && activeDay.date === d.date) classes.push('is-active-day');

    const totalWorked = Number(
      ((d.normalHours || 0) + (d.overtimeHours || 0) + (d.holidayHours || 0)).toFixed(1)
    );

    // 1일(월초) 셀 내 사업장 규모 및 당월 급여·기준 변경 표시
    const monthStartPill =
      d.day === 1 && notice
        ? h(
            'div',
            {
              className: notice.hasChanges
                ? notice.checked
                  ? 'cal-month-start-badge is-acked'
                  : 'cal-month-start-badge is-alert'
                : 'cal-month-start-badge',
            },
            notice.hasChanges
              ? notice.scaleTransitioned
                ? `★ 월초: ${notice.is5OrMore ? '5인 이상' : '5인 미만'} 전환`
                : `★ 월초: 급여·기준 변경${notice.checked ? '(확인)' : ''}`
              : `월초 기준: ${notice.is5OrMore ? '5인 이상' : '5인 미만'}`
          )
        : null;

    const topRightTag = d.holidayName
      ? h('span', { className: 'att-day-holiday-tag' }, d.holidayName)
      : h(
          'span',
          {
            className:
              d.workStatus === 'LEAVE' || d.workStatus === 'HALF_LEAVE'
                ? 'tag tag-blue'
                : d.overtimeHours > 0 || d.nightHours > 0
                  ? 'tag tag-amber'
                  : d.workStatus === 'WORK'
                    ? 'tag tag-green'
                    : 'tag tag-gray',
          },
          d.statusLabel
        );

    const timeLine =
      d.clockIn && d.clockIn !== '-'
        ? h(
            'div',
            { className: 'att-day-time' },
            `${d.clockIn} ~ ${d.clockOut}${d.breakHours ? ` (휴게 ${d.breakHours}h)` : ''}`
          )
        : h(
            'div',
            { className: 'att-day-time' },
            d.workStatus === 'LEAVE'
              ? '유급연차 종일'
              : d.workStatus === 'HALF_LEAVE'
                ? '반차 사용'
                : d.holidayName || '휴무'
          );

    const chips = [];
    if (d.normalHours > 0) {
      chips.push(h('span', { className: 'att-chip' }, `정상 ${d.normalHours}h`));
    }
    if (d.overtimeHours > 0) {
      chips.push(h('span', { className: 'att-chip att-chip-ot' }, `☑연장 ${d.overtimeHours}h`));
    }
    if (d.nightHours > 0) {
      chips.push(h('span', { className: 'att-chip att-chip-night' }, `☑야간 ${d.nightHours}h`));
    }
    if (d.holidayHours > 0) {
      const gt8 = Number(Math.max(0, d.holidayHours - 8).toFixed(1));
      chips.push(
        h(
          'span',
          { className: 'att-chip att-chip-hol' },
          gt8 > 0 ? `☑휴일 ${d.holidayHours}h(8h+${gt8}h)` : `☑휴일 ${d.holidayHours}h`
        )
      );
    }
    if (d.workStatus === 'LEAVE' || d.workStatus === 'HALF_LEAVE') {
      chips.push(
        h(
          'span',
          { className: 'att-chip att-chip-leave' },
          d.workStatus === 'LEAVE' ? '연차 8h' : '반차 4h'
        )
      );
    }

    return h(
      'button',
      {
        type: 'button',
        className: classes.join(' '),
        'aria-pressed': String(Boolean(activeDay && activeDay.date === d.date)),
        'aria-label': `${d.date}(${d.weekday}) ${d.statusLabel} ${totalWorked}시간`,
        onClick: () => {
          appState.selectedAttDate = d.date;
          renderAttCalendarModalContent(snapshot);
        },
      },
      monthStartPill,
      h(
        'div',
        { className: 'att-day-top' },
        h(
          'span',
          { className: isSundayOrHol ? 'att-day-num is-sunday-or-hol' : 'att-day-num' },
          `${d.day}일 (${d.weekday})`
        ),
        topRightTag
      ),
      timeLine,
      chips.length > 0 ? h('div', { className: 'att-day-chips' }, ...chips) : null
    );
  });

  // 선택 일자 출근~퇴근 시각 기반 자동 판정(연장 >8h · 야간 22~07시 · 법정공휴일 휴일근로) 에디터
  const statutoryName = getClientStatutoryHolidayName(activeDay.date);
  const isFixedOrSunHoliday = Boolean(statutoryName) || activeDay.weekdayIdx === 0;
  const initialMode =
    activeDay.workStatus === 'LEAVE' ||
    activeDay.workStatus === 'HALF_LEAVE' ||
    activeDay.workStatus === 'OFF'
      ? activeDay.workStatus
      : 'AUTO';
  const defaultIn = activeDay.clockIn && activeDay.clockIn !== '-' ? activeDay.clockIn : '09:00';
  const defaultOut = activeDay.clockOut && activeDay.clockOut !== '-' ? activeDay.clockOut : '18:00';
  const hasSavedShift =
    activeDay.clockIn &&
    activeDay.clockIn !== '-' &&
    (activeDay.workStatus === 'WORK' || activeDay.workStatus === 'HOLIDAY_WORK');
  const defaultBreak =
    hasSavedShift && activeDay.breakHours !== undefined && activeDay.breakHours !== null
      ? activeDay.breakHours
      : 1;
  const defaultCustomHol =
    isFixedOrSunHoliday || (activeDay.workStatus === 'HOLIDAY_WORK' && !isFixedOrSunHoliday);

  const previewBar = h('div', { className: 'auto-check-preview-bar', 'aria-live': 'polite' });

  const refreshAutoPreview = (formEl) => {
    if (!formEl) return;
    const modeVal = formEl.querySelector('[name="dayMode"]')?.value || 'AUTO';
    const inInput = formEl.querySelector('[name="dayIn"]');
    const outInput = formEl.querySelector('[name="dayOut"]');
    const brkInput = formEl.querySelector('[name="dayBreak"]');
    const holChk = formEl.querySelector('[name="dayCustomHol"]');
    const isTimeDisabled = modeVal !== 'AUTO';
    if (inInput) inInput.disabled = isTimeDisabled;
    if (outInput) outInput.disabled = isTimeDisabled;
    if (brkInput) brkInput.disabled = isTimeDisabled;
    if (holChk) holChk.disabled = isTimeDisabled || isFixedOrSunHoliday;

    if (modeVal !== 'AUTO') {
      const modeText =
        modeVal === 'LEAVE'
          ? '유급 연차휴가 (8시간 유급 반영 · 연장/야간/휴일 해당 없음)'
          : modeVal === 'HALF_LEAVE'
            ? '반차휴가 (소정 4시간 근무 + 연차 0.5일 차감)'
            : '휴무일 (미출근 · 근로시간 0h)';
      previewBar.replaceChildren(
        h('span', { className: 'tag tag-blue' }, modeText),
        h(
          'span',
          { className: 'cell-dept-name' },
          notice?.is5OrMore ? '5인 이상 가산율 기준 연동' : '5인 미만(1.0배) 기준 연동'
        )
      );
      return;
    }

    const res = computeClientAutoShift(
      activeDay.date,
      inInput?.value || '09:00',
      outInput?.value || '18:00',
      brkInput?.value ?? '1',
      isFixedOrSunHoliday || Boolean(holChk?.checked)
    );
    if (!res.valid) {
      previewBar.replaceChildren(h('span', { className: 'tag tag-red' }, res.error));
      return;
    }

    const otHoursDisplay = res.autoHoliday ? res.holidayGt8Hours : res.overtimeHours;
    previewBar.replaceChildren(
      h(
        'div',
        { className: 'auto-check-group' },
        h(
          'span',
          { className: res.autoOvertime ? 'auto-check-pill is-checked-ot' : 'auto-check-pill' },
          `${res.autoOvertime ? '☑' : '☐'} 8시간 초과 연장근로${res.autoOvertime ? ` (${otHoursDisplay}h)` : ''}`
        ),
        h(
          'span',
          { className: res.autoNight ? 'auto-check-pill is-checked-night' : 'auto-check-pill' },
          `${res.autoNight ? '☑' : '☐'} 야간근로 22:00~07:00${res.autoNight ? ` (${res.nightHours}h)` : ''}`
        ),
        h(
          'span',
          { className: res.autoHoliday ? 'auto-check-pill is-checked-hol' : 'auto-check-pill' },
          `${res.autoHoliday ? '☑' : '☐'} 휴일근로${res.autoHoliday ? ` (${res.holidayReason} · ${res.holidayHours}h)` : ''}`
        )
      ),
      h(
        'div',
        { className: 'cell-dept-name' },
        `실근로 총 ${res.netWorked}h (휴게 ${res.breakHours}h 공제) · ${notice?.is5OrMore ? '5인 이상 50%/100% 가산 자동반영' : '5인 미만 1.0배 자동반영'}`
      )
    );
  };

  let dayEditor = null;
  if (selectedRow.workerCategory === 'BIZ_33') {
    dayEditor = h(
      'div',
      { className: 'att-day-editor' },
      '3.3% 사업소득 계약자는 출퇴근 시간 통제 대상이 아니며 위탁 결과물 기준으로 정산됩니다.'
    );
  } else {
    const formEl = h(
      'form',
      {
        className: 'att-day-editor code-diff-box',
        onInput: (e) => refreshAutoPreview(e.currentTarget),
        onChange: (e) => refreshAutoPreview(e.currentTarget),
        onSubmit: (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const modeVal = f.querySelector('[name="dayMode"]').value;
          const memoVal = f.querySelector('[name="dayMemo"]').value;
          if (modeVal === 'AUTO') {
            const rawBreakStr = String(f.querySelector('[name="dayBreak"]').value ?? '').trim();
            runOpsAction(
              {
                actionType: 'SET_DAILY_ATTENDANCE',
                empCode: selectedRow.empCode,
                date: activeDay.date,
                workStatus: 'AUTO',
                autoClassify: true,
                clockIn: f.querySelector('[name="dayIn"]').value,
                clockOut: f.querySelector('[name="dayOut"]').value,
                breakHours: rawBreakStr === '' ? undefined : Number(rawBreakStr),
                customHoliday:
                  isFixedOrSunHoliday || Boolean(f.querySelector('[name="dayCustomHol"]')?.checked),
                memo: memoVal,
              },
              f.querySelector('button[type="submit"]')
            );
          } else {
            runOpsAction(
              {
                actionType: 'SET_DAILY_ATTENDANCE',
                empCode: selectedRow.empCode,
                date: activeDay.date,
                workStatus: modeVal,
                memo: memoVal,
              },
              f.querySelector('button[type="submit"]')
            );
          }
        },
      },
      h(
        'div',
        { className: 'ops-section-head' },
        h(
          'div',
          { className: 'step-pill-group' },
          h(
            'strong',
            { className: 'ops-section-title' },
            `선택일 근무시간 설정: ${activeDay.date} (${activeDay.weekday})`
          ),
          h('span', { className: 'code-diff-pill' }, '변경됨 · 출퇴근 시각 입력 시 연장·야간·공휴일 자동 체크'),
          statutoryName
            ? h('span', { className: 'att-day-holiday-tag' }, `법정공휴일: ${statutoryName}`)
            : activeDay.weekdayIdx === 0
              ? h('span', { className: 'att-day-holiday-tag' }, '주휴일(일요일)')
              : null
        ),
        h(
          'div',
          { className: 'step-pill-group' },
          h(
            'label',
            { className: 'check-label' },
            h('input', {
              type: 'checkbox',
              name: 'dayCustomHol',
              checked: defaultCustomHol,
              disabled: isFixedOrSunHoliday,
            }),
            h(
              'span',
              {},
              isFixedOrSunHoliday
                ? `법정공휴일·주휴일 자동체크됨 (${statutoryName || '일요일'})`
                : '공휴일·약정휴일 출근으로 체크'
            )
          )
        )
      ),
      previewBar,
      h(
        'div',
        { className: 'ops-inline-form' },
        h(
          'div',
          { className: 'field' },
          h('label', { for: 'att-day-mode' }, '근무 구분'),
          h(
            'select',
            { id: 'att-day-mode', name: 'dayMode' },
            [
              ['AUTO', '출근~퇴근 자동판정 (연장·야간·휴일 자동체크)'],
              ['LEAVE', '연차휴가 (종일 8h)'],
              ['HALF_LEAVE', '반차휴가 (4h)'],
              ['OFF', '휴무 (미출근)'],
            ].map(([val, lbl]) => h('option', { value: val, selected: initialMode === val }, lbl))
          )
        ),
        h(
          'div',
          { className: 'field' },
          h('label', { for: 'att-day-in' }, '출근 시각'),
          h('input', {
            id: 'att-day-in',
            name: 'dayIn',
            type: 'time',
            step: '600',
            value: defaultIn,
          })
        ),
        h(
          'div',
          { className: 'field' },
          h('label', { for: 'att-day-out' }, '퇴근 시각 (익일 새벽 가능)'),
          h('input', {
            id: 'att-day-out',
            name: 'dayOut',
            type: 'time',
            step: '600',
            value: defaultOut,
          })
        ),
        h(
          'div',
          { className: 'field' },
          h('label', { for: 'att-day-break' }, '휴게시간(h)'),
          h('input', {
            id: 'att-day-break',
            name: 'dayBreak',
            type: 'number',
            min: '0',
            max: '6',
            step: '0.5',
            value: String(defaultBreak),
          })
        ),
        h(
          'div',
          { className: 'field' },
          h('label', { for: 'att-day-memo' }, '메모'),
          h('input', {
            id: 'att-day-memo',
            name: 'dayMemo',
            type: 'text',
            placeholder: '예: 야간 특근, 성탄절 출근',
            value: activeDay.memo || '',
          })
        ),
        h(
          'div',
          { className: 'field' },
          h(
            'button',
            { type: 'submit', className: 'btn btn-primary full-width' },
            '자동체크 저장 · 급여명세서 반영'
          )
        )
      )
    );
    refreshAutoPreview(formEl);
    dayEditor = formEl;
  }

  bodyEl.replaceChildren(
    modalTopToolbar,
    h(
      'div',
      { className: 'att-calendar-scroll' },
      h(
        'div',
        {
          className: 'att-calendar-grid',
          role: 'group',
          'aria-label': `${selectedRow.displayName} ${ym} 월간 근태 캘린더`,
        },
        ...['일', '월', '화', '수', '목', '금', '토'].map((wName) =>
          h('div', { className: 'att-cal-weekday' }, wName)
        ),
        ...blankCells,
        ...dayCells
      )
    ),
    dayEditor
  );
}

function renderOpsAttendanceTab(snapshot) {
  const wrap = document.getElementById('ops-attendance-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const att = snapshot.operationsSuite.attendanceControl;
  const warnH = att.weeklyWarnHours ?? 48;
  const ym = att.selectedYearMonth || '2026-11';
  const visibleBoard = applyStarFilter(att.board);
  const selectedCode = resolveSelectedWorkerCode(att.board);
  const selectedRow = att.board.find((r) => r.empCode === selectedCode) || att.board[0] || null;
  const notice = snapshot.monthlyStartNotice || null;

  const changeMonth = (nextYm, triggerEl) => {
    if (!nextYm) return;
    appState.selectedAttDate = `${nextYm}-01`;
    runOpsAction({ actionType: 'SET_ATTENDANCE_MONTH', yearMonth: nextYm }, triggerEl);
  };

  const monthControls = h(
    'div',
    { className: 'month-nav-group' },
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        'aria-label': '이전 달 근태 보기',
        onClick: (e) => changeMonth(shiftYearMonth(ym, -1), e.currentTarget),
      },
      '◀'
    ),
    h('input', {
      type: 'month',
      className: 'month-input-box',
      value: ym,
      'aria-label': '근태 귀속 연월 선택',
      onChange: (e) => changeMonth(e.currentTarget.value, e.currentTarget),
    }),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        'aria-label': '다음 달 근태 보기',
        onClick: (e) => changeMonth(shiftYearMonth(ym, 1), e.currentTarget),
      },
      '▶'
    ),
    notice
      ? h(
          'span',
          { className: notice.hasChanges ? 'tag tag-amber' : 'tag tag-blue' },
          notice.hasChanges ? `★ ${notice.monthStartBadgeText}` : notice.scaleBadge
        )
      : null
  );

  const section = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h(
        'div',
        { className: 'step-pill-group' },
        h('h3', { className: 'ops-section-title' }, '출퇴근 · 근로시간 현황 (직원 클릭 시 월간 캘린더 팝업)'),
        h('span', { className: 'code-diff-pill' }, '변경됨 · 클릭 시 팝업 캘린더'),
        monthControls
      ),
      renderRosterSyncControls(att.board, renderOpsAttendanceTab)
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '근로시간 현황' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            renderMasterSelectHeaderTh(att.board, '출퇴근 · 근로시간 현황'),
            h('th', { scope: 'col' }, '사번 · 이름'),
            h('th', { scope: 'col' }, '근무형태 · 출근일'),
            h('th', { scope: 'col', className: 'num' }, '정상 · 연장 · 야간 · 휴일'),
            h('th', { scope: 'col' }, '주간 최대'),
            h('th', { scope: 'col' }, '상태'),
            h('th', { scope: 'col' }, '월간 캘린더 팝업')
          )
        ),
        h(
          'tbody',
          {},
          visibleBoard.length === 0
            ? [
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { colspan: '7' },
                    att.board.length === 0 ? '대상 직원이 없습니다.' : '표시할 별표(★) 직원이 없습니다.'
                  )
                ),
              ]
            : visibleBoard.map((row) => {
                const cal = row.monthlyCalendar;
                const isSelected = selectedRow && selectedRow.empCode === row.empCode;
                const progClass =
                  row.maxWeeklyWorkedHours > 52
                    ? 'meter-progress meter-progress-danger'
                    : row.maxWeeklyWorkedHours >= warnH
                      ? 'meter-progress meter-progress-warn'
                      : 'meter-progress';
                return h(
                  'tr',
                  {
                    className: isSelected ? 'emp-select-row is-selected-worker' : 'emp-select-row',
                    onClick: (e) => {
                      openAttCalendarModal(row.empCode, e.currentTarget);
                    },
                  },
                  renderMasterMarkTd(row),
                  h(
                    'td',
                    { 'data-label': '사번 · 이름' },
                    h('div', { className: 'cell-emp-code' }, row.empCode),
                    h('div', { className: 'breakable-name' }, row.displayName),
                    h('div', { className: 'cell-dept-name' }, row.deptName)
                  ),
                  h(
                    'td',
                    { 'data-label': '근무형태 · 출근일' },
                    h('span', { className: 'tag tag-gray' }, row.shiftType),
                    cal
                      ? h(
                          'div',
                          { className: 'cell-dept-name' },
                          `출근 ${cal.workDaysCount}일${cal.leaveDaysCount ? ` · 연차 ${cal.leaveDaysCount}일` : ''}`
                        )
                      : null
                  ),
                  h(
                    'td',
                    { className: 'num', 'data-label': '정상 · 연장 · 야간 · 휴일' },
                    row.workerCategory === 'BIZ_33'
                      ? '위탁계약 (시간통제 비대상)'
                      : `정상 ${cal?.totalNormalHours ?? 0}h · 연장 ${row.monthlyOvertimeHours}h · 야간 ${row.monthlyNightHours}h · 휴일 ${row.monthlyHolidayHours}h`
                  ),
                  h(
                    'td',
                    { 'data-label': '주간 최대' },
                    row.workerCategory === 'BIZ_33'
                      ? h('span', { className: 'cell-dept-name' }, '-')
                      : h(
                          'div',
                          { className: 'meter-wrap' },
                          h('progress', {
                            className: progClass,
                            'aria-label': `${row.displayName} 주간 근로시간`,
                            max: '52',
                            value: String(Math.min(52, row.maxWeeklyWorkedHours)),
                          }),
                          h('span', { className: 'cell-dept-name' }, `${row.maxWeeklyWorkedHours}h / 52h`)
                        )
                  ),
                  h(
                    'td',
                    { 'data-label': '상태' },
                    row.status === 'OVER_52H_ALERT'
                      ? h('span', { className: 'tag tag-red' }, '52h 초과')
                      : row.status === 'NEAR_52H_WARN'
                        ? h('span', { className: 'tag tag-amber' }, `주의 (${warnH}h+)`)
                        : row.status === 'PARENTAL_OR_LEAVE'
                          ? h('span', { className: 'tag tag-blue' }, '휴직')
                          : row.status === 'CONTRACTOR_33'
                            ? h('span', { className: 'tag tag-gray' }, '3.3% 위탁')
                            : h('span', { className: 'tag tag-green' }, '정상')
                  ),
                  h(
                    'td',
                    { 'data-label': '월간 캘린더 팝업', onClick: (e) => e.stopPropagation() },
                    h(
                      'div',
                      { className: 'step-pill-group' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-primary btn-sm',
                          dataset: { attCalBtn: row.empCode },
                          onClick: (e) => openAttCalendarModal(row.empCode, e.currentTarget),
                        },
                        '월간 캘린더 팝업'
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn btn-secondary btn-sm',
                          onClick: (e) => openPayslipByEmpCode(row.empCode, e.currentTarget),
                        },
                        '명세서'
                      )
                    )
                  )
                );
              })
        )
      )
    )
  );

  wrap.replaceChildren(section);
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
    if (stage === 'EXEMPT') {
      return h('span', { className: 'tag tag-gray' }, '비대상');
    }
    if (stage === 'STAGE_2_DESIGNATED') {
      return h('span', { className: 'tag tag-green' }, '2차 지정 완료');
    }
    if (stage === 'STAGE_1_SENT') {
      return h('span', { className: 'tag tag-blue' }, '1차 촉진 완료');
    }
    return h('span', { className: 'tag tag-amber' }, '촉진 대기');
  };

  if (wrap) {
    const visibleLedger = applyStarFilter(lv.ledger);
    const selectedCode = resolveSelectedWorkerCode(lv.ledger);
    const selectedLv = lv.ledger.find((r) => r.empCode === selectedCode) || lv.ledger[0] || null;
    const defaultUseDate = `${lv.selectedYearMonth || '2026-11'}-25`;
    const defaultAppliedDate = `${lv.selectedYearMonth || '2026-11'}-18`;

    const ledgerSection = h(
      'div',
      { className: 'ops-section-block' },
      h(
        'div',
        { className: 'ops-section-head' },
        h(
          'div',
          { className: 'step-pill-group' },
          h('h3', { className: 'ops-section-title' }, '직원별 연차 현황'),
          h('span', { className: 'tag tag-blue' }, leaveBasisLabel)
        ),
        h(
          'div',
          { className: 'step-pill-group' },
          renderRosterSyncControls(lv.ledger, renderOpsLeaveTab),
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
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
                      ? '연차 기준이 회계연도 기준으로 변경되었습니다.'
                      : '연차 기준이 입사일 기준으로 변경되었습니다.'
                  );
                } catch (err) {
                  showBanner(err.message, true);
                }
              },
            },
            isFiscal ? '입사일 기준으로 전환' : '회계연도 기준으로 전환'
          )
        )
      ),
      h(
        'div',
        { className: 'table-scroll-wrap' },
        h(
          'table',
          { className: 'payroll-table', 'aria-label': '직원별 연차 현황' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              renderMasterSelectHeaderTh(lv.ledger, '직원별 연차 현황'),
              h('th', { scope: 'col' }, '사번 · 이름'),
              h('th', { scope: 'col' }, '입사일 · 만료일'),
              h('th', { scope: 'col', className: 'num' }, '발생 (횟수 · 일수)'),
              h('th', { scope: 'col', className: 'num' }, '사용 (횟수 · 일수)'),
              h('th', { scope: 'col', className: 'num' }, '잔여 연차'),
              h('th', { scope: 'col', className: 'num' }, `당월(${lv.selectedYearMonth || '2026-11'}) 사용`),
              h('th', { scope: 'col' }, '신청·사용 기록')
            )
          ),
          h(
            'tbody',
            {},
            visibleLedger.length === 0
              ? [
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      { colspan: '8' },
                      lv.ledger.length === 0 ? '대상 직원이 없습니다.' : '표시할 별표(★) 직원이 없습니다.'
                    )
                  ),
                ]
              : visibleLedger.map((r) => {
                  const isSel = selectedLv && selectedLv.empCode === r.empCode;
                  return h(
                    'tr',
                    {
                      className: isSel ? 'emp-select-row is-selected-worker' : 'emp-select-row',
                      onClick: () => {
                        appState.selectedEmpCode = r.empCode;
                        renderOpsLeaveTab(snapshot);
                      },
                    },
                    renderMasterMarkTd(r),
                    h(
                      'td',
                      { 'data-label': '사번 · 이름' },
                      h('div', { className: 'cell-emp-code' }, r.empCode),
                      h('div', { className: 'breakable-name' }, r.displayName),
                      h('div', { className: 'cell-dept-name' }, r.deptName)
                    ),
                    h(
                      'td',
                      { 'data-label': '입사일 · 만료일' },
                      h('div', {}, r.hireDate),
                      h(
                        'div',
                        { className: 'cell-dept-name' },
                        r.leaveEligible ? `만료 ${r.cycleExpiryDate || '-'}` : r.ruleBasis
                      )
                    ),
                    h(
                      'td',
                      { className: 'num', 'data-label': '발생 (횟수 · 일수)' },
                      r.leaveEligible ? `${r.grantedCount}회 / ${r.accruedDays}일` : '-'
                    ),
                    h(
                      'td',
                      { className: 'num', 'data-label': '사용 (횟수 · 일수)' },
                      r.leaveEligible ? `${r.usedCount}회 / ${r.usedDays}일` : '-'
                    ),
                    h(
                      'td',
                      { className: 'num font-extrabold', 'data-label': '잔여 연차' },
                      r.leaveEligible ? `${r.remainingDays}일` : '-'
                    ),
                    h(
                      'td',
                      { className: 'num', 'data-label': '당월 사용' },
                      r.leaveEligible ? `${r.monthUsedCount}회 (${r.monthUsedDays}일)` : '-'
                    ),
                    h(
                      'td',
                      { 'data-label': '신청·사용 기록', onClick: (e) => e.stopPropagation() },
                      h(
                        'div',
                        { className: 'step-pill-group' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: isSel ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
                            'aria-pressed': String(Boolean(isSel)),
                            onClick: () => {
                              appState.selectedEmpCode = r.empCode;
                              renderOpsLeaveTab(snapshot);
                            },
                          },
                          isSel ? '기록 열림' : '기록 보기'
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'btn btn-secondary btn-sm',
                            onClick: (e) => openPayslipByEmpCode(r.empCode, e.currentTarget),
                          },
                          '명세서'
                        )
                      )
                    )
                  );
                })
          )
        )
      )
    );

    let leaveDetailCard = null;
    if (selectedLv) {
      const addLeaveForm = !selectedLv.leaveEligible
        ? h('div', { className: 'att-day-editor' }, selectedLv.ruleBasis)
        : h(
            'form',
            {
              className: 'ops-inline-form',
              onSubmit: (e) => {
                e.preventDefault();
                const f = e.currentTarget;
                const kindVal = f.querySelector('[name="lvKind"]').value;
                const [daysStr, typeLabel] = kindVal.split('|');
                runOpsAction(
                  {
                    actionType: 'ADD_LEAVE_USAGE',
                    empCode: selectedLv.empCode,
                    appliedAt: f.querySelector('[name="lvApplied"]').value,
                    useDate: f.querySelector('[name="lvUseDate"]').value,
                    days: Number(daysStr),
                    leaveType: typeLabel,
                    reason: f.querySelector('[name="lvReason"]').value,
                  },
                  f.querySelector('button[type="submit"]')
                );
              },
            },
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'lv-applied-input' }, '연차 신청일'),
              h('input', {
                id: 'lv-applied-input',
                name: 'lvApplied',
                type: 'date',
                value: defaultAppliedDate,
                required: true,
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'lv-use-input' }, '연차 사용일'),
              h('input', {
                id: 'lv-use-input',
                name: 'lvUseDate',
                type: 'date',
                value: defaultUseDate,
                required: true,
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'lv-kind-select' }, '구분 · 사용일수'),
              h(
                'select',
                { id: 'lv-kind-select', name: 'lvKind' },
                h('option', { value: '1|연차(1일)' }, '연차 (1일)'),
                h('option', { value: '0.5|오전반차(0.5일)' }, '오전반차 (0.5일)'),
                h('option', { value: '0.5|오후반차(0.5일)' }, '오후반차 (0.5일)'),
                h('option', { value: '2|연차(2일)' }, '연차 (2일)')
              )
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'lv-reason-input' }, '사유 · 메모'),
              h('input', {
                id: 'lv-reason-input',
                name: 'lvReason',
                type: 'text',
                value: '개인 연차 사용',
              })
            ),
            h(
              'div',
              { className: 'field' },
              h(
                'button',
                { type: 'submit', className: 'btn btn-primary full-width' },
                '연차 기록 추가 · 명세서 연동'
              )
            )
          );

      const indexedLeaveRecords = (selectedLv.records || []).map((recItem, idx) => ({
        ...recItem,
        rowNo: idx + 1,
      }));
      const visibleLeaveRecords = applyGenericStarFilter(
        snapshot,
        'leaveRecords',
        indexedLeaveRecords,
        (r) => r.recordId
      );

      const recordsTable = selectedLv.leaveEligible
        ? h(
            'div',
            { className: 'table-scroll-wrap' },
            h(
              'table',
              { className: 'payroll-table', 'aria-label': `${selectedLv.displayName} 연차 신청 및 사용 이력` },
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  renderGenericSelectHeaderTh(
                    snapshot,
                    'leaveRecords',
                    indexedLeaveRecords,
                    (r) => r.recordId,
                    '연차 신청 및 사용 이력'
                  ),
                  h('th', { scope: 'col' }, '회차'),
                  h('th', { scope: 'col' }, '신청일자'),
                  h('th', { scope: 'col' }, '사용일자'),
                  h('th', { scope: 'col', className: 'num' }, '구분 · 사용일수'),
                  h('th', { scope: 'col' }, '사유'),
                  h('th', { scope: 'col' }, '관리')
                )
              ),
              h(
                'tbody',
                {},
                visibleLeaveRecords.length === 0
                  ? [
                      h(
                        'tr',
                        {},
                        h(
                          'td',
                          { colspan: '7' },
                          indexedLeaveRecords.length === 0
                            ? '등록된 연차 신청·사용 이력이 없습니다.'
                            : '표시할 별표(★) 연차 기록이 없습니다.'
                        )
                      ),
                    ]
                  : visibleLeaveRecords.map((recItem) =>
                      h(
                        'tr',
                        {},
                        renderGenericMarkTd(
                          snapshot,
                          'leaveRecords',
                          recItem.recordId,
                          recItem.rowNo,
                          `${selectedLv.displayName} ${recItem.useDate}`
                        ),
                        h(
                          'td',
                          { 'data-label': '회차' },
                          `${indexedLeaveRecords.length - recItem.rowNo + 1}회`
                        ),
                        h('td', { 'data-label': '신청일자' }, recItem.appliedAt),
                        h('td', { 'data-label': '사용일자', className: 'font-extrabold' }, recItem.useDate),
                        h(
                          'td',
                          { className: 'num', 'data-label': '구분 · 사용일수' },
                          `${recItem.leaveType} (${recItem.days}일)`
                        ),
                        h('td', { 'data-label': '사유' }, recItem.reason || '-'),
                        h(
                          'td',
                          { 'data-label': '관리' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'btn btn-secondary btn-sm',
                              onClick: (e) =>
                                runOpsAction(
                                  {
                                    actionType: 'DELETE_LEAVE_USAGE',
                                    empCode: selectedLv.empCode,
                                    recordId: recItem.recordId,
                                  },
                                  e.currentTarget
                                ),
                            },
                            '삭제'
                          )
                        )
                      )
                    )
              )
            )
          )
        : null;

      leaveDetailCard = h(
        'div',
        { className: 'leave-detail-card', id: 'leave-usage-detail-panel' },
        h(
          'div',
          { className: 'ops-section-head' },
          h(
            'div',
            { className: 'step-pill-group' },
            h(
              'h3',
              { className: 'ops-section-title' },
              `No.${selectedLv.rowNo} ${selectedLv.empCode} ${selectedLv.displayName} — 연차 발생 · 신청 · 사용 기록`
            ),
            selectedLv.leaveEligible
              ? h(
                  'span',
                  { className: 'tag tag-blue' },
                  `발생 ${selectedLv.grantedCount}회(${selectedLv.accruedDays}일) · 사용 ${selectedLv.usedCount}회(${selectedLv.usedDays}일) · 잔여 ${selectedLv.remainingDays}일`
                )
              : null
          ),
          h(
            'div',
            { className: 'step-pill-group' },
            selectedLv.leaveEligible
              ? renderGenericSyncControls(
                  snapshot,
                  'leaveRecords',
                  indexedLeaveRecords,
                  (r) => r.recordId,
                  renderOpsLeaveTab,
                  '건',
                  { showGroupCheckbox: false }
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn-secondary btn-sm',
                onClick: (e) => openPayslipByEmpCode(selectedLv.empCode, e.currentTarget),
              },
              '급여 명세서에서 연차 내역 확인'
            )
          )
        ),
        addLeaveForm,
        recordsTable
      );
    }

    wrap.replaceChildren(...[ledgerSection, leaveDetailCard].filter(Boolean));
  }

  if (promoWrap) {
    const eligibleLedger = lv.ledger.filter((r) => r.leaveEligible !== false);
    const visibleEligible = applyStarFilter(eligibleLedger);
    const promoSection = h(
      'div',
      { className: 'ops-section-block' },
      h(
        'div',
        { className: 'ops-section-head' },
        h('h3', { className: 'ops-section-title' }, '연차 사용촉진 관리'),
        renderRosterSyncControls(eligibleLedger, renderOpsLeaveTab)
      ),
      h(
        'div',
        { className: 'table-scroll-wrap' },
        h(
          'table',
          { className: 'payroll-table', 'aria-label': '연차 사용촉진 관리' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              renderMasterSelectHeaderTh(eligibleLedger, '연차 사용촉진 관리'),
              h('th', { scope: 'col' }, '사번 · 이름'),
              h('th', { scope: 'col', className: 'num' }, '잔여 연차'),
              h('th', { scope: 'col' }, '촉진 기한'),
              h('th', { scope: 'col' }, '단계'),
              h('th', { scope: 'col' }, '처리')
            )
          ),
          h(
            'tbody',
            {},
            visibleEligible.length === 0
              ? [
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      { colspan: '6' },
                      eligibleLedger.length === 0
                        ? '대상 직원이 없습니다.'
                        : '표시할 별표(★) 직원이 없습니다.'
                    )
                  ),
                ]
              : visibleEligible.map((r) =>
                  h(
                    'tr',
                    {},
                    renderMasterMarkTd(r),
                    h(
                      'td',
                      { 'data-label': '사번 · 이름' },
                      h('div', { className: 'cell-emp-code' }, r.empCode),
                      h('div', { className: 'breakable-name' }, r.displayName),
                      h('div', { className: 'cell-dept-name' }, r.deptName)
                    ),
                    h(
                      'td',
                      { className: 'num font-extrabold', 'data-label': '잔여 연차' },
                      `${r.remainingDays}일`
                    ),
                    h(
                      'td',
                      { 'data-label': '촉진 기한' },
                      `1차 ~${r.firstPromoDeadline || '-'} / 2차 ~${r.secondPromoDeadline || '-'}`
                    ),
                    h('td', { 'data-label': '단계' }, promoLabel(r.promoStage)),
                    h(
                      'td',
                      { 'data-label': '처리' },
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
                              r.promoStage === 'NONE' ? '1차 발송' : '2차 지정'
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
                          '통지서'
                        )
                      )
                    )
                  )
                )
          )
        )
      )
    );

    const indexedMaternity = lv.maternityProtections.map((m, idx) => ({ ...m, rowNo: idx + 1 }));
    const visibleMaternity = applyGenericStarFilter(
      snapshot,
      'maternity',
      indexedMaternity,
      (m) => m.caseId
    );
    const matSection = h(
      'div',
      { className: 'ops-section-block' },
      h(
        'div',
        { className: 'ops-section-head' },
        h('h3', { className: 'ops-section-title' }, '육아 · 모성보호 현황'),
        renderGenericSyncControls(
          snapshot,
          'maternity',
          indexedMaternity,
          (m) => m.caseId,
          renderOpsLeaveTab,
          '건'
        )
      ),
      h(
        'div',
        { className: 'ops-two-col' },
        visibleMaternity.length === 0
          ? [h('div', { className: 'empty-state' }, '표시할 별표(★) 육아·모성보호 건이 없습니다.')]
          : visibleMaternity.map((m) =>
              h(
                'div',
                { className: 'dept-stat-card' },
                h(
                  'div',
                  { className: 'flex-between-tight mb-6' },
                  renderGenericInlineMark(
                    snapshot,
                    'maternity',
                    m.caseId,
                    m.rowNo,
                    m.beneficiaryLabel
                  ),
                  h('span', { className: 'tag tag-blue' }, m.programType)
                ),
                h('div', { className: 'ops-module-title' }, `${m.deptName} · ${m.beneficiaryLabel}`),
                h('div', { className: 'dept-stat-meta' }, `${m.periodLabel} (${m.govSubsidyStatus})`)
              )
            )
      )
    );

    promoWrap.replaceChildren(promoSection, matSection);
  }
}

function renderOpsEvalTab(snapshot) {
  const wrap = document.getElementById('ops-eval-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const ev = snapshot.operationsSuite.evaluationAndReward;
  const visibleEval = applyStarFilter(ev.board);

  const section = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '인사평가 · 급여 반영'),
      h(
        'div',
        { className: 'step-pill-group' },
        renderRosterSyncControls(ev.board, renderOpsEvalTab),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-primary btn-sm',
            onClick: (e) => runOpsAction({ actionType: 'APPLY_EVAL_REWARDS' }, e.currentTarget),
          },
          '급여 대장에 반영'
        )
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
            renderMasterSelectHeaderTh(ev.board, '인사평가 · 급여 반영'),
            h('th', { scope: 'col' }, '사번 · 이름 · 부서'),
            h('th', { scope: 'col', className: 'num' }, 'KPI / 역량'),
            h('th', { scope: 'col' }, '평가등급'),
            h('th', { scope: 'col', className: 'num' }, '권고 인상률 · 기본급'),
            h('th', { scope: 'col', className: 'num' }, '성과급'),
            h('th', { scope: 'col' }, '연동 상태')
          )
        ),
        h(
          'tbody',
          {},
          visibleEval.length === 0
            ? [
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { colspan: '7' },
                    ev.board.length === 0 ? '대상 직원이 없습니다.' : '표시할 별표(★) 직원이 없습니다.'
                  )
                ),
              ]
            : visibleEval.map((r) =>
                h(
                  'tr',
                  {},
                  renderMasterMarkTd(r),
                  h(
                    'td',
                    { 'data-label': '사번 · 이름 · 부서' },
                    h('div', { className: 'cell-emp-code' }, r.empCode),
                    h('div', { className: 'breakable-name' }, r.displayName),
                    h('div', { className: 'cell-dept-name' }, r.deptName)
                  ),
                  h(
                    'td',
                    { className: 'num', 'data-label': 'KPI / 역량' },
                    r.evalEligible ? `KPI ${r.kpiScore} / 역량 ${r.competencyScore}` : '-'
                  ),
                  h(
                    'td',
                    { 'data-label': '평가등급' },
                    !r.evalEligible
                      ? h('span', { className: 'tag tag-gray' }, '비대상')
                      : h(
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
                    { className: 'num', 'data-label': '권고 인상률 · 기본급' },
                    r.evalEligible
                      ? `+${r.recommendedRaisePct}% (${fmtWon(r.currentBasePay)} → ${fmtWon(r.projectedBasePay)})`
                      : fmtWon(r.currentBasePay)
                  ),
                  h(
                    'td',
                    { className: 'num', 'data-label': '성과급' },
                    r.evalEligible ? fmtWon(r.recommendedBonus) : '-'
                  ),
                  h(
                    'td',
                    { 'data-label': '연동 상태' },
                    !r.evalEligible
                      ? h('span', { className: 'tag tag-gray' }, '별도 계약')
                      : r.appliedToPayroll
                        ? h(
                            'span',
                            { className: 'tag tag-green' },
                            `반영됨 (+${r.appliedRaisePct}% · ${fmtWon(r.appliedBonusPay)})`
                          )
                        : h('span', { className: 'tag tag-amber' }, '반영 대기')
                  )
                )
              )
        )
      )
    )
  );

  wrap.replaceChildren(section);
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

  const visibleDisc = applyStarFilter(dg.disciplineBoard);
  const discSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '징계 절차 확인'),
      renderRosterSyncControls(dg.disciplineBoard, renderOpsDisciplineTab)
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
            renderMasterSelectHeaderTh(dg.disciplineBoard, '징계 절차 확인'),
            h('th', { scope: 'col' }, '사번 · 성명 · 부서'),
            h('th', { scope: 'col', className: 'num' }, '감봉 요청액 → 적법 반영액 (차단액)'),
            h('th', { scope: 'col' }, '부당징계 예방 4대 필수 절차 (클릭 토글)'),
            h('th', { scope: 'col' }, '절차 적법성 · 서면양식')
          )
        ),
        h(
          'tbody',
          {},
          visibleDisc.length === 0
            ? [
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    { colspan: '5' },
                    dg.disciplineBoard.length === 0
                      ? '현재 징계 절차·감봉 한도 점검 대상 재직자가 없습니다 (0명).'
                      : '표시할 별표(★) 직원이 없습니다.'
                  )
                ),
              ]
            : visibleDisc.map((d) =>
                h(
                  'tr',
                  {},
                  renderMasterMarkTd(d),
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

  const indexedGrievances = dg.grievances.map((g, idx) => ({
    ...g,
    rowNo: g.rowNo || idx + 1,
  }));
  const visibleGrievances = applyGenericStarFilter(
    snapshot,
    'grievances',
    indexedGrievances,
    (g) => g.grievanceId
  );

  const grvSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '고충 처리'),
      renderGenericSyncControls(
        snapshot,
        'grievances',
        indexedGrievances,
        (g) => g.grievanceId,
        renderOpsDisciplineTab,
        '건',
        { showGroupCheckbox: false }
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
            renderGenericSelectHeaderTh(
              snapshot,
              'grievances',
              indexedGrievances,
              (g) => g.grievanceId,
              '고충 처리'
            ),
            h('th', { scope: 'col' }, '접수번호 · 경로'),
            h('th', { scope: 'col' }, '접수일 · 10일 법정통보기한'),
            h('th', { scope: 'col' }, '고충 요지 및 조치 경과'),
            h('th', { scope: 'col' }, '처리 상태 · 결과통보')
          )
        ),
        h(
          'tbody',
          {},
          visibleGrievances.length === 0
            ? [h('tr', {}, h('td', { colspan: '5' }, '표시할 별표(★) 고충 처리 건이 없습니다.'))]
            : visibleGrievances.map((g) =>
                h(
                  'tr',
                  {},
                  renderGenericMarkTd(snapshot, 'grievances', g.grievanceId, g.rowNo, g.summary),
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

  wrap.replaceChildren(discSection, grvSection);
}

function renderOpsStatutoryTab(snapshot) {
  const wrap = document.getElementById('ops-statutory-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const st = snapshot.operationsSuite.statutoryOpsCenter;

  const indexedLmc = st.lmcAgendaItems.map((ag, idx) => ({ ...ag, rowNo: idx + 1 }));
  const visibleLmc = applyGenericStarFilter(snapshot, 'lmcAgenda', indexedLmc, (ag) => ag.agendaId);

  const lmcSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '노사협의회'),
      h(
        'div',
        { className: 'step-pill-group' },
        renderGenericSyncControls(
          snapshot,
          'lmcAgenda',
          indexedLmc,
          (ag) => ag.agendaId,
          renderOpsStatutoryTab,
          '건'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_LMC_REGULATION_AND_FILING', e.currentTarget),
          },
          '규정 · 신고서'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_LMC_MINUTES', e.currentTarget, 4),
          },
          '회의록'
        )
      )
    ),
    h(
      'div',
      { className: 'dept-card-grid' },
      visibleLmc.length === 0
        ? [h('div', { className: 'empty-state' }, '표시할 별표(★) 안건이 없습니다.')]
        : visibleLmc.map((ag) =>
            h(
              'div',
              { className: 'dept-stat-card' },
              h(
                'div',
                { className: 'flex-between-tight mb-6' },
                renderGenericInlineMark(snapshot, 'lmcAgenda', ag.agendaId, ag.rowNo, ag.title),
                h('span', { className: 'tag tag-blue' }, `${ag.quarterLabel} · ${ag.agendaType}`)
              ),
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

  const indexedRisks = st.riskAssessments.map((rk, idx) => ({ ...rk, rowNo: idx + 1 }));
  const visibleRisks = applyGenericStarFilter(snapshot, 'risks', indexedRisks, (rk) => rk.riskId);

  const oshSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '산업안전 · 위험성평가'),
      h(
        'div',
        { className: 'step-pill-group' },
        renderGenericSyncControls(
          snapshot,
          'risks',
          indexedRisks,
          (rk) => rk.riskId,
          renderOpsStatutoryTab,
          '건',
          { showGroupCheckbox: false }
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_OSH_OFFICER_APPOINTMENT', e.currentTarget),
          },
          '선임보고서'
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_OSH_MINUTES', e.currentTarget, 4),
          },
          '산안위 회의록'
        )
      )
    ),
    h(
      'div',
      { className: 'dept-card-grid' },
      st.oshRoles.map((role, idx) =>
        h(
          'div',
          { className: 'dept-stat-card' },
          h(
            'div',
            { className: 'flex-between-tight mb-6' },
            renderGenericInlineMark(
              snapshot,
              'oshRoles',
              role.roleId || `OSH-${idx + 1}`,
              idx + 1,
              role.roleTitle
            ),
            h('span', { className: 'tag tag-amber' }, role.statusLabel)
          ),
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
            renderGenericSelectHeaderTh(
              snapshot,
              'risks',
              indexedRisks,
              (rk) => rk.riskId,
              '공정별 위험성평가'
            ),
            h('th', { scope: 'col' }, '평가코드 · 대상 공정'),
            h('th', { scope: 'col' }, '유해·위험요인 파악'),
            h('th', { scope: 'col' }, '위험성 감소대책'),
            h('th', { scope: 'col' }, '개선 조치 상태')
          )
        ),
        h(
          'tbody',
          {},
          visibleRisks.length === 0
            ? [h('tr', {}, h('td', { colspan: '5' }, '표시할 별표(★) 위험성평가 항목이 없습니다.'))]
            : visibleRisks.map((rk) =>
                h(
                  'tr',
                  {},
                  renderGenericMarkTd(snapshot, 'risks', rk.riskId, rk.rowNo, rk.processName),
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

  const indexedTrainings = st.statutoryTrainings.map((edu, idx) => ({ ...edu, rowNo: idx + 1 }));
  const visibleTrainings = applyGenericStarFilter(
    snapshot,
    'trainings',
    indexedTrainings,
    (edu) => edu.trainingId
  );

  const eduSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '법정의무교육'),
      h(
        'div',
        { className: 'step-pill-group' },
        renderGenericSyncControls(
          snapshot,
          'trainings',
          indexedTrainings,
          (edu) => edu.trainingId,
          renderOpsStatutoryTab,
          '과정',
          { showGroupCheckbox: false }
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview('DOC_WORK_RULES_REPORT', e.currentTarget),
          },
          '취업규칙 신고서'
        )
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
            renderGenericSelectHeaderTh(
              snapshot,
              'trainings',
              indexedTrainings,
              (edu) => edu.trainingId,
              '5대 법정의무교육'
            ),
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
          visibleTrainings.length === 0
            ? [h('tr', {}, h('td', { colspan: '6' }, '표시할 별표(★) 교육 과정이 없습니다.'))]
            : visibleTrainings.map((edu) =>
                h(
                  'tr',
                  {},
                  renderGenericMarkTd(snapshot, 'trainings', edu.trainingId, edu.rowNo, edu.title),
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
                        className:
                          edu.completionRatePct >= 100
                            ? 'meter-progress'
                            : 'meter-progress meter-progress-warn',
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

  wrap.replaceChildren(lmcSection, oshSection, eduSection);
}

function renderFormsCenterTab(snapshot) {
  const wrap = document.getElementById('forms-center-container');
  if (!wrap) return;

  const contractLedger = snapshot.operationsSuite?.recruitAndOnboarding?.contractLedger || [];
  const alumniList = (snapshot.offboardedWorkers || []).filter(
    (a) => a.dataLifecycleStatus !== 'ANONYMIZED_PURGED'
  );
  const signedArchive = snapshot.operationsSuite?.signedDocumentsArchive || [];

  if (!appState.formsDraftPerson) {
    const seedRow = contractLedger[0] || null;
    appState.formsDraftPerson = seedRow
      ? {
          ...buildDraftFromContractRow(seedRow),
          sourceKey: `W:${seedRow.empCode}`,
          personKey: `EMP:${seedRow.empCode}`,
        }
      : {
          sourceKey: 'CUSTOM',
          personKey: '',
          empCode: '',
          personName: '김하늘',
          deptName: '생산기술1팀',
          jobTitle: '선임기사',
          hireDate: '2023-03-02',
          maskedBirthOrId: '900412-*******',
          maskedPhone: '010-****-2011',
          address: '경기도 화성시 동탄첨단산업1로 45',
          weeklyHours: 40,
          baseMonthlyPay: 3600000,
          mealAllowance: 200000,
        };
    appState.formsSigState.signerName = appState.formsDraftPerson.personName;
  }
  const fDraft = appState.formsDraftPerson;

  const allFormItems = [
    { no: 1, id: 'DOC_EMPLOYMENT_CONTRACT', cat: '입사·계약', title: '표준 근로계약서', mode: 'worker' },
    { no: 2, id: 'DOC_PRIVACY_CONSENT', cat: '입사·계약', title: '개인정보 수집·이용 동의서', mode: 'worker' },
    { no: 3, id: 'DOC_NDA_SECURITY_PLEDGE', cat: '입사·계약', title: '비밀유지 및 정보보안 서약서', mode: 'worker' },
    { no: 4, id: 'DOC_EXIT_SECURITY_NONCOMPETE', cat: '퇴사·증명', title: '퇴사 시 보안·경업금지 서약서', mode: 'worker' },
    { no: 5, id: 'DOC_EMPLOYMENT_CERT', cat: '퇴사·증명', title: '재직증명서', mode: 'worker' },
    { no: 6, id: 'DOC_CAREER_CERTIFICATE', cat: '퇴사·증명', title: '사용(경력)증명서', mode: 'alumni' },
    { no: 7, id: 'DOC_EI_SEPARATION_CERT', cat: '퇴사·증명', title: '고용보험 상실·이직확인서', mode: 'alumni' },
    { no: 8, id: 'DOC_WORK_RULES_REPORT', cat: '규칙·연차', title: '취업규칙 제정·변경 신고서', mode: 'company' },
    { no: 9, id: 'DOC_ANNUAL_LEAVE_PROMOTION', cat: '규칙·연차', title: '미사용 연차 사용촉진 통지서', mode: 'worker' },
    { no: 10, id: 'DOC_DISCIPLINE_WRITTEN_NOTICE', cat: '규칙·징계', title: '징계 출석 · 서면통지서', mode: 'worker' },
    { no: 11, id: 'DOC_LMC_REGULATION_AND_FILING', cat: '노사·안전', title: '노사협의회 규정 및 신고서', mode: 'company' },
    { no: 12, id: 'DOC_LMC_MINUTES', cat: '노사·안전', title: '노사협의회 정기회의록', mode: 'q4' },
    { no: 13, id: 'DOC_OSH_OFFICER_APPOINTMENT', cat: '노사·안전', title: '안전·보건관리자 선임보고서', mode: 'company' },
    { no: 14, id: 'DOC_OSH_MINUTES', cat: '노사·안전', title: '산업안전보건위원회 회의록', mode: 'q4' },
  ];

  const visibleForms = applyGenericStarFilter(
    snapshot,
    'stdForms',
    allFormItems,
    (it) => it.id
  );
  const selectedSpec =
    allFormItems.find((it) => it.id === appState.formsSelectedTpl) || allFormItems[0];

  const sigPad = createSignatureCanvasControl(
    fDraft.personName,
    'forms-sig',
    appState.formsSigState
  );
  const nameMatchSummaryBox = h('div', { className: 'flex-between-tight' });
  const viewerMainPane = h(
    'div',
    { id: 'forms-studio-right-body', 'aria-live': 'polite' },
    h('div', { className: 'doc-paper-box' }, '양식을 불러오는 중입니다...')
  );
  let latestRenderedBody = '';

  const buildAlumniDraft = (al) => ({
    sourceKey: `A:${al.empCode}`,
    personKey: `EMP:${al.empCode}`,
    empCode: al.empCode,
    personName: al.displayName,
    deptName: al.deptName,
    jobTitle: '퇴사자',
    hireDate: al.hireDate,
    maskedBirthOrId: al.maskedBirthOrId || '900101-*******',
    maskedPhone: '010-****-0000',
    address: `${snapshot.company.companyName} 등록 주소지`,
    weeklyHours: 40,
    baseMonthlyPay: Math.round((al.ordinaryDailyWage || 115000) * 26),
    mealAllowance: 200000,
  });

  const getMatchedRecordsByName = (rawName) => {
    const q = String(rawName || '').trim().toLowerCase();
    const matchedDocs = q
      ? signedArchive.filter(
          (d) =>
            String(d.personName || '').toLowerCase().includes(q) ||
            String(d.empCode || '').toLowerCase().includes(q)
        )
      : signedArchive;
    const matchedWorkers = q
      ? contractLedger.filter(
          (w) =>
            String(w.displayName || '').toLowerCase().includes(q) ||
            String(w.empCode || '').toLowerCase().includes(q)
        )
      : [];
    const matchedAlumni = q
      ? alumniList.filter(
          (a) =>
            String(a.displayName || '').toLowerCase().includes(q) ||
            String(a.empCode || '').toLowerCase().includes(q)
        )
      : [];
    return { q, matchedDocs, matchedWorkers, matchedAlumni };
  };

  const updateNameMatchBadge = () => {
    const { matchedDocs, matchedWorkers, matchedAlumni } = getMatchedRecordsByName(fDraft.personName);
    const totalLinked = matchedDocs.length + matchedWorkers.length + matchedAlumni.length;
    nameMatchSummaryBox.replaceChildren(
      h(
        'span',
        { className: totalLinked > 0 ? 'tag tag-green' : 'tag tag-gray' },
        fDraft.personName
          ? `"${fDraft.personName}" 이름 반영 기록: 저장서식 ${matchedDocs.length}건 · 인원원장 ${matchedWorkers.length + matchedAlumni.length}명`
          : `전체 저장·서명 서식 ${matchedDocs.length}건`
      ),
      h(
        'button',
        {
          type: 'button',
          className:
            appState.formsViewMode === 'PERSON_HISTORY'
              ? 'btn btn-primary btn-sm'
              : 'btn btn-secondary btn-sm',
          onClick: () => {
            appState.formsViewMode = 'PERSON_HISTORY';
            renderFormsCenterTab(snapshot);
          },
        },
        '이름 들어간 내용 확인'
      )
    );
  };

  const renderRightViewer = async () => {
    updateNameMatchBadge();
    if (appState.formsViewMode === 'PERSON_HISTORY') {
      const { matchedDocs, matchedWorkers, matchedAlumni } = getMatchedRecordsByName(fDraft.personName);
      const cards = [];

      matchedDocs.forEach((docRec, idx) => {
        const loadedDetail = appState.expandedArchivedDocs[docRec.docRecordId] || null;
        cards.push(
          h(
            'div',
            { className: 'person-doc-history-card' },
            h(
              'div',
              { className: 'flex-between-tight' },
              h(
                'div',
                { className: 'step-pill-group' },
                renderGenericInlineMark(
                  snapshot,
                  'signedDocs',
                  docRec.docRecordId,
                  idx + 1,
                  `${docRec.personName} ${docRec.templateLabel}`
                ),
                h(
                  'strong',
                  {},
                  `${docRec.personName} (${docRec.empCode || docRec.personKey || '직접기입'}) — ${docRec.templateLabel} (v${docRec.version || 1})`
                ),
                docRec.signed
                  ? h(
                      'span',
                      { className: 'tag tag-green' },
                      `전자서명 완료 ✓ (${docRec.signedAt} · ${docRec.signatureCode})`
                    )
                  : h('span', { className: 'tag tag-amber' }, '작성 저장됨')
              ),
              h(
                'div',
                { className: 'step-pill-group' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'btn btn-secondary btn-sm',
                    onClick: async (e) => {
                      if (loadedDetail) {
                        delete appState.expandedArchivedDocs[docRec.docRecordId];
                        renderFormsCenterTab(snapshot);
                        return;
                      }
                      try {
                        const res = await apiPost(
                          '/api/document',
                          { docRecordId: docRec.docRecordId },
                          e.currentTarget
                        );
                        if (res.archivedDocument) {
                          appState.expandedArchivedDocs[docRec.docRecordId] = res.archivedDocument;
                          renderFormsCenterTab(snapshot);
                        }
                      } catch (err) {
                        showBanner(err.message, true);
                      }
                    },
                  },
                  loadedDetail ? '서식 전문 접기' : '저장된 서식 전문 · 서명 열람'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'btn btn-primary btn-sm',
                    onClick: async (e) => {
                      let fullRec = loadedDetail;
                      if (!fullRec) {
                        try {
                          const res = await apiPost(
                            '/api/document',
                            { docRecordId: docRec.docRecordId },
                            e.currentTarget
                          );
                          fullRec = res.archivedDocument || docRec;
                        } catch {
                          fullRec = docRec;
                        }
                      }
                      appState.formsSelectedTpl = docRec.templateId;
                      appState.formsViewMode = 'COMPARE';
                      Object.assign(fDraft, {
                        sourceKey: docRec.empCode ? `W:${docRec.empCode}` : 'CUSTOM',
                        personKey: docRec.personKey || '',
                        empCode: docRec.empCode || '',
                        personName: fullRec.personName || fDraft.personName,
                        deptName: fullRec.deptName || fDraft.deptName,
                        jobTitle: fullRec.jobTitle || fDraft.jobTitle,
                        hireDate: fullRec.hireDate || fDraft.hireDate,
                        maskedBirthOrId: fullRec.maskedBirthOrId || fDraft.maskedBirthOrId,
                        maskedPhone: fullRec.maskedPhone || fDraft.maskedPhone,
                        address: fullRec.address || fDraft.address,
                        weeklyHours: fullRec.weeklyHours || 40,
                        baseMonthlyPay: fullRec.baseMonthlyPay || 0,
                        mealAllowance: fullRec.mealAllowance ?? 200000,
                      });
                      appState.formsSigState = {
                        signerName: fDraft.personName,
                        dataUrl: '',
                        consentConfirmed: false,
                      };
                      renderFormsCenterTab(snapshot);
                    },
                  },
                  '기본↔변경 양식 비교로 열기'
                )
              )
            ),
            h(
              'div',
              { className: 'cell-dept-name' },
              `반영된 정보: 소속 ${docRec.deptName} · 직위 ${docRec.jobTitle} · 입사일 ${docRec.hireDate} · 연락처 ${docRec.maskedPhone} · 월 기본급 ${fmtWon(docRec.baseMonthlyPay)}`
            ),
            loadedDetail?.signatureDataUrl
              ? h('img', {
                  className: 'sig-saved-preview',
                  src: loadedDetail.signatureDataUrl,
                  alt: `${loadedDetail.signerName} 자필 전자서명 이미지`,
                })
              : null,
            loadedDetail?.savedBody
              ? renderHighlightedDocPre(loadedDetail.savedBody, [
                  loadedDetail.personName,
                  loadedDetail.deptName,
                  loadedDetail.jobTitle,
                  loadedDetail.maskedPhone,
                  loadedDetail.address,
                  loadedDetail.signatureCode,
                ])
              : null
          )
        );
      });

      matchedWorkers.forEach((w) => {
        cards.push(
          h(
            'div',
            { className: 'person-doc-history-card' },
            h(
              'div',
              { className: 'flex-between-tight' },
              h(
                'strong',
                {},
                `[재직 명부 연동] No.${w.rowNo} ${w.displayName} (${w.empCode} · ${w.deptName})`
              ),
              h(
                'span',
                { className: w.allOnboardingSigned ? 'tag tag-green' : 'tag tag-amber' },
                w.allOnboardingSigned ? '입사 3종 체결됨' : '미체결 서식 있음'
              )
            ),
            h(
              'div',
              { className: 'cell-dept-name' },
              `입사일 ${w.hireDate} · 주 ${w.weeklyHours}h · 기준급여 ${fmtWon(w.baseMonthlyPay)} · 주소 ${w.address}`
            ),
            h(
              'div',
              { className: 'step-pill-group' },
              ...[
                ['DOC_EMPLOYMENT_CONTRACT', '표준 근로계약서 보기'],
                ['DOC_PRIVACY_CONSENT', '개인정보 동의서 보기'],
                ['DOC_NDA_SECURITY_PLEDGE', '비밀유지 서약서 보기'],
                ['DOC_EMPLOYMENT_CERT', '재직증명서 보기'],
              ].map(([tid, btnTxt]) =>
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'btn btn-secondary btn-sm',
                    onClick: () => {
                      Object.assign(fDraft, buildDraftFromContractRow(w), {
                        sourceKey: `W:${w.empCode}`,
                        personKey: `EMP:${w.empCode}`,
                      });
                      appState.formsSigState = {
                        signerName: w.displayName,
                        dataUrl: '',
                        consentConfirmed: false,
                      };
                      appState.formsSelectedTpl = tid;
                      appState.formsViewMode = 'COMPARE';
                      renderFormsCenterTab(snapshot);
                    },
                  },
                  btnTxt
                )
              )
            )
          )
        );
      });

      matchedAlumni.forEach((al) => {
        cards.push(
          h(
            'div',
            { className: 'person-doc-history-card' },
            h(
              'div',
              { className: 'flex-between-tight' },
              h('strong', {}, `[퇴사 원장 연동] ${al.displayName} (${al.empCode} · ${al.deptName})`),
              h('span', { className: 'tag tag-blue' }, `${al.hireDate} ~ ${al.lastWorkDate}`)
            ),
            h(
              'div',
              { className: 'step-pill-group' },
              ...[
                ['DOC_CAREER_CERTIFICATE', '경력증명서 보기'],
                ['DOC_EI_SEPARATION_CERT', '상실·이직확인서 보기'],
                ['DOC_EXIT_SECURITY_NONCOMPETE', '퇴사 보안서약서 보기'],
              ].map(([tid, btnTxt]) =>
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'btn btn-secondary btn-sm',
                    onClick: () => {
                      Object.assign(fDraft, buildAlumniDraft(al));
                      appState.formsSigState = {
                        signerName: al.displayName,
                        dataUrl: '',
                        consentConfirmed: false,
                      };
                      appState.formsSelectedTpl = tid;
                      appState.formsViewMode = 'COMPARE';
                      renderFormsCenterTab(snapshot);
                    },
                  },
                  btnTxt
                )
              )
            )
          )
        );
      });

      if (cards.length === 0) {
        cards.push(
          h(
            'div',
            { className: 'empty-state' },
            h('h3', {}, `"${fDraft.personName}" 이름이 저장된 서식 내역이 아직 없습니다.`),
            h(
              'p',
              {},
              '하단 [현재 서식에 개인정보·전자서명 저장] 버튼을 누르면 해당 이름으로 작성된 서식이 즉시 보관·조회됩니다.'
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn-primary btn-sm',
                onClick: () => {
                  appState.formsViewMode = 'COMPARE';
                  renderFormsCenterTab(snapshot);
                },
              },
              `"${fDraft.personName}" 이름 자동반영 양식 미리보기로 이동`
            )
          )
        );
      }

      viewerMainPane.replaceChildren(...cards);
      return;
    }

    const reqId = ++appState.formsReqSeq;
    try {
      const doc = await fetchRenderedDocQuiet({
        previewOnly: true,
        templateId: selectedSpec.id,
        quarterNumber: selectedSpec.mode === 'q4' ? 4 : undefined,
        empCode: fDraft.empCode || undefined,
        personKey: fDraft.personKey || undefined,
        personInfo: {
          personKey: fDraft.personKey || '',
          empCode: fDraft.empCode || '신규·직접기입',
          personName: fDraft.personName,
          deptName: fDraft.deptName,
          jobTitle: fDraft.jobTitle,
          hireDate: fDraft.hireDate,
          maskedBirthOrId: fDraft.maskedBirthOrId,
          maskedPhone: fDraft.maskedPhone,
          address: fDraft.address,
          weeklyHours: Number(fDraft.weeklyHours) || 40,
          baseMonthlyPay: Number(fDraft.baseMonthlyPay) || 0,
          mealAllowance: Number(fDraft.mealAllowance) || 0,
        },
      });
      if (reqId !== appState.formsReqSeq) return;
      latestRenderedBody = doc.body || '';

      const verifiedSigned = doc.signedRecord || null;
      const sigBanner = verifiedSigned
        ? h(
            'div',
            { className: 'person-doc-history-card' },
            h(
              'div',
              { className: 'flex-between-tight' },
              h(
                'span',
                { className: 'tag tag-green' },
                `전자서명 완료 ✓ (${verifiedSigned.signerName} · ${verifiedSigned.signedAt} · ${verifiedSigned.signatureCode})`
              ),
              h('span', { className: 'cell-dept-name' }, '서명본 무결성 일치')
            ),
            verifiedSigned.signatureDataUrl
              ? h('img', {
                  className: 'sig-saved-preview',
                  src: verifiedSigned.signatureDataUrl,
                  alt: `${verifiedSigned.signerName} 자필 전자서명 이미지`,
                })
              : null
          )
        : null;

      if (appState.formsViewMode === 'COMPARE') {
        viewerMainPane.replaceChildren(
          h(
            'div',
            { className: 'flex-between-tight mb-6' },
            h('strong', {}, `No.${selectedSpec.no} ${doc.title}`),
            h(
              'span',
              { className: 'tag tag-amber' },
              `대상자 "${fDraft.personName || '미입력'}" 개인정보·처우 실시간 비교 중`
            )
          ),
          h(
            'div',
            { className: 'doc-compare-grid' },
            h(
              'div',
              {},
              h('div', { className: 'mb-6' }, h('span', { className: 'tag tag-gray' }, '기본 양식 (미기입 표준원본)')),
              h('div', { className: 'doc-paper-box' }, doc.blankTemplateBody || doc.body)
            ),
            h(
              'div',
              {},
              h(
                'div',
                { className: 'mb-6' },
                h('span', { className: 'tag tag-blue' }, '변경된 양식 (사람 이름 · 개인정보 자동반영)')
              ),
              renderHighlightedDocPre(doc.body, doc.autoFilledTokens)
            )
          ),
          sigBanner
        );
      } else {
        viewerMainPane.replaceChildren(
          h(
            'div',
            { className: 'flex-between-tight mb-6' },
            h('strong', {}, `No.${selectedSpec.no} ${doc.title}`),
            h('span', { className: 'tag tag-blue' }, doc.subtitle)
          ),
          renderHighlightedDocPre(doc.body, doc.autoFilledTokens),
          sigBanner
        );
      }
    } catch (err) {
      if (reqId !== appState.formsReqSeq) return;
      viewerMainPane.replaceChildren(h('div', { className: 'tag tag-red' }, err.message));
    }
  };

  const scheduleFormsDocRefresh = () => {
    updateNameMatchBadge();
    if (appState.formsDocTimer) clearTimeout(appState.formsDocTimer);
    appState.formsDocTimer = setTimeout(() => {
      renderRightViewer();
    }, 90);
  };

  const splitStudio = h(
    'div',
    { className: 'ops-section-block code-diff-box' },
    h(
      'div',
      { className: 'ops-section-head' },
      h(
        'div',
        { className: 'step-pill-group' },
        h('h3', { className: 'ops-section-title' }, '표준 서식함 (좌측 서식·이름 선택 → 우측 기본양식 & 변경양식 실시간 확인)'),
        h('span', { className: 'code-diff-pill' }, '변경됨 · 나열식 제거 → 좌우 분할 + 기본↔변경 비교 + 이름별 반영내역 조회')
      ),
      renderGenericSyncControls(
        snapshot,
        'stdForms',
        allFormItems,
        (it) => it.id,
        renderFormsCenterTab,
        '종'
      )
    ),
    h(
      'div',
      { className: 'forms-studio-layout' },
      // 좌측: 사람 이름·개인정보 입력 & 표준 서식 클릭 목록 (No. · ☐ · ★)
      h(
        'div',
        { className: 'forms-studio-sidebar' },
        h(
          'div',
          {
            className: 'studio-person-box',
            onInput: (e) => {
              const target = e.target;
              if (!target || !target.name) return;
              if (target.name === 'personName' && fDraft.sourceKey !== 'CUSTOM') {
                const trimmed = target.value.trim();
                const currentCode = fDraft.empCode;
                const stillSameWorker = contractLedger.some(
                  (w) => w.empCode === currentCode && w.displayName === trimmed
                );
                const stillSameAlumni = alumniList.some(
                  (a) => a.empCode === currentCode && a.displayName === trimmed
                );
                if (!stillSameWorker && !stillSameAlumni) {
                  fDraft.empCode = '';
                  fDraft.personKey = '';
                  fDraft.sourceKey = 'CUSTOM';
                  sigPad.clearCanvas();
                }
              }
              fDraft[target.name] = target.value;
              if (target.name === 'personName') {
                sigPad.setSignerName(target.value);
              }
              sigPad.invalidateConsent();
              scheduleFormsDocRefresh();
            },
          },
          h(
            'div',
            { className: 'field' },
            h('label', { for: 'forms-person-preset' }, '재직자 · 퇴사자 불러오기 / 직접 입력'),
            h(
              'select',
              {
                id: 'forms-person-preset',
                onChange: (e) => {
                  const val = e.currentTarget.value;
                  if (val === 'CUSTOM') {
                    Object.assign(fDraft, {
                      sourceKey: 'CUSTOM',
                      personKey: '',
                      empCode: '',
                      personName: '',
                      deptName: '일반부서',
                      jobTitle: '사원',
                      hireDate: snapshot.company.referenceDate || '2026-11-15',
                      maskedBirthOrId: '950101-*******',
                      maskedPhone: '010-****-0000',
                      address: `${snapshot.company.companyName} 관할 거주지`,
                      weeklyHours: 40,
                      baseMonthlyPay: 3000000,
                      mealAllowance: 200000,
                    });
                    appState.formsSigState = { signerName: '', dataUrl: '', consentConfirmed: false };
                  } else if (val.startsWith('W:')) {
                    const code = val.slice(2);
                    const row = contractLedger.find((w) => w.empCode === code);
                    if (row) {
                      Object.assign(fDraft, buildDraftFromContractRow(row), {
                        sourceKey: val,
                        personKey: `EMP:${row.empCode}`,
                      });
                      appState.formsSigState = {
                        signerName: row.displayName,
                        dataUrl: '',
                        consentConfirmed: false,
                      };
                    }
                  } else if (val.startsWith('A:')) {
                    const code = val.slice(2);
                    const al = alumniList.find((a) => a.empCode === code);
                    if (al) {
                      Object.assign(fDraft, buildAlumniDraft(al));
                      appState.formsSigState = {
                        signerName: al.displayName,
                        dataUrl: '',
                        consentConfirmed: false,
                      };
                    }
                  }
                  renderFormsCenterTab(snapshot);
                },
              },
              ...contractLedger.map((w) =>
                h(
                  'option',
                  { value: `W:${w.empCode}`, selected: fDraft.sourceKey === `W:${w.empCode}` },
                  `[재직 No.${w.rowNo}] ${w.displayName} (${w.empCode} · ${w.deptName})`
                )
              ),
              ...alumniList.map((al, idx) =>
                h(
                  'option',
                  { value: `A:${al.empCode}`, selected: fDraft.sourceKey === `A:${al.empCode}` },
                  `[퇴사 No.${al.rowNo || idx + 1}] ${al.displayName} (${al.empCode})`
                )
              ),
              h('option', { value: 'CUSTOM', selected: fDraft.sourceKey === 'CUSTOM' }, '직접 이름 입력 (신규·외부 조회)')
            )
          ),
          h(
            'div',
            { className: 'studio-mini-grid' },
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'forms-person-name-input' }, '사람 이름 (입력 시 우측 반영·내역 확인)'),
              h('input', {
                id: 'forms-person-name-input',
                name: 'personName',
                type: 'text',
                value: fDraft.personName,
                placeholder: '예: 김하늘, 이준호 등',
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'forms-dept-input' }, '소속 부서'),
              h('input', { id: 'forms-dept-input', name: 'deptName', type: 'text', value: fDraft.deptName })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'forms-job-input' }, '직위 · 담당업무'),
              h('input', { id: 'forms-job-input', name: 'jobTitle', type: 'text', value: fDraft.jobTitle })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'forms-phone-input' }, '연락처(자동마스킹)'),
              h('input', {
                id: 'forms-phone-input',
                name: 'maskedPhone',
                type: 'text',
                value: fDraft.maskedPhone,
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'forms-pay-input' }, '월 기본급(원)'),
              h('input', {
                id: 'forms-pay-input',
                name: 'baseMonthlyPay',
                type: 'number',
                step: '50000',
                value: String(fDraft.baseMonthlyPay || 0),
              })
            ),
            h(
              'div',
              { className: 'field' },
              h('label', { for: 'forms-hire-input' }, '입사일'),
              h('input', { id: 'forms-hire-input', name: 'hireDate', type: 'date', value: fDraft.hireDate })
            )
          ),
          h(
            'div',
            { className: 'field' },
            h('label', { for: 'forms-addr-input' }, '거주지 주소'),
            h('input', { id: 'forms-addr-input', name: 'address', type: 'text', value: fDraft.address })
          ),
          nameMatchSummaryBox
        ),
        h(
          'div',
          { className: 'studio-form-list', role: 'list', 'aria-label': '표준 서식 목록' },
          ...(visibleForms.length === 0
            ? [h('div', { className: 'empty-state' }, '표시할 별표(★) 서식이 없습니다.')]
            : visibleForms.map((item) => {
                const isActive =
                  appState.formsViewMode !== 'PERSON_HISTORY' &&
                  appState.formsSelectedTpl === item.id;
                return h(
                  'div',
                  {
                    role: 'listitem',
                    className: isActive ? 'studio-form-row is-active' : 'studio-form-row',
                  },
                  renderGenericInlineMark(snapshot, 'stdForms', item.id, item.no, item.title),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: isActive ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
                      'aria-pressed': String(isActive),
                      onClick: () => {
                        appState.formsSelectedTpl = item.id;
                        if (appState.formsViewMode === 'PERSON_HISTORY') {
                          appState.formsViewMode = 'COMPARE';
                        }
                        renderFormsCenterTab(snapshot);
                      },
                    },
                    `[${item.cat}] ${item.title}`
                  )
                );
              }))
        )
      ),
      // 우측: 기본 양식 ↔ 변경된 양식 비교 / 변경 양식 단독 / 사람 이름별 작성·서명 내역 확인 + 서명 저장
      h(
        'div',
        { className: 'forms-studio-viewer' },
        h(
          'div',
          { className: 'ops-section-head' },
          h(
            'div',
            { className: 'step-pill-group' },
            h(
              'button',
              {
                type: 'button',
                className:
                  appState.formsViewMode === 'COMPARE'
                    ? 'btn btn-primary btn-sm'
                    : 'btn btn-secondary btn-sm',
                'aria-pressed': String(appState.formsViewMode === 'COMPARE'),
                onClick: () => {
                  appState.formsViewMode = 'COMPARE';
                  renderFormsCenterTab(snapshot);
                },
              },
              '기본 양식 ↔ 변경된 양식 비교'
            ),
            h(
              'button',
              {
                type: 'button',
                className:
                  appState.formsViewMode === 'FILLED'
                    ? 'btn btn-primary btn-sm'
                    : 'btn btn-secondary btn-sm',
                'aria-pressed': String(appState.formsViewMode === 'FILLED'),
                onClick: () => {
                  appState.formsViewMode = 'FILLED';
                  renderFormsCenterTab(snapshot);
                },
              },
              '변경·개인정보 반영 양식만 보기'
            ),
            h(
              'button',
              {
                type: 'button',
                className:
                  appState.formsViewMode === 'PERSON_HISTORY'
                    ? 'btn btn-primary btn-sm'
                    : 'btn btn-secondary btn-sm',
                'aria-pressed': String(appState.formsViewMode === 'PERSON_HISTORY'),
                onClick: () => {
                  appState.formsViewMode = 'PERSON_HISTORY';
                  renderFormsCenterTab(snapshot);
                },
              },
              '사람 이름별 반영·서명 내역 확인'
            )
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: async () => {
                if (!latestRenderedBody) return;
                try {
                  await navigator.clipboard.writeText(latestRenderedBody);
                  showBanner('현재 변경·반영된 서식 전문이 클립보드에 복사되었습니다.');
                } catch {
                  showBanner('우측 서식 본문을 선택해 복사(Ctrl+C)하실 수 있습니다.');
                }
              },
            },
            '변경된 양식 전문 복사'
          )
        ),
        viewerMainPane,
        appState.formsViewMode !== 'PERSON_HISTORY'
          ? h(
              'div',
              { className: 'ops-section-block' },
              sigPad.rootEl,
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-primary full-width',
                  onClick: async (e) => {
                    if (!sigPad.isConsentConfirmed()) {
                      showBanner('전자서명을 진행하려면 조항 확인 및 전자서명 동의 체크박스를 선택해 주세요.', true);
                      sigPad.focusConsent();
                      return;
                    }
                    const signerVal = sigPad.getSignerName() || fDraft.personName;
                    const sigUrl = sigPad.getSignatureDataUrl();
                    const res = await runOpsAction(
                      {
                        actionType: 'SAVE_PERSON_DOC_AND_SIGN',
                        personKey: fDraft.personKey || undefined,
                        empCode: fDraft.empCode || undefined,
                        personName: fDraft.personName,
                        deptName: fDraft.deptName,
                        jobTitle: fDraft.jobTitle,
                        hireDate: fDraft.hireDate,
                        maskedBirthOrId: fDraft.maskedBirthOrId,
                        maskedPhone: fDraft.maskedPhone,
                        address: fDraft.address,
                        weeklyHours: Number(fDraft.weeklyHours) || 40,
                        baseMonthlyPay: Number(fDraft.baseMonthlyPay) || 0,
                        mealAllowance: Number(fDraft.mealAllowance) || 0,
                        templateIds: [selectedSpec.id],
                        signNow: true,
                        consentConfirmed: true,
                        signerName: signerVal,
                        signatureDataUrl: sigUrl,
                      },
                      e.currentTarget
                    );
                    if (res?.result?.personKey) {
                      fDraft.personKey = res.result.personKey;
                    }
                  },
                },
                `현재 서식(${selectedSpec.title})에 개인정보·전자서명 저장 (이름별 내역에 보관)`
              )
            )
          : null
      )
    )
  );

  renderRightViewer();
  wrap.replaceChildren(splitStudio);
}

/* ==========================================================================
   전체 스냅샷 반영 및 2단계(대분류 → 하부 탭) 네비게이션 컨트롤러
   ========================================================================== */

function syncCodeDiffMarksState() {
  const isOn = Boolean(appState.showCodeDiffMarks);
  document.documentElement.setAttribute('data-diff-marks', isOn ? 'on' : 'off');
  const toggleBtn = document.getElementById('btn-toggle-diff-marks');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-pressed', String(isOn));
    toggleBtn.textContent = isOn ? '변경점 표시 켜짐' : '변경점 표시 꺼짐';
  }

  const changedGroups = new Set(RECENT_CODE_CHANGES.map((c) => c.menuGroup));
  for (const navBtn of Array.from(document.querySelectorAll('.major-nav-btn'))) {
    const grp = navBtn.dataset.group;
    let badge = navBtn.querySelector('.code-diff-pill');
    if (changedGroups.has(grp)) {
      if (!badge) {
        badge = h('span', { className: 'code-diff-pill' }, '변경됨');
        navBtn.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  const bar = document.getElementById('recent-diff-bar');
  if (!bar) return;
  bar.hidden = !isOn;
  if (bar.childElementCount > 0) return;
  bar.replaceChildren(
    h(
      'div',
      { className: 'recent-diff-head' },
      h(
        'div',
        { className: 'recent-diff-title' },
        h('span', { className: 'code-diff-pill' }, `최근 수정 ${RECENT_CODE_CHANGES.length}건`),
        h('span', {}, '이번 코딩에서 바뀐 화면·기능 안내 (버튼 클릭 시 바뀐 위치로 바로 이동)')
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: () => {
            appState.showCodeDiffMarks = false;
            syncCodeDiffMarksState();
            document.getElementById('btn-toggle-diff-marks')?.focus();
          },
        },
        '변경 표시 숨기기'
      )
    ),
    h(
      'div',
      { className: 'recent-diff-list' },
      ...RECENT_CODE_CHANGES.map((chg) =>
        h(
          'div',
          { className: 'recent-diff-item' },
          h(
            'div',
            { className: 'recent-diff-item-main' },
            h('span', { className: 'code-diff-pill' }, chg.badge),
            h('span', { className: 'recent-diff-item-desc' }, chg.desc)
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary btn-sm',
              onClick: (e) => chg.action(e.currentTarget),
            },
            chg.btnLabel
          )
        )
      )
    )
  );
}

function updateSnapshot(snapshot) {
  appState.snapshot = snapshot;
  const gate = document.getElementById('pc-auth-gate');
  if (gate) gate.hidden = true;
  syncCodeDiffMarksState();
  syncSimFormControls(snapshot);
  renderHeadcountKpis(snapshot);
  renderMonthlyChangeBannerAndScaleBox(snapshot);
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
  const attModal = document.getElementById('att-calendar-modal');
  if (attModal && !attModal.hidden) {
    renderAttCalendarModalContent(snapshot);
  }
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
    if (panelEl) {
      panelEl.hidden = item.key !== resolvedTabKey;
      const tabBtnEl = document.getElementById(`tab-btn-${item.key}`);
      if (tabBtnEl && panelEl.getAttribute('role') === 'tabpanel') {
        panelEl.setAttribute('aria-labelledby', `tab-btn-${item.key}`);
        panelEl.removeAttribute('aria-label');
      } else if (!panelEl.hasAttribute('aria-label')) {
        panelEl.setAttribute('aria-label', item.subLabel);
      }
    }
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
  const attModal = document.getElementById('att-calendar-modal');
  if (attModal && !attModal.hidden) {
    closeAttCalendarModal(false);
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

  document.getElementById('btn-toggle-diff-marks')?.addEventListener('click', () => {
    appState.showCodeDiffMarks = !appState.showCodeDiffMarks;
    syncCodeDiffMarksState();
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
        bizRegNo: document.getElementById('input-biz-reg-no')?.value || undefined,
        ceoName: document.getElementById('input-ceo-name')?.value || undefined,
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
  document.getElementById('att-cal-close-btn')?.addEventListener('click', () => {
    closeAttCalendarModal(true);
  });
  document.getElementById('att-cal-payslip-btn')?.addEventListener('click', (e) => {
    if (appState.selectedEmpCode) {
      openPayslipByEmpCode(appState.selectedEmpCode, e.currentTarget);
    }
  });
  document.getElementById('att-calendar-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'att-calendar-modal') closeAttCalendarModal(true);
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

  const maskClientPii = (txt) =>
    String(txt || '')
      .replace(/\b(\d{6})-[1-8]\d{6}\b/g, '$1-*******')
      .replace(/\b(01[016789])-\d{3,4}-(\d{4})\b/g, '$1-****-$2');

  async function autoCommitOnboardingToSettings(commitPayload, triggerEl = null) {
    const res = await apiPost(
      '/api/onboarding/commit',
      { ...commitPayload, preserveExistingIfMissing: true },
      triggerEl
    );
    renderOnboardingStagePreview(res.staging);
    updateSnapshot(res.snapshot);
    const statusEl = document.getElementById('settings-upload-status');
    if (statusEl) {
      statusEl.hidden = false;
      const c = res.snapshot.company;
      const hc = res.snapshot.compliance.headcounts.lsaRegularCount;
      statusEl.textContent = `자동 저장됨: ${c.companyName} (${c.bizRegNo}) · 대표자 ${c.ceoName || '대표이사'} · 상시 ${hc}명 · 재직 직원 ${res.snapshot.workers.length}명 전 메뉴(인사·근태·연차·급여) 동기화 완료`;
    }
    showBanner(
      `서류 업로드 자동 저장 완료: [${res.snapshot.company.companyName}] 환경 설정 및 전 메뉴 직원 명부(${res.snapshot.workers.length}명)에 즉시 반영되었습니다.`
    );
    return res;
  }

  // 환경 설정 내 서류 파일 업로드 -> 즉시 자동 파싱·환경 설정 저장·전 메뉴 동기화
  document.getElementById('settings-doc-file-input')?.addEventListener('change', async (e) => {
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
      const files = [];
      for (const f of selected.slice(0, 10)) {
        const rawText = await f.text();
        files.push({ fileName: f.name, content: maskClientPii(rawText) });
      }
      await autoCommitOnboardingToSettings({ files });
    } catch (err) {
      showBanner(err.message, true);
    } finally {
      inputEl.disabled = false;
      inputEl.removeAttribute('aria-busy');
      labelEl?.removeAttribute('aria-busy');
      inputEl.value = '';
    }
  });

  document.getElementById('btn-settings-sample-mfg')?.addEventListener('click', async (e) => {
    if (!confirmStaticDemoInputOnce()) return;
    try {
      await autoCommitOnboardingToSettings({ bundleId: 'BUNDLE_MFG_58' }, e.currentTarget);
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('btn-settings-sample-it')?.addEventListener('click', async (e) => {
    if (!confirmStaticDemoInputOnce()) return;
    try {
      await autoCommitOnboardingToSettings({ bundleId: 'BUNDLE_IT_34' }, e.currentTarget);
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  // 문서 자동입력 탭 파일 업로드 -> 서버 자동 문서분류 + 환경 설정 즉시 자동저장
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
      const files = [];
      for (const f of selected.slice(0, 10)) {
        const rawText = await f.text();
        files.push({ fileName: f.name, content: maskClientPii(rawText) });
      }
      const res = await autoCommitOnboardingToSettings({ files });
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
    const attModal = document.getElementById('att-calendar-modal');
    const modPopup = document.getElementById('module-popup-modal');
    const sidebar = document.getElementById('left-sidebar');
    const activeModal =
      docModal && !docModal.hidden
        ? docModal
        : attModal && !attModal.hidden
          ? attModal
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
      else if (activeModal === attModal) closeAttCalendarModal(true);
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
  const host = window.location.hostname;
  const isLocalOrStaticDemo =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.github.io') ||
    window.__MHR_STATIC_DEMO__ === true ||
    params.get('popup') === '1' ||
    params.get('autounlock') === '1' ||
    params.get('openmodal') === '1';

  let res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  if (!res.ok && (res.status === 401 || res.status === 403) && isLocalOrStaticDemo) {
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
