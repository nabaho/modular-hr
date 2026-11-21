/**
 * 멀티문서 무입력 자동 온보딩 & 건강보험·고용보험 교차 대사 엔진 (M0-AutoLink)
 * - 사업자등록증 · 회사 홍보자료 · 건강보험 직장가입자 내역 · 고용보험 취득/상실 내역을 일괄 분석한다.
 * - 주민등록번호·전화번호 등 민감 고유식별정보는 파싱 즉시 마스킹(비식별화)하며 원문을 메모리에 남기지 않는다.
 * - 대표자(사용자) 자동 제외, 건보↔고보 자격·보수월액 괴리 탐지, 상시근로자 역산, 재직/퇴사자 자동 분기를 수행한다.
 */

import crypto from './browser-crypto-shim.mjs?v=ded2c66c4e77';
import { INDUSTRIES, LAW_BASELINE } from './labor-rules.mjs?v=ded2c66c4e77';
import { addDaysISO, isValidIsoDate, provisionWorkplaceSystem } from './compliance-provisioner.mjs?v=ded2c66c4e77';
import { buildOffboardedWorkerRecord, mapEiLossCodeToResignReason } from './offboarding-registry.mjs?v=ded2c66c4e77';

const MAX_DOC_CHARS = 48_000;
const MAX_TABLE_ROWS = 400;
const MAX_UPLOAD_FILES = 10;
const MATCH_SALT = crypto.randomBytes(16).toString('hex');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * 입력 텍스트 크기 검증 및 고유식별정보(주민등록번호·휴대전화번호) 즉시 마스킹
 */
export function redactAndSanitizeDocText(rawInput, label = 'document') {
  if (rawInput === undefined || rawInput === null) return '';
  if (typeof rawInput !== 'string') {
    throw badRequest(`${label} 입력값은 문자열이어야 합니다.`);
  }
  if (rawInput.length > MAX_DOC_CHARS) {
    throw badRequest(`${label} 문서 크기가 허용 한도(${MAX_DOC_CHARS.toLocaleString('ko-KR')}자)를 초과했습니다.`);
  }
  return rawInput
    .replace(/\u0000/g, '')
    // 주민등록번호·외국인등록번호 패턴 즉시 비식별 마스킹 (사업자등록번호 3-2-5 형식과 충돌하지 않음)
    .replace(/\b(\d{6})[-\s]?[1-8]\d{6}\b/g, '$1-*******')
    // 휴대전화번호 패턴 즉시 마스킹
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '010-****-****');
}

function sanitizeCell(val) {
  let s = String(val ?? '').trim();
  // CSV 수식 주입(Formula Injection) 방어: 선행 =, +, @ 또는 비숫자 선행 - 제거
  if (/^[=+@]/.test(s) || (/^-[^0-9]/.test(s) && s.length > 1)) {
    s = s.replace(/^[=+@-]+/, '').trim();
  }
  return s;
}

function parseMoneyWon(raw, fallback = 0) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const cleaned = String(raw).replace(/[,\s원KRW]/gi, '');
  // "320만원" 같은 한글 단위 변환 지원
  const manMatch = cleaned.match(/^(\d+(?:\.\d+)?)만$/);
  if (manMatch) return Math.round(Number(manMatch[1]) * 10000);
  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
}

function parseNumericWithUnit(raw, fallback = 0) {
  if (raw === null || raw === undefined) return fallback;
  const s = String(raw).replace(/,/g, '').trim();
  if (!s) return fallback;
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)/);
  if (!m) return fallback;
  const num = Number(m[1]);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeIsoDateOrNull(raw) {
  if (!raw) return null;
  const s = String(raw)
    .trim()
    .replace(/[./]/g, '-')
    .replace(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?$/, '$1-$2-$3');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) {
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!compact) return null;
    const candidate = `${compact[1]}-${compact[2]}-${compact[3]}`;
    return isValidIsoDate(candidate) ? candidate : null;
  }
  const candidate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isValidIsoDate(candidate) ? candidate : null;
}

function maskBirthOrIdToken(raw) {
  const s = sanitizeCell(raw);
  if (!s) return '******-*';
  const sixMatch = s.match(/(\d{6})/);
  if (sixMatch) return `${sixMatch[1]}-*******`;
  return '******-*';
}

function buildPersonMatchKey(name, birthOrId, empCode) {
  const cleanName = String(name || '').replace(/\s+/g, '').toLowerCase();
  const sixDigits = String(birthOrId || '').match(/(\d{6})/)?.[1] || '';
  const basis = sixDigits ? `${cleanName}|${sixDigits}` : `${cleanName}|${String(empCode || '').toUpperCase()}`;
  return crypto.createHmac('sha256', MATCH_SALT).update(basis).digest('hex').slice(0, 16);
}

/**
 * CSV / TSV / 파이프(|) 표 범용 파서 (행 상한 검증 포함)
 */
export function parseDelimitedTable(rawText, label = 'table') {
  const safe = redactAndSanitizeDocText(rawText, label);
  const lines = safe
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !/^[-|:+\s]+$/.test(line));

  if (lines.length === 0) return [];
  if (lines.length - 1 > MAX_TABLE_ROWS) {
    throw badRequest(`${label} 행 수가 허용 상한(${MAX_TABLE_ROWS}행)을 초과했습니다.`);
  }

  const headerLine = lines[0].replace(/^\|/, '').replace(/\|$/, '');
  const delimiter = headerLine.includes('\t')
    ? '\t'
    : headerLine.includes('|')
      ? '|'
      : ',';

  const splitRow = (rowStr) => {
    const trimmed = delimiter === '|' ? rowStr.replace(/^\|/, '').replace(/\|$/, '') : rowStr;
    return trimmed.split(delimiter).map((cell) => sanitizeCell(cell));
  };

  const headers = splitRow(lines[0]).map((h) => h.replace(/\s+/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    if (cols.every((c) => c === '')) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cols[c] ?? '';
    }
    rows.push(obj);
  }
  return rows;
}

