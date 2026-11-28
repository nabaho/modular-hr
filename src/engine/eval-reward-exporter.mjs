/**
 * 고객사 맞춤 평가·보상 독립 실행 웹 패키지 추출기
 * - 컨설턴트가 modular-hr에서 조립한 모듈, 가인지 직무역량 문항·KPI·연봉/호봉테이블·보상룰만 뽑아
 *   고객사 담당자(관리자)·평가자(팀장/동료)·직원(피평가자) 3역할이 브라우저에서 바로 실행할 수 있는
 *   단일 독립 HTML 웹 애플리케이션 및 설정 프리셋(JSON)을 생성한다.
 * - 브라우저 번들(build:pages) 호환을 위해 node:* import 없이 순수 ESM으로 작성한다.
 */

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeSafeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function sanitizeFileSlug(name) {
  const cleaned = String(name || 'client')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return cleaned || 'client';
}

export function buildStandaloneClientPackage({ studioView, company, evalBoard }) {
  const profile = studioView?.clientProfile || {};
  const clientName = String(profile.clientName || company?.companyName || '고객사').trim();
  const enabledCodes = Array.isArray(studioView?.enabledModules) ? studioView.enabledModules : [];
  const enabledSet = new Set(enabledCodes);

  const activeModules = (studioView?.catalog?.modules || []).filter((m) => enabledSet.has(m.code));

  const payload = {
    packageVersion: '1.0.0',
    generatedAt: '2026-11-28',
    clientProfile: {
      clientName,
      industry: profile.industry || '',
      sizeBand: profile.sizeBand || '100인미만',
      hasUnion: Boolean(profile.hasUnion),
      cultureType: profile.cultureType || 'AGILE',
      evalCycle: profile.evalCycle || 'QUARTERLY_OKR_ANNUAL_REWARD',
      fiscalYear: profile.fiscalYear || 2026,
      consultantNote: profile.consultantNote || '',
      activePresetId: profile.activePresetId || '',
    },
    enabledModules: enabledCodes,
    activeModuleDetails: activeModules,
    params: studioView?.params || {},
    selectedCompetencyIds: studioView?.selectedCompetencyIds || [],
    selectedCompetencyItems: studioView?.selectedCompetencyItems || [],
    selectedKpiIds: studioView?.selectedKpiIds || [],
    selectedKpiItems: studioView?.selectedKpiItems || [],
    selectedSalaryTableId: studioView?.selectedSalaryTableId || '',
    selectedSalaryTable: studioView?.selectedSalaryTable || null,
    salaryGrades: studioView?.catalog?.salaryGrades || [],
    hobongConfig: enabledSet.has('PAY-STEP') ? (studioView?.hobongConfig || []) : [],
    hobongTable: enabledSet.has('PAY-STEP') ? (studioView?.hobongTable || []) : [],
    compScales: studioView?.catalog?.compScales || [],
    competencySummary: studioView?.competencySummary || { items: [], strengths: [], weaknesses: [], selfFeedbackNeeded: [] },
    okrKit: enabledSet.has('EVAL-OKR') || enabledSet.has('PROC-CONT') ? studioView?.catalog?.okrKit : null,
    okrObjectives: enabledSet.has('EVAL-OKR') || enabledSet.has('PROC-CONT') ? (studioView?.okrObjectives || []) : [],
    peerKit: enabledSet.has('PROC-360') ? studioView?.catalog?.peerKit : null,
    peerReviews: enabledSet.has('PROC-360') ? (studioView?.peerReviews || []) : [],
    legalGuardrails: studioView?.legalGuardrails || { alerts: [] },
    workers: (evalBoard || []).map((r) => ({
      empCode: r.empCode,
      displayName: r.displayName,
      deptName: r.deptName,
      evalEligible: Boolean(r.evalEligible),
      currentBasePay: r.currentBasePay ?? 0,
      kpiScore: r.kpiScore ?? 0,
      competencyScore: r.competencyScore ?? 0,
      grade: r.grade || 'B',
      recommendedRaisePct: r.evalEligible ? (r.recommendedRaisePct ?? 0) : 0,
      recommendedBonus: r.evalEligible ? (r.recommendedBonus ?? 0) : 0,
    })),
  };

  const configPreset = {
    presetFormat: 'modular-hr-eval-reward-v1',
    clientProfile: payload.clientProfile,
    enabledModules: payload.enabledModules,
    params: payload.params,
    selectedCompetencyIds: payload.selectedCompetencyIds,
    selectedKpiIds: payload.selectedKpiIds,
    selectedSalaryTableId: payload.selectedSalaryTableId,
    hobongConfig: payload.hobongConfig.length ? payload.hobongConfig : studioView?.hobongConfig || [],
  };

  const embeddedJson = serializeSafeJsonForScript(payload);

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(clientName)} — 맞춤형 평가·보상 운영 시스템</title>
  <style>
    :root { --bg: #f8fafc; --surface: #ffffff; --border: #cbd5e1; --text: #0f172a; --muted: #475569; --primary: #1d4ed8; --primary-bg: #eff6ff; --green: #15803d; --green-bg: #dcfce7; --amber: #92400e; --amber-bg: #fef3c7; --red: #b91c1c; --red-bg: #fee2e2; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Pretendard", "Malgun Gothic", sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 20px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; }
    h1 { margin: 0; font-size: 18px; }
    .sub { color: var(--muted); font-size: 13px; }
    .role-bar, .nav-bar { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn.active, .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
    main { max-width: 1200px; margin: 18px auto; padding: 0 16px 40px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 14px; overflow-x: auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600; background: var(--primary-bg); color: var(--primary); margin: 2px; }
    .pill.high { background: var(--red-bg); color: var(--red); }
    .pill.mid { background: var(--amber-bg); color: var(--amber); }
    .pill.ok { background: var(--green-bg); color: var(--green); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th, td { border: 1px solid var(--border); padding: 7px 9px; text-align: left; }
    th { background: #f1f5f9; }
    td.num, th.num { text-align: right; }
    input, select, textarea { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 13px; }
    @media print { header .role-bar, .no-print { display: none !important; } body { background: #fff; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1 id="pkg-title"></h1>
      <div id="pkg-subtitle" class="sub"></div>
    </div>
    <div class="role-bar" id="role-bar"></div>
    <div class="nav-bar" id="nav-bar"></div>
  </header>
  <main id="app-root"></main>
  <script id="pkg-data" type="application/json">${embeddedJson}</script>
  <script>
    (function () {
      const DATA = JSON.parse(document.getElementById('pkg-data').textContent);
      const ENABLED = new Set(DATA.enabledModules || []);
      const state = {
        role: 'HR_ADMIN',
        tab: 'overview',
        workers: DATA.workers || [],
        compItems: (DATA.competencySummary && DATA.competencySummary.items) || [],
        okrs: DATA.okrObjectives || [],
        peers: DATA.peerReviews || [],
      };
      function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        if (attrs) {
          for (const [k, v] of Object.entries(attrs)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'className') node.className = String(v);
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
            else node.setAttribute(k, String(v));
          }
        }
        for (const ch of children.flat()) {
          if (ch === null || ch === undefined || ch === false) continue;
          node.appendChild(typeof ch === 'string' || typeof ch === 'number' ? document.createTextNode(String(ch)) : ch);
        }
        return node;
      }
      function won(n) { return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원'; }
      function getVisibleTabs() {
        const tabs = [{ key: 'overview', label: '도입 제도 · 법령 점검' }];
        if (ENABLED.has('EVAL-KPI') || ENABLED.has('EVAL-OKR') || ENABLED.has('EVAL-MBO') || ENABLED.has('EVAL-BSC') || ENABLED.has('EVAL-MERIT') || ENABLED.has('EVAL-PROJ')) {
          tabs.push({ key: 'perf', label: '성과(KPI·OKR) 평가' });
        }
        if (ENABLED.has('COMP-JOB') || ENABLED.has('COMP-CORE') || ENABLED.has('COMP-BARS') || ENABLED.has('COMP-SKILL')) {
          tabs.push({ key: 'comp', label: '직무·역량 평가' });
        }
        if (ENABLED.has('PROC-360')) {
          tabs.push({ key: 'peer', label: '360° 다면 피드백' });
        }
        if (ENABLED.has('PAY-STEP') || DATA.selectedSalaryTable) {
          tabs.push({ key: 'paytable', label: '임금·호봉 테이블' });
        }
        if (state.role !== 'EMPLOYEE' || ENABLED.has('PAY-ANNUAL') || ENABLED.has('REW-PSPI')) {
          tabs.push({ key: 'reward', label: state.role === 'EMPLOYEE' ? '내 평가·보상 결과' : '등급 · 보상 시뮬레이션' });
        }
        return tabs;
      }
      function renderHeader() {
        document.getElementById('pkg-title').textContent = (DATA.clientProfile.clientName || '고객사') + ' — 맞춤형 평가·보상 운영 시스템';
        document.getElementById('pkg-subtitle').textContent =
          (DATA.clientProfile.industry || '') + ' · ' + (DATA.clientProfile.sizeBand || '') + ' · 탑재 모듈 ' + ENABLED.size + '개 (독립 실행 패키지)';
        const roleBar = document.getElementById('role-bar');
        const roles = [
          { k: 'HR_ADMIN', l: '회사 관리자' },
          { k: 'EVALUATOR', l: '평가자(팀장·동료)' },
          { k: 'EMPLOYEE', l: '직원(피평가자)' },
        ];
        roleBar.replaceChildren(...roles.map((r) =>
          el('button', { type: 'button', 'aria-pressed': String(state.role === r.k), className: 'btn' + (state.role === r.k ? ' active' : ''), onClick: () => { state.role = r.k; render(); } }, r.l)
        ));
        const tabs = getVisibleTabs();
        if (!tabs.some((t) => t.key === state.tab)) state.tab = tabs[0].key;
        const navBar = document.getElementById('nav-bar');
        navBar.replaceChildren(
          ...tabs.map((t) => el('button', { type: 'button', 'aria-pressed': String(state.tab === t.key), className: 'btn' + (state.tab === t.key ? ' active' : ''), onClick: () => { state.tab = t.key; render(); } }, t.label)),
          el('button', { type: 'button', className: 'btn no-print', onClick: () => window.print() }, '인쇄 / PDF'),
          el('button', { type: 'button', className: 'btn btn-primary no-print', onClick: exportCsv }, '보상결과 CSV')
        );
      }
      function csvSafeCell(val) {
        const s = String(val ?? '');
        const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
        return '"' + safe.replace(/"/g, '""') + '"';
      }
      function exportCsv() {
        const rows = [['사번', '성명', '부서', '대상여부', 'KPI점수', '역량점수', '등급', '기본급', '권고인상률(%)', '예상기본급', '성과급']];
        for (const w of state.workers) {
          if (!w.evalEligible) {
            rows.push([w.empCode, w.displayName, w.deptName, '비대상', '-', '-', '-', w.currentBasePay, 0, w.currentBasePay, 0]);
            continue;
          }
          const m = (DATA.params.meritMatrix && DATA.params.meritMatrix[w.grade]) || { raisePct: w.recommendedRaisePct ?? 0, defaultBonus: w.recommendedBonus ?? 0 };
          const next = Math.round((w.currentBasePay ?? 0) * (1 + (m.raisePct ?? 0) / 100));
          rows.push([w.empCode, w.displayName, w.deptName, '대상', w.kpiScore, w.competencyScore, w.grade, w.currentBasePay, m.raisePct, next, m.defaultBonus]);
        }
        const csv = '\\uFEFF' + rows.map((r) => r.map(csvSafeCell).join(',')).join('\\r\\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (DATA.clientProfile.clientName || 'eval') + '_평가보상결과.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      function renderOverview(root) {
        root.appendChild(el('div', { className: 'card' },
          el('h2', {}, '1. 고객사 맞춤형 탑재 모듈 (' + DATA.activeModuleDetails.length + '개)'),
          el('p', { className: 'sub' }, DATA.clientProfile.consultantNote || '컨설턴트가 선택한 모듈만 이 패키지에 포함되어 있습니다.'),
          el('div', {}, DATA.activeModuleDetails.map((m) => el('span', { className: 'pill', title: m.summary }, m.name + ' (' + m.code + ')')))
        ));
        root.appendChild(el('div', { className: 'card' },
          el('h2', {}, '2. 노동법 가드레일 자동 점검'),
          el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}, '수준'), el('th', {}, '근거 법령'), el('th', {}, '점검 사항'), el('th', {}, '권고 조치'))),
            el('tbody', {}, (DATA.legalGuardrails.alerts || []).map((a) =>
              el('tr', {},
                el('td', {}, el('span', { className: 'pill ' + (a.severity === 'HIGH' ? 'high' : a.severity === 'MEDIUM' ? 'mid' : 'ok') }, a.severity)),
                el('td', {}, a.lawRef),
                el('td', {}, a.title),
                el('td', {}, a.actionHint)
              )
            ))
          )
        ));
      }
      function renderPerf(root) {
        let rendered = false;
        if (DATA.selectedKpiItems && DATA.selectedKpiItems.length > 0) {
          rendered = true;
          root.appendChild(el('div', { className: 'card' },
            el('h2', {}, '편입된 직무별 KPI 지표 (' + DATA.selectedKpiItems.length + '개)'),
            el('table', {},
              el('thead', {}, el('tr', {}, el('th', {}, '직무'), el('th', {}, '지표명'), el('th', {}, '정의'), el('th', {}, '산출식'))),
              el('tbody', {}, DATA.selectedKpiItems.map((k) => el('tr', {}, el('td', {}, k.role), el('td', {}, k.name), el('td', {}, k.definition), el('td', {}, k.formula))))
            )
          ));
        }
        if (ENABLED.has('EVAL-OKR') || ENABLED.has('PROC-CONT')) {
          rendered = true;
          const objInput = el('input', { type: 'text', 'aria-label': '새 분기 Objective 입력', placeholder: '새 분기 Objective 입력' });
          const krInput = el('input', { type: 'text', 'aria-label': '핵심 결과(KR) 입력', placeholder: '핵심 결과(KR)' });
          root.appendChild(el('div', { className: 'card' },
            el('h2', {}, '가인지 OKR 실행 보드'),
            el('div', { className: 'role-bar no-print' }, objInput, krInput,
              el('button', { type: 'button', className: 'btn btn-primary', onClick: () => {
                if (!objInput.value.trim()) return;
                state.okrs.unshift({ deptName: '신규팀', objective: objInput.value.trim(), confidence: 7, krs: [{ title: krInput.value.trim() || '핵심 결과 100%', current: 30, target: 100, unit: '%' }] });
                render();
              } }, 'OKR 추가')
            ),
            el('table', {},
              el('thead', {}, el('tr', {}, el('th', {}, '부서'), el('th', {}, 'Objective'), el('th', {}, 'Key Results · 진척도'), el('th', {}, '자신감'))),
              el('tbody', {}, state.okrs.length === 0
                ? [el('tr', {}, el('td', { colspan: '4' }, '등록된 OKR 목표가 없습니다.'))]
                : state.okrs.map((o) =>
                  el('tr', {},
                    el('td', {}, o.deptName || '-'),
                    el('td', {}, o.objective),
                    el('td', {}, (o.krs || []).map((kr) => kr.title + ' (' + kr.current + '/' + kr.target + (kr.unit || '') + ')').join(' | ')),
                    el('td', {}, (o.confidence || 7) + ' / 10')
                  )
                ))
            )
          ));
        }
        if (!rendered) {
          root.appendChild(el('div', { className: 'card' }, el('p', { className: 'sub' }, '편입된 성과평가(KPI·OKR) 항목이 없습니다.')));
        }
      }
      function renderComp(root) {
        root.appendChild(el('div', { className: 'card' },
          el('h2', {}, '역량평가 5점 척도 및 자기평가 vs 리더평가'),
          el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}, '구분'), el('th', {}, '역량영역'), el('th', {}, '평가 질문'), el('th', {}, '자기(1~5)'), el('th', {}, '리더(1~5)'), el('th', {}, '갭(리더-자기)'))),
            el('tbody', {}, state.compItems.length === 0
              ? [el('tr', {}, el('td', { colspan: '6' }, '역량평가 문항이 없습니다.'))]
              : state.compItems.map((q) => {
                const canEditSelf = state.role === 'EMPLOYEE' || state.role === 'HR_ADMIN';
                const canEditLeader = state.role === 'EVALUATOR' || state.role === 'HR_ADMIN';
                return el('tr', {},
                  el('td', {}, q.group),
                  el('td', {}, q.domain),
                  el('td', {}, q.question),
                  el('td', {}, canEditSelf
                    ? el('select', { 'aria-label': q.domain + ' 자기평가 점수', onChange: (e) => { q.selfScore = Number(e.target.value); render(); } }, [1,2,3,4,5].map((n) => el('option', { value: n, selected: q.selfScore === n }, n)))
                    : String(q.selfScore ?? '-')),
                  el('td', {}, canEditLeader
                    ? el('select', { 'aria-label': q.domain + ' 리더평가 점수', onChange: (e) => { q.leaderScore = Number(e.target.value); render(); } }, [1,2,3,4,5].map((n) => el('option', { value: n, selected: q.leaderScore === n }, n)))
                    : String(q.leaderScore ?? '-')),
                  el('td', {}, String((q.leaderScore ?? 0) - (q.selfScore ?? 0)))
                );
              }))
          )
        ));
        if (DATA.selectedCompetencyItems && DATA.selectedCompetencyItems.length > 0) {
          root.appendChild(el('div', { className: 'card' },
            el('h2', {}, '가인지 직무역량 편입 문항 (' + DATA.selectedCompetencyItems.length + '개)'),
            el('table', {},
              el('thead', {}, el('tr', {}, el('th', {}, '직무'), el('th', {}, '역량 항목'), el('th', {}, '정의'), el('th', {}, '행동기반 평가기준'))),
              el('tbody', {}, DATA.selectedCompetencyItems.map((c) => el('tr', {}, el('td', {}, c.role), el('td', {}, c.title), el('td', {}, c.definition), el('td', {}, c.criteria))))
            )
          ));
        }
      }
      function renderPeer(root) {
        const keepIn = el('input', { type: 'text', 'aria-label': '강점(Keep) 입력', placeholder: '강점(Keep)' });
        const tryIn = el('input', { type: 'text', 'aria-label': '보완(Try) 입력', placeholder: '보완(Try)' });
        root.appendChild(el('div', { className: 'card' },
          el('h2', {}, '360° 다면 피드백'),
          el('div', { className: 'role-bar no-print' }, keepIn, tryIn,
            el('button', { type: 'button', className: 'btn btn-primary', onClick: () => {
              state.peers.unshift({ targetEmpCode: (state.workers[0] && state.workers[0].empCode) || 'EMP-201', reviewerRole: state.role, keepText: keepIn.value || '-', tryText: tryIn.value || '-', createdAt: '2026-11-28' });
              render();
            } }, '다면 피드백 저장')
          ),
          el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}, '대상 사번'), el('th', {}, '평가자 역할'), el('th', {}, '강점(Keep)'), el('th', {}, '보완(Try)'))),
            el('tbody', {}, state.peers.length === 0
              ? [el('tr', {}, el('td', { colspan: '4' }, '등록된 다면 피드백이 없습니다.'))]
              : state.peers.map((p) => el('tr', {}, el('td', {}, p.targetEmpCode), el('td', {}, p.reviewerRole), el('td', {}, p.keepText), el('td', {}, p.tryText))))
          )
        ));
      }
      function renderPaytable(root) {
        if (DATA.selectedSalaryTable) {
          const t = DATA.selectedSalaryTable;
          root.appendChild(el('div', { className: 'card' },
            el('h2', {}, '벤치마크 연봉테이블: ' + t.industry + ' · ' + t.subIndustry + ' (' + t.sizeBand + ')'),
            el('p', { className: 'sub' }, '지역 ' + t.region + ' · 매출 ' + t.revenue + ' · 평균연봉 ' + t.avgSalary + ' (단위: 만원)'),
            el('table', {},
              el('thead', {}, el('tr', {}, el('th', {}, '직무'), (DATA.salaryGrades || []).map((g) => el('th', { className: 'num' }, g)))),
              el('tbody', {}, (t.matrix || []).map((row) => el('tr', {}, el('td', {}, row.job), row.pay.map((v) => el('td', { className: 'num' }, v === null ? '-' : String(v))))))
            )
          ));
        }
        if (ENABLED.has('PAY-STEP') && DATA.hobongTable && DATA.hobongTable.length) {
          root.appendChild(el('div', { className: 'card' },
            el('h2', {}, '직급별 호봉제 급여테이블 (' + DATA.hobongTable.length + '호봉)'),
            el('table', {},
              el('thead', {}, el('tr', {}, el('th', {}, '호봉'), el('th', {}, '직급'), el('th', {}, '체류년차'), el('th', { className: 'num' }, '기준연봉(만원)'), el('th', { className: 'num' }, '인상률(%)'), el('th', {}, '비고'))),
              el('tbody', {}, DATA.hobongTable.map((r) => el('tr', {}, el('td', {}, r.step), el('td', {}, r.rank), el('td', {}, r.stayYear), el('td', { className: 'num' }, r.annualPayManwon.toLocaleString('ko-KR')), el('td', { className: 'num' }, r.raiseRatePct + '%'), el('td', {}, r.note || '-'))))
            )
          ));
        }
      }
      function maskPeerOrSelfWorkers(rawList) {
        if (state.role !== 'EMPLOYEE') return rawList;
        return rawList.slice(0, 1).map((w) => ({ ...w }));
      }
      function renderReward(root) {
        const list = maskPeerOrSelfWorkers(state.workers);
        root.appendChild(el('div', { className: 'card' },
          el('h2', {}, state.role === 'EMPLOYEE' ? '본인 평가·보상 통지 내역' : '전 직원 등급·인상·성과급 시뮬레이션'),
          state.role === 'HR_ADMIN' ? el('p', { className: 'sub' }, '주의: 이 패키지에는 전체 대상 직원의 급여·등급 데이터가 포함되어 있으므로 사내 인사담당자·평가자 배포 전용으로 관리해 주세요.') : null,
          el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}, '사번·이름'), el('th', {}, '부서'), el('th', { className: 'num' }, 'KPI / 역량'), el('th', {}, '등급'), el('th', { className: 'num' }, '현재 기본급'), el('th', { className: 'num' }, '예상 기본급'), el('th', { className: 'num' }, '성과급'))),
            el('tbody', {}, list.length === 0
              ? [el('tr', {}, el('td', { colspan: '7' }, '대상 직원이 없습니다.'))]
              : list.map((w) => {
                const m = (DATA.params.meritMatrix && DATA.params.meritMatrix[w.grade]) || { raisePct: w.recommendedRaisePct ?? 0, defaultBonus: w.recommendedBonus ?? 0 };
                const next = Math.round((w.currentBasePay ?? 0) * (1 + (m.raisePct ?? 0) / 100));
                return el('tr', {},
                  el('td', {}, w.empCode + ' ' + w.displayName),
                  el('td', {}, w.deptName),
                  el('td', { className: 'num' }, w.evalEligible ? (w.kpiScore + ' / ' + w.competencyScore) : '-'),
                  el('td', {}, !w.evalEligible ? '비대상' : (state.role === 'EMPLOYEE' ? w.grade + '등급' : el('select', { 'aria-label': w.displayName + ' 평가등급 선택', onChange: (e) => { w.grade = e.target.value; render(); } }, ['S','A','B','C','D'].map((g) => el('option', { value: g, selected: w.grade === g }, g + ' 등급'))))),
                  el('td', { className: 'num' }, won(w.currentBasePay)),
                  el('td', { className: 'num' }, w.evalEligible ? won(next) + ' (+' + m.raisePct + '%)' : '-'),
                  el('td', { className: 'num' }, w.evalEligible ? won(m.defaultBonus) : '-')
                );
              }))
          )
        ));
      }
      function render() {
        renderHeader();
        const root = document.getElementById('app-root');
        root.replaceChildren();
        if (state.tab === 'overview') renderOverview(root);
        else if (state.tab === 'perf') renderPerf(root);
        else if (state.tab === 'comp') renderComp(root);
        else if (state.tab === 'peer') renderPeer(root);
        else if (state.tab === 'paytable') renderPaytable(root);
        else renderReward(root);
      }
      render();
    })();
  </script>
</body>
</html>`;

  const slug = sanitizeFileSlug(clientName);
  const filename = `eval-reward-package_${slug}_${profile.fiscalYear || 2026}.html`;

  return {
    filename,
    presetFilename: `eval-reward-preset_${slug}_${profile.fiscalYear || 2026}.json`,
    html,
    configJson: JSON.stringify(configPreset, null, 2),
    summary: {
      clientName,
      enabledModulesCount: enabledCodes.length,
      selectedCompetencyCount: payload.selectedCompetencyItems.length,
      selectedKpiCount: payload.selectedKpiItems.length,
      includesHobong: enabledSet.has('PAY-STEP'),
      includesOkr: enabledSet.has('EVAL-OKR') || enabledSet.has('PROC-CONT'),
      includesPeer360: enabledSet.has('PROC-360'),
    },
  };
}
