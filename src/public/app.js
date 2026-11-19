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
  activeTab: 'ops-home',
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

const ALL_PANEL_SPECS = [
  { key: 'ops-home', label: '통합 관리 홈 (전사 대시보드)' },
  { key: 'ops-recruit', label: 'M1·M2 채용 파이프라인 & 전자근로계약' },
  { key: 'ops-org', label: 'M3 인사명부 · 조직 · 발령 · 재직증명서' },
  { key: 'ops-attendance', label: 'M4 실시간 출퇴근 · 교대 · 주52시간 관제' },
  { key: 'ops-leave', label: 'M5 연차 자동원장 · 제61조 사용촉진 · 모성보호' },
  { key: 'ops-eval', label: 'M6 인사평가(KPI·역량) · 보상 시뮬레이션' },
  { key: 'ops-discipline', label: 'M7 적법 징계 4대절차 · 제95조 감봉 · 고충처리' },
  { key: 'payroll', label: 'M8 자동 급여·세무·4대보험 & 임금명세서' },
  { key: 'alumni', label: 'M9 퇴사자 14일 청산 · 상실신고 · 3년 보존/파기' },
  { key: 'ops-statutory', label: 'M10 노사협의회 · 산업안전보건 · 5대 법정교육' },
  { key: 'compliance', label: '관공서 신고 카운트다운 & 분기 정기감독' },
  { key: 'lifecycle', label: '채용~퇴사 법령 가드레일 시뮬레이션 검증기' },
  { key: 'onboarding', label: 'M0 사업장 4종 문서 무입력 자동온보딩' },
  { key: 'floor', label: '시스템 4계층 모듈형 설계도면 (4F~1F)' },
];

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

