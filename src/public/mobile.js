/**
 * MODULAR HR 모바일 폰 앱 컨트롤러 (대표·인사관리자·부서장·근로자)
 * - XSS 및 CSP 위반 원천 방지를 위해 innerHTML과 인라인 style 조작을 일절 사용하지 않는다.
 * - 세션 토큰은 localStorage에 저장하지 않고 서버 HttpOnly 쿠키 + 세션 바인딩 CSRF로만 통신한다.
 * - 인증 완료 시 실시간 EventSource(SSE) 스트림을 연결해 출퇴근·결재·법정신고·기기해지를 즉시 반영한다.
 */

const mobileState = {
  loginCsrfToken: '',
  demoAccounts: [],
  selectedDemoId: 'ceo',
  session: null,
  dashboard: null,
  activeTab: 'home',
  sse: null,
  lastFocusedBeforeModal: null,
  toastTimer: null,
  // 단말 메모리 전용 비추출(extractable: false) ECDSA P-256 개인키 핸들 (localStorage 미저장)
  passkeysByLoginId: Object.create(null),
};

const BG_SELECTORS = [
  'a.skip-link',
  'header.top-utility-bar',
  'div.phone-stage',
  '#m-toast',
];

const DEMO_DEVICE_BY_ID = Object.freeze({
  ceo: '대표님 iPhone 16 Pro',
  'hr.admin': '인사팀장 Galaxy S25',
  'dept.lead': '생산1팀장 현장 태블릿',
  'emp.201': '김하늘 사원 스마트폰',
});

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function getDemoAccountMeta(loginId) {
  return (mobileState.demoAccounts || []).find((item) => item.loginId === loginId) || null;
}

function fmtWon(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') {
      el.className = String(v);
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v)) {
        if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
      }
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style') {
      throw new Error('CSP 준수를 위해 인라인 style 속성은 허용되지 않습니다.');
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
  return el;
}

function setBackgroundInert(isInert) {
  for (const sel of BG_SELECTORS) {
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

function showToast(msg, isError = false) {
  const toast = document.getElementById('m-toast');
  const txt = document.getElementById('m-toast-text');
  if (!toast || !txt) return;
  if (!msg) {
    toast.hidden = true;
    return;
  }
  toast.dataset.error = String(Boolean(isError));
  txt.textContent = msg;
  toast.hidden = false;
  if (mobileState.toastTimer) clearTimeout(mobileState.toastTimer);
  if (!isError) {
    mobileState.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4500);
  }
}

function showPushBanner(notif) {
  const banner = document.getElementById('m-push-banner');
  const titleEl = document.getElementById('m-push-title');
  const bodyEl = document.getElementById('m-push-body');
  if (!banner || !titleEl || !bodyEl || !notif) return;
  banner.dataset.severity = notif.severity || 'INFO';
  titleEl.textContent = notif.title || '실시간 알림';
  bodyEl.textContent = `${notif.bodySummary || ''} (${notif.createdAt || ''})`;
  banner.hidden = false;
}

function openModal(title, sub, bodyText, triggerEl = null) {
  mobileState.lastFocusedBeforeModal =
    triggerEl instanceof HTMLElement ? triggerEl : document.activeElement;
  document.getElementById('m-modal-title').textContent = title;
  document.getElementById('m-modal-sub').textContent = sub || '';
  document.getElementById('m-modal-body').textContent = bodyText || '';
  const modal = document.getElementById('m-modal');
  setBackgroundInert(true);
  modal.hidden = false;
  document.getElementById('m-modal-close').focus();
}

function closeModal() {
  const modal = document.getElementById('m-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  setBackgroundInert(false);
  if (mobileState.lastFocusedBeforeModal instanceof HTMLElement) {
    mobileState.lastFocusedBeforeModal.focus();
  }
}

async function mobileGet(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function mobilePost(url, payload = {}, triggerBtn = null, useLoginCsrf = false) {
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.setAttribute('aria-busy', 'true');
  }
  try {
    const token = useLoginCsrf
      ? mobileState.loginCsrfToken
      : mobileState.session?.csrfToken || mobileState.loginCsrfToken;

    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && url !== '/api/mobile/login' && url !== '/api/mobile/mfa/verify') {
        disconnectSse();
        mobileState.session = null;
        mobileState.dashboard = null;
        renderAppShell();
      }
      throw new Error(data.error || `요청 처리 실패 (HTTP ${res.status})`);
    }
    return data;
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.removeAttribute('aria-busy');
    }
  }
}

function disconnectSse() {
  if (mobileState.sse) {
    mobileState.sse.close();
    mobileState.sse = null;
  }
  const dot = document.getElementById('live-dot');
  if (dot) {
    dot.dataset.live = 'false';
    dot.textContent = 'OFFLINE';
  }
}

function connectSse() {
  disconnectSse();
  if (!mobileState.session || mobileState.session.authStage !== 'AUTHENTICATED') return;

  const es = new EventSource('/api/mobile/stream');
  mobileState.sse = es;

  es.addEventListener('connected', () => {
    const dot = document.getElementById('live-dot');
    if (dot) {
      dot.dataset.live = 'true';
      dot.textContent = 'LIVE 실시간';
    }
  });

  es.addEventListener('notification', async (ev) => {
    try {
      const parsed = JSON.parse(ev.data);
      if (parsed.notification) {
        showPushBanner(parsed.notification);
      }
      await refreshDashboardQuietly();
    } catch {
      // ignore malformed frame
    }
  });

  es.addEventListener('sync', async () => {
    await refreshDashboardQuietly();
  });

  es.addEventListener('session_revoked', (ev) => {
    let reason = '관리자에 의해 기기 세션 연결이 해제되었습니다.';
    try {
      const parsed = JSON.parse(ev.data);
      if (parsed.reason) reason = parsed.reason;
    } catch {
      // ignore
    }
    disconnectSse();
    mobileState.session = null;
    mobileState.dashboard = null;
    renderAppShell();
    showToast(reason, true);
  });

  es.onerror = () => {
    const dot = document.getElementById('live-dot');
    if (dot) {
      dot.dataset.live = 'false';
      dot.textContent = '재연결 중';
    }
  };
}

async function refreshDashboardQuietly() {
  if (!mobileState.session || mobileState.session.authStage !== 'AUTHENTICATED') return;
  try {
    const { dashboard } = await mobileGet('/api/mobile/dashboard');
    mobileState.dashboard = dashboard;
    mobileState.session = dashboard.session;
    renderAuthenticatedContent();
  } catch (err) {
    if (err.status === 401) {
      disconnectSse();
      mobileState.session = null;
      mobileState.dashboard = null;
      renderAppShell();
      showToast(err.message, true);
    }
  }
}

function getTabsForRole(role) {
  if (role === 'WORKER') {
    return [
      { id: 'home', label: '출퇴근·홈' },
      { id: 'contract', label: '전자계약' },
      { id: 'request', label: '휴가·연장신청' },
      { id: 'payslip', label: '내 명세서' },
    ];
  }
  if (role === 'DEPT_MANAGER') {
    return [
      { id: 'home', label: '부서현황' },
      { id: 'approvals', label: '부서결재' },
      { id: 'roster', label: '부서원근태' },
      { id: 'alerts', label: '실시간알림' },
    ];
  }
  return [
    { id: 'home', label: '실시간관제' },
    { id: 'approvals', label: '원터치결재' },
    { id: 'compliance', label: '법정D-Day' },
    { id: 'security', label: '명부·기기보안' },
  ];
}

