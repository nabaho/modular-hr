/**
 * 법정 근로자명부(근로기준법 제41조·제42조, 시행령 제20~22조, 시행규칙 제16조 별지 제16호 서식) 전수 관리 및
 * 신분증 사진 · 근로계약서 · 통장사본 · 개인정보 서류 → 통합 인사증빙 PDF 자동 병합·추출·정리 엔진
 *
 * 핵심 법적 가드레일:
 * 1) 근로기준법 시행령 제20조 법정 필수 기재사항(성명·성별·생년월일·주소·이력·종사업무·고용/갱신/계약기간·퇴직사유·기타 고용사항) 전수 점검
 * 2) 근로기준법 제41조 제2항 변경사항 지체 없는 정정이력(registryChangeLogs) 자동 기록 및 제42조 퇴직 후 3년 보존 가드레일
 * 3) 근로기준법 시행령 제21조 사용기간 30일 미만 일용근로자 예외 판정 및 3.3% 사업소득자(비근로자) 명부 분리 관리
 * 4) 개인정보보호법 제24조의2 주민등록번호·외국인등록번호·운전면허번호 뒷자리 즉시 비식별 파기(생년월일·성별 추론 직후 원문 폐기)
 * 5) 채용절차법 제4조의3 직무 무관 개인정보(출신지역·혼인여부·재산·신체조건·직계존비속 직업/학력) 자동 탐지 및 명부 편입 차단
 */

import crypto from './browser-crypto-shim.mjs?v=8f0f4f241d19';
import { addDaysISO, isValidIsoDate } from './compliance-provisioner.mjs?v=8f0f4f241d19';
import { computeMonthlyRefHours } from './lifecycle-payroll.mjs?v=8f0f4f241d19';
import { LAW_BASELINE } from './labor-rules.mjs?v=8f0f4f241d19';

const MAX_DOSSIER_TEXT_CHARS = 48_000;
const MAX_PDF_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_PDF_STREAMS = 40;
const MAX_DECOMPRESSED_STREAM_BYTES = 256 * 1024;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function conflictError(message) {
  const err = new Error(message);
  err.statusCode = 409;
  return err;
}

function sha256HexBytes(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function utcTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 근로기준법 제41조 · 시행령 제20~22조 · 개인정보보호법 · 채용절차법 법적 필수 점검표 카탈로그
 */
export const STATUTORY_ROSTER_LEGAL_CHECKLIST = Object.freeze([
  {
    id: 'ROSTER_LAW_01_MANDATORY_9',
    clause: '근로기준법 제41조① · 시행령 제20조(제1~9호) · 시행규칙 제16조(별지 제16호)',
    title: '법정 필수 기재사항 9호(성명·성별·생년월일·주소·이력·종사업무·고용/계약기간·퇴직사유·기타)',
    requirement: '각 사업장별로 작성·비치 필수 (전자문서 보존 인정). 미작성·허위기재 시 제116조②제2호 500만 원 이하 과태료.',
  },
  {
    id: 'ROSTER_LAW_02_PROMPT_CORRECTION',
    clause: '근로기준법 제41조 제2항',
    title: '기재사항 변경 시 지체 없는 정정 의무 (부서이동·승진·계약갱신·주소/임금 변경)',
    requirement: '인사발령·근로조건 변경·서류 재업로드 시 변경일자와 정정 전·후 내역을 지체 없이 갱신·보존해야 함.',
  },
  {
    id: 'ROSTER_LAW_03_RETENTION_3Y',
    clause: '근로기준법 제42조 · 시행령 제22조 제2항 제1호',
    title: '해고·퇴직·사망한 날로부터 3년간 근로자명부 및 중요 계약서류 보존',
    requirement: '퇴직 즉시 삭제 금지(3년 보존 의무) 및 3년 경과 후 개인정보보호법 제21조에 따라 지체 없이 비식별 파기.',
  },
  {
    id: 'ROSTER_LAW_04_DAILY_30D_RULE',
    clause: '근로기준법 제41조① 단서 · 시행령 제21조',
    title: '사용기간 30일 미만 일용근로자 작성 예외 / 30일 이상 계속 사용 시 필수 전환',
    requirement: '일용직이라도 사용기간이 30일 이상이 되면 법정 근로자명부 작성 의무가 즉시 발생함.',
  },
  {
    id: 'ROSTER_LAW_05_CONTRACTOR_SEPARATION',
    clause: '근로기준법 제2조 · 소득세법 제127조 (3.3% 사업소득 위탁 분리)',
    title: '3.3% 프리랜서·외주 위탁계약자의 법정 근로자명부 혼재 금지 (별도 위탁원장 분리)',
    requirement: '비근로자를 근로자명부에 혼재 편철할 경우 출퇴근·지휘감독과 결합되어 위장도급·근로자성 인정 근거가 될 수 있음.',
  },
  {
    id: 'ROSTER_LAW_06_FIXED_TERM_2Y',
    clause: '기간제 및 단시간근로자 보호 등에 관한 법률 제4조 · 제17조',
    title: '기간제 계약기간·갱신일 명시 및 2년 초과 사용 시 무기계약직 간주 점검',
    requirement: '계약만료일 및 갱신일을 명부에 기재하고 총 사용기간 2년 도래 전 갱신·무기전환 여부를 사전 점검해야 함.',
  },
  {
    id: 'ROSTER_LAW_07_PRIVACY_RRN',
    clause: '개인정보보호법 제24조의2 (주민등록번호 처리의 제한)',
    title: '신분증·등본 수집 시 주민등록번호 뒷자리 비식별 마스킹 및 암호화·목적 제한',
    requirement: '4대보험 취득·원천징수 등 법령 근거 외 주민번호 평문 노출 금지. 신분증 사본 편철 시 뒷자리 가림(마스킹) 권고.',
  },
  {
    id: 'ROSTER_LAW_08_BLIND_HIRING',
    clause: '채용절차의 공정화에 관한 법률 제4조의3 (출신지역 등 개인정보 요구 금지)',
    title: '출신지역·혼인여부·재산·신체조건(키/체중/용모)·직계존비속 학력/직업 수집 차단',
    requirement: '이력서·인사서류 업로드 시 수집금지 기초심사자료가 포함된 경우 자동 탐지·배제해야 함 (위반 시 500만 원 이하 과태료).',
  },
  {
    id: 'ROSTER_LAW_09_FOREIGN_MINOR',
    clause: '출입국관리법 제18조③ · 외국인고용법 제8조 · 근로기준법 제66조',
    title: '외국인 취업가능 체류자격(E-7/E-9/F-4/H-2)·만료일 및 18세 미만 연소자 증명서 비치',
    requirement: '외국인은 체류자격·체류기간 만료일을 확인해야 하며, 18세 미만자는 가족관계증명서와 친권자 동의서를 명부와 함께 비치해야 함.',
  },
  {
    id: 'ROSTER_LAW_10_DIRECT_WAGE_ACCOUNT',
    clause: '근로기준법 제43조 (임금 직접지급 원칙)',
    title: '근로자 본인 명의 급여계좌 확인 및 통장사본 연결 관리',
    requirement: '제3자(배우자·가족 포함) 계좌 지급은 직접불 원칙 위반 위험이 있으므로 본인 명의 통장사본을 확인·연결해야 함.',
  },
]);

/**
 * 채용절차법 제4조의3 수집금지 항목 패턴 탐지기
 */
const INLINE_BLIND_STOP =
  '(?=\\s+(?:성\\s*명|생년월일|성\\s*별|주\\s*소|거주지|연락처|비상|소속|부서|직위|직급|종사|담당|고용|입사|계약|급여|은행|계좌|자격|국\\s*적|체류)[^\\r\\n:：]{0,8}[:：]|[\\r\\n|/]|$)';

const PROHIBITED_BLIND_PATTERNS = Object.freeze([
  { code: 'MARITAL_STATUS', label: '혼인여부(기혼·미혼)', regex: /(?:결혼\s*여부|혼인\s*여부|혼인\s*관계)\s*[:：]?\s*(?:기혼|미혼|이혼|사별)/g },
  { code: 'BIRTHPLACE', label: '출신지역·본적', regex: new RegExp(`(?:본적|출신\\s*지역|등록기준지)\\s*[:：]\\s*[^\\r\\n|/]{1,80}?${INLINE_BLIND_STOP}`, 'g') },
  { code: 'PROPERTY', label: '재산·주거소유 형태', regex: new RegExp(`(?:재산\\s*총액|부동산\\s*소유|주거\\s*소유|자가\\s*여부)\\s*[:：]\\s*[^\\r\\n|/]{1,80}?${INLINE_BLIND_STOP}`, 'g') },
  { code: 'PHYSICAL', label: '신체조건(신장·체중·용모)', regex: new RegExp(`(?:신장|체중|혈액형|용모)\\s*[:：]\\s*\\d+[^\\r\\n|/]{0,40}?${INLINE_BLIND_STOP}`, 'g') },
  { code: 'FAMILY_BG', label: '직계존비속·형제자매 학력/직업/재산', regex: new RegExp(`(?:부친\\s*직업|모친\\s*직업|부모\\s*학력|가족\\s*직업|부모\\s*재산)\\s*[:：]\\s*[^\\r\\n|/]{1,80}?${INLINE_BLIND_STOP}`, 'g') },
]);

function normalizeDigitsAndDashes(raw) {
  return String(raw ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
}

export function sanitizeAndMaskHrText(rawText) {
  let s = normalizeDigitsAndDashes(rawText);
  if (s.length > MAX_DOSSIER_TEXT_CHARS) {
    throw badRequest(`인사서류 추출 원문 크기가 허용 상한(${MAX_DOSSIER_TEXT_CHARS.toLocaleString('ko-KR')}자)을 초과했습니다.`);
  }
  // 주민등록번호·외국인등록번호 마스킹 (전각대시·공백하이픈 대응 및 무하이픈 13자리 계좌번호 오인 방지)
  s = s.replace(
    /\b(\d{6})([ \t]{0,3}-[ \t]{0,3}|[ \t]?)([1-8])\d{6}\b/g,
    (full, six, sep, gDigit, offset, whole) => {
      const validRrn = decodeSixAndDigit(six.slice(0, 2), six.slice(2, 4), six.slice(4, 6), gDigit);
      if (!sep.includes('-')) {
        const prefixCtx = whole.slice(Math.max(0, offset - 24), offset);
        if (/(?:계좌|통장)\s*(?:번호)?\s*[:：]?\s*$/.test(prefixCtx) || !validRrn) {
          return full;
        }
      }
      return `${six}-*******`;
    }
  );
  // 계좌번호 문맥 중간자리 비식별 마스킹 (콜론 유무 모두 대응)
  s = s.replace(
    /((?:계좌\s*번호|통장\s*번호|급여\s*계좌|(?:계좌|통장)\s*[:：])\s*[:：]?\s*)([0-9-]{8,24})/g,
    (_, pfx, acc) => `${pfx}${maskBankAccountNumber(acc)}`
  );
  // 운전면허번호 마스킹 (예: 11-22-123456-01)
  s = s.replace(/\b(\d{2})[ \t]*-[ \t]*(\d{2})[ \t]*-[ \t]*\d{6}[ \t]*-[ \t]*\d{2}\b/g, '$1-$2-******-**');
  // 휴대전화번호 마스킹 (끝 4자리 유지)
  s = s.replace(/\b(01[016789])(?:[ \t]{0,2}-[ \t]{0,2}|[ \t]?)?\d{3,4}(?:[ \t]{0,2}-[ \t]{0,2}|[ \t]?)?(\d{4})\b/g, '$1-****-$2');
  return s.trim();
}

export function maskBankAccountNumber(rawAccount) {
  const trimmed = normalizeDigitsAndDashes(rawAccount).trim();
  if (!trimmed) return '';
  if (/^\d{2,6}-\*{2,8}-\d{2,6}$/.test(trimmed) || trimmed === '***-****-****') {
    return trimmed;
  }
  const cleaned = trimmed.replace(/[^\d-]/g, '').trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 8) return cleaned ? '***-****-****' : '';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function maskPhoneStrict(rawPhone) {
  const s = sanitizeAndMaskHrText(rawPhone).slice(0, 30);
  if (!s || s === '010-****-0000') return '';
  const m = s.match(/^(01[016789]|0\d{1,2})[-\s]?(?:\d{3,4}|\*{3,4})[-\s]?(\d{4})$/);
  if (m) return `${m[1]}-****-${m[2]}`;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }
  return s;
}

function maskBirthOrIdStrict(rawVal) {
  const s = normalizeDigitsAndDashes(rawVal).trim();
  if (!s) return '';
  const compactRrn = s.replace(/\b(\d{6})(?:[ \t]{0,3}-[ \t]{0,3}|[ \t]?)[1-8]\d{6}\b/g, '$1-*******');
  return sanitizeAndMaskHrText(compactRrn).slice(0, 20);
}

function normalizeIsoDateFlexible(raw) {
  if (!raw) return null;
  const s = String(raw)
    .trim()
    .replace(/\s+/g, '')
    .replace(/^(\d{4})년(\d{1,2})월(\d{1,2})일?$/, '$1-$2-$3')
    .replace(/[./]/g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}

function parseKoreanWonAmount(raw, fallback = 0) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const s = String(raw).replace(/[,\s원KRW]/gi, '').trim();
  const manMatch = s.match(/^(\d+(?:\.\d+)?)만$/);
  if (manMatch) return Math.round(Number(manMatch[1]) * 10_000);
  const chunManMatch = s.match(/^(\d+(?:\.\d+)?)천만$/);
  if (chunManMatch) return Math.round(Number(chunManMatch[1]) * 10_000_000);
  const num = Number(s);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
}

function inferDemographicsFromResidentNumber(rawText) {
  const norm = normalizeDigitsAndDashes(rawText);
  const withoutAccounts = norm.replace(
    /(?:계좌\s*번호|통장\s*번호|급여\s*계좌|(?:계좌|통장)\s*[:：])\s*[:：]?\s*[0-9-\s]{8,26}/g,
    ' '
  );
  for (const m of withoutAccounts.matchAll(/\b(\d{2})(\d{2})(\d{2})(?:[ \t]{0,3}-[ \t]{0,3}|[ \t]?)([1-8])\d{6}\b/g)) {
    const decoded = decodeSixAndDigit(m[1], m[2], m[3], m[4]);
    if (decoded) return decoded;
  }
  for (const mm of withoutAccounts.matchAll(/\b(\d{2})(\d{2})(\d{2})(?:[ \t]{0,3}-[ \t]{0,3}|[ \t]?)([1-8])\*{3,7}(?![0-9*])/g)) {
    const decoded = decodeSixAndDigit(mm[1], mm[2], mm[3], mm[4]);
    if (decoded) return decoded;
  }
  return null;
}

function decodeSixAndDigit(yy, mm, dd, genderDigitStr) {
  const gCode = Number(genderDigitStr);
  const century = gCode === 1 || gCode === 2 || gCode === 5 || gCode === 6 ? 1900 : 2000;
  const iso = `${century + Number(yy)}-${mm}-${dd}`;
  if (!isValidIsoDate(iso)) return null;
  const gender = gCode % 2 === 1 ? '남' : '여';
  const isForeignNational = gCode >= 5 && gCode <= 8;
  return {
    birthDate: iso,
    maskedBirthOrId: `${yy}${mm}${dd}-*******`,
    gender,
    isForeignNational,
  };
}

function computeAgeYears(birthDateIso, referenceDateIso = '2026-11-15') {
  if (!isValidIsoDate(birthDateIso) || !isValidIsoDate(referenceDateIso)) return null;
  const [by, bm, bd] = birthDateIso.split('-').map(Number);
  const [ry, rm, rd] = referenceDateIso.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
}

/**
 * 순수 JS PDF 텍스트 추출기 (Node 20+ 및 브라우저 SharedWorker 공통, 무의존성)
 * - /FlateDecode 스트림 해제(DecompressionStream), ToUnicode CMap(bfchar/bfrange), UTF-16BE(<FEFF...>), 리터럴 문자열((...)) 지원
 */
async function inflateBytesSafe(compressedBytes) {
  if (typeof globalThis.DecompressionStream !== 'function') return null;
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const ds = new globalThis.DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compressedBytes).catch(() => {});
      writer.close().catch(() => {});
      const chunks = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          if (total + value.byteLength > MAX_DECOMPRESSED_STREAM_BYTES) {
            await reader.cancel().catch(() => {});
            break;
          }
          total += value.byteLength;
          chunks.push(value);
        }
      }
      if (chunks.length > 0) {
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        return merged;
      }
    } catch {
      // try next deflate format
    }
  }
  return null;
}