function pickField(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  for (const [k, v] of Object.entries(row)) {
    if (v !== '' && candidates.some((cand) => k.includes(cand))) {
      return v;
    }
  }
  return '';
}

/**
 * 업태·종목 텍스트로부터 표준산업분류(KSIC) 대분류 코드 자동 추론
 */
export function classifyKsicFromBizTerms(bizType = '', bizItem = '', fallbackText = '') {
  const combined = `${bizType} ${bizItem} ${fallbackText}`;
  if (/제조|금속|기계|정밀|반도체|전자부품|자동차부품|화학|식품가공|금형|사출/.test(combined)) {
    return { ksicMajor: 'C', reason: '사업자등록증 업태·종목에서 제조·가공 키워드 감지 → C(제조업)' };
  }
  if (/건설|토목|건축|설비공사|전기공사|인테리어공사/.test(combined)) {
    return { ksicMajor: 'F', reason: '사업자등록증 업태·종목에서 건설·공사 키워드 감지 → F(건설업)' };
  }
  if (/운수|물류|창고|화물|택배|운송/.test(combined)) {
    return { ksicMajor: 'H', reason: '사업자등록증 업태·종목에서 운수·물류 키워드 감지 → H(운수창고업)' };
  }
  if (/소프트웨어|정보통신|클라우드|데이터|인공지능|플랫폼|게임|앱개발|시스템통합|\bIT\b/i.test(combined)) {
    return { ksicMajor: 'J', reason: '사업자등록증 업태·종목에서 SW·정보통신 키워드 감지 → J(정보통신업)' };
  }
  if (/병원|의원|치과|한의원|요양|사회복지|보육|돌봄/.test(combined)) {
    return { ksicMajor: 'Q', reason: '사업자등록증 업태·종목에서 의료·사회복지 키워드 감지 → Q(보건·사회복지업)' };
  }
  if (/도매|소매|유통|전자상거래|무역|음식|카페|숙박/.test(combined)) {
    return { ksicMajor: 'G', reason: '사업자등록증 업태·종목에서 도소매·음식숙박 키워드 감지 → G(도소매·숙박음식업)' };
  }
  return { ksicMajor: 'C', reason: '기본 업종 매핑 적용 → C(제조업)' };
}

/**
 * 1. 사업자등록증 문서 파서 (비정형 텍스트 / 키-값 / OCR 추출문)
 */