function syncSimFormControls(snapshot) {
  const { company, industries, presets, emptyRosterMode } = snapshot;

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
              showBanner(`프리셋 적용 완료: ${data.snapshot.company.companyName} (${p.badge})`);
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

  for (const selId of ['popup-preset-select', 'sidebar-preset-select']) {
    const presetSel = document.getElementById(selId);
    if (presetSel) {
      const matchedPreset = presets.some((p) => p.id === company.id);
      const opts = presets.map((p) =>
        h(
          'option',
          { value: p.id },
          selId === 'sidebar-preset-select' ? p.badge : `사업장 규모: ${p.badge}`
        )
      );
      if (!matchedPreset) {
        opts.unshift(h('option', { value: '' }, `현재 개통: ${company.companyName}`));
      }
      presetSel.replaceChildren(...opts);
      presetSel.value = matchedPreset ? company.id : '';
    }
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

  const unionCheck = document.getElementById('check-majority-union');
  if (unionCheck) unionCheck.checked = Boolean(company.hasMajorityUnion);

  const subCheck = document.getElementById('check-subsidies');
  if (subCheck) subCheck.checked = (company.activeSubsidies || []).length > 0;

  const emptyToggle = document.getElementById('toggle-empty-roster');
  if (emptyToggle) emptyToggle.checked = Boolean(emptyRosterMode);
}

function renderHeadcountKpis(snapshot) {
  const { compliance } = snapshot;
  const hc = compliance.headcounts;
  const autoCount = compliance.floorPlan.filter((m) => m.status === 'AUTO_PROVISIONED').length;
  const pendingFilings = compliance.statutoryFilings.filter((f) => !f.isCompleted).length;

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
      h('div', { className: 'kpi-label' }, '산안법 현장 관리 인원 (파견포함)'),
      h('div', { className: 'kpi-value' }, `${hc.oshRegularCount}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        compliance.oshFlags.needsSafetyOfficer
          ? '안전·보건관리자 선임 및 산안위 의무 발동'
          : '현재 업종·규모 선임 의무 미해당'
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '자동 프로비저닝 활성 모듈'),
      h('div', { className: 'kpi-value' }, `${autoCount}개 자동개설`),
      h(
        'div',
        { className: 'kpi-sub' },
        hc.is30OrMore ? '노사협의회(30+) · 공정채용 가동 중' : '규모 성장 시 즉시 자동 활성화'
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '미이행 법정 신고·제정 과제'),
      h('div', { className: 'kpi-value' }, `${pendingFilings}건 감독 중`),
      h(
        'div',
        { className: 'kpi-sub' },
        `분기별 정기 운영 일정 ${compliance.quarterlySchedule.reduce((s, q) => s + q.items.length, 0)}건 예약됨`
      )
    ),
  ];

  const strip = document.getElementById('headcount-kpi-strip');
  if (strip) strip.replaceChildren(...cards);

  const compactLine = document.getElementById('compact-workplace-summary');
  if (compactLine) {
    const indObj = (snapshot.industries || []).find((i) => i.code === snapshot.company.ksicMajor);
    compactLine.replaceChildren(
      ...[
        h('span', { className: 'font-extrabold' }, snapshot.company.companyName),
        h(
          'span',
          { className: 'tag tag-blue' },
          `[${snapshot.company.ksicMajor}] ${indObj ? indObj.name : '제조업'}`
        ),
        h('span', { className: 'tag tag-gray' }, `근기법 상시 ${hc.lsaRegularCount}명`),
        h('span', { className: 'tag tag-gray' }, `산안법 ${hc.oshRegularCount}명`),
        hc.is30OrMore ? h('span', { className: 'tag tag-green' }, '30인+ 노사협의회·고충위원 가동') : null,
        compliance.oshFlags.needsSafetyOfficer
          ? h('span', { className: 'tag tag-amber' }, '50인+ 안전·보건관리자·산안위 가동')
          : null,
        pendingFilings > 0
          ? h('span', { className: 'tag tag-red' }, `법정기한 감독 ${pendingFilings}건`)
          : null,
      ].filter(Boolean)
    );
  }

  if (hc.upcomingThresholdWarnings.length > 0) {
    showBanner(hc.upcomingThresholdWarnings.map((w) => w.message).join(' / '));
  }

  const sbName = document.getElementById('sidebar-company-name');
  if (sbName) sbName.textContent = snapshot.company.companyName;
  const sbMeta = document.getElementById('sidebar-company-meta');
  if (sbMeta) {
    const scaleNote = hc.is30OrMore
      ? '30인+ 노사협의회'
      : hc.is5OrMore
        ? '5인+ 가산·연차'
        : '5인 미만 특례';
    const oshNote = compliance.oshFlags.needsSafetyOfficer ? ' · 50인+ 안전보건' : '';
    sbMeta.textContent = `근기법 상시 ${hc.lsaRegularCount}명 · 산안법 ${hc.oshRegularCount}명 · ${scaleNote}${oshNote}`;
  }

  const k = snapshot.operationsSuite?.overviewKpis;
  const setNavBadge = (tabKey, text) => {
    const el = document.getElementById(`nav-badge-${tabKey}`);
    if (el) el.textContent = text;
  };
  if (k) {
    setNavBadge('ops-home', '전사');
    setNavBadge(
      'ops-recruit',
      k.unsignedContractCount > 0 ? `미서명 ${k.unsignedContractCount}` : `후보 ${k.applicantOpenCount}`
    );
    setNavBadge('ops-org', `${k.activeRosterCount}명`);
    setNavBadge(
      'ops-attendance',
      k.over52Count > 0 ? `초과 ${k.over52Count}` : k.near52Count > 0 ? `주의 ${k.near52Count}` : '정상'
    );
    setNavBadge('ops-leave', k.leavePromoPendingCount > 0 ? `촉진 ${k.leavePromoPendingCount}` : '완료');
    setNavBadge('ops-eval', k.pendingEvalApplyCount > 0 ? `대기 ${k.pendingEvalApplyCount}` : '반영');
    setNavBadge('ops-discipline', k.openGrievanceCount > 0 ? `고충 ${k.openGrievanceCount}` : '정상');
    setNavBadge('payroll', `${snapshot.payrollSummary?.workerCount || 0}명`);
    setNavBadge(
      'alumni',
      k.pendingOffboardSettlementCount > 0
        ? `청산 ${k.pendingOffboardSettlementCount}`
        : `${snapshot.offboardedWorkers?.length || 0}건`
    );
    setNavBadge('ops-statutory', `${k.avgStatutoryEduRatePct}%`);
    setNavBadge('compliance', pendingFilings > 0 ? `신고 ${pendingFilings}` : '완료');
    setNavBadge('lifecycle', '검증');
    setNavBadge('onboarding', 'M0');
    setNavBadge('floor', `${autoCount}개`);
  }

  const globalFormsWrap = document.getElementById('global-forms-drawer-buttons');
  if (globalFormsWrap && globalFormsWrap.childElementCount === 0) {
    const formSpecs = [
      { id: 'DOC_PRIVACY_CONSENT', label: '개인정보 수집·이용·제3자제공 동의서', primary: true },
      { id: 'DOC_NDA_SECURITY_PLEDGE', label: '비밀유지 및 정보보안 서약서 (입사·재직)', primary: true },
      { id: 'DOC_EXIT_SECURITY_NONCOMPETE', label: '퇴사 시 보안·자산반납·경업금지 서약서', primary: true },
      { id: 'DOC_EMPLOYMENT_CONTRACT', label: '제17조 표준 근로계약서', primary: false },
      { id: 'DOC_WORK_RULES_REPORT', label: '10인+ 취업규칙 신고·의견청취서', primary: false },
      { id: 'DOC_LMC_REGULATION_AND_FILING', label: '30인+ 노사협의회 규정·신고서', primary: false },
      { id: 'DOC_LMC_MINUTES', label: '노사협의회 분기 정기회의록', primary: false },
      { id: 'DOC_OSH_OFFICER_APPOINTMENT', label: '50인+ 안전·보건관리자 선임보고서', primary: false },
      { id: 'DOC_OSH_MINUTES', label: '산업안전보건위 회의록·위험성평가표', primary: false },
    ];
    globalFormsWrap.replaceChildren(
      ...formSpecs.map((f) =>
        h(
          'button',
          {
            type: 'button',
            className: f.primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
            onClick: (e) => openDocumentPreview(f.id, e.currentTarget),
          },
          f.label
        )
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
  if (workerSelect) {
    const regularWorkers = snapshot.workers.filter(
      (w) =>
        w.workerCategory === 'REGULAR' ||
        w.workerCategory === 'FIXED_TERM' ||
        w.workerCategory === 'PART_TIME'
    );
    const prevVal = workerSelect.value;
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
        h('div', { className: 'kpi-label' }, '실지급액 합계 (세후)'),
        h('div', { className: 'kpi-value' }, fmtWon(payrollSummary.totalNet)),
        h('div', { className: 'kpi-sub' }, `법령 점검 경보 ${payrollSummary.warningCount}건`)
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

  appState.activeTab = targetKey;
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  for (const btn of tabButtons) {
    const isMatch = btn.dataset.tab === targetKey;
    btn.setAttribute('aria-selected', String(isMatch));
    btn.tabIndex = isMatch ? 0 : -1;
  }
  for (const s of ALL_PANEL_SPECS) {
    const p = document.getElementById(`panel-${s.key}`);
    if (p) p.hidden = s.key !== targetKey;
  }
  syncReviewTourLabel();

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
  const pendingFilings = snapshot.compliance.statutoryFilings.filter((f) => !f.isCompleted).length;

  const topKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '재직 인원 · 진행중 채용'),
      h('div', { className: 'kpi-value' }, `재직 ${k.activeRosterCount}명 · 채용 ${k.applicantOpenCount}명`),
      h(
        'div',
        { className: 'kpi-sub' },
        k.unsignedContractCount > 0
          ? `전자근로계약 미체결 ${k.unsignedContractCount}건 즉시 서명 필요`
          : '전 직원 제17조 전자계약 체결 완료'
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '주 52시간 관제 · 연차촉진'),
      h(
        'div',
        { className: 'kpi-value' },
        `52h초과 ${k.over52Count}명 · 주의 ${k.near52Count}명`
      ),
      h('div', { className: 'kpi-sub' }, `제61조 연차촉진 발송 대기 ${k.leavePromoPendingCount}명`)
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '당월 자동급여 · 퇴사청산(14일)'),
      h('div', { className: 'kpi-value' }, fmtWon(paySum.totalNet)),
      h(
        'div',
        { className: 'kpi-sub' },
        `급여 법령경보 ${paySum.warningCount}건 · 퇴사 14일 청산대기 ${k.pendingOffboardSettlementCount}명`
      )
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '법정기구 · 고충 · 5대 의무교육'),
      h('div', { className: 'kpi-value' }, `신고과제 ${pendingFilings}건 · 교육 ${k.avgStatutoryEduRatePct}%`),
      h('div', { className: 'kpi-sub' }, `고충처리(10일 기한) 진행중 ${k.openGrievanceCount}건`)
    )
  );

  const moduleCardsSpec = [
    {
      tab: 'ops-recruit',
      badge: 'M1 · M2',
      badgeClass: 'tag tag-blue',
      title: '채용 파이프라인 & 전자근로계약 · 4대보험 취득',
      desc: '채용절차법 블라인드 필터·최저임금 심사 후 합격자 원클릭 입사 발령, 제17조 근로계약 서명·교부 및 4대보험 취득신고를 관리합니다.',
      metric: `진행 후보 ${k.applicantOpenCount}명 · 미서명 계약 ${k.unsignedContractCount}건`,
    },
    {
      tab: 'ops-org',
      badge: 'M3',
      badgeClass: 'tag tag-blue',
      title: '인사명부 · 부서 조직현황 · 인사발령 · 재직증명서',
      desc: '부서별 정원·인건비 현황을 조회하고 승진·전보·육아휴직(4대보험 납부예외 자동연동)·복직 발령과 재직증명서를 즉시 처리합니다.',
      metric: `운영 부서 ${ops.orgAndAssignments.departments.length}개 · 최근 발령 ${ops.orgAndAssignments.assignmentLogs.length}건`,
    },
    {
      tab: 'ops-attendance',
      badge: 'M4',
      badgeClass: k.over52Count > 0 ? 'tag tag-red' : 'tag tag-green',
      title: '실시간 출퇴근 · 교대/선택근무 · 주 52시간 관제',
      desc: '통상·2교대·선택근무제 근로자의 연장·야간·휴일 시간을 집계하고 주 48h 예고 / 52h 상한(제53조) 경보를 M8 가산수당에 직결합니다.',
      metric: `주52h 초과 ${k.over52Count}명 · 48h+ 주의 ${k.near52Count}명`,
    },
    {
      tab: 'ops-leave',
      badge: 'M5',
      badgeClass: 'tag tag-green',
      title: '연차휴가 자동원장 · 제61조 사용촉진 · 모성보호',
      desc: '입사일 기준 제60조 연차(11일/15~25일) 자동 산정, 만료 6개월·2개월 전 서면 사용촉진 통지서 발송, 출산·육아단축 지원금을 관리합니다.',
      metric: `촉진 발송 대기 ${k.leavePromoPendingCount}명 · 모성보호 ${ops.leaveAndMaternity.maternityProtections.length}건`,
    },
    {
      tab: 'ops-eval',
      badge: 'M6',
      badgeClass: 'tag tag-amber',
      title: '인사평가(KPI·역량) · 보상 시뮬레이션 · 연봉갱신',
      desc: '업적·역량 평가등급(S~D)에 따른 기본급 인상률(%)과 성과급을 시뮬레이션하고 확정 즉시 M8 자동 급여대장에 일괄 반영합니다.',
      metric: `급여 미반영 평가안 ${k.pendingEvalApplyCount}명`,
    },
    {
      tab: 'ops-discipline',
      badge: 'M7',
      badgeClass: 'tag tag-red',
      title: '적법 징계 4대절차 · 제95조 감봉한도 · 고충처리위원',
      desc: '출석통지·소명·징계위의결·서면통지 누락을 방지하고 제95조 감봉 상한(일급 1/2·월 1/10) 캡핑 및 고충 접수 10일 내 통보를 감독합니다.',
      metric: `제95조 초과차단 ${fmtWon(paySum.totalCutBlocked)} · 진행 고충 ${k.openGrievanceCount}건`,
    },
    {
      tab: 'payroll',
      badge: 'M8',
      badgeClass: 'tag tag-blue',
      title: '자동 급여·세무·4대보험 정산 & 산출식 임금명세서',
      desc: '상용·단시간·일용·3.3% 통합 정산, 5인 이상 가산율 분기, 식대 비과세 한도 분리 및 근기법 제48조 산출식 임금명세서를 자동 생성합니다.',
      metric: `정산 ${paySum.workerCount}명 · 실지급 합계 ${fmtWon(paySum.totalNet)}`,
    },
    {
      tab: 'alumni',
      badge: 'M9',
      badgeClass: 'tag tag-amber',
      title: '전 주기 퇴사자 통합 사후관리 (14일 청산 · 3년 보존)',
      desc: '퇴직금(평균vs통상 하한)·연차수당 14일 지급 타이머, 건보·고보 상실/이직확인서, 지원금 감원방지 경보, 제39조 증명서 및 제42조 3년 보존/파기를 수행합니다.',
      metric: `14일 청산대기 ${k.pendingOffboardSettlementCount}명 · 보존중 ${snapshot.offboardedSummary?.activeRetentionCount || 0}명`,
    },
    {
      tab: 'ops-statutory',
      badge: 'M10 · 법정기구',
      badgeClass: 'tag tag-green',
      title: '노사협의회(30+) · 산업안전보건(50+) · 5대 법정의무교육',
      desc: '노사협의회 위원·분기안건, 안전·보건관리자 선임 및 공정별 위험성평가, 5대 법정의무교육 부서별 이수율·미이수 독촉을 통합 운영합니다.',
      metric: `5대 법정교육 평균 이수율 ${k.avgStatutoryEduRatePct}% · 관공서 신고 ${pendingFilings}건`,
    },
  ];

  const hubGrid = h(
    'div',
    { className: 'ops-hub-grid' },
    moduleCardsSpec.map((m) =>
      h(
        'article',
        { className: 'ops-module-card' },
        h(
          'div',
          {},
          h(
            'div',
            { className: 'ops-module-top' },
            h('span', { className: m.badgeClass }, m.badge),
            h(
              'div',
              { className: 'step-pill-group' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  onClick: (e) => openModuleDetailPopup(m.tab, e.currentTarget),
                },
                '상세 팝업'
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  onClick: () => openStandalonePopupWindow(m.tab),
                },
                '새 창 팝업'
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-primary btn-sm',
                  onClick: (e) => {
                    if (appState.popupModalTabKey) {
                      openModuleDetailPopup(m.tab, e.currentTarget);
                    } else {
                      switchTab(m.tab, true);
                    }
                  },
                },
                '관리 열기'
              )
            )
          ),
          h('h3', { className: 'ops-module-title' }, m.title),
          h('p', { className: 'ops-module-desc' }, m.desc)
        ),
        h('div', { className: 'ops-module-metrics' }, m.metric)
      )
    )
  );

  const actionItems = [];
  if (k.unsignedContractCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-red',
      tagText: '즉시 필요',
      text: `전자근로계약 미체결 ${k.unsignedContractCount}명 — 근로기준법 제17조 서면교부 필요`,
      tab: 'ops-recruit',
    });
  }
  if (k.over52Count > 0 || k.near52Count > 0) {
    actionItems.push({
      tagClass: k.over52Count > 0 ? 'tag tag-red' : 'tag tag-amber',
      tagText: '주52h 관제',
      text: `주 52시간 초과 ${k.over52Count}명 · 48h+ 임박 ${k.near52Count}명 연장근로 점검`,
      tab: 'ops-attendance',
    });
  }
  if (k.leavePromoPendingCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-amber',
      tagText: '연차촉진',
      text: `제61조 미사용 연차 서면 사용촉진 발송 대상 ${k.leavePromoPendingCount}명`,
      tab: 'ops-leave',
    });
  }
  if (k.pendingOffboardSettlementCount > 0) {
    actionItems.push({
      tagClass: 'tag tag-amber',
      tagText: '14일 청산',
      text: `퇴사자 14일 이내 금품청산·상실신고 대기 ${k.pendingOffboardSettlementCount}명`,
      tab: 'alumni',
    });
  }
  for (const f of snapshot.compliance.statutoryFilings.filter((x) => !x.isCompleted).slice(0, 2)) {
    actionItems.push({
      tagClass: 'tag tag-blue',
      tagText: `기한 ${f.dueDate}`,
      text: f.title,
      tab: 'compliance',
    });
  }
  if (actionItems.length === 0) {
    actionItems.push({
      tagClass: 'tag tag-green',
      tagText: '전수 적합',
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
      h('h3', { className: 'ops-section-title' }, '오늘 즉시 점검할 인사노무 과제 · 법정 기한'),
      h('span', { className: 'tag tag-amber' }, `점검 항목 ${actionItems.length}건`)
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
              onClick: (e) => {
                if (appState.popupModalTabKey) openModuleDetailPopup(item.tab, e.currentTarget);
                else switchTab(item.tab, true);
              },
            },
            '화면 이동'
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
      h(
        'div',
        {},
        h(
          'h3',
          { className: 'ops-section-title' },
          '필수 인사 · 개인정보 · 정보보안 · 퇴사 표준 서식함'
        ),
        h(
          'p',
          { className: 'ops-module-desc' },
          '입사 동의·보안서약부터 퇴사 시 경업금지(대법원 2009다82244 가드레일)·취업규칙·노사협의회 규정까지 클릭 즉시 열람·복사합니다.'
        )
      ),
      h('span', { className: 'tag tag-blue' }, '즉시 열람 · 복사')
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
        '개인정보 수집·이용·제3자제공 동의서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_NDA_SECURITY_PLEDGE', e.currentTarget),
        },
        '비밀유지 및 정보보안 서약서 (입사·재직)'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_EXIT_SECURITY_NONCOMPETE', e.currentTarget),
        },
        '퇴사 시 보안·자산반납 및 경업금지 서약서'
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          onClick: (e) => openDocumentPreview('DOC_EMPLOYMENT_CONTRACT', e.currentTarget),
        },
        '제17조 표준 근로계약서'
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
        '30인+ 노사협의회 규정·신고서'
      )
    )
  );

  const executiveSplit = h('div', { className: 'ops-two-col' }, actionCenterCard, essentialFormsBar);

  wrap.replaceChildren(topKpis, executiveSplit, hubGrid);
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
        { id: 'asg-emp-select', name: 'asgEmp' },
        regularWorkers.map((w) =>
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
      h('button', { type: 'submit', className: 'btn btn-primary full-width' }, '인사발령 즉시 실행')
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

  const section = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '근로자별 근무유형 · 연장/야간/휴일 집계 · 주 52시간(제53조) 실시간 게이지'),
      h(
        'span',
        { className: att.is5OrMore ? 'tag tag-blue' : 'tag tag-amber' },
        att.is5OrMore
          ? '5인 이상: 주52h 상한 적용 및 연장·야간·휴일 50%(100%) 가산수당 자동 반영'
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
            h('th', { scope: 'col' }, '근태 시뮬레이션 (M8 직결)')
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
                : row.maxWeeklyWorkedHours >= 48
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
                    ? h('span', { className: 'tag tag-amber' }, '48h+ 상한 임박 예고')
                    : row.status === 'PARENTAL_OR_LEAVE'
                      ? h('span', { className: 'tag tag-blue' }, '휴직/단축 보호중')
                      : h('span', { className: 'tag tag-green' }, '적법 범위(정상)')
              ),
              h(
                'td',
                { 'data-label': '근태 시뮬레이션' },
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
                                maxWeeklyWorkedHours: 44,
                              },
                              e.currentTarget
                            ),
                        },
                        '주44h 정상조정'
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
      h('div', { className: 'kpi-sub' }, '야간 · 휴일근로 시간 M8 급여 직결')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '주 48시간+ 상한 임박'),
      h('div', { className: 'kpi-value' }, `${near52}명`),
      h('div', { className: 'kpi-sub' }, '사전 연장근로 통제 권고 대상')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '제53조 주 52시간 초과'),
      h('div', { className: 'kpi-value' }, `${over52}명`),
      h('div', { className: 'kpi-sub' }, over52 > 0 ? '즉시 근무일정 조정 필요!' : '법정 한도 위반 0명')
    )
  );

  wrap.replaceChildren(attKpis, section);
}

function renderOpsLeaveTab(snapshot) {
  const wrap = document.getElementById('ops-leave-container');
  if (!wrap || !snapshot.operationsSuite) return;
  const lv = snapshot.operationsSuite.leaveAndMaternity;

  const promoLabel = (stage) => {
    if (stage === 'STAGE_2_DESIGNATED') {
      return h('span', { className: 'tag tag-green' }, '2차 시기지정 완료 (보상면제 요건 충족)');
    }
    if (stage === 'STAGE_1_SENT') {
      return h('span', { className: 'tag tag-blue' }, '1차 서면촉진 완료 (만료 6개월 전)');
    }
    return h('span', { className: 'tag tag-amber' }, '미발송 (수당 추계 대상)');
  };

  const leaveSection = h(
    'div',
    { className: 'ops-section-block' },
    h(
      'div',
      { className: 'ops-section-head' },
      h('h3', { className: 'ops-section-title' }, '근로기준법 제60조 연차 자동원장 & 제61조 1·2차 서면 사용촉진 대장'),
      h(
        'span',
        { className: lv.is5OrMore ? 'tag tag-green' : 'tag tag-gray' },
        lv.is5OrMore ? '5인 이상 제60조·제61조 가동 중' : '5인 미만 법정 연차 적용 제외'
      )
    ),
    h(
      'div',
      { className: 'table-scroll-wrap' },
      h(
        'table',
        { className: 'payroll-table', 'aria-label': '연차유급휴가 발생·사용 및 사용촉진 대장' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '사번 · 성명 · 입사일'),
            h('th', { scope: 'col' }, '제60조 산정 근거'),
            h('th', { scope: 'col', className: 'num' }, '발생 / 사용 / 잔여'),
            h('th', { scope: 'col' }, '제61조 연차사용촉진 단계'),
            h('th', { scope: 'col', className: 'num' }, '미사용수당 추계액'),
            h('th', { scope: 'col' }, '서면촉진 · 통지서')
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
                { 'data-label': '사번 · 성명 · 입사일' },
                h('div', { className: 'cell-emp-code' }, `${r.empCode} · 입사 ${r.hireDate}`),
                h('div', { className: 'breakable-name' }, r.displayName),
                h('div', { className: 'cell-dept-name' }, r.deptName)
              ),
              h('td', { 'data-label': '제60조 산정 근거' }, r.ruleBasis),
              h(
                'td',
                { className: 'num font-extrabold', 'data-label': '발생 / 사용 / 잔여' },
                `${r.accruedDays}일 / ${r.usedDays}일 / 잔여 ${r.remainingDays}일`
              ),
              h('td', { 'data-label': '제61조 촉진 단계' }, promoLabel(r.promoStage)),
              h(
                'td',
                { className: 'num', 'data-label': '미사용수당 추계액' },
                fmtWon(r.estimatedUnusedPayout)
              ),
              h(
                'td',
                { 'data-label': '서면촉진 · 통지서' },
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

  const totAccrued = lv.ledger.reduce((s, r) => s + (r.accruedDays || 0), 0);
  const totRemain = lv.ledger.reduce((s, r) => s + (r.remainingDays || 0), 0);
  const promoWait = lv.ledger.filter((r) => r.promoStage !== 'STAGE_2_DESIGNATED').length;
  const leaveKpis = h(
    'div',
    { className: 'kpi-strip' },
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '제60조 총 발생 연차'),
      h('div', { className: 'kpi-value' }, `${totAccrued}일`),
      h('div', { className: 'kpi-sub' }, '입사일 기준 월차·연차 자동 산정')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '전사 미사용 잔여 연차'),
      h('div', { className: 'kpi-value' }, `${totRemain}일`),
      h('div', { className: 'kpi-sub' }, '미촉진 시 연차미사용수당 추계 반영')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '제61조 서면촉진 진행대상'),
      h('div', { className: 'kpi-value' }, `${promoWait}명`),
      h('div', { className: 'kpi-sub' }, '1차(6개월 전) · 2차(2개월 전) 통지서')
    ),
    h(
      'div',
      { className: 'kpi-card' },
      h('div', { className: 'kpi-label' }, '모성보호 · 육아지원 적용'),
      h('div', { className: 'kpi-value' }, `${lv.maternityProtections.length}건`),
      h('div', { className: 'kpi-sub' }, '출산전후휴가 · 육아기 단축 지원금')
    )
  );

  wrap.replaceChildren(leaveKpis, leaveSection, matSection);
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

/* ==========================================================================
   전체 스냅샷 반영 및 이벤트 바인딩 초기화
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
  if (!sidebar) return;
  if (isOpen) {
    sidebar.setAttribute('data-sidebar-open', 'true');
    if (backdrop) backdrop.hidden = false;
    toggleBtn?.setAttribute('aria-expanded', 'true');
  } else {
    sidebar.removeAttribute('data-sidebar-open');
    if (backdrop) backdrop.hidden = true;
    toggleBtn?.setAttribute('aria-expanded', 'false');
  }
}

function syncReviewTourLabel() {
  const lbl = document.getElementById('review-step-label');
  const idx = ALL_PANEL_SPECS.findIndex((s) => s.key === appState.activeTab);
  const pos = idx >= 0 ? idx + 1 : 1;
  const title = idx >= 0 ? ALL_PANEL_SPECS[idx].label : appState.activeTab;
  if (lbl) {
    lbl.textContent = `${pos} / ${ALL_PANEL_SPECS.length} · ${title}`;
  }
  const catBadge = document.getElementById('workspace-category-badge');
  const activeBtn = document.getElementById(`tab-btn-${appState.activeTab}`);
  if (catBadge && activeBtn?.dataset?.category) {
    catBadge.textContent = activeBtn.dataset.category;
  }
}

function switchTab(tabKey, focusTabBtn = false) {
  if (appState.popupModalTabKey) {
    closeModuleDetailPopup(false);
  }
  setMobileSidebarOpen(false);
  appState.activeTab = tabKey;
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  for (const btn of tabButtons) {
    const isMatch = btn.dataset.tab === tabKey;
    btn.setAttribute('aria-selected', String(isMatch));
    btn.tabIndex = isMatch ? 0 : -1;
    if (isMatch && focusTabBtn) btn.focus();
  }
  for (const spec of ALL_PANEL_SPECS) {
    const panelEl = document.getElementById(`panel-${spec.key}`);
    if (panelEl) panelEl.hidden = spec.key !== tabKey;
  }
  syncReviewTourLabel();
}

function bindEvents() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  themeBtn?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    themeBtn.textContent = next === 'dark' ? '밝은 화면 전환' : '어두운 화면 전환';
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
      document.getElementById(`tab-btn-${appState.activeTab}`)?.focus();
    }
  });

  document.getElementById('btn-close-mobile-sidebar')?.addEventListener('click', () => {
    setMobileSidebarOpen(false);
    document.getElementById('btn-mobile-sidebar-toggle')?.focus();
  });

  document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
    setMobileSidebarOpen(false);
  });

  document.getElementById('btn-toggle-forms-drawer')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const drawer = document.getElementById('quick-forms-drawer');
    if (!drawer) return;
    const nextOpen = drawer.hidden;
    drawer.hidden = !nextOpen;
    btn.setAttribute('aria-expanded', String(nextOpen));
    btn.textContent = nextOpen ? '필수 서식함 접기' : '필수 법정·보안 서식함';
  });

  document.getElementById('btn-toggle-sim-drawer')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const drawer = document.getElementById('sim-settings-drawer');
    if (!drawer) return;
    const nextOpen = drawer.hidden;
    drawer.hidden = !nextOpen;
    btn.setAttribute('aria-expanded', String(nextOpen));
    btn.textContent = nextOpen ? '사업장 규모·환경설정 접기' : '사업장 규모·환경설정 열기';
  });

  document.getElementById('sidebar-preset-apply-btn')?.addEventListener('click', async (e) => {
    const selectEl = document.getElementById('sidebar-preset-select');
    const presetId = selectEl?.value || '';
    if (!presetId) {
      showBanner('전환할 사업장 규모 시나리오 프리셋을 선택해 주세요.', true);
      return;
    }
    try {
      const data = await apiPost('/api/simulate-company', { presetId }, e.currentTarget);
      updateSnapshot(data.snapshot);
      showBanner(`사업장 규모 시나리오 전환 완료: ${data.snapshot.company.companyName}`);
    } catch (err) {
      showBanner(err.message, true);
    }
  });

  document.getElementById('btn-jump-onboarding')?.addEventListener('click', () => {
    switchTab('onboarding', true);
  });

  document.getElementById('btn-open-dashboard-popup')?.addEventListener('click', () => {
    openStandalonePopupWindow(null);
  });

  document.getElementById('btn-open-mobile-popup')?.addEventListener('click', () => {
    openMobilePopupWindow();
  });

  document.getElementById('btn-tour-prev')?.addEventListener('click', () => {
    const idx = ALL_PANEL_SPECS.findIndex((s) => s.key === appState.activeTab);
    const prevIdx = (idx - 1 + ALL_PANEL_SPECS.length) % ALL_PANEL_SPECS.length;
    switchTab(ALL_PANEL_SPECS[prevIdx].key, false);
  });

  document.getElementById('btn-tour-next')?.addEventListener('click', () => {
    const idx = ALL_PANEL_SPECS.findIndex((s) => s.key === appState.activeTab);
    const nextIdx = (idx + 1) % ALL_PANEL_SPECS.length;
    switchTab(ALL_PANEL_SPECS[nextIdx].key, false);
  });

  document.getElementById('btn-open-current-module-modal')?.addEventListener('click', (e) => {
    openModuleDetailPopup(appState.activeTab, e.currentTarget);
  });

  document.getElementById('btn-detach-current-module-popup')?.addEventListener('click', () => {
    openStandalonePopupWindow(appState.activeTab);
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

  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  tabButtons.forEach((btn, idx) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, false));
    btn.addEventListener('keydown', (e) => {
      let nextIdx = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % tabButtons.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIdx = (idx - 1 + tabButtons.length) % tabButtons.length;
      } else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabButtons.length - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        switchTab(tabButtons[nextIdx].dataset.tab, true);
      }
    });
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
      };
      const data = await apiPost('/api/simulate-company', payload, btn);
      updateSnapshot(data.snapshot);
      showBanner(
        `재산정 완료: 근로기준법 상시 ${data.snapshot.compliance.headcounts.lsaRegularCount}명 / 산안법 ${data.snapshot.compliance.headcounts.oshRegularCount}명 기준 갱신됨`
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
      const files = [];
      for (const f of selected.slice(0, 10)) {
        const content = await f.text();
        files.push({ fileName: f.name, content });
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
  if (requestedTab && ALL_PANEL_SPECS.some((s) => s.key === requestedTab)) {
    switchTab(requestedTab, false);
  } else {
    syncReviewTourLabel();
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
