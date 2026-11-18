/**
 * modular-hr 보안 로컬 웹 서버 (127.0.0.1 전용 바인딩)
 * - Host 헤더 검증(DNS Rebinding 차단), Origin/Sec-Fetch-Site 및 타이밍 안전 CSRF 토큰 검증
 * - 엄격한 입력 스키마 검증(Boolean/Number/Enum/실재 날짜 검증), CSP 헤더, 64KB 413 응답 보장
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INDUSTRIES, LAW_BASELINE } from './engine/labor-rules.mjs';
import {
  VALID_STATUTORY_TASK_IDS,
  assertValidIsoDate,
  provisionWorkplaceSystem,
} from './engine/compliance-provisioner.mjs';
import {
  VALID_RESIGN_REASONS,
  computeEmployeePayrollLine,
  computeOffboardingSettlement,
  validateJobPosting,
} from './engine/lifecycle-payroll.mjs';
import { VALID_DOC_TEMPLATES, generateStatutoryDocument } from './engine/document-generator.mjs';
import { buildWorkerBindingKey, createMobileHub } from './engine/mobile-auth-realtime.mjs';
import {
  SAMPLE_INGESTION_BUNDLES,
  listSampleIngestionBundles,
  stageMultiDocumentBundle,
} from './engine/document-ingestion.mjs';
import {
  buildOffboardedWorkerRecord,
  createInitialOffboardedWorkers,
  createPurgeTombstoneStore,
  getServerTodayISO,
  mergeOffboardedLedgers,
  purgeExpiredOffboardedPii,
  refreshOffboardedLifecycle,
  summarizeOffboardedRegistry,
  updateOffboardedChecklist,
} from './engine/offboarding-registry.mjs';
import { createOperationsSuiteManager } from './engine/hr-operations-suite.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function assertOptionalBoolean(obj, key) {
  if (obj[key] !== undefined && typeof obj[key] !== 'boolean') {
    throw badRequest(`${key} 필드는 boolean(true/false)이어야 합니다.`);
  }
}

function assertOptionalFiniteNumber(obj, key, min, max) {
  if (obj[key] === undefined) return;
  if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key])) {
    throw badRequest(`${key} 필드는 유한한 숫자(number)여야 합니다.`);
  }
  if (obj[key] < min || obj[key] > max) {
    throw badRequest(`${key} 필드는 ${min} 이상 ${max} 이하여야 합니다.`);
  }
}

function assertOptionalInteger(obj, key, min, max) {
  if (obj[key] === undefined) return;
  assertOptionalFiniteNumber(obj, key, min, max);
  if (!Number.isInteger(obj[key])) {
    throw badRequest(`${key} 필드는 정수(integer)여야 합니다.`);
  }
}

export const WORKPLACE_PRESETS = Object.freeze({
  STARTUP_4_IT: {
    id: 'STARTUP_4_IT',
    badge: '4인 스타트업 (IT)',
    companyName: '(주)새벽소프트',
    bizRegNo: '101-86-00001',
    ksicMajor: 'J',
    hasMajorityUnion: false,
    activeSubsidies: ['청년일자리도약장려금'],
    referenceDate: '2026-11-15',
    triggerDate: '2026-11-10',
    historicalPeakHeadcount: 4,
    headcountInput: {
      operatingDays: 22,
      regularWorkers: 4,
      partTimeWorkers: 0,
      dailyWorkerManDays: 0,
      dispatchedWorkers: 0,
      biz33Contractors: 1,
      disabledMild: 0,
      disabledSevere: 0,
    },
  },
  GROWTH_12_RETAIL: {
    id: 'GROWTH_12_RETAIL',
    badge: '12인 성장기 (유통)',
    companyName: '(주)푸른유통커머스',
    bizRegNo: '204-81-00012',
    ksicMajor: 'G',
    hasMajorityUnion: false,
    activeSubsidies: ['고용촉진장려금'],
    referenceDate: '2026-11-15',
    triggerDate: '2026-11-08',
    historicalPeakHeadcount: 12,
    headcountInput: {
      operatingDays: 22,
      regularWorkers: 10,
      partTimeWorkers: 2,
      dailyWorkerManDays: 0,
      dispatchedWorkers: 0,
      biz33Contractors: 1,
      disabledMild: 0,
      disabledSevere: 0,
    },
  },
  SME_34_IT_LMC: {
    id: 'SME_34_IT_LMC',
    badge: '34인 노사협의회 (30인+)',
    companyName: '(주)한빛클라우드시스템',
    bizRegNo: '312-87-00034',
    ksicMajor: 'J',
    hasMajorityUnion: false,
    activeSubsidies: ['청년일자리도약장려금', '육아휴직대체인력지원금'],
    referenceDate: '2026-11-15',
    triggerDate: '2026-11-10',
    historicalPeakHeadcount: 34,
    headcountInput: {
      operatingDays: 22,
      regularWorkers: 32,
      partTimeWorkers: 2,
      dailyWorkerManDays: 0,
      dispatchedWorkers: 0,
      biz33Contractors: 2,
      disabledMild: 1,
      disabledSevere: 0,
    },
  },
  MFG_62_OSH: {
    id: 'MFG_62_OSH',
    badge: '62인 제조업 안전보건 (50인+)',
    companyName: '(주)대한정밀기계공업',
    bizRegNo: '214-86-00941',
    ksicMajor: 'C',
    hasMajorityUnion: false,
    activeSubsidies: ['고용창출장려금', '워라밸일자리장려금'],
    referenceDate: '2026-11-15',
    triggerDate: '2026-11-11',
    historicalPeakHeadcount: 62,
    headcountInput: {
      operatingDays: 22,
      regularWorkers: 56,
      partTimeWorkers: 2,
      dailyWorkerManDays: 44,
      dispatchedWorkers: 4,
      biz33Contractors: 1,
      disabledMild: 1,
      disabledSevere: 0,
    },
  },
  ENTERPRISE_320_MFG: {
    id: 'ENTERPRISE_320_MFG',
    badge: '320인 중견제조 (300인+)',
    companyName: '(주)글로벌모빌리티부품',
    bizRegNo: '518-85-00320',
    ksicMajor: 'C',
    hasMajorityUnion: true,
    activeSubsidies: ['출산육아기고용안정장려금'],
    referenceDate: '2026-11-15',
    triggerDate: '2026-11-05',
    historicalPeakHeadcount: 320,
    headcountInput: {
      operatingDays: 22,
      regularWorkers: 305,
      partTimeWorkers: 10,
      dailyWorkerManDays: 110,
      dispatchedWorkers: 10,
      biz33Contractors: 3,
      disabledMild: 4,
      disabledSevere: 2,
    },
  },
});

function createDefaultWorkers() {
  return [
    {
      personId: 'PER-INIT-EMP-201',
      empCode: 'EMP-201',
      displayName: '김하늘',
      deptName: '생산기술1팀',
      maskedBirthOrId: '940315-*******',
      hireDate: '2022-03-02',
      workerCategory: 'REGULAR',
      weeklyHours: 40,
      dailyHours: 8,
      baseMonthlyPay: 3400000,
      fixedOrdinaryAllowance: 200000,
      mealAllowance: 200000,
      overtimeHours: 14,
      nightHours: 6,
      holidayLe8Hours: 8,
      holidayGt8Hours: 2,
      maxWeeklyWorkedHours: 49.5,
      unpaidLeaveDays: 0,
      suspensionDays: 0,
      unusedLeavePayoutDays: 2,
      evalRaiseRatePct: 5,
      evalBonusPay: 300000,
      requestedDisciplinaryCut: 0,
      attendanceNoticeSent: false,
      defenseOpportunityGiven: false,
      committeeResolved: false,
      writtenNoticeDelivered: false,
      dependents: 2,
    },
    {
      empCode: 'EMP-202',
      displayName: '이바다',
      deptName: '품질보증팀',
      workerCategory: 'REGULAR',
      weeklyHours: 40,
      dailyHours: 8,
      baseMonthlyPay: 2900000,
      fixedOrdinaryAllowance: 100000,
      mealAllowance: 250000, // 비과세 한도(20만) 초과 5만 원 과세 전환 시연
      overtimeHours: 8,
      nightHours: 0,
      holidayLe8Hours: 0,
      holidayGt8Hours: 0,
      maxWeeklyWorkedHours: 44,
      unpaidLeaveDays: 0,
      suspensionDays: 0,
      unusedLeavePayoutDays: 0,
      evalRaiseRatePct: 0,
      evalBonusPay: 0,
      requestedDisciplinaryCut: 450000,
      disciplinaryIncidentCount: 1,
      attendanceNoticeSent: true,
      defenseOpportunityGiven: true,
      committeeResolved: true,
      writtenNoticeDelivered: true,
      dependents: 1,
    },
    {
      empCode: 'EMP-203',
      displayName: 'Alexandria Maria Gonzalez-Hernandez',
      deptName: '글로벌조달·해외인증파트',
      workerCategory: 'FIXED_TERM',
      weeklyHours: 40,
      dailyHours: 8,
      baseMonthlyPay: 2800000,
      fixedOrdinaryAllowance: 0,
      mealAllowance: 200000,
      overtimeHours: 6,
      nightHours: 0,
      holidayLe8Hours: 0,
      holidayGt8Hours: 0,
      maxWeeklyWorkedHours: 43,
      unpaidLeaveDays: 2,
      suspensionDays: 0,
      unusedLeavePayoutDays: 1,
      evalRaiseRatePct: 3,
      evalBonusPay: 0,
      requestedDisciplinaryCut: 0,
      attendanceNoticeSent: false,
      defenseOpportunityGiven: false,
      committeeResolved: false,
      writtenNoticeDelivered: false,
      dependents: 1,
    },
    {
      empCode: 'EMP-204',
      displayName: '박산들',
      deptName: '고객지원파트 (단시간)',
      workerCategory: 'PART_TIME',
      weeklyHours: 20,
      dailyHours: 4,
      baseMonthlyPay: 1150000,
      fixedOrdinaryAllowance: 0,
      mealAllowance: 100000,
      overtimeHours: 4,
      nightHours: 0,
      holidayLe8Hours: 0,
      holidayGt8Hours: 0,
      maxWeeklyWorkedHours: 24,
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
    },
    {
      empCode: 'DLY-301',
      displayName: '최현장',
      deptName: '포장출하반 (일용직)',
      workerCategory: 'DAILY',
      dailyWorkDays: 8,
      dailyWage: 170000,
    },
    {
      empCode: 'EXT-401',
      displayName: '정디자인',
      deptName: '외주편집 (3.3% 사업소득)',
      workerCategory: 'BIZ_33',
      contractFee: 2500000,
      fixedSameAmountMonths: 6,
      hasAttendanceLog: true,
    },
  ];
}

function createBulkWorkers(count = 50) {
  const base = createDefaultWorkers();
  const depts = ['생산1팀', '생산2팀', '설비보전팀', '품질관리팀', '물류출하팀', '경영지원팀'];
  for (let i = base.length + 1; i <= count; i++) {
    base.push({
      empCode: `EMP-${String(200 + i).padStart(3, '0')}`,
      displayName: `근로자${i}호`,
      deptName: depts[i % depts.length],
      workerCategory: i % 7 === 0 ? 'PART_TIME' : 'REGULAR',
      weeklyHours: i % 7 === 0 ? 25 : 40,
      dailyHours: i % 7 === 0 ? 5 : 8,
      baseMonthlyPay: i % 7 === 0 ? 1500000 : 2700000 + (i % 8) * 150000,
      fixedOrdinaryAllowance: 100000,
      mealAllowance: 200000,
      overtimeHours: i % 10,
      nightHours: i % 4,
      holidayLe8Hours: i % 5 === 0 ? 8 : 0,
      holidayGt8Hours: 0,
      maxWeeklyWorkedHours: (i % 7 === 0 ? 25 : 40) + (i % 13),
      unpaidLeaveDays: 0,
      suspensionDays: 0,
      unusedLeavePayoutDays: i % 6 === 0 ? 1 : 0,
      evalRaiseRatePct: i % 4 === 0 ? 4 : 0,
      evalBonusPay: 0,
      requestedDisciplinaryCut: 0,
      attendanceNoticeSent: false,
      defenseOpportunityGiven: false,
      committeeResolved: false,
      writtenNoticeDelivered: false,
      dependents: (i % 3) + 1,
    });
  }
  return base;
}

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

const MOBILE_SESSION_COOKIE = 'mhr_mobile_sid';

function parseCookieHeader(cookieHeader) {
  const out = Object.create(null);
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function setMobileCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${MOBILE_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
  );
}

function clearMobileCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${MOBILE_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  );
}

function setSecurityHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (statusCode === 413) {
    res.setHeader('Connection', 'close');
  }
  res.writeHead(statusCode);
  res.end(JSON.stringify(payload));
}

export const CUSTOM_LOCAL_DOMAINS = Object.freeze([
  'modular-hr.localhost',
  'pureun-hr.localhost',
]);

function buildAllowedHosts(boundPort) {
  const baseHosts = ['127.0.0.1', 'localhost', '[::1]', ...CUSTOM_LOCAL_DOMAINS];
  const set = new Set();
  for (const h of baseHosts) {
    set.add(h);
    set.add(`${h}:${boundPort}`);
  }
  return set;
}

function buildAllowedOrigins(boundPort) {
  const baseHosts = ['127.0.0.1', 'localhost', '[::1]', ...CUSTOM_LOCAL_DOMAINS];
  return baseHosts.map((h) => `http://${h}:${boundPort}`);
}

function isAllowedHostHeader(hostHeader, boundPort) {
  if (!hostHeader || typeof hostHeader !== 'string') return false;
  const normalized = hostHeader.trim().toLowerCase();
  return buildAllowedHosts(boundPort).has(normalized);
}

function isAllowedOrigin(req, boundPort) {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    const allowedOrigins = new Set(buildAllowedOrigins(boundPort));
    if (!allowedOrigins.has(origin.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function verifyCsrfToken(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 64KB 초과 시 소켓을 강제 파괴하지 않고 스트림을 드레인한 뒤 정상적인 HTTP 413 JSON을 반환하도록 보장
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      const err = new Error('Content-Type must be application/json');
      err.statusCode = 415;
      req.resume();
      reject(err);
      return;
    }
    const chunks = [];
    let total = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('요청 본문 크기가 허용 한도(64KB)를 초과했습니다.');
        err.statusCode = 413;
        reject(err);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = raw.trim() ? JSON.parse(raw) : {};
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(badRequest('JSON 요청 본문은 객체(object)여야 합니다.'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(badRequest('올바른 JSON 형식이 아닙니다.'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

export function createAppServer(options = {}) {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  // 기본 보안 정책: 전사 PC API(/api/bootstrap 등)도 대표이사(CEO)·인사관리자(HR_ADMIN) 2차 인증 세션 필수!
  const requirePcAuth = options.requirePcAuth ?? process.env.MHR_ALLOW_UNAUTH_PC !== '1';
  const serverClockToday = () => options.serverTodayIso || getServerTodayISO(options.now);
  const purgeTombstones = createPurgeTombstoneStore();
  const opsSuite = createOperationsSuiteManager();
  const mobileHub = createMobileHub({
    demoMode: options.demoMode ?? process.env.MHR_DEMO_MODE === '1',
    seedCredentials: options.seedCredentials,
    initialBizRegNo: WORKPLACE_PRESETS.MFG_62_OSH.bizRegNo,
    initialEmp201PersonId: 'PER-INIT-EMP-201',
    now: options.now,
  });

  let state = {
    company: structuredClone(WORKPLACE_PRESETS.MFG_62_OSH),
    completedTaskIds: [],
    workers: createDefaultWorkers(),
    offboardedWorkers: createInitialOffboardedWorkers('2026-11-15'),
    lastIngestionSummary: null,
    emptyRosterMode: false,
    auditLogs: [
      {
        time: '2026-11-15 12:00:00',
        actor: 'Auto-Provisioner',
        event: '초기 사업장 프로파일 로드 및 상시근로자·업종 매트릭스 자동 점검 완료',
      },
    ],
  };

  function resolveIngestionInput(body = {}) {
    if (body.bundleId !== undefined) {
      if (typeof body.bundleId !== 'string' || !Object.hasOwn(SAMPLE_INGESTION_BUNDLES, body.bundleId)) {
        throw badRequest('유효하지 않은 샘플 문서 번들 식별자(bundleId)입니다.');
      }
      const refDate =
        body.referenceDate !== undefined
          ? assertValidIsoDate(body.referenceDate, 'referenceDate')
          : state.company.referenceDate;
      return {
        ...SAMPLE_INGESTION_BUNDLES[body.bundleId],
        referenceDate: refDate,
      };
    }
    if (body.referenceDate !== undefined) {
      assertValidIsoDate(body.referenceDate, 'referenceDate');
    }
    return {
      businessRegistrationText: body.businessRegistrationText,
      companyBrochureText: body.companyBrochureText,
      healthInsuranceText: body.healthInsuranceText,
      employmentInsuranceText: body.employmentInsuranceText,
      files: body.files,
      referenceDate: body.referenceDate || state.company.referenceDate,
    };
  }

  function appendAudit(actor, event) {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    state.auditLogs.unshift({ time: stamp, actor, event });
    if (state.auditLogs.length > 30) state.auditLogs.length = 30;
  }

  function scrubPurgedFromAuditLogs(origEmpCode, origDisplayName) {
    const cleanCode = String(origEmpCode || '').trim();
    const upperCode = cleanCode.toUpperCase();
    const cleanName = String(origDisplayName || '').trim();
    state.auditLogs = state.auditLogs.filter((log) => {
      const ev = String(log.event || '');
      const ac = String(log.actor || '');
      if (cleanCode && (ev.includes(cleanCode) || ac.includes(cleanCode))) return false;
      if (upperCode && (ev.toUpperCase().includes(upperCode) || ac.toUpperCase().includes(upperCode))) {
        return false;
      }
      if (cleanName && (ev.includes(cleanName) || ac.includes(cleanName))) return false;
      return true;
    });
  }

  function assignImmutablePersonIds(prevBizRegNo, prevWorkers = [], nextBizRegNo, incomingWorkers = []) {
    return incomingWorkers.map((inc) => {
      const nextKey = buildWorkerBindingKey(
        nextBizRegNo,
        inc.empCode,
        inc.displayName,
        inc.maskedBirthOrId,
        inc.hireDate
      );
      if (nextKey !== null) {
        const matchedPrev = prevWorkers.find((pw) => {
          if (!pw.personId) return false;
          const prevKey = buildWorkerBindingKey(
            prevBizRegNo,
            pw.empCode,
            pw.displayName,
            pw.maskedBirthOrId,
            pw.hireDate
          );
          return prevKey !== null && prevKey === nextKey;
        });
        if (matchedPrev) {
          return { ...structuredClone(inc), personId: matchedPrev.personId };
        }
      }
      return { ...structuredClone(inc), personId: `PER-${crypto.randomUUID()}` };
    });
  }

  function buildSnapshot() {
    const compliance = provisionWorkplaceSystem({
      ...state.company,
      completedTaskIds: state.completedTaskIds,
    });

    const activeWorkers = state.emptyRosterMode ? [] : state.workers;
    const payrollLines = activeWorkers.map((w) =>
      computeEmployeePayrollLine(w, {
        lsaRegularCount: compliance.headcounts.exactLsaRatio,
        monthCalendarDays: 30,
      })
    );

    const payrollSummary = payrollLines.reduce(
      (acc, line) => {
        acc.workerCount += 1;
        acc.totalGross += line.grossPay;
        acc.totalOvertime += line.overtimeNightHolidayPay;
        acc.totalCutApplied += line.disciplinaryCutApplied;
        acc.totalCutBlocked += line.disciplinaryCutBlocked;
        acc.totalSocialIns += line.socialInsuranceTotal;
        acc.totalTax += line.incomeTaxTotal;
        acc.totalNet += line.netPay;
        acc.warningCount += line.warnings.length;
        return acc;
      },
      {
        workerCount: 0,
        totalGross: 0,
        totalOvertime: 0,
        totalCutApplied: 0,
        totalCutBlocked: 0,
        totalSocialIns: 0,
        totalTax: 0,
        totalNet: 0,
        warningCount: 0,
      }
    );

    const refreshedAlumni = state.offboardedWorkers.map((r) =>
      refreshOffboardedLifecycle(r, state.company.referenceDate)
    );
    const offboardedSummary = summarizeOffboardedRegistry(
      refreshedAlumni,
      state.company.referenceDate
    );
    const operationsSuite = opsSuite.buildView({
      company: state.company,
      workers: activeWorkers,
      payrollLines,
      compliance,
      offboardedSummary,
    });

    return {
      lawBaseline: LAW_BASELINE,
      industries: Object.values(INDUSTRIES),
      presets: Object.values(WORKPLACE_PRESETS).map((p) => ({
        id: p.id,
        badge: p.badge,
        companyName: p.companyName,
        ksicMajor: p.ksicMajor,
      })),
      sampleIngestionBundles: listSampleIngestionBundles().map((b) => ({
        bundleId: b.bundleId,
        title: b.title,
        businessRegistrationText: b.businessRegistrationText,
        companyBrochureText: b.companyBrochureText,
        healthInsuranceText: b.healthInsuranceText,
        employmentInsuranceText: b.employmentInsuranceText,
      })),
      company: state.company,
      emptyRosterMode: state.emptyRosterMode,
      workers: activeWorkers,
      offboardedWorkers: refreshedAlumni,
      offboardedSummary,
      operationsSuite,
      lastIngestionSummary: state.lastIngestionSummary,
      compliance,
      payrollLines,
      payrollSummary,
      auditLogs: state.auditLogs,
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const addressInfo = server.address();
      const boundPort = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : 4310;

      if (!isAllowedHostHeader(req.headers.host, boundPort)) {
        sendJson(res, 403, { error: 'Forbidden Host header' });
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`);
      const pathname = parsedUrl.pathname;

      if (pathname.startsWith('/api/')) {
        // ============================================================
        // 모바일 폰 앱 전용 인증·RBAC·실시간 SSE·결재 라우터 (/api/mobile/*)
        // ============================================================
        if (pathname.startsWith('/api/mobile/')) {
          const cookies = parseCookieHeader(req.headers.cookie);
          const mobileCookieToken = cookies[MOBILE_SESSION_COOKIE] || '';

          if (req.method === 'GET' && pathname === '/api/mobile/bootstrap') {
            let activeSession = null;
            if (mobileCookieToken) {
              try {
                const { session, acc } = mobileHub.getValidSession(mobileCookieToken, {
                  allowMfaPending: true,
                });
                activeSession = mobileHub.toPublicSessionInfo(session, acc);
              } catch {
                activeSession = null;
              }
            }
            sendJson(res, 200, {
              loginCsrfToken: csrfToken,
              demoAccounts: mobileHub.listSimulatorDemoAccounts(),
              session: activeSession,
            });
            return;
          }

          if (req.method === 'GET' && pathname === '/api/mobile/dashboard') {
            const dashboard = mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot());
            sendJson(res, 200, { dashboard });
            return;
          }

          if (req.method === 'GET' && pathname === '/api/mobile/stream') {
            setSecurityHeaders(res);
            mobileHub.attachSseClient(mobileCookieToken, req, res);
            return;
          }

          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method Not Allowed' });
            return;
          }

          if (!isAllowedOrigin(req, boundPort)) {
            sendJson(res, 403, { error: 'Forbidden Cross-Origin request' });
            return;
          }

          const headerToken = req.headers['x-csrf-token'];
          const clientKey = req.socket?.remoteAddress || '127.0.0.1';

          if (pathname === '/api/mobile/login') {
            if (!verifyCsrfToken(headerToken, csrfToken)) {
              sendJson(res, 403, { error: 'Invalid or missing CSRF token' });
              return;
            }
            const body = await readJsonBody(req);
            const { cookieToken, session } = await mobileHub.loginStep1(body, clientKey);
            setMobileCookie(res, cookieToken);
            appendAudit(
              '모바일인증',
              `[${session.displayName}] 모바일 1차 로그인 성공 (${session.deviceLabel}, 상태: ${session.authStage})`
            );
            sendJson(res, 200, { session });
            return;
          }

          // 로그인 이후 모든 모바일 POST 요청은 세션 쿠키 및 세션 바인딩 CSRF 검증 필수
          const allowMfaPending =
            pathname === '/api/mobile/mfa/challenge' ||
            pathname === '/api/mobile/mfa/verify' ||
            pathname === '/api/mobile/logout';

          const { session: currentSession, acc: currentAcc } = mobileHub.getValidSession(
            mobileCookieToken,
            { allowMfaPending }
          );

          if (!verifyCsrfToken(headerToken, currentSession.csrfToken)) {
            sendJson(res, 403, { error: 'Invalid or missing session CSRF token' });
            return;
          }

          const body = await readJsonBody(req);

          if (pathname === '/api/mobile/passkey/register') {
            const registered = await mobileHub.registerPasskeyPublicKey(
              mobileCookieToken,
              body,
              clientKey
            );
            appendAudit(
              '모바일패스키등록',
              `[${currentAcc.displayName}] PIN 재확인 후 단말 ECDSA P-256 공개키(SPKI) 패스키 등록 완료 (${registered.credentialId})`
            );
            sendJson(res, 200, {
              credentialId: registered.credentialId,
              session: registered.session,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/mfa/challenge') {
            const challenge = mobileHub.issuePasskeyChallenge(mobileCookieToken);
            sendJson(res, 200, { challenge });
            return;
          }

          if (pathname === '/api/mobile/mfa/verify') {
            const allowedOrigins = buildAllowedOrigins(boundPort);
            const verifiedSession = await mobileHub.verifyMfaStep2(
              mobileCookieToken,
              body,
              allowedOrigins,
              clientKey
            );
            appendAudit(
              '모바일2차인증',
              `[${verifiedSession.displayName}] 모바일 2차 인증(${String(body.method || '')}) 통과 — 실시간 관제 세션 활성화`
            );
            sendJson(res, 200, { session: verifiedSession });
            return;
          }

          if (pathname === '/api/mobile/logout') {
            mobileHub.logoutSession(mobileCookieToken);
            clearMobileCookie(res);
            appendAudit('모바일인증', `[${currentAcc.displayName}] 모바일 앱 로그아웃`);
            sendJson(res, 200, { ok: true });
            return;
          }

          if (pathname === '/api/mobile/revoke-device') {
            const result = mobileHub.revokeDeviceByAdmin(mobileCookieToken, body.deviceId);
            appendAudit(
              '모바일보안',
              `[${currentAcc.displayName}] 접속 기기 원격 세션 강제 해지 (${result.revokedDeviceId})`
            );
            sendJson(res, 200, {
              revoked: result,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/decide-approval') {
            const decided = mobileHub.decideApprovalRequest(
              mobileCookieToken,
              body,
              (approvedItem, approverAcc) => {
                if (approvedItem.requestType === 'OVERTIME' && approvedItem.empCode) {
                  const w = state.workers.find((item) => item.empCode === approvedItem.empCode);
                  if (w) {
                    w.overtimeHours = (w.overtimeHours || 0) + approvedItem.requestedHoursOrDays;
                    w.maxWeeklyWorkedHours = Math.max(
                      (w.maxWeeklyWorkedHours || w.weeklyHours || 40) + approvedItem.requestedHoursOrDays,
                      (w.weeklyHours || 40) + (w.overtimeHours || 0) / 4.345
                    );
                  }
                }
                if (
                  approvedItem.requestType === 'STATUTORY_FILING' &&
                  !state.completedTaskIds.includes('TASK_OSH_50_OFFICER')
                ) {
                  state.completedTaskIds.push('TASK_OSH_50_OFFICER');
                }
                appendAudit(
                  '모바일전자결재',
                  `[${approverAcc.displayName}] ${approvedItem.title} 승인 → 근태·급여·법정과제 자동 반영`
                );
              }
            );
            sendJson(res, 200, {
              decided,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/submit-payroll-close') {
            const closeState = mobileHub.submitPayrollCloseRequest(mobileCookieToken);
            appendAudit('모바일급여상신', `[${currentAcc.displayName}] 당월 급여대장 대표이사 승인 상신`);
            sendJson(res, 200, {
              payrollCloseState: closeState,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/approve-payroll') {
            const closeState = mobileHub.approveMonthlyPayrollByCeo(mobileCookieToken, appendAudit);
            sendJson(res, 200, {
              payrollCloseState: closeState,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/toggle-statutory-task') {
            if (currentAcc.role !== 'CEO' && currentAcc.role !== 'HR_ADMIN') {
              sendJson(res, 403, { error: '법정 신고 과제 이행 처리는 대표이사 또는 인사관리자만 가능합니다.' });
              return;
            }
            if (
              typeof body.taskId !== 'string' ||
              !VALID_STATUTORY_TASK_IDS.includes(body.taskId.trim())
            ) {
              throw badRequest('유효하지 않은 법정 과제 식별자(taskId)입니다.');
            }
            const taskId = body.taskId.trim();
            const idx = state.completedTaskIds.indexOf(taskId);
            if (idx >= 0) {
              state.completedTaskIds.splice(idx, 1);
              appendAudit('모바일컴플라이언스', `[${currentAcc.displayName}] 법정 과제 이행 취소: ${taskId}`);
            } else {
              state.completedTaskIds.push(taskId);
              appendAudit('모바일컴플라이언스', `[${currentAcc.displayName}] 법정 과제 이행 완료 체크: ${taskId}`);
            }
            mobileHub.pushRealtimeNotification({
              targetRole: 'CEO_AND_HR',
              severity: 'INFO',
              eventCode: 'STATUTORY_TASK_TOGGLED',
              title: `법정 의무 과제 상태 변경 (${taskId})`,
              bodySummary: `${currentAcc.displayName}님이 모바일에서 법정 의무 이행 상태를 갱신했습니다.`,
            });
            sendJson(res, 200, {
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/document') {
            const templateId = String(body.templateId ?? 'DOC_EMPLOYMENT_CONTRACT');
            if (!VALID_DOC_TEMPLATES.includes(templateId)) {
              throw badRequest(`지원하지 않는 문서 템플릿입니다 (${templateId}).`);
            }
            assertOptionalInteger(body, 'quarterNumber', 1, 4);
            if (currentAcc.role === 'WORKER' && templateId !== 'DOC_EMPLOYMENT_CONTRACT') {
              sendJson(res, 403, { error: '근로자 계정은 표준 근로계약서만 열람할 수 있습니다.' });
              return;
            }
            if (currentAcc.role === 'DEPT_MANAGER') {
              sendJson(res, 403, { error: '전사 규정·관공서 신고서 열람은 대표이사 및 인사관리자 권한입니다.' });
              return;
            }
            const snap = buildSnapshot();
            let alumniRecord = null;
            let workerRecord = null;
            if (
              templateId === 'DOC_EMPLOYMENT_CERT' ||
              templateId === 'DOC_ANNUAL_LEAVE_PROMOTION' ||
              templateId === 'DOC_DISCIPLINE_WRITTEN_NOTICE'
            ) {
              const targetEmpCode = String(body.empCode ?? '').trim();
              if (!targetEmpCode) {
                throw badRequest('대상 재직자 사번(empCode)이 필요합니다.');
              }
              if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, targetEmpCode)) {
                sendJson(res, 409, { error: '비식별 파기된 인원의 문서는 발급할 수 없습니다.' });
                return;
              }
              const baseWorker = snap.workers.find((w) => w.empCode === targetEmpCode) || null;
              if (!baseWorker) {
                sendJson(res, 404, { error: '현재 재직자 명부에서 해당 사번을 찾을 수 없습니다.' });
                return;
              }
              const leaveRow = snap.operationsSuite.leaveAndMaternity.ledger.find(
                (l) => l.empCode === baseWorker.empCode
              );
              const discRow = snap.operationsSuite.disciplineAndGrievance.disciplineBoard.find(
                (d) => d.empCode === baseWorker.empCode
              );
              workerRecord = { ...baseWorker, ...(leaveRow || {}), ...(discRow || {}) };
            }
            if (templateId === 'DOC_CAREER_CERTIFICATE' || templateId === 'DOC_EI_SEPARATION_CERT') {
              const targetEmpCode = String(body.empCode ?? '').trim();
              if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, targetEmpCode)) {
                sendJson(res, 409, {
                  error: '3년 법정보존 만료로 비식별 파기된 퇴사자 문서는 발급할 수 없습니다.',
                });
                return;
              }
              alumniRecord = snap.offboardedWorkers.find((a) => a.empCode === targetEmpCode) || null;
              if (!alumniRecord) {
                sendJson(res, 404, { error: '대상 퇴사자 레코드를 찾을 수 없습니다.' });
                return;
              }
              if (alumniRecord.dataLifecycleStatus === 'ANONYMIZED_PURGED') {
                sendJson(res, 409, { error: '3년 법정보존 만료로 비식별 파기된 퇴사자 문서는 발급할 수 없습니다.' });
                return;
              }
            }
            const filingMatch = snap.compliance.statutoryFilings.find(
              (f) => f.docTemplateId === templateId
            );
            const doc = generateStatutoryDocument(templateId, {
              companyName: state.company.companyName,
              bizRegNo: state.company.bizRegNo,
              ksicMajor: state.company.ksicMajor,
              lsaRegularCount: snap.compliance.headcounts.lsaRegularCount,
              oshRegularCount: snap.compliance.headcounts.oshRegularCount,
              triggerDate: state.company.triggerDate,
              referenceDate: state.company.referenceDate,
              dueDate: filingMatch?.dueDate || state.company.referenceDate,
              hasMajorityUnion: state.company.hasMajorityUnion,
              quarterNumber: body.quarterNumber,
              alumniRecord,
              workerRecord,
            });
            sendJson(res, 200, { document: doc });
            return;
          }

          if (pathname === '/api/mobile/offboarded/update-status') {
            if (currentAcc.role !== 'CEO' && currentAcc.role !== 'HR_ADMIN') {
              sendJson(res, 403, { error: '퇴사자 사후관리 상태 변경은 대표이사 또는 인사관리자만 가능합니다.' });
              return;
            }
            if (typeof body.empCode !== 'string' || !body.empCode.trim()) {
              throw badRequest('empCode가 필요합니다.');
            }
            const empCode = body.empCode.trim();
            if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, empCode)) {
              sendJson(res, 409, {
                error: '이미 비식별 파기 완료된 퇴사자 기록은 상태를 변경할 수 없습니다.',
              });
              return;
            }
            const idx = state.offboardedWorkers.findIndex((a) => a.empCode === empCode);
            if (idx < 0) {
              sendJson(res, 404, { error: '대상 퇴사자를 찾을 수 없습니다.' });
              return;
            }
            const updated = updateOffboardedChecklist(
              state.offboardedWorkers[idx],
              body,
              state.company.referenceDate
            );
            state.offboardedWorkers[idx] = updated;
            appendAudit(
              '모바일퇴사관리',
              `[${currentAcc.displayName}] 퇴사자 ${updated.displayName}(${empCode}) 사후관리 이행 상태 갱신`
            );
            mobileHub.pushRealtimeNotification({
              targetRole: 'CEO_AND_HR',
              severity: 'INFO',
              eventCode: 'ALUMNI_STATUS_UPDATED',
              title: `[퇴사자 사후관리] ${updated.displayName}(${empCode}) 이행 상태 갱신`,
              bodySummary: `금품청산(${updated.settlementStatus}) · 건보상실(${updated.nhisLossFilingStatus}) · 고보이직(${updated.eiLossAndCertStatus})`,
            });
            sendJson(res, 200, {
              updated,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/worker/clock') {
            assertOptionalBoolean(body, 'locationConsent');
            const clockStatus = mobileHub.recordWorkerClock(
              mobileCookieToken,
              body,
              (empCode, action, ts) => {
                appendAudit(
                  '모바일출퇴근',
                  `[${empCode}] 모바일 ${action === 'CLOCK_IN' ? '출근' : '퇴근'} 인증 (${ts}, 일회성 위치동의 확인)`
                );
              }
            );
            sendJson(res, 200, {
              clockStatus,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/worker/sign-contract') {
            assertOptionalBoolean(body, 'agreedToTerms');
            const contractStatus = mobileHub.signWorkerContract(mobileCookieToken, body, appendAudit);
            sendJson(res, 200, {
              contractStatus,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          if (pathname === '/api/mobile/worker/request-approval') {
            assertOptionalFiniteNumber(body, 'amount', 0.5, 24);
            const created = mobileHub.createWorkerApprovalRequest(mobileCookieToken, body);
            appendAudit('모바일신청', `[${currentAcc.displayName}] ${created.title} 등록`);
            sendJson(res, 200, {
              created,
              dashboard: mobileHub.buildMobileRoleDashboard(mobileCookieToken, buildSnapshot()),
            });
            return;
          }

          sendJson(res, 404, { error: 'Unknown mobile API endpoint' });
          return;
        }

        // PC 관리자 API 경계 보호: 제한된 모바일 세션(WORKER / DEPT_MANAGER / MFA_PENDING) 보유 브라우저의 우회 접근 차단
        const pcCookies = parseCookieHeader(req.headers.cookie);
        const mobileCookieOnPc = pcCookies[MOBILE_SESSION_COOKIE] || '';
        const pcAdminSession = mobileHub.inspectCookieForPcApiGuard(mobileCookieOnPc, requirePcAuth);
        const expectedPcCsrf = pcAdminSession ? pcAdminSession.csrfToken : csrfToken;

        if (req.method === 'GET' && pathname === '/api/bootstrap') {
          sendJson(res, 200, {
            csrfToken: expectedPcCsrf,
            snapshot: buildSnapshot(),
          });
          return;
        }

        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }

        if (!isAllowedOrigin(req, boundPort)) {
          sendJson(res, 403, { error: 'Forbidden Cross-Origin request' });
          return;
        }

        const headerToken = req.headers['x-csrf-token'];
        if (!verifyCsrfToken(headerToken, expectedPcCsrf)) {
          sendJson(res, 403, { error: 'Invalid or missing CSRF token' });
          return;
        }

        const body = await readJsonBody(req);

        if (pathname === '/api/simulate-company') {
          if (mobileHub.getPayrollCloseState().status === 'APPROVED_LOCKED') {
            const lockErr = new Error(
              '당월 급여대장이 대표이사 최종 승인으로 잠금 확정(APPROVED_LOCKED)되어 사업장 인원·업종·명부 시뮬레이션을 변경할 수 없습니다.'
            );
            lockErr.statusCode = 409;
            throw lockErr;
          }

          if (body.presetId !== undefined) {
            if (typeof body.presetId !== 'string' || !Object.hasOwn(WORKPLACE_PRESETS, body.presetId)) {
              throw badRequest('유효하지 않은 presetId입니다.');
            }
            state.company = structuredClone(WORKPLACE_PRESETS[body.presetId]);
            state.completedTaskIds = [];
            state.emptyRosterMode = false;
            mobileHub.syncWorkerAccessWithRoster(
              state.workers,
              state.offboardedWorkers,
              state.company.bizRegNo
            );
            appendAudit(
              '시뮬레이터',
              `사업장 프리셋 전환: ${state.company.companyName} (${state.company.badge})`
            );
          } else {
            assertOptionalBoolean(body, 'hasMajorityUnion');
            assertOptionalBoolean(body, 'emptyRosterMode');
            assertOptionalBoolean(body, 'resetWorkers');
            assertOptionalBoolean(body, 'bulkRosterMode');
            assertOptionalBoolean(body, 'hasSubsidies');
            assertOptionalBoolean(body, 'resetPeak');

            if (body.ksicMajor !== undefined) {
              if (typeof body.ksicMajor !== 'string' || !Object.hasOwn(INDUSTRIES, body.ksicMajor)) {
                throw badRequest('유효하지 않은 업종 코드(ksicMajor)입니다.');
              }
            }
            if (body.triggerDate !== undefined) {
              assertValidIsoDate(body.triggerDate, 'triggerDate');
            }
            if (body.referenceDate !== undefined) {
              assertValidIsoDate(body.referenceDate, 'referenceDate');
            }
            if (body.headcountInput !== undefined) {
              if (
                body.headcountInput === null ||
                typeof body.headcountInput !== 'object' ||
                Array.isArray(body.headcountInput)
              ) {
                throw badRequest('headcountInput은 객체여야 합니다.');
              }
              const hIn = body.headcountInput;
              assertOptionalInteger(hIn, 'operatingDays', 1, 31);
              assertOptionalInteger(hIn, 'regularWorkers', 0, 5000);
              assertOptionalInteger(hIn, 'partTimeWorkers', 0, 2000);
              assertOptionalFiniteNumber(hIn, 'dailyWorkerManDays', 0, 20000);
              assertOptionalInteger(hIn, 'dispatchedWorkers', 0, 2000);
              assertOptionalInteger(hIn, 'biz33Contractors', 0, 2000);
              assertOptionalInteger(hIn, 'disabledMild', 0, 1000);
              assertOptionalInteger(hIn, 'disabledSevere', 0, 1000);
            }

            const prevPeak = state.company.historicalPeakHeadcount || 0;
            if (typeof body.companyName === 'string' && body.companyName.trim()) {
              state.company.companyName = body.companyName.trim().slice(0, 80);
            }
            if (body.ksicMajor !== undefined) {
              state.company.ksicMajor = body.ksicMajor;
            }
            if (body.hasMajorityUnion !== undefined) {
              state.company.hasMajorityUnion = body.hasMajorityUnion;
            }
            if (body.emptyRosterMode !== undefined) {
              state.emptyRosterMode = body.emptyRosterMode;
              if (!body.emptyRosterMode && state.workers.length === 0) {
                state.workers = createDefaultWorkers();
              }
            }
            if (body.resetWorkers === true) {
              state.workers = createDefaultWorkers();
              state.emptyRosterMode = false;
            }
            if (body.bulkRosterMode === true) {
              state.workers = createBulkWorkers(50);
              state.emptyRosterMode = false;
            }
            if (body.hasSubsidies !== undefined) {
              state.company.activeSubsidies = body.hasSubsidies
                ? ['고용창출장려금', '청년일자리도약장려금']
                : [];
            }
            if (body.triggerDate !== undefined) {
              state.company.triggerDate = body.triggerDate.trim();
            }
            if (body.referenceDate !== undefined) {
              state.company.referenceDate = body.referenceDate.trim();
            }
            if (body.headcountInput) {
              const hi = state.company.headcountInput;
              const src = body.headcountInput;
              if (src.operatingDays !== undefined) hi.operatingDays = src.operatingDays;
              if (src.regularWorkers !== undefined) hi.regularWorkers = src.regularWorkers;
              if (src.partTimeWorkers !== undefined) hi.partTimeWorkers = src.partTimeWorkers;
              if (src.dailyWorkerManDays !== undefined) hi.dailyWorkerManDays = src.dailyWorkerManDays;
              if (src.dispatchedWorkers !== undefined) hi.dispatchedWorkers = src.dispatchedWorkers;
              if (src.biz33Contractors !== undefined) hi.biz33Contractors = src.biz33Contractors;
              if (src.disabledMild !== undefined) hi.disabledMild = src.disabledMild;
              if (src.disabledSevere !== undefined) hi.disabledSevere = src.disabledSevere;
            }

            const nextProvision = provisionWorkplaceSystem({
              ...state.company,
              completedTaskIds: state.completedTaskIds,
            });
            state.company.historicalPeakHeadcount =
              body.resetPeak === true
                ? nextProvision.headcounts.exactLsaRatio
                : Math.max(prevPeak, nextProvision.headcounts.exactLsaRatio);

            appendAudit(
              'Auto-Provisioner',
              `규모·업종 변경 재산정 완료 — 근기법 상시 ${nextProvision.headcounts.lsaRegularCount}인 / 업종 [${INDUSTRIES[state.company.ksicMajor].name}]`
            );
          }

          const updatedSnap = buildSnapshot();
          mobileHub.pushRealtimeNotification({
            targetRole: 'CEO_AND_HR',
            severity: 'WARN',
            eventCode: 'COMPANY_SCALE_UPDATED',
            title: `사업장 규모·업종 재산정 (${updatedSnap.company.companyName})`,
            bodySummary: `근기법 상시 ${updatedSnap.compliance.headcounts.lsaRegularCount}인 · 미이행 법정 과제 ${updatedSnap.compliance.statutoryFilings.filter((f) => !f.isCompleted).length}건`,
          });

          sendJson(res, 200, { snapshot: updatedSnap });
          return;
        }

        if (pathname === '/api/toggle-task') {
          if (
            typeof body.taskId !== 'string' ||
            !VALID_STATUTORY_TASK_IDS.includes(body.taskId.trim())
          ) {
            throw badRequest('유효하지 않은 법정 과제 식별자(taskId)입니다.');
          }
          const taskId = body.taskId.trim();
          const idx = state.completedTaskIds.indexOf(taskId);
          if (idx >= 0) {
            state.completedTaskIds.splice(idx, 1);
            appendAudit('인사담당자', `법정 신고·제정 과제 이행 취소 처리: ${taskId}`);
          } else {
            state.completedTaskIds.push(taskId);
            appendAudit('인사담당자', `법정 신고·제정 과제 이행 완료 증빙 등록: ${taskId}`);
          }
          mobileHub.pushRealtimeNotification({
            targetRole: 'CEO_AND_HR',
            severity: 'INFO',
            eventCode: 'PC_TASK_TOGGLED',
            title: `웹 대시보드 법정 과제 갱신 (${taskId})`,
            bodySummary: 'PC 대시보드에서 법정 신고·제정 과제 이행 상태가 변경되었습니다.',
          });
          sendJson(res, 200, { snapshot: buildSnapshot() });
          return;
        }

        if (pathname === '/api/document') {
          const templateId = String(body.templateId ?? 'DOC_EMPLOYMENT_CONTRACT');
          if (!VALID_DOC_TEMPLATES.includes(templateId)) {
            throw badRequest(`지원하지 않는 문서 템플릿입니다 (${templateId}).`);
          }
          if (body.quarterNumber !== undefined) {
            assertOptionalFiniteNumber(body, 'quarterNumber', 1, 4);
            if (!Number.isInteger(body.quarterNumber)) {
              throw badRequest('quarterNumber는 1~4 사이의 정수여야 합니다.');
            }
          }
          const snap = buildSnapshot();
          let alumniRecord = null;
          let workerRecord = null;
          if (
            templateId === 'DOC_EMPLOYMENT_CERT' ||
            templateId === 'DOC_ANNUAL_LEAVE_PROMOTION' ||
            templateId === 'DOC_DISCIPLINE_WRITTEN_NOTICE'
          ) {
            const targetEmpCode = String(body.empCode ?? '').trim();
            if (!targetEmpCode) {
              throw badRequest('대상 재직자 사번(empCode)이 필요합니다.');
            }
            if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, targetEmpCode)) {
              sendJson(res, 409, { error: '비식별 파기된 인원의 문서는 발급할 수 없습니다.' });
              return;
            }
            const baseWorker = snap.workers.find((w) => w.empCode === targetEmpCode) || null;
            if (!baseWorker) {
              sendJson(res, 404, { error: '현재 재직자 명부에서 해당 사번을 찾을 수 없습니다.' });
              return;
            }
            const leaveRow = snap.operationsSuite.leaveAndMaternity.ledger.find(
              (l) => l.empCode === baseWorker.empCode
            );
            const discRow = snap.operationsSuite.disciplineAndGrievance.disciplineBoard.find(
              (d) => d.empCode === baseWorker.empCode
            );
            workerRecord = {
              ...baseWorker,
              ...(leaveRow || {}),
              ...(discRow || {}),
            };
          }
          if (templateId === 'DOC_CAREER_CERTIFICATE' || templateId === 'DOC_EI_SEPARATION_CERT') {
            const targetEmpCode = String(body.empCode ?? '').trim();
            if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, targetEmpCode)) {
              sendJson(res, 409, {
                error: '3년 법정보존 만료로 비식별 파기된 퇴사자 문서는 발급할 수 없습니다.',
              });
              return;
            }
            const alIdx = state.offboardedWorkers.findIndex((a) => a.empCode === targetEmpCode);
            if (alIdx < 0) {
              sendJson(res, 404, { error: '대상 퇴사자 레코드를 찾을 수 없습니다.' });
              return;
            }
            const currentAl = refreshOffboardedLifecycle(
              state.offboardedWorkers[alIdx],
              state.company.referenceDate
            );
            if (currentAl.dataLifecycleStatus === 'ANONYMIZED_PURGED') {
              sendJson(res, 409, { error: '3년 법정보존 만료로 비식별 파기된 퇴사자 문서는 발급할 수 없습니다.' });
              return;
            }
            if (templateId === 'DOC_CAREER_CERTIFICATE') {
              state.offboardedWorkers[alIdx] = updateOffboardedChecklist(
                currentAl,
                { incrementCareerCert: true },
                state.company.referenceDate
              );
              alumniRecord = state.offboardedWorkers[alIdx];
            } else {
              alumniRecord = currentAl;
            }
          }
          const filingMatch = snap.compliance.statutoryFilings.find(
            (f) => f.docTemplateId === templateId
          );
          const doc = generateStatutoryDocument(templateId, {
            companyName: state.company.companyName,
            bizRegNo: state.company.bizRegNo,
            ksicMajor: state.company.ksicMajor,
            lsaRegularCount: snap.compliance.headcounts.lsaRegularCount,
            oshRegularCount: snap.compliance.headcounts.oshRegularCount,
            triggerDate: state.company.triggerDate,
            referenceDate: state.company.referenceDate,
            dueDate: filingMatch?.dueDate || state.company.referenceDate,
            hasMajorityUnion: state.company.hasMajorityUnion,
            quarterNumber: body.quarterNumber,
            alumniRecord,
            workerRecord,
          });
          appendAudit('문서엔진', `법정 문서 초안 열람: ${doc.title}`);
          sendJson(res, 200, { document: doc, auditLogs: state.auditLogs, snapshot: buildSnapshot() });
          return;
        }

        if (pathname === '/api/validate-posting') {
          assertOptionalFiniteNumber(body, 'weeklyHours', 1, 80);
          assertOptionalFiniteNumber(body, 'offeredMonthlyPay', 0, 200000000);
          const snap = buildSnapshot();
          const result = validateJobPosting({
            lsaRegularCount: snap.compliance.headcounts.exactLsaRatio,
            title: String(body.title ?? '').slice(0, 200),
            bodyText: String(body.bodyText ?? '').slice(0, 4000),
            weeklyHours: body.weeklyHours ?? 40,
            offeredMonthlyPay: body.offeredMonthlyPay ?? 2500000,
          });
          sendJson(res, 200, { result });
          return;
        }

        // ============================================================
        // 멀티문서 자동 온보딩(사업자등록증·홍보자료·건보·고보 대사) & 퇴사자 통합관리 API
        // ============================================================
        if (pathname === '/api/onboarding/stage') {
          const staging = stageMultiDocumentBundle(resolveIngestionInput(body), {
            tombstoneStore: purgeTombstones,
          });
          appendAudit(
            '문서온보딩',
            `멀티문서 교차검증 프리뷰 완료: ${staging.stagedCompany.companyName} (재직 ${staging.activeWorkers.length}명 · 퇴사 ${staging.offboardedWorkers.length}명 · 대사알림 ${staging.reconciliationAlerts.length}건)`
          );
          sendJson(res, 200, { staging, auditLogs: state.auditLogs });
          return;
        }

        if (pathname === '/api/onboarding/commit') {
          if (mobileHub.getPayrollCloseState().status === 'APPROVED_LOCKED') {
            const lockErr = new Error(
              '당월 급여대장이 대표이사 최종 승인으로 잠금 확정(APPROVED_LOCKED)되어 멀티문서 일괄 덮어쓰기를 수행할 수 없습니다.'
            );
            lockErr.statusCode = 409;
            throw lockErr;
          }
          assertOptionalBoolean(body, 'replaceAlumniLedger');
          const staging = stageMultiDocumentBundle(resolveIngestionInput(body), {
            tombstoneStore: purgeTombstones,
          });
          const safeActiveWorkers = staging.activeWorkers.filter(
            (w) =>
              !purgeTombstones.isEmpCodePurged(staging.stagedCompany.bizRegNo, w.empCode) &&
              !purgeTombstones.isRecordPurged({
                bizRegNo: staging.stagedCompany.bizRegNo,
                empCode: w.empCode,
                displayName: w.displayName,
                maskedBirthOrId: w.maskedBirthOrId,
                hireDate: w.hireDate,
              })
          );
          const mergedOffboarded = mergeOffboardedLedgers(
            state.offboardedWorkers,
            staging.offboardedWorkers,
            {
              replaceAlumniLedger: body.replaceAlumniLedger === true,
              serverTodayIso: serverClockToday(),
              displayReferenceDate: staging.stagedCompany.referenceDate,
              tombstoneStore: purgeTombstones,
            }
          );
          const nextWorkersWithIds = assignImmutablePersonIds(
            state.company.bizRegNo,
            state.workers,
            staging.stagedCompany.bizRegNo,
            safeActiveWorkers
          );
          state.company = structuredClone(staging.stagedCompany);
          state.completedTaskIds = [];
          state.emptyRosterMode = false;
          state.workers = nextWorkersWithIds;
          state.offboardedWorkers = mergedOffboarded;
          mobileHub.syncWorkerAccessWithRoster(
            state.workers,
            state.offboardedWorkers,
            state.company.bizRegNo
          );

          state.lastIngestionSummary = {
            companyName: state.company.companyName,
            bizRegNo: state.company.bizRegNo,
            ksicMajor: state.company.ksicMajor,
            activeWorkersCount: state.workers.length,
            offboardedWorkersCount: state.offboardedWorkers.length,
            excludedEmployersCount: staging.excludedEmployers.length,
            reconciliationAlertCount: staging.reconciliationAlerts.length,
            autoActivatedModulesCount: staging.compliancePreview.autoActivatedModules.length,
            committedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          };

          appendAudit(
            '자동온보딩개통',
            `[${state.company.companyName}] 4종 문서 일괄 개통 완료 (재직 ${state.workers.length}명 · 퇴사자 원장 ${state.offboardedWorkers.length}명 · 대표자 제외 ${staging.excludedEmployers.length}명)`
          );
          mobileHub.pushRealtimeNotification({
            targetRole: 'CEO_AND_HR',
            severity: staging.reconciliationAlerts.some((a) => a.level === 'CRITICAL') ? 'CRITICAL' : 'INFO',
            eventCode: 'WORKPLACE_AUTO_LINKED',
            title: `[자동 온보딩 개통] ${state.company.companyName} 전 모듈 연결 완료`,
            bodySummary: `재직 ${state.workers.length}명 · 퇴사자 ${state.offboardedWorkers.length}명 · 법정 자동모듈 ${staging.compliancePreview.autoActivatedModules.length}개 즉시 동기화`,
          });

          sendJson(res, 200, {
            committed: state.lastIngestionSummary,
            staging,
            snapshot: buildSnapshot(),
          });
          return;
        }

        if (pathname === '/api/offboard-worker') {
          if (mobileHub.getPayrollCloseState().status === 'APPROVED_LOCKED') {
            const lockErr = new Error(
              '당월 급여대장이 대표이사 최종 승인으로 잠금 확정(APPROVED_LOCKED)되어 재직자 퇴사 전환을 수행할 수 없습니다.'
            );
            lockErr.statusCode = 409;
            throw lockErr;
          }
          if (typeof body.empCode !== 'string' || !body.empCode.trim()) {
            throw badRequest('퇴사 처리할 근로자 사번(empCode)이 필요합니다.');
          }
          if (body.resignReason !== undefined) {
            if (typeof body.resignReason !== 'string' || !VALID_RESIGN_REASONS.includes(body.resignReason)) {
              throw badRequest(
                `유효하지 않은 resignReason입니다. 허용값: ${VALID_RESIGN_REASONS.join(', ')}`
              );
            }
          }
          const lastWorkDate = assertValidIsoDate(
            body.lastWorkDate || state.company.referenceDate,
            'lastWorkDate'
          );
          assertOptionalFiniteNumber(body, 'unusedLeaveDays', 0, 100);
          assertOptionalFiniteNumber(body, 'advanceNoticeDaysGiven', 0, 365);
          assertOptionalBoolean(body, 'writtenDismissalNoticeGiven');

          const empCode = body.empCode.trim();
          const workerIdx = state.workers.findIndex((w) => w.empCode === empCode);
          if (workerIdx < 0) {
            sendJson(res, 404, { error: '재직자 명부에서 해당 사번을 찾을 수 없습니다.' });
            return;
          }

          const worker = state.workers[workerIdx];
          if (worker.workerCategory === 'BIZ_33') {
            throw badRequest(
              `3.3% 사업소득 계약자(${worker.empCode})는 근로기준법상 퇴직금·고용보험 피보험자 상실 원장 대상이 아니며 외주계약 종료로 관리됩니다.`
            );
          }

          const isDaily = worker.workerCategory === 'DAILY';
          const dailyWorkDays = Math.max(1, Number(worker.dailyWorkDays ?? 1));
          const dailyWage = Math.max(0, Number(worker.dailyWage ?? 150000));
          const effectiveWeeklyHours = isDaily
            ? Math.min(40, Math.max(8, Math.round((dailyWorkDays * 8) / 4.345)))
            : worker.weeklyHours || 40;
          const effectiveBaseMonthly = isDaily
            ? dailyWage * dailyWorkDays
            : worker.baseMonthlyPay ?? 3000000;
          const effectiveMeal = isDaily
            ? worker.mealAllowance ?? 0
            : worker.mealAllowance ?? 200000;

          const snapBefore = buildSnapshot();
          const offboardedRecord = buildOffboardedWorkerRecord(
            {
              personId: worker.personId || null,
              bizRegNo: state.company.bizRegNo,
              empCode: worker.empCode,
              displayName: worker.displayName,
              deptName: worker.deptName,
              jobTitle: worker.jobTitle || (isDaily ? '일용근로' : '담당'),
              maskedBirthOrId: worker.maskedBirthOrId || '******-*',
              hireDate: worker.hireDate || lastWorkDate,
              lastWorkDate,
              resignReason: body.resignReason || 'VOLUNTARY',
              weeklyContractHours: effectiveWeeklyHours,
              baseMonthlyPay: effectiveBaseMonthly,
              fixedAllowance: worker.fixedOrdinaryAllowance || 0,
              mealAllowance: effectiveMeal,
              unusedLeaveDays: body.unusedLeaveDays ?? worker.unusedLeavePayoutDays ?? 0,
              advanceNoticeDaysGiven: body.advanceNoticeDaysGiven ?? 30,
              writtenDismissalNoticeGiven: body.writtenDismissalNoticeGiven !== false,
              settlementStatus: 'PENDING',
              nhisLossFilingStatus: isDaily ? 'FILED' : 'PENDING',
              eiLossAndCertStatus: 'PENDING',
              ingestionSource: 'HR_OFFBOARD_ACTION',
            },
            {
              referenceDate: state.company.referenceDate,
              bizRegNo: state.company.bizRegNo,
              lsaRegularCount: snapBefore.compliance.headcounts.exactLsaRatio,
              activeSubsidies: state.company.activeSubsidies,
            }
          );

          state.workers.splice(workerIdx, 1);
          state.offboardedWorkers.unshift(offboardedRecord);

          // 고용구분(DAILY / PART_TIME / REGULAR)별 상시근로자 입력치 동기 차감 (historicalPeakHeadcount는 보존!)
          if (isDaily) {
            state.company.headcountInput.dailyWorkerManDays = Math.max(
              0,
              (state.company.headcountInput.dailyWorkerManDays || 0) - dailyWorkDays
            );
          } else if (
            (worker.workerCategory === 'PART_TIME' || (worker.weeklyHours || 40) < 40) &&
            state.company.headcountInput.partTimeWorkers > 0
          ) {
            state.company.headcountInput.partTimeWorkers -= 1;
          } else if (state.company.headcountInput.regularWorkers > 0) {
            state.company.headcountInput.regularWorkers -= 1;
          }

          const { revokedSessionCount } = mobileHub.revokeWorkerAccessOnOffboard(
            empCode,
            '인사원장 퇴사 전환'
          );

          appendAudit(
            '퇴사원장전환',
            `[${empCode} ${worker.displayName}] 퇴사자 통합 원장 편입 (${offboardedRecord.resignReasonLabel}, 금품청산 기한 ${offboardedRecord.settlementDueDate}, 모바일 세션 ${revokedSessionCount}건 즉시 해지)`
          );
          mobileHub.pushRealtimeNotification({
            targetRole: 'CEO_AND_HR',
            severity: offboardedRecord.subsidyClawbackRisk ? 'CRITICAL' : 'WARN',
            eventCode: 'WORKER_OFFBOARDED',
            title: `[퇴사 전환·세션차단] ${worker.displayName}(${empCode}) 퇴사자 원장 등록`,
            bodySummary: `14일 청산기한 ${offboardedRecord.settlementDueDate} · 정산예정 ${offboardedRecord.totalSettlementGross.toLocaleString('ko-KR')}원 · 모바일 차단 완료`,
          });

          sendJson(res, 200, {
            offboardedRecord,
            revokedSessionCount,
            snapshot: buildSnapshot(),
          });
          return;
        }

        if (pathname === '/api/offboarded/update-status') {
          if (typeof body.empCode !== 'string' || !body.empCode.trim()) {
            throw badRequest('empCode가 필요합니다.');
          }
          const empCode = body.empCode.trim();
          if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, empCode)) {
            sendJson(res, 409, {
              error: '이미 비식별 파기 완료된 퇴사자 기록은 상태를 변경할 수 없습니다.',
            });
            return;
          }
          const idx = state.offboardedWorkers.findIndex((a) => a.empCode === empCode);
          if (idx < 0) {
            sendJson(res, 404, { error: '퇴사자 원장에서 해당 사번을 찾을 수 없습니다.' });
            return;
          }
          const updated = updateOffboardedChecklist(
            state.offboardedWorkers[idx],
            body,
            state.company.referenceDate
          );
          state.offboardedWorkers[idx] = updated;
          appendAudit(
            '퇴사사후관리',
            `[${empCode} ${updated.displayName}] 금품청산(${updated.settlementStatus}) · 건보상실(${updated.nhisLossFilingStatus}) · 고보이직(${updated.eiLossAndCertStatus}) 상태 갱신`
          );
          mobileHub.pushRealtimeNotification({
            targetRole: 'CEO_AND_HR',
            severity: 'INFO',
            eventCode: 'ALUMNI_STATUS_UPDATED',
            title: `[퇴사 사후관리 갱신] ${updated.displayName}(${empCode})`,
            bodySummary: `금품청산 ${updated.settlementStatus} / 건보 ${updated.nhisLossFilingStatus} / 고보 ${updated.eiLossAndCertStatus}`,
          });
          sendJson(res, 200, { updated, snapshot: buildSnapshot() });
          return;
        }

        if (pathname === '/api/offboarded/purge-pii') {
          if (typeof body.empCode !== 'string' || !body.empCode.trim()) {
            throw badRequest('empCode가 필요합니다.');
          }
          const empCode = body.empCode.trim();
          if (purgeTombstones.isEmpCodePurged(state.company.bizRegNo, empCode)) {
            sendJson(res, 409, {
              error: '이미 개인정보 비식별 파기가 완료된 레코드입니다.',
            });
            return;
          }
          const idx = state.offboardedWorkers.findIndex((a) => a.empCode === empCode);
          if (idx < 0) {
            sendJson(res, 404, { error: '퇴사자 원장에서 해당 사번을 찾을 수 없습니다.' });
            return;
          }
          const origPersonId = state.offboardedWorkers[idx].personId || null;
          const origEmpCode = state.offboardedWorkers[idx].empCode;
          const origDisplayName = state.offboardedWorkers[idx].displayName;
          // 시뮬레이션 날짜 조작 우회를 원천 차단하기 위해 서버 현재시각(serverClockToday)만 파기 판정 시계로 사용!
          const purged = purgeExpiredOffboardedPii(
            state.offboardedWorkers[idx],
            serverClockToday(),
            purgeTombstones
          );
          state.offboardedWorkers[idx] = purged;
          scrubPurgedFromAuditLogs(origEmpCode, origDisplayName);
          opsSuite.scrubPurgedPerson(origEmpCode, origDisplayName, origPersonId);
          mobileHub.scrubPurgedPersonFromHub({
            origPersonId,
            origEmpCode,
            origDisplayName,
          });
          appendAudit(
            '개인정보파기',
            '퇴사 3년 법정보존 만료 건(1건) 개인정보보호법 제21조 비가역 비식별 파기 및 연관 감사·결재·알림 이력 일괄 삭제 완료'
          );
          mobileHub.pushRealtimeNotification({
            targetRole: 'CEO_AND_HR',
            severity: 'INFO',
            eventCode: 'ALUMNI_PII_PURGED',
            title: '[보존만료 파기] 3년 경과 퇴사자 개인정보 비가역 파기 완료',
            bodySummary: `서버 현재시각(${purged.anonymizedAt}) 기준 3년 보존기간 경과 레코드 및 복제 이력이 일괄 삭제되었습니다.`,
          });
          sendJson(res, 200, { purged, snapshot: buildSnapshot() });
          return;
        }

        if (pathname === '/api/ops/action') {
          const preSnap = buildSnapshot();
          const actionResult = opsSuite.applyAction(body, {
            state,
            payrollLocked: mobileHub.getPayrollCloseState().status === 'APPROVED_LOCKED',
            appendAudit,
            tombstoneStore: purgeTombstones,
            lsaRegularCount: preSnap.compliance.headcounts.exactLsaRatio,
          });
          mobileHub.syncWorkerAccessWithRoster(
            state.workers,
            state.offboardedWorkers,
            state.company.bizRegNo
          );
          sendJson(res, 200, {
            result: actionResult,
            snapshot: buildSnapshot(),
          });
          return;
        }

        if (pathname === '/api/update-worker-event') {
          if (mobileHub.getPayrollCloseState().status === 'APPROVED_LOCKED') {
            const lockErr = new Error(
              '당월 급여대장이 대표이사 최종 승인으로 잠금 확정되어 수정할 수 없습니다.'
            );
            lockErr.statusCode = 409;
            throw lockErr;
          }
          if (typeof body.empCode !== 'string' || !body.empCode.trim()) {
            throw badRequest('empCode가 필요합니다.');
          }
          assertOptionalFiniteNumber(body, 'baseMonthlyPay', 0, 50000000);
          assertOptionalFiniteNumber(body, 'mealAllowance', 0, 5000000);
          assertOptionalFiniteNumber(body, 'overtimeHours', 0, 120);
          assertOptionalFiniteNumber(body, 'nightHours', 0, 120);
          assertOptionalFiniteNumber(body, 'holidayLe8Hours', 0, 80);
          assertOptionalFiniteNumber(body, 'maxWeeklyWorkedHours', 0, 168);
          assertOptionalFiniteNumber(body, 'unusedLeavePayoutDays', 0, 40);
          assertOptionalFiniteNumber(body, 'evalRaiseRatePct', 0, 100);
          assertOptionalFiniteNumber(body, 'evalBonusPay', 0, 50000000);
          assertOptionalFiniteNumber(body, 'requestedDisciplinaryCut', 0, 10000000);

          assertOptionalBoolean(body, 'attendanceNoticeSent');
          assertOptionalBoolean(body, 'defenseOpportunityGiven');
          assertOptionalBoolean(body, 'committeeResolved');
          assertOptionalBoolean(body, 'writtenNoticeDelivered');

          const empCode = body.empCode.trim();
          const target = state.workers.find((w) => w.empCode === empCode);
          if (!target) {
            sendJson(res, 404, { error: '대상 근로자를 찾을 수 없습니다.' });
            return;
          }

          if (body.baseMonthlyPay !== undefined) target.baseMonthlyPay = Math.round(body.baseMonthlyPay);
          if (body.mealAllowance !== undefined) target.mealAllowance = Math.round(body.mealAllowance);
          if (body.overtimeHours !== undefined) target.overtimeHours = body.overtimeHours;
          if (body.nightHours !== undefined) target.nightHours = body.nightHours;
          if (body.holidayLe8Hours !== undefined) target.holidayLe8Hours = body.holidayLe8Hours;
          if (body.unusedLeavePayoutDays !== undefined) target.unusedLeavePayoutDays = body.unusedLeavePayoutDays;
          if (body.evalRaiseRatePct !== undefined) target.evalRaiseRatePct = body.evalRaiseRatePct;
          if (body.evalBonusPay !== undefined) target.evalBonusPay = Math.round(body.evalBonusPay);
          if (body.requestedDisciplinaryCut !== undefined) {
            target.requestedDisciplinaryCut = Math.round(body.requestedDisciplinaryCut);
          }
          if (body.attendanceNoticeSent !== undefined) target.attendanceNoticeSent = body.attendanceNoticeSent;
          if (body.defenseOpportunityGiven !== undefined) {
            target.defenseOpportunityGiven = body.defenseOpportunityGiven;
          }
          if (body.committeeResolved !== undefined) target.committeeResolved = body.committeeResolved;
          if (body.writtenNoticeDelivered !== undefined) {
            target.writtenNoticeDelivered = body.writtenNoticeDelivered;
          }

          // 실제 주별 최고 근로시간을 덮어써 소실하지 않도록 명시 입력 시에만 반영하고,
          // 미전달 시에는 기존 피크값과 월 평균 환산치 중 큰 값을 유지한다.
          const minWeeklyFloor =
            (target.weeklyHours || 40) +
            ((target.overtimeHours || 0) + (target.holidayLe8Hours || 0) + (target.holidayGt8Hours || 0)) / 4.345;
          if (body.maxWeeklyWorkedHours !== undefined) {
            target.maxWeeklyWorkedHours = Math.max(body.maxWeeklyWorkedHours, minWeeklyFloor);
          } else {
            target.maxWeeklyWorkedHours = Math.max(target.maxWeeklyWorkedHours || 0, minWeeklyFloor);
          }

          appendAudit(
            '급여파이프라인',
            `근로자 [${target.empCode} ${target.displayName}] 인사·근태·보상·징계 이벤트 갱신 → 급여 자동 재정산`
          );
          mobileHub.pushRealtimeNotification({
            targetRole: 'ALL_MANAGERS',
            targetDeptName: target.deptName,
            severity: target.maxWeeklyWorkedHours > 52 ? 'CRITICAL' : 'INFO',
            eventCode: 'WORKER_PAYROLL_UPDATED',
            title: `[급여·근태 변경] ${target.empCode} ${target.displayName}`,
            bodySummary: `주 최대 근로 ${target.maxWeeklyWorkedHours.toFixed(1)}h · 급여 파이프라인 자동 재산정 완료`,
          });
          sendJson(res, 200, { snapshot: buildSnapshot() });
          return;
        }

        if (pathname === '/api/preview-offboarding') {
          if (body.resignReason !== undefined) {
            if (typeof body.resignReason !== 'string' || !VALID_RESIGN_REASONS.includes(body.resignReason)) {
              throw badRequest(
                `유효하지 않은 resignReason입니다. 허용값: ${VALID_RESIGN_REASONS.join(', ')}`
              );
            }
          }
          if (body.lastWorkDate !== undefined) {
            assertValidIsoDate(body.lastWorkDate, 'lastWorkDate');
          }
          assertOptionalBoolean(body, 'writtenDismissalNoticeGiven');
          assertOptionalInteger(body, 'serviceDays', 0, 20000);
          assertOptionalFiniteNumber(body, 'weeklyHours', 1, 80);
          assertOptionalFiniteNumber(body, 'threeMonthWageTotal', 0, 500000000);
          assertOptionalInteger(body, 'threeMonthDays', 89, 92);
          assertOptionalFiniteNumber(body, 'annualBonusTotal', 0, 500000000);
          assertOptionalFiniteNumber(body, 'ordinaryHourlyWage', 0, 1000000);
          assertOptionalFiniteNumber(body, 'dailyHours', 1, 24);
          assertOptionalFiniteNumber(body, 'unusedLeaveDays', 0, 100);
          assertOptionalFiniteNumber(body, 'advanceNoticeDaysGiven', 0, 365);

          const snap = buildSnapshot();
          const result = computeOffboardingSettlement({
            resignReason: body.resignReason ?? 'VOLUNTARY',
            serviceDays: body.serviceDays ?? 730,
            weeklyHours: body.weeklyHours ?? 40,
            threeMonthWageTotal: body.threeMonthWageTotal ?? 9600000,
            threeMonthDays: body.threeMonthDays ?? 91,
            annualBonusTotal: body.annualBonusTotal ?? 1200000,
            ordinaryHourlyWage: body.ordinaryHourlyWage ?? 17200,
            dailyHours: body.dailyHours ?? 8,
            unusedLeaveDays: body.unusedLeaveDays ?? 4,
            lastWorkDate: body.lastWorkDate ?? '2026-11-30',
            lsaRegularCount: snap.compliance.headcounts.exactLsaRatio,
            activeSubsidies: state.company.activeSubsidies,
            advanceNoticeDaysGiven: body.advanceNoticeDaysGiven ?? 30,
            writtenDismissalNoticeGiven: body.writtenDismissalNoticeGiven === true,
          });
          sendJson(res, 200, { result });
          return;
        }

        sendJson(res, 404, { error: 'Unknown API endpoint' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method Not Allowed' });
        return;
      }

      let decodedPath = '/';
      try {
        decodedPath = decodeURIComponent(pathname);
      } catch {
        sendJson(res, 400, { error: 'Malformed URL path' });
        return;
      }

      if (decodedPath.includes('\0')) {
        sendJson(res, 400, { error: 'Invalid path' });
        return;
      }

      const relTarget = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
      const resolvedFile = path.resolve(PUBLIC_DIR, relTarget);
      const relativeCheck = path.relative(PUBLIC_DIR, resolvedFile);

      if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
        sendJson(res, 403, { error: 'Path traversal blocked' });
        return;
      }

      if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
        sendJson(res, 404, { error: 'Not Found' });
        return;
      }

      const ext = path.extname(resolvedFile).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      setSecurityHeaders(res);
      res.setHeader('Content-Type', mime);
      if (path.basename(resolvedFile) === 'sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
      }
      res.writeHead(200);
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(resolvedFile).pipe(res);
      }
    } catch (err) {
      const hasExplicitStatus = Number.isInteger(err?.statusCode);
      const code = hasExplicitStatus ? err.statusCode : 500;
      const safeMessage =
        hasExplicitStatus && (code < 500 || code === 503)
          ? err.message
          : '서버 내부 처리 중 오류가 발생했습니다.';
      sendJson(res, code, { error: safeMessage });
    }
  });

  server.on('close', () => {
    mobileHub.closeAllStreams();
  });

  return { server, csrfToken, mobileHub, getSnapshot: buildSnapshot };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  const port = Number(process.env.PORT || 4330);
  const { server } = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;

    // Chromium(*.localhost RFC 6761)이 IPv6 루프백(::1)을 먼저 시도하는 환경에서도 지연 없이 응답하도록 ::1 루프백 동시 바인딩 (외부 네트워크 노출 없음)
    const ipv6Loopback = http.createServer((req, res) => {
      server.emit('request', req, res);
    });
    ipv6Loopback.on('error', () => {
      // IPv6 비활성 OS 환경에서는 조용히 무시하고 127.0.0.1 유지
    });
    ipv6Loopback.listen(actualPort, '::1');
    server.on('close', () => {
      try {
        ipv6Loopback.close();
      } catch {
        // ignore
      }
    });

    console.log(`[modular-hr] 전용 로컬 도메인(추천): http://modular-hr.localhost:${actualPort}/`);
    console.log(`[modular-hr] PC 통합 대시보드(IPv4): http://127.0.0.1:${actualPort}/`);
    console.log(`[modular-hr] 모바일 폰 앱(PWA)    : http://modular-hr.localhost:${actualPort}/mobile.html`);
    if (process.env.MHR_DEMO_MODE === '1') {
      console.log('[modular-hr] MHR_DEMO_MODE=1 활성화 (로컬 시뮬레이터 체험 모드)');
    } else {
      console.log(
        '[modular-hr] 기본 보안 모드 실행 중 (초기 자격증명 평문 로그 비출력 — MHR_INIT_CREDENTIALS_JSON 환경변수 주입 또는 로컬 체험 시 MHR_DEMO_MODE=1 사용)'
      );
    }
  });
}