export function parseBusinessRegistrationDoc(rawText = '') {
  const safe = redactAndSanitizeDocText(rawText, '사업자등록증');
  const extractKv = (regex) => {
    const m = safe.match(regex);
    return m ? sanitizeCell(m[1]) : '';
  };

  const companyName =
    extractKv(/(?:법인명(?:\(단체명\))?|상호(?:\(법인명\))?|사업장명)\s*[:：]\s*([^\r\n]+)/) ||
    '미상 사업장';
  const rawBizNo = extractKv(/(?:사업자\s*등록번호|등록번호)\s*[:：]\s*([0-9-]{10,12})/);
  const bizRegNo = /^\d{3}-\d{2}-\d{5}$/.test(rawBizNo)
    ? rawBizNo
    : rawBizNo.replace(/\D/g, '').replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3') || '000-00-00000';
  const ceoName = extractKv(/(?:대표자(?:\(성명\))?|성명\(대표자\))\s*[:：]\s*([^\r\n(]+)/) || '대표이사';
  const openDate =
    normalizeIsoDateOrNull(extractKv(/(?:개업\s*연월일|설립일)\s*[:：]\s*([^\r\n]+)/)) || '2020-01-01';
  const workplaceAddress =
    extractKv(/(?:사업장\s*소재지|본점\s*소재지|소재지)\s*[:：]\s*([^\r\n]+)/) || '-';
  const bizType = extractKv(/업\s*태\s*[:：]\s*([^\r\n/|]+)/);
  const bizItem = extractKv(/종\s*목\s*[:：]\s*([^\r\n]+)/);

  const { ksicMajor, reason: ksicReason } = classifyKsicFromBizTerms(bizType, bizItem, safe);

  return {
    companyName,
    bizRegNo,
    ceoName,
    openDate,
    workplaceAddress,
    bizType: bizType || INDUSTRIES[ksicMajor].name,
    bizItem: bizItem || '-',
    ksicMajor,
    ksicName: INDUSTRIES[ksicMajor].name,
    ksicReason,
  };
}

/**
 * 2. 회사 홍보자료 · 소개서 파서 (조직도, 복리후생 식대·수당, 장애인 고용, 파견·외주 현황 추출)
 */
export function parseCompanyBrochureDoc(rawText = '') {
  const safe = redactAndSanitizeDocText(rawText, '회사 홍보자료');
  const extractKv = (regex) => {
    const m = safe.match(regex);
    return m ? sanitizeCell(m[1]) : '';
  };

  const deptRaw = extractKv(/(?:주요\s*조직|부서\s*구성|조직도|본부·팀)\s*[:：]\s*([^\r\n]+)/);
  const departments = deptRaw
    ? deptRaw
        .split(/[,/·>|]/)
        .map((d) => sanitizeCell(d))
        .filter(Boolean)
        .slice(0, 16)
    : ['경영지원팀', '생산기술1팀', '품질보증팀'];

  const mealRaw = extractKv(/(?:식대|중식지원|식사지원)\s*[:：]?\s*([0-9,만]+\s*원?)/);
  const defaultMealAllowance = mealRaw ? parseMoneyWon(mealRaw, 200000) : 200000;

  const fixedAllowanceRaw = extractKv(/(?:고정직무수당|기술수당|직책수당)\s*[:：]?\s*([0-9,만]+\s*원?)/);
  const defaultFixedAllowance = fixedAllowanceRaw ? parseMoneyWon(fixedAllowanceRaw, 0) : 0;

  const hasMajorityUnion = /과반수\s*노동조합\s*[:：]?\s*(있음|유|보유|설립)/.test(safe);
  const dispatchedMatch = safe.match(/파견\s*(?:근로자|인력)?\s*[:：]?\s*(\d+)\s*명/);
  const biz33Match = safe.match(/(?:프리랜서|3\.3%|외주위탁)\s*[:：]?\s*(\d+)\s*명/);
  const disabledSevereMatch = safe.match(/중증\s*장애인\s*[:：]?\s*(\d+)\s*명/);
  const disabledMildMatch = safe.match(/경증\s*장애인\s*[:：]?\s*(\d+)\s*명/);
  const operatingDaysMatch = safe.match(/월\s*(?:평균\s*)?가동일수\s*[:：]?\s*(\d+)\s*일/);
  const workSchedule =
    extractKv(/(?:근무\s*형태|근무\s*제도)\s*[:：]\s*([^\r\n]+)/) || '주 5일 (주 40시간 표준근무)';

  const activeSubsidies = [];
  if (/청년일자리도약/.test(safe)) activeSubsidies.push('청년일자리도약장려금');
  if (/고용촉진장려금/.test(safe)) activeSubsidies.push('고용촉진장려금');
  if (/시니어인턴|고령자계속고용/.test(safe)) activeSubsidies.push('고령자계속고용장려금');
  if (activeSubsidies.length === 0) activeSubsidies.push('청년일자리도약장려금');

  return {
    departments,
    defaultMealAllowance,
    defaultFixedAllowance,
    hasMajorityUnion,
    dispatchedWorkers: dispatchedMatch ? Number(dispatchedMatch[1]) : 0,
    biz33Contractors: biz33Match ? Number(biz33Match[1]) : 0,
    disabledSevere: disabledSevereMatch ? Number(disabledSevereMatch[1]) : 0,
    disabledMild: disabledMildMatch ? Number(disabledMildMatch[1]) : 0,
    operatingDays: operatingDaysMatch ? Math.min(31, Math.max(1, Number(operatingDaysMatch[1]))) : 22,
    workSchedule,
    activeSubsidies,
  };
}

/**
 * 3. 건강보험 직장가입자 자격·보수월액 내역서 파서
 */
export function parseHealthInsuranceDoc(rawText = '') {
  const rows = parseDelimitedTable(rawText, '건강보험 내역서');
  return rows.map((row, idx) => {
    const name = pickField(row, ['성명', '이름', '가입자명']) || `가입자${idx + 1}`;
    const rawBirth = pickField(row, ['생년월일', '주민번호', '식별번호']);
    const empCode = pickField(row, ['사번', '사원번호', '증번호']) || `NHIS-${String(idx + 1).padStart(3, '0')}`;
    const subscriberTypeRaw = pickField(row, ['가입자구분', '직역', '구분']) || '근로자';
    const isEmployer = /대표|사용자|등기임원/.test(subscriberTypeRaw);
    const acquireDate = normalizeIsoDateOrNull(pickField(row, ['취득일', '자격취득일', '입사일'])) || '2025-01-01';
    const lossDate = normalizeIsoDateOrNull(pickField(row, ['상실일', '자격상실일', '퇴사일']));
    const monthlyRemuneration = parseMoneyWon(
      pickField(row, ['보수월액', '월보수액', '신고보수월액']),
      3000000
    );
    const deptName = pickField(row, ['부서', '부서명', '소속']) || '';
    const leaveStatus = pickField(row, ['납부예외', '휴직상태', '비고']) || '';

    return {
      matchKey: buildPersonMatchKey(name, rawBirth, empCode),
      empCode,
      displayName: name,
      maskedBirthOrId: maskBirthOrIdToken(rawBirth),
      isEmployer,
      subscriberType: isEmployer ? 'EMPLOYER' : 'WORKER',
      acquireDate,
      lossDate,
      monthlyRemuneration,
      deptName,
      leaveStatus,
    };
  });
}

/**
 * 4. 고용보험 피보험자격 취득·상실 내역서 파서
 */
export function parseEmploymentInsuranceDoc(rawText = '') {
  const rows = parseDelimitedTable(rawText, '고용보험 내역서');
  return rows.map((row, idx) => {
    const name = pickField(row, ['성명', '이름', '피보험자명']) || `피보험자${idx + 1}`;
    const rawBirth = pickField(row, ['생년월일', '주민번호', '식별번호']);
    const empCode = pickField(row, ['사번', '사원번호']) || `EI-${String(idx + 1).padStart(3, '0')}`;
    const empTypeRaw = pickField(row, ['고용형태', '근로형태', '직종구분']) || '상용';
    const employmentType = /일용/.test(empTypeRaw)
      ? 'DAILY'
      : /단시간|파트|시간제/.test(empTypeRaw)
        ? 'PART_TIME'
        : 'REGULAR';
    const weeklyHoursRaw = parseNumericWithUnit(
      pickField(row, ['주소정근로시간', '주근로시간', '소정근로시간']),
      NaN
    );
    const weeklyHours =
      Number.isFinite(weeklyHoursRaw) && weeklyHoursRaw > 0
        ? weeklyHoursRaw
        : employmentType === 'PART_TIME'
          ? 20
          : 40;
    const acquireDate =
      normalizeIsoDateOrNull(pickField(row, ['취득일', '피보험자격취득일', '입사일'])) || '2025-01-01';
    const lossDate = normalizeIsoDateOrNull(pickField(row, ['상실일', '피보험자격상실일']));
    const eiLossCode = pickField(row, ['상실사유코드', '상실코드', '이직사유코드', '상실사유']) || '';
    const avgMonthlyPay = parseMoneyWon(
      pickField(row, ['월평균보수', '보수월액', '월보수']),
      3000000
    );
    const deptName = pickField(row, ['부서', '부서명', '소속']) || '';
    const jobTitle = pickField(row, ['직위', '직급', '직무']) || '사원';
    const unusedLeaveDays = Math.max(
      0,
      parseNumericWithUnit(pickField(row, ['미사용연차', '잔여연차']), 0)
    );
    const workDaysInMonth = Math.max(
      1,
      parseNumericWithUnit(pickField(row, ['월근무일수', '출근일수']), 10)
    );

    return {
      matchKey: buildPersonMatchKey(name, rawBirth, empCode),
      empCode,
      displayName: name,
      maskedBirthOrId: maskBirthOrIdToken(rawBirth),
      employmentType,
      weeklyHours,
      acquireDate,
      lossDate,
      eiLossCode,
      avgMonthlyPay,
      deptName,
      jobTitle,
      unusedLeaveDays,
      workDaysInMonth,
    };
  });
}

/**
 * 업로드 파일 배열(`files: [{ fileName, content }]`) 자동 문서 분류기
 */
export function classifyUploadedFilesIntoDocs(files = []) {
  if (!Array.isArray(files)) {
    throw badRequest('files 항목은 배열이어야 합니다.');
  }
  if (files.length > MAX_UPLOAD_FILES) {
    throw badRequest(`동시 업로드 파일 수는 최대 ${MAX_UPLOAD_FILES}개까지 허용됩니다.`);
  }

  const bucket = {
    businessRegistrationText: '',
    companyBrochureText: '',
    healthInsuranceText: '',
    employmentInsuranceText: '',
    classifiedFiles: [],
  };

  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    const fileName = sanitizeCell(f.fileName || 'uploaded.txt').slice(0, 120);
    const content = redactAndSanitizeDocText(f.content || '', fileName);
    const probe = `${fileName} ${content.slice(0, 600)}`;

    let docKind = 'COMPANY_BROCHURE';
    if (/사업자\s*등록|등록번호.*업\s*태|개업\s*연월일/.test(probe)) {
      docKind = 'BUSINESS_REGISTRATION';
      bucket.businessRegistrationText = content;
    } else if (/고용보험|피보험자|상실사유코드|주소정근로시간/.test(probe)) {
      docKind = 'EMPLOYMENT_INSURANCE';
      bucket.employmentInsuranceText = content;
    } else if (/건강보험|직장가입자|가입자구분|보수월액/.test(probe)) {
      docKind = 'HEALTH_INSURANCE';
      bucket.healthInsuranceText = content;
    } else {
      docKind = 'COMPANY_BROCHURE';
      bucket.companyBrochureText = content;
    }
    bucket.classifiedFiles.push({ fileName, docKind, charLength: content.length });
  }

  return bucket;
}