function decodePdfLiteralString(inner) {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = inner[++i] || '';
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (/[0-7]/.test(next)) {
      let oct = next;
      if (/[0-7]/.test(inner[i + 1] || '')) oct += inner[++i];
      if (/[0-7]/.test(inner[i + 1] || '')) oct += inner[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function decodeHexTokenWithCmap(hexRaw, cmap) {
  const clean = String(hexRaw || '').replace(/\s+/g, '');
  if (!clean || clean.length % 2 !== 0) return '';
  if (/^feff/i.test(clean) && clean.length >= 8 && clean.length % 4 === 0) {
    let u16 = '';
    for (let i = 4; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code > 0) u16 += String.fromCodePoint(code);
    }
    return u16;
  }
  if (cmap.size > 0 && clean.length % 4 === 0) {
    let mapped = '';
    let hit = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const glyph = clean.slice(i, i + 4).toUpperCase();
      if (cmap.has(glyph)) {
        mapped += cmap.get(glyph);
        hit++;
      } else {
        const code = parseInt(glyph, 16);
        if (code >= 0x20 && code <= 0xd7ff) mapped += String.fromCharCode(code);
      }
    }
    if (hit > 0) return mapped;
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeUtf16HexUnits(hexStr, addOffset = 0) {
  const padded = hexStr.length % 4 === 0 ? hexStr : hexStr.padStart(Math.ceil(hexStr.length / 4) * 4, '0');
  let out = '';
  for (let i = 0; i < padded.length; i += 4) {
    const isLast = i + 4 >= padded.length;
    const unit = (parseInt(padded.slice(i, i + 4), 16) + (isLast ? addOffset : 0)) & 0xffff;
    if (unit > 0) out += String.fromCharCode(unit);
  }
  return out;
}

function parseCmapFromContent(contentStr, cmap) {
  const src = contentStr.length > 131_072 ? contentStr.slice(0, 131_072) : contentStr;
  let pos = 0;
  while (pos < src.length && cmap.size < 8192) {
    const bIdx = src.indexOf('beginbfchar', pos);
    if (bIdx < 0) break;
    const eIdx = src.indexOf('endbfchar', bIdx + 11);
    if (eIdx < 0) break;
    const blk = src.slice(bIdx + 11, eIdx);
    for (const p of blk.matchAll(/<([0-9A-Fa-f]{1,8})>\s*<([0-9A-Fa-f]{1,32})>/g)) {
      if (cmap.size >= 8192) break;
      const srcHex = p[1].toUpperCase().padStart(4, '0');
      const uni = decodeUtf16HexUnits(p[2], 0);
      if (uni) cmap.set(srcHex, uni);
    }
    pos = eIdx + 9;
  }
  pos = 0;
  while (pos < src.length && cmap.size < 8192) {
    const bIdx = src.indexOf('beginbfrange', pos);
    if (bIdx < 0) break;
    const eIdx = src.indexOf('endbfrange', bIdx + 12);
    if (eIdx < 0) break;
    const blk = src.slice(bIdx + 12, eIdx);
    for (const r of blk.matchAll(/<([0-9A-Fa-f]{1,8})>\s*<([0-9A-Fa-f]{1,8})>\s*<([0-9A-Fa-f]{1,16})>/g)) {
      if (cmap.size >= 8192) break;
      const start = parseInt(r[1], 16);
      const end = Math.min(start + 256, parseInt(r[2], 16));
      for (let cur = start; cur <= end && cmap.size < 8192; cur++) {
        const uni = decodeUtf16HexUnits(r[3], cur - start);
        if (uni) cmap.set(cur.toString(16).toUpperCase().padStart(4, '0'), uni);
      }
    }
    pos = eIdx + 10;
  }
}

function extractTextOperatorsFromStream(contentStr, cmap) {
  const src = contentStr.length > 131_072 ? contentStr.slice(0, 131_072) : contentStr;
  const len = src.length;
  const lines = [];
  let currentLine = '';
  let inArray = false;
  let arrayBuf = '';
  let pendingPiece = null;
  let pendingFromArray = false;
  let i = 0;

  while (i < len) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f') {
      i++;
      continue;
    }
    if (ch === '%') {
      while (i < len && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (ch === '[') {
      inArray = true;
      arrayBuf = '';
      pendingPiece = null;
      i++;
      continue;
    }
    if (ch === ']') {
      inArray = false;
      pendingPiece = arrayBuf;
      pendingFromArray = true;
      arrayBuf = '';
      i++;
      continue;
    }
    if (ch === '(') {
      i++;
      let raw = '';
      let depth = 1;
      while (i < len && depth > 0) {
        const c = src[i++];
        if (c === '\\') {
          if (i < len) {
            const esc = src[i++];
            if (raw.length < 4096) raw += '\\' + esc;
          }
        } else if (c === '(') {
          depth++;
          if (raw.length < 4096) raw += c;
        } else if (c === ')') {
          depth--;
          if (depth > 0 && raw.length < 4096) raw += c;
        } else if (raw.length < 4096) {
          raw += c;
        }
      }
      if (depth === 0) {
        const decoded = decodePdfLiteralString(raw);
        if (inArray) {
          if (arrayBuf.length < 8192) arrayBuf += decoded;
        } else {
          pendingPiece = decoded;
          pendingFromArray = false;
        }
      } else {
        pendingPiece = null;
      }
      continue;
    }
    if (ch === '<') {
      if (src[i + 1] === '<') {
        i += 2;
        pendingPiece = null;
        continue;
      }
      i++;
      const hexStart = i;
      while (i < len && src[i] !== '>') i++;
      if (i < len && src[i] === '>') {
        const hexSlice = src.slice(hexStart, Math.min(i, hexStart + 8192));
        i++;
        if (/^[0-9A-Fa-f\s]+$/.test(hexSlice)) {
          const decoded = decodeHexTokenWithCmap(hexSlice, cmap);
          if (inArray) {
            if (arrayBuf.length < 8192) arrayBuf += decoded;
          } else {
            pendingPiece = decoded;
            pendingFromArray = false;
          }
        } else {
          pendingPiece = null;
        }
      } else {
        pendingPiece = null;
      }
      continue;
    }
    if (ch === '>' && src[i + 1] === '>') {
      i += 2;
      pendingPiece = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (pendingPiece !== null && !pendingFromArray) {
        currentLine += pendingPiece;
      }
      pendingPiece = null;
      i++;
      continue;
    }
    const tokStart = i;
    while (
      i < len &&
      src[i] !== ' ' &&
      src[i] !== '\t' &&
      src[i] !== '\r' &&
      src[i] !== '\n' &&
      src[i] !== '\f' &&
      src[i] !== '(' &&
      src[i] !== ')' &&
      src[i] !== '<' &&
      src[i] !== '>' &&
      src[i] !== '[' &&
      src[i] !== ']' &&
      src[i] !== '%' &&
      src[i] !== "'" &&
      src[i] !== '"'
    ) {
      i++;
    }
    if (i === tokStart) {
      i++;
      pendingPiece = null;
      continue;
    }
    const tok = src.slice(tokStart, i);
    if (tok === 'Tj') {
      if (pendingPiece !== null && !pendingFromArray) currentLine += pendingPiece;
      pendingPiece = null;
    } else if (tok === 'TJ') {
      if (pendingPiece !== null && pendingFromArray) currentLine += pendingPiece;
      pendingPiece = null;
    } else if (tok === 'ET' || tok === 'Td' || tok === 'TD' || tok === 'T*') {
      pendingPiece = null;
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = '';
      }
    } else if (!/^[+-]?\d/.test(tok)) {
      pendingPiece = null;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines;
}

export async function extractTextFromPdfBytes(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes || []);
  if (bytes.byteLength === 0) return '';
  if (bytes.byteLength > MAX_PDF_INPUT_BYTES) {
    throw badRequest('업로드된 PDF 파일 크기가 허용 한도(5MB)를 초과했습니다.');
  }
  const latin1 = new TextDecoder('latin1').decode(bytes);
  if (!latin1.startsWith('%PDF-')) {
    const plain = new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 15_000);
    return sanitizeAndMaskHrText(plain);
  }

  const decodedStreams = [];
  const nonStreamParts = [];
  const cmap = new Map();
  let searchPos = 0;
  let streamCount = 0;
  let totalInflatedBytes = 0;

  let scanAttempts = 0;
  while (streamCount < MAX_PDF_STREAMS && scanAttempts < 400 && totalInflatedBytes < 1_048_576) {
    const streamIdx = latin1.indexOf('stream', searchPos);
    if (streamIdx < 0) break;
    scanAttempts++;
    let dataStart = streamIdx + 6;
    if (latin1[dataStart] === '\r' && latin1[dataStart + 1] === '\n') dataStart += 2;
    else if (latin1[dataStart] === '\n' || latin1[dataStart] === '\r') dataStart += 1;
    else {
      searchPos = streamIdx + 6;
      continue;
    }
    const winStart = Math.max(searchPos, streamIdx - 2048);
    const relDict = latin1.slice(winStart, streamIdx).lastIndexOf('<<');
    const dictStart = relDict >= 0 ? winStart + relDict : streamIdx;
    if (nonStreamParts.length < 20 && dictStart > searchPos) {
      nonStreamParts.push(latin1.slice(searchPos, Math.min(dictStart, searchPos + 8192)));
    }
    const dictHeader = latin1.slice(dictStart, streamIdx);
    const endIdx = latin1.indexOf('endstream', dataStart);
    if (endIdx < 0) break;
    let dataEnd = endIdx;
    if (latin1[dataEnd - 2] === '\r' && latin1[dataEnd - 1] === '\n') dataEnd -= 2;
    else if (latin1[dataEnd - 1] === '\n' || latin1[dataEnd - 1] === '\r') dataEnd -= 1;

    streamCount++;
    searchPos = endIdx + 9;

    if (/\/Subtype\s*\/Image\b|\/Length1\b|\/Type\s*\/XRef\b/.test(dictHeader)) {
      continue;
    }

    const rawSlice = bytes.subarray(dataStart, Math.max(dataStart, dataEnd));
    let streamStr = '';
    if (/\/FlateDecode\b/.test(dictHeader)) {
      const inflated = await inflateBytesSafe(rawSlice);
      if (inflated) {
        totalInflatedBytes += inflated.byteLength;
        streamStr = new TextDecoder('latin1').decode(inflated);
      }
    } else if (!/\/DCTDecode\b|\/JPXDecode\b/.test(dictHeader)) {
      streamStr = new TextDecoder('latin1').decode(rawSlice.subarray(0, 131_072));
    }
    if (streamStr) {
      if (streamStr.includes('beginbfchar') || streamStr.includes('beginbfrange')) {
        parseCmapFromContent(streamStr, cmap);
      }
      decodedStreams.push(streamStr);
    }
  }
  if (searchPos < latin1.length && nonStreamParts.length < 20) {
    nonStreamParts.push(latin1.slice(searchPos, Math.min(latin1.length, searchPos + 16_384)));
  }

  const extractedLines = [];
  for (const s of decodedStreams) {
    const lines = extractTextOperatorsFromStream(s, cmap);
    if (lines.length > 0) extractedLines.push(...lines);
  }
  if (extractedLines.length === 0 && nonStreamParts.length > 0) {
    const fallbackLines = extractTextOperatorsFromStream(nonStreamParts.join('\n').slice(0, 65_536), cmap);
    extractedLines.push(...fallbackLines);
  }
  const rawJoined = extractedLines.join('\n').slice(0, 15_000);
  const demoHint = inferDemographicsFromResidentNumber(rawJoined);
  const maskedBody = sanitizeAndMaskHrText(rawJoined);
  if (demoHint) {
    const hintParts = [];
    if (demoHint.birthDate && !/생년월일\s*[:：]/.test(maskedBody)) {
      hintParts.push(`생년월일: ${demoHint.birthDate}`);
    }
    if (demoHint.gender && !/성\s*별\s*[:：]/.test(maskedBody)) {
      hintParts.push(`성별: ${demoHint.gender}`);
    }
    if (demoHint.isForeignNational && !/국\s*적\s*[:：]/.test(maskedBody)) {
      hintParts.push('국적: 외국국적');
    }
    if (hintParts.length > 0) {
      return `${maskedBody}\n${hintParts.join(' | ')}`;
    }
  }
  return maskedBody;
}

/**
 * 순수 JS 다중 이미지(신분증·통장·자격증·계약서 촬영본) + 요약 표지 → 표준 PDF-1.4 바이너리 병합 생성기
 * - 외부 라이브러리 없이 /DCTDecode JPEG 스트림과 UTF-16BE 북마크/메타데이터를 갖는 유효한 PDF-1.4 생성
 */
function encodePdfAscii(str) {
  return new TextEncoder().encode(str);
}

function escapePdfAsciiText(str) {
  return String(str || '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function toUtf16BeHexPdf(str) {
  let hex = 'FEFF';
  for (const ch of String(str || '')) {
    const cp = ch.codePointAt(0) || 0x20;
    if (cp <= 0xffff) {
      hex += cp.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  return `<${hex}>`;
}

export function buildMergedBinderPdfBytes({
  title = 'MODULAR HR Employee Statutory Dossier Binder',
  koreanSubject = '근로자 인사기록 및 계약 증빙 통합철',
  summaryAsciiLines = [],
  jpegPages = [],
} = {}) {
  // 객체 번호 배치: 1=Catalog, 2=Pages, 3=Font(Helvetica), 4=CoverPage, 5=CoverContents, 이후 각 이미지 페이지당 3개 객체(ImageXObj, ContentStream, Page)
  const objects = new Map();
  const pageObjIds = [4];

  const coverOps = [
    'BT',
    '/F1 15 Tf',
    '44 785 Td',
    `(${escapePdfAsciiText(title)}) Tj`,
    '/F1 10 Tf',
    '0 -22 Td',
    '(Statutory Labor Roster & Redacted Personal Document Binder - LSA Art. 41 & 42) Tj',
    '0 -18 Td',
    '(--------------------------------------------------------------------------------) Tj',
  ];
  for (const line of summaryAsciiLines.slice(0, 32)) {
    coverOps.push('0 -16 Td');
    coverOps.push(`(${escapePdfAsciiText(line)}) Tj`);
  }
  // PDF 텍스트 추출기로 한글 요약을 역추출할 수 있도록 투명 텍스트(3 Tr)로 UTF-16BE 메타라인 삽입
  if (koreanSubject) {
    coverOps.push('3 Tr');
    coverOps.push('0 -14 Td');
    coverOps.push(`${toUtf16BeHexPdf(koreanSubject)} Tj`);
    coverOps.push('0 Tr');
  }
  coverOps.push('ET');
  const coverStreamBytes = encodePdfAscii(coverOps.join('\n'));

  objects.set(3, [encodePdfAscii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]);
  objects.set(5, [
    encodePdfAscii(`<< /Length ${coverStreamBytes.byteLength} >>\nstream\n`),
    coverStreamBytes,
    encodePdfAscii('\nendstream'),
  ]);
  objects.set(4, [
    encodePdfAscii(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>'
    ),
  ]);

  let nextId = 6;
  for (let idx = 0; idx < jpegPages.length && idx < 15; idx++) {
    const pg = jpegPages[idx];
    const jpegBytes = pg.jpegBytes instanceof Uint8Array ? pg.jpegBytes : new Uint8Array(pg.jpegBytes || []);
    if (jpegBytes.byteLength === 0) continue;
    const imgW = Math.max(1, Math.round(Number(pg.width) || 800));
    const imgH = Math.max(1, Math.round(Number(pg.height) || 600));
    const imgObjId = nextId++;
    const contentObjId = nextId++;
    const pageObjId = nextId++;

    const maxBoxW = 515;
    const maxBoxH = 710;
    const scale = Math.min(maxBoxW / imgW, maxBoxH / imgH);
    const drawW = Number((imgW * scale).toFixed(2));
    const drawH = Number((imgH * scale).toFixed(2));
    const posX = Number(((595 - drawW) / 2).toFixed(2));
    const posY = Number((80 + (maxBoxH - drawH) / 2).toFixed(2));
    const caption = escapePdfAsciiText(pg.asciiCaption || `Attachment Page #${idx + 1} (PII Masked)`);

    objects.set(imgObjId, [
      encodePdfAscii(
        `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`
      ),
      jpegBytes,
      encodePdfAscii('\nendstream'),
    ]);

    const pageDrawCmd = encodePdfAscii(
      `BT /F1 10 Tf 40 806 Td (${caption}) Tj ET\nq ${drawW} 0 0 ${drawH} ${posX} ${posY} cm /Im0 Do Q`
    );
    objects.set(contentObjId, [
      encodePdfAscii(`<< /Length ${pageDrawCmd.byteLength} >>\nstream\n`),
      pageDrawCmd,
      encodePdfAscii('\nendstream'),
    ]);
    objects.set(pageObjId, [
      encodePdfAscii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`
      ),
    ]);
    pageObjIds.push(pageObjId);
  }

  const infoObjId = nextId++;
  objects.set(infoObjId, [
    encodePdfAscii(`<< /Title ${toUtf16BeHexPdf(koreanSubject)} /Producer (MODULAR-HR Statutory Binder) >>`),
  ]);
  objects.set(2, [
    encodePdfAscii(
      `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`
    ),
  ]);
  objects.set(1, [encodePdfAscii('<< /Type /Catalog /Pages 2 0 R >>')]);

  const chunks = [];
  let cursor = 0;
  const pushBytes = (u8) => {
    chunks.push(u8);
    cursor += u8.byteLength;
  };

  pushBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const totalObjCount = infoObjId + 1;
  const offsets = new Array(totalObjCount).fill(0);

  const sortedIds = Array.from(objects.keys()).sort((a, b) => a - b);
  for (const id of sortedIds) {
    offsets[id] = cursor;
    pushBytes(encodePdfAscii(`${id} 0 obj\n`));
    for (const part of objects.get(id)) {
      pushBytes(part);
    }
    pushBytes(encodePdfAscii('\nendobj\n'));
  }

  const xrefOffset = cursor;
  const xrefLines = [`xref`, `0 ${totalObjCount}`, `0000000000 65535 f `];
  for (let i = 1; i < totalObjCount; i++) {
    xrefLines.push(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n `);
  }
  xrefLines.push(
    'trailer',
    `<< /Size ${totalObjCount} /Root 1 0 R /Info ${infoObjId} 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF\n'
  );
  pushBytes(encodePdfAscii(xrefLines.join('\n')));

  const pdfBytes = new Uint8Array(cursor);
  let pos = 0;
  for (const c of chunks) {
    pdfBytes.set(c, pos);
    pos += c.byteLength;
  }
  return {
    pdfBytes,
    pageCount: pageObjIds.length,
    byteLength: pdfBytes.byteLength,
    pdfSha256: sha256HexBytes(pdfBytes),
  };
}

/**
 * 업로드 파일명 및 본문에서 첨부 증빙서류 유형 자동 분류
 */
export function classifyDossierDocKinds(rawText = '', fileNames = []) {
  const joined = `${fileNames.join(' ')}\n${rawText}`;
  const kinds = [];
  if (/주민등록증|운전면허증|외국인등록증|신분증|여권|ID[_\s-]?CARD/i.test(joined)) {
    kinds.push({ code: 'ID_CARD', label: '신분증 사본 (뒷자리 비식별 마스킹)' });
  }
  if (/근로계약서|연봉계약서|고용계약|위탁계약서|CONTRACT/i.test(joined)) {
    kinds.push({ code: 'EMPLOYMENT_CONTRACT', label: '근로계약서' });
  }
  if (/통장\s*사본|계좌\s*사본|급여\s*계좌|예금주|은행|BANK/i.test(joined)) {
    kinds.push({ code: 'BANK_BOOK', label: '본인명의 급여통장 사본' });
  }
  if (/개인정보\s*수집|동의서|보안\s*서약서|CONSENT/i.test(joined)) {
    kinds.push({ code: 'PRIVACY_CONSENT', label: '개인정보 수집·이용 동의서' });
  }
  if (/자격증|면허증|기능사|산업기사|기사|수료증|LICENSE|CERT/i.test(joined)) {
    kinds.push({ code: 'LICENSE_CERT', label: '국가기술자격·면허증' });
  }
  if (/주민등록등본|초본|가족관계증명서|친권자\s*동의/i.test(joined)) {
    kinds.push({ code: 'RESIDENT_REGISTER', label: '주민등록등본·증명서' });
  }
  if (/이력서|경력증명서|주요\s*경력|학력|RESUME/i.test(joined)) {
    kinds.push({ code: 'RESUME_CAREER', label: '이력서·경력증명서' });
  }
  if (kinds.length === 0) {
    kinds.push({ code: 'GENERAL_HR_DOC', label: '인사기록 증빙문서' });
  }
  return kinds;
}

/**
 * 신분증·근로계약서·통장사본·이력서 통합 텍스트로부터 법정 근로자명부(시행령 제20조) 항목 자동 추출
 * - 주민등록번호는 생년월일·성별 추론 즉시 뒷자리 파기
 * - 채용절차법 제4조의3 금지 항목은 탐지 후 명부 저장 데이터에서 자동 배제
 */
export function parseWorkerDossierText({
  rawText = '',
  fileNames = [],
  companyName = '사업장',
  referenceDate = '2026-11-15',
} = {}) {
  const inputStr = String(rawText ?? '');
  if (inputStr.length > MAX_DOSSIER_TEXT_CHARS) {
    throw badRequest(`인사서류 분석 텍스트가 허용 한도(${MAX_DOSSIER_TEXT_CHARS.toLocaleString('ko-KR')}자)를 초과했습니다.`);
  }

  // 1) 채용절차법 제4조의3 수집금지 항목 사전 탐지 및 제거
  const blindLawWarnings = [];
  let cleanedSource = inputStr;
  for (const rule of PROHIBITED_BLIND_PATTERNS) {
    if (rule.regex.test(cleanedSource)) {
      blindLawWarnings.push(
        `[채용절차법 제4조의3 자동배제] '${rule.label}' 항목이 감지되어 법정 명부 저장에서 자동 제외되었습니다.`
      );
      cleanedSource = cleanedSource.replace(rule.regex, '');
    }
    rule.regex.lastIndex = 0;
  }

  // 2) 주민번호/외국인등록번호로부터 생년월일·성별 추론 후 즉시 원문 비식별 마스킹
  const rrnInferred = inferDemographicsFromResidentNumber(cleanedSource);
  const safeText = sanitizeAndMaskHrText(cleanedSource);

  const pickKv = (regex) => {
    const m = safeText.match(regex);
    return m ? String(m[1] || '').trim() : '';
  };

  const displayName =
    pickKv(
      /(?:성\s*명|근로자\s*성명|근로자명|이\s*름|예금주(?:\s*성명)?)\s*[:：]\s*([^\r\n(|,/:：]{2,40}?)(?=\s+(?:생년월일|주민|외국인|성\s*별|주\s*소|거주지|연락처|비상|소속|부서|직위|직급|종사|담당|고용|입사|계약|급여|은행|계좌|자격|국\s*적|체류)[^\r\n:：]{0,8}[:：]|[\r\n(|,/]|$)/
    ) || '';

  const explicitGenderRaw = pickKv(/(?:성\s*별)\s*[:：]\s*(남성|여성|남자|여자|남|여|M|F)/i);
  const gender = explicitGenderRaw
    ? /^(?:여|F)/i.test(explicitGenderRaw)
      ? '여'
      : '남'
    : rrnInferred?.gender || '';

  const explicitBirthRaw = pickKv(/(?:생년월일|출생일)\s*[:：]\s*([0-9년월일./\- \t]{8,16})/);
  const birthDate = normalizeIsoDateFlexible(explicitBirthRaw) || rrnInferred?.birthDate || '';
  const maskedBirthOrId =
    rrnInferred?.maskedBirthOrId ||
    (birthDate ? `${birthDate.slice(2, 4)}${birthDate.slice(5, 7)}${birthDate.slice(8, 10)}-*******` : '');

  const phoneRaw =
    inputStr.match(/\b(01[016789])[-\s]?\d{3,4}[-\s]?(\d{4})\b/) ||
    safeText.match(/\b(01[016789])-?\*{3,4}-?(\d{4})\b/);
  const maskedPhone = phoneRaw ? `${phoneRaw[1]}-****-${phoneRaw[2]}` : '';

  const emergencyRaw = pickKv(/(?:비상\s*연락처|비상\s*연락망)\s*[:：]\s*([^\r\n]{5,40})/);
  const emergencyContact = sanitizeAndMaskHrText(emergencyRaw).slice(0, 50);

  const address = pickKv(/(?:주민등록\s*주소|현\s*주소|거주지\s*주소|주\s*소)\s*[:：]\s*([^\r\n]{5,120})/);
  const deptName = pickKv(/(?:소속\s*부서|배치\s*부서|부\s*서(?:\s*명)?)\s*[:：]\s*([^\r\n|,]{2,40})/);
  const jobTitle = pickKv(/(?:직\s*위|직\s*급|직\s*책)\s*[:：]\s*([^\r\n|,]{1,30})/);
  const jobDuties = pickKv(/(?:종사(?:하는)?\s*업무(?:\s*의\s*종류)?|담당\s*업무|업무\s*내용)\s*[:：]\s*([^\r\n]{2,100})/);

  const catRaw = pickKv(/(?:고용\s*형태|계약\s*유형|고용\s*구분)\s*[:：]\s*([^\r\n|,]{2,30})/);
  let workerCategory = 'REGULAR';
  if (/3\.3%|프리랜서|사업소득|위탁/.test(catRaw)) workerCategory = 'BIZ_33';
  else if (/일용/.test(catRaw)) workerCategory = 'DAILY';
  else if (/단시간|파트타임|알바/.test(catRaw)) workerCategory = 'PART_TIME';
  else if (/기간제|계약직|촉탁/.test(catRaw)) workerCategory = 'FIXED_TERM';

  const hireDate =
    normalizeIsoDateFlexible(
      pickKv(/(?:최초\s*입사일|입사\s*일|고용\s*연월일|취득일)\s*[:：]\s*([0-9년월일./\- \t]{8,16})/)
    ) || '';
  const renewalDate =
    normalizeIsoDateFlexible(
      pickKv(/(?:고용\s*갱신일|계약\s*갱신일|갱신\s*연월일|갱신\s*시작일|계약\s*시작일)\s*[:：]\s*([0-9년월일./\- \t]{8,16})/)
    ) || '';
  const contractEndDate =
    normalizeIsoDateFlexible(
      pickKv(/(?:계약\s*만료일|계약\s*종료일|근로계약\s*종료일)\s*[:：]\s*([0-9년월일./\- \t]{8,16})/)
    ) || '';
  if (contractEndDate && workerCategory === 'REGULAR') {
    workerCategory = 'FIXED_TERM';
  }

  const weeklyHoursRaw = pickKv(/(?:주\s*소정근로시간|소정근로시간|주당\s*근로시간)\s*[:：]\s*(\d+(?:\.\d+)?)/);
  const weeklyHours = weeklyHoursRaw
    ? Math.max(1, Math.min(52, Number(weeklyHoursRaw)))
    : null;

  const workStartEnd =
    pickKv(/(?:근무\s*시간|시업[·/\s]*종업(?:\s*시각)?)\s*[:：]\s*([^\r\n]{5,90})/) || '';
  const workplaceLocation =
    pickKv(/(?:근무\s*장소|취업\s*장소)\s*[:：]\s*([^\r\n]{2,80})/) || '';

  const baseMonthlyPay = parseKoreanWonAmount(
    pickKv(/(?:월\s*기본급|기본급|월\s*급여|보수월액|계약\s*금액)\s*[:：]\s*([0-9,.\s만원KRW]+)/i),
    0
  );
  const mealRaw = pickKv(/(?:식\s*대|중식비|비과세\s*식대)\s*[:：]\s*([0-9,.\s만원KRW]+)/i);
  const mealAllowance = mealRaw ? parseKoreanWonAmount(mealRaw, 200_000) : null;

  const bankName = pickKv(/(?:급여\s*은행|은행명|금융기관)\s*[:：]\s*([^\r\n|,0-9]{2,24})/);
  const accountRaw =
    inputStr.match(/(?:계좌\s*번호|급여\s*계좌|통장\s*번호)\s*[:：]\s*([0-9*-]{8,24})/)?.[1] || '';
  const maskedAccountNo = maskBankAccountNumber(accountRaw);

  const qualRaw = pickKv(/(?:자격[·/\s]*면허|보유\s*자격증|자격\s*사항)\s*[:：]\s*([^\r\n]{2,120})/);
  const qualifications = qualRaw
    ? qualRaw
        .split(/[,，/]/)
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const careerSummary = pickKv(/(?:주요\s*이력|주요\s*경력|경력\s*사항|이\s*력)\s*[:：]\s*([^\r\n]{2,160})/);

  const nationality =
    pickKv(/(?:국\s*적)\s*[:：]\s*([^\r\n|,]{2,30})/) ||
    (rrnInferred?.isForeignNational ? '외국국적' : '');
  const visaType = pickKv(/(?:체류\s*자격|비자\s*종류)\s*[:：]\s*([A-Z0-9-]{2,10}[^\r\n|,]{0,20})/i);
  const visaExpiryDate =
    normalizeIsoDateFlexible(pickKv(/(?:체류\s*만료일|체류기간\s*만료일)\s*[:：]\s*([0-9년월일./\- \t]{8,16})/)) || '';

  const classifiedDocs = classifyDossierDocKinds(safeText, fileNames);

  let previewOut = safeText;
  if (rrnInferred) {
    const hints = [];
    if (rrnInferred.birthDate && !/생년월일\s*[:：]/.test(previewOut)) {
      hints.push(`생년월일: ${rrnInferred.birthDate}`);
    }
    if (rrnInferred.gender && !/성\s*별\s*[:：]/.test(previewOut)) {
      hints.push(`성별: ${rrnInferred.gender}`);
    }
    if (rrnInferred.isForeignNational && !/국\s*적\s*[:：]/.test(previewOut)) {
      hints.push('국적: 외국국적');
    }
    if (hints.length > 0) previewOut = `${previewOut}\n${hints.join(' | ')}`;
  }

  return {
    extracted: {
      displayName,
      gender,
      birthDate,
      maskedBirthOrId,
      maskedPhone,
      emergencyContact,
      address,
      deptName,
      jobTitle,
      jobDuties,
      workerCategory,
      hireDate,
      renewalDate,
      contractEndDate,
      weeklyHours,
      workStartEnd,
      workplaceLocation,
      baseMonthlyPay,
      mealAllowance,
      bankName,
      maskedAccountNo,
      qualifications,
      careerSummary,
      nationality,
      visaType,
      visaExpiryDate,
    },
    classifiedDocs,
    blindLawWarnings,
    rrnAutoMasked: Boolean(rrnInferred),
    sanitizedPreviewText: previewOut,
  };
}

/**
 * 시연용 샘플 인사서류 묶음 (실제 재직자 성명·사번 미포함 — 비식별 파기 테스트 간섭 원천 차단)
 */
export const SAMPLE_WORKER_DOSSIERS = Object.freeze({
  NEW_HIRE_FULL_PACK: {
    sampleId: 'NEW_HIRE_FULL_PACK',
    label: '샘플 1 · 신규 입사자 (신분증사진 + 근로계약서PDF + 통장사본 + 자격증 → 단일PDF 병합·신규 명부 등록)',
    mode: 'NEW_WORKER',
    fileNames: [
      '주민등록증_촬영본_강태양.jpg',
      '표준근로계약서_강태양_서명본.pdf',
      '신한은행_급여통장사본.png',
      '국가기술자격증_전기기능사.jpg',
    ],
    rawText: [
      '[주민등록증 사본] 성명: 강태양 / 주민등록번호: 930718-1****** (뒷자리 자동 비식별 마스킹)',
      '주민등록 주소: 경기도 평택시 고덕국제대로 210, 104동 1202호',
      '[표준 근로계약서] 소속 부서: 설비자동화팀 | 직위: 대리 | 고용형태: 정규직',
      '종사하는 업무의 종류: 스마트팩토리 PLC 설비제어 및 예방보전',
      '입사일: 2026-11-18 | 주 소정근로시간: 40 | 근무시간: 업무시작 08:30 ~ 종료 17:30, 휴게시간 12:00 ~ 13:00',
      '월 기본급: 3,550,000원 | 식대: 200,000원 | 연락처: 010-****-8842 | 비상연락처: 배우자 010-****-8843',
      '[급여통장 사본] 급여은행: 신한은행 | 계좌번호: 110-482-918273 | 예금주: 강태양',
      '[이력 및 자격증] 자격·면허: 전기기능사, 산업안전산업기사 | 주요 경력: (주)한성테크 자동화설비팀 4년 근무',
      '[개인정보 수집·이용 동의서] 근로기준법 제41조 근로자명부 작성 및 4대보험 취득신고 목적 동의 완료',
      '혼인여부: 기혼 / 본적: 충남 천안시 (채용절차법 제4조의3 수집금지 항목 자동배제 검증용)',
    ].join('\n'),
  },
  EXISTING_SUPPLEMENT_PACK: {
    sampleId: 'EXISTING_SUPPLEMENT_PACK',
    label: '샘플 2 · 선택 직원 누락 서류 보완 (신분증·통장사본·자격이력 PDF 연결 → 제41조② 명부 자동정정)',
    mode: 'UPDATE_SELECTED',
    fileNames: [
      '신분증사본_비식별본.jpg',
      '근로계약서_갱신합의서.pdf',
      '우리은행_본인통장사본.jpg',
      '개인정보수집동의서.pdf',
    ],
    rawText: [
      '[신분증 확인] 생년월일: 1996-08-21 | 성별: 여',
      '거주지 주소: 경기도 수원시 영통구 광교중앙로 188, 203동 701호',
      '연락처: 010-****-2022 | 비상연락처: 모 010-****-2023',
      '[직무·이력 확인서] 직위: 주임 | 종사하는 업무의 종류: 정밀가공 부품 3차원 측정 및 ISO 9001 품질보증 검수',
      '자격·면허: 품질경영기사, 정밀측정산업기사 | 주요 경력: 정밀기계 품질검사 경력 3년 8개월',
      '[급여통장 사본] 급여은행: 우리은행 | 계좌번호: 1002-748-392011',
      '[개인정보 수집·이용 동의서] 본인 확인 및 급여이체·4대보험 관리 목적 수집 동의 완료',
    ].join('\n'),
  },
});

/**
 * 근로기준법 시행규칙 별지 제16호 서식 준거 『법정 근로자명부』 출력 텍스트 생성
 */
export function buildStatutoryWorkerRegistryForm16Text(company, row) {
  const qualStr = row.qualifications.length > 0 ? row.qualifications.join(', ') : '해당사항 없음';
  const docStr =
    row.dossierAttachments.length > 0
      ? row.dossierAttachments
          .map(
            (a, idx) =>
              `  ${idx + 1}) ${a.binderTitle} (${a.fileName}, ${a.pageCount}p, SHA-256: ${a.pdfSha256.slice(0, 12)}..., 보존기한: 퇴직 후 3년)`
          )
          .join('\n')
      : '  - (연결된 통합 증빙 PDF 없음)';
  const changeStr =
    row.registryChangeLogs.length > 0
      ? row.registryChangeLogs
          .slice(0, 8)
          .map((c) => `  - [${c.changedAt}] (${c.category}) ${c.summary}`)
          .join('\n')
      : '  - 최초 입사 등재 이후 변동 없음';

  return [
    '========================================================================',
    '[별지 제16호 서식] 근 로 자 명 부 (근로기준법 제41조 · 시행령 제20조 · 시행규칙 제16조)',
    '========================================================================',
    `사업장명 : ${company.companyName} (사업자등록번호: ${company.bizRegNo || '-'}) | 대표자 : ${company.ceoName || '대표이사'}`,
    `법정보존 : 해고·퇴직·사망한 날로부터 3년간 보존 (근로기준법 제42조 · 시행령 제22조 제2항 제1호)`,
    '------------------------------------------------------------------------',
    `1. 성명 (제1호)        : ${row.displayName} (사번: ${row.empCode}) | 국적: ${row.nationality}`,
    `2. 성별 (제2호)        : ${row.gender || '미기재 (보완필요)'}`,
    `3. 생년월일 (제3호)    : ${row.birthDate || '-'} (비식별 표기: ${row.maskedBirthOrId})`,
    `4. 주소·연락처 (제4호) : ${row.address || '미기재'} | 연락처: ${row.maskedPhone || '미기재'}${row.emergencyContact ? ` (비상: ${row.emergencyContact})` : ''}`,
    `5. 종사업무 (제6호)    : [${row.deptName || '미배정'}] ${row.jobDuties || '미기재'} (직위: ${row.jobTitle || '미기재'})`,
    `6. 고용·계약사항(제7호): 고용일 ${row.hireDate || '미기재'}${row.contractEndDate ? ` ~ 계약만료일 ${row.contractEndDate}` : ' (기간의 정함이 없음)'}${row.renewalDate ? ` | 갱신일 ${row.renewalDate}` : ''}`,
    `   - 근로형태·시간     : ${row.workerCategoryLabel} | 주 ${row.weeklyHours}시간 (${row.workStartEnd})`,
    `   - 기준임금·급여계좌 : 월 기준 ${row.referencePay.toLocaleString('ko-KR')}원 | ${row.bankName ? `${row.bankName} ${row.maskedAccountNo}` : '본인명의 급여계좌 확인필요'}`,
    `   - 4대보험·체류자격  : ${row.socialInsuranceSummary}${row.visaType ? ` | 체류자격 ${row.visaType} (만료: ${row.visaExpiryDate || '-'})` : ''}`,
    `7. 이력·자격사항(제5호): 자격·면허 [${qualStr}]`,
    `   - 주요 경력·교육    : ${row.careerSummary || '사내 직무교육 및 배치전 안전보건교육 이수'}`,
    `8. 퇴직·해고·사망(제8호): 재직 중 (퇴직 발생 시 퇴직연월일·사유 기재 후 3년 보존원장으로 자동 이관)`,
    '------------------------------------------------------------------------',
    '[연결된 개인정보·계약 통합 증빙 PDF 편철 현황]',
    docStr,
    '------------------------------------------------------------------------',
    '[근로기준법 제41조 제2항 기재사항 변경 · 정정 이력]',
    changeStr,
    '========================================================================',
  ].join('\n');
}

export function createRosterDossierManager() {
  let binderSeq = 100;
  let changeLogSeq = 200;

  // 사번별 법정 근로자명부 확장 메타데이터 (`empCode` -> statutory detail)
  const initialRosterSeeds = new Map([
    [
      'EMP-201',
      {
        gender: '남',
        birthDate: '1994-03-15',
        emergencyContact: '배우자 010-****-8120',
        jobTitle: '주임',
        jobDuties: 'CNC 5축 정밀가공 및 공정 세팅·품질 자주검사',
        renewalDate: '',
        contractEndDate: '',
        bankName: '국민은행',
        maskedAccountNo: '124-****-9012',
        qualifications: ['컴퓨터응용가공산업기사', '지게차운전기능사'],
        careerSummary: '정밀기계가공 경력 5년 · 정기 안전보건교육 이수',
        nationality: '대한민국',
        visaType: '',
        visaExpiryDate: '',
        dailyUsedDays: 0,
        dossierAttachments: [
          {
            binderId: 'DOSS-100',
            binderTitle: '입사 인사증빙 통합철 (신분증·근로계약서·급여통장·동의서)',
            fileName: '통합인사증빙_EMP-201.pdf',
            uploadedAt: '2022-03-02',
            pageCount: 4,
            byteSize: 184320,
            pdfSha256: '8f4c2e19a70d4b31c55e82019f3a6d1244e09b7c8a112233445566778899aabb',
            docKinds: [
              { code: 'ID_CARD', label: '신분증 사본 (뒷자리 비식별 마스킹)' },
              { code: 'EMPLOYMENT_CONTRACT', label: '근로계약서' },
              { code: 'BANK_BOOK', label: '본인명의 급여통장 사본' },
              { code: 'PRIVACY_CONSENT', label: '개인정보 수집·이용 동의서' },
            ],
            idBackMasked: true,
          },
        ],
        registryChangeLogs: [
          {
            logId: 'RCHG-199',
            changedAt: '2025-03-02',
            category: '직위·임금 정정',
            summary: '사원 → 주임 승급 및 월 기본급 조정 반영 (제41조② 정정완료)',
          },
        ],
      },
    ],
    [
      'EMP-202',
      {
        gender: '여',
        birthDate: '1996-08-21',
        hireDateOverride: '2023-03-02',
        emergencyContact: '',
        jobTitle: '사원',
        jobDuties: '출하 전 정밀치수 측정 및 불량원인 분석',
        renewalDate: '',
        contractEndDate: '',
        bankName: '',
        maskedAccountNo: '',
        qualifications: ['품질경영산업기사'],
        careerSummary: '품질보증 실무 3년',
        nationality: '대한민국',
        visaType: '',
        visaExpiryDate: '',
        dailyUsedDays: 0,
        dossierAttachments: [],
        registryChangeLogs: [],
      },
    ],
    [
      'EMP-203',
      {
        gender: '여',
        birthDate: '1995-11-04',
        emergencyContact: '국내연락처 010-****-7731',
        jobTitle: '선임연구원',
        jobDuties: '유럽 CE · 북미 UL 해외규격 인증 심사대응 및 영문 기술문서 작성',
        renewalDate: '2026-07-01',
        contractEndDate: '2027-06-30',
        bankName: '하나은행',
        maskedAccountNo: '391-****-4408',
        qualifications: ['국제규격인증심사원보'],
        careerSummary: '글로벌 기계안전 인증 실무 4년',
        nationality: '외국국적 (스페인)',
        visaType: 'E-7 (특정활동)',
        visaExpiryDate: '2027-06-30',
        dailyUsedDays: 0,
        dossierAttachments: [
          {
            binderId: 'DOSS-101',
            binderTitle: '외국인등록증·영문근로계약서·체류허가 통합철',
            fileName: '통합인사증빙_EMP-203.pdf',
            uploadedAt: '2025-07-01',
            pageCount: 3,
            byteSize: 152400,
            pdfSha256: '4a91bc02f83e71d2904a11b85c62309ef8123409ab76cd54ef1234567890abcd',
            docKinds: [
              { code: 'ID_CARD', label: '외국인등록증 사본 (뒷자리 마스킹)' },
              { code: 'EMPLOYMENT_CONTRACT', label: '기간제 근로계약서' },
              { code: 'BANK_BOOK', label: '본인명의 급여통장 사본' },
            ],
            idBackMasked: true,
          },
        ],
        registryChangeLogs: [
          {
            logId: 'RCHG-200',
            changedAt: '2026-07-01',
            category: '계약갱신 정정',
            summary: '기간제 근로계약 1년 갱신 (만료일 2027-06-30 · 총 2년 상한 도래 주의)',
          },
        ],
      },
    ],
    [
      'EMP-204',
      {
        gender: '남',
        birthDate: '1999-05-19',
        emergencyContact: '부 010-****-3319',
        jobTitle: '매니저(단시간)',
        jobDuties: '고객 기술문의 접수 및 소모품 발주 지원 (일 4시간 단시간근로)',
        renewalDate: '',
        contractEndDate: '',
        bankName: '카카오뱅크',
        maskedAccountNo: '333-****-5190',
        qualifications: ['컴퓨터활용능력 1급'],
        careerSummary: '고객지원 CS 실무 1년 6개월',
        nationality: '대한민국',
        visaType: '',
        visaExpiryDate: '',
        dailyUsedDays: 0,
        dossierAttachments: [],
        registryChangeLogs: [],
      },
    ],
    [
      'DLY-301',
      {
        gender: '남',
        birthDate: '1982-02-14',
        emergencyContact: '',
        jobTitle: '일용작업원',
        jobDuties: '출하제품 방청포장 및 파레트 적재 보조',
        renewalDate: '',
        contractEndDate: '',
        bankName: '농협은행',
        maskedAccountNo: '302-****-3018',
        qualifications: ['건설·물류 기초안전보건교육 이수'],
        careerSummary: '물류 포장 일용근무',
        nationality: '대한민국',
        visaType: '',
        visaExpiryDate: '',
        dailyUsedDays: 8,
        dossierAttachments: [],
        registryChangeLogs: [],
      },
    ],
    [
      'EXT-401',
      {
        gender: '여',
        birthDate: '1993-09-10',
        emergencyContact: '',
        jobTitle: '외주디자이너(위탁)',
        jobDuties: '제품 카탈로그·전시회 시각물 건별 위탁 제작 (비근로자)',
        renewalDate: '',
        contractEndDate: '2026-12-31',
        bankName: '기업은행',
        maskedAccountNo: '012-****-4019',
        qualifications: ['시각디자인기사'],
        careerSummary: '산업기계 편집디자인 프리랜서',
        nationality: '대한민국',
        visaType: '',
        visaExpiryDate: '',
        dailyUsedDays: 0,
        dossierAttachments: [],
        registryChangeLogs: [],
      },
    ],
  ]);

  const rosterMetaMap = new Map();
  function populateDemoRosterSeeds() {
    rosterMetaMap.clear();
    for (const [k, v] of initialRosterSeeds.entries()) {
      rosterMetaMap.set(k, structuredClone(v));
    }
  }
  populateDemoRosterSeeds();

  function ensureMeta(empCode) {
    if (!rosterMetaMap.has(empCode)) {
      rosterMetaMap.set(empCode, {
        gender: '',
        birthDate: '',
        emergencyContact: '',
        jobTitle: '',
        jobDuties: '',
        renewalDate: '',
        contractEndDate: '',
        bankName: '',
        maskedAccountNo: '',
        qualifications: [],
        careerSummary: '',
        nationality: '대한민국',
        visaType: '',
        visaExpiryDate: '',
        dailyUsedDays: 0,
        dossierAttachments: [],
        registryChangeLogs: [],
      });
    }
    return rosterMetaMap.get(empCode);
  }

  function appendRegistryChangeLog(empCode, category, summary, changedAt = utcTodayIso()) {
    const meta = ensureMeta(empCode);
    meta.registryChangeLogs.unshift({
      logId: `RCHG-${++changeLogSeq}`,
      changedAt,
      category: String(category || '명부정정').slice(0, 40),
      summary: sanitizeAndMaskHrText(summary).slice(0, 200),
    });
    if (meta.registryChangeLogs.length > 30) {
      meta.registryChangeLogs.length = 30;
    }
  }

  function buildWorkerRow(w, idx, { company, profileExtras = {}, contractMeta = {}, referenceDate }) {
    const meta = rosterMetaMap.get(w.empCode) || {};
    const catLabels = {
      REGULAR: '정규직 (기간 정함 없음)',
      FIXED_TERM: '기간제 근로자',
      PART_TIME: '단시간 근로자',
      DAILY: '일용근로자',
      BIZ_33: '3.3% 사업소득(외주위탁)',
    };
    const isContractor33 = w.workerCategory === 'BIZ_33';
    const isDaily = w.workerCategory === 'DAILY';
    const dailyUsedDays = Math.max(Number(meta.dailyUsedDays) || 0, Number(w.dailyWorkDays) || 0);
    const isDailyExemptUnder30d = isDaily && dailyUsedDays < 30;
    const statutoryRosterTarget = !isContractor33 && !isDailyExemptUnder30d;

    const hireDate = w.hireDate || meta.hireDateOverride || '';
    const birthDate =
      meta.birthDate ||
      (() => {
        const six = String(w.maskedBirthOrId || '').match(/^(\d{2})(\d{2})(\d{2})/);
        if (!six) return '';
        const yy = Number(six[1]);
        const iso = `${yy <= 30 ? 2000 + yy : 1900 + yy}-${six[2]}-${six[3]}`;
        return isValidIsoDate(iso) ? iso : '';
      })();
    const maskedBirthOrId =
      w.maskedBirthOrId ||
      (birthDate
        ? `${birthDate.slice(2, 4)}${birthDate.slice(5, 7)}${birthDate.slice(8, 10)}-*******`
        : '미기재');
    const ageYears = birthDate ? computeAgeYears(birthDate, referenceDate) : null;
    const isMinorUnder18 = ageYears !== null && ageYears < 18;

    const address = profileExtras.address || '';
    const maskedPhone = profileExtras.maskedPhone || '';
    const workplaceLocation = profileExtras.workplaceLocation || `${company.companyName} 본사 사업장`;
    const workStartEnd =
      profileExtras.workStartEnd || '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00';
    const jobTitle = w.jobTitle || meta.jobTitle || '';
    const jobDuties = meta.jobDuties || '';
    const gender = meta.gender || '';
    const bankName = meta.bankName || '';
    const maskedAccountNo = meta.maskedAccountNo || '';
    const qualifications = Array.isArray(meta.qualifications) ? [...meta.qualifications] : [];
    const careerSummary = meta.careerSummary || '';
    const referencePay =
      w.baseMonthlyPay || w.contractFee || (w.dailyWage || 0) * (w.dailyWorkDays || 0);

    const nhisActive =
      !isContractor33 && !isDaily && Number(w.weeklyHours ?? 40) >= 15;
    const eiActive = !isContractor33;
    const socialInsuranceSummary = isContractor33
      ? '4대보험 비대상 (3.3% 사업소득 원천징수)'
      : isDaily
        ? '산재·고용보험(근로내용확인신고) 적용'
        : nhisActive
          ? '국민·건보·고용·산재 4대보험 취득'
          : '산재·고용 적용 (주15h 미만 건보·국민 제외)';

    // 법정 필수 9대 기재항목 및 실무 리스크 점검
    const missingStatutoryFields = [];
    const legalAdvisories = [];

    if (isContractor33) {
      legalAdvisories.push(
        '3.3% 사업소득 위탁계약자는 근로기준법상 근로자명부 편철 대상이 아니므로 외주·위탁 대장으로 분리 관리됩니다 (출퇴근 통제·고정급 지급 시 근로자성 인정 주의).'
      );
    } else if (isDailyExemptUnder30d) {
      legalAdvisories.push(
        `근로기준법 시행령 제21조: 사용기간 30일 미만 일용근로자(현재 월 ${dailyUsedDays}일)로 명부 작성 예외이나, 30일 이상 계속 사용 시 법정 근로자명부 전환 필수.`
      );
    } else {
      if (!w.displayName) missingStatutoryFields.push('성명(제1호)');
      if (!gender) missingStatutoryFields.push('성별(제2호)');
      if (!birthDate) missingStatutoryFields.push('생년월일(제3호)');
      if (!address) missingStatutoryFields.push('주소(제4호)');
      if (!careerSummary && qualifications.length === 0) missingStatutoryFields.push('이력·자격(제5호)');
      if (!jobDuties) missingStatutoryFields.push('종사업무(제6호)');
      if (!hireDate) missingStatutoryFields.push('고용연월일(제7호)');
      if (w.workerCategory === 'FIXED_TERM' && !meta.contractEndDate) {
        missingStatutoryFields.push('기간제 계약만료일(제7호)');
      }
      if (!bankName || !maskedAccountNo) {
        legalAdvisories.push('본인명의 급여통장 사본 미확인 (근로기준법 제43조 임금 직접지급 확인 권고)');
      }
    }

    if (w.workerCategory === 'FIXED_TERM' && meta.contractEndDate && hireDate) {
      const limit2YDate = addDaysISO(hireDate, 730);
      if (meta.contractEndDate >= limit2YDate) {
        legalAdvisories.push(
          `기간제법 제4조 점검: 총 계약기간이 2년(${limit2YDate})에 도달·초과하여 기간의 정함이 없는 근로계약 전환 대상 여부 검토 필요`
        );
      }
    }
    if (meta.nationality && meta.nationality !== '대한민국' && !meta.visaType) {
      legalAdvisories.push('출입국관리법 제18조③: 외국인 근로자 취업가능 체류자격 및 만료일 확인 필요');
    }
    if (isMinorUnder18) {
      legalAdvisories.push(
        '근로기준법 제66조(연소자 증명서): 만 18세 미만 근로자로 가족관계기록사항증명서 및 친권자 동의서 사업장 비치 필수'
      );
    }

    const rowView = {
      rowNo: idx + 1,
      checked: Boolean(w.checked),
      starred: Boolean(w.starred),
      empCode: w.empCode,
      displayName: w.displayName,
      gender,
      birthDate,
      ageYears,
      isMinorUnder18,
      maskedBirthOrId,
      maskedPhone: maskedPhone || '',
      hasVerifiedPhone: Boolean(maskedPhone),
      emergencyContact: meta.emergencyContact || '',
      address,
      deptName: w.deptName || '',
      jobTitle,
      jobDuties,
      workerCategory: w.workerCategory,
      workerCategoryLabel: catLabels[w.workerCategory] || w.workerCategory,
      statutoryRosterTarget,
      rosterClassificationBadge: isContractor33
        ? '비근로자 · 위탁원장 분리'
        : isDailyExemptUnder30d
          ? `일용(${dailyUsedDays}일) · 30일미만 예외`
          : '법정 근로자명부 대상',
      hireDate,
      probationEndsOn: hireDate ? addDaysISO(hireDate, 90) : '',
      renewalDate: meta.renewalDate || '',
      contractEndDate: meta.contractEndDate || '',
      weeklyHours: w.weeklyHours || (isDaily ? 18 : 0),
      dailyHours: w.dailyHours || 8,
      workplaceLocation,
      workStartEnd,
      referencePay,
      baseMonthlyPay: w.baseMonthlyPay || 0,
      mealAllowance: w.mealAllowance ?? 200_000,
      dependents: w.dependents ?? 1,
      bankName,
      maskedAccountNo,
      qualifications,
      careerSummary,
      nationality: meta.nationality || '대한민국',
      visaType: meta.visaType || '',
      visaExpiryDate: meta.visaExpiryDate || '',
      dailyUsedDays,
      socialInsuranceSummary,
      onboardingDocsAllSigned: Boolean(contractMeta.allOnboardingSigned),
      missingStatutoryFields,
      isStatutoryComplete: !statutoryRosterTarget || missingStatutoryFields.length === 0,
      legalAdvisories,
      dossierAttachments: structuredClone(meta.dossierAttachments || []),
      registryChangeLogs: structuredClone(meta.registryChangeLogs || []),
    };

    return {
      ...rowView,
      statutoryForm16Body: buildStatutoryWorkerRegistryForm16Text(company, rowView),
    };
  }

  function buildView({ company, workers, contractLedger = [], workerProfileExtrasMap, offboardedSummary }) {
    const referenceDate = company.referenceDate || '2026-11-15';
    const contractByCode = new Map(contractLedger.map((c) => [c.empCode, c]));
    const rows = workers.map((w, idx) =>
      buildWorkerRow(w, idx, {
        company,
        profileExtras: workerProfileExtrasMap.get(w.empCode) || {},
        contractMeta: contractByCode.get(w.empCode) || {},
        referenceDate,
      })
    );

    const statutoryTargets = rows.filter((r) => r.statutoryRosterTarget);
    const completeCount = statutoryTargets.filter((r) => r.isStatutoryComplete).length;
    const incompleteCount = statutoryTargets.length - completeCount;
    const pdfLinkedCount = rows.filter((r) => r.dossierAttachments.length > 0).length;
    const contractor33Count = rows.filter((r) => r.workerCategory === 'BIZ_33').length;
    const dailyExemptCount = rows.filter(
      (r) => r.workerCategory === 'DAILY' && !r.statutoryRosterTarget
    ).length;

    return {
      summary: {
        totalRosterCount: rows.length,
        statutoryTargetCount: statutoryTargets.length,
        completeCount,
        incompleteCount,
        completionRatePct:
          statutoryTargets.length > 0
            ? Math.round((completeCount / statutoryTargets.length) * 100)
            : 100,
        pdfLinkedCount,
        contractor33Count,
        dailyExemptCount,
        retainedAlumniCount: Number(offboardedSummary?.retained3YearCount || 0),
      },
      legalChecklist: STATUTORY_ROSTER_LEGAL_CHECKLIST,
      sampleDossiers: Object.values(SAMPLE_WORKER_DOSSIERS),
      rows,
    };
  }

  function applyAction(
    actionPayload = {},
    { state, payrollLocked = false, workerProfileExtrasMap, contractSignedMap, appendAudit, tombstoneStore }
  ) {
    const actionType = String(actionPayload.actionType || '').trim();

    if (actionType === 'UPDATE_WORKER_ROSTER_PROFILE') {
      const empCode = String(actionPayload.empCode || '').trim();
      const w = state.workers.find((x) => x.empCode === empCode);
      if (!w) throw badRequest('직원 명부에서 대상 사번을 찾을 수 없습니다.');
      if (tombstoneStore && tombstoneStore.isEmpCodePurged(state.company.bizRegNo, empCode)) {
        throw conflictError('비식별 파기된 인원의 명부는 수정할 수 없습니다.');
      }

      const meta = ensureMeta(empCode);
      const prevExtras = workerProfileExtrasMap.get(empCode) || {};
      const prevEffectiveHire = w.hireDate || meta.hireDateOverride || '';
      const prevEffectiveJobTitle = w.jobTitle || meta.jobTitle || '';

      // 1) 모든 입력 사전 검증 (검증 통과 전 부분 상태 변경 원천 금지)
      let validName = w.displayName;
      if (actionPayload.displayName !== undefined) {
        validName = sanitizeAndMaskHrText(actionPayload.displayName).slice(0, 40);
        if (!validName) throw badRequest('성명은 비워둘 수 없습니다.');
      }
      let validBirth = meta.birthDate || '';
      if (actionPayload.birthDate !== undefined && String(actionPayload.birthDate).trim() !== '') {
        validBirth = normalizeIsoDateFlexible(actionPayload.birthDate);
        if (!validBirth) throw badRequest('생년월일(birthDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
      }
      let validHire = prevEffectiveHire;
      if (actionPayload.hireDate !== undefined && String(actionPayload.hireDate).trim() !== '') {
        validHire = normalizeIsoDateFlexible(actionPayload.hireDate);
        if (!validHire) throw badRequest('고용연월일(hireDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
      }
      let validContractEnd = meta.contractEndDate || '';
      if (actionPayload.contractEndDate !== undefined) {
        const rawEnd = String(actionPayload.contractEndDate || '').trim();
        validContractEnd = rawEnd ? normalizeIsoDateFlexible(rawEnd) : '';
        if (rawEnd && !validContractEnd) throw badRequest('계약만료일(contractEndDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
        if (validContractEnd && validHire && validContractEnd < validHire) {
          throw badRequest('계약만료일은 고용연월일 이후여야 합니다.');
        }
      }
      let validRenewal = meta.renewalDate || '';
      if (actionPayload.renewalDate !== undefined) {
        const rawRen = String(actionPayload.renewalDate || '').trim();
        validRenewal = rawRen ? normalizeIsoDateFlexible(rawRen) : '';
        if (rawRen && !validRenewal) throw badRequest('고용갱신일(renewalDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
      }
      let validVisaExp = meta.visaExpiryDate || '';
      if (actionPayload.visaExpiryDate !== undefined) {
        const rawVe = String(actionPayload.visaExpiryDate || '').trim();
        validVisaExp = rawVe ? normalizeIsoDateFlexible(rawVe) : '';
        if (rawVe && !validVisaExp) throw badRequest('체류만료일(visaExpiryDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
      }
      let validDailyDays = meta.dailyUsedDays;
      if (actionPayload.dailyUsedDays !== undefined && w.workerCategory === 'DAILY') {
        const dd = Number(actionPayload.dailyUsedDays);
        if (!Number.isFinite(dd) || dd < 0 || dd > 365) {
          throw badRequest('일용 누적 사용일수(dailyUsedDays)는 0~365 범위여야 합니다.');
        }
        validDailyDays = Math.round(dd);
      }
      let validPay = w.baseMonthlyPay;
      if (actionPayload.baseMonthlyPay !== undefined && w.workerCategory !== 'DAILY' && w.workerCategory !== 'BIZ_33') {
        validPay = Math.round(Number(actionPayload.baseMonthlyPay));
        if (!Number.isFinite(validPay) || validPay < 0 || validPay > 100_000_000) {
          throw badRequest('월 기본급(baseMonthlyPay) 수치가 올바르지 않습니다.');
        }
        if (validPay !== w.baseMonthlyPay) {
          if (payrollLocked) {
            throw conflictError('당월 급여대장이 잠금 확정(APPROVED_LOCKED)되어 기준 급여를 변경할 수 없습니다.');
          }
          const minReq = Math.ceil(
            computeMonthlyRefHours(w.weeklyHours || 40) * LAW_BASELINE.minimumHourlyWage
          );
          if (validPay < minReq) {
            throw badRequest(
              `최저임금법 제6조 위반 차단: 주 ${w.weeklyHours || 40}h 기준 월 최저임금(${minReq.toLocaleString('ko-KR')}원) 이상이어야 합니다.`
            );
          }
        }
      }

      // 2) 검증 통과 후 원자적 변경 적용 및 실제 변경분만 제41조② 정정이력 기록
      const changes = [];
      if (validName !== w.displayName) {
        changes.push(`성명(${w.displayName}→${validName})`);
        w.displayName = validName;
      }
      if (actionPayload.gender !== undefined) {
        const g = ['남', '여', ''].includes(actionPayload.gender) ? actionPayload.gender : meta.gender;
        if (g !== (meta.gender || '')) {
          changes.push(`성별(${meta.gender || '미기재'}→${g || '미기재'})`);
          meta.gender = g;
        }
      }
      const prevEffectiveBirth =
        meta.birthDate ||
        (() => {
          const six = String(w.maskedBirthOrId || '').match(/^(\d{2})(\d{2})(\d{2})/);
          if (!six) return '';
          const yy = Number(six[1]);
          const iso = `${yy <= 30 ? 2000 + yy : 1900 + yy}-${six[2]}-${six[3]}`;
          return isValidIsoDate(iso) ? iso : '';
        })();
      if (validBirth && validBirth !== prevEffectiveBirth) {
        changes.push(`생년월일(${validBirth})`);
        meta.birthDate = validBirth;
        w.maskedBirthOrId = `${validBirth.slice(2, 4)}${validBirth.slice(5, 7)}${validBirth.slice(8, 10)}-*******`;
      } else if (validBirth && !meta.birthDate) {
        meta.birthDate = validBirth;
      }
      if (validHire && validHire !== prevEffectiveHire) {
        changes.push(`고용일(${prevEffectiveHire || '-'}→${validHire})`);
        w.hireDate = validHire;
        meta.hireDateOverride = validHire;
      }
      if (validContractEnd !== (meta.contractEndDate || '')) {
        changes.push(`계약만료일(${meta.contractEndDate || '없음'}→${validContractEnd || '없음'})`);
        meta.contractEndDate = validContractEnd;
      }
      if (validRenewal !== (meta.renewalDate || '')) {
        changes.push(`고용갱신일(${validRenewal || '없음'})`);
        meta.renewalDate = validRenewal;
      }
      if (actionPayload.deptName !== undefined) {
        const d = sanitizeAndMaskHrText(actionPayload.deptName).slice(0, 40);
        if (d !== (w.deptName || '')) {
          changes.push(`부서(${w.deptName || '미배정'}→${d || '미배정'})`);
          w.deptName = d;
        }
      }
      if (actionPayload.jobTitle !== undefined) {
        const jt = sanitizeAndMaskHrText(actionPayload.jobTitle).slice(0, 30);
        if (jt !== prevEffectiveJobTitle) {
          changes.push(`직위(${prevEffectiveJobTitle || '-'}→${jt || '-'})`);
          meta.jobTitle = jt;
          w.jobTitle = jt;
        }
      }
      if (actionPayload.jobDuties !== undefined) {
        const jd = sanitizeAndMaskHrText(actionPayload.jobDuties).slice(0, 120);
        if (jd !== (meta.jobDuties || '')) {
          changes.push('종사업무 갱신');
          meta.jobDuties = jd;
        }
      }
      const nextAddress =
        actionPayload.address !== undefined
          ? sanitizeAndMaskHrText(actionPayload.address).slice(0, 120)
          : prevExtras.address || '';
      const nextPhone =
        actionPayload.maskedPhone !== undefined
          ? maskPhoneStrict(actionPayload.maskedPhone)
          : maskPhoneStrict(prevExtras.maskedPhone || '');
      const nextLoc =
        actionPayload.workplaceLocation !== undefined
          ? sanitizeAndMaskHrText(actionPayload.workplaceLocation).slice(0, 80)
          : prevExtras.workplaceLocation || `${state.company.companyName} 본사 사업장`;
      const nextHoursText =
        actionPayload.workStartEnd !== undefined
          ? sanitizeAndMaskHrText(actionPayload.workStartEnd).slice(0, 100)
          : prevExtras.workStartEnd || '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00';

      if (nextAddress !== (prevExtras.address || '')) changes.push('주소 정정');
      if (nextPhone !== maskPhoneStrict(prevExtras.maskedPhone || '')) changes.push('연락처 정정');

      workerProfileExtrasMap.set(empCode, {
        maskedPhone: nextPhone,
        address: nextAddress,
        workplaceLocation: nextLoc,
        workStartEnd: nextHoursText,
      });

      if (actionPayload.emergencyContact !== undefined) {
        const nextEm = sanitizeAndMaskHrText(actionPayload.emergencyContact).slice(0, 50);
        if (nextEm !== (meta.emergencyContact || '')) {
          changes.push('비상연락망 정정');
          meta.emergencyContact = nextEm;
        }
      }
      if (actionPayload.bankName !== undefined) {
        const nextBk = sanitizeAndMaskHrText(actionPayload.bankName).slice(0, 24);
        if (nextBk !== (meta.bankName || '')) {
          changes.push(`급여은행(${nextBk || '미기재'})`);
          meta.bankName = nextBk;
        }
      }
      if (actionPayload.maskedAccountNo !== undefined) {
        const nextAc = maskBankAccountNumber(actionPayload.maskedAccountNo);
        if (nextAc !== (meta.maskedAccountNo || '')) {
          changes.push('급여계좌 정정');
          meta.maskedAccountNo = nextAc;
        }
      }
      if (actionPayload.qualifications !== undefined) {
        const rawQ = Array.isArray(actionPayload.qualifications)
          ? actionPayload.qualifications.join(',')
          : String(actionPayload.qualifications || '');
        const nextQual = rawQ
          .split(/[,，]/)
          .map((s) => sanitizeAndMaskHrText(s).slice(0, 40))
          .filter(Boolean)
          .slice(0, 8);
        if (nextQual.join(',') !== (meta.qualifications || []).join(',')) {
          changes.push('자격·면허 정정');
          meta.qualifications = nextQual;
        }
      }
      if (actionPayload.careerSummary !== undefined) {
        const nextCr = sanitizeAndMaskHrText(actionPayload.careerSummary).slice(0, 160);
        if (nextCr !== (meta.careerSummary || '')) {
          changes.push('주요이력 정정');
          meta.careerSummary = nextCr;
        }
      }
      if (actionPayload.nationality !== undefined) {
        const nextNat = sanitizeAndMaskHrText(actionPayload.nationality).slice(0, 30) || '대한민국';
        if (nextNat !== (meta.nationality || '대한민국')) {
          changes.push(`국적(${nextNat})`);
          meta.nationality = nextNat;
        }
      }
      if (actionPayload.visaType !== undefined) {
        const nextVs = sanitizeAndMaskHrText(actionPayload.visaType).slice(0, 30);
        if (nextVs !== (meta.visaType || '')) {
          changes.push(`체류자격(${nextVs || '없음'})`);
          meta.visaType = nextVs;
        }
      }
      if (validVisaExp !== (meta.visaExpiryDate || '')) {
        changes.push(`체류만료일(${validVisaExp || '없음'})`);
        meta.visaExpiryDate = validVisaExp;
      }
      if (actionPayload.dailyUsedDays !== undefined && w.workerCategory === 'DAILY' && validDailyDays !== meta.dailyUsedDays) {
        meta.dailyUsedDays = validDailyDays;
        changes.push(`일용 누적사용일(${meta.dailyUsedDays}일)`);
      }
      if (validPay !== w.baseMonthlyPay) {
        changes.push(`월기본급(${validPay.toLocaleString('ko-KR')}원)`);
        w.baseMonthlyPay = validPay;
      }

      if (changes.length > 0) {
        const changeSummary = changes.join(', ');
        appendRegistryChangeLog(empCode, '명부정정(제41조②)', changeSummary);
        appendAudit('근로자명부정정', `[${empCode} ${w.displayName}] ${changeSummary}`);
      }
      return {
        message:
          changes.length > 0
            ? `[${empCode} ${w.displayName}] 법정 근로자명부 기재사항(${changes.join(', ')})이 저장되고 제41조 제2항 정정이력이 기록되었습니다.`
            : `[${empCode} ${w.displayName}] 변경된 기재사항이 없어 기존 명부를 유지했습니다.`,
        empCode,
      };
    }

    if (actionType === 'INGEST_WORKER_DOSSIER_TO_ROSTER') {
      const mode = actionPayload.mode === 'UPDATE_SELECTED' ? 'UPDATE_SELECTED' : 'NEW_WORKER';
      const targetEmpCodeInput = String(actionPayload.targetEmpCode || '').trim();
      if (mode === 'NEW_WORKER' && payrollLocked) {
        throw conflictError('당월 급여대장이 잠금 확정(APPROVED_LOCKED) 상태여서 신규 인원 명부 등재를 수행할 수 없습니다.');
      }

      const fileNames = Array.isArray(actionPayload.fileNames)
        ? actionPayload.fileNames.map((n) => sanitizeAndMaskHrText(String(n || '')).slice(0, 80)).filter(Boolean).slice(0, 15)
        : [];
      const rawText = String(actionPayload.rawText || '');
      if (!rawText.trim() && !actionPayload.overrides?.displayName) {
        throw badRequest('자동 정리할 PDF·신분증·근로계약서 추출 내용 또는 성명을 입력해 주세요.');
      }

      const parsed = parseWorkerDossierText({
        rawText,
        fileNames,
        companyName: state.company.companyName,
        referenceDate: state.company.referenceDate || '2026-11-15',
      });
      const ov = actionPayload.overrides && typeof actionPayload.overrides === 'object' ? actionPayload.overrides : {};
      const merged = {
        ...parsed.extracted,
        ...Object.fromEntries(
          Object.entries(ov).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        ),
      };
      if (Array.isArray(actionPayload.clearedKeys)) {
        for (const ck of actionPayload.clearedKeys) {
          if (typeof ck === 'string' && Object.prototype.hasOwnProperty.call(merged, ck)) {
            merged[ck] = ck === 'qualifications' ? [] : '';
          }
        }
      }
      if (ov.qualifications !== undefined && typeof ov.qualifications === 'string') {
        merged.qualifications = ov.qualifications
          .split(/[,，]/)
          .map((s) => sanitizeAndMaskHrText(s).slice(0, 40))
          .filter(Boolean);
      }

      let targetWorker = null;
      let resolvedEmpCode = '';

      const preNormContractEnd = merged.contractEndDate ? normalizeIsoDateFlexible(merged.contractEndDate) : '';
      if (merged.contractEndDate && !preNormContractEnd) {
        throw badRequest('계약만료일(contractEndDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
      }
      const preNormRenewal = merged.renewalDate ? normalizeIsoDateFlexible(merged.renewalDate) : '';
      if (merged.renewalDate && !preNormRenewal) {
        throw badRequest('고용갱신일(renewalDate)은 유효한 YYYY-MM-DD 날짜여야 합니다.');
      }

      if (mode === 'UPDATE_SELECTED') {
        targetWorker = state.workers.find((x) => x.empCode === targetEmpCodeInput) || null;
        if (!targetWorker) {
          throw badRequest('증빙 PDF를 연결할 대상 직원을 직원 명부에서 찾을 수 없습니다.');
        }
        if (tombstoneStore && tombstoneStore.isEmpCodePurged(state.company.bizRegNo, targetWorker.empCode)) {
          throw conflictError('비식별 파기된 사번에는 서류를 연결할 수 없습니다.');
        }
        const docSubjectName = sanitizeAndMaskHrText(merged.displayName || '').slice(0, 40);
        if (
          docSubjectName &&
          docSubjectName !== targetWorker.displayName &&
          actionPayload.overwriteName !== true &&
          actionPayload.allowNameMismatch !== true
        ) {
          throw conflictError(
            `선택 직원(${targetWorker.displayName}, ${targetWorker.empCode})과 서류 성명(${docSubjectName})이 일치하지 않아 타인 명부 오반영이 차단되었습니다.`
          );
        }
        const existingHire = targetWorker.hireDate || normalizeIsoDateFlexible(merged.hireDate) || '';
        if (preNormContractEnd && existingHire && preNormContractEnd < existingHire) {
          throw badRequest('계약만료일은 고용연월일 이후여야 합니다.');
        }
        resolvedEmpCode = targetWorker.empCode;
      } else {
        const finalName = sanitizeAndMaskHrText(merged.displayName || '').slice(0, 40);
        if (!finalName) {
          throw badRequest('문서에서 근로자 성명을 찾을 수 없습니다. 성명을 확인해 주세요.');
        }
        const cat = ['REGULAR', 'FIXED_TERM', 'PART_TIME', 'DAILY', 'BIZ_33'].includes(merged.workerCategory)
          ? merged.workerCategory
          : 'REGULAR';
        const prefix = cat === 'DAILY' ? 'DLY' : cat === 'BIZ_33' ? 'EXT' : 'EMP';
        let maxNum = prefix === 'EMP' ? 204 : prefix === 'DLY' ? 301 : 401;
        for (const x of [...state.workers, ...(state.offboardedWorkers || [])]) {
          const m = String(x.empCode || '').match(new RegExp(`^${prefix}-(\\d+)$`));
          if (m) maxNum = Math.max(maxNum, Number(m[1]));
        }
        do {
          maxNum += 1;
          resolvedEmpCode = `${prefix}-${String(maxNum).padStart(3, '0')}`;
        } while (
          tombstoneStore &&
          tombstoneStore.isEmpCodePurged(state.company.bizRegNo, resolvedEmpCode)
        );

        const weeklyH = Math.max(1, Math.min(52, Number(merged.weeklyHours) || (cat === 'PART_TIME' ? 20 : 40)));
        const minWageMonthly =
          cat === 'DAILY' || cat === 'BIZ_33'
            ? 0
            : Math.ceil(computeMonthlyRefHours(weeklyH) * LAW_BASELINE.minimumHourlyWage);
        let resolvedPay = Math.max(minWageMonthly, 2_800_000);
        if (merged.baseMonthlyPay !== undefined && merged.baseMonthlyPay !== null && String(merged.baseMonthlyPay).trim() !== '' && Number(merged.baseMonthlyPay) !== 0) {
          const payNum = Number(merged.baseMonthlyPay);
          if (!Number.isFinite(payNum) || payNum < 0 || payNum > 100_000_000) {
            throw badRequest('월 기본급(baseMonthlyPay) 수치가 올바르지 않습니다 (0 ~ 1억 원 범위).');
          }
          resolvedPay = Math.round(payNum);
        }
        if (cat !== 'DAILY' && cat !== 'BIZ_33' && resolvedPay < minWageMonthly) {
          throw badRequest(
            `최저임금법 제6조 위반 차단: 추출된 월 기본급(${resolvedPay.toLocaleString('ko-KR')}원)이 주 ${weeklyH}h 기준 최저임금(${minWageMonthly.toLocaleString('ko-KR')}원) 미만이므로 명부 등재가 차단되었습니다.`
          );
        }
        let resolvedMeal = 200_000;
        if (merged.mealAllowance !== undefined && merged.mealAllowance !== null && String(merged.mealAllowance).trim() !== '') {
          const mealNum = Number(merged.mealAllowance);
          if (!Number.isFinite(mealNum) || mealNum < 0 || mealNum > 5_000_000) {
            throw badRequest('식대(mealAllowance) 수치가 올바르지 않습니다.');
          }
          resolvedMeal = Math.round(mealNum);
        }

        const hireDate = normalizeIsoDateFlexible(merged.hireDate) || state.company.referenceDate || '2026-11-15';
        if (preNormContractEnd && preNormContractEnd < hireDate) {
          throw badRequest('계약만료일은 고용연월일 이후여야 합니다.');
        }
        targetWorker = {
          personId: `PER-${crypto.randomBytes(6).toString('hex')}`,
          empCode: resolvedEmpCode,
          displayName: finalName,
          deptName: sanitizeAndMaskHrText(merged.deptName || '경영지원팀').slice(0, 40),
          jobTitle: sanitizeAndMaskHrText(merged.jobTitle || '사원').slice(0, 30),
          maskedBirthOrId: maskBirthOrIdStrict(merged.maskedBirthOrId) || '',
          hireDate,
          workerCategory: cat,
          weeklyHours: weeklyH,
          dailyHours: Math.min(8, Math.max(1, Math.round(weeklyH / 5))),
          baseMonthlyPay: cat === 'DAILY' || cat === 'BIZ_33' ? 0 : resolvedPay,
          contractFee: cat === 'BIZ_33' ? resolvedPay : undefined,
          dailyWage: cat === 'DAILY' ? 170_000 : undefined,
          dailyWorkDays: cat === 'DAILY' ? 10 : undefined,
          fixedOrdinaryAllowance: 0,
          mealAllowance: resolvedMeal,
          overtimeHours: 0,
          nightHours: 0,
          holidayLe8Hours: 0,
          holidayGt8Hours: 0,
          maxWeeklyWorkedHours: weeklyH,
          unpaidLeaveDays: 0,
          suspensionDays: 0,
          unusedLeavePayoutDays: 0,
          evalRaiseRatePct: 0,
          evalBonusPay: 0,
          requestedDisciplinaryCut: 0,
          attendanceNoticeSent: false,
          defenseOpportunityGiven: false,
          committeeResolved: false,
          writtenNoticeDelivered: false,
          dependents: 1,
        };
        state.workers.push(targetWorker);
        state.emptyRosterMode = false;

        const hasContractDoc = parsed.classifiedDocs.some((d) => d.code === 'EMPLOYMENT_CONTRACT');
        const hasPrivacyDoc = parsed.classifiedDocs.some((d) => d.code === 'PRIVACY_CONSENT');
        contractSignedMap.set(resolvedEmpCode, {
          signed: hasContractDoc,
          signedAt: hasContractDoc ? hireDate : null,
          employmentContractSigned: hasContractDoc,
          privacyConsentSigned: hasPrivacyDoc,
          ndaPledgeSigned: false,
          nhisAcquired: cat !== 'DAILY' && cat !== 'BIZ_33' && weeklyH >= 15,
          eiAcquired: cat !== 'BIZ_33',
        });
      }

      const cleanJobTitle = merged.jobTitle ? sanitizeAndMaskHrText(merged.jobTitle).slice(0, 30) : '';
      const cleanJobDuties = merged.jobDuties ? sanitizeAndMaskHrText(merged.jobDuties).slice(0, 120) : '';
      const cleanEmerg = merged.emergencyContact ? sanitizeAndMaskHrText(merged.emergencyContact).slice(0, 50) : '';
      const cleanBank = merged.bankName ? sanitizeAndMaskHrText(merged.bankName).slice(0, 24) : '';
      const cleanAcct = merged.maskedAccountNo ? maskBankAccountNumber(merged.maskedAccountNo) : '';
      const cleanCareer = merged.careerSummary ? sanitizeAndMaskHrText(merged.careerSummary).slice(0, 160) : '';
      const cleanNat = merged.nationality ? sanitizeAndMaskHrText(merged.nationality).slice(0, 30) : '';
      const cleanVisa = merged.visaType ? sanitizeAndMaskHrText(merged.visaType).slice(0, 30) : '';
      const cleanAddr = merged.address ? sanitizeAndMaskHrText(merged.address).slice(0, 120) : '';
      const cleanLoc = merged.workplaceLocation ? sanitizeAndMaskHrText(merged.workplaceLocation).slice(0, 80) : '';
      const cleanStartEnd = merged.workStartEnd ? sanitizeAndMaskHrText(merged.workStartEnd).slice(0, 100) : '';
      const cleanPhone = maskPhoneStrict(merged.maskedPhone);

      if (mode === 'UPDATE_SELECTED') {
        const existingMeta = rosterMetaMap.get(targetWorker.empCode) || {};
        const prevEffectiveBirth =
          existingMeta.birthDate ||
          (() => {
            const six = String(targetWorker.maskedBirthOrId || '').match(/^(\d{2})(\d{2})(\d{2})/);
            if (!six) return '';
            const yy = Number(six[1]);
            const iso = `${yy <= 30 ? 2000 + yy : 1900 + yy}-${six[2]}-${six[3]}`;
            return isValidIsoDate(iso) ? iso : '';
          })();
        if (
          actionPayload.allowIdentityOverride !== true &&
          prevEffectiveBirth &&
          merged.birthDate &&
          isValidIsoDate(merged.birthDate) &&
          merged.birthDate !== prevEffectiveBirth
        ) {
          throw conflictError(
            `선택 직원(${targetWorker.displayName})의 기존 생년월일(${prevEffectiveBirth})과 서류 생년월일(${merged.birthDate})이 불일치하여 타인 서류 오연결이 차단되었습니다.`
          );
        }
        if (
          actionPayload.allowIdentityOverride !== true &&
          existingMeta.gender &&
          (merged.gender === '남' || merged.gender === '여') &&
          merged.gender !== existingMeta.gender
        ) {
          throw conflictError(
            `선택 직원(${targetWorker.displayName})의 기존 성별(${existingMeta.gender})과 서류 성별(${merged.gender})이 불일치하여 타인 서류 오연결이 차단되었습니다.`
          );
        }
      }

      // 기존/신규 공통: 추출된 법정 명부 필드 반영 및 변경 전→후 상세 정정이력 산출
      const meta = ensureMeta(resolvedEmpCode);
      const prevExtras = workerProfileExtrasMap.get(resolvedEmpCode) || {};
      const dossierDiffs = [];

      if (merged.displayName && mode === 'UPDATE_SELECTED' && actionPayload.overwriteName === true) {
        const nextNm = sanitizeAndMaskHrText(merged.displayName).slice(0, 40);
        if (nextNm && nextNm !== targetWorker.displayName) {
          dossierDiffs.push(`성명(${targetWorker.displayName}→${nextNm})`);
          targetWorker.displayName = nextNm;
        }
      }
      if (merged.gender === '남' || merged.gender === '여') {
        if (merged.gender !== (meta.gender || '')) {
          dossierDiffs.push(`성별(${meta.gender || '미기재'}→${merged.gender})`);
          meta.gender = merged.gender;
        }
      }
      if (merged.birthDate && isValidIsoDate(merged.birthDate)) {
        const prevInitBirth =
          meta.birthDate ||
          (() => {
            const six = String(targetWorker.maskedBirthOrId || '').match(/^(\d{2})(\d{2})(\d{2})/);
            if (!six) return '';
            const yy = Number(six[1]);
            const iso = `${yy <= 30 ? 2000 + yy : 1900 + yy}-${six[2]}-${six[3]}`;
            return isValidIsoDate(iso) ? iso : '';
          })();
        if (merged.birthDate !== prevInitBirth) {
          dossierDiffs.push(`생년월일(${merged.birthDate})`);
        }
        meta.birthDate = merged.birthDate;
        targetWorker.maskedBirthOrId =
          maskBirthOrIdStrict(merged.maskedBirthOrId) ||
          `${merged.birthDate.slice(2, 4)}${merged.birthDate.slice(5, 7)}${merged.birthDate.slice(8, 10)}-*******`;
      } else if (merged.maskedBirthOrId) {
        targetWorker.maskedBirthOrId = maskBirthOrIdStrict(merged.maskedBirthOrId);
      }
      if (mode === 'UPDATE_SELECTED' && !targetWorker.hireDate && merged.hireDate) {
        const hd = normalizeIsoDateFlexible(merged.hireDate);
        if (hd) {
          dossierDiffs.push(`고용일(미기재→${hd})`);
          targetWorker.hireDate = hd;
        }
      }
      if (mode === 'UPDATE_SELECTED' && !targetWorker.deptName && merged.deptName) {
        const nextDp = sanitizeAndMaskHrText(merged.deptName).slice(0, 40);
        if (nextDp) {
          dossierDiffs.push(`부서(미배정→${nextDp})`);
          targetWorker.deptName = nextDp;
        }
      }
      if (cleanJobTitle && cleanJobTitle !== (targetWorker.jobTitle || meta.jobTitle || '')) {
        dossierDiffs.push(`직위(${targetWorker.jobTitle || meta.jobTitle || '-'}→${cleanJobTitle})`);
        meta.jobTitle = cleanJobTitle;
        targetWorker.jobTitle = cleanJobTitle;
      }
      if (cleanJobDuties && cleanJobDuties !== (meta.jobDuties || '')) {
        dossierDiffs.push('종사업무 보완');
        meta.jobDuties = cleanJobDuties;
      }
      if (preNormRenewal && preNormRenewal !== (meta.renewalDate || '')) {
        dossierDiffs.push(`고용갱신일(${preNormRenewal})`);
        meta.renewalDate = preNormRenewal;
      }
      if (preNormContractEnd && preNormContractEnd !== (meta.contractEndDate || '')) {
        dossierDiffs.push(`계약만료일(${meta.contractEndDate || '없음'}→${preNormContractEnd})`);
        meta.contractEndDate = preNormContractEnd;
      }
      if (cleanEmerg && cleanEmerg !== (meta.emergencyContact || '')) {
        dossierDiffs.push('비상연락망 보완');
        meta.emergencyContact = cleanEmerg;
      }
      if (cleanBank && cleanBank !== (meta.bankName || '')) {
        dossierDiffs.push(`급여은행(${meta.bankName || '미기재'}→${cleanBank})`);
        meta.bankName = cleanBank;
      }
      if (cleanAcct && cleanAcct !== (meta.maskedAccountNo || '')) {
        dossierDiffs.push(`급여계좌(${meta.maskedAccountNo || '미기재'}→${cleanAcct})`);
        meta.maskedAccountNo = cleanAcct;
      }
      if (Array.isArray(merged.qualifications) && merged.qualifications.length > 0) {
        const prevQJoin = (meta.qualifications || []).join(',');
        const mergedSet = new Set([
          ...(meta.qualifications || []),
          ...merged.qualifications.map((q) => sanitizeAndMaskHrText(q).slice(0, 40)).filter(Boolean),
        ]);
        meta.qualifications = Array.from(mergedSet).slice(0, 8);
        if (meta.qualifications.join(',') !== prevQJoin) {
          dossierDiffs.push(`자격·면허(${meta.qualifications.join(', ')})`);
        }
      }
      if (cleanCareer && cleanCareer !== (meta.careerSummary || '')) {
        dossierDiffs.push('주요이력 보완');
        meta.careerSummary = cleanCareer;
      }
      if (cleanNat && cleanNat !== (meta.nationality || '')) {
        dossierDiffs.push(`국적(${cleanNat})`);
        meta.nationality = cleanNat;
      } else if (mode === 'NEW_WORKER' && !meta.nationality) {
        meta.nationality = '대한민국';
      }
      if (cleanVisa && cleanVisa !== (meta.visaType || '')) {
        dossierDiffs.push(`체류자격(${cleanVisa})`);
        meta.visaType = cleanVisa;
      }
      if (merged.visaExpiryDate && isValidIsoDate(merged.visaExpiryDate) && merged.visaExpiryDate !== (meta.visaExpiryDate || '')) {
        dossierDiffs.push(`체류만료일(${merged.visaExpiryDate})`);
        meta.visaExpiryDate = merged.visaExpiryDate;
      }

      const finalPhone = cleanPhone || maskPhoneStrict(prevExtras.maskedPhone || '');
      const finalAddr = cleanAddr || prevExtras.address || '';
      if (finalAddr !== (prevExtras.address || '')) dossierDiffs.push('주소 보완');
      if (finalPhone !== maskPhoneStrict(prevExtras.maskedPhone || '')) dossierDiffs.push('연락처 보완');

      workerProfileExtrasMap.set(resolvedEmpCode, {
        maskedPhone: finalPhone,
        address: finalAddr,
        workplaceLocation: cleanLoc || prevExtras.workplaceLocation || `${state.company.companyName} 본사 사업장`,
        workStartEnd: cleanStartEnd || prevExtras.workStartEnd || '업무시작 09:00 ~ 종료 18:00, 휴게시간 12:00 ~ 13:00',
      });

      // 통합 PDF 편철 메타데이터 생성 (클라이언트가 생성한 병합 PDF 해시 또는 서버 생성 PDF 해시)
      const binderMetaIn =
        actionPayload.binderMeta && typeof actionPayload.binderMeta === 'object'
          ? actionPayload.binderMeta
          : null;
      let pdfSha256 =
        binderMetaIn && /^[0-9a-f]{64}$/i.test(String(binderMetaIn.pdfSha256 || ''))
          ? String(binderMetaIn.pdfSha256).toLowerCase()
          : '';
      let pageCount = Math.max(1, Math.min(50, Number(binderMetaIn?.pageCount) || Math.max(1, fileNames.length)));
      const rawByteIn = Number(binderMetaIn?.byteSize);
      let byteSize = Number.isFinite(rawByteIn) && rawByteIn > 0 ? Math.min(20_000_000, Math.round(rawByteIn)) : 0;

      if (!pdfSha256) {
        const generated = buildMergedBinderPdfBytes({
          title: `MODULAR HR Dossier - ${resolvedEmpCode}`,
          koreanSubject: `${targetWorker.displayName}(${resolvedEmpCode}) 통합 인사증빙철`,
          summaryAsciiLines: [
            `Employee Code : ${resolvedEmpCode}`,
            `Department    : ${targetWorker.deptName}`,
            `Hire Date     : ${targetWorker.hireDate || '-'}`,
            `Doc Kinds     : ${parsed.classifiedDocs.map((d) => d.code).join(', ')}`,
            `PII Guardrail : Resident ID back digits & prohibited blind items stripped`,
          ],
          jpegPages: [],
        });
        pdfSha256 = generated.pdfSha256;
        pageCount = Math.max(pageCount, generated.pageCount);
        byteSize = byteSize || generated.byteLength;
      }
      if (!byteSize) byteSize = 512;

      const rawMaskStatus = String(binderMetaIn?.idMaskStatus || '');
      const validMaskStatus = ['USER_VERIFIED', 'AREA_UNVERIFIED', 'TEXT_MASKED', 'NONE'].includes(rawMaskStatus)
        ? rawMaskStatus
        : binderMetaIn && typeof binderMetaIn.idBackMasked === 'boolean'
          ? binderMetaIn.idBackMasked
            ? 'USER_VERIFIED'
            : 'NONE'
          : parsed.rrnAutoMasked
            ? 'TEXT_MASKED'
            : 'NONE';

      const binderId = `DOSS-${++binderSeq}`;
      const docLabelsJoin = parsed.classifiedDocs.map((d) => d.label).join(' · ');
      const attachmentRecord = {
        binderId,
        binderTitle:
          sanitizeAndMaskHrText(binderMetaIn?.binderTitle || '').slice(0, 100) ||
          `통합 인사증빙 PDF (${docLabelsJoin.slice(0, 64)})`,
        fileName:
          sanitizeAndMaskHrText(binderMetaIn?.fileName || '').slice(0, 80) ||
          `통합인사증빙_${resolvedEmpCode}_${utcTodayIso()}.pdf`,
        uploadedAt: utcTodayIso(),
        pageCount,
        byteSize,
        pdfSha256,
        sourceFiles: fileNames.length > 0 ? fileNames : ['직접입력_인사증빙.pdf'],
        docKinds: parsed.classifiedDocs,
        idMaskStatus: validMaskStatus,
        idBackMasked: validMaskStatus === 'USER_VERIFIED' || validMaskStatus === 'TEXT_MASKED',
        blindLawWarnings: parsed.blindLawWarnings,
      };
      meta.dossierAttachments.unshift(attachmentRecord);
      if (meta.dossierAttachments.length > 30) {
        meta.dossierAttachments.length = 30;
      }

      const diffTail = dossierDiffs.length > 0 ? ` — ${dossierDiffs.join(', ')}` : '';
      appendRegistryChangeLog(
        resolvedEmpCode,
        mode === 'NEW_WORKER' ? '신규등재·PDF편철' : '증빙PDF연결·정정(제41조②)',
        `${attachmentRecord.fileName} (${parsed.classifiedDocs.map((d) => d.label).join(', ')})${diffTail}`
      );
      appendAudit(
        '근로자명부PDF자동정리',
        `[${resolvedEmpCode} ${targetWorker.displayName}] ${
          mode === 'NEW_WORKER' ? '신규 직원 명부 자동 등재' : '기존 직원 명부 보완·정정'
        } 및 통합 증빙 PDF(${attachmentRecord.fileName}) 연결 완료${diffTail}`
      );

      return {
        message:
          mode === 'NEW_WORKER'
            ? `[${resolvedEmpCode} ${targetWorker.displayName}] 신분증·계약서·개인정보 증빙이 단일 PDF로 연결되어 직원 명부 및 전 메뉴(근태·연차·급여)에 자동 등록되었습니다.`
            : `[${resolvedEmpCode} ${targetWorker.displayName}] 신분증·계약서·개인정보 증빙 PDF가 연결되어 누락된 법정 근로자명부 항목이 자동 정리되었습니다.`,
        empCode: resolvedEmpCode,
        mode,
        binderId,
        classifiedDocs: parsed.classifiedDocs,
        blindLawWarnings: parsed.blindLawWarnings,
        rrnAutoMasked: parsed.rrnAutoMasked,
      };
    }

    if (actionType === 'DELETE_WORKER_DOSSIER_ATTACHMENT') {
      const empCode = String(actionPayload.empCode || '').trim();
      const binderId = String(actionPayload.binderId || '').trim();
      if (tombstoneStore && tombstoneStore.isEmpCodePurged(state.company.bizRegNo, empCode)) {
        throw conflictError('비식별 파기된 사번의 증빙 기록은 변경할 수 없습니다.');
      }
      const meta = rosterMetaMap.get(empCode);
      if (!meta) throw badRequest('대상 직원의 증빙 보관함을 찾을 수 없습니다.');
      const idx = meta.dossierAttachments.findIndex((a) => a.binderId === binderId);
      if (idx < 0) throw badRequest('삭제할 증빙 PDF 항목을 찾을 수 없습니다.');
      const [removed] = meta.dossierAttachments.splice(idx, 1);
      appendRegistryChangeLog(empCode, '증빙편철제외', `${removed.fileName} 연결 해제`);
      appendAudit('근로자명부증빙제외', `[${empCode}] ${removed.fileName} 연결 해제`);
      return {
        message: `연결된 증빙 PDF(${removed.fileName})가 명부 편철대장에서 제외되었습니다.`,
      };
    }

    return null;
  }

  function recordAssignmentChange(empCode, orderLabel, detailSummary, changedAt) {
    appendRegistryChangeLog(empCode, `인사발령(${orderLabel})`, detailSummary, changedAt || utcTodayIso());
  }

  function scrubPurgedPerson(origEmpCode) {
    const cleanCode = String(origEmpCode || '').trim().toUpperCase();
    if (!cleanCode) return;
    for (const key of Array.from(rosterMetaMap.keys())) {
      if (key.toUpperCase() === cleanCode) {
        rosterMetaMap.delete(key);
      }
    }
  }

  function resetForNewRoster({ withDemoSeeds = false } = {}) {
    if (withDemoSeeds) {
      populateDemoRosterSeeds();
    } else {
      rosterMetaMap.clear();
    }
  }

  function exportPersistenceState() {
    const metaObj = {};
    for (const [k, v] of rosterMetaMap.entries()) {
      metaObj[k] = structuredClone(v);
    }
    return {
      binderSeq,
      changeLogSeq,
      rosterMeta: metaObj,
    };
  }

  function restorePersistenceState(saved = {}) {
    if (!saved || typeof saved !== 'object') return;
    if (Number.isInteger(saved.binderSeq)) binderSeq = saved.binderSeq;
    if (Number.isInteger(saved.changeLogSeq)) changeLogSeq = saved.changeLogSeq;
    if (saved.rosterMeta && typeof saved.rosterMeta === 'object') {
      rosterMetaMap.clear();
      for (const [k, v] of Object.entries(saved.rosterMeta)) {
        if (v && typeof v === 'object') {
          const cloned = structuredClone(v);
          cloned.qualifications = Array.isArray(cloned.qualifications) ? cloned.qualifications.map((q) => String(q || '')) : [];
          cloned.dossierAttachments = Array.isArray(cloned.dossierAttachments)
            ? cloned.dossierAttachments.filter((a) => a && typeof a === 'object').map((a) => ({
                ...a,
                pdfSha256: String(a.pdfSha256 || ''),
                docKinds: Array.isArray(a.docKinds) ? a.docKinds : [],
              }))
            : [];
          cloned.registryChangeLogs = Array.isArray(cloned.registryChangeLogs)
            ? cloned.registryChangeLogs.filter((c) => c && typeof c === 'object')
            : [];
          rosterMetaMap.set(k, cloned);
        }
      }
    }
  }

  return Object.freeze({
    buildView,
    applyAction,
    recordAssignmentChange,
    scrubPurgedPerson,
    resetForNewRoster,
    exportPersistenceState,
    restorePersistenceState,
  });
}