function applySelectedAccountToForm(loginId) {
  const meta = getDemoAccountMeta(loginId);
  const idInput = document.getElementById('login-id');
  const pwInput = document.getElementById('login-pw');
  const devInput = document.getElementById('login-device');
  if (idInput) idInput.value = loginId;
  if (pwInput) {
    pwInput.value = typeof meta?.demoPassword === 'string' ? meta.demoPassword : '';
  }
  if (devInput) {
    devInput.value = DEMO_DEVICE_BY_ID[loginId] || '모바일 단말';
  }
}

function renderDemoAccountButtons() {
  const wrap = document.getElementById('demo-account-list');
  const titleEl = document.getElementById('demo-card-title');
  if (!wrap) return;
  wrap.replaceChildren();

  const hasServerDemoSecrets = (mobileState.demoAccounts || []).some(
    (item) => typeof item.demoPassword === 'string' && item.demoPassword.length > 0
  );
  if (titleEl) {
    titleEl.textContent = hasServerDemoSecrets
      ? '체험용 역할 빠른 선택 (MHR_DEMO_MODE 1클릭 자동 입력)'
      : '역할 계정 선택 (사전 주입된 비밀번호 입력)';
  }

  for (const item of mobileState.demoAccounts) {
    const active = mobileState.selectedDemoId === item.loginId;
    const btn = h(
      'button',
      {
        type: 'button',
        className: 'demo-card-btn',
        'aria-pressed': String(active),
        onClick: () => {
          mobileState.selectedDemoId = item.loginId;
          applySelectedAccountToForm(item.loginId);
          renderDemoAccountButtons();
        },
      },
      h('span', { className: 'demo-card-role' }, `${item.role} · ${item.loginId}`),
      h('span', { className: 'demo-card-desc' }, item.label)
    );
    wrap.appendChild(btn);
  }
}

function renderAppShell() {
  const viewLogin = document.getElementById('view-login');
  const viewMfa = document.getElementById('view-mfa');
  const viewAuth = document.getElementById('view-authenticated');
  const logoutBtn = document.getElementById('m-logout-btn');
  const headerTitle = document.getElementById('app-header-role');

  if (!mobileState.session) {
    viewLogin.hidden = false;
    viewMfa.hidden = true;
    viewAuth.hidden = true;
    logoutBtn.hidden = true;
    headerTitle.textContent = 'MODULAR HR 모바일 로그인';
    renderDemoAccountButtons();
    return;
  }

  logoutBtn.hidden = false;

  if (mobileState.session.authStage === 'MFA_PENDING') {
    viewLogin.hidden = true;
    viewMfa.hidden = false;
    viewAuth.hidden = true;
    headerTitle.textContent = `${mobileState.session.displayName} · 2차 인증 대기`;
    document.getElementById('mfa-user-desc').textContent =
      `[${mobileState.session.roleLabel}] 권한 보호를 위해 등록된 패스키 전자서명 또는 6자리 보안 PIN을 검증합니다.`;

    const meta = getDemoAccountMeta(mobileState.session.loginId);
    const demoPin = typeof meta?.demoPin === 'string' ? meta.demoPin : '';
    document.getElementById('mfa-demo-hint').textContent = demoPin
      ? `로컬 데모 모드 안내: [${mobileState.session.loginId}] 계정의 체험용 2FA PIN(${demoPin})이 자동 입력되었습니다.`
      : '6자리 보안 PIN을 입력하거나, 이 단말에 등록된 패스키 전자서명 인증을 진행해 주세요.';
    document.getElementById('mfa-pin-input').value = demoPin;

    const localKeyEntry = mobileState.passkeysByLoginId[mobileState.session.loginId];
    const canUseLocalPasskey = Boolean(mobileState.session.passkeyEnabled && localKeyEntry);
    document.getElementById('btn-passkey-auth').hidden = !canUseLocalPasskey;
    document.getElementById('mfa-passkey-divider').hidden = !canUseLocalPasskey;
    document.getElementById('mfa-passkey-note').textContent = canUseLocalPasskey
      ? `등록된 단말 보안키(${localKeyEntry.credentialId})가 확인되었습니다. 원터치 전자서명 인증을 사용할 수 있습니다.`
      : '패스키 원터치 인증은 최초 6자리 PIN 로그인 후 기기보안/알림 탭에서 이 브라우저의 ECDSA P-256 공개키를 등록하면 활성화됩니다.';
    return;
  }

  viewLogin.hidden = true;
  viewMfa.hidden = true;
  viewAuth.hidden = false;
  headerTitle.textContent = `${mobileState.session.displayName}`;
  renderAuthenticatedContent();
}

function renderBottomNav(role) {
  const nav = document.getElementById('mobile-bottom-nav');
  const panel = document.getElementById('mobile-tab-content');
  const tabs = getTabsForRole(role);
  if (!tabs.some((t) => t.id === mobileState.activeTab)) {
    mobileState.activeTab = tabs[0].id;
  }

  // 역할이 동일해 탭 구성이 바뀌지 않았으면 DOM 교체를 생략해 키보드/스크린리더 포커스를 보존!
  const existingBtns = nav.querySelectorAll('.bottom-tab-btn');
  if (nav.dataset.renderedRole !== role || existingBtns.length !== tabs.length) {
    nav.dataset.renderedRole = role;
    nav.replaceChildren();

    tabs.forEach((t, idx) => {
      const btn = h(
        'button',
        {
          id: `m-tab-${t.id}`,
          type: 'button',
          role: 'tab',
          className: 'bottom-tab-btn',
          'aria-controls': 'mobile-tab-content',
          'aria-selected': String(t.id === mobileState.activeTab),
          tabindex: t.id === mobileState.activeTab ? '0' : '-1',
          dataset: { tabId: t.id },
          onClick: () => {
            mobileState.activeTab = t.id;
            renderAuthenticatedContent();
          },
          onKeydown: (e) => {
            let nextIdx = null;
            if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') nextIdx = 0;
            else if (e.key === 'End') nextIdx = tabs.length - 1;
            if (nextIdx !== null) {
              e.preventDefault();
              mobileState.activeTab = tabs[nextIdx].id;
              renderAuthenticatedContent();
              const buttons = nav.querySelectorAll('.bottom-tab-btn');
              buttons[nextIdx]?.focus();
            }
          },
        },
        t.label
      );
      nav.appendChild(btn);
    });
  } else {
    existingBtns.forEach((btn) => {
      const selected = btn.dataset.tabId === mobileState.activeTab;
      btn.setAttribute('aria-selected', String(selected));
      btn.setAttribute('tabindex', selected ? '0' : '-1');
    });
  }

  if (panel) {
    panel.setAttribute('aria-labelledby', `m-tab-${mobileState.activeTab}`);
  }
}

