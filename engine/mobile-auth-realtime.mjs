/**
 * 모바일 폰 앱 인증(비동기 scrypt + 분리된 잠금 카운터 + 6자리 PIN / ECDSA P-256 패스키 서명 검증),
 * SHA-256 세션 해시 레지스트리, 역할 기반 최소권한(RBAC: CEO / HR_ADMIN / DEPT_MANAGER / WORKER),
 * 2단계 결재 상태 머신(PENDING_DEPT -> PENDING_CEO -> APPROVED), 급여 잠금(APPROVED_LOCKED) 보호 및
 * 실시간 SSE(Server-Sent Events) 브로드캐스트 엔진
 */

import crypto from './browser-crypto-shim.mjs?v=d45cbd6fd2ba';

const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const MAX_SSE_CLIENTS = 32;
const MAX_SSE_PER_SESSION = 12;
const MAX_STORED_SESSIONS = 120;
const PER_BUCKET_AUTH_LIMIT = 15;
const AUTH_BUCKET_WINDOW_MS = 60 * 1000;
const MAX_RATE_BUCKETS = 1000;
const MAX_UNKNOWN_TRACKED = 500;
const UNIFIED_LOCKOUT_MSG =
  '연속 인증 실패로 계정이 일시 잠금되었습니다. 잠시 후 다시 시도해 주세요.';

export const VALID_ROLES = Object.freeze(['CEO', 'HR_ADMIN', 'DEPT_MANAGER', 'WORKER']);
export const VALID_PLATFORMS = Object.freeze([
  'IOS_PWA',
  'ANDROID_PWA',
  'MOBILE_WEB',
  'HYBRID_APP',
  'DESKTOP_PWA',
]);
export const VALID_APPROVAL_TYPES = Object.freeze([
  'LEAVE',
  'OVERTIME',
  'PAYROLL_CLOSE',
  'DISCIPLINE',
  'STATUTORY_FILING',
]);

function httpError(statusCode, message, code = 'ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function scryptAsync(plainText, saltBuf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(plainText), saltBuf, 32, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function hashSecretSync(plainText, saltHex = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(plainText), Buffer.from(saltHex, 'hex'), 32, SCRYPT_PARAMS);
  return `${saltHex}:${derived.toString('hex')}`;
}

