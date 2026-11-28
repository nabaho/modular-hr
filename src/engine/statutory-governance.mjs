/**
 * 규모별 노동관계법령 전수 점검 체크리스트 · 노사협의회 전용 거버넌스(규정/운영/녹음회의록/위원서명취합)
 * 및 취업규칙 개정(개별 메일·알림톡 발송 / 열람확인 / 본인서명 / 과반수 동의서 자동취합 / 오프라인 인쇄양식) 엔진
 */

import crypto from 'node:crypto';

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function forbiddenError(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

function notFoundError(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function conflictError(message) {
  const err = new Error(message);
  err.statusCode = 409;
  return err;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function safeTimingEqualHex(hexA, hexB) {
  const a = String(hexA || '').trim().toLowerCase();
  const b = String(hexB || '').trim().toLowerCase();
  if (!a || a.length !== b.length || a.length % 2 !== 0) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

function maskPiiSafe(raw) {
  return String(raw ?? '')
    .replace(/\b(\d{6})-[1-8]\d{6}\b/g, '$1-*******')
    .replace(/\b(01[016789])-\d{3,4}-(\d{4})\b/g, '$1-****-$2')
    .trim();
}

function validateSignatureDataUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  if (s.length > 48_000) {
    throw badRequest(
      '자필 전자서명 이미지 용량이 허용 한도(48,000자 · 약 36KB, 전체 요청 64KiB 이내)를 초과했습니다.'
    );
  }
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) {
    throw badRequest('자필 전자서명 데이터는 올바른 PNG base64(data:image/png;base64,...) 형식이어야 합니다.');
  }
  return s;
}

function utcNowIso() {
  return new Date().toISOString();
}

function utcTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function maskPersonNameForHint(rawName) {
  const s = Array.from(String(rawName || '').trim());
  if (s.length === 0) return '***';
  if (s.length === 1) return '*';
  if (s.length === 2) return `${s[0]}*`;
  if (s.length <= 5) return `${s[0]}${'*'.repeat(s.length - 2)}${s[s.length - 1]}`;
  return `${s.slice(0, 2).join('')}***${s.slice(-2).join('')}`;
}

function generateSixDigitAuthCode() {
  // Rejection sampling over 32-bit random integer to avoid modulo bias and keep browser-crypto-shim compatibility
  const limit = 4_294_000_000;
  for (let i = 0; i < 16; i++) {
    const b = crypto.randomBytes(4);
    const val = ((b[0] << 24) >>> 0) + ((b[1] << 16) >>> 0) + ((b[2] << 8) >>> 0) + (b[3] >>> 0);
    if (val < limit) {
      return String(100_000 + (val % 900_000));
    }
  }
  const fb = crypto.randomBytes(3);
  return String(100_000 + ((((fb[0] << 16) | (fb[1] << 8) | fb[2]) >>> 0) % 900_000));
}

function validateExplicitWorkRuleDecision(changeType, rawDecision) {
  const d = typeof rawDecision === 'string' ? rawDecision.trim().toUpperCase() : '';
  if (changeType === 'ADVERSE_CONSENT') {
    if (d !== 'AGREE' && d !== 'DISAGREE') {
      throw badRequest(
        '불이익 변경 과반수 동의 절차에서는 명시적인 동의(AGREE) 또는 부동의(DISAGREE) 값을 선택해야 합니다.'
      );
    }
    return d;
  }
  if (d !== 'OPINION_SUBMITTED' && d !== 'AGREE' && d !== 'DISAGREE') {
    throw badRequest(
      '취업규칙 의견청취 절차에서는 명시적인 확인·의견(OPINION_SUBMITTED, AGREE, DISAGREE) 값을 선택해야 합니다.'
    );
  }
  return d;
}

function isValidIsoDateSimple(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function addYearsIso(isoDate, years) {
  if (!isValidIsoDateSimple(isoDate)) return '2029-11-15';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

/**
 * 대한민국 상시근로자 규모 구간별 필수 노동법·산업안전·모성보호·고용공시 전수 체크리스트 사전 (총 20개 핵심 법정의무)
 */
export const STATUTORY_SCALE_CHECKLIST_CATALOG = Object.freeze([
  // 1인 이상 전 사업장 공통
  {
    id: 'CHK_1_CONTRACT_PAYSLIP',
    tier: '1인 이상 (전 사업장 필수)',
    minWorkers: 1,
    title: '서면·전자 근로계약서 교부 및 계산방법 명시 임금명세서 매월 교부',
    lawBasis: '근로기준법 제17조 · 제48조 제2항 · 제42조(3년 보존)',
    penaltySummary: '미교부 500만 원 이하 벌금 / 명세서 기재누락·미교부 500만 원 이하 과태료',
    linkedTab: 'ops-recruit',
    actionLabel: '근로계약·서명 확인',
  },
  {
    id: 'CHK_1_MINWAGE_NOTICE',
    tier: '1인 이상 (전 사업장 필수)',
    minWorkers: 1,
    title: '최저임금액 등 주지 의무(사내 게시) 및 정기 급여일 체불 방지 가드레일',
    lawBasis: '최저임금법 제6조·제11조 · 근로기준법 제43조·제43조의2(상습체불 제재)',
    penaltySummary: '주지 의무 위반 100만 원 이하 과태료 / 재직자 지연이자(연 20%) 적용 주의',
    linkedTab: 'payroll',
    actionLabel: '급여대장 확인',
  },
  {
    id: 'CHK_1_RETIREMENT_EDU',
    tier: '1인 이상 (전 사업장 필수)',
    minWorkers: 1,
    title: '퇴직급여(퇴직연금 DB/DC) 설정 및 가입자 연 1회 의무교육 증빙 보관',
    lawBasis: '근로자퇴직급여 보장법 제4조 · 제32조 제2항',
    penaltySummary: '퇴직연금 가입자 교육 미실시 시 1,000만 원 이하 과태료',
    linkedTab: 'ops-statutory',
    actionLabel: '법정교육 확인',
  },
  {
    id: 'CHK_1_MANDATORY_EDU',
    tier: '1인 이상 (전 사업장 필수)',
    minWorkers: 1,
    title: '직장 내 성희롱 예방 · 장애인 인식개선 · 개인정보보호 연 1회 교육 및 서명부 보관',
    lawBasis: '남녀고용평등법 제13조 · 장애인고용법 제5조의2 · 개인정보보호법 제28조',
    penaltySummary: '미실시 시 각 300만~500만 원 이하 과태료 (10인/50인 미만 간이 게시 특례 구분)',
    linkedTab: 'ops-statutory',
    actionLabel: '법정교육 확인',
  },
  {
    id: 'CHK_1_MATERNITY_CARE',
    tier: '1인 이상 (전 사업장 필수)',
    minWorkers: 1,
    title: '출산전후휴가(90~100일)·배우자출산휴가(20일)·육아휴직(최대 1년6개월) 보장',
    lawBasis: '근로기준법 제74조 · 남녀고용평등법 제18조의2·제19조 (2025 개정 반영)',
    penaltySummary: '거부·불이익 처우 시 징역 또는 벌금 (전 사업장 규모 무관 강행규정)',
    linkedTab: 'ops-leave-promo',
    actionLabel: '육아·모성보호 확인',
  },

  // 5인 이상 사업장
  {
    id: 'CHK_5_OVERTIME_LEAVE_HOLIDAY',
    tier: '5인 이상 사업장 의무',
    minWorkers: 5,
    title: '주 52시간 상한 · 연장/야간/휴일 50%~100% 가산수당 · 관공서 유급공휴일 · 연차휴가',
    lawBasis: '근로기준법 제50·53·55·56·60·61조',
    penaltySummary: '가산수당 미지급·52h 위반 형사처벌 / 공휴일 휴일대체 시 근로자대표 서면합의 필수',
    linkedTab: 'ops-attendance',
    actionLabel: '근태·연차 확인',
  },
  {
    id: 'CHK_5_DISMISSAL_BULLYING',
    tier: '5인 이상 사업장 의무',
    minWorkers: 5,
    title: '정당한 해고사유·서면통지 의무 및 직장 내 괴롭힘 즉시 객관조사·피해자보호·비밀유지',
    lawBasis: '근로기준법 제23조·제27조 · 제76조의2·제76조의3',
    penaltySummary: '서면 미통지 당연 부당해고 / 괴롭힘 미조사·비밀누설 500만 원 이하 과태료',
    linkedTab: 'ops-discipline',
    actionLabel: '징계·고충 확인',
  },
  {
    id: 'CHK_5_SERIOUS_ACCIDENT',
    tier: '5인 이상 사업장 의무',
    minWorkers: 5,
    title: '중대재해처벌법 안전보건확보의무 (반기 1회 위험요인 점검 · 예산 · 종사자 의견청취)',
    lawBasis: '중대재해 처벌 등에 관한 법률 제4조 (상시 5인 이상 전면 시행)',
    penaltySummary: '안전보건관리체계 미구축 중대산업재해 발생 시 경영책임자 처벌 대상',
    linkedTab: 'ops-statutory',
    actionLabel: '안전·위험성평가',
  },
  {
    id: 'CHK_5_WORKER_REP_AGREEMENT',
    tier: '5인 이상 사업장 의무',
    minWorkers: 5,
    title: '탄력·선택근무 · 공휴일 휴일대체 · 보상휴가제 도입 시 근로자대표 서면합의서 비치',
    lawBasis: '근로기준법 제51조·제52조·제55조 제2항·제57조',
    penaltySummary: '근로자대표 서면합의 누락 시 제도 무효 및 연장·휴일수당 소급 지급 위험',
    linkedTab: 'forms-center',
    actionLabel: '표준 서식함 열기',
  },

  // 10인 이상 사업장 (취업규칙 작성·개정·동의 핵심!)
  {
    id: 'CHK_10_WORK_RULE',
    tier: '10인 이상 사업장 의무',
    minWorkers: 10,
    title: '취업규칙 작성·변경 노동청 신고 및 개정 시 근로자 개별 통지·과반수 동의서 취합',
    lawBasis: '근로기준법 제14조(주지의무) · 제93조(작성·신고) · 제94조(불이익 변경 시 과반수 동의)',
    penaltySummary: '미신고·의견청취 누락 500만 원 이하 과태료 / 과반수 동의 없는 불이익 변경 무효',
    linkedTab: 'work-rules',
    isWorkspaceTrigger: 'WORK_RULES',
    actionLabel: '취업규칙 개정·동의 창 열기',
  },

  // 30인 이상 사업장 (노사협의회 전용 대시보드 핵심!)
  {
    id: 'CHK_30_LMC',
    tier: '30인 이상 사업장 의무',
    minWorkers: 30,
    title: '노사협의회 설치(노사 동수 3~10인) · 15일 내 규정신고 · 분기 정기회의 · 회의록 3년 보관',
    lawBasis: '근로자참여 및 협력증진에 관한 법률 제4조·제12조·제17조·제21조',
    penaltySummary: '설치 거부·방해 또는 정기회의 미개최 시 벌금 / 규정 미신고·회의록 미비치 과태료',
    linkedTab: 'lmc-dashboard',
    isWorkspaceTrigger: 'LMC',
    actionLabel: '노사협의회 전용 대시보드 열기',
  },
  {
    id: 'CHK_30_GRIEVANCE_FAIR_HIRE',
    tier: '30인 이상 사업장 의무',
    minWorkers: 30,
    title: '고충처리위원 선임(10일 내 결과통보) 및 공정채용법(출신지·혼인 요구금지·서류반환)',
    lawBasis: '근참법 제26~28조 · 채용절차의 공정화에 관한 법률 제4조의3·제11조',
    penaltySummary: '고충처리위원 미비치 200만 원 벌금 / 직무무관 개인정보 요구 500만 원 이하 과태료',
    linkedTab: 'ops-recruit',
    actionLabel: '공정채용·고충 확인',
  },

  // 50인 이상 사업장
  {
    id: 'CHK_50_OSH_DISABILITY',
    tier: '50인 이상 사업장 의무',
    minWorkers: 50,
    title: '안전·보건관리책임자/관리자 선임(14일 내 보고) · 산안위(업종별) · 장애인 의무고용(3.1%)',
    lawBasis: '산업안전보건법 제15~19조·제24조 · 장애인고용촉진법 제28조',
    penaltySummary: '안전·보건관리자 미선임 500만 원 이하 과태료 / 장애인 고용계획·실적 보고 의무',
    linkedTab: 'ops-statutory',
    actionLabel: '안전선임·장애인고용',
  },

  // 100인 이상 사업장
  {
    id: 'CHK_100_LEVY_OSH_REG',
    tier: '100인 이상 사업장 의무',
    minWorkers: 100,
    title: '장애인고용부담금 신고·납부(매년 1.31) 및 업종별 안전보건관리규정 제정·심의',
    lawBasis: '장애인고용법 제33조 · 산업안전보건법 제25조·제26조',
    penaltySummary: '미달 인원당 부담금 부과 및 기한 경과 시 가산금·연체금 발생',
    linkedTab: 'compliance',
    actionLabel: '신고 일정 확인',
  },

  // 300인 이상 (500인 · 1,000인 대기업 확장 안내 포함)
  {
    id: 'CHK_300_DISCLOSURE_DAYCARE',
    tier: '300인 이상 (500·1000인+ 포함)',
    minWorkers: 300,
    title: '고용형태 공시제(4.30) · 전담 안전/보건관리자 · 직장어린이집(여300/상시500+) · AA · 재취업지원(1000+)',
    lawBasis: '고용정책기본법 제15조의6 · 영유아보육법 제14조 · 남녀고용평등법 제17조의3 · 고령자고용법 제21조의3',
    penaltySummary: '어린이집 미이행 시 이행강제금(연 2회 각 1억 한도) / AA 미달 명단공표 주의',
    linkedTab: 'compliance',
    actionLabel: '대규모 법정의무 보기',
  },
]);

/**
 * 음성 녹음 원문(STT 텍스트)을 분석하여 근참법 제21조 양식의 법정 노사협의회 회의록으로 자동 구조화
 */
export function parseAudioTranscriptToMinutes({
  companyName = '사업장',
  title = '',
  meetingCategory = '운영위원회',
  meetingDate = '2026-11-24',
  location = '본사 대회의실',
  audioFileName = '실시간_음성녹음.webm',
  durationSec = 0,
  rawTranscript = '',
  attendees = [],
}) {
  const cleanText = maskPiiSafe(rawTranscript);
  const rawLines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const reportItems = [];
  const discussionItems = [];
  const resolutionItems = [];
  const actionItems = [];
  const speakerSummaryLines = [];

  for (const line of rawLines) {
    // 화자 분리 예: "[사용자위원 박본부장] ..." 또는 "근로자대표 김하늘: ..."
    let speaker = '참석위원';
    let content = line;
    const bracketMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
    const colonMatch = !bracketMatch ? line.match(/^([^:：]{2,20})[:：]\s*(.+)$/) : null;
    if (bracketMatch) {
      speaker = bracketMatch[1].trim();
      content = bracketMatch[2].trim();
    } else if (colonMatch) {
      speaker = colonMatch[1].trim();
      content = colonMatch[2].trim();
    }

    speakerSummaryLines.push(`- [${speaker}] ${content}`);

    if (/의결|합의|확정|승인|가결|만장일치|시행하기로|지급하기로|설치하기로/.test(content)) {
      resolutionItems.push(`${content} (발언·제안: ${speaker})`);
      if (/까지|이내|부서|담당|시행|설치|교체|반영/.test(content)) {
        actionItems.push(content);
      }
    } else if (/보고|실적|현황|매출|인력계획|수주|집행현황|경과/.test(content)) {
      reportItems.push(`${content} (${speaker})`);
    } else if (/협의|논의|개선|건의|요청|검토|휴게|교대|안전|복지|교육|단축/.test(content)) {
      discussionItems.push(`${content} (${speaker})`);
    }
  }

  if (reportItems.length === 0) {
    reportItems.push('당분기 경영·생산 현황 및 직전 분기 의결사항 이행 경과 보고');
  }
  if (discussionItems.length === 0) {
    discussionItems.push(
      rawLines[0]
        ? `녹음 안건 협의: ${rawLines[0].slice(0, 120)}`
        : '작업환경 개선 및 근로자 고충·복리후생 증진 방안 협의'
    );
  }
  if (resolutionItems.length === 0) {
    resolutionItems.push(
      '상정된 협의 안건에 대하여 노사 쌍방 이견 없이 추진 일정을 수립하여 차기 회의 시 이행 결과를 점검하기로 의결함'
    );
  }
  if (actionItems.length === 0) {
    actionItems.push('인사노무팀 간사: 의결사항 사내 공지 및 부서별 후속 조치 일정 안내');
  }

  const employerNames = attendees
    .filter((m) => m.side === 'EMPLOYER')
    .map((m) => `${m.name}(${m.deptRole})`)
    .join(', ');
  const workerNames = attendees
    .filter((m) => m.side === 'WORKER')
    .map((m) => `${m.name}(${m.deptRole})`)
    .join(', ');

  const mins = Math.floor(Math.max(0, Number(durationSec) || 0) / 60);
  const secs = Math.round(Math.max(0, Number(durationSec) || 0) % 60);
  const durationLabel = durationSec > 0 ? `${mins}분 ${secs}초` : '음성 텍스트 변환본';

  const resolvedTitle =
    String(title || '').trim() ||
    `${meetingDate.slice(0, 4)}년 ${companyName} 노사협의회(${meetingCategory}) 회의록`;

  const minutesBody = [
    '========================================================================',
    `[법정 서식] ${resolvedTitle}`,
    '(근로자참여 및 협력증진에 관한 법률 제12조·제21조 · 작성일로부터 3년 보존)',
    '========================================================================',
    `1. 회의 구분 : ${meetingCategory}`,
    `2. 개최 일시 : ${meetingDate} 14:00 ~ 15:30`,
    `3. 개최 장소 : ${location}`,
    `4. 음성 녹음 원본 : ${audioFileName} (녹음 길이: ${durationLabel} · 자동 회의록 구조화 변환)`,
    `5. 출석 위원 현황 (총 ${attendees.length}명)`,
    `   - 사용자위원 (${attendees.filter((m) => m.side === 'EMPLOYER').length}명) : ${employerNames || '대표이사 외 사용자위원'}`,
    `   - 근로자위원 (${attendees.filter((m) => m.side === 'WORKER').length}명) : ${workerNames || '근로자대표 외 근로자위원'}`,
    '',
    '------------------------------------------------------------------------',
    '6. 보고사항 (근참법 제22조)',
    ...reportItems.map((it, idx) => `   ${idx + 1}) ${it}`),
    '',
    '7. 협의사항 (근참법 제20조)',
    ...discussionItems.map((it, idx) => `   ${idx + 1}) ${it}`),
    '',
    '8. 의결사항 (근참법 제21조 · 출석위원 2/3 이상 찬성 의결)',
    ...resolutionItems.map((it, idx) => `   ${idx + 1}) ${it}`),
    '',
    '9. 후속 조치 및 이행 점검 과제',
    ...actionItems.map((it, idx) => `   - ${it}`),
    '',
    '------------------------------------------------------------------------',
    '[부록: 회의 녹음 자동 음성인식(STT) 발언 요약 기록]',
    ...(speakerSummaryLines.length > 0
      ? speakerSummaryLines.map((l) => `   ${l}`)
      : ['   - (녹음 요약 본문 없음)']),
    '========================================================================',
  ].join('\n');

  return {
    title: resolvedTitle,
    reportItems,
    discussionItems,
    resolutionItems,
    actionItems,
    speakerSummaryLines,
    minutesBody,
    minutesBodySha256: sha256Hex(minutesBody),
  };
}

export const SAMPLE_RECORDING_TRANSCRIPTS = Object.freeze({
  LMC_OPS_COMMITTEE: {
    label: '샘플 1 · 운영위원회 야간교대 휴게실·안전장비 개선 녹음본',
    meetingCategory: '운영위원회',
    location: '본사 2층 노사협의회실',
    audioFileName: '2026-11-24_노사협의회_운영위원회_녹음.webm',
    durationSec: 1840,
    transcript: [
      '[의장 대표이사] 2026년 제4차 노사협의회 운영위원회 회의를 개회하겠습니다. 먼저 4분기 생산 수주 실적과 인력 충원 현황을 인사팀에서 보고하겠습니다.',
      '[사용자위원 인사노무팀장] 4분기 신규 정밀가공 수주 물량이 전분기 대비 14% 증가하여 생산기술팀 정규직 2명 채용 절차를 진행 중임을 보고드립니다.',
      '[근로자위원 제1공장대표] 현장 건의사항 협의 요청드립니다. 동절기 야간 2교대 근무자 휴게실 난방기 노후화와 CNC 공정 국소배기 필터 교체가 시급합니다.',
      '[근로자위원 품질파트위원] 추가로 육아기 근로시간 단축 신청 시 대체업무 분담 수당 기준과 직무 안전교육 시간을 주간 근무시간 내에 편성해 주실 것을 협의 요청합니다.',
      '[사용자위원 생산본부장] 휴게실 냉난방기 교체 예산 850만 원과 오일미스트 고효율 필터 즉시 교체를 전액 반영하겠습니다.',
      '[의장 대표이사] 노사 위원 전원 찬성으로 12월 10일까지 야간 휴게실 난방설비 및 집진필터 교체를 완료하고, 안전보건교육 6시간을 유급 주간시간에 편성하기로 만장일치 의결합니다.',
    ].join('\n'),
  },
  LMC_Q4_REGULAR: {
    label: '샘플 2 · 4분기 정기 노사협의회 복지·교육훈련 의결 녹음본',
    meetingCategory: '정기회의',
    location: '본사 대회의실',
    audioFileName: '2026-11-28_4분기_정기노사협의회_녹음.webm',
    durationSec: 2720,
    transcript: [
      '[의장 대표이사] 2026년 4분기 정기 노사협의회를 시작합니다. 연간 경영실적 전망 및 2027년도 인력운용 계획을 보고합니다.',
      '[사용자위원 인사노무팀장] 금년도 매출 목표 103% 달성 예상이며 고충처리위원 접수 안건 2건 모두 10일 법정기한 내 조치 완료되었음을 보고드립니다.',
      '[근로자위원 지원파트위원] 2027년도 직무역량 교육훈련 기본계획 수립 시 AI 품질검사 과정 신설과 건강검진 유급휴가 반일 부여 안건을 협의 요청합니다.',
      '[의장 대표이사] 출석 위원 전원 합의로 2027년 직무교육훈련 기본계획 승인 및 종합건강검진 당일 유급 공가(0.5일) 부여 안건을 만장일치 가결 확정합니다.',
    ].join('\n'),
  },
});

function buildLmcRegulationBody({
  companyName,
  bizRegNo,
  ceoName,
  enactedDate,
  version,
  committeeCountEachSide,
  regularMeetingCycle,
  quorumRule,
  grievanceHandlingDays,
  hasMajorityUnion,
  customAddendum,
}) {
  return [
    '========================================================================',
    `${companyName} 노사협의회 규정 (제${version}판 · 자동 보관본)`,
    '근거: 근로자참여 및 협력증진에 관한 법률 제4조 · 제17조 (제정·변경일로부터 15일 이내 신고)',
    '========================================================================',
    `사업장명 : ${companyName} (사업자등록번호: ${bizRegNo || '-'}) | 대표자 : ${ceoName || '대표이사'}`,
    `시행일자 : ${enactedDate} | 법정보존 : 영구 비치 (회의록 3년 보존)`,
    '',
    '제1장 총칙',
    `제1조(목적) 본 규정은 『근로자참여 및 협력증진에 관한 법률』(이하 "법"이라 한다)에 따라 ${companyName}에 설치하는 노사협의회(이하 "협의회")의 조직과 운영에 관한 사항을 규정함을 목적으로 한다.`,
    '제2조(신의성실의 의무) 근로자와 사용자는 상호 신의를 바탕으로 성실하게 협의에 임하여야 한다.',
    '',
    '제2장 협의회의 구성',
    `제3조(구성 및 위원 수) 협의회는 근로자와 사용자를 대표하는 동수의 위원으로 구성하되, 근로자위원 ${committeeCountEachSide}인, 사용자위원 ${committeeCountEachSide}인(총 ${committeeCountEachSide * 2}인)으로 구성한다.`,
    `제4조(근로자위원 선출) ${
      hasMajorityUnion
        ? '근로자 과반수로 조직된 노동조합이 있으므로 노동조합의 대표자와 그 노동조합이 위촉하는 자로 한다(법 제6조 제2항).'
        : '근로자 과반수로 조직된 노동조합이 없으므로 전 근로자의 직접·비밀·무기명 투표에 의하여 선출한다(법 제6조 제2항, 시행령 제3조).'
    }`,
    '제5조(위원의 임기 및 신분보장) ① 위원의 임기는 3년으로 하되 연임할 수 있다. ② 위원은 비상임·무보수로 하며, 협의회 출석 시간 및 이와 직접 관련된 시간은 근로한 것으로 본다(법 제9조).',
    '',
    '제3장 협의회의 운영 및 회의록 자동 보관',
    `제6조(회의 개최) ① 정기회의는 ${regularMeetingCycle} 개최한다(법 제12조). ② 필요시 임시회의 및 실무 운영위원회를 개최할 수 있다.`,
    '제7조(회의 소집) 의장은 회의 개최 7일 전에 회의 일시, 장소, 의제 등을 각 위원에게 통보하여야 한다.',
    `제8조(정족수) 회의는 ${quorumRule}으로 의결한다(법 제15조).`,
    '제9조(회의록 작성·전자서명 및 3년 보존) ① 협의회는 개최 일시·장소, 출석 위원, 협의 내용 및 의결 사항을 기록한 회의록을 작성하고 출석 위원이 서명(전자서명 포함) 또는 날인한다. ② 음성 녹음 변환 회의록과 위원별 서명 취합 결과보고서는 작성일로부터 3년간 자동 보존한다(법 제21조).',
    '',
    '제4장 협의 · 의결 · 보고 사항',
    '제10조(협의사항) 생산성 향상, 근로자 복지증진, 안전·보건 개선, 인사·노무제도 개선, 근로시간 및 휴게, 모성보호 등 법 제20조 각 호 사항을 협의한다.',
    '제11조(의결사항) ① 근로자의 교육훈련 및 능력개발 기본계획 수립 ② 복지시설의 설치와 관리 ③ 사내근로복지기금의 설치 ④ 고충처리위원회에서 의결되지 아니한 사항 ⑤ 각종 노사공동위원회의 설치 사항은 협의회의 의결을 거쳐야 한다(법 제21조).',
    '제12조(보고사항) 사용자는 정기회의에 경영계획 전반 및 실적, 분기별 생산계획, 인력계획, 기업의 경제적·재정적 상황을 성실히 보고·설명하여야 한다(법 제22조).',
    '',
    '제5장 고충처리위원회',
    `제13조(고충처리위원 및 통보 기한) 노사를 대표하는 3인 이내의 고충처리위원을 두며, 근로자로부터 고충사항을 청취한 때에는 접수일로부터 ${grievanceHandlingDays}일 이내에 조치 사항과 처리 결과를 당해 근로자에게 통보하고 대장을 비치한다(법 제26조~제28조).`,
    customAddendum ? `\n제6장 사업장 특칙\n제14조(보칙) ${customAddendum}` : '',
    '',
    `부칙 : 본 규정은 ${enactedDate}부터 시행하며, 제정(변경)일로부터 15일 이내에 관할 지방고용노동관서의 장에게 신고한다.`,
    '========================================================================',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function buildCompiledLmcReportBody(company, minutesItem) {
  const empMembers = minutesItem.signatures.filter((s) => s.side === 'EMPLOYER');
  const wrkMembers = minutesItem.signatures.filter((s) => s.side === 'WORKER');
  const empSigned = empMembers.filter((s) => s.signed).length;
  const wrkSigned = wrkMembers.filter((s) => s.signed).length;
  const totalSigned = empSigned + wrkSigned;
  const totalCount = minutesItem.signatures.length;
  const allSigned = totalCount > 0 && totalSigned === totalCount;

  const formatSigLine = (s, idx) => {
    const statusStr = s.signed
      ? `서명완료 ✓ (${s.signedAt} · ${s.signMethod === 'OFFLINE_PRINT' ? '서면자필 날인' : '개별 전자서명'} · 검증코드 ${s.signatureCode})`
      : s.dispatchedAt
        ? `서명대기 (메일발송 ${s.dispatchedAt})`
        : '발송전';
    return `   ${idx + 1}. [${s.side === 'EMPLOYER' ? '사용자위원' : '근로자위원'}] ${s.name} (${s.deptRole} · ${s.email}) → ${statusStr}`;
  };

  return [
    '========================================================================',
    `[노사협의회 서명 자동 취합 결과보고서] ${minutesItem.title}`,
    '========================================================================',
    `사업장명 : ${company.companyName} (${company.bizRegNo || '-'})`,
    `회의일자 : ${minutesItem.meetingDate} (${minutesItem.meetingCategory}) | 장소 : ${minutesItem.location}`,
    `법정보존 : ${minutesItem.meetingDate} ~ ${minutesItem.retentionUntil} (근참법 제21조 3년 의무보존)`,
    `취합상태 : ${
      allSigned
        ? `전원 서명 취합 완료 (${totalSigned}/${totalCount}명 — 사용자위원 ${empSigned}/${empMembers.length} · 근로자위원 ${wrkSigned}/${wrkMembers.length})`
        : `위원 서명 취합 진행중 (${totalSigned}/${totalCount}명 완료 — 사용자위원 ${empSigned}/${empMembers.length} · 근로자위원 ${wrkSigned}/${wrkMembers.length})`
    }`,
    `원본해시 : SHA-256 ${minutesItem.minutesBodySha256.slice(0, 24)}...`,
    '',
    '------------------------------------------------------------------------',
    '[1] 사용자위원 및 근로자위원 개별 확인 · 서명 취합 명세',
    ...minutesItem.signatures.map((s, idx) => formatSigLine(s, idx)),
    '',
    '------------------------------------------------------------------------',
    '[2] 확정 회의록 전문 (녹음 자동 구조화 및 위원 확인 본문)',
    minutesItem.minutesBody,
    '',
    allSigned
      ? `[최종 판정] 출석 노사위원 전원(${totalCount}명)의 서명이 취합 완료되어 근참법 제21조에 따른 법정 회의록 효력 및 3년 전자보관 편철이 확정되었습니다.`
      : `[진행 안내] 미서명 위원(${totalCount - totalSigned}명)의 메일/링크 서명 또는 인쇄본 서면서명 등록 시 최종 보고서가 자동 확정됩니다.`,
    '========================================================================',
  ].join('\n');
}

function buildWorkRuleAmendmentCanonicalText(amendment) {
  const clauseText = (amendment.clauses || [])
    .map(
      (c, idx) =>
        `[${idx + 1}] ${c.articleTitle}\n - 변경 전(현행): ${c.beforeText}\n - 변경 후(개정): ${c.afterText}`
    )
    .join('\n\n');
  return [
    `개정안 제목: ${amendment.title}`,
    `시행 예정일: ${amendment.effectiveDate}`,
    `절차 구분: ${
      amendment.changeType === 'ADVERSE_CONSENT'
        ? '근로기준법 제94조 제1항 단서 (불이익 변경 — 근로자 과반수 동의 필수)'
        : '근로기준법 제94조 제1항 본문 (통상·유리 변경 — 근로자 과반수 의견청취)'
    }`,
    `개정 사유: ${amendment.reason}`,
    '',
    '[신·구조문 대비표]',
    clauseText,
  ].join('\n');
}

function buildWorkRuleAggregatedConsentDoc(company, amendmentView) {
  const {
    title,
    effectiveDate,
    changeType,
    reason,
    clauses,
    stats,
    workerStatuses,
    amendmentBodySha256,
  } = amendmentView;
  const isAdverse = changeType === 'ADVERSE_CONSENT';

  const workerLines =
    workerStatuses.length === 0
      ? ['   * 적용 대상 상시·단시간 근로자 명부가 없습니다.']
      : workerStatuses.map((w) => {
          const dispatchPart = w.dispatchedAt ? `${w.channelLabel}(${w.dispatchedAt})` : '미발송';
          const readPart = w.readConfirmedAt ? `열람확인(${w.readConfirmedAt})` : '미열람';
          const signPart = w.signed
            ? `${
                w.decision === 'AGREE'
                  ? '동의 서명 ✓'
                  : w.decision === 'DISAGREE'
                    ? '부동의 서명'
                    : '의견제출 서명 ✓'
              } (${w.signedAt} · 성명:${w.signerName} · ${
                w.signMethod === 'OFFLINE_PRINT' ? '인쇄본 자필서명' : '전자서명'
              } ${w.signatureCode})`
            : '미서명';
          const opinionSuffix = w.opinionText ? ` [의견: ${w.opinionText}]` : '';
          return `   No.${w.rowNo} [${w.empCode}] ${w.displayName} (${w.deptName}) | 발송:${dispatchPart} | ${readPart} | ${signPart}${opinionSuffix}`;
        });

  return [
    '========================================================================',
    isAdverse
      ? `[자동 취합 동의서] ${company.companyName} 취업규칙 불이익 변경 근로자 과반수 동의서 (연명부)`
      : `[자동 취합 의견청취서] ${company.companyName} 취업규칙 변경 근로자 과반수 의견청취 및 확인 연명부`,
    '근거: 근로기준법 제93조 · 제94조 제1항 (관할 지방고용노동관서 변경신고 첨부 증빙)',
    '========================================================================',
    `1. 사업장명 : ${company.companyName} (사업자등록번호: ${company.bizRegNo || '-'})`,
    `2. 개정건명 : ${title}`,
    `3. 시행일자 : ${effectiveDate} | 개정사유 : ${reason}`,
    `4. 대비표 무결성 해시 : SHA-256 ${amendmentBodySha256.slice(0, 24)}...`,
    `5. 서명 취합 및 법정 과반수 판정 현황`,
    `   - 적용 대상 근로자 총원 : ${stats.eligibleWorkerCount}명 (과반수 기준: ${stats.majorityRequiredCount}명 이상)`,
    `   - 개별 발송(메일·알림톡) : ${stats.dispatchedCount}명 | 개정내용 열람확인 : ${stats.readConfirmedCount}명`,
    `   - 본인 서명 제출 완료   : ${stats.signedCount}명 (찬성 동의 ${stats.agreedCount}명 · 부동의 ${stats.disagreedCount}명 · 의견제출 ${stats.opinionCount}명)`,
    `   - 찬성 동의율 / 판정    : ${stats.agreedRatePct}% → ${
      stats.procedureSatisfied
        ? isAdverse
          ? '★ 근로자 과반수 동의 달성 완료 (근로기준법 제94조 제1항 단서 적법 충족)'
          : '★ 근로자 과반수 의견청취 확인 완료 (근로기준법 제94조 제1항 본문 적법 충족)'
        : isAdverse
          ? `과반수 동의 미달 (추가 찬성 서명 ${Math.max(0, stats.majorityRequiredCount - stats.agreedCount)}명 필요)`
          : `과반수 의견청취 진행중 (추가 확인·서명 ${Math.max(0, stats.majorityRequiredCount - stats.signedCount)}명 필요)`
    }`,
    '',
    '------------------------------------------------------------------------',
    '[신 · 구조문 대비표 요약]',
    ...clauses.map(
      (c, idx) =>
        `  (${idx + 1}) ${c.articleTitle}\n      · 현행 : ${c.beforeText}\n      · 개정 : ${c.afterText}`
    ),
    '',
    '------------------------------------------------------------------------',
    '[근로자 개별 열람확인 및 본인 서명 자동 취합 연명부]',
    ...workerLines,
    '',
    '위와 같이 개정 취업규칙의 신·구조문 대비표 및 개정 취지를 개별 통지받아 충분히 숙지·확인하고,',
    '근로자 본인의 자유로운 의사에 기하여 서명(전자서명 또는 자필서명)하였음을 확인합니다.',
    '========================================================================',
  ].join('\n');
}

function buildWorkRuleLaborOfficeFilingBody(company, amendmentView, lsaRegularCount) {
  return [
    '========================================================================',
    '[별지 제15호 서식] 취업규칙 변경신고서 (관할 지방고용노동청 제출 초안)',
    '========================================================================',
    `사업장명 : ${company.companyName} | 사업자등록번호 : ${company.bizRegNo || '-'}`,
    `대표자명 : ${company.ceoName || '대표이사'} | 상시근로자 수 : ${lsaRegularCount}명`,
    `변경건명 : ${amendmentView.title}`,
    `시행예정일 : ${amendmentView.effectiveDate}`,
    `의견청취 / 동의 방식 : ${
      company.hasMajorityUnion
        ? '근로자 과반수로 조직된 노동조합 의견청취/동의'
        : amendmentView.changeType === 'ADVERSE_CONSENT'
          ? `근로자 과반수 동의 (${amendmentView.stats.eligibleWorkerCount}명 중 ${amendmentView.stats.agreedCount}명 동의 서명 취합 완료 · 동의율 ${amendmentView.stats.agreedRatePct}%)`
          : `근로자 과반수 의견청취 (${amendmentView.stats.eligibleWorkerCount}명 중 ${amendmentView.stats.signedCount}명 확인·서명 취합 완료)`
    }`,
    '',
    '[첨부 서류 체크]',
    ' 1. 변경된 취업규칙 전문 1부',
    ' 2. 신·구조문 대비표 1부',
    ` 3. ${
      amendmentView.changeType === 'ADVERSE_CONSENT'
        ? '근로자 과반수 동의서 및 개별 서명 취합 연명부 1부'
        : '근로자 과반수 의견청취서 및 확인 연명부 1부'
    }`,
    '========================================================================',
  ].join('\n');
}

export function createStatutoryGovernanceManager() {
  let regVersionSeq = 1;
  let memberSeq = 10;
  let minutesSeq = 2;
  let amendmentSeq = 3;

  // 환경 설정 내 인원수별 법정의무 수동 체크 및 전용 대시보드 활성화 오버라이드
  const scaleCheckMap = new Map([
    ['CHK_1_CONTRACT_PAYSLIP', true],
    ['CHK_5_OVERTIME_LEAVE_HOLIDAY', true],
  ]);
  // null 이면 사업장 상시근로자(30인+ / 10인+)에 따라 자동 연동, boolean 지정 시 사용자 명시 선택 반영
  let lmcWorkspaceManualOverride = null;
  let workRulesWorkspaceManualOverride = null;

  // 1) 노사협의회 규정 보관함 (초기 제1판 자동 생성)
  const lmcRegulationsArchive = [
    {
      regId: 'LMC-REG-1',
      version: 1,
      enactedDate: '2026-03-02',
      filedWithin15Days: true,
      filedDate: '2026-03-12',
      committeeCountEachSide: 3,
      regularMeetingCycle: '매 분기(3개월마다) 1회 정기',
      quorumRule: '근로자위원과 사용자위원 각 과반수의 출석으로 개의하고 출석위원 3분의 2 이상의 찬성',
      grievanceHandlingDays: 10,
      customAddendum: '실무 안건 사전 조율을 위하여 운영위원회를 둘 수 있으며, 회의 녹음본은 자동 회의록으로 변환 후 노사위원 서명을 취합하여 3년간 전자 보존한다.',
    },
  ];

  // 2) 노사협의회 위원 명단 (사용자위원 3명 · 근로자위원 3명 동수)
  let lmcCommitteeMembers = [
    {
      memberId: 'LMC-M01',
      side: 'EMPLOYER',
      empCode: '',
      name: '박정훈',
      deptRole: '대표이사 (사용자측 의장)',
      email: 'ceo@modular-hr.local',
      phoneMasked: '010-****-1001',
      electedMethod: '사용자 대표 당연직 위촉',
      termStart: '2026-03-02',
      termEnd: '2029-03-01',
      isGrievanceCommissioner: false,
    },
    {
      memberId: 'LMC-M02',
      side: 'EMPLOYER',
      empCode: '',
      name: '최성민',
      deptRole: '생산기술본부장',
      email: 'factory.head@modular-hr.local',
      phoneMasked: '010-****-1002',
      electedMethod: '대표이사 위촉',
      termStart: '2026-03-02',
      termEnd: '2029-03-01',
      isGrievanceCommissioner: true,
    },
    {
      memberId: 'LMC-M03',
      side: 'EMPLOYER',
      empCode: '',
      name: '정유진',
      deptRole: '인사노무팀장 (사용자측 간사)',
      email: 'hr.lead@modular-hr.local',
      phoneMasked: '010-****-1003',
      electedMethod: '대표이사 위촉',
      termStart: '2026-03-02',
      termEnd: '2029-03-01',
      isGrievanceCommissioner: false,
    },
    {
      memberId: 'LMC-M04',
      side: 'WORKER',
      empCode: 'EMP-201',
      name: '김하늘',
      deptRole: '생산기술1팀 · 근로자대표',
      email: 'haneul.kim@modular-hr.local',
      phoneMasked: '010-****-2011',
      electedMethod: '직접·비밀·무기명 투표 선출',
      termStart: '2026-03-02',
      termEnd: '2029-03-01',
      isGrievanceCommissioner: true,
    },
    {
      memberId: 'LMC-M05',
      side: 'WORKER',
      empCode: 'EMP-202',
      name: '이바다',
      deptRole: '품질보증팀 · 근로자위원(간사)',
      email: 'bada.lee@modular-hr.local',
      phoneMasked: '010-****-2022',
      electedMethod: '직접·비밀·무기명 투표 선출',
      termStart: '2026-03-02',
      termEnd: '2029-03-01',
      isGrievanceCommissioner: false,
    },
    {
      memberId: 'LMC-M06',
      side: 'WORKER',
      empCode: 'EMP-204',
      name: '박산들',
      deptRole: '고객지원파트 · 근로자위원',
      email: 'sandeul.park@modular-hr.local',
      phoneMasked: '010-****-2044',
      electedMethod: '직접·비밀·무기명 투표 선출',
      termStart: '2026-03-02',
      termEnd: '2029-03-01',
      isGrievanceCommissioner: true,
    },
  ];

  // 3) 노사협의회 회의록(녹음 자동변환 + 위원별 서명 취합) 보관함
  const seedMinutesParsed = parseAudioTranscriptToMinutes({
    companyName: '(주)대한정밀기계공업',
    title: '2026년 제3분기 정기 노사협의회 회의록 (전원 서명완료 보관본)',
    meetingCategory: '정기회의',
    meetingDate: '2026-09-25',
    location: '본사 3층 대회의실',
    audioFileName: '2026-09-25_3분기_정기노사협의회_녹음.webm',
    durationSec: 2460,
    rawTranscript: [
      '[의장 박정훈] 2026년 3분기 정기 노사협의회를 개회합니다. 3분기 생산 목표 달성률 101% 및 하반기 안전예산 집행 현황을 보고합니다.',
      '[근로자위원 김하늘] 추석 명절 전후 정밀가공라인 연장근로 집중 완화와 중량물 취급 공정 안전화 지급 주기 단축을 협의 요청합니다.',
      '[사용자위원 최성민] 안전화 지급 주기를 연 1회에서 반기 1회(연 2회)로 단축하고 대체휴일 근무 시 사전 희망자 우선 배정 원칙에 동의합니다.',
      '[의장 박정훈] 노사 위원 전원 찬성으로 현장 안전보호구 연 2회 지급 확대 및 명절 전후 주 48시간 이내 근로시간 관리 지침을 만장일치 의결합니다.',
    ].join('\n'),
    attendees: lmcCommitteeMembers,
  });

  const seedMinutes2Parsed = parseAudioTranscriptToMinutes({
    companyName: '(주)대한정밀기계공업',
    title: '2026년 제4차 노사협의회 운영위원회 회의록 (녹음 변환 · 위원 서명 취합중)',
    meetingCategory: '운영위원회',
    meetingDate: '2026-11-24',
    location: '본사 2층 노사협의회실',
    audioFileName: SAMPLE_RECORDING_TRANSCRIPTS.LMC_OPS_COMMITTEE.audioFileName,
    durationSec: SAMPLE_RECORDING_TRANSCRIPTS.LMC_OPS_COMMITTEE.durationSec,
    rawTranscript: SAMPLE_RECORDING_TRANSCRIPTS.LMC_OPS_COMMITTEE.transcript,
    attendees: lmcCommitteeMembers,
  });

  let lmcMinutesArchive = [
    {
      minutesId: 'LMC-MIN-02',
      meetingCategory: '운영위원회',
      meetingDate: '2026-11-24',
      retentionUntil: '2029-11-24',
      location: '본사 2층 노사협의회실',
      audioFileName: SAMPLE_RECORDING_TRANSCRIPTS.LMC_OPS_COMMITTEE.audioFileName,
      durationSec: SAMPLE_RECORDING_TRANSCRIPTS.LMC_OPS_COMMITTEE.durationSec,
      rawTranscript: SAMPLE_RECORDING_TRANSCRIPTS.LMC_OPS_COMMITTEE.transcript,
      ...seedMinutes2Parsed,
      signatures: lmcCommitteeMembers.map((m, idx) => ({
        memberId: m.memberId,
        side: m.side,
        empCode: m.empCode || '',
        name: m.name,
        deptRole: m.deptRole,
        email: m.email,
        dispatchedAt: '2026-11-24',
        dispatchChannel: 'EMAIL',
        tokenSha256: '',
        tokenExpiresAt: null,
        readConfirmedAt: idx < 2 || idx === 3 ? '2026-11-24' : null,
        signed: idx === 0 || idx === 3,
        signedAt: idx === 0 || idx === 3 ? '2026-11-24' : null,
        signerName: idx === 0 || idx === 3 ? m.name : '',
        signMethod: idx === 0 || idx === 3 ? 'ELECTRONIC_PORTAL' : null,
        signatureCode: idx === 0 ? 'SIG-LMC-901A2B' : idx === 3 ? 'SIG-LMC-904D8E' : '',
        signatureDataUrl: '',
      })),
    },
    {
      minutesId: 'LMC-MIN-01',
      meetingCategory: '정기회의',
      meetingDate: '2026-09-25',
      retentionUntil: '2029-09-25',
      location: '본사 3층 대회의실',
      audioFileName: '2026-09-25_3분기_정기노사협의회_녹음.webm',
      durationSec: 2460,
      rawTranscript: '',
      ...seedMinutesParsed,
      signatures: lmcCommitteeMembers.map((m, idx) => ({
        memberId: m.memberId,
        side: m.side,
        empCode: m.empCode || '',
        name: m.name,
        deptRole: m.deptRole,
        email: m.email,
        dispatchedAt: '2026-09-25',
        dispatchChannel: 'EMAIL',
        tokenSha256: '',
        tokenExpiresAt: null,
        readConfirmedAt: '2026-09-26',
        signed: true,
        signedAt: '2026-09-26',
        signerName: m.name,
        signMethod: 'ELECTRONIC_PORTAL',
        signatureCode: `SIG-LMC-Q30${idx + 1}`,
        signatureDataUrl: '',
      })),
    },
  ];

  // 4) 취업규칙 개정안 및 근로자별 발송·열람확인·서명 취합 레코드
  // responsesMap: `${amendmentId}:${empCode}` -> { dispatchedAt, channel, tokenSha256, tokenExpiresAt, readConfirmedAt, signed, signedAt, decision, opinionText, signerName, signMethod, signatureCode, signatureDataUrl, signedBodySha256 }
  let workRuleAmendments = [
    {
      amendmentId: 'WR-2026-01',
      title: '2026년 제1차 취업규칙 개정안 (교대근무 휴게·성과수당 산정기준 정비 및 육아기 단축근무 확대)',
      createdAt: '2026-11-20',
      effectiveDate: '2026-12-01',
      changeType: 'ADVERSE_CONSENT', // 불이익 변경 요소 포함 -> 근로자 과반수 동의 필수 (근기법 제94조①단서)
      reason: '교대제 근무시간표 개편 및 수당 산정기준 명확화(불이익 변경 요소 포함으로 근로자 과반수 동의 절차 진행)와 2025~2026 개정 모성보호법 반영',
      clauses: [
        {
          articleTitle: '제18조 (교대근무 시업·종업 시각 및 휴게시간)',
          beforeText: '생산 2교대 근무자의 주간조는 08:30~17:30, 야간조는 20:30~05:30으로 운영한다.',
          afterText: '생산 2교대 근무자의 주간조는 08:00~17:00, 야간조는 20:00~05:00으로 조정하며 야간 연속근로 중간에 유급 안전휴게 20분을 추가 부여한다.',
        },
        {
          articleTitle: '제34조 (직무성과수당 지급 기준)',
          beforeText: '분기 평가 B등급 이상 전원에게 정액 200,000원을 균등 지급한다.',
          afterText: '분기 평가 S등급 400,000원, A등급 250,000원, B등급 150,000원으로 차등 지급 기준을 세분화한다 (B등급 구간 조정에 따라 근로자 과반수 동의 대상).',
        },
        {
          articleTitle: '제52조 (육아휴직 · 배우자출산휴가 및 직장 내 괴롭힘 조사)',
          beforeText: '육아휴직은 최대 1년, 배우자 출산휴가는 유급 10일로 한다.',
          afterText: '부모 맞돌봄 시 육아휴직 최대 1년 6개월, 배우자 출산휴가 유급 20일(분할 3회)로 확대하고 직장 내 괴롭힘 신고 접수 즉시 객관적 조사 및 비밀유지 의무를 명문화한다.',
        },
      ],
    },
    {
      amendmentId: 'WR-2026-02',
      title: '2026년 제2차 취업규칙 개정안 (종합건강검진 유급공가 신설 및 자기계발 교육비 지원 확대)',
      createdAt: '2026-11-22',
      effectiveDate: '2027-01-01',
      changeType: 'NORMAL_OPINION', // 유리·통상 변경 -> 근로자 과반수 의견청취 (근기법 제94조①본문)
      reason: '4분기 노사협의회 의결사항 반영에 따른 유급 건강검진 공가 신설 (근로조건 유리 변경 — 과반수 의견청취)',
      clauses: [
        {
          articleTitle: '제45조의2 (건강검진 유급공가 신설)',
          beforeText: '국민건강보험법상 일반건강검진 시간만 공가로 인정한다.',
          afterText: '일반검진 외에 격년 종합건강검진 수검 시 당일 유급 반일공가(0.5일)를 추가 부여한다.',
        },
      ],
    },
  ];

  const workRuleResponsesMap = new Map();
  // 초기 시드: WR-2026-01 에 대해 전 직원 발송 + EMP-201(김하늘) 1명 서명 완료 상태로 시드하여 진행 현황을 즉시 확인 가능하게 구성
  const seedWr1Sha = sha256Hex(buildWorkRuleAmendmentCanonicalText(workRuleAmendments[0]));
  workRuleResponsesMap.set('WR-2026-01:EMP-201', {
    dispatchedAt: '2026-11-21',
    channel: 'EMAIL_AND_KAKAO',
    tokenSha256: '',
    tokenExpiresAt: null,
    readConfirmedAt: '2026-11-22',
    signed: true,
    signedAt: '2026-11-22',
    decision: 'AGREE',
    opinionText: '야간 안전휴게 20분 추가 반영 확인 후 동의합니다.',
    signerName: '김하늘',
    signMethod: 'ELECTRONIC_PORTAL',
    signatureCode: 'SIG-WR-201A9F',
    signatureDataUrl: '',
    signedBodySha256: seedWr1Sha,
  });
  workRuleResponsesMap.set('WR-2026-01:EMP-202', {
    dispatchedAt: '2026-11-21',
    channel: 'EMAIL_AND_KAKAO',
    tokenSha256: '',
    tokenExpiresAt: null,
    readConfirmedAt: '2026-11-23',
    signed: false,
    signedAt: null,
    decision: null,
    opinionText: '',
    signerName: '',
    signMethod: null,
    signatureCode: '',
    signatureDataUrl: '',
    signedBodySha256: '',
  });

  function mintRecipientToken() {
    const rawToken = crypto.randomBytes(16).toString('hex');
    const tokenSha256 = sha256Hex(rawToken);
    const authCode = generateSixDigitAuthCode();
    const authCodeSha256 = sha256Hex(authCode);
    const issuedAtMs = Date.now();
    const tokenExpiresAtMs = issuedAtMs + 14 * 86_400_000;
    const tokenExpiresAt = new Date(tokenExpiresAtMs).toISOString().slice(0, 10);
    return {
      rawToken,
      tokenSha256,
      authCode,
      authCodeSha256,
      issuedAtUtc: new Date(issuedAtMs).toISOString(),
      tokenExpiresAtMs,
      tokenExpiresAt,
    };
  }

  function isRecipientTokenExpired(record) {
    if (Number.isFinite(record?.tokenExpiresAtMs) && record.tokenExpiresAtMs > 0) {
      return Date.now() > record.tokenExpiresAtMs;
    }
    if (record?.tokenExpiresAt) {
      return utcTodayIso() > String(record.tokenExpiresAt);
    }
    return false;
  }

  function getEligibleWorkRuleWorkers(workers = []) {
    return workers.filter(
      (w) =>
        w.workerCategory === 'REGULAR' ||
        w.workerCategory === 'FIXED_TERM' ||
        w.workerCategory === 'PART_TIME' ||
        w.workerCategory === 'DAILY'
    );
  }

  function buildWorkerEmail(w) {
    const codeSlug = String(w.empCode || 'worker')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    return `${codeSlug}@modular-hr.local`;
  }

  function channelLabelOf(ch) {
    if (ch === 'EMAIL') return '이메일 발송';
    if (ch === 'KAKAO') return '카카오 알림톡 발송';
    return '이메일 + 알림톡 동시발송';
  }

  function buildAmendmentView(amendment, company, workers, getMaskedPhoneFn, lsaRegularCount = 0) {
    const canonicalBody = buildWorkRuleAmendmentCanonicalText(amendment);
    const amendmentBodySha256 = sha256Hex(canonicalBody);
    const eligibleWorkers = getEligibleWorkRuleWorkers(workers);

    const workerStatuses = eligibleWorkers.map((w, idx) => {
      const key = `${amendment.amendmentId}:${w.empCode}`;
      const rec = workRuleResponsesMap.get(key) || null;
      const isHashValid = rec && rec.signed && rec.signedBodySha256 === amendmentBodySha256;
      const signed = Boolean(isHashValid);
      return {
        rowNo: idx + 1,
        checked: Boolean(w.checked),
        starred: Boolean(w.starred),
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName || '일반부서',
        workerCategory: w.workerCategory,
        email: buildWorkerEmail(w),
        maskedPhone: typeof getMaskedPhoneFn === 'function' ? getMaskedPhoneFn(w.empCode) : '010-****-0000',
        dispatched: Boolean(rec?.dispatchedAt),
        dispatchedAt: rec?.dispatchedAt || null,
        channel: rec?.channel || null,
        channelLabel: rec?.dispatchedAt ? channelLabelOf(rec.channel) : '발송 대기',
        hasActiveToken: Boolean(rec?.tokenSha256),
        readConfirmed: Boolean(rec?.readConfirmedAt),
        readConfirmedAt: rec?.readConfirmedAt || null,
        signed,
        signedAt: signed ? rec.signedAt : null,
        decision: signed ? rec.decision : null,
        opinionText: signed ? rec.opinionText || '' : '',
        signerName: signed ? rec.signerName : '',
        signMethod: signed ? rec.signMethod : null,
        signatureCode: signed ? rec.signatureCode : '',
        hasSignatureImage: signed && Boolean(rec.signatureDataUrl),
      };
    });

    const eligibleWorkerCount = eligibleWorkers.length;
    // 근로기준법 제94조 제1항 과반수 = 50% 초과 = floor(N / 2) + 1
    const majorityRequiredCount = eligibleWorkerCount > 0 ? Math.floor(eligibleWorkerCount / 2) + 1 : 1;
    const dispatchedCount = workerStatuses.filter((w) => w.dispatched).length;
    const readConfirmedCount = workerStatuses.filter((w) => w.readConfirmed).length;
    const signedCount = workerStatuses.filter((w) => w.signed).length;
    const agreedCount = workerStatuses.filter((w) => w.signed && w.decision === 'AGREE').length;
    const disagreedCount = workerStatuses.filter((w) => w.signed && w.decision === 'DISAGREE').length;
    const opinionCount = workerStatuses.filter(
      (w) => w.signed && w.decision === 'OPINION_SUBMITTED'
    ).length;
    const agreedRatePct =
      eligibleWorkerCount > 0 ? Number(((agreedCount / eligibleWorkerCount) * 100).toFixed(1)) : 0;
    const participationRatePct =
      eligibleWorkerCount > 0 ? Number(((signedCount / eligibleWorkerCount) * 100).toFixed(1)) : 0;
    const majorityAchieved = eligibleWorkerCount > 0 && agreedCount >= majorityRequiredCount;
    const opinionMajorityAchieved = eligibleWorkerCount > 0 && signedCount >= majorityRequiredCount;
    const procedureSatisfied =
      amendment.changeType === 'ADVERSE_CONSENT' ? majorityAchieved : opinionMajorityAchieved;

    const stats = {
      eligibleWorkerCount,
      majorityRequiredCount,
      dispatchedCount,
      readConfirmedCount,
      signedCount,
      agreedCount,
      disagreedCount,
      opinionCount,
      agreedRatePct,
      participationRatePct,
      majorityAchieved,
      opinionMajorityAchieved,
      procedureSatisfied,
    };

    const viewObj = {
      amendmentId: amendment.amendmentId,
      title: amendment.title,
      createdAt: amendment.createdAt,
      effectiveDate: amendment.effectiveDate,
      changeType: amendment.changeType,
      changeTypeLabel:
        amendment.changeType === 'ADVERSE_CONSENT'
          ? '불이익 변경 (근로자 과반수 동의 필수 · 제94조①단서)'
          : '통상·유리 변경 (근로자 과반수 의견청취 · 제94조①본문)',
      reason: amendment.reason,
      clauses: structuredClone(amendment.clauses),
      canonicalBody,
      amendmentBodySha256,
      stats,
      workerStatuses,
    };

    return {
      ...viewObj,
      aggregatedConsentDocBody: buildWorkRuleAggregatedConsentDoc(company, viewObj),
      laborOfficeFilingBody: buildWorkRuleLaborOfficeFilingBody(
        company,
        viewObj,
        Math.max(Number(lsaRegularCount) || 0, eligibleWorkerCount)
      ),
    };
  }

  function buildView({ company, workers, compliance, getMaskedPhoneFn }) {
    const hc = compliance.headcounts;
    const oshFlags = compliance.oshFlags || {};

    const lmcWorkspaceEnabled =
      lmcWorkspaceManualOverride !== null ? Boolean(lmcWorkspaceManualOverride) : Boolean(hc.is30OrMore);
    const workRulesWorkspaceEnabled =
      workRulesWorkspaceManualOverride !== null
        ? Boolean(workRulesWorkspaceManualOverride)
        : Boolean(hc.is10OrMore);

    // 1) 환경 설정 인원수별 법정의무 체크리스트
    const scaleChecklist = STATUTORY_SCALE_CHECKLIST_CATALOG.map((item, idx) => {
      let autoApplicable = false;
      if (item.minWorkers <= 1) autoApplicable = true;
      else if (item.minWorkers === 5) autoApplicable = Boolean(hc.is5OrMore);
      else if (item.minWorkers === 10) autoApplicable = Boolean(hc.is10OrMore);
      else if (item.minWorkers === 30) autoApplicable = Boolean(hc.is30OrMore);
      else if (item.minWorkers === 50) {
        autoApplicable =
          Boolean(oshFlags.needsSafetyOfficer) ||
          Boolean(oshFlags.needsOshCommittee) ||
          hc.disRegularCount >= 50 ||
          hc.lsaRegularCount >= 50;
      } else if (item.minWorkers === 100) {
        autoApplicable = hc.disRegularCount >= 100 || Boolean(oshFlags.needsOshRegulation) || hc.lsaRegularCount >= 100;
      } else if (item.minWorkers >= 300) {
        autoApplicable = Boolean(hc.is300OrMoreLsa);
      }

      let checked = scaleCheckMap.has(item.id)
        ? Boolean(scaleCheckMap.get(item.id))
        : item.id === 'CHK_30_LMC'
          ? lmcWorkspaceEnabled
          : item.id === 'CHK_10_WORK_RULE'
            ? workRulesWorkspaceEnabled
            : false;

      if (item.id === 'CHK_30_LMC') checked = lmcWorkspaceEnabled;
      if (item.id === 'CHK_10_WORK_RULE') checked = workRulesWorkspaceEnabled;

      return {
        rowNo: idx + 1,
        ...item,
        autoApplicable,
        checked,
        statusLabel: autoApplicable
          ? checked
            ? '법정의무 해당 · 체크됨'
            : '법정의무 해당 · 확인필요'
          : checked
            ? '선제 도입 활성화됨'
            : `상시 ${item.minWorkers}인 이상 시 의무`,
      };
    });

    // 2) 노사협의회 뷰
    const employerMembers = lmcCommitteeMembers.filter((m) => m.side === 'EMPLOYER');
    const workerMembers = lmcCommitteeMembers.filter((m) => m.side === 'WORKER');
    const parityValid =
      employerMembers.length >= 3 &&
      workerMembers.length >= 3 &&
      employerMembers.length <= 10 &&
      employerMembers.length === workerMembers.length;

    const regulations = lmcRegulationsArchive.map((reg, idx) => {
      const body = buildLmcRegulationBody({
        companyName: company.companyName,
        bizRegNo: company.bizRegNo,
        ceoName: company.ceoName,
        enactedDate: reg.enactedDate,
        version: reg.version,
        committeeCountEachSide: reg.committeeCountEachSide,
        regularMeetingCycle: reg.regularMeetingCycle,
        quorumRule: reg.quorumRule,
        grievanceHandlingDays: reg.grievanceHandlingDays,
        hasMajorityUnion: Boolean(company.hasMajorityUnion),
        customAddendum: reg.customAddendum,
      });
      return {
        rowNo: idx + 1,
        ...structuredClone(reg),
        regulationBody: body,
        bodySha256: sha256Hex(body),
      };
    });

    const minutesList = lmcMinutesArchive.map((m, idx) => {
      const empSigs = m.signatures.filter((s) => s.side === 'EMPLOYER');
      const wrkSigs = m.signatures.filter((s) => s.side === 'WORKER');
      const empSignedCount = empSigs.filter((s) => s.signed).length;
      const wrkSignedCount = wrkSigs.filter((s) => s.signed).length;
      const signedTotal = empSignedCount + wrkSignedCount;
      const totalMembers = m.signatures.length;
      const allSigned = totalMembers > 0 && signedTotal === totalMembers;
      const compiledReportBody = buildCompiledLmcReportBody(company, m);

      return {
        rowNo: idx + 1,
        minutesId: m.minutesId,
        title: m.title,
        meetingCategory: m.meetingCategory,
        meetingDate: m.meetingDate,
        retentionUntil: m.retentionUntil,
        location: m.location,
        audioFileName: m.audioFileName,
        durationSec: m.durationSec,
        rawTranscript: m.rawTranscript,
        reportItems: structuredClone(m.reportItems || []),
        discussionItems: structuredClone(m.discussionItems || []),
        resolutionItems: structuredClone(m.resolutionItems || []),
        actionItems: structuredClone(m.actionItems || []),
        minutesBody: m.minutesBody,
        minutesBodySha256: m.minutesBodySha256,
        employerSignedCount: empSignedCount,
        employerTotalCount: empSigs.length,
        workerSignedCount: wrkSignedCount,
        workerTotalCount: wrkSigs.length,
        signedTotal,
        totalMembers,
        allSigned,
        compiledReportBody,
        signatures: m.signatures.map((s, sIdx) => ({
          rowNo: sIdx + 1,
          memberId: s.memberId,
          side: s.side,
          empCode: s.empCode || '',
          name: s.name,
          deptRole: s.deptRole,
          email: s.email,
          dispatched: Boolean(s.dispatchedAt),
          dispatchedAt: s.dispatchedAt || null,
          dispatchChannel: s.dispatchChannel || null,
          hasActiveToken: Boolean(s.tokenSha256),
          readConfirmedAt: s.readConfirmedAt || null,
          signed: Boolean(s.signed),
          signedAt: s.signedAt || null,
          signerName: s.signerName || '',
          signMethod: s.signMethod || null,
          signatureCode: s.signatureCode || '',
          hasSignatureImage: Boolean(s.signatureDataUrl),
        })),
      };
    });

    // 3) 취업규칙 개정·동의 뷰
    const amendmentsView = workRuleAmendments.map((am, idx) => ({
      rowNo: idx + 1,
      ...buildAmendmentView(am, company, workers, getMaskedPhoneFn, hc.lsaRegularCount),
    }));

    return {
      lmcWorkspaceEnabled,
      workRulesWorkspaceEnabled,
      lmcRequiredByLaw: Boolean(hc.is30OrMore),
      workRulesRequiredByLaw: Boolean(hc.is10OrMore),
      scaleChecklist,
      sampleTranscripts: Object.entries(SAMPLE_RECORDING_TRANSCRIPTS).map(([key, val]) => ({
        sampleId: key,
        label: val.label,
        meetingCategory: val.meetingCategory,
        location: val.location,
        audioFileName: val.audioFileName,
        durationSec: val.durationSec,
        transcript: val.transcript,
      })),
      lmcGovernance: {
        parityValid,
        employerCount: employerMembers.length,
        workerCount: workerMembers.length,
        committeeMembers: lmcCommitteeMembers.map((m, idx) => ({
          rowNo: idx + 1,
          ...structuredClone(m),
        })),
        regulations,
        minutesList,
      },
      workRulesGovernance: {
        amendments: amendmentsView,
      },
    };
  }

  function applyAction(actionPayload = {}, { state, appendAudit }) {
    const actionType = String(actionPayload.actionType || '').trim();
    const refDate = state.company.referenceDate || '2026-11-24';

    switch (actionType) {
      case 'TOGGLE_SCALE_CHECK_ITEM': {
        const itemId = String(actionPayload.itemId || '').trim();
        const spec = STATUTORY_SCALE_CHECKLIST_CATALOG.find((x) => x.id === itemId);
        if (!spec) throw badRequest('유효하지 않은 법정의무 체크 항목(itemId)입니다.');
        const nextChecked =
          typeof actionPayload.checked === 'boolean'
            ? actionPayload.checked
            : !Boolean(scaleCheckMap.get(itemId));
        scaleCheckMap.set(itemId, nextChecked);

        let openWorkspaceTab = null;
        if (itemId === 'CHK_30_LMC') {
          lmcWorkspaceManualOverride = nextChecked;
          if (nextChecked) openWorkspaceTab = 'lmc-dashboard';
        } else if (itemId === 'CHK_10_WORK_RULE') {
          workRulesWorkspaceManualOverride = nextChecked;
          if (nextChecked) openWorkspaceTab = 'work-rules';
        }

        appendAudit(
          '법정의무점검',
          `[${spec.tier}] ${spec.title} 체크 ${nextChecked ? '활성화' : '해제'}`
        );
        return {
          message:
            itemId === 'CHK_30_LMC' && nextChecked
              ? '노사협의회(30인+) 전용 대시보드가 활성화되어 좌측 메뉴에 노사협의회 창이 열렸습니다.'
              : itemId === 'CHK_10_WORK_RULE' && nextChecked
                ? '취업규칙 개정·과반수 동의 관리 시스템이 활성화되었습니다.'
                : `[${spec.title}] 점검 상태가 저장되었습니다.`,
          openWorkspaceTab,
          lmcWorkspaceEnabled: lmcWorkspaceManualOverride,
        };
      }

      case 'SET_LMC_WORKSPACE_ACTIVE': {
        const active = actionPayload.active !== false;
        lmcWorkspaceManualOverride = Boolean(active);
        scaleCheckMap.set('CHK_30_LMC', Boolean(active));
        appendAudit(
          '노사협의회설정',
          `환경 설정에서 노사협의회 전용 대시보드 ${active ? '활성화(오픈)' : '비활성화'}`
        );
        return {
          message: active
            ? '노사협의회 전용 대시보드가 활성화되었습니다. 규정·운영위원·녹음 회의록·위원 서명 취합을 한 곳에서 관리할 수 있습니다.'
            : '노사협의회 전용 대시보드 수동 표시가 해제되었습니다.',
          openWorkspaceTab: active ? 'lmc-dashboard' : null,
        };
      }

      case 'SAVE_LMC_REGULATION': {
        const committeeCountEachSide = Number(actionPayload.committeeCountEachSide ?? 3);
        if (
          !Number.isInteger(committeeCountEachSide) ||
          committeeCountEachSide < 3 ||
          committeeCountEachSide > 10
        ) {
          throw badRequest('근참법 제6조에 따라 노사협의회 위원은 각 3인 이상 10인 이내여야 합니다.');
        }
        const grievanceHandlingDays = Number(actionPayload.grievanceHandlingDays ?? 10);
        if (
          !Number.isInteger(grievanceHandlingDays) ||
          grievanceHandlingDays < 1 ||
          grievanceHandlingDays > 10
        ) {
          throw badRequest('근참법 제27조에 따라 고충처리 결과 통보 기한은 10일 이내여야 합니다.');
        }
        const enactedDate = String(actionPayload.enactedDate || refDate).trim();
        if (!isValidIsoDateSimple(enactedDate)) {
          throw badRequest('규정 시행일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
        }
        const regularMeetingCycle = maskPiiSafe(
          actionPayload.regularMeetingCycle || '매 분기(3개월마다) 1회 정기'
        ).slice(0, 80);
        const quorumRule = maskPiiSafe(
          actionPayload.quorumRule ||
            '근로자위원과 사용자위원 각 과반수의 출석으로 개의하고 출석위원 3분의 2 이상의 찬성'
        ).slice(0, 140);
        const customAddendum = maskPiiSafe(actionPayload.customAddendum || '').slice(0, 400);

        regVersionSeq += 1;
        const newReg = {
          regId: `LMC-REG-${regVersionSeq}`,
          version: regVersionSeq,
          enactedDate,
          filedWithin15Days: Boolean(actionPayload.filedWithin15Days ?? true),
          filedDate: enactedDate,
          committeeCountEachSide,
          regularMeetingCycle,
          quorumRule,
          grievanceHandlingDays,
          customAddendum,
        };
        lmcRegulationsArchive.unshift(newReg);
        appendAudit(
          '노사협의회규정',
          `노사협의회 규정 제${newReg.version}판 자동 보관 완료 (동수 각 ${committeeCountEachSide}인 · 시행일 ${enactedDate})`
        );
        return {
          message: `노사협의회 규정 제${newReg.version}판이 개정 이력과 함께 자동 보관되었습니다.`,
          regId: newReg.regId,
        };
      }

      case 'SAVE_LMC_MEMBER': {
        const side = String(actionPayload.side || '').trim().toUpperCase();
        if (side !== 'EMPLOYER' && side !== 'WORKER') {
          throw badRequest('위원 구분(side)은 EMPLOYER(사용자위원) 또는 WORKER(근로자위원)여야 합니다.');
        }
        const name = maskPiiSafe(actionPayload.name || '').slice(0, 40);
        if (!name) throw badRequest('위원 성명을 입력해 주세요.');
        const deptRole = maskPiiSafe(
          actionPayload.deptRole || (side === 'EMPLOYER' ? '사용자위원' : '근로자위원')
        ).slice(0, 60);
        const email = String(actionPayload.email || '').trim().slice(0, 80);
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw badRequest('서명 요청 발송을 위한 올바른 이메일 주소를 입력해 주세요.');
        }
        const phoneMasked = maskPiiSafe(actionPayload.phoneMasked || '010-****-0000').slice(0, 30);
        const electedMethod = maskPiiSafe(
          actionPayload.electedMethod ||
            (side === 'EMPLOYER' ? '대표이사 위촉' : '직접·비밀·무기명 투표 선출')
        ).slice(0, 60);
        const empCode = maskPiiSafe(actionPayload.empCode || '').slice(0, 24);
        if (
          actionPayload.termStart !== undefined &&
          String(actionPayload.termStart).trim() !== '' &&
          !isValidIsoDateSimple(actionPayload.termStart)
        ) {
          throw badRequest('위원 임기 시작일(termStart)은 실재하는 YYYY-MM-DD 날짜여야 합니다.');
        }
        const termStart = isValidIsoDateSimple(actionPayload.termStart)
          ? actionPayload.termStart
          : refDate;
        if (
          actionPayload.termEnd !== undefined &&
          String(actionPayload.termEnd).trim() !== '' &&
          !isValidIsoDateSimple(actionPayload.termEnd)
        ) {
          throw badRequest('위원 임기 종료일(termEnd)은 실재하는 YYYY-MM-DD 날짜여야 합니다.');
        }
        const termEnd = isValidIsoDateSimple(actionPayload.termEnd)
          ? actionPayload.termEnd
          : addYearsIso(termStart, 3);
        if (termEnd < termStart) {
          throw badRequest('위원 임기 종료일(termEnd)은 시작일(termStart) 이후여야 합니다.');
        }

        const existingId = String(actionPayload.memberId || '').trim();
        const existingIdx = existingId
          ? lmcCommitteeMembers.findIndex((m) => m.memberId === existingId)
          : -1;
        if (existingIdx >= 0) {
          lmcCommitteeMembers[existingIdx] = {
            ...lmcCommitteeMembers[existingIdx],
            side,
            empCode,
            name,
            deptRole,
            email,
            phoneMasked,
            electedMethod,
            termStart,
            termEnd,
            isGrievanceCommissioner: Boolean(actionPayload.isGrievanceCommissioner),
          };
          appendAudit('노사협의회위원', `[${name}] 노사협의회 위원 정보 수정 완료`);
          return { message: `[${name}] 위원 정보가 수정되었습니다.` };
        }

        const newMemberId = `LMC-M${String(++memberSeq).padStart(2, '0')}`;
        lmcCommitteeMembers.push({
          memberId: newMemberId,
          side,
          empCode,
          name,
          deptRole,
          email,
          phoneMasked,
          electedMethod,
          termStart,
          termEnd,
          isGrievanceCommissioner: Boolean(actionPayload.isGrievanceCommissioner),
        });
        appendAudit(
          '노사협의회위원',
          `[${side === 'EMPLOYER' ? '사용자위원' : '근로자위원'}] ${name} (${email}) 등록 완료`
        );
        return {
          message: `${side === 'EMPLOYER' ? '사용자위원' : '근로자위원'} [${name}]님이 등록되었습니다.`,
          memberId: newMemberId,
        };
      }

      case 'DELETE_LMC_MEMBER': {
        const memberId = String(actionPayload.memberId || '').trim();
        const idx = lmcCommitteeMembers.findIndex((m) => m.memberId === memberId);
        if (idx < 0) throw badRequest('삭제할 노사협의회 위원을 찾을 수 없습니다.');
        const [removed] = lmcCommitteeMembers.splice(idx, 1);
        appendAudit('노사협의회위원', `[${removed.name}] 위원 명단 제외 처리`);
        return { message: `[${removed.name}] 위원이 명단에서 제외되었습니다.` };
      }

      case 'CREATE_LMC_MINUTES_FROM_RECORDING': {
        const rawTranscript = String(actionPayload.rawTranscript || '').trim();
        if (!rawTranscript || rawTranscript.length < 10) {
          throw badRequest('회의록으로 자동 변환할 회의 녹음 인식 내용(또는 녹음 텍스트)을 입력해 주세요.');
        }
        if (rawTranscript.length > 50_000) {
          throw badRequest('녹음 변환 원문 길이는 50,000자를 초과할 수 없습니다.');
        }
        const meetingCategory = ['정기회의', '임시회의', '운영위원회'].includes(
          actionPayload.meetingCategory
        )
          ? actionPayload.meetingCategory
          : '운영위원회';
        if (
          actionPayload.meetingDate !== undefined &&
          String(actionPayload.meetingDate).trim() !== '' &&
          !isValidIsoDateSimple(actionPayload.meetingDate)
        ) {
          throw badRequest('회의 개최일(meetingDate)은 실재하는 YYYY-MM-DD 날짜여야 합니다.');
        }
        const meetingDate = isValidIsoDateSimple(actionPayload.meetingDate)
          ? actionPayload.meetingDate
          : refDate;
        const location = maskPiiSafe(actionPayload.location || '본사 회의실').slice(0, 80);
        const audioFileName = maskPiiSafe(
          actionPayload.audioFileName || `${meetingDate}_${meetingCategory}_회의녹음.webm`
        ).slice(0, 120);
        const durationSec = Math.max(0, Math.min(86400, Number(actionPayload.durationSec) || 0));

        const selectedIds = Array.isArray(actionPayload.attendeeMemberIds)
          ? new Set(actionPayload.attendeeMemberIds.map((x) => String(x).trim()))
          : null;
        const attendees =
          selectedIds && selectedIds.size > 0
            ? lmcCommitteeMembers.filter((m) => selectedIds.has(m.memberId))
            : [...lmcCommitteeMembers];
        if (attendees.length === 0) {
          throw badRequest('회의 출석 위원을 1명 이상 지정해 주세요.');
        }

        const parsed = parseAudioTranscriptToMinutes({
          companyName: state.company.companyName,
          title: maskPiiSafe(actionPayload.title || '').slice(0, 120),
          meetingCategory,
          meetingDate,
          location,
          audioFileName,
          durationSec,
          rawTranscript,
          attendees,
        });

        const minutesId = `LMC-MIN-${String(++minutesSeq).padStart(2, '0')}`;
        const newMin = {
          minutesId,
          meetingCategory,
          meetingDate,
          retentionUntil: addYearsIso(meetingDate, 3),
          location,
          audioFileName,
          durationSec,
          rawTranscript: maskPiiSafe(rawTranscript),
          ...parsed,
          signatures: attendees.map((m) => ({
            memberId: m.memberId,
            side: m.side,
            empCode: m.empCode || '',
            name: m.name,
            deptRole: m.deptRole,
            email: m.email,
            dispatchedAt: null,
            dispatchChannel: null,
            tokenSha256: '',
            tokenExpiresAt: null,
            readConfirmedAt: null,
            signed: false,
            signedAt: null,
            signerName: '',
            signMethod: null,
            signatureCode: '',
            signatureDataUrl: '',
          })),
        };
        lmcMinutesArchive.unshift(newMin);
        appendAudit(
          '녹음회의록변환',
          `[${minutesId}] ${newMin.title} — 녹음본(${audioFileName}) 법정 회의록 자동 정리·보관 완료 (출석위원 ${attendees.length}명)`
        );
        return {
          message: `회의 녹음본이 법정 회의록(${minutesId})으로 자동 정리되어 보관함에 저장되었습니다. 이제 노사위원에게 서명 요청 메일을 발송할 수 있습니다.`,
          minutesId,
        };
      }

      case 'DISPATCH_LMC_SIGN_REQUESTS': {
        const minutesId = String(actionPayload.minutesId || '').trim();
        const minItem = lmcMinutesArchive.find((m) => m.minutesId === minutesId);
        if (!minItem) throw notFoundError('대상 회의록을 찾을 수 없습니다.');
        const channel = actionPayload.channel === 'EMAIL_AND_KAKAO' ? 'EMAIL_AND_KAKAO' : 'EMAIL';

        const nowDateUtc = utcTodayIso();
        const dispatchedLinks = [];
        for (const sig of minItem.signatures) {
          if (sig.signed) continue;
          const {
            rawToken,
            tokenSha256,
            authCode,
            authCodeSha256,
            issuedAtUtc,
            tokenExpiresAt,
            tokenExpiresAtMs,
          } = mintRecipientToken();
          sig.dispatchedAt = sig.dispatchedAt || nowDateUtc;
          sig.tokenIssuedAtUtc = issuedAtUtc;
          sig.dispatchChannel = channel;
          sig.tokenSha256 = tokenSha256;
          sig.authCodeSha256 = authCodeSha256;
          sig.failedAttempts = 0;
          sig.tokenExpiresAt = tokenExpiresAt;
          sig.tokenExpiresAtMs = tokenExpiresAtMs;
          dispatchedLinks.push({
            memberId: sig.memberId,
            side: sig.side,
            name: sig.name,
            email: sig.email,
            authCode,
            hashFragment: `#sign=lmc&minutesId=${encodeURIComponent(minutesId)}&memberId=${encodeURIComponent(sig.memberId)}&token=${rawToken}`,
          });
        }
        appendAudit(
          '노사협의회서명발송',
          `[${minutesId}] 미서명 노사위원 ${dispatchedLinks.length}명에게 회의록 확인·전자서명 요청(${channel === 'EMAIL_AND_KAKAO' ? '메일+알림톡' : '이메일'}) 발송 완료`
        );
        return {
          message: `미서명 위원 ${dispatchedLinks.length}명(사용자위원·근로자위원)에게 개별 회의록 서명 요청 메일 및 별도 본인확인 인증번호가 발송되었습니다.`,
          minutesId,
          dispatchedLinks,
        };
      }

      case 'RECORD_LMC_OFFLINE_SIGNATURE': {
        const minutesId = String(actionPayload.minutesId || '').trim();
        const memberId = String(actionPayload.memberId || '').trim();
        const minItem = lmcMinutesArchive.find((m) => m.minutesId === minutesId);
        if (!minItem) throw notFoundError('대상 회의록을 찾을 수 없습니다.');
        const sig = minItem.signatures.find((s) => s.memberId === memberId);
        if (!sig) throw notFoundError('대상 위원을 찾을 수 없습니다.');
        if (sig.signed) {
          throw conflictError(
            `이미 서명(${sig.signMethod === 'ELECTRONIC_PORTAL' ? '전자서명' : '자필서명'})이 완료된 위원은 기존 증빙 보호를 위해 덮어쓸 수 없습니다.`
          );
        }
        const nowDateUtc = utcTodayIso();
        sig.readConfirmedAt = sig.readConfirmedAt || nowDateUtc;
        sig.signed = true;
        sig.signedAt = nowDateUtc;
        sig.signedAtUtc = utcNowIso();
        sig.signerName = sig.name;
        sig.signMethod = 'OFFLINE_PRINT';
        sig.signatureCode = `SIG-LMC-PAPER-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        sig.tokenSha256 = '';
        sig.authCodeSha256 = '';
        sig.tokenExpiresAt = null;
        sig.tokenExpiresAtMs = 0;
        appendAudit(
          '노사협의회서면서명',
          `[${minutesId}] ${sig.side === 'EMPLOYER' ? '사용자위원' : '근로자위원'} ${sig.name} 인쇄본 자필서명 수령·취합 반영`
        );
        return {
          message: `[${sig.name}] 위원의 오프라인 인쇄본 자필서명이 회의록 취합 보고서에 반영되었습니다.`,
        };
      }

      case 'CREATE_WORK_RULE_AMENDMENT': {
        const title = maskPiiSafe(actionPayload.title || '').slice(0, 140);
        if (!title) throw badRequest('취업규칙 개정안 제목을 입력해 주세요.');
        if (
          actionPayload.effectiveDate !== undefined &&
          String(actionPayload.effectiveDate).trim() !== '' &&
          !isValidIsoDateSimple(actionPayload.effectiveDate)
        ) {
          throw badRequest('취업규칙 시행예정일(effectiveDate)은 실재하는 YYYY-MM-DD 날짜여야 합니다.');
        }
        const effectiveDate = isValidIsoDateSimple(actionPayload.effectiveDate)
          ? actionPayload.effectiveDate
          : refDate;
        const changeType =
          actionPayload.changeType === 'NORMAL_OPINION' ? 'NORMAL_OPINION' : 'ADVERSE_CONSENT';
        const reason = maskPiiSafe(
          actionPayload.reason || '근로조건 기준 정비 및 관계법령 개정사항 반영'
        ).slice(0, 300);

        const rawClauses = Array.isArray(actionPayload.clauses) ? actionPayload.clauses : [];
        const clauses = rawClauses
          .map((c) => ({
            articleTitle: maskPiiSafe(c?.articleTitle || '').slice(0, 100),
            beforeText: maskPiiSafe(c?.beforeText || '').slice(0, 600),
            afterText: maskPiiSafe(c?.afterText || '').slice(0, 600),
          }))
          .filter((c) => c.articleTitle && c.afterText);

        if (clauses.length === 0) {
          throw badRequest('신·구조문 대비표에 최소 1개 이상의 개정 조항(조문명 및 개정 후 내용)을 입력해 주세요.');
        }

        const amendmentId = `WR-2026-${String(++amendmentSeq).padStart(2, '0')}`;
        workRuleAmendments.unshift({
          amendmentId,
          title,
          createdAt: utcTodayIso(),
          effectiveDate,
          changeType,
          reason,
          clauses,
        });
        appendAudit(
          '취업규칙개정발의',
          `[${amendmentId}] ${title} (${changeType === 'ADVERSE_CONSENT' ? '불이익 변경·과반수 동의' : '통상 변경·과반수 의견청취'}) 신·구조문 등록 완료`
        );
        return {
          message: `취업규칙 개정안(${amendmentId})이 등록되었습니다. 이제 전 근로자에게 메일·카톡으로 개별 발송하여 확인 및 서명을 취합할 수 있습니다.`,
          amendmentId,
        };
      }

      case 'DISPATCH_WORK_RULE_NOTICES': {
        const amendmentId = String(actionPayload.amendmentId || '').trim();
        const am = workRuleAmendments.find((a) => a.amendmentId === amendmentId);
        if (!am) throw notFoundError('대상 취업규칙 개정안을 찾을 수 없습니다.');
        const channel = ['EMAIL_AND_KAKAO', 'EMAIL', 'KAKAO'].includes(actionPayload.channel)
          ? actionPayload.channel
          : 'EMAIL_AND_KAKAO';

        const targetEmpCode = actionPayload.empCode
          ? String(actionPayload.empCode).trim()
          : '';
        const eligible = getEligibleWorkRuleWorkers(state.workers).filter(
          (w) => !targetEmpCode || w.empCode === targetEmpCode
        );
        if (eligible.length === 0) {
          throw badRequest('발송할 적용 대상 근로자가 없습니다.');
        }

        const canonicalSha = sha256Hex(buildWorkRuleAmendmentCanonicalText(am));
        const nowDateUtc = utcTodayIso();
        const dispatchedLinks = [];
        for (const w of eligible) {
          const key = `${amendmentId}:${w.empCode}`;
          const prev = workRuleResponsesMap.get(key);
          if (prev && prev.signed && prev.signedBodySha256 === canonicalSha) {
            if (targetEmpCode) {
              throw conflictError('이미 해당 개정안에 서명이 완료된 근로자입니다.');
            }
            continue;
          }
          const {
            rawToken,
            tokenSha256,
            authCode,
            authCodeSha256,
            issuedAtUtc,
            tokenExpiresAt,
            tokenExpiresAtMs,
          } = mintRecipientToken();
          workRuleResponsesMap.set(key, {
            ...(prev || {
              readConfirmedAt: null,
              signed: false,
              signedAt: null,
              decision: null,
              opinionText: '',
              signerName: '',
              signMethod: null,
              signatureCode: '',
              signatureDataUrl: '',
              signedBodySha256: '',
            }),
            dispatchedAt: prev?.dispatchedAt || nowDateUtc,
            tokenIssuedAtUtc: issuedAtUtc,
            channel,
            tokenSha256,
            authCodeSha256,
            failedAttempts: 0,
            tokenExpiresAt,
            tokenExpiresAtMs,
          });
          dispatchedLinks.push({
            empCode: w.empCode,
            displayName: w.displayName,
            email: buildWorkerEmail(w),
            channelLabel: channelLabelOf(channel),
            authCode,
            hashFragment: `#sign=workrule&amendmentId=${encodeURIComponent(amendmentId)}&empCode=${encodeURIComponent(w.empCode)}&token=${rawToken}`,
          });
        }

        appendAudit(
          '취업규칙개별발송',
          `[${amendmentId}] 근로자 ${dispatchedLinks.length}명에게 개정 취업규칙 신·구조문 및 서명 링크(${channelLabelOf(channel)}) 발송 완료`
        );
        return {
          message: `대상 근로자 ${dispatchedLinks.length}명에게 [${channelLabelOf(channel)}]으로 개정 내용 열람 링크 및 별도 본인확인 인증번호를 발송했습니다.`,
          amendmentId,
          dispatchedLinks,
        };
      }

      case 'ISSUE_RECIPIENT_SIGN_LINK': {
        const portalKind = String(actionPayload.portalKind || '').trim().toUpperCase();
        const targetId = String(actionPayload.targetId || '').trim();
        const recipientId = String(actionPayload.recipientId || '').trim();
        const {
          rawToken,
          tokenSha256,
          authCode,
          authCodeSha256,
          issuedAtUtc,
          tokenExpiresAt,
          tokenExpiresAtMs,
        } = mintRecipientToken();
        const nowDateUtc = utcTodayIso();

        if (portalKind === 'LMC') {
          const minItem = lmcMinutesArchive.find((m) => m.minutesId === targetId);
          if (!minItem) throw notFoundError('대상 회의록을 찾을 수 없습니다.');
          const sig = minItem.signatures.find((s) => s.memberId === recipientId);
          if (!sig) throw notFoundError('대상 노사위원을 찾을 수 없습니다.');
          if (sig.signed) {
            throw conflictError('이미 회의록 서명이 완료된 위원입니다.');
          }
          sig.dispatchedAt = sig.dispatchedAt || nowDateUtc;
          sig.tokenIssuedAtUtc = issuedAtUtc;
          sig.dispatchChannel = sig.dispatchChannel || 'EMAIL';
          sig.tokenSha256 = tokenSha256;
          sig.authCodeSha256 = authCodeSha256;
          sig.failedAttempts = 0;
          sig.tokenExpiresAt = tokenExpiresAt;
          sig.tokenExpiresAtMs = tokenExpiresAtMs;
          return {
            message: `[${sig.name}] 위원 전용 회의록 확인·서명 화면이 준비되었습니다.`,
            portalKind: 'LMC',
            targetId,
            recipientId,
            rawToken,
            authCode,
            signerNameHint: sig.name,
            hashFragment: `#sign=lmc&minutesId=${encodeURIComponent(targetId)}&memberId=${encodeURIComponent(recipientId)}&token=${rawToken}`,
          };
        }

        if (portalKind === 'WORK_RULE') {
          const am = workRuleAmendments.find((a) => a.amendmentId === targetId);
          if (!am) throw notFoundError('대상 취업규칙 개정안을 찾을 수 없습니다.');
          const w = getEligibleWorkRuleWorkers(state.workers).find(
            (x) => x.empCode === recipientId
          );
          if (!w) throw notFoundError('적용 대상 근로자를 찾을 수 없습니다.');
          const canonicalSha = sha256Hex(buildWorkRuleAmendmentCanonicalText(am));
          const key = `${targetId}:${w.empCode}`;
          const prev = workRuleResponsesMap.get(key) || {};
          if (prev.signed && prev.signedBodySha256 === canonicalSha) {
            throw conflictError('이미 해당 취업규칙 개정안에 서명이 완료된 근로자입니다.');
          }
          workRuleResponsesMap.set(key, {
            readConfirmedAt: prev.readConfirmedAt || null,
            signed: false,
            signedAt: null,
            decision: null,
            opinionText: '',
            signerName: '',
            signMethod: null,
            signatureCode: '',
            signatureDataUrl: '',
            signedBodySha256: '',
            dispatchedAt: prev.dispatchedAt || nowDateUtc,
            tokenIssuedAtUtc: issuedAtUtc,
            channel: prev.channel || 'EMAIL_AND_KAKAO',
            tokenSha256,
            authCodeSha256,
            failedAttempts: 0,
            tokenExpiresAt,
            tokenExpiresAtMs,
          });
          return {
            message: `[${w.displayName}] 근로자 전용 취업규칙 개정 확인·서명 화면이 준비되었습니다.`,
            portalKind: 'WORK_RULE',
            targetId,
            recipientId,
            rawToken,
            authCode,
            signerNameHint: w.displayName,
            hashFragment: `#sign=workrule&amendmentId=${encodeURIComponent(targetId)}&empCode=${encodeURIComponent(recipientId)}&token=${rawToken}`,
          };
        }

        throw badRequest('지원하지 않는 서명 포털 구분(portalKind)입니다.');
      }

      case 'RECORD_WORK_RULE_OFFLINE_SIGNATURE': {
        const amendmentId = String(actionPayload.amendmentId || '').trim();
        const empCode = String(actionPayload.empCode || '').trim();
        const am = workRuleAmendments.find((a) => a.amendmentId === amendmentId);
        if (!am) throw notFoundError('대상 취업규칙 개정안을 찾을 수 없습니다.');
        const w = getEligibleWorkRuleWorkers(state.workers).find((x) => x.empCode === empCode);
        if (!w) throw notFoundError('적용 대상 근로자를 찾을 수 없습니다.');
        const decision = validateExplicitWorkRuleDecision(am.changeType, actionPayload.decision);
        const canonicalSha = sha256Hex(buildWorkRuleAmendmentCanonicalText(am));
        const key = `${amendmentId}:${empCode}`;
        const prev = workRuleResponsesMap.get(key) || {};
        if (prev.signed && prev.signedBodySha256 === canonicalSha) {
          throw conflictError(
            `이미 서명(${prev.decision})이 완료된 근로자 기록은 기존 의사표시 증빙 보호를 위해 덮어쓸 수 없습니다.`
          );
        }
        const nowDateUtc = utcTodayIso();
        workRuleResponsesMap.set(key, {
          dispatchedAt: prev.dispatchedAt || nowDateUtc,
          channel: prev.channel || 'OFFLINE_PRINT',
          tokenSha256: '',
          authCodeSha256: '',
          failedAttempts: 0,
          tokenExpiresAt: null,
          tokenExpiresAtMs: 0,
          readConfirmedAt: prev.readConfirmedAt || nowDateUtc,
          signed: true,
          signedAt: nowDateUtc,
          signedAtUtc: utcNowIso(),
          decision,
          opinionText: maskPiiSafe(actionPayload.opinionText || prev.opinionText || '').slice(0, 160),
          signerName: w.displayName,
          signMethod: 'OFFLINE_PRINT',
          signatureCode: `SIG-WR-PAPER-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          signatureDataUrl: '',
          signedBodySha256: canonicalSha,
        });
        appendAudit(
          '취업규칙서면서명',
          `[${amendmentId}] ${empCode} ${w.displayName} 프린트 자필서명분(${decision === 'AGREE' ? '동의' : decision === 'DISAGREE' ? '부동의' : '의견제출'}) 동의서 연명부 반영`
        );
        return {
          message: `[${w.displayName}]님의 오프라인 프린트 자필서명이 동의서 취합 연명부에 자동 반영되었습니다.`,
        };
      }

      default:
        return null;
    }
  }

  /**
   * 개별 수신자(노사위원 / 근로자) 토큰 기반 최소권한 열람 검증 (`POST /api/public-sign/inspect`)
   */
  function inspectPublicSignTarget(payload = {}, { state }) {
    const portalKind = String(payload.portalKind || '').trim().toUpperCase();
    const targetId = String(payload.targetId || '').trim();
    const recipientId = String(payload.recipientId || '').trim();
    const rawToken = String(payload.signToken || '').trim();
    const nowDateUtc = utcTodayIso();

    if (!rawToken || rawToken.length < 16) {
      throw forbiddenError('유효한 개별 서명 토큰(signToken)이 필요합니다.');
    }
    const providedSha = sha256Hex(rawToken);

    if (portalKind === 'LMC') {
      const minItem = lmcMinutesArchive.find((m) => m.minutesId === targetId);
      if (!minItem) throw notFoundError('대상 회의록을 찾을 수 없습니다.');
      const sig = minItem.signatures.find((s) => s.memberId === recipientId);
      if (!sig || !sig.tokenSha256 || !safeTimingEqualHex(providedSha, sig.tokenSha256)) {
        throw forbiddenError('유효하지 않거나 이미 만료된 위원 서명 링크입니다.');
      }
      if (isRecipientTokenExpired(sig)) {
        throw forbiddenError('서명 유효기간이 만료된 링크입니다. 인사담당자에게 재발송을 요청해 주세요.');
      }
      sig.readConfirmedAt = sig.readConfirmedAt || nowDateUtc;
      return {
        portalKind: 'LMC',
        companyName: state.company.companyName,
        targetId: minItem.minutesId,
        title: minItem.title,
        subtitle: `${minItem.meetingDate} · ${minItem.meetingCategory} · ${minItem.location}`,
        documentBody: minItem.minutesBody,
        expectedBodySha256: minItem.minutesBodySha256,
        recipient: {
          recipientId: sig.memberId,
          roleLabel: sig.side === 'EMPLOYER' ? '사용자위원' : '근로자위원',
          maskedSignerHint: maskPersonNameForHint(sig.name),
          requiresAuthCode: Boolean(sig.authCodeSha256),
          deptRole: sig.deptRole,
          alreadySigned: Boolean(sig.signed),
          signedAt: sig.signedAt,
          signatureCode: sig.signatureCode,
        },
      };
    }

    if (portalKind === 'WORK_RULE') {
      const am = workRuleAmendments.find((a) => a.amendmentId === targetId);
      if (!am) throw notFoundError('대상 취업규칙 개정안을 찾을 수 없습니다.');
      const w = getEligibleWorkRuleWorkers(state.workers).find((x) => x.empCode === recipientId);
      if (!w) throw notFoundError('적용 대상 근로자 정보를 찾을 수 없습니다.');
      const key = `${targetId}:${w.empCode}`;
      const rec = workRuleResponsesMap.get(key);
      if (!rec || !rec.tokenSha256 || !safeTimingEqualHex(providedSha, rec.tokenSha256)) {
        throw forbiddenError('유효하지 않거나 이미 만료된 근로자 확인·서명 링크입니다.');
      }
      if (isRecipientTokenExpired(rec)) {
        throw forbiddenError('서명 유효기간이 만료된 링크입니다. 인사팀에 재발송을 요청해 주세요.');
      }
      rec.readConfirmedAt = rec.readConfirmedAt || nowDateUtc;
      const canonicalBody = buildWorkRuleAmendmentCanonicalText(am);
      const expectedBodySha256 = sha256Hex(canonicalBody);
      return {
        portalKind: 'WORK_RULE',
        companyName: state.company.companyName,
        targetId: am.amendmentId,
        title: am.title,
        changeType: am.changeType,
        subtitle: `시행예정일 ${am.effectiveDate} · ${
          am.changeType === 'ADVERSE_CONSENT'
            ? '불이익 변경 (근로자 과반수 동의 절차)'
            : '통상·유리 변경 (근로자 과반수 의견청취 절차)'
        }`,
        reason: am.reason,
        clauses: structuredClone(am.clauses),
        documentBody: canonicalBody,
        expectedBodySha256,
        recipient: {
          recipientId: w.empCode,
          roleLabel: `${w.deptName || '소속부서'} · ${w.empCode}`,
          maskedSignerHint: maskPersonNameForHint(w.displayName),
          requiresAuthCode: Boolean(rec.authCodeSha256),
          alreadySigned: Boolean(rec.signed && rec.signedBodySha256 === expectedBodySha256),
          signedAt: rec.signedAt,
          decision: rec.decision,
          signatureCode: rec.signatureCode,
        },
      };
    }

    throw badRequest('지원하지 않는 서명 포털 유형입니다.');
  }

  /**
   * 개별 수신자(노사위원 / 근로자) 토큰 + 별도 본인확인 인증번호(authCode) 기반 전자서명 제출 (`POST /api/public-sign/submit`)
   */
  function submitPublicSignTarget(payload = {}, { state, appendAudit }) {
    const portalKind = String(payload.portalKind || '').trim().toUpperCase();
    const targetId = String(payload.targetId || '').trim();
    const recipientId = String(payload.recipientId || '').trim();
    const rawToken = String(payload.signToken || '').trim();
    const rawAuthCode = String(payload.authCode || '').trim();
    const expectedBodySha256 = String(payload.expectedBodySha256 || '').trim().toLowerCase();
    const signerName = maskPiiSafe(payload.signerName || '').slice(0, 40);
    const signatureDataUrl = validateSignatureDataUrl(payload.signatureDataUrl || '');
    const nowDateUtc = utcTodayIso();
    const nowTimestampUtc = utcNowIso();

    if (payload.readConfirmed !== true) {
      throw badRequest('문서 전문(회의록 또는 신·구조문 대비표) 열람·확인 체크가 필요합니다.');
    }
    if (payload.consentConfirmed !== true) {
      throw badRequest('본인 자유의사에 따른 전자서명 동의 체크가 필요합니다.');
    }
    if (!rawToken || rawToken.length < 16) {
      throw forbiddenError('유효한 서명 토큰(signToken)이 필요합니다.');
    }
    const providedSha = sha256Hex(rawToken);
    const providedAuthSha = rawAuthCode ? sha256Hex(rawAuthCode) : '';

    const recordFailedAttempt = (recObj, mismatchErr) => {
      recObj.failedAttempts = Number(recObj.failedAttempts || 0) + 1;
      if (recObj.failedAttempts >= 5) {
        recObj.tokenSha256 = '';
        recObj.authCodeSha256 = '';
        recObj.tokenExpiresAt = null;
        recObj.tokenExpiresAtMs = 0;
        const lockErr = forbiddenError(
          '본인확인 인증 오류 횟수(5회) 초과로 서명 토큰이 폐기되었습니다. 재발송을 요청해 주세요.'
        );
        lockErr.persistSecurityMutation = true;
        throw lockErr;
      }
      mismatchErr.persistSecurityMutation = true;
      throw mismatchErr;
    };

    if (portalKind === 'LMC') {
      const minItem = lmcMinutesArchive.find((m) => m.minutesId === targetId);
      if (!minItem) throw notFoundError('대상 회의록을 찾을 수 없습니다.');
      const sig = minItem.signatures.find((s) => s.memberId === recipientId);
      if (!sig || !sig.tokenSha256 || !safeTimingEqualHex(providedSha, sig.tokenSha256)) {
        throw forbiddenError('유효하지 않거나 이미 사용 완료된 위원 서명 토큰입니다.');
      }
      if (isRecipientTokenExpired(sig)) {
        throw forbiddenError('서명 유효기간이 만료된 토큰입니다.');
      }
      if (!expectedBodySha256 || expectedBodySha256 !== minItem.minutesBodySha256.toLowerCase()) {
        throw conflictError(
          '열람 중 회의록 본문이 변경되었습니다. 최신 회의록을 다시 확인한 뒤 서명해 주세요.'
        );
      }
      if (!sig.authCodeSha256 || !providedAuthSha || !safeTimingEqualHex(providedAuthSha, sig.authCodeSha256)) {
        recordFailedAttempt(
          sig,
          forbiddenError('별도 발송된 6자리 수신자 본인확인 인증번호(authCode)가 일치하지 않습니다.')
        );
      }
      if (signerName !== sig.name) {
        recordFailedAttempt(
          sig,
          badRequest('출석 위원 본인 성명을 정확히 입력해야 서명이 완료됩니다.')
        );
      }

      sig.readConfirmedAt = sig.readConfirmedAt || nowDateUtc;
      sig.signed = true;
      sig.signedAt = nowDateUtc;
      sig.signedAtUtc = nowTimestampUtc;
      sig.signerName = sig.name;
      sig.signMethod = 'ELECTRONIC_PORTAL';
      sig.signatureCode = `SIG-LMC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      sig.signatureDataUrl = signatureDataUrl;
      sig.tokenSha256 = '';
      sig.authCodeSha256 = '';
      sig.failedAttempts = 0;
      sig.tokenExpiresAt = null;
      sig.tokenExpiresAtMs = 0;

      const signedCount = minItem.signatures.filter((s) => s.signed).length;
      const totalCount = minItem.signatures.length;
      appendAudit(
        '노사협의회위원서명',
        `[${minItem.minutesId}] ${sig.side === 'EMPLOYER' ? '사용자위원' : '근로자위원'} ${sig.name} 회의록 전자서명 완료 (${signedCount}/${totalCount}명 취합)`
      );
      return {
        message: `[${sig.name}] 위원의 회의록 서명이 제출되어 결과보고서에 자동 취합되었습니다 (${signedCount}/${totalCount}명 완료).`,
        signatureCode: sig.signatureCode,
        signedAt: sig.signedAt,
        signedCount,
        totalCount,
        allSigned: signedCount === totalCount,
      };
    }

    if (portalKind === 'WORK_RULE') {
      const am = workRuleAmendments.find((a) => a.amendmentId === targetId);
      if (!am) throw notFoundError('대상 취업규칙 개정안을 찾을 수 없습니다.');
      const w = getEligibleWorkRuleWorkers(state.workers).find((x) => x.empCode === recipientId);
      if (!w) throw notFoundError('적용 대상 근로자를 찾을 수 없습니다.');
      const key = `${targetId}:${w.empCode}`;
      const rec = workRuleResponsesMap.get(key);
      if (!rec || !rec.tokenSha256 || !safeTimingEqualHex(providedSha, rec.tokenSha256)) {
        throw forbiddenError('유효하지 않거나 이미 서명 제출이 완료된 토큰입니다.');
      }
      if (isRecipientTokenExpired(rec)) {
        throw forbiddenError('서명 유효기간이 만료된 토큰입니다.');
      }

      const currentSha = sha256Hex(buildWorkRuleAmendmentCanonicalText(am));
      if (!expectedBodySha256 || expectedBodySha256 !== currentSha.toLowerCase()) {
        throw conflictError(
          '열람 중 취업규칙 개정안 본문이 변경되었습니다. 최신 대비표를 확인한 뒤 다시 서명해 주세요.'
        );
      }
      if (!rec.authCodeSha256 || !providedAuthSha || !safeTimingEqualHex(providedAuthSha, rec.authCodeSha256)) {
        recordFailedAttempt(
          rec,
          forbiddenError('별도 발송된 6자리 수신자 본인확인 인증번호(authCode)가 일치하지 않습니다.')
        );
      }
      if (signerName !== w.displayName) {
        recordFailedAttempt(
          rec,
          badRequest('근로자 본인 성명을 정확히 입력해야 본인 서명으로 인정됩니다.')
        );
      }

      const decision = validateExplicitWorkRuleDecision(am.changeType, payload.decision);
      const opinionText = maskPiiSafe(payload.opinionText || '').slice(0, 200);
      const signatureCode = `SIG-WR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      workRuleResponsesMap.set(key, {
        ...rec,
        readConfirmedAt: rec.readConfirmedAt || nowDateUtc,
        signed: true,
        signedAt: nowDateUtc,
        signedAtUtc: nowTimestampUtc,
        decision,
        opinionText,
        signerName: w.displayName,
        signMethod: 'ELECTRONIC_PORTAL',
        signatureCode,
        signatureDataUrl,
        signedBodySha256: currentSha,
        tokenSha256: '',
        authCodeSha256: '',
        failedAttempts: 0,
        tokenExpiresAt: null,
        tokenExpiresAtMs: 0,
      });

      const updatedView = buildAmendmentView(
        am,
        state.company,
        state.workers,
        undefined,
        state.company?.headcountInput?.regularWorkers || 0
      );
      appendAudit(
        '취업규칙근로자서명',
        `[${am.amendmentId}] ${w.empCode} ${w.displayName} 개정내용 확인 및 본인서명(${
          decision === 'AGREE' ? '동의' : decision === 'DISAGREE' ? '부동의' : '의견제출'
        }) 완료 → 동의 ${updatedView.stats.agreedCount}/${updatedView.stats.eligibleWorkerCount}명`
      );
      return {
        message: `[${w.displayName}]님의 취업규칙 개정 내용 확인 및 본인 서명이 제출되어 동의서에 자동 취합되었습니다 (현재 동의 ${updatedView.stats.agreedCount}/${updatedView.stats.eligibleWorkerCount}명 · 과반수 기준 ${updatedView.stats.majorityRequiredCount}명).`,
        signatureCode,
        signedAt: nowDateUtc,
        stats: updatedView.stats,
      };
    }

    throw badRequest('지원하지 않는 서명 포털 유형입니다.');
  }

  function scrubPurgedPerson(origEmpCode, origDisplayName) {
    const cleanCode = String(origEmpCode || '').trim().toUpperCase();
    const cleanName = String(origDisplayName || '').trim();
    const replaceToken = (str) => {
      let out = String(str || '');
      if (cleanCode) out = out.replaceAll(cleanCode, 'PURGED-EMP');
      if (cleanName) out = out.replaceAll(cleanName, '비식별파기인원');
      return out;
    };
    if (cleanCode) {
      for (const key of Array.from(workRuleResponsesMap.keys())) {
        if (key.toUpperCase().endsWith(`:${cleanCode}`)) {
          workRuleResponsesMap.delete(key);
        }
      }
    }
    if (cleanCode || cleanName) {
      lmcCommitteeMembers = lmcCommitteeMembers.filter(
        (m) =>
          (!cleanCode || String(m.empCode || '').toUpperCase() !== cleanCode) &&
          (!cleanName || m.name !== cleanName)
      );
      for (const min of lmcMinutesArchive) {
        min.title = replaceToken(min.title);
        min.rawTranscript = replaceToken(min.rawTranscript);
        min.minutesBody = replaceToken(min.minutesBody);
        min.minutesBodySha256 = sha256Hex(min.minutesBody);
        if (Array.isArray(min.reportItems)) min.reportItems = min.reportItems.map(replaceToken);
        if (Array.isArray(min.discussionItems)) {
          min.discussionItems = min.discussionItems.map(replaceToken);
        }
        if (Array.isArray(min.resolutionItems)) {
          min.resolutionItems = min.resolutionItems.map(replaceToken);
        }
        if (Array.isArray(min.actionItems)) {
          min.actionItems = min.actionItems.map(replaceToken);
        }
        if (Array.isArray(min.speakerSummaryLines)) {
          min.speakerSummaryLines = min.speakerSummaryLines.map(replaceToken);
        }
        for (const sig of min.signatures) {
          if (
            (cleanCode && String(sig.empCode || '').toUpperCase() === cleanCode) ||
            (cleanName && sig.name === cleanName)
          ) {
            sig.empCode = '';
            sig.name = '비식별파기위원';
            sig.signerName = sig.signed ? '비식별파기위원' : '';
            sig.email = 'purged@invalid.local';
            sig.signatureDataUrl = '';
            sig.tokenSha256 = '';
            sig.authCodeSha256 = '';
          }
        }
      }
    }
  }

  function resetManualScaleOverrides() {
    lmcWorkspaceManualOverride = null;
    workRulesWorkspaceManualOverride = null;
  }

  function resetForNewRoster() {
    workRuleResponsesMap.clear();
  }

  function exportPersistenceState() {
    const wrResponses = {};
    for (const [k, v] of workRuleResponsesMap.entries()) {
      wrResponses[k] = structuredClone(v);
    }
    return {
      regVersionSeq,
      memberSeq,
      minutesSeq,
      amendmentSeq,
      scaleChecks: Object.fromEntries(scaleCheckMap.entries()),
      lmcWorkspaceManualOverride,
      workRulesWorkspaceManualOverride,
      lmcRegulationsArchive: structuredClone(lmcRegulationsArchive),
      lmcCommitteeMembers: structuredClone(lmcCommitteeMembers),
      lmcMinutesArchive: structuredClone(lmcMinutesArchive),
      workRuleAmendments: structuredClone(workRuleAmendments),
      workRuleResponses: wrResponses,
    };
  }

  function restorePersistenceState(saved = {}) {
    if (!saved || typeof saved !== 'object') return;
    if (Number.isInteger(saved.regVersionSeq)) regVersionSeq = saved.regVersionSeq;
    if (Number.isInteger(saved.memberSeq)) memberSeq = saved.memberSeq;
    if (Number.isInteger(saved.minutesSeq)) minutesSeq = saved.minutesSeq;
    if (Number.isInteger(saved.amendmentSeq)) amendmentSeq = saved.amendmentSeq;
    if (saved.scaleChecks && typeof saved.scaleChecks === 'object') {
      scaleCheckMap.clear();
      for (const [k, v] of Object.entries(saved.scaleChecks)) {
        scaleCheckMap.set(k, Boolean(v));
      }
    }
    if (saved.lmcWorkspaceManualOverride === null || typeof saved.lmcWorkspaceManualOverride === 'boolean') {
      lmcWorkspaceManualOverride = saved.lmcWorkspaceManualOverride;
    }
    if (
      saved.workRulesWorkspaceManualOverride === null ||
      typeof saved.workRulesWorkspaceManualOverride === 'boolean'
    ) {
      workRulesWorkspaceManualOverride = saved.workRulesWorkspaceManualOverride;
    }
    if (Array.isArray(saved.lmcRegulationsArchive) && saved.lmcRegulationsArchive.length > 0) {
      lmcRegulationsArchive.length = 0;
      lmcRegulationsArchive.push(...structuredClone(saved.lmcRegulationsArchive));
    }
    if (Array.isArray(saved.lmcCommitteeMembers)) {
      lmcCommitteeMembers = structuredClone(saved.lmcCommitteeMembers);
    }
    if (Array.isArray(saved.lmcMinutesArchive)) {
      lmcMinutesArchive = structuredClone(saved.lmcMinutesArchive);
    }
    if (Array.isArray(saved.workRuleAmendments) && saved.workRuleAmendments.length > 0) {
      workRuleAmendments = structuredClone(saved.workRuleAmendments);
    }
    if (saved.workRuleResponses && typeof saved.workRuleResponses === 'object') {
      workRuleResponsesMap.clear();
      for (const [k, v] of Object.entries(saved.workRuleResponses)) {
        if (v && typeof v === 'object') {
          workRuleResponsesMap.set(k, structuredClone(v));
        }
      }
    }
  }

  return Object.freeze({
    buildView,
    applyAction,
    inspectPublicSignTarget,
    submitPublicSignTarget,
    scrubPurgedPerson,
    resetManualScaleOverrides,
    resetForNewRoster,
    exportPersistenceState,
    restorePersistenceState,
  });
}