function renderAuthenticatedContent() {
  const d = mobileState.dashboard;
  if (!d || !mobileState.session) return;
  const role = mobileState.session.role;

  const strip = document.getElementById('role-banner-strip');
  strip.replaceChildren(
    h('span', {}, `${d.company.companyName} · ${mobileState.session.roleLabel}`),
    h('span', { className: 'm-badge m-badge-info' }, `기기 ${mobileState.session.deviceId}`)
  );

  renderBottomNav(role);

  const body = document.getElementById('mobile-tab-content');
  body.replaceChildren();

  if (role === 'WORKER') {
    renderWorkerTabs(body, d);
  } else if (role === 'DEPT_MANAGER') {
    renderDeptManagerTabs(body, d);
  } else {
    renderExecutiveTabs(body, d, role);
  }
}

/* ==========================================================================
   대표이사(CEO) & 인사관리자(HR_ADMIN) 화면 렌더링
   ========================================================================== */
function renderExecutiveTabs(container, d, role) {
  const tab = mobileState.activeTab;

  if (tab === 'home') {
    const kpiGrid = h(
      'div',
      { className: 'm-kpi-grid' },
      h(
        'div',
        { className: 'm-kpi-card' },
        h('div', { className: 'm-kpi-label' }, '실시간 출근 / 명부'),
        h('div', { className: 'm-kpi-value' }, `${d.kpis.workingNowCount} / ${d.kpis.totalListedWorkers}명`),
        h('div', { className: 'm-kpi-sub' }, `상시 ${d.headcounts.lsaRegularCount}인 (산안 ${d.headcounts.oshRegularCount}인)`)
      ),
      h(
        'div',
        { className: 'm-kpi-card' },
        h('div', { className: 'm-kpi-label' }, '주 52시간 초과 경보'),
        h('div', { className: 'm-kpi-value' }, `${d.kpis.weekly52ExceededCount}명`),
        h(
          'div',
          { className: 'm-kpi-sub' },
          d.kpis.weekly52ExceededCount > 0 ? '즉시 연장근로 조정 필요' : '전 인원 법정 한도 이내'
        )
      ),
      h(
        'div',
        { className: 'm-kpi-card' },
        h('div', { className: 'm-kpi-label' }, '미이행 법정 신고 과제'),
        h('div', { className: 'm-kpi-value' }, `${d.kpis.openStatutoryCount}건`),
        h('div', { className: 'm-kpi-sub' }, '14일·15일 기한 D-Day 감독 중')
      ),
      h(
        'div',
        { className: 'm-kpi-card' },
        h('div', { className: 'm-kpi-label' }, '결재 · 퇴사정산 대기'),
        h(
          'div',
          { className: 'm-kpi-value' },
          `${d.kpis.pendingApprovalCount}건 / 퇴사 ${d.kpis.alumniPendingSettlementCount || 0}명`
        ),
        h('div', { className: 'm-kpi-sub' }, `미체결 계약 ${d.kpis.unsignedContractCount}건 · 14일 청산 감독`)
      )
    );
    container.appendChild(kpiGrid);

    if (d.lastIngestionSummary) {
      const ing = d.lastIngestionSummary;
      container.appendChild(
        h(
          'div',
          { className: 'card-block' },
          h(
            'div',
            { className: 'm-item-top' },
            h('span', { className: 'm-badge m-badge-ok' }, '4종 문서 자동연결됨'),
            h('span', { className: 'm-badge m-badge-info' }, `업종 ${ing.ksicMajor}`)
          ),
          h('div', { className: 'm-item-title' }, `${ing.companyName} (${ing.bizRegNo})`),
          h(
            'p',
            { className: 'm-item-desc' },
            `재직 ${ing.activeWorkersCount}명 · 퇴사원장 ${ing.offboardedWorkersCount}명 · 대표자 제외 ${ing.excludedEmployersCount}명 · 법정모듈 ${ing.autoActivatedModulesCount}개 자동연결`
          )
        )
      );
    }

    // 당월 급여대장 요약 및 대표이사 원터치 승인 카드
    const pState = d.payrollCloseState;
    const isLocked = pState.status === 'APPROVED_LOCKED';
    const payCard = h(
      'div',
      { className: 'card-block form-stack' },
      h(
        'div',
        { className: 'm-item-top' },
        h('h2', { className: 'card-title' }, `${pState.yearMonth} 급여대장 실시간 정산 요약`),
        h(
          'span',
          { className: `m-badge ${isLocked ? 'm-badge-ok' : 'm-badge-warn'}` },
          isLocked ? '대표 최종승인 잠금' : '대표 승인 대기'
        )
      ),
      h(
        'div',
        {},
        h('div', { className: 'kv-row' }, h('span', {}, '당월 지급총액'), h('strong', { className: 'num-mono' }, fmtWon(d.payrollSummary.totalGross))),
        h('div', { className: 'kv-row' }, h('span', {}, '제95조 초과감봉 자동 차단'), h('strong', { className: 'num-mono' }, fmtWon(d.payrollSummary.totalCutBlocked))),
        h('div', { className: 'kv-row' }, h('span', {}, '4대보험·원천세 공제합계'), h('strong', { className: 'num-mono' }, fmtWon(d.payrollSummary.totalSocialIns + d.payrollSummary.totalTax))),
        h('div', { className: 'kv-row' }, h('span', {}, '실지급액 합계'), h('strong', { className: 'num-mono' }, fmtWon(d.payrollSummary.totalNet)))
      )
    );

    if (role === 'CEO' && !isLocked) {
      payCard.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-primary',
            onClick: async (e) => {
              try {
                const res = await mobilePost('/api/mobile/approve-payroll', {}, e.currentTarget);
                mobileState.dashboard = res.dashboard;
                renderAuthenticatedContent();
                showToast('당월 급여대장 최종 승인 및 스냅샷 잠금이 완료되었습니다.');
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          '대표이사 권한으로 당월 급여대장 최종 승인'
        )
      );
    } else if (role === 'HR_ADMIN' && !isLocked) {
      payCard.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-secondary',
            onClick: async (e) => {
              try {
                const res = await mobilePost('/api/mobile/submit-payroll-close', {}, e.currentTarget);
                mobileState.dashboard = res.dashboard;
                renderAuthenticatedContent();
                showToast('대표이사 모바일 앱으로 급여 승인 요청 알림을 발송했습니다.');
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          '대표이사에게 급여 마감 승인 재상신'
        )
      );
    } else if (isLocked) {
      payCard.appendChild(
        h(
          'p',
          { className: 'm-item-desc' },
          `대표이사 최종 승인으로 스냅샷이 잠금 확정되었습니다 (${pState.approvedAt || ''}). 잠금 이후 수정·재상신은 차단됩니다.`
        )
      );
    }
    container.appendChild(payCard);

    // 실시간 알림 피드
    container.appendChild(buildNotificationsCard(d.notifications));
    return;
  }

  if (tab === 'approvals') {
    container.appendChild(buildApprovalsCard(d.approvals, role));
    return;
  }

  if (tab === 'compliance') {
    const filingList = h('div', { className: 'm-list' });
    if (!d.statutoryFilings || d.statutoryFilings.length === 0) {
      filingList.appendChild(
        h('p', { className: 'm-item-desc' }, '현재 사업장 규모에서 표시할 법정 신고 과제가 없습니다.')
      );
    }
    for (const f of d.statutoryFilings || []) {
      const badgeCls = f.isCompleted
        ? 'm-badge-ok'
        : f.daysLeft !== null && f.daysLeft <= 5
          ? 'm-badge-crit'
          : 'm-badge-warn';
      const dueTxt = f.isCompleted
        ? '이행 완료'
        : f.daysLeft !== null && f.daysLeft >= 0
          ? `D-${f.daysLeft} (${f.dueDate})`
          : `기한경과 (${f.dueDate})`;

      const btnRow = h(
        'div',
        { className: 'm-btn-row' },
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-secondary m-btn-sm',
            onClick: async (e) => {
              try {
                const res = await mobilePost(
                  '/api/mobile/toggle-statutory-task',
                  { taskId: f.id },
                  e.currentTarget
                );
                mobileState.dashboard = res.dashboard;
                renderAuthenticatedContent();
                showToast('법정 과제 이행 상태가 PC·모바일에 동시 반영되었습니다.');
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          f.isCompleted ? '이행 완료 취소' : '모바일 이행 완료 체크'
        )
      );

      if (f.docTemplateId) {
        btnRow.appendChild(
          h(
            'button',
            {
              type: 'button',
              className: 'm-btn m-btn-accent m-btn-sm',
              onClick: async (e) => {
                const trigger = e.currentTarget;
                try {
                  const { document: doc } = await mobilePost(
                    '/api/mobile/document',
                    { templateId: f.docTemplateId },
                    trigger
                  );
                  openModal(doc.title, doc.subtitle || doc.legalBasis || '', doc.body, trigger);
                } catch (err) {
                  showToast(err.message, true);
                }
              },
            },
            '초안 열람'
          )
        );
      }

      filingList.appendChild(
        h(
          'article',
          { className: 'm-item' },
          h(
            'div',
            { className: 'm-item-top' },
            h('span', { className: 'm-badge m-badge-info' }, f.scaleBadge),
            h('span', { className: `m-badge ${badgeCls}` }, dueTxt)
          ),
          h('div', { className: 'm-item-title' }, f.title),
          h('p', { className: 'm-item-desc' }, `${f.authority} · ${f.legalBasis}`),
          btnRow
        )
      );
    }
    container.appendChild(
      h(
        'div',
        { className: 'card-block' },
        h('h2', { className: 'card-title' }, '규모·업종별 자동 생성 법정 신고 감독'),
        h('p', { className: 'card-sub' }, '모바일에서 초안을 확인하고 이행 완료를 체크하면 PC 대시보드와 실시간 동기화됩니다.'),
        filingList
      )
    );
    return;
  }

  if (tab === 'security') {
    // 접속 기기 원격 해지 카드
    const devList = h('div', { className: 'm-list' });
    for (const dev of d.devices) {
      const isRevoked = dev.authStage === 'REVOKED';
      const item = h(
        'div',
        { className: 'm-item' },
        h(
          'div',
          { className: 'm-item-top' },
          h('span', { className: 'm-item-title' }, `${dev.deviceLabel} (${dev.deviceId})`),
          h(
            'span',
            { className: `m-badge ${isRevoked ? 'm-badge-crit' : 'm-badge-ok'}` },
            isRevoked ? '연결해제됨' : dev.isCurrentDevice ? '현재 기기' : dev.authStage
          )
        ),
        h(
          'p',
          { className: 'm-item-desc' },
          `${dev.accountName} [${dev.role}] · ${dev.platformType} · 최근활동 ${dev.lastSeenAt}`
        )
      );
      if (!isRevoked && !dev.isCurrentDevice) {
        item.appendChild(
          h(
            'div',
            { className: 'm-btn-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'm-btn m-btn-danger m-btn-sm',
                onClick: async (e) => {
                  try {
                    const res = await mobilePost(
                      '/api/mobile/revoke-device',
                      { deviceId: dev.deviceId },
                      e.currentTarget
                    );
                    mobileState.dashboard = res.dashboard;
                    renderAuthenticatedContent();
                    showToast(`기기(${dev.deviceId}) 세션을 원격 강제 종료했습니다.`);
                  } catch (err) {
                    showToast(err.message, true);
                  }
                },
              },
              '원격 기기 연결 강제 해제'
            )
          )
        );
      }
      devList.appendChild(item);
    }

    container.appendChild(buildPasskeyRegistrationCard());

    container.appendChild(
      h(
        'div',
        { className: 'card-block' },
        h('h2', { className: 'card-title' }, '모바일 접속 기기 보안 관리 (분실·퇴사 원격 차단)'),
        devList
      )
    );

    container.appendChild(buildAlumniMobileCard(d.offboardedSummary, d.offboardedWorkers));
    container.appendChild(buildAttendanceRosterCard(d.workersAttendance, d.payrollLines));
  }
}