/**
 * 4종 문서 통합 대사·교차검증 및 사업장·재직자·퇴사자 스테이징 빌더
 */
export function stageMultiDocumentBundle(payload = {}, options = {}) {
  const tombstoneStore = options.tombstoneStore || null;
  const referenceDate = normalizeIsoDateOrNull(payload.referenceDate) || '2026-11-15';
  const fromFiles = Array.isArray(payload.files) && payload.files.length > 0
    ? classifyUploadedFilesIntoDocs(payload.files)
    : null;

  const bizText =
    payload.businessRegistrationText ?? fromFiles?.businessRegistrationText ?? '';
  const brochureText =
    payload.companyBrochureText ?? fromFiles?.companyBrochureText ?? '';
  const nhisText =
    payload.healthInsuranceText ?? fromFiles?.healthInsuranceText ?? '';
  const eiText =
    payload.employmentInsuranceText ?? fromFiles?.employmentInsuranceText ?? '';

  if (!bizText.trim() && !nhisText.trim() && !eiText.trim()) {
    throw badRequest(
      '최소 1개 이상의 핵심 문서(사업자등록증, 건강보험 내역서 또는 고용보험 내역서)를 입력해 주세요.'
    );
  }

  const bizInfo = parseBusinessRegistrationDoc(bizText);
  const brochureInfo = parseCompanyBrochureDoc(brochureText);
  const nhisRows = nhisText.trim() ? parseHealthInsuranceDoc(nhisText) : [];
  const eiRows = eiText.trim() ? parseEmploymentInsuranceDoc(eiText) : [];

  const nhisByKey = new Map();
  for (const r of nhisRows) nhisByKey.set(r.matchKey, r);
  const eiByKey = new Map();
  for (const r of eiRows) eiByKey.set(r.matchKey, r);

  const allKeys = new Set([...nhisByKey.keys(), ...eiByKey.keys()]);
  const reconciliationAlerts = [];
  const excludedEmployers = [];
  const activeWorkers = [];
  const offboardedDrafts = [];

  let regularWorkersCount = 0;
  let partTimeWorkersCount = 0;
  let dailyWorkerManDays = 0;
  let seqIndex = 1;

  for (const key of allKeys) {
    const nhis = nhisByKey.get(key) || null;
    const ei = eiByKey.get(key) || null;

    // 1) 건강보험 사용자(대표자) 자동 분리 (근로기준법 상시근로자 제외!)
    if (nhis?.isEmployer) {
      excludedEmployers.push({
        displayName: nhis.displayName,
        maskedBirthOrId: nhis.maskedBirthOrId,
        reason: '건강보험 직장가입 사용자(대표자) · 고용보험 비대상 → 상시근로자 산정 자동 제외',
      });
      reconciliationAlerts.push({
        level: 'INFO',
        code: 'EMPLOYER_AUTO_EXCLUDED',
        personName: nhis.displayName,
        message: `${nhis.displayName}: 건강보험 직장가입자 중 '사용자(대표자)'로 판별되어 근로기준법 상시근로자 수 및 고용보험 대상에서 자동 분리했습니다.`,
      });
      continue;
    }

    const displayName = ei?.displayName || nhis?.displayName || `인원${seqIndex}`;
    const maskedBirthOrId = ei?.maskedBirthOrId || nhis?.maskedBirthOrId || '******-*';
    const rawCode = ei?.empCode || nhis?.empCode || '';
    const empCode = /^EMP-\d+/i.test(rawCode)
      ? rawCode.toUpperCase()
      : `EMP-${String(200 + seqIndex).padStart(3, '0')}`;
    seqIndex += 1;

    const deptFallback =
      brochureInfo.departments[(seqIndex - 2) % brochureInfo.departments.length] || '일반부서';
    const deptName = ei?.deptName || nhis?.deptName || deptFallback;
    const jobTitle = ei?.jobTitle || '사원';
    const acquireDate = ei?.acquireDate || nhis?.acquireDate || '2025-01-01';
    const lossDate = ei?.lossDate || nhis?.lossDate || null;
    const candidateLastWorkDate = lossDate
      ? addDaysISO(lossDate, -1) >= acquireDate
        ? addDaysISO(lossDate, -1)
        : lossDate
      : null;

    // 1-b) 이미 비식별 파기되어 툼스톤에 등록된 인원은 기준일(과거 기준일 포함)이나 재직/퇴직 분류와 무관하게 프리뷰·경고·명부 전체에서 원천 배제!
    if (
      tombstoneStore &&
      (tombstoneStore.isEmpCodePurged(bizInfo.bizRegNo, empCode) ||
        tombstoneStore.isRecordPurged({
          bizRegNo: bizInfo.bizRegNo,
          empCode,
          displayName,
          maskedBirthOrId,
          hireDate: acquireDate,
          lastWorkDate: candidateLastWorkDate,
        }))
    ) {
      continue;
    }

    // 2) 건보 ↔ 고보 자격 교차검증
    if (nhis && !ei) {
      reconciliationAlerts.push({
        level: 'WARN',
        code: 'NHIS_ONLY_NO_EI',
        personName: displayName,
        message: `${displayName}(${empCode}): 건강보험 직장가입 내역은 있으나 고용보험 취득내역이 없습니다. 고용보험 피보험자격 취득신고 누락 여부를 확인하세요.`,
      });
    } else if (!nhis && ei) {
      if (ei.employmentType === 'DAILY' || ei.weeklyHours < 15) {
        reconciliationAlerts.push({
          level: 'INFO',
          code: 'EI_SHORT_OR_DAILY_EXEMPT_NHIS',
          personName: displayName,
          message: `${displayName}(${empCode}): ${ei.employmentType === 'DAILY' ? '일용근로자' : `초단시간(주 ${ei.weeklyHours}h)`}로 건강보험 직장가입 제외 대상임을 자동 확인했습니다.`,
        });
      } else {
        reconciliationAlerts.push({
          level: 'WARN',
          code: 'EI_ONLY_NO_NHIS',
          personName: displayName,
          message: `${displayName}(${empCode}): 상용(주 ${ei.weeklyHours}h) 고용보험 가입자이나 건강보험 내역이 누락되어 있습니다.`,
        });
      }
    } else if (nhis && ei && !lossDate) {
      const gapRatio =
        Math.abs(nhis.monthlyRemuneration - ei.avgMonthlyPay) /
        Math.max(1, nhis.monthlyRemuneration);
      if (gapRatio >= 0.1) {
        reconciliationAlerts.push({
          level: 'WARN',
          code: 'COMPENSATION_GAP',
          personName: displayName,
          message: `${displayName}(${empCode}): 건강보험 보수월액(${nhis.monthlyRemuneration.toLocaleString('ko-KR')}원)과 고용보험 월평균보수(${ei.avgMonthlyPay.toLocaleString('ko-KR')}원)가 ${Math.round(gapRatio * 100)}% 차이납니다.`,
        });
      }
    }

    // 3) 상실일(lossDate)이 기준일 이하이면 -> 퇴사자 통합 원장(M9)으로 자동 편입!
    if (lossDate && lossDate <= addDaysISO(referenceDate, 1)) {
      // 실무상 상실일은 퇴사일(마지막 근무일)의 다음 날이므로 퇴사일 역산(입사일보다 앞설 경우 상실일 그대로 사용)
      const inferredLastWork = addDaysISO(lossDate, -1);
      const lastWorkDate = inferredLastWork >= acquireDate ? inferredLastWork : lossDate;
      const monthlyRem = ei?.avgMonthlyPay || nhis?.monthlyRemuneration || 3000000;
      const mealAllowance = Math.min(LAW_BASELINE.nonTaxableMealLimit, brochureInfo.defaultMealAllowance);

      offboardedDrafts.push({
        bizRegNo: bizInfo.bizRegNo,
        empCode,
        displayName,
        deptName,
        jobTitle,
        maskedBirthOrId,
        hireDate: acquireDate,
        lastWorkDate,
        lossDateReported: lossDate,
        resignReason: mapEiLossCodeToResignReason(ei?.eiLossCode || '11'),
        eiLossCode: ei?.eiLossCode || '11',
        weeklyContractHours: ei?.weeklyHours || 40,
        baseMonthlyPay: Math.max(2156880, monthlyRem),
        mealAllowance,
        unusedLeaveDays: ei?.unusedLeaveDays || 0,
        settlementStatus: lossDate < addDaysISO(referenceDate, -20) ? 'PAID' : 'PENDING',
        nhisLossFilingStatus: nhis?.lossDate ? 'FILED' : 'PENDING',
        eiLossAndCertStatus: ei?.lossDate ? 'FILED' : 'PENDING',
        ingestionSource: 'INSURANCE_LOSS_LEDGER',
      });
      continue;
    }

    // 4) 재직 근로자 -> 상시근로자 구분 집계 + M8 급여 원장 자동 구성
    const empType = ei?.employmentType || 'REGULAR';
    const weeklyHours = ei?.weeklyHours || 40;
    const taxableMonthlyRem = ei?.avgMonthlyPay || nhis?.monthlyRemuneration || 3000000;

    if (empType === 'DAILY') {
      dailyWorkerManDays += ei?.workDaysInMonth || 10;
      continue;
    }

    if (empType === 'PART_TIME' || weeklyHours < 40) {
      partTimeWorkersCount += 1;
    } else {
      regularWorkersCount += 1;
    }

    const mealAllowance = brochureInfo.defaultMealAllowance;
    const fixedAllowance = brochureInfo.defaultFixedAllowance;
    // 건보·고보 보수월액은 비과세 식대(20만 원 한도)를 제외한 과세 보수 기준이므로 기본급을 정확히 역산!
    const taxableMealExcess = Math.max(0, mealAllowance - LAW_BASELINE.nonTaxableMealLimit);
    const derivedBasePay = Math.max(
      Math.ceil((weeklyHours === 40 ? 209 : weeklyHours * 4.345) * LAW_BASELINE.minimumHourlyWage),
      taxableMonthlyRem - fixedAllowance - taxableMealExcess
    );

    activeWorkers.push({
      empCode,
      displayName,
      deptName,
      jobTitle,
      maskedBirthOrId,
      hireDate: acquireDate,
      workerCategory: 'REGULAR',
      weeklyHours,
      dailyHours: Math.min(8, Math.max(1, weeklyHours / 5)),
      baseMonthlyPay: derivedBasePay,
      fixedOrdinaryAllowance: fixedAllowance,
      mealAllowance,
      overtimeHours: 0,
      nightHours: 0,
      holidayLe8Hours: 0,
      holidayGt8Hours: 0,
      maxWeeklyWorkedHours: weeklyHours,
      unpaidLeaveDays: nhis?.leaveStatus ? 5 : 0,
      suspensionDays: 0,
      unusedLeavePayoutDays: 0,
      evalRaiseRatePct: 0,
      evalBonusPay: 0,
      requestedDisciplinaryCut: 0,
      attendanceNoticeSent: true,
      defenseOpportunityGiven: true,
      committeeResolved: true,
      writtenNoticeDelivered: true,
      dependents: 1,
    });
  }

  const headcountInput = {
    operatingDays: brochureInfo.operatingDays,
    regularWorkers: regularWorkersCount,
    partTimeWorkers: partTimeWorkersCount,
    dailyWorkerManDays,
    dispatchedWorkers: brochureInfo.dispatchedWorkers,
    biz33Contractors: brochureInfo.biz33Contractors,
    disabledMild: brochureInfo.disabledMild,
    disabledSevere: brochureInfo.disabledSevere,
  };

  const stagedCompany = {
    id: 'INGESTED_CUSTOM',
    badge: `문서자동연결 (${bizInfo.ksicMajor} · 재직 ${activeWorkers.length}명)`,
    companyName: bizInfo.companyName,
    bizRegNo: bizInfo.bizRegNo,
    ceoName: bizInfo.ceoName,
    openDate: bizInfo.openDate,
    workplaceAddress: bizInfo.workplaceAddress,
    ksicMajor: bizInfo.ksicMajor,
    referenceDate,
    triggerDate: addDaysISO(referenceDate, -4),
    historicalPeakHeadcount: regularWorkersCount + partTimeWorkersCount + offboardedDrafts.length,
    hasMajorityUnion: brochureInfo.hasMajorityUnion,
    activeSubsidies: brochureInfo.activeSubsidies,
    departments: brochureInfo.departments,
    workSchedule: brochureInfo.workSchedule,
    headcountInput,
  };

  const compliancePreview = provisionWorkplaceSystem({
    ...stagedCompany,
    completedTaskIds: [],
  });

  const offboardedWorkers = offboardedDrafts.map((draft) =>
    buildOffboardedWorkerRecord(draft, {
      referenceDate,
      bizRegNo: bizInfo.bizRegNo,
      lsaRegularCount: compliancePreview.headcounts.exactLsaRatio,
      activeSubsidies: brochureInfo.activeSubsidies,
    })
  );

  for (const off of offboardedWorkers) {
    if (off.subsidyClawbackRisk) {
      reconciliationAlerts.push({
        level: 'CRITICAL',
        code: 'INGESTED_SUBSIDY_RISK',
        personName: off.displayName,
        message: `퇴사자 ${off.displayName}(${off.empCode})의 고용보험 상실사유가 '${off.resignReasonLabel}'로 확인되어 [${brochureInfo.activeSubsidies.join(', ')}] 감원방지 경보가 자동 발동되었습니다.`,
      });
    }
  }

  return {
    stagedAt: referenceDate,
    classifiedFiles: fromFiles?.classifiedFiles || [],
    extractedProfile: {
      ...bizInfo,
      departments: brochureInfo.departments,
      defaultMealAllowance: brochureInfo.defaultMealAllowance,
      workSchedule: brochureInfo.workSchedule,
      hasMajorityUnion: brochureInfo.hasMajorityUnion,
      activeSubsidies: brochureInfo.activeSubsidies,
    },
    stagedCompany,
    excludedEmployers,
    activeWorkers,
    offboardedWorkers,
    reconciliationAlerts,
    compliancePreview: {
      headcounts: compliancePreview.headcounts,
      autoActivatedModules: (compliancePreview.floorPlan || [])
        .filter((m) => m.status === 'AUTO_PROVISIONED')
        .map((m) => ({ id: m.id, code: m.code, title: m.title, statusLabel: m.statusLabel, reason: m.reason })),
      statutoryTasksCount: compliancePreview.statutoryFilings.length,
      statutoryTasks: compliancePreview.statutoryFilings,
    },
  };
}