async function verifySecretAsync(plainText, storedHash) {
  if (typeof plainText !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, expectedHex] = parts;
  const actual = await scryptAsync(plainText, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function sha256Hex(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

export function buildWorkerBindingKey(
  bizRegNo,
  empCode,
  displayName,
  maskedBirthOrId = '',
  hireDate = ''
) {
  const b = String(bizRegNo || '').replace(/[^0-9]/g, '');
  const e = String(empCode || '').trim().toUpperCase();
  const n = String(displayName || '').replace(/\s+/g, '');
  const id6 = String(maskedBirthOrId || '').match(/^(\d{6})/)?.[1] || '';
  const h = String(hireDate || '').trim();
  // 필수 신원 속성(사업자번호·사번·성명·실제 생년월일 6자리·입사일) 중 하나라도 누락되면 폴백 없이 즉시 null 반환(Fail-Closed)
  if (!b || !e || !n || !id6 || !/^\d{4}-\d{2}-\d{2}$/.test(h)) {
    return null;
  }
  return sha256Hex(`${b}::${e}::${n}::${id6}::${h}`);
}

export function safeCompareHexOrText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function randomPassword() {
  return `Mhr!${crypto.randomBytes(12).toString('base64url')}`;
}

function randomSixDigitPin() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * 모바일 인증·권한·결재·실시간 알림 허브 인스턴스 생성
 */
export function createMobileHub(options = {}) {
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  const demoMode = options.demoMode === true;
  let envSeed = null;
  if (!options.seedCredentials && process.env.MHR_INIT_CREDENTIALS_JSON) {
    if (demoMode) {
      throw new Error(
        '보안 정책 위반: MHR_DEMO_MODE=1 활성화 상태에서는 MHR_INIT_CREDENTIALS_JSON 시드 자격증명을 동시에 사용할 수 없습니다.'
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(process.env.MHR_INIT_CREDENTIALS_JSON);
    } catch {
      throw new Error('MHR_INIT_CREDENTIALS_JSON 환경변수가 올바른 JSON 형식이 아닙니다.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('MHR_INIT_CREDENTIALS_JSON 환경변수는 계정별 JSON 객체여야 합니다.');
    }
    const allowedIds = new Set(['ceo', 'hr.admin', 'dept.lead', 'emp.201']);
    const mfaIds = new Set(['ceo', 'hr.admin', 'dept.lead']);
    for (const [id, cred] of Object.entries(parsed)) {
      if (!allowedIds.has(id) || !cred || typeof cred !== 'object' || Array.isArray(cred)) {
        throw new Error(`MHR_INIT_CREDENTIALS_JSON 내 허용되지 않은 계정 항목입니다: ${id}`);
      }
      if (cred.password !== undefined) {
        if (typeof cred.password !== 'string' || cred.password.trim().length < 8) {
          throw new Error(`MHR_INIT_CREDENTIALS_JSON [${id}] password는 최소 8자 이상 문자열이어야 합니다.`);
        }
      }
      if (cred.pin !== undefined && cred.pin !== null) {
        if (!mfaIds.has(id) || typeof cred.pin !== 'string' || !/^\d{6}$/.test(cred.pin)) {
          throw new Error(`MHR_INIT_CREDENTIALS_JSON [${id}] pin은 6자리 숫자 문자열이어야 합니다.`);
        }
      }
    }
    envSeed = parsed;
  }
  const seed = options.seedCredentials || envSeed || {};
  const dummyHash = hashSecretSync('dummy-constant-time-guard');

  // 하드코딩 비밀번호/PIN 제거: 매 기동 시 계정별 난수 비밀번호·6자리 PIN 생성 (테스트 주입 시에만 seed 사용)
  const bootGeneratedSecrets = {
    ceo: {
      password: seed.ceo?.password || randomPassword(),
      pin: seed.ceo?.pin || randomSixDigitPin(),
    },
    'hr.admin': {
      password: seed['hr.admin']?.password || randomPassword(),
      pin: seed['hr.admin']?.pin || randomSixDigitPin(),
    },
    'dept.lead': {
      password: seed['dept.lead']?.password || randomPassword(),
      pin: seed['dept.lead']?.pin || randomSixDigitPin(),
    },
    'emp.201': {
      password: seed['emp.201']?.password || randomPassword(),
      pin: null,
    },
  };

  const accounts = new Map([
    [
      'ceo',
      {
        accountId: 'ACC-CEO-01',
        loginId: 'ceo',
        displayName: '강대표 (대표이사)',
        role: 'CEO',
        roleLabel: '대표이사 (CEO)',
        managedDeptName: null,
        empCode: null,
        passwordHash: hashSecretSync(bootGeneratedSecrets.ceo.password),
        pinHash: hashSecretSync(bootGeneratedSecrets.ceo.pin),
        passkeyEnabled: false,
        passkeyCredId: null,
        passkeyPublicKeyObj: null,
        mfaRequired: true,
        pwFailedAttempts: 0,
        mfaFailedAttempts: 0,
        lockedUntil: 0,
      },
    ],
    [
      'hr.admin',
      {
        accountId: 'ACC-HR-01',
        loginId: 'hr.admin',
        displayName: '윤인사 (인사노무팀장)',
        role: 'HR_ADMIN',
        roleLabel: '인사노무관리자',
        managedDeptName: null,
        empCode: null,
        passwordHash: hashSecretSync(bootGeneratedSecrets['hr.admin'].password),
        pinHash: hashSecretSync(bootGeneratedSecrets['hr.admin'].pin),
        passkeyEnabled: false,
        passkeyCredId: null,
        passkeyPublicKeyObj: null,
        mfaRequired: true,
        pwFailedAttempts: 0,
        mfaFailedAttempts: 0,
        lockedUntil: 0,
      },
    ],
    [
      'dept.lead',
      {
        accountId: 'ACC-MGR-01',
        loginId: 'dept.lead',
        displayName: '박팀장 (생산기술1팀장)',
        role: 'DEPT_MANAGER',
        roleLabel: '부서관리자 (생산기술1팀)',
        managedDeptName: '생산기술1팀',
        empCode: null,
        passwordHash: hashSecretSync(bootGeneratedSecrets['dept.lead'].password),
        pinHash: hashSecretSync(bootGeneratedSecrets['dept.lead'].pin),
        passkeyEnabled: false,
        passkeyCredId: null,
        passkeyPublicKeyObj: null,
        mfaRequired: true,
        pwFailedAttempts: 0,
        mfaFailedAttempts: 0,
        lockedUntil: 0,
      },
    ],
    [
      'emp.201',
      {
        accountId: 'ACC-WRK-201',
        loginId: 'emp.201',
        displayName: '김하늘 (생산기술1팀 사원)',
        role: 'WORKER',
        roleLabel: '근로자 (본인 근태·계약·명세서)',
        managedDeptName: '생산기술1팀',
        empCode: 'EMP-201',
        boundBizRegNo: String(options.initialBizRegNo || '214-86-00941'),
        boundPersonId: String(options.initialEmp201PersonId || 'PER-INIT-EMP-201'),
        boundPersonKey: buildWorkerBindingKey(
          options.initialBizRegNo || '214-86-00941',
          'EMP-201',
          '김하늘',
          '940315-*******',
          '2022-03-02'
        ),
        disabledByOffboard: false,
        disabledByRosterMismatch: false,
        passwordHash: hashSecretSync(bootGeneratedSecrets['emp.201'].password),
        pinHash: null,
        passkeyEnabled: false,
        passkeyCredId: null,
        passkeyPublicKeyObj: null,
        mfaRequired: false,
        pwFailedAttempts: 0,
        mfaFailedAttempts: 0,
        lockedUntil: 0,
      },
    ],
  ]);

  // 세션 저장소: key = sha256Hex(cookieToken), value = sessionRecord
  const sessionsByHash = new Map();
  // 공개 기기 식별자 -> sessionTokenHash 매핑
  const hashByDeviceId = new Map();
  // 일회용 패스키 챌린지 저장소
  const challenges = new Map();
  // 활성 SSE 구독자 목록
  const sseClients = new Set();

  // 클라이언트·계정 단위 분리 레이트 리미트 버킷 (전역 DoS 차단 방지) 및 미등록 아이디 가상 잠금 맵
  const authRateBuckets = new Map();
  const unknownAccountLockMap = new Map();

  let deviceSeq = 1;
  let approvalSeq = 104;
  let notifSeq = 1;

  const workerLiveStatus = new Map([
    [
      'EMP-201',
      {
        bizRegNo: String(options.initialBizRegNo || '214-86-00941'),
        personId: String(options.initialEmp201PersonId || 'PER-INIT-EMP-201'),
        empCode: 'EMP-201',
        displayName: '김하늘',
        deptName: '생산기술1팀',
        attendanceState: 'WORKING',
        lastClockInAt: '08:52',
        lastClockOutAt: null,
        locationVerified: true,
        contractSigned: false,
        contractSignedAt: null,
        remainingLeaveDays: 11.5,
      },
    ],
    [
      'EMP-202',
      {
        empCode: 'EMP-202',
        displayName: '이바다',
        deptName: '품질보증팀',
        attendanceState: 'WORKING',
        lastClockInAt: '08:47',
        lastClockOutAt: null,
        locationVerified: true,
        contractSigned: true,
        contractSignedAt: '2026-11-01 09:10',
        remainingLeaveDays: 9.0,
      },
    ],
    [
      'EMP-203',
      {
        empCode: 'EMP-203',
        displayName: 'Alexandria Maria Gonzalez-Hernandez',
        deptName: '글로벌조달·해외인증파트',
        attendanceState: 'WORKING',
        lastClockInAt: '09:00',
        lastClockOutAt: null,
        locationVerified: true,
        contractSigned: true,
        contractSignedAt: '2026-11-01 09:30',
        remainingLeaveDays: 12.0,
      },
    ],
    [
      'EMP-204',
      {
        empCode: 'EMP-204',
        displayName: '박산들',
        deptName: '고객지원파트 (단시간)',
        attendanceState: 'OFF_DUTY',
        lastClockInAt: null,
        lastClockOutAt: null,
        locationVerified: false,
        contractSigned: true,
        contractSignedAt: '2026-11-02 13:00',
        remainingLeaveDays: 6.5,
      },
    ],
  ]);

  const payrollCloseState = {
    yearMonth: '2026-11',
    status: 'PENDING_CEO', // DRAFT | PENDING_CEO | APPROVED_LOCKED
    submittedBy: '윤인사 (인사노무팀장)',
    submittedAt: '2026-11-15 10:20',
    approvedBy: null,
    approvedAt: null,
  };

  const approvals = [
    {
      requestId: 'APR-101',
      empCode: 'EMP-201',
      requesterName: '김하늘',
      deptName: '생산기술1팀',
      requestType: 'OVERTIME',
      title: '긴급 납기 대응 연장근로 3시간 신청',
      detailSummary: '금일 18:00~21:00 설비 시운전 연장근로 (승인 시 주 최대 근로 52.5h 도달 주의)',
      requestedHoursOrDays: 3,
      status: 'PENDING_DEPT',
      createdAt: '2026-11-15 11:05',
      deptApprovedBy: null,
      decidedBy: null,
      decidedAt: null,
      comment: '',
    },
    {
      requestId: 'APR-102',
      empCode: 'EMP-202',
      requesterName: '이바다',
      deptName: '품질보증팀',
      requestType: 'LEAVE',
      title: '연차유급휴가 1.0일 사용 신청',
      detailSummary: '2026-11-20(금) 개인 용무 연차 신청 (잔여 연차 9.0일 → 8.0일)',
      requestedHoursOrDays: 1,
      status: 'PENDING_CEO',
      createdAt: '2026-11-15 09:40',
      deptApprovedBy: '품질보증파트장',
      decidedBy: null,
      decidedAt: null,
      comment: '',
    },
    {
      requestId: 'APR-103',
      empCode: null,
      requesterName: '윤인사 (인사노무팀)',
      deptName: '경영지원팀',
      requestType: 'STATUTORY_FILING',
      title: '50인+ 안전·보건관리자 선임보고서 관할 노동청 제출 승인',
      detailSummary: '산업안전보건법 제17·18조 법정 기한(선임 후 14일 이내) 도래 전 전자신고 결재 요청',
      requestedHoursOrDays: 0,
      status: 'PENDING_CEO',
      createdAt: '2026-11-15 10:15',
      deptApprovedBy: '윤인사 (인사노무팀장)',
      decidedBy: null,
      decidedAt: null,
      comment: '',
    },
  ];

  const notifications = [
    {
      id: `NTF-${String(notifSeq++).padStart(4, '0')}`,
      targetRole: 'CEO_AND_HR',
      targetDeptName: null,
      targetEmpCode: null,
      severity: 'CRITICAL',
      eventCode: 'COMPLIANCE_DDAY_ALERT',
      title: '법정 신고 기한 임박 (D-Day 경보)',
      bodySummary: '안전·보건관리자 선임보고(14일 이내) 및 노사협의회 규정 신고(15일 이내) 기한을 확인하세요.',
      createdAt: '10:00:00',
    },
    {
      id: `NTF-${String(notifSeq++).padStart(4, '0')}`,
      targetRole: 'CEO',
      targetDeptName: null,
      targetEmpCode: null,
      severity: 'WARN',
      eventCode: 'PAYROLL_CLOSE_SUBMITTED',
      title: '2026년 11월 급여대장 최종 승인 대기',
      bodySummary: '인사팀에서 11월 급여 정산안(제95조 감봉 상한 검증 완료)을 상신했습니다.',
      createdAt: '10:20:00',
    },
  ];

  function nowTimeLabel() {
    return new Date(nowFn()).toISOString().slice(11, 19);
  }

  function checkAndRecordScopedAuthBurst(bucketKey, isFailure = false) {
    const now = nowFn();
    if (authRateBuckets.size >= MAX_RATE_BUCKETS) {
      for (const [k, v] of authRateBuckets.entries()) {
        if (now - v.windowStart > AUTH_BUCKET_WINDOW_MS) authRateBuckets.delete(k);
        if (authRateBuckets.size < MAX_RATE_BUCKETS / 2) break;
      }
    }
    let bucket = authRateBuckets.get(bucketKey);
    if (!bucket || now - bucket.windowStart > AUTH_BUCKET_WINDOW_MS) {
      bucket = { windowStart: now, failures: 0 };
      authRateBuckets.set(bucketKey, bucket);
    }
    if (bucket.failures >= PER_BUCKET_AUTH_LIMIT) {
      throw httpError(
        429,
        '해당 계정·단말에서 단시간 내 비정상적인 인증 시도가 과다하여 잠시 차단되었습니다.',
        'RATE_LIMITED'
      );
    }
    if (isFailure) {
      bucket.failures += 1;
    }
  }

  function pruneSessionsAndChallenges() {
    const now = nowFn();
    for (const [cid, ch] of challenges.entries()) {
      if (ch.used || ch.expiresAtMs <= now) {
        challenges.delete(cid);
      }
    }
    if (unknownAccountLockMap.size > MAX_UNKNOWN_TRACKED) {
      for (const [uid, st] of unknownAccountLockMap.entries()) {
        if (st.lockedUntil <= now) unknownAccountLockMap.delete(uid);
        if (unknownAccountLockMap.size <= MAX_UNKNOWN_TRACKED / 2) break;
      }
    }
    if (sessionsByHash.size <= MAX_STORED_SESSIONS) return;
    for (const [tHash, s] of sessionsByHash.entries()) {
      if (s.authStage === 'REVOKED' || s.expiresAtMs <= now) {
        sessionsByHash.delete(tHash);
        hashByDeviceId.delete(s.deviceId);
      }
      if (sessionsByHash.size <= MAX_STORED_SESSIONS) break;
    }
  }

  function isNotificationVisibleToAccount(notif, account) {
    if (account.role === 'CEO') {
      return notif.targetRole !== 'WORKER';
    }
    if (account.role === 'HR_ADMIN') {
      return notif.targetRole !== 'WORKER' && notif.targetRole !== 'CEO';
    }
    if (account.role === 'DEPT_MANAGER') {
      // 부서관리자에게는 본인 소속 부서(targetDeptName)로 명시 지정된 근태·결재 알림만 노출하며, 전사·보안(CEO_AND_HR) 알림은 원천 차단!
      if (notif.targetRole !== 'ALL_MANAGERS' && notif.targetRole !== 'DEPT_MANAGER') {
        return false;
      }
      if (!notif.targetDeptName || notif.targetDeptName !== account.managedDeptName) {
        return false;
      }
      return true;
    }
    if (account.role === 'WORKER') {
      return notif.targetRole === 'WORKER' && notif.targetEmpCode === account.empCode;
    }
    return false;
  }

  function sendSseFrame(res, eventName, payload) {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // 소켓 종료 시 정리 루틴에서 제거됨
    }
  }

  function pushRealtimeNotification(notifInput) {
    const now = nowFn();
    const entry = {
      id: `NTF-${String(notifSeq++).padStart(4, '0')}`,
      targetRole: notifInput.targetRole || 'ALL_MANAGERS',
      targetDeptName: notifInput.targetDeptName || null,
      targetEmpCode: notifInput.targetEmpCode || null,
      severity: notifInput.severity || 'INFO',
      eventCode: notifInput.eventCode || 'SYSTEM_UPDATE',
      title: String(notifInput.title || '실시간 업데이트').slice(0, 160),
      bodySummary: String(notifInput.bodySummary || '').slice(0, 300),
      createdAt: nowTimeLabel(),
    };
    notifications.unshift(entry);
    if (notifications.length > 50) notifications.pop();

    for (const client of [...sseClients]) {
      const session = sessionsByHash.get(client.sessionHash);
      if (!session || session.authStage !== 'AUTHENTICATED' || session.expiresAtMs <= now) {
        sendSseFrame(client.res, 'session_revoked', { reason: '세션이 만료되었거나 해지되었습니다.' });
        try {
          client.res.end();
        } catch {
          // ignore
        }
        sseClients.delete(client);
        continue;
      }
      const acc = accounts.get(session.loginId);
      if (!acc) continue;
      if (isNotificationVisibleToAccount(entry, acc)) {
        sendSseFrame(client.res, 'notification', { notification: entry });
      } else {
        sendSseFrame(client.res, 'sync', { ts: entry.createdAt });
      }
    }
    return entry;
  }

  /**
   * 1차 로그인 (비동기 scrypt 검증 + 미등록 아이디 동일 5회 잠금 시뮬레이션 + MFA 실패 카운터 보존)
   */
  async function loginStep1({ loginId, password, deviceLabel, platformType }, clientKey = 'local') {
    if (typeof loginId !== 'string' || !loginId.trim() || typeof password !== 'string') {
      throw httpError(400, '로그인 아이디와 비밀번호를 모두 입력해 주세요.', 'INVALID_INPUT');
    }
    pruneSessionsAndChallenges();

    const normalizedId = loginId.trim().toLowerCase().slice(0, 64);
    const bucketKey = `${String(clientKey)}:${normalizedId}`;
    checkAndRecordScopedAuthBurst(bucketKey, false);

    const platform = VALID_PLATFORMS.includes(platformType) ? platformType : 'MOBILE_WEB';
    const cleanDevice =
      typeof deviceLabel === 'string' && deviceLabel.trim()
        ? deviceLabel.trim().slice(0, 80)
        : '모바일 웹 단말';

    const acc = accounts.get(normalizedId);
    const now = nowFn();

    // 미등록 아이디도 실존 계정과 100% 동일하게 5회 실패 시 429 잠금을 반환해 계정 존재 유무 열거(Enumeration) 원천 차단!
    if (!acc) {
      let ghost = unknownAccountLockMap.get(normalizedId);
      if (!ghost) {
        ghost = { pwFailedAttempts: 0, lockedUntil: 0 };
        unknownAccountLockMap.set(normalizedId, ghost);
      }
      if (ghost.lockedUntil > now) {
        await verifySecretAsync(password, dummyHash);
        throw httpError(429, UNIFIED_LOCKOUT_MSG, 'ACCOUNT_LOCKED');
      }
      await verifySecretAsync(password, dummyHash);
      checkAndRecordScopedAuthBurst(bucketKey, true);
      ghost.pwFailedAttempts += 1;
      if (ghost.pwFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        ghost.lockedUntil = now + LOCKOUT_MS;
        ghost.pwFailedAttempts = 0;
        throw httpError(429, UNIFIED_LOCKOUT_MSG, 'ACCOUNT_LOCKED');
      }
      throw httpError(401, '아이디 또는 비밀번호가 일치하지 않습니다.', 'AUTH_FAILED');
    }

    if (acc.lockedUntil > now) {
      await verifySecretAsync(password, dummyHash);
      throw httpError(429, UNIFIED_LOCKOUT_MSG, 'ACCOUNT_LOCKED');
    }

    const ok = await verifySecretAsync(password, acc.passwordHash);
    if (!ok) {
      checkAndRecordScopedAuthBurst(bucketKey, true);
      acc.pwFailedAttempts += 1;
      if (acc.pwFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        acc.lockedUntil = now + LOCKOUT_MS;
        acc.pwFailedAttempts = 0;
        throw httpError(429, UNIFIED_LOCKOUT_MSG, 'ACCOUNT_LOCKED');
      }
      throw httpError(401, '아이디 또는 비밀번호가 일치하지 않습니다.', 'AUTH_FAILED');
    }

    // 1차 비밀번호 실패 카운터만 초기화하며, mfaFailedAttempts는 2차 인증 통과 전까지 절대 초기화하지 않음!
    acc.pwFailedAttempts = 0;

    if (acc.disabledByOffboard === true) {
      throw httpError(
        403,
        '퇴사 처리(자격상실)된 사번과 연결된 모바일 계정은 접근이 자동 차단되었습니다.',
        'OFFBOARDED_ACCOUNT_DISABLED'
      );
    }

    if (acc.disabledByRosterMismatch === true) {
      throw httpError(
        403,
        '사업장 전환 또는 동일 사번 신규 인원 배정으로 기존 모바일 계정 바인딩이 해지되었습니다. 인사팀 재등록이 필요합니다.',
        'ROSTER_IDENTITY_MISMATCH'
      );
    }

    const cookieToken = crypto.randomBytes(32).toString('hex');
    const sessionHash = sha256Hex(cookieToken);
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const deviceId = `DEV-${String(deviceSeq++).padStart(3, '0')}`;
    const authStage = acc.mfaRequired ? 'MFA_PENDING' : 'AUTHENTICATED';

    const sessionRecord = {
      deviceId,
      sessionHash,
      loginId: acc.loginId,
      accountId: acc.accountId,
      role: acc.role,
      deviceLabel: cleanDevice,
      platformType: platform,
      authStage,
      csrfToken,
      createdAtMs: now,
      createdAtLabel: nowTimeLabel(),
      lastSeenAtLabel: nowTimeLabel(),
      expiresAtMs: now + SESSION_TTL_MS,
      revokedAtLabel: null,
    };

    sessionsByHash.set(sessionHash, sessionRecord);
    hashByDeviceId.set(deviceId, sessionHash);

    return {
      cookieToken,
      session: toPublicSessionInfo(sessionRecord, acc),
    };
  }

  function getValidSession(cookieToken, { allowMfaPending = false } = {}) {
    if (typeof cookieToken !== 'string' || !cookieToken) {
      throw httpError(401, '모바일 로그인이 필요합니다.', 'UNAUTHENTICATED');
    }
    const sessionHash = sha256Hex(cookieToken);
    const session = sessionsByHash.get(sessionHash);
    if (!session) {
      throw httpError(401, '세션이 존재하지 않거나 만료되었습니다.', 'SESSION_INVALID');
    }
    const now = nowFn();
    if (session.authStage === 'REVOKED' || session.expiresAtMs <= now) {
      throw httpError(
        401,
        '원격 해제되었거나 만료된 기기 세션입니다. 다시 로그인해 주세요.',
        'SESSION_REVOKED'
      );
    }
    if (!allowMfaPending && session.authStage !== 'AUTHENTICATED') {
      throw httpError(
        403,
        '대표·관리자 계정은 2차 인증(6자리 보안 PIN 또는 등록 패스키 전자서명) 완료 후 접근할 수 있습니다.',
        'MFA_REQUIRED'
      );
    }
    session.lastSeenAtLabel = nowTimeLabel();
    const acc = accounts.get(session.loginId);
    if (!acc) {
      throw httpError(401, '계정 정보를 찾을 수 없습니다.', 'ACCOUNT_NOT_FOUND');
    }
    return { session, acc, sessionHash };
  }

  /**
   * 이미 2차 인증까지 마친 세션(AUTHENTICATED)에서 현재 6자리 보안 PIN을 재확인한 뒤 단말 ECDSA P-256 공개키(SPKI) 등록
   */
  async function registerPasskeyPublicKey(cookieToken, payload = {}, clientKey = 'local') {
    const { session, acc } = getValidSession(cookieToken, { allowMfaPending: false });
    if (!acc.mfaRequired) {
      throw httpError(400, '2차 인증 대상 계정이 아닙니다.', 'NOT_MFA_ACCOUNT');
    }
    const now = nowFn();
    if (acc.lockedUntil > now) {
      throw httpError(429, UNIFIED_LOCKOUT_MSG, 'ACCOUNT_LOCKED');
    }

    const bucketKey = `${String(clientKey)}:${acc.loginId}:pkreg`;
    checkAndRecordScopedAuthBurst(bucketKey, false);

    const currentPin = typeof payload.currentPin === 'string' ? payload.currentPin.trim() : '';
    if (!/^\d{6}$/.test(currentPin)) {
      throw httpError(
        400,
        '패스키 공개키 등록·재발급 시 본인 확인을 위한 현재 6자리 보안 PIN(currentPin) 입력이 필수입니다.',
        'PIN_RECONFIRM_REQUIRED'
      );
    }

    const pinOk = await verifySecretAsync(currentPin, acc.pinHash);
    if (!pinOk) {
      checkAndRecordScopedAuthBurst(bucketKey, true);
      acc.mfaFailedAttempts += 1;
      if (acc.mfaFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        acc.lockedUntil = now + LOCKOUT_MS;
        acc.mfaFailedAttempts = 0;
        session.authStage = 'REVOKED';
        session.revokedAtLabel = nowTimeLabel();
        throw httpError(
          429,
          '보안 PIN 5회 연속 불일치로 세션이 강제 폐기되고 계정이 일시 잠금되었습니다.',
          'ACCOUNT_LOCKED'
        );
      }
      throw httpError(401, '현재 6자리 보안 PIN이 일치하지 않아 패스키를 등록할 수 없습니다.', 'PIN_MISMATCH');
    }
    acc.mfaFailedAttempts = 0;

    const spkiB64 =
      typeof payload.publicKeySpkiBase64 === 'string' ? payload.publicKeySpkiBase64.trim() : '';
    if (!spkiB64 || spkiB64.length > 2048) {
      throw httpError(400, '유효한 ECDSA P-256 공개키(SPKI Base64)가 필요합니다.', 'INVALID_KEY');
    }

    let pubKeyObj;
    try {
      pubKeyObj = await crypto.createPublicKey({
        key: Buffer.from(spkiB64, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch {
      throw httpError(400, '공개키 SPKI 형식을 파싱할 수 없습니다.', 'INVALID_KEY_FORMAT');
    }

    if (
      pubKeyObj.asymmetricKeyType !== 'ec' ||
      pubKeyObj.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw httpError(400, '패스키 공개키는 ECDSA P-256(prime256v1) 알고리즘이어야 합니다.', 'UNSUPPORTED_ALG');
    }

    const credId = `PK-${crypto.randomBytes(12).toString('hex')}`;
    acc.passkeyCredId = credId;
    acc.passkeyPublicKeyObj = pubKeyObj;
    acc.passkeyEnabled = true;

    pushRealtimeNotification({
      targetRole: 'CEO_AND_HR',
      severity: 'WARN',
      eventCode: 'PASSKEY_REGISTERED',
      title: `단말 패스키 공개키 등록·갱신 (${acc.loginId})`,
      bodySummary: `${acc.displayName} 계정에 새 ECDSA P-256 보안키(${credId})가 PIN 재확인 후 등록되었습니다.`,
    });

    return {
      credentialId: credId,
      session: toPublicSessionInfo(session, acc),
    };
  }

  /**
   * 패스키(생체인증) 2차 인증용 일회용 서버 챌린지 발급 (credentialId 등 비밀 식별자는 절대 반환하지 않음!)
   */
  function issuePasskeyChallenge(cookieToken) {
    const { acc, sessionHash } = getValidSession(cookieToken, { allowMfaPending: true });
    if (!acc.passkeyEnabled || !acc.passkeyPublicKeyObj) {
      throw httpError(
        400,
        '이 계정에 등록된 패스키 공개키가 없습니다. 먼저 6자리 PIN으로 로그인한 뒤 기기 패스키를 등록해 주세요.',
        'PASSKEY_NOT_REGISTERED'
      );
    }
    const challengeId = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(32).toString('base64url');
    challenges.set(challengeId, {
      sessionHash,
      loginId: acc.loginId,
      nonce,
      expiresAtMs: nowFn() + CHALLENGE_TTL_MS,
      used: false,
    });
    return {
      challengeId,
      nonce,
      rpId: '127.0.0.1',
    };
  }

  /**
   * 2차 인증 검증 (`PIN` 비동기 scrypt 검증 또는 `PASSKEY` ECDSA P-256 공개키 전자서명·Origin·Nonce 검증)
   */
  async function verifyMfaStep2(cookieToken, payload = {}, allowedOrigins = [], clientKey = 'local') {
    const { session, acc, sessionHash } = getValidSession(cookieToken, { allowMfaPending: true });
    const bucketKey = `${String(clientKey)}:${acc.loginId}:mfa`;
    checkAndRecordScopedAuthBurst(bucketKey, false);
    const now = nowFn();
    if (acc.lockedUntil > now) {
      throw httpError(429, UNIFIED_LOCKOUT_MSG, 'ACCOUNT_LOCKED');
    }
    if (!acc.mfaRequired) {
      session.authStage = 'AUTHENTICATED';
      return toPublicSessionInfo(session, acc);
    }

    const method = String(payload.method || '');
    let verified = false;

    if (method === 'PIN') {
      const pin = typeof payload.pin === 'string' ? payload.pin.trim() : '';
      if (!/^\d{6}$/.test(pin)) {
        throw httpError(400, '보안 PIN은 6자리 숫자여야 합니다.', 'INVALID_PIN_FORMAT');
      }
      verified = await verifySecretAsync(pin, acc.pinHash);
    } else if (method === 'PASSKEY') {
      const challengeId = typeof payload.challengeId === 'string' ? payload.challengeId : '';
      const credentialId = typeof payload.credentialId === 'string' ? payload.credentialId : '';
      const clientDataJSON = typeof payload.clientDataJSON === 'string' ? payload.clientDataJSON : '';
      const signatureBase64 = typeof payload.signatureBase64 === 'string' ? payload.signatureBase64 : '';

      const ch = challenges.get(challengeId);
      // 재전송 공격 방지를 위해 조회 즉시 챌린지를 소모 처리
      if (ch) {
        ch.used = true;
        challenges.delete(challengeId);
      }

      if (
        ch &&
        ch.expiresAtMs > now &&
        ch.sessionHash === sessionHash &&
        acc.passkeyEnabled &&
        acc.passkeyPublicKeyObj &&
        safeCompareHexOrText(credentialId, acc.passkeyCredId) &&
        clientDataJSON.length > 0 &&
        clientDataJSON.length <= 2048 &&
        signatureBase64.length > 0 &&
        signatureBase64.length <= 512
      ) {
        try {
          const parsedClientData = JSON.parse(clientDataJSON);
          const normalizedOrigin = String(parsedClientData.origin || '').toLowerCase();
          const originAllowed =
            allowedOrigins.length === 0 || allowedOrigins.includes(normalizedOrigin);

          if (
            parsedClientData.type === 'mhr.passkey.get' &&
            originAllowed &&
            safeCompareHexOrText(String(parsedClientData.challenge || ''), ch.nonce)
          ) {
            const sigBuf = Buffer.from(signatureBase64, 'base64');
            verified = await crypto.verify(
              'sha256',
              Buffer.from(clientDataJSON, 'utf8'),
              { key: acc.passkeyPublicKeyObj, dsaEncoding: 'ieee-p1363' },
              sigBuf
            );
          }
        } catch {
          verified = false;
        }
      }
    } else {
      throw httpError(400, '지원하지 않는 2차 인증 방식입니다 (PIN 또는 PASSKEY).', 'INVALID_MFA_METHOD');
    }

    if (!verified) {
      checkAndRecordScopedAuthBurst(bucketKey, true);
      acc.mfaFailedAttempts += 1;
      if (acc.mfaFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        acc.lockedUntil = now + LOCKOUT_MS;
        acc.mfaFailedAttempts = 0;
        session.authStage = 'REVOKED';
        session.revokedAtLabel = nowTimeLabel();
        throw httpError(
          429,
          '2차 인증 5회 연속 실패로 세션이 강제 폐기되고 계정이 5분간 잠금되었습니다.',
          'ACCOUNT_LOCKED'
        );
      }
      throw httpError(401, '2차 인증 정보가 일치하지 않습니다.', 'MFA_FAILED');
    }

    // 2차 인증에 실제로 통과했을 때만 mfaFailedAttempts를 0으로 초기화!
    acc.mfaFailedAttempts = 0;
    acc.pwFailedAttempts = 0;
    session.authStage = 'AUTHENTICATED';
    return toPublicSessionInfo(session, acc);
  }

  function logoutSession(cookieToken) {
    if (!cookieToken) return;
    const sessionHash = sha256Hex(cookieToken);
    const session = sessionsByHash.get(sessionHash);
    if (session) {
      session.authStage = 'REVOKED';
      session.revokedAtLabel = nowTimeLabel();
      closeSseBySessionHash(sessionHash, '로그아웃 처리되었습니다.');
    }
  }

  function closeSseBySessionHash(targetSessionHash, reason) {
    for (const client of [...sseClients]) {
      if (client.sessionHash === targetSessionHash) {
        sendSseFrame(client.res, 'session_revoked', { reason });
        try {
          client.res.end();
        } catch {
          // ignore
        }
        sseClients.delete(client);
      }
    }
  }

  function revokeDeviceByAdmin(callerCookieToken, targetDeviceId) {
    const { acc } = getValidSession(callerCookieToken);
    if (acc.role !== 'CEO' && acc.role !== 'HR_ADMIN') {
      throw httpError(403, '접속 기기 원격 해지 권한은 대표이사 및 인사관리자에게만 있습니다.', 'FORBIDDEN');
    }
    if (typeof targetDeviceId !== 'string' || !targetDeviceId.trim()) {
      throw httpError(400, '해지할 기기 식별자(deviceId)가 필요합니다.', 'INVALID_INPUT');
    }
    const targetHash = hashByDeviceId.get(targetDeviceId.trim());
    if (!targetHash) {
      throw httpError(404, '해당 기기 세션을 찾을 수 없습니다.', 'DEVICE_NOT_FOUND');
    }
    const targetSession = sessionsByHash.get(targetHash);
    if (!targetSession) {
      throw httpError(404, '해당 기기 세션을 찾을 수 없습니다.', 'DEVICE_NOT_FOUND');
    }
    targetSession.authStage = 'REVOKED';
    targetSession.revokedAtLabel = nowTimeLabel();
    closeSseBySessionHash(targetHash, `${acc.displayName}님이 원격에서 기기 연결을 해제했습니다.`);

    pushRealtimeNotification({
      targetRole: 'CEO_AND_HR',
      severity: 'WARN',
      eventCode: 'DEVICE_REVOKED',
      title: `접속 기기 원격 연결 해제 (${targetSession.deviceId})`,
      bodySummary: `${acc.displayName}님이 [${targetSession.deviceLabel}] 세션을 강제 종료했습니다.`,
    });

    return { revokedDeviceId: targetSession.deviceId };
  }

  /**
   * 퇴사 처리(또는 공단 상실내역 자동 편입) 시 해당 사번과 연결된 모바일 계정 및 기기 세션을 즉시 원격 차단
   */
  function revokeWorkerAccessOnOffboard(empCode, reasonNote = '퇴사 처리') {
    const cleanEmp = String(empCode || '').trim().toUpperCase();
    if (!cleanEmp) return { revokedSessionCount: 0 };

    let revokedSessionCount = 0;
    for (const acc of accounts.values()) {
      if (acc.empCode === cleanEmp && acc.role === 'WORKER') {
        acc.disabledByOffboard = true;
        for (const [sHash, s] of sessionsByHash.entries()) {
          if (s.loginId === acc.loginId && s.authStage !== 'REVOKED') {
            s.authStage = 'REVOKED';
            s.revokedAtLabel = nowTimeLabel();
            closeSseBySessionHash(sHash, `${reasonNote}로 인해 모바일 세션이 자동 종료되었습니다.`);
            revokedSessionCount += 1;
          }
        }
      }
    }
    workerLiveStatus.delete(cleanEmp);
    return { revokedSessionCount };
  }

  /**
   * 멀티문서 일괄 온보딩 시 사업장·불변 인물 키(boundPersonKey) 기준으로 근로자 계정·세션 접근을 검증·폐기
   * - 타 사업장 문서 개통 또는 동일 사번(EMP-201 등)에 다른 인물이 배정된 경우 즉시 세션을 폐기하고 로그인을 차단한다.
   * - 한 번 퇴사(disabledByOffboard=true) 처리된 계정은 자동 부활하지 않는다.
   */
  function syncWorkerAccessWithRoster(
    activeWorkers = [],
    offboardedWorkers = [],
    companyBizRegNo = '214-86-00941'
  ) {
    const prevLiveMap = new Map(workerLiveStatus.entries());
    workerLiveStatus.clear();

    for (const w of activeWorkers) {
      const prevLive = prevLiveMap.get(w.empCode);
      const isSamePerson =
        prevLive &&
        prevLive.personId &&
        w.personId &&
        prevLive.personId === w.personId &&
        prevLive.bizRegNo === String(companyBizRegNo || '');
      workerLiveStatus.set(
        w.empCode,
        isSamePerson
          ? prevLive
          : {
              bizRegNo: String(companyBizRegNo || ''),
              personId: w.personId || null,
              empCode: w.empCode,
              displayName: w.displayName,
              deptName: w.deptName,
              attendanceState: 'WORKING',
              lastClockInAt: '08:52',
              lastClockOutAt: null,
              locationVerified: true,
              contractSigned: true,
              contractSignedAt: w.hireDate || '2026-11-01',
              remainingLeaveDays: 12,
            }
      );
    }

    for (const acc of accounts.values()) {
      if (acc.role !== 'WORKER' || !acc.empCode) continue;

      const matchedActive = activeWorkers.find(
        (w) => String(w.empCode || '').trim().toUpperCase() === acc.empCode
      );
      const activeCandidateKey = matchedActive
        ? buildWorkerBindingKey(
            companyBizRegNo,
            matchedActive.empCode,
            matchedActive.displayName,
            matchedActive.maskedBirthOrId,
            matchedActive.hireDate
          )
        : null;
      const isPersonIdMatched =
        Boolean(matchedActive?.personId) && matchedActive.personId === acc.boundPersonId;
      const isExactBoundActive =
        isPersonIdMatched &&
        activeCandidateKey !== null &&
        activeCandidateKey === acc.boundPersonKey;

      const isBoundOffboarded = offboardedWorkers.some((o) => {
        if (o.dataLifecycleStatus === 'ANONYMIZED_PURGED') return false;
        if (o.personId && acc.boundPersonId && o.personId === acc.boundPersonId) return true;
        const offKey = buildWorkerBindingKey(
          o.bizRegNo || companyBizRegNo,
          o.empCode,
          o.displayName,
          o.maskedBirthOrId,
          o.hireDate
        );
        return offKey !== null && offKey === acc.boundPersonKey;
      });

      if (isBoundOffboarded && !isExactBoundActive) {
        revokeWorkerAccessOnOffboard(acc.empCode, '공단 상실내역 자동 연동');
        continue;
      }

      if (!isExactBoundActive) {
        acc.disabledByRosterMismatch = true;
        for (const [sHash, s] of sessionsByHash.entries()) {
          if (s.loginId === acc.loginId && s.authStage !== 'REVOKED') {
            s.authStage = 'REVOKED';
            s.revokedAtLabel = nowTimeLabel();
            closeSseBySessionHash(
              sHash,
              '사업장 또는 불변 인물 식별자(personId) 바인딩 불일치로 모바일 세션이 폐기되었습니다.'
            );
          }
        }
      } else if (acc.disabledByOffboard !== true) {
        acc.disabledByRosterMismatch = false;
      }
    }
  }

  /**
   * 3년 보존 만료 비식별 파기 시 모바일 허브 내 알림·결재·세션·계정 복제본의 구조화 필드 및 항목 전체를 일괄 삭제
   */
  function scrubPurgedPersonFromHub({ origPersonId = null, origEmpCode = '', origDisplayName = '' } = {}) {
    const cleanCode = String(origEmpCode || '').trim();
    const upperCode = cleanCode.toUpperCase();
    const cleanName = String(origDisplayName || '').trim();

    if (upperCode) workerLiveStatus.delete(upperCode);
    for (const [k, v] of workerLiveStatus.entries()) {
      if ((origPersonId && v.personId === origPersonId) || (cleanName && v.displayName === cleanName)) {
        workerLiveStatus.delete(k);
      }
    }

    const matchesPurged = (txt) => {
      const s = String(txt || '');
      if (cleanCode && s.includes(cleanCode)) return true;
      if (upperCode && s.toUpperCase().includes(upperCode)) return true;
      if (cleanName && s.includes(cleanName)) return true;
      return false;
    };

    for (let i = notifications.length - 1; i >= 0; i--) {
      const n = notifications[i];
      if (
        (origPersonId && n.personId === origPersonId) ||
        (upperCode && String(n.targetEmpCode || '').toUpperCase() === upperCode) ||
        matchesPurged(n.title) ||
        matchesPurged(n.bodySummary)
      ) {
        notifications.splice(i, 1);
      }
    }

    for (let i = approvals.length - 1; i >= 0; i--) {
      const a = approvals[i];
      if (
        (origPersonId && a.personId === origPersonId) ||
        (upperCode && String(a.empCode || '').toUpperCase() === upperCode) ||
        (cleanName && a.requesterName === cleanName) ||
        matchesPurged(a.title) ||
        matchesPurged(a.detailSummary) ||
        matchesPurged(a.comment)
      ) {
        approvals.splice(i, 1);
      }
    }

    for (const acc of accounts.values()) {
      if (acc.role !== 'WORKER') continue;
      const isSameAcc =
        (origPersonId && acc.boundPersonId === origPersonId) ||
        (upperCode && String(acc.empCode || '').toUpperCase() === upperCode);
      if (!isSameAcc) continue;

      for (const [sHash, s] of sessionsByHash.entries()) {
        if (s.loginId === acc.loginId) {
          closeSseBySessionHash(sHash, '보존기간 만료 개인정보 파기로 세션이 영구 삭제되었습니다.');
          hashByDeviceId.delete(s.deviceId);
          sessionsByHash.delete(sHash);
        }
      }
      acc.displayName = '비식별파기계정';
      acc.managedDeptName = null;
      acc.empCode = null;
      acc.boundBizRegNo = null;
      acc.boundPersonId = null;
      acc.boundPersonKey = null;
      acc.disabledByOffboard = true;
      acc.disabledByRosterMismatch = true;
    }
  }

  function toPublicSessionInfo(session, acc) {
    return {
      deviceId: session.deviceId,
      loginId: acc.loginId,
      displayName: acc.displayName,
      role: acc.role,
      roleLabel: acc.roleLabel,
      managedDeptName: acc.managedDeptName,
      empCode: acc.empCode,
      deviceLabel: session.deviceLabel,
      platformType: session.platformType,
      authStage: session.authStage,
      mfaRequired: acc.mfaRequired,
      passkeyEnabled: acc.passkeyEnabled,
      csrfToken: session.csrfToken,
    };
  }

  function listActiveDevicesForAdmin(currentDeviceId) {
    const list = [];
    for (const s of sessionsByHash.values()) {
      const acc = accounts.get(s.loginId);
      list.push({
        deviceId: s.deviceId,
        accountName: acc ? acc.displayName : s.loginId,
        role: s.role,
        deviceLabel: s.deviceLabel,
        platformType: s.platformType,
        authStage: s.authStage,
        createdAt: s.createdAtLabel,
        lastSeenAt: s.lastSeenAtLabel,
        revokedAt: s.revokedAtLabel,
        isCurrentDevice: s.deviceId === currentDeviceId,
      });
    }
    return list.reverse().slice(0, 20);
  }

  /**
   * 역할별 데이터 마스킹·필터링이 적용된 모바일 대시보드 스냅샷 생성
   */
  function buildMobileRoleDashboard(cookieToken, coreSnapshot) {
    const { session, acc } = getValidSession(cookieToken);

    const visibleNotifications = notifications
      .filter((n) => isNotificationVisibleToAccount(n, acc))
      .slice(0, 15);

    const enrichWorkerAttendance = (w, stripPayrollWarnings = false) => {
      const live = workerLiveStatus.get(w.empCode) || {
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        attendanceState: 'WORKING',
        lastClockInAt: '09:00',
        lastClockOutAt: null,
        locationVerified: true,
        contractSigned: true,
        contractSignedAt: '2026-11-01',
        remainingLeaveDays: 10,
      };
      const payLine = coreSnapshot.payrollLines.find((p) => p.empCode === w.empCode);
      const rawWarnings = payLine ? payLine.warnings : [];
      // 부서관리자에게는 시급·감봉액이 담긴 급여 경고를 원천 마스킹하고 근로시간(주52h) 경고만 전달!
      const filteredWarnings = stripPayrollWarnings
        ? rawWarnings.filter((warn) => warn.code === 'WEEKLY_52H_EXCEEDED' || warn.code === 'WEEKLY_52H_NEAR')
        : rawWarnings;

      return {
        empCode: w.empCode,
        displayName: w.displayName,
        deptName: w.deptName,
        workerCategory: w.workerCategory,
        overtimeHours: w.overtimeHours || 0,
        maxWeeklyWorkedHours: Number((w.maxWeeklyWorkedHours || w.weeklyHours || 40).toFixed(1)),
        attendanceState: live.attendanceState,
        lastClockInAt: live.lastClockInAt,
        lastClockOutAt: live.lastClockOutAt,
        locationVerified: live.locationVerified,
        contractSigned: live.contractSigned,
        remainingLeaveDays: live.remainingLeaveDays,
        warningCount: filteredWarnings.length,
        warnings: filteredWarnings,
      };
    };

    // 1) 근로자 본인 전용 뷰 (사업장·불변 인물 키 일치 검증 + 빈 명부 모드 시 workerLiveStatus 폴백 보존!)
    if (acc.role === 'WORKER') {
      const snapBizDigits = String(coreSnapshot.company?.bizRegNo || '').replace(/[^0-9]/g, '');
      const boundBizDigits = String(acc.boundBizRegNo || '').replace(/[^0-9]/g, '');
      if (boundBizDigits && snapBizDigits && snapBizDigits !== boundBizDigits) {
        session.authStage = 'REVOKED';
        session.revokedAtLabel = nowTimeLabel();
        throw httpError(
          403,
          '소속 사업장이 전환되어 기존 근로자 계정으로 급여·근태 정보를 열람할 수 없습니다.',
          'WORKPLACE_MISMATCH'
        );
      }

      const meWorker = coreSnapshot.workers.find((w) => w.empCode === acc.empCode);
      if (meWorker) {
        const candidateKey = buildWorkerBindingKey(
          coreSnapshot.company?.bizRegNo,
          meWorker.empCode,
          meWorker.displayName,
          meWorker.maskedBirthOrId,
          meWorker.hireDate
        );
        const isPersonIdOk = Boolean(meWorker.personId) && meWorker.personId === acc.boundPersonId;
        if (!isPersonIdOk || candidateKey === null || candidateKey !== acc.boundPersonKey) {
          session.authStage = 'REVOKED';
          session.revokedAtLabel = nowTimeLabel();
          throw httpError(
            403,
            '동일 사번에 다른 근로자가 배정되었거나 불변 신원 검증에 실패하여 열람이 차단되었습니다.',
            'PERSON_IDENTITY_MISMATCH'
          );
        }
      }
      const fallbackLive = workerLiveStatus.get(acc.empCode);
      const myLive = meWorker
        ? enrichWorkerAttendance(meWorker, false)
        : fallbackLive
          ? {
              ...structuredClone(fallbackLive),
              workerCategory: 'REGULAR',
              overtimeHours: 0,
              maxWeeklyWorkedHours: 40,
              warningCount: 0,
              warnings: [],
            }
          : null;
      const myPayLine = coreSnapshot.payrollLines.find((l) => l.empCode === acc.empCode) || null;
      const myApprovals = approvals.filter((a) => a.empCode === acc.empCode);

      return {
        session: toPublicSessionInfo(session, acc),
        company: {
          companyName: coreSnapshot.company.companyName,
          ksicMajor: coreSnapshot.company.ksicMajor,
        },
        payrollCloseState: {
          yearMonth: payrollCloseState.yearMonth,
          status: payrollCloseState.status,
        },
        myProfile: myLive,
        myPayslip: myPayLine,
        approvals: myApprovals,
        notifications: visibleNotifications,
      };
    }

    // 2) 부서 관리자 전용 뷰 (본인 부서 근태·결재만 허용, 급여 총액·시급 경고·타 부서 원천 차단!)
    if (acc.role === 'DEPT_MANAGER') {
      const deptWorkers = coreSnapshot.workers
        .filter((w) => w.deptName === acc.managedDeptName)
        .map((w) => enrichWorkerAttendance(w, true));
      const deptApprovals = approvals.filter((a) => a.deptName === acc.managedDeptName);
      const workingCount = deptWorkers.filter((w) => w.attendanceState === 'WORKING').length;
      const near52Count = deptWorkers.filter((w) => w.maxWeeklyWorkedHours >= 48).length;

      return {
        session: toPublicSessionInfo(session, acc),
        company: {
          companyName: coreSnapshot.company.companyName,
          badge: coreSnapshot.company.badge,
          managedDeptName: acc.managedDeptName,
        },
        kpis: {
          deptTotalCount: deptWorkers.length,
          deptWorkingCount: workingCount,
          deptNear52Count: near52Count,
          pendingApprovalCount: deptApprovals.filter((a) => a.status === 'PENDING_DEPT').length,
        },
        workersAttendance: deptWorkers,
        approvals: deptApprovals,
        payrollSummary: null,
        payrollLines: [],
        offboardedSummary: null,
        offboardedWorkers: [],
        statutoryFilings: [],
        devices: [],
        notifications: visibleNotifications,
      };
    }

    // 3) 대표이사(CEO) 및 인사노무관리자(HR_ADMIN) 전사 실시간 관제·결재 뷰
    const allAttendance = coreSnapshot.workers.map((w) => enrichWorkerAttendance(w, false));
    const workingCount = allAttendance.filter((w) => w.attendanceState === 'WORKING').length;
    const risk52Count = allAttendance.filter((w) => w.maxWeeklyWorkedHours > 52).length;
    const unsignedContractCount = allAttendance.filter((w) => !w.contractSigned).length;
    const urgentFilings = coreSnapshot.compliance.statutoryFilings.filter((f) => !f.isCompleted);

    return {
      session: toPublicSessionInfo(session, acc),
      company: coreSnapshot.company,
      headcounts: coreSnapshot.compliance.headcounts,
      disabilityCompliance: coreSnapshot.compliance.disabilityCompliance,
      payrollCloseState: structuredClone(payrollCloseState),
      kpis: {
        totalListedWorkers: allAttendance.length,
        workingNowCount: workingCount,
        weekly52ExceededCount: risk52Count,
        unsignedContractCount,
        openStatutoryCount: urgentFilings.length,
        pendingApprovalCount: approvals.filter((a) => a.status.startsWith('PENDING')).length,
        alumniPendingSettlementCount: coreSnapshot.offboardedSummary?.pendingSettlementCount || 0,
      },
      workersAttendance: allAttendance,
      statutoryFilings: coreSnapshot.compliance.statutoryFilings,
      quarterlySchedule: coreSnapshot.compliance.quarterlySchedule,
      payrollSummary: coreSnapshot.payrollSummary,
      payrollLines: coreSnapshot.payrollLines,
      offboardedSummary: coreSnapshot.offboardedSummary || null,
      offboardedWorkers: coreSnapshot.offboardedWorkers || [],
      lastIngestionSummary: coreSnapshot.lastIngestionSummary || null,
      approvals: structuredClone(approvals),
      devices: listActiveDevicesForAdmin(session.deviceId),
      notifications: visibleNotifications,
    };
  }

  function recordWorkerClock(cookieToken, payload = {}, onWorkerMutate = null) {
    const { acc } = getValidSession(cookieToken);
    if (acc.role !== 'WORKER' || !acc.empCode) {
      throw httpError(403, '근로자 계정에서만 본인 출퇴근 체크를 수행할 수 있습니다.', 'FORBIDDEN');
    }
    const action = String(payload.action || '');
    if (action !== 'CLOCK_IN' && action !== 'CLOCK_OUT') {
      throw httpError(400, '유효하지 않은 출퇴근 액션입니다 (CLOCK_IN 또는 CLOCK_OUT).', 'INVALID_ACTION');
    }
    if (payload.locationConsent !== true) {
      throw httpError(
        400,
        '위치정보법 준수를 위해 출·퇴근 시점 사업장 위치/Wi-Fi 일회성 확인 동의(locationConsent: true)가 필요합니다.',
        'LOCATION_CONSENT_REQUIRED'
      );
    }

    const prev = workerLiveStatus.get(acc.empCode) || {
      empCode: acc.empCode,
      displayName: acc.displayName,
      deptName: acc.managedDeptName,
      attendanceState: 'OFF_DUTY',
      lastClockInAt: null,
      lastClockOutAt: null,
      locationVerified: false,
      contractSigned: false,
      contractSignedAt: null,
      remainingLeaveDays: 11.5,
    };

    const ts = nowTimeLabel().slice(0, 5);
    if (action === 'CLOCK_IN') {
      prev.attendanceState = 'WORKING';
      prev.lastClockInAt = ts;
      prev.locationVerified = true;
    } else {
      prev.attendanceState = 'CLOCKED_OUT';
      prev.lastClockOutAt = ts;
      prev.locationVerified = true;
    }
    workerLiveStatus.set(acc.empCode, prev);

    if (typeof onWorkerMutate === 'function') {
      onWorkerMutate(acc.empCode, action, ts);
    }

    pushRealtimeNotification({
      targetRole: 'ALL_MANAGERS',
      targetDeptName: acc.managedDeptName,
      severity: 'INFO',
      eventCode: action === 'CLOCK_IN' ? 'WORKER_CLOCK_IN' : 'WORKER_CLOCK_OUT',
      title: `[실시간 근태] ${acc.displayName} ${action === 'CLOCK_IN' ? '출근' : '퇴근'} 완료`,
      bodySummary: `${ts} 사업장 인증 완료 (${acc.managedDeptName})`,
    });

    return structuredClone(prev);
  }

  function signWorkerContract(cookieToken, payload = {}, onAudit = null) {
    const { acc } = getValidSession(cookieToken);
    if (acc.role !== 'WORKER' || !acc.empCode) {
      throw httpError(403, '근로자 본인만 전자근로계약서에 서명할 수 있습니다.', 'FORBIDDEN');
    }
    if (payload.agreedToTerms !== true) {
      throw httpError(
        400,
        '근로조건 확인 및 전자서명 동의(agreedToTerms: true)가 필요합니다.',
        'CONSENT_REQUIRED'
      );
    }
    const status = workerLiveStatus.get(acc.empCode) || {
      empCode: acc.empCode,
      displayName: acc.displayName,
      deptName: acc.managedDeptName,
    };
    status.contractSigned = true;
    status.contractSignedAt = `2026-11-15 ${nowTimeLabel().slice(0, 5)}`;
    workerLiveStatus.set(acc.empCode, status);

    if (typeof onAudit === 'function') {
      onAudit(
        '모바일전자계약',
        `[${acc.empCode} ${acc.displayName}] 근로기준법 제17조 전자근로계약 서명·즉시교부 완료`
      );
    }

    pushRealtimeNotification({
      targetRole: 'HR_ADMIN',
      severity: 'INFO',
      eventCode: 'CONTRACT_SIGNED',
      title: `전자근로계약 체결 완료 (${acc.empCode})`,
      bodySummary: `${acc.displayName}님이 모바일에서 근로계약서 서명 및 사본 수령을 완료했습니다.`,
    });
    pushRealtimeNotification({
      targetRole: 'CEO',
      severity: 'INFO',
      eventCode: 'CONTRACT_SIGNED',
      title: `전자근로계약 체결 완료 (${acc.empCode})`,
      bodySummary: `${acc.displayName}님의 전자근로계약이 체결되어 미체결 리스크가 해소되었습니다.`,
    });

    return structuredClone(status);
  }

  function createWorkerApprovalRequest(cookieToken, payload = {}) {
    const { acc } = getValidSession(cookieToken);
    if (acc.role !== 'WORKER' || !acc.empCode) {
      throw httpError(403, '근로자 계정에서만 연차·연장근로 신청을 등록할 수 있습니다.', 'FORBIDDEN');
    }
    const reqType = String(payload.requestType || '');
    if (reqType !== 'LEAVE' && reqType !== 'OVERTIME') {
      throw httpError(400, '근로자 신청 유형은 LEAVE 또는 OVERTIME이어야 합니다.', 'INVALID_TYPE');
    }
    if (reqType === 'OVERTIME' && payrollCloseState.status === 'APPROVED_LOCKED') {
      throw httpError(
        409,
        '당월 급여대장이 이미 최종 승인·잠금되어 추가 연장근로 정산을 신청할 수 없습니다.',
        'PAYROLL_LOCKED'
      );
    }
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 24) {
      throw httpError(400, '신청 시간/일수는 0보다 크고 24 이하인 숫자여야 합니다.', 'INVALID_AMOUNT');
    }
    const reason =
      typeof payload.reason === 'string' && payload.reason.trim()
        ? payload.reason.trim().slice(0, 160)
        : reqType === 'LEAVE'
          ? '개인 사유 연차 신청'
          : '업무 마감 대응 연장근로 신청';

    const newItem = {
      requestId: `APR-${approvalSeq++}`,
      empCode: acc.empCode,
      requesterName: acc.displayName,
      deptName: acc.managedDeptName,
      requestType: reqType,
      title:
        reqType === 'LEAVE'
          ? `연차유급휴가 ${amount}일 사용 신청`
          : `연장근로 ${amount}시간 사전 승인 신청`,
      detailSummary: reason,
      requestedHoursOrDays: amount,
      status: 'PENDING_DEPT',
      createdAt: `2026-11-15 ${nowTimeLabel().slice(0, 5)}`,
      deptApprovedBy: null,
      decidedBy: null,
      decidedAt: null,
      comment: '',
    };
    approvals.unshift(newItem);

    pushRealtimeNotification({
      targetRole: 'ALL_MANAGERS',
      targetDeptName: acc.managedDeptName,
      severity: reqType === 'OVERTIME' && amount >= 4 ? 'WARN' : 'INFO',
      eventCode: 'APPROVAL_REQUESTED',
      title: `[결재 요청] ${newItem.title}`,
      bodySummary: `${acc.displayName} (${acc.managedDeptName}) — ${reason}`,
    });

    return structuredClone(newItem);
  }

  /**
   * 2단계 결재 상태 전이 강제 (`PENDING_DEPT` -> `PENDING_CEO` -> `APPROVED` / `REJECTED`)
   * - `PENDING_CEO` 단계는 오직 `CEO`만 최종 승인/반려 가능!
   * - `PENDING_DEPT` 단계에서 부서관리자·인사관리자가 승인하면 `PENDING_CEO`(대표 결재 대기)로 승격되며,
   *   `CEO`가 직접 승인할 때만 즉시 `APPROVED` 확정되어 근태·급여 파이프라인에 반영된다.
   */
  function decideApprovalRequest(cookieToken, payload = {}, onApplyApprovedEffect = null) {
    const { acc } = getValidSession(cookieToken);
    if (acc.role === 'WORKER') {
      throw httpError(403, '근로자 계정은 결재 승인/반려 권한이 없습니다.', 'FORBIDDEN');
    }

    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
    const decision = String(payload.decision || '');
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      throw httpError(400, '결재 처리는 APPROVE 또는 REJECT여야 합니다.', 'INVALID_DECISION');
    }

    const target = approvals.find((a) => a.requestId === requestId);
    if (!target) {
      throw httpError(404, '결재 요청 건을 찾을 수 없습니다.', 'APPROVAL_NOT_FOUND');
    }
    if (target.status === 'APPROVED' || target.status === 'REJECTED') {
      throw httpError(400, '이미 최종 처리가 완료된 결재 건입니다.', 'ALREADY_DECIDED');
    }

    if (target.status === 'PENDING_CEO' && acc.role !== 'CEO') {
      throw httpError(
        403,
        '대표이사 최종 결재 대기(PENDING_CEO) 건은 대표이사(CEO)만 승인·반려할 수 있습니다.',
        'FORBIDDEN_STAGE'
      );
    }

    if (acc.role === 'DEPT_MANAGER') {
      if (target.deptName !== acc.managedDeptName) {
        throw httpError(403, '타 부서의 결재 요청은 처리할 수 없습니다.', 'FORBIDDEN_DEPT');
      }
      if (target.requestType !== 'LEAVE' && target.requestType !== 'OVERTIME') {
        throw httpError(403, '부서관리자는 연차·연장근로 결재만 처리할 수 있습니다.', 'FORBIDDEN_TYPE');
      }
    }

    if (
      decision === 'APPROVE' &&
      target.requestType === 'OVERTIME' &&
      payrollCloseState.status === 'APPROVED_LOCKED'
    ) {
      throw httpError(
        409,
        '당월 급여대장이 이미 최종 승인·잠금되어 연장근로 결재를 반영할 수 없습니다.',
        'PAYROLL_LOCKED'
      );
    }

    const ts = `2026-11-15 ${nowTimeLabel().slice(0, 5)}`;
    target.comment =
      typeof payload.comment === 'string' ? payload.comment.trim().slice(0, 200) : '';

    if (decision === 'REJECT') {
      target.status = 'REJECTED';
      target.decidedBy = acc.displayName;
      target.decidedAt = ts;
    } else if (target.status === 'PENDING_DEPT' && acc.role !== 'CEO') {
      // 1차 부서장/인사팀 승인 -> 대표이사 최종 결재 단계(PENDING_CEO)로 전이!
      target.status = 'PENDING_CEO';
      target.deptApprovedBy = acc.displayName;
      pushRealtimeNotification({
        targetRole: 'CEO',
        severity: 'INFO',
        eventCode: 'APPROVAL_ESCALATED_CEO',
        title: `[1차 승인 완료 → 대표 결재 요청] ${target.title}`,
        bodySummary: `${acc.displayName} 1차 검토 완료 — 대표이사 최종 승인을 기다립니다.`,
      });
      return structuredClone(target);
    } else {
      // CEO 승인 -> 최종 확정(APPROVED) 및 급여·연차·법정과제 반영!
      target.status = 'APPROVED';
      target.decidedBy = acc.displayName;
      target.decidedAt = ts;

      if (target.requestType === 'LEAVE' && target.empCode) {
        const st = workerLiveStatus.get(target.empCode);
        if (st) {
          st.remainingLeaveDays = Math.max(
            0,
            Math.round((st.remainingLeaveDays - target.requestedHoursOrDays) * 10) / 10
          );
        }
      }
      if (typeof onApplyApprovedEffect === 'function') {
        onApplyApprovedEffect(target, acc);
      }
    }

    if (target.empCode) {
      pushRealtimeNotification({
        targetRole: 'WORKER',
        targetEmpCode: target.empCode,
        severity: target.status === 'APPROVED' ? 'INFO' : 'WARN',
        eventCode: 'APPROVAL_DECIDED',
        title: `결재 ${target.status === 'APPROVED' ? '최종 승인' : '반려'}: ${target.title}`,
        bodySummary: `처리자: ${acc.displayName}`,
      });
    }

    pushRealtimeNotification({
      targetRole: 'ALL_MANAGERS',
      targetDeptName: target.deptName,
      severity: 'INFO',
      eventCode: 'APPROVAL_DECIDED',
      title: `[결재 완료] ${target.title} (${target.status === 'APPROVED' ? '승인' : '반려'})`,
      bodySummary: `${acc.displayName}님이 결재를 완료했습니다.`,
    });

    return structuredClone(target);
  }

  /**
   * 급여 마감 상신 및 대표이사 최종 확정 잠금 (잠금 이후 재상신·중복승인 409 차단!)
   */
  function submitPayrollCloseRequest(cookieToken) {
    const { acc } = getValidSession(cookieToken);
    if (acc.role !== 'HR_ADMIN' && acc.role !== 'CEO') {
      throw httpError(403, '급여 마감 상신 권한이 없습니다.', 'FORBIDDEN');
    }
    if (payrollCloseState.status === 'APPROVED_LOCKED') {
      throw httpError(
        409,
        '이미 대표이사 최종 승인으로 잠금 확정(APPROVED_LOCKED)된 급여대장은 재상신하여 잠금을 해제할 수 없습니다.',
        'PAYROLL_ALREADY_LOCKED'
      );
    }
    payrollCloseState.status = 'PENDING_CEO';
    payrollCloseState.submittedBy = acc.displayName;
    payrollCloseState.submittedAt = `2026-11-15 ${nowTimeLabel().slice(0, 5)}`;

    pushRealtimeNotification({
      targetRole: 'CEO',
      severity: 'WARN',
      eventCode: 'PAYROLL_SUBMITTED',
      title: `${payrollCloseState.yearMonth} 급여대장 최종 승인 요청`,
      bodySummary: `${acc.displayName}님이 급여 정산안을 상신했습니다. 모바일에서 검토 후 승인해 주세요.`,
    });

    return structuredClone(payrollCloseState);
  }

  function approveMonthlyPayrollByCeo(cookieToken, onAudit = null) {
    const { acc } = getValidSession(cookieToken);
    if (acc.role !== 'CEO') {
      throw httpError(
        403,
        '당월 급여대장 최종 확정 승인 권한은 대표이사(CEO) 전용입니다.',
        'CEO_ONLY_PERMISSION'
      );
    }
    if (payrollCloseState.status === 'APPROVED_LOCKED') {
      throw httpError(409, '이미 최종 승인·잠금된 급여대장입니다.', 'PAYROLL_ALREADY_LOCKED');
    }
    if (payrollCloseState.status !== 'PENDING_CEO') {
      throw httpError(400, '급여 마감 상신(PENDING_CEO) 상태에서만 최종 승인할 수 있습니다.', 'INVALID_STATE');
    }

    payrollCloseState.status = 'APPROVED_LOCKED';
    payrollCloseState.approvedBy = acc.displayName;
    payrollCloseState.approvedAt = `2026-11-15 ${nowTimeLabel().slice(0, 5)}`;

    if (typeof onAudit === 'function') {
      onAudit(
        '모바일대표결재',
        `[${acc.displayName}] ${payrollCloseState.yearMonth} 급여대장 모바일 최종 승인·스냅샷 잠금 완료`
      );
    }

    pushRealtimeNotification({
      targetRole: 'CEO_AND_HR',
      severity: 'INFO',
      eventCode: 'PAYROLL_LOCKED',
      title: `${payrollCloseState.yearMonth} 급여대장 대표이사 최종 승인 완료`,
      bodySummary: `${acc.displayName}님이 당월 급여 정산을 최종 확정했습니다. 산출식 임금명세서가 교부됩니다.`,
    });
    pushRealtimeNotification({
      targetRole: 'WORKER',
      targetEmpCode: 'EMP-201',
      severity: 'INFO',
      eventCode: 'PAYSLIP_READY',
      title: `${payrollCloseState.yearMonth} 산출식 임금명세서 도착`,
      bodySummary: '급여 정산이 확정되어 모바일 앱에서 임금명세서를 확인할 수 있습니다.',
    });

    return structuredClone(payrollCloseState);
  }

  function getPayrollCloseState() {
    return structuredClone(payrollCloseState);
  }

  /**
   * PC 관리자 API 호출 시 제한된 모바일 세션(WORKER / DEPT_MANAGER / MFA_PENDING)의 권한 상승 우회 차단
   */
  function inspectCookieForPcApiGuard(cookieToken, requireAdminAuth = false) {
    if (!cookieToken) {
      if (requireAdminAuth) {
        throw httpError(401, '관리자 세션 인증이 필요합니다.', 'ADMIN_AUTH_REQUIRED');
      }
      return null;
    }
    const sessionHash = sha256Hex(cookieToken);
    const session = sessionsByHash.get(sessionHash);
    if (!session) {
      if (requireAdminAuth) {
        throw httpError(401, '유효한 관리자 세션이 아닙니다.', 'SESSION_INVALID');
      }
      return null;
    }
    const now = nowFn();
    if (session.authStage === 'REVOKED' || session.expiresAtMs <= now) {
      if (requireAdminAuth) {
        throw httpError(401, '만료되었거나 해지된 세션입니다.', 'SESSION_REVOKED');
      }
      return null;
    }
    if (session.authStage !== 'AUTHENTICATED') {
      throw httpError(
        403,
        '2차 인증 미완료(MFA_PENDING) 상태에서는 전사 관리자 API에 접근할 수 없습니다.',
        'MFA_REQUIRED'
      );
    }
    if (session.role !== 'CEO' && session.role !== 'HR_ADMIN') {
      throw httpError(
        403,
        `현재 로그인된 모바일 역할(${session.role})에서는 전사 급여·인사 관리자 API에 접근할 수 없습니다.`,
        'PC_API_FORBIDDEN_FOR_ROLE'
      );
    }
    return session;
  }

  /**
   * 실시간 SSE 스트림 구독 등록 (`GET /api/mobile/stream` — 세션별 동시 연결 상한 및 만료 자동 종료 포함)
   */
  function attachSseClient(cookieToken, req, res) {
    const { session, acc, sessionHash } = getValidSession(cookieToken);
    if (sseClients.size >= MAX_SSE_CLIENTS) {
      throw httpError(503, '동시 실시간 스트림 연결 한도를 초과했습니다.', 'SSE_LIMIT');
    }
    let sessionStreamCount = 0;
    for (const c of sseClients) {
      if (c.sessionHash === sessionHash) sessionStreamCount += 1;
    }
    if (sessionStreamCount >= MAX_SSE_PER_SESSION) {
      throw httpError(429, '동일 세션의 실시간 스트림 중복 연결 한도(3개)를 초과했습니다.', 'SSE_SESSION_LIMIT');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });

    const clientEntry = { sessionHash, deviceId: session.deviceId, res };
    sseClients.add(clientEntry);

    sendSseFrame(res, 'connected', {
      deviceId: session.deviceId,
      role: acc.role,
      connectedAt: nowTimeLabel(),
    });

    const heartbeat = setInterval(() => {
      const liveSession = sessionsByHash.get(sessionHash);
      if (!liveSession || liveSession.authStage !== 'AUTHENTICATED' || liveSession.expiresAtMs <= nowFn()) {
        clearInterval(heartbeat);
        sendSseFrame(res, 'session_revoked', { reason: '세션 유효기간이 만료되었습니다.' });
        try {
          res.end();
        } catch {
          // ignore
        }
        sseClients.delete(clientEntry);
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(clientEntry);
      }
    }, 20000);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(clientEntry);
    });
  }

  function closeAllStreams() {
    for (const client of [...sseClients]) {
      try {
        client.res.end();
      } catch {
        // ignore
      }
      sseClients.delete(client);
    }
  }

  /**
   * 기본값(demoMode=false)에서는 계정 비밀번호·PIN을 HTTP 응답에 절대 노출하지 않으며,
   * 명시적 로컬 데모 환경변수(MHR_DEMO_MODE=1)일 때만 로컬 시뮬레이터 편의용 시드를 내려준다.
   */
  function listSimulatorDemoAccounts() {
    const base = [
      {
        loginId: 'ceo',
        role: 'CEO',
        label: '대표이사 (전사 관제 · 급여 최종승인 · 기기관리)',
        mfaRequired: true,
      },
      {
        loginId: 'hr.admin',
        role: 'HR_ADMIN',
        label: '인사노무팀장 (법정신고 감독 · 급여상신 · 기기관리)',
        mfaRequired: true,
      },
      {
        loginId: 'dept.lead',
        role: 'DEPT_MANAGER',
        label: '생산기술1팀장 (부서 근태·52h 감시 · 부서 1차결재)',
        mfaRequired: true,
      },
      {
        loginId: 'emp.201',
        role: 'WORKER',
        label: '근로자 김하늘 (출퇴근 · 전자계약 · 연차신청 · 본인명세서)',
        mfaRequired: false,
      },
    ];

    if (!demoMode) {
      return base;
    }

    return base.map((item) => ({
      ...item,
      demoPassword: bootGeneratedSecrets[item.loginId].password,
      demoPin: bootGeneratedSecrets[item.loginId].pin,
    }));
  }

  return {
    loginStep1,
    getValidSession,
    registerPasskeyPublicKey,
    issuePasskeyChallenge,
    verifyMfaStep2,
    logoutSession,
    revokeDeviceByAdmin,
    revokeWorkerAccessOnOffboard,
    syncWorkerAccessWithRoster,
    scrubPurgedPersonFromHub,
    buildMobileRoleDashboard,
    recordWorkerClock,
    signWorkerContract,
    createWorkerApprovalRequest,
    decideApprovalRequest,
    submitPayrollCloseRequest,
    approveMonthlyPayrollByCeo,
    getPayrollCloseState,
    inspectCookieForPcApiGuard,
    attachSseClient,
    pushRealtimeNotification,
    closeAllStreams,
    listSimulatorDemoAccounts,
    toPublicSessionInfo,
  };
}