function buildAlumniMobileCard(summary, alumniList = []) {
  const sum = summary || {
    totalAlumniCount: 0,
    pendingSettlementCount: 0,
    pendingInsuranceLossCount: 0,
    subsidyRiskCount: 0,
  };
  const listWrap = h('div', { className: 'm-list' });

  if (!alumniList || alumniList.length === 0) {
    listWrap.appendChild(h('p', { className: 'm-item-desc' }, '관리 중인 퇴사자 이력이 없습니다.'));
  }

  for (const al of alumniList || []) {
    const isPurged = al.dataLifecycleStatus === 'ANONYMIZED_PURGED';
    const settleCls = isPurged
      ? 'm-badge-info'
      : al.settlementStatus === 'PAID'
        ? 'm-badge-ok'
        : al.settlementDday < 0
          ? 'm-badge-crit'
          : 'm-badge-warn';
    const settleLabel = isPurged
      ? '비식별 파기됨'
      : al.settlementStatus === 'PAID'
        ? '14일 청산완료'
        : al.settlementDday >= 0
          ? `청산 D-${al.settlementDday}`
          : '청산기한 경과';

    const btnRow = h('div', { className: 'm-btn-row' });
    if (!isPurged) {
      btnRow.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-secondary m-btn-sm',
            onClick: async (e) => {
              try {
                const nextStatus = al.settlementStatus === 'PAID' ? 'PENDING' : 'PAID';
                const res = await mobilePost(
                  '/api/mobile/offboarded/update-status',
                  { empCode: al.empCode, settlementStatus: nextStatus },
                  e.currentTarget
                );
                mobileState.dashboard = res.dashboard;
                renderAuthenticatedContent();
                showToast(`${al.displayName} 금품청산 상태가 갱신되었습니다.`);
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          al.settlementStatus === 'PAID' ? '청산완료 취소' : '14일 청산완료 체크'
        )
      );

      btnRow.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-secondary m-btn-sm',
            onClick: async (e) => {
              try {
                const bothFiled =
                  al.nhisLossFilingStatus === 'FILED' && al.eiLossAndCertStatus === 'FILED';
                const targetVal = bothFiled ? 'PENDING' : 'FILED';
                const res = await mobilePost(
                  '/api/mobile/offboarded/update-status',
                  {
                    empCode: al.empCode,
                    nhisLossFilingStatus: targetVal,
                    eiLossAndCertStatus: targetVal,
                  },
                  e.currentTarget
                );
                mobileState.dashboard = res.dashboard;
                renderAuthenticatedContent();
                showToast(`${al.displayName} 건보·고보 상실 상태가 갱신되었습니다.`);
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          al.nhisLossFilingStatus === 'FILED' && al.eiLossAndCertStatus === 'FILED'
            ? '상실신고 완료됨'
            : '건보·고보 상실 완료'
        )
      );

      btnRow.appendChild(
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-accent m-btn-sm',
            onClick: async (e) => {
              const trigger = e.currentTarget;
              try {
                const { document: doc } = await mobilePost(
                  '/api/mobile/document',
                  { templateId: 'DOC_EI_SEPARATION_CERT', empCode: al.empCode },
                  trigger
                );
                openModal(doc.title, doc.subtitle, doc.body, trigger);
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          '상실·이직초안'
        )
      );
    }

    listWrap.appendChild(
      h(
        'article',
        { className: 'm-item' },
        h(
          'div',
          { className: 'm-item-top' },
          h('span', { className: 'm-item-title' }, `${al.displayName} (${al.empCode})`),
          h('span', { className: `m-badge ${settleCls}` }, settleLabel)
        ),
        h(
          'p',
          { className: 'm-item-desc' },
          isPurged
            ? `개인정보보호법 제21조 비식별 파기 완료 (${al.anonymizedAt})`
            : `${al.deptName} · 퇴사 ${al.lastWorkDate} (${al.resignReasonLabel}) · 총 청산액 ${fmtWon(al.totalSettlementGross)}`
        ),
        h(
          'p',
          { className: 'm-item-desc' },
          isPurged
            ? '원본 사번·성명·일자·급여정보 영구 삭제됨'
            : `건보상실(${al.nhisLossFilingStatus}) · 고보이직(${al.eiLossAndCertStatus}) · 3년보존 만료 ${al.retentionExpiresOn}`
        ),
        btnRow
      )
    );
  }

  return h(
    'div',
    { className: 'card-block' },
    h('h2', { className: 'card-title' }, `퇴사자 통합 사후관리 원장 (총 ${sum.totalAlumniCount}명)`),
    h(
      'p',
      { className: 'card-sub' },
      `14일 청산대기 ${sum.pendingSettlementCount}명 · 상실미신고 ${sum.pendingInsuranceLossCount}건 · 지원금주의 ${sum.subsidyRiskCount}건`
    ),
    listWrap
  );
}

/* ==========================================================================
   부서관리자(DEPT_MANAGER) 화면 렌더링 (타 부서·급여 마스킹 확인)
   ========================================================================== */
function renderDeptManagerTabs(container, d) {
  const tab = mobileState.activeTab;

  if (tab === 'home') {
    container.appendChild(
      h(
        'div',
        { className: 'm-kpi-grid' },
        h(
          'div',
          { className: 'm-kpi-card' },
          h('div', { className: 'm-kpi-label' }, `${d.company.managedDeptName} 출근`),
          h('div', { className: 'm-kpi-value' }, `${d.kpis.deptWorkingCount} / ${d.kpis.deptTotalCount}명`),
          h('div', { className: 'm-kpi-sub' }, '실시간 타각 연동')
        ),
        h(
          'div',
          { className: 'm-kpi-card' },
          h('div', { className: 'm-kpi-label' }, '주 48h+ 근접/초과'),
          h('div', { className: 'm-kpi-value' }, `${d.kpis.deptNear52Count}명`),
          h('div', { className: 'm-kpi-sub' }, '부서 연장근로 사전 통제')
        )
      )
    );
    container.appendChild(
      h(
        'div',
        { className: 'card-block' },
        h('h2', { className: 'card-title' }, '역할 기반 최소권한(RBAC) 보안 적용 중'),
        h(
          'p',
          { className: 'm-item-desc' },
          `부서관리자 계정(${d.company.managedDeptName})에는 소속 부서원의 실시간 출퇴근·주52h 지표 및 연차/연장 결재 권한만 부여되며, 타 부서 명부와 전사/개인별 급여액은 서버에서 원천 마스킹됩니다.`
        )
      )
    );
    container.appendChild(buildApprovalsCard(d.approvals, 'DEPT_MANAGER'));
    return;
  }

  if (tab === 'approvals') {
    container.appendChild(buildApprovalsCard(d.approvals, 'DEPT_MANAGER'));
    return;
  }

  if (tab === 'roster') {
    container.appendChild(buildAttendanceRosterCard(d.workersAttendance, []));
    return;
  }

  container.appendChild(buildPasskeyRegistrationCard());
  container.appendChild(buildNotificationsCard(d.notifications));
}

/* ==========================================================================
   근로자(WORKER) 셀프서비스 화면 렌더링 (출퇴근 · 전자계약 · 신청 · 본인명세서)
   ========================================================================== */
function renderWorkerTabs(container, d) {
  const tab = mobileState.activeTab;
  const me = d.myProfile;

  if (tab === 'home') {
    const stateLabel =
      me?.attendanceState === 'WORKING'
        ? `근무 중 (출근 ${me.lastClockInAt || '-'})`
        : me?.attendanceState === 'CLOCKED_OUT'
          ? `퇴근 완료 (${me.lastClockOutAt || '-'})`
          : '출근 전';

    const consentChk = h('input', { id: 'worker-loc-consent', type: 'checkbox', checked: true });

    container.appendChild(
      h(
        'div',
        { className: 'card-block form-stack' },
        h('h2', { className: 'card-title' }, '모바일 출·퇴근 원터치 체크'),
        h(
          'div',
          { className: 'kv-row' },
          h('span', {}, '현재 근태 상태'),
          h('strong', {}, stateLabel)
        ),
        h(
          'div',
          { className: 'kv-row' },
          h('span', {}, '주 최대 근로 / 잔여 연차'),
          h('strong', { className: 'num-mono' }, `${me?.maxWeeklyWorkedHours || 40}h / ${me?.remainingLeaveDays ?? 0}일`)
        ),
        h(
          'label',
          { className: 'm-check-row', for: 'worker-loc-consent' },
          consentChk,
          h(
            'span',
            {},
            '[위치정보법 준수] 상시 백그라운드 추적 없이 출·퇴근 버튼 터치 시점에만 사업장 Wi-Fi/위치 일회성 확인에 동의합니다.'
          )
        ),
        h(
          'div',
          { className: 'm-field-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'm-btn m-btn-primary',
              onClick: async (e) => {
                try {
                  const res = await mobilePost(
                    '/api/mobile/worker/clock',
                    { action: 'CLOCK_IN', locationConsent: consentChk.checked },
                    e.currentTarget
                  );
                  mobileState.dashboard = res.dashboard;
                  renderAuthenticatedContent();
                  showToast('출근 체크 완료 — 대표·부서장 앱에 실시간 반영되었습니다.');
                } catch (err) {
                  showToast(err.message, true);
                }
              },
            },
            '출근 체크'
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'm-btn m-btn-secondary',
              onClick: async (e) => {
                try {
                  const res = await mobilePost(
                    '/api/mobile/worker/clock',
                    { action: 'CLOCK_OUT', locationConsent: consentChk.checked },
                    e.currentTarget
                  );
                  mobileState.dashboard = res.dashboard;
                  renderAuthenticatedContent();
                  showToast('퇴근 체크 완료 — 대표·부서장 앱에 실시간 반영되었습니다.');
                } catch (err) {
                  showToast(err.message, true);
                }
              },
            },
            '퇴근 체크'
          )
        )
      )
    );
    container.appendChild(buildNotificationsCard(d.notifications));
    return;
  }

  if (tab === 'contract') {
    const signed = Boolean(me?.contractSigned);
    const agreeChk = h('input', { id: 'worker-contract-agree', type: 'checkbox', checked: true });
    const card = h(
      'div',
      { className: 'card-block form-stack' },
      h(
        'div',
        { className: 'm-item-top' },
        h('h2', { className: 'card-title' }, '근로기준법 제17조 전자근로계약서'),
        h(
          'span',
          { className: `m-badge ${signed ? 'm-badge-ok' : 'm-badge-warn'}` },
          signed ? '전자서명·교부 완료' : '서명 대기'
        )
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'm-btn m-btn-accent',
          onClick: async (e) => {
            const trigger = e.currentTarget;
            try {
              const { document: doc } = await mobilePost(
                '/api/mobile/document',
                { templateId: 'DOC_EMPLOYMENT_CONTRACT' },
                trigger
              );
              openModal(doc.title, doc.legalBasis, doc.body, trigger);
            } catch (err) {
              showToast(err.message, true);
            }
          },
        },
        '표준 근로계약서 전문 열람'
      )
    );

    if (!signed) {
      card.append(
        h(
          'label',
          { className: 'm-check-row', for: 'worker-contract-agree' },
          agreeChk,
          h('span', {}, '임금 구성항목·소정근로시간·휴일·연차 조건을 확인했으며 전자서명 및 사본 교부에 동의합니다.')
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'm-btn m-btn-primary',
            onClick: async (e) => {
              try {
                const res = await mobilePost(
                  '/api/mobile/worker/sign-contract',
                  { agreedToTerms: agreeChk.checked },
                  e.currentTarget
                );
                mobileState.dashboard = res.dashboard;
                renderAuthenticatedContent();
                showToast('전자근로계약 서명이 완료되어 대표·인사팀 앱에 즉시 통보되었습니다.');
              } catch (err) {
                showToast(err.message, true);
              }
            },
          },
          '모바일 전자서명 완료'
        )
      );
    }
    container.appendChild(card);
    return;
  }

  if (tab === 'request') {
    const selType = h(
      'select',
      { id: 'req-type' },
      h('option', { value: 'LEAVE' }, '연차유급휴가 사용 신청 (일)'),
      h('option', { value: 'OVERTIME' }, '연장근로 사전 승인 신청 (시간)')
    );
    const inpAmt = h('input', {
      id: 'req-amt',
      type: 'number',
      min: '0.5',
      max: '24',
      step: '0.5',
      value: '1',
    });
    const inpReason = h('input', {
      id: 'req-reason',
      type: 'text',
      maxlength: '120',
      value: '개인 일정으로 인한 연차 신청',
    });

    container.appendChild(
      h(
        'form',
        {
          className: 'card-block form-stack',
          onSubmit: async (e) => {
            e.preventDefault();
            const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
            try {
              const res = await mobilePost(
                '/api/mobile/worker/request-approval',
                {
                  requestType: selType.value,
                  amount: Number(inpAmt.value),
                  reason: inpReason.value,
                },
                submitBtn
              );
              mobileState.dashboard = res.dashboard;
              renderAuthenticatedContent();
              showToast('결재 요청이 등록되어 대표·관리자 앱에 실시간 전송되었습니다.');
            } catch (err) {
              showToast(err.message, true);
            }
          },
        },
        h('h2', { className: 'card-title' }, '연차휴가 · 연장근로 모바일 신청'),
        h('div', { className: 'm-field' }, h('label', { for: 'req-type' }, '신청 구분'), selType),
        h('div', { className: 'm-field' }, h('label', { for: 'req-amt' }, '신청 일수 / 시간'), inpAmt),
        h('div', { className: 'm-field' }, h('label', { for: 'req-reason' }, '신청 사유'), inpReason),
        h('button', { type: 'submit', className: 'm-btn m-btn-primary' }, '대표·부서장에게 결재 상신')
      )
    );

    const myList = h('div', { className: 'm-list' });
    if (!d.approvals || d.approvals.length === 0) {
      myList.appendChild(h('p', { className: 'm-item-desc' }, '신청한 결재 내역이 없습니다.'));
    }
    for (const a of d.approvals || []) {
      myList.appendChild(
        h(
          'div',
          { className: 'm-item' },
          h(
            'div',
            { className: 'm-item-top' },
            h('span', { className: 'm-item-title' }, a.title),
            h('span', { className: 'm-badge m-badge-info' }, a.status)
          ),
          h('p', { className: 'm-item-desc' }, a.detailSummary)
        )
      );
    }
    container.appendChild(h('div', { className: 'card-block' }, h('h2', { className: 'card-title' }, '내 신청 진행 내역'), myList));
    return;
  }

  // 본인 산출식 임금명세서 탭
  const p = d.myPayslip;
  if (!p) {
    container.appendChild(h('div', { className: 'card-block' }, '표시할 임금명세서가 없습니다.'));
    return;
  }
  container.appendChild(
    h(
      'div',
      { className: 'card-block form-stack' },
      h('h2', { className: 'card-title' }, `${p.empCode} ${p.displayName} 산출식 임금명세서`),
      h('div', { className: 'kv-row' }, h('span', {}, '지급총액'), h('strong', { className: 'num-mono' }, fmtWon(p.grossPay))),
      h('div', { className: 'kv-row' }, h('span', {}, '연장·야간·휴일수당'), h('strong', { className: 'num-mono' }, fmtWon(p.overtimeNightHolidayPay))),
      h('div', { className: 'kv-row' }, h('span', {}, '4대보험·소득세 공제'), h('strong', { className: 'num-mono' }, fmtWon(p.socialInsuranceTotal + p.incomeTaxTotal))),
      h('div', { className: 'kv-row' }, h('span', {}, '실수령액'), h('strong', { className: 'num-mono' }, fmtWon(p.netPay))),
      h(
        'button',
        {
          type: 'button',
          className: 'm-btn m-btn-accent',
          onClick: (e) => {
            openModal(
              `${p.displayName} 산출식 임금명세서 (근기법 제48조)`,
              '통상시급 및 수당·공제 세부 계산 방법',
              p.formulaLines.join('\n'),
              e.currentTarget
            );
          },
        },
        '임금 구성항목·계산식 전문 보기'
      )
    )
  );
}