/**
 * 샘플 번들 생성을 위한 현실적인 건강보험·고용보험 CSV 빌더 (실명 개인정보 0건 · 합성 마스킹 데이터)
 */
function buildManufacturing58BundleDocs() {
  const businessRegistrationText = [
    '[사업자등록증 (법인사업자)]',
    '법인명(단체명): 주식회사 한빛정밀메카트로닉스',
    '사업자등록번호: 214-86-00941',
    '대표자(성명): 강대표',
    '개업연월일: 2018-04-02',
    '사업장 소재지: 경기도 화성시 첨단산업단지로 142 (가상산업단지)',
    '업태: 제조업',
    '종목: 정밀기계부품 · 반도체장비 모듈 가공',
  ].join('\n');

  const companyBrochureText = [
    '[회사 홍보자료 및 인사복리 개요서 - (주)한빛정밀메카트로닉스]',
    '주요 조직: 생산기술1팀, 정밀가공2팀, 품질보증팀, 기업부설연구소, 경영지원팀',
    '근무 형태: 주 5일 (주 40시간 표준근무, 생산라인 선택적 연장근무)',
    '식대: 200,000원 (전 직원 비과세 중식지원)',
    '고정직무수당: 150,000원',
    '월 평균 가동일수: 22일',
    '파견근로자: 4명 (현장 물류·포장 지원)',
    '프리랜서: 2명 (외주 CAD 설계 3.3%)',
    '중증장애인: 1명, 경증장애인: 1명',
    '과반수 노동조합: 없음 (노사협의회 근로자위원 직접 선출 대상)',
    '수혜 중인 정부지원금: 청년일자리도약장려금, 고용촉진장려금',
  ].join('\n');

  const nhisHeader = '사번,성명,생년월일,가입자구분,부서,취득일,상실일,보수월액,비고';
  const eiHeader = '사번,성명,생년월일,고용형태,주소정근로시간,부서,직위,취득일,상실일,상실사유코드,월평균보수,미사용연차';

  const nhisLines = [
    nhisHeader,
    // 대표자 (건강보험 직장가입 사용자 -> 상시근로자 자동 제외 검증용)
    'CEO-001,강대표,710512-*******,대표자(사용자),임원실,2018-04-02,,8500000,대표이사',
    // 핵심 재직 근로자 (모바일 앱 근로자 계정 EMP-201 김하늘 포함!)
    'EMP-201,김하늘,940315-*******,근로자,생산기술1팀,2022-03-02,,3350000,',
    'EMP-202,박준호,891104-*******,근로자,생산기술1팀,2020-07-01,,3950000,',
    'EMP-203,이지안,970822-*******,근로자,품질보증팀,2023-05-15,,3100000,보수월액차이점검',
    'EMP-204,최민석,910219-*******,근로자,기업부설연구소,2021-09-01,,4400000,',
    'EMP-205,한소희,960630-*******,근로자,경영지원팀,2024-01-02,,2950000,고용보험누락점검',
  ];

  const eiLines = [
    eiHeader,
    'EMP-201,김하늘,940315-*******,상용,40,생산기술1팀,선임기사,2022-03-02,,,3350000,0',
    'EMP-202,박준호,891104-*******,상용,40,생산기술1팀,팀장,2020-07-01,,,3950000,0',
    // 보수월액 15% 차이 발생 케이스 (3,100,000 vs 3,600,000) -> 교차검증 경보!
    'EMP-203,이지안,970822-*******,상용,40,품질보증팀,주임,2023-05-15,,,3600000,0',
    'EMP-204,최민석,910219-*******,상용,40,기업부설연구소,책임연구원,2021-09-01,,,4400000,0',
    // EMP-205 한소희는 고용보험 내역 의도적 누락 -> NHIS_ONLY_NO_EI 경보 검증!
  ];

  const depts = ['생산기술1팀', '정밀가공2팀', '품질보증팀', '기업부설연구소', '경영지원팀'];
  // 추가 상용 재직자 49명 생성 (총 상용 54명 + 단시간 2명 + 일용 연인원 22일[1인 환산] = 상시 57명, 파견 4명 포함 산안법 61명!)
  for (let i = 6; i <= 54; i++) {
    const code = `EMP-${200 + i}`;
    const name = `현장사원${String(i).padStart(2, '0')}`;
    const birth = `${String(80 + (i % 20)).padStart(2, '0')}0${(i % 9) + 1}15-*******`;
    const dept = depts[i % depts.length];
    const rem = 2850000 + (i % 6) * 150000;
    nhisLines.push(`${code},${name},${birth},근로자,${dept},2023-03-02,,${rem},`);
    eiLines.push(`${code},${name},${birth},상용,40,${dept},사원,2023-03-02,,,${rem},0`);
  }

  // 단시간 근로자 2명 (주 20시간)
  nhisLines.push('EMP-255,오세린,990410-*******,근로자,경영지원팀,2025-02-01,,1650000,단시간');
  eiLines.push('EMP-255,오세린,990410-*******,단시간,20,경영지원팀,사무원,2025-02-01,,,1650000,0');
  nhisLines.push('EMP-256,장도윤,981203-*******,근로자,품질보증팀,2025-04-01,,1650000,단시간');
  eiLines.push('EMP-256,장도윤,981203-*******,단시간,20,품질보증팀,검사원,2025-04-01,,,1650000,0');

  // 일용근로자 2명 (고용보험 일용근로내역만 존재 -> 건강보험 적용제외 정상 판별 + 연인원 22일 산입)
  eiLines.push('DLY-01,문성호,840711-*******,일용,40,정밀가공2팀,일용보조,2026-11-01,,,2200000,0');
  eiLines.push('DLY-02,배진우,860925-*******,일용,40,정밀가공2팀,일용보조,2026-11-01,,,2200000,0');

  // 상실(퇴사) 인원 3명 -> 퇴사자 통합 원장(M9) 자동 편입 검증!
  // 1) 최근 권고사직(코드 26) -> 14일 금품청산 진행중 + 지원금 감원방지 CRITICAL 경보!
  nhisLines.push('EMP-191,정태윤,880412-*******,근로자,정밀가공2팀,2022-05-01,2026-11-08,3550000,상실완료');
  eiLines.push('EMP-191,정태윤,880412-*******,상용,40,정밀가공2팀,선임기사,2022-05-01,2026-11-08,26,3550000,5');
  // 2) 최근 자진퇴사(코드 11) -> 고보 상실신고 미완료 상태 시뮬레이션(건보만 상실일 기재)
  nhisLines.push('EMP-192,백서하,950921-*******,근로자,품질보증팀,2024-06-01,2026-11-10,3050000,건보상실');
  eiLines.push('EMP-192,백서하,950921-*******,상용,40,품질보증팀,주임,2024-06-01,2026-11-10,11,3050000,3');
  // 3) 3년 경과 퇴사자(2023-09-01 상실) -> 개인정보보호법 제21조 비식별 파기 대상 자동 분류!
  nhisLines.push('EMP-105,노기범,830210-*******,근로자,생산기술1팀,2019-03-01,2023-09-01,3400000,보존만료');
  eiLines.push('EMP-105,노기범,830210-*******,상용,40,생산기술1팀,기장,2019-03-01,2023-09-01,32,3400000,0');

  return {
    bundleId: 'BUNDLE_MFG_58',
    title: '(주)한빛정밀메카트로닉스 — 제조업 57인 문서 4종 세트 (안전보건 14일·노사협의회 15일·퇴사자 3명 자동연결)',
    businessRegistrationText,
    companyBrochureText,
    healthInsuranceText: nhisLines.join('\n'),
    employmentInsuranceText: eiLines.join('\n'),
  };
}