/* ==========================================================================
   공통 컴포넌트 빌더 (패스키 등록 / 2단계 결재함 / 출퇴근 명부 / 실시간 알림)
   ========================================================================== */
function buildPasskeyRegistrationCard() {
  const loginId = mobileState.session?.loginId || '';
  const localEntry = mobileState.passkeysByLoginId[loginId];
  const isReady = Boolean(mobileState.session?.passkeyEnabled && localEntry);
  const meta = getDemoAccountMeta(loginId);
  const defaultDemoPin = typeof meta?.demoPin === 'string' ? meta.demoPin : '';
  const pinInput = h('input', {
    id: 'pk-reg-pin',
    type: 'password',
    inputmode: 'numeric',
    maxlength: '6',
    placeholder: '현재 6자리 보안 PIN 재입력',
    value: defaultDemoPin,
  });

  return h(
    'div',
    { className: 'card-block form-stack' },
    h(
      'div',
      { className: 'm-item-top' },
      h('h2', { className: 'card-title' }, '단말 패스키(ECDSA P-256 공개키) 2차 인증 등록'),
      h(
        'span',
        { className: `m-badge ${isReady ? 'm-badge-ok' : 'm-badge-info'}` },
        isReady ? `등록됨 (${localEntry.credentialId})` : '미등록'
      )
    ),
    h(
      'p',
      { className: 'm-item-desc' },
      '세션 탈취 시 공격자의 키 덮어쓰기를 막기 위해 현재 6자리 보안 PIN을 재확인한 뒤, WebCrypto 비추출(extractable: false) ECDSA P-256 공개키(SPKI)만 서버에 등록합니다.'
    ),
    h(
      'div',
      { className: 'm-field' },
      h('label', { for: 'pk-reg-pin' }, '본인 확인용 현재 6자리 보안 PIN'),
      pinInput
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'm-btn m-btn-accent',
        onClick: async (e) => {
          const btn = e.currentTarget;
          try {
            if (!window.crypto?.subtle) {
              throw new Error('현재 브라우저 환경에서 WebCrypto API를 사용할 수 없습니다.');
            }
            const currentPin = pinInput.value.trim();
            const keyPair = await window.crypto.subtle.generateKey(
              { name: 'ECDSA', namedCurve: 'P-256' },
              false,
              ['sign', 'verify']
            );
            const spkiBuf = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
            const publicKeySpkiBase64 = arrayBufferToBase64(spkiBuf);
            const res = await mobilePost(
              '/api/mobile/passkey/register',
              { currentPin, publicKeySpkiBase64 },
              btn
            );
            mobileState.passkeysByLoginId[loginId] = {
              credentialId: res.credentialId,
              privateKey: keyPair.privateKey,
            };
            mobileState.session = res.session;
            mobileState.dashboard = res.dashboard;
            renderAuthenticatedContent();
            showToast(`PIN 재확인 통과 — 단말 ECDSA P-256 패스키(${res.credentialId}) 등록 완료!`);
          } catch (err) {
            showToast(err.message, true);
          }
        },
      },
      isReady ? 'PIN 확인 후 ECDSA P-256 보안키 재발급·갱신' : 'PIN 확인 후 현재 브라우저 패스키 등록'
    )
  );
}