function buildIt34BundleDocs() {
  const businessRegistrationText = [
    '[사업자등록증 (법인사업자)]',
    '법인명(단체명): 주식회사 클라우드나인소프트',
    '사업자등록번호: 120-88-00419',
    '대표자(성명): 송대표',
    '개업연월일: 2021-02-15',
    '사업장 소재지: 서울특별시 성동구 성수이로 88 (가상테크밸리)',
    '업태: 정보통신업',
    '종목: 클라우드 SaaS 소프트웨어 개발 및 인공지능 플랫폼 공급',
  ].join('\n');

  const companyBrochureText = [
    '[기업 소개 및 채용 브로슈어 - (주)클라우드나인소프트]',
    '주요 조직: 플랫폼개발팀, AI엔지니어링팀, 프로덕트디자인팀, 피플앤컬처팀, 생산기술1팀',
    '근무 형태: 주 5일 자율출퇴근제 (주 40시간)',
    '식대: 200,000원',
    '고정직무수당: 100,000원',
    '월 평균 가동일수: 20일',
    '프리랜서: 3명 (외주 UI 일러스트 3.3%)',
    '과반수 노동조합: 없음',
    '수혜 중인 정부지원금: 청년일자리도약장려금',
  ].join('\n');

  const nhisLines = [
    '사번,성명,생년월일,가입자구분,부서,취득일,상실일,보수월액,비고',
    'CEO-001,송대표,820914-*******,대표자(사용자),임원실,2021-02-15,,9000000,대표이사',
    'EMP-201,김하늘,940315-*******,근로자,생산기술1팀,2022-05-01,,4200000,',
  ];
  const eiLines = [
    '사번,성명,생년월일,고용형태,주소정근로시간,부서,직위,취득일,상실일,상실사유코드,월평균보수,미사용연차',
    'EMP-201,김하늘,940315-*******,상용,40,생산기술1팀,시니어엔지니어,2022-05-01,,,4200000,0',
  ];

  const depts = ['플랫폼개발팀', 'AI엔지니어링팀', '프로덕트디자인팀', '피플앤컬처팀'];
  for (let i = 2; i <= 34; i++) {
    const code = `EMP-${200 + i}`;
    const name = `개발자${String(i).padStart(2, '0')}`;
    const birth = `${String(88 + (i % 11)).padStart(2, '0')}0${(i % 9) + 1}20-*******`;
    const dept = depts[i % depts.length];
    const rem = 3800000 + (i % 5) * 250000;
    nhisLines.push(`${code},${name},${birth},근로자,${dept},2023-06-01,,${rem},`);
    eiLines.push(`${code},${name},${birth},상용,40,${dept},매니저,2023-06-01,,,${rem},0`);
  }

  nhisLines.push('EMP-181,유하람,930707-*******,근로자,플랫폼개발팀,2021-08-01,2026-11-05,4500000,자진퇴사');
  eiLines.push('EMP-181,유하람,930707-*******,상용,40,플랫폼개발팀,리드개발자,2021-08-01,2026-11-05,11,4500000,6');

  return {
    bundleId: 'BUNDLE_IT_34',
    title: '(주)클라우드나인소프트 — IT·SW 34인 문서 4종 세트 (30인+ 노사협의회 자동발동 · 안전관리자 제외 · 퇴사자 1명)',
    businessRegistrationText,
    companyBrochureText,
    healthInsuranceText: nhisLines.join('\n'),
    employmentInsuranceText: eiLines.join('\n'),
  };
}

export const SAMPLE_INGESTION_BUNDLES = Object.freeze({
  BUNDLE_MFG_58: Object.freeze(buildManufacturing58BundleDocs()),
  BUNDLE_IT_34: Object.freeze(buildIt34BundleDocs()),
});

export function listSampleIngestionBundles() {
  return Object.values(SAMPLE_INGESTION_BUNDLES);
}