function buildApprovalsCard(approvals, callerRole = 'CEO') {
  const list = h('div', { className: 'm-list' });
  if (!approvals || approvals.length === 0) {
    list.appendChild(h('p', { className: 'm-item-desc' }, '결재 요청 내역이 없습니다.'));
  }
  for (const item of approvals || []) {
    const isPending = item.status.startsWith('PENDING');
    const canActOnStage =
      isPending && (item.status !== 'PENDING_CEO' || callerRole === 'CEO');
    const badgeCls =
      item.status === 'APPROVED'
        ? 'm-badge-ok'
        : item.status === 'REJECTED'
          ? 'm-badge-crit'
          : 'm-badge-warn';

    const card = h(
      'article',
      { className: 'm-item' },
      h(
        'div',
        { className: 'm-item-top' },
        h('span', { className: 'm-badge m-badge-info' }, `${item.deptName} · ${item.requesterName}`),
        h('span', { className: `m-badge ${badgeCls}` }, item.status)
      ),
      h('div', { className: 'm-item-title' }, item.title),
      h('p', { className: 'm-item-desc' }, item.detailSummary)
    );

    if (canActOnStage) {
      const approveLabel =
        item.status === 'PENDING_DEPT' && callerRole !== 'CEO'
          ? '1차 승인 → 대표 상신'
          : '대표 최종 승인';
      card.appendChild(
        h(
          'div',
          { className: 'm-btn-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'm-btn m-btn-primary m-btn-sm',
              onClick: async (e) => {
                try {
                  const res = await mobilePost(
                    '/api/mobile/decide-approval',
                    { requestId: item.requestId, decision: 'APPROVE' },
                    e.currentTarget
                  );
                  mobileState.dashboard = res.dashboard;
                  renderAuthenticatedContent();
                  showToast(
                    res.decided.status === 'PENDING_CEO'
                      ? '1차 승인 완료 — 대표이사 최종 결재함으로 상신되었습니다.'
                      : '대표 최종 승인 완료 — 근태·급여·법정과제에 즉시 반영되었습니다.'
                  );
                } catch (err) {
                  showToast(err.message, true);
                }
              },
            },
            approveLabel
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'm-btn m-btn-danger m-btn-sm',
              onClick: async (e) => {
                try {
                  const res = await mobilePost(
                    '/api/mobile/decide-approval',
                    { requestId: item.requestId, decision: 'REJECT' },
                    e.currentTarget
                  );
                  mobileState.dashboard = res.dashboard;
                  renderAuthenticatedContent();
                  showToast('결재 반려 처리가 완료되었습니다.');
                } catch (err) {
                  showToast(err.message, true);
                }
              },
            },
            '반려'
          )
        )
      );
    } else if (item.status === 'PENDING_CEO') {
      card.appendChild(
        h(
          'p',
          { className: 'm-item-desc' },
          `1차 검토 완료(${item.deptApprovedBy || '부서/인사'}) — 대표이사(CEO) 최종 승인 대기 중`
        )
      );
    } else if (item.decidedBy) {
      card.appendChild(
        h('p', { className: 'm-item-desc' }, `처리자: ${item.decidedBy} (${item.decidedAt || ''})`)
      );
    }
    list.appendChild(card);
  }

  return h(
    'div',
    { className: 'card-block' },
    h('h2', { className: 'card-title' }, '모바일 실시간 전자결재함 (2단계 권한 검증)'),
    h('p', { className: 'card-sub' }, '부서 1차 승인 후 대표 최종 승인 시 연차·연장수당·주52h 경보·법정과제가 자동 갱신됩니다.'),
    list
  );
}

function buildAttendanceRosterCard(workersAttendance, payrollLines) {
  const list = h('div', { className: 'm-list' });
  if (!workersAttendance || workersAttendance.length === 0) {
    list.appendChild(h('p', { className: 'm-item-desc' }, '현재 등록된 근로자 출퇴근 명부가 없습니다.'));
  }
  for (const w of workersAttendance || []) {
    const over52 = w.maxWeeklyWorkedHours > 52;
    const payMatch = (payrollLines || []).find((p) => p.empCode === w.empCode);
    const row = h(
      'div',
      { className: 'm-item' },
      h(
        'div',
        { className: 'm-item-top' },
        h('span', { className: 'm-item-title' }, `${w.empCode} ${w.displayName}`),
        h(
          'span',
          { className: `m-badge ${over52 ? 'm-badge-crit' : w.attendanceState === 'WORKING' ? 'm-badge-ok' : 'm-badge-info'}` },
          over52 ? `주 ${w.maxWeeklyWorkedHours}h 초과!` : w.attendanceState === 'WORKING' ? `근무 중 (${w.lastClockInAt || '09:00'})` : '퇴근/비번'
        )
      ),
      h(
        'p',
        { className: 'm-item-desc' },
        `${w.deptName} · 주 최대 ${w.maxWeeklyWorkedHours}h · 전자계약 ${w.contractSigned ? '완료' : '미서명'}`
      )
    );
    if (payMatch) {
      row.appendChild(
        h(
          'div',
          { className: 'm-btn-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'm-btn m-btn-secondary m-btn-sm',
              onClick: (e) => {
                openModal(
                  `${payMatch.empCode} ${payMatch.displayName} 급여 검증 명세`,
                  `실지급액 ${fmtWon(payMatch.netPay)}`,
                  payMatch.formulaLines.join('\n'),
                  e.currentTarget
                );
              },
            },
            `실수령 ${fmtWon(payMatch.netPay)} · 산출식`
          )
        )
      );
    }
    list.appendChild(row);
  }
  return h(
    'div',
    { className: 'card-block' },
    h('h2', { className: 'card-title' }, '실시간 출퇴근 · 주 52시간 현황'),
    list
  );
}

function buildNotificationsCard(notifications) {
  const list = h('div', { className: 'm-list' });
  if (!notifications || notifications.length === 0) {
    list.appendChild(h('p', { className: 'm-item-desc' }, '수신된 실시간 알림 이력이 없습니다.'));
  }
  for (const n of notifications || []) {
    const cls =
      n.severity === 'CRITICAL'
        ? 'm-badge-crit'
        : n.severity === 'WARN'
          ? 'm-badge-warn'
          : 'm-badge-info';
    list.appendChild(
      h(
        'div',
        { className: 'm-item' },
        h(
          'div',
          { className: 'm-item-top' },
          h('span', { className: `m-badge ${cls}` }, n.severity),
          h('span', { className: 'm-item-desc num-mono' }, n.createdAt)
        ),
        h('div', { className: 'm-item-title' }, n.title),
        h('p', { className: 'm-item-desc' }, n.bodySummary)
      )
    );
  }
  return h('div', { className: 'card-block' }, h('h2', { className: 'card-title' }, '실시간 푸시 알림 이력'), list);
}

/* ==========================================================================
   초기화 및 이벤트 바인딩
   ========================================================================== */
async function initMobileApp() {
  // PWA Service Worker 등록 (정적 셸 전용, /api/* 캐시 제외)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 테마 토글
  document.getElementById('m-theme-btn').addEventListener('click', (e) => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    e.currentTarget.textContent = next === 'dark' ? '밝은 화면' : '어두운 화면';
  });

  document.getElementById('m-toast-close').addEventListener('click', () => {
    document.getElementById('m-toast').hidden = true;
  });
  document.getElementById('m-push-close').addEventListener('click', () => {
    document.getElementById('m-push-banner').hidden = true;
  });
  document.getElementById('m-modal-close').addEventListener('click', closeModal);
  document.getElementById('m-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // 1차 로그인 제출
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-submit-btn');
    try {
      const { session } = await mobilePost(
        '/api/mobile/login',
        {
          loginId: document.getElementById('login-id').value,
          password: document.getElementById('login-pw').value,
          deviceLabel: document.getElementById('login-device').value,
          platformType: document.getElementById('login-platform').value,
        },
        btn,
        true
      );
      mobileState.session = session;
      mobileState.activeTab = 'home';
      if (session.authStage === 'AUTHENTICATED') {
        const { dashboard } = await mobileGet('/api/mobile/dashboard');
        mobileState.dashboard = dashboard;
        connectSse();
        showToast(`${session.displayName} 로그인 완료`);
      } else {
        showToast('1차 인증 통과 — 대표·관리자 2차 인증을 진행해 주세요.');
      }
      renderAppShell();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // 보안 PIN 키패드 조작
  document.querySelectorAll('.pin-key').forEach((keyBtn) => {
    keyBtn.addEventListener('click', () => {
      const inp = document.getElementById('mfa-pin-input');
      if (keyBtn.dataset.digit !== undefined) {
        if (inp.value.length < 6) inp.value += keyBtn.dataset.digit;
      } else if (keyBtn.dataset.action === 'clear') {
        inp.value = '';
      } else if (keyBtn.dataset.action === 'back') {
        inp.value = inp.value.slice(0, -1);
      }
    });
  });

  // 2차 인증 — 6자리 보안 PIN 검증
  document.getElementById('mfa-pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('mfa-pin-submit');
    try {
      const pin = document.getElementById('mfa-pin-input').value.trim();
      const { session } = await mobilePost(
        '/api/mobile/mfa/verify',
        { method: 'PIN', pin },
        btn
      );
      mobileState.session = session;
      const { dashboard } = await mobileGet('/api/mobile/dashboard');
      mobileState.dashboard = dashboard;
      connectSse();
      renderAppShell();
      showToast('2차 보안 PIN 인증 완료 — 실시간 스트림이 연결되었습니다.');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // 2차 인증 — 패스키(일회용 서버 챌린지 발급 후 WebCrypto ECDSA P-256 실제 전자서명 검증)
  document.getElementById('btn-passkey-auth').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      const loginId = mobileState.session?.loginId || '';
      const keyEntry = mobileState.passkeysByLoginId[loginId];
      if (!keyEntry) {
        throw new Error('이 단말에 등록된 패스키 개인키가 없습니다. 6자리 PIN으로 로그인해 주세요.');
      }
      const { challenge } = await mobilePost('/api/mobile/mfa/challenge', {}, btn);
      const clientDataJSON = JSON.stringify({
        type: 'mhr.passkey.get',
        challenge: challenge.nonce,
        origin: window.location.origin,
      });
      const sigBuf = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyEntry.privateKey,
        new TextEncoder().encode(clientDataJSON)
      );
      const signatureBase64 = arrayBufferToBase64(sigBuf);

      const { session } = await mobilePost(
        '/api/mobile/mfa/verify',
        {
          method: 'PASSKEY',
          challengeId: challenge.challengeId,
          credentialId: keyEntry.credentialId,
          clientDataJSON,
          signatureBase64,
        },
        btn
      );
      mobileState.session = session;
      const { dashboard } = await mobileGet('/api/mobile/dashboard');
      mobileState.dashboard = dashboard;
      connectSse();
      renderAppShell();
      showToast('ECDSA P-256 패스키 전자서명 검증 완료 — 실시간 관제 모드가 시작되었습니다.');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // 로그아웃
  document.getElementById('m-logout-btn').addEventListener('click', async (e) => {
    try {
      await mobilePost('/api/mobile/logout', {}, e.currentTarget);
    } catch {
      // ignore
    }
    disconnectSse();
    mobileState.session = null;
    mobileState.dashboard = null;
    renderAppShell();
    showToast('안전하게 로그아웃되었습니다.');
  });

  // 초기 부트스트랩 조회
  try {
    const boot = await mobileGet('/api/mobile/bootstrap');
    mobileState.loginCsrfToken = boot.loginCsrfToken;
    mobileState.demoAccounts = boot.demoAccounts || [];
    mobileState.session = boot.session || null;
    applySelectedAccountToForm(mobileState.selectedDemoId);
    if (mobileState.session && mobileState.session.authStage === 'AUTHENTICATED') {
      const { dashboard } = await mobileGet('/api/mobile/dashboard');
      mobileState.dashboard = dashboard;
      connectSse();
    }
    renderAppShell();
  } catch (err) {
    showToast(err.message, true);
  }
}

initMobileApp();
